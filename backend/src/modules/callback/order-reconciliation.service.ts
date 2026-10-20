import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStateService } from '../orders/order-state.service';
import { MyCardCallbackService } from './mycard-callback.service';

/**
 * 訂單對帳 sweep — 每 5 分鐘掃一次,補兩種「自然流程沒收尾」的洞:
 *
 *   1. 漏派獎:玩家付了款但 trade-result callback 漏接 / probe 失敗,單卡在
 *      AUTHED / PAID / CONFIRMED → 跑一次補儲(forceReprocess = TradeQuery +
 *      PaymentConfirm + 派發),把它推到 DELIVERED(或 PayResult=0 → FAILED)。
 *
 *   2. 卡單清理:PENDING(AuthGlobal 沒成功,無金流)或逾時未付的 AUTHED
 *      (TradeQuery 已確認沒付)→ 取消,讓訂單收斂到終態。
 *
 * 註:鎖的生命週期已全交由伺服器端自管(web 不再送 Lock/Unlock),這裡不再有解鎖步驟。
 *
 * 設計:
 *   - 單一容器單實例(Zeabur)→ 用 in-memory `running` 旗標擋重疊,不需 leader election。
 *   - 取消前一定先 TradeQuery 確認沒付(forceReprocess 內含),且 transition 的
 *     原子 FOR UPDATE + 狀態機檢查擋住「TradeQuery 後、取消前」剛好付款的 race。
 *   - DELIVERY_FAILED 不碰(留人工)。
 */
@Injectable()
export class OrderReconciliationService {
  private readonly logger = new Logger(OrderReconciliationService.name);
  private running = false;

  private readonly enabled: boolean;
  private readonly deliverGraceMs: number;
  private readonly cancelGraceMs: number;
  private readonly maxAgeMs: number;

  /** 單輪每段最多處理幾筆,避免一次掃爆(下一輪會接著掃)*/
  private static readonly BATCH = 200;

  constructor(
    private readonly prisma: PrismaService,
    private readonly callback: MyCardCallbackService,
    private readonly state: OrderStateService,
    config: ConfigService,
  ) {
    this.enabled = (config.get<string>('ORDER_SWEEP_ENABLED') ?? 'true') !== 'false';
    this.deliverGraceMs = config.get<number>('ORDER_SWEEP_DELIVER_GRACE_MIN', 10) * 60_000;
    this.cancelGraceMs = config.get<number>('ORDER_SWEEP_CANCEL_GRACE_MIN', 60) * 60_000;
    this.maxAgeMs = config.get<number>('ORDER_SWEEP_MAX_AGE_HOURS', 48) * 3_600_000;
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweep(): Promise<void> {
    if (!this.enabled) return;
    if (this.running) {
      this.logger.warn('[sweep] 上一輪還沒跑完,跳過這輪');
      return;
    }
    this.running = true;
    const start = Date.now();
    try {
      const stuck = await this.sweepStuckOrders();
      if (stuck > 0) {
        this.logger.log(`[sweep] 完成(${Date.now() - start}ms)卡單處理=${stuck}`);
      }
    } catch (err) {
      this.logger.error(`[sweep] 例外:${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * 卡單:AUTHED/PAID/CONFIRMED → 補儲推進派發;PENDING / 逾時未付 AUTHED → 取消。
   */
  private async sweepStuckOrders(): Promise<number> {
    const now = Date.now();
    const deliverBefore = new Date(now - this.deliverGraceMs);
    const cancelBefore = new Date(now - this.cancelGraceMs);
    const tooOldBefore = new Date(now - this.maxAgeMs);

    const orders = await this.prisma.order.findMany({
      where: {
        status: {
          in: [
            OrderStatus.PENDING,
            OrderStatus.AUTHED,
            OrderStatus.PAID,
            OrderStatus.CONFIRMED,
          ],
        },
        createdAt: { lt: deliverBefore },
      },
      orderBy: { createdAt: 'asc' },
      take: OrderReconciliationService.BATCH,
      select: { id: true, facTradeSeq: true, status: true, createdAt: true },
    });

    let handled = 0;
    for (const o of orders) {
      // PENDING:AuthGlobal 沒成功 → 不可能有金流 → 直接取消
      if (o.status === OrderStatus.PENDING) {
        await this.cancelStuckOrder(o.id, o.facTradeSeq, 'sweep: PENDING 卡單逾時(無金流可能)');
        handled++;
        continue;
      }

      // 太舊的 AUTHED:MyCard auth 早已失效,不再 TradeQuery,直接取消
      if (o.status === OrderStatus.AUTHED && o.createdAt < tooOldBefore) {
        await this.cancelStuckOrder(
          o.id,
          o.facTradeSeq,
          `sweep: AUTHED 超過 ${Math.round(this.maxAgeMs / 3_600_000)}h 仍未付,釋放`,
        );
        handled++;
        continue;
      }

      // AUTHED/PAID/CONFIRMED:跑一次補儲(TradeQuery → 付了就推進派發;PayResult=0 → FAILED)
      const before = o.status;
      const r = await this.callback.forceReprocess(o.facTradeSeq);
      handled++;
      this.logger.log(
        `[sweep] reprocess ${o.facTradeSeq} ${before} → ${r.status ?? '?'}(${r.message})`,
      );

      // 仍停在 AUTHED(= TradeQuery 剛確認尚未付款)且逾 cancel 寬限 → 取消解鎖
      if (r.status === OrderStatus.AUTHED && o.createdAt < cancelBefore) {
        await this.cancelStuckOrder(
          o.id,
          o.facTradeSeq,
          `sweep: AUTHED 逾 ${Math.round(this.cancelGraceMs / 60_000)} 分仍未付(TradeQuery 已確認),釋放`,
        );
      }
    }
    return handled;
  }

  /**
   * 取消卡單。若期間訂單已被付款 callback 推進(AUTHED→PAID),狀態機會擋下這次
   * CANCELLED 而丟錯,這裡 catch 住 → 不取消,保住已付款的單(取消前的最後一道防線)。
   */
  private async cancelStuckOrder(
    orderId: string,
    facTradeSeq: string,
    reason: string,
  ): Promise<void> {
    try {
      await this.state.transition({
        orderId,
        toStatus: OrderStatus.CANCELLED,
        triggeredBy: 'system',
        reason,
      });
      this.logger.log(`[sweep] 取消卡單 ${facTradeSeq}:${reason}`);
    } catch (err) {
      this.logger.warn(
        `[sweep] 取消 ${facTradeSeq} 被狀態機擋下(可能剛付款)→ 不動:${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
