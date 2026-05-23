import { Inject, Injectable, Logger } from '@nestjs/common';
import { DeliveryStatus, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStateService } from '../orders/order-state.service';
import { MAIL_DISPATCHER, MailDispatcher, DispatchResult } from './mail-dispatcher.interface';

interface ProductEffectsJson {
  effects?: Array<{ type: string; code: string; amount?: number; qty?: number; duration_seconds?: number }>;
  mail?: { subject?: string; body?: string; expire_days?: number };
}

interface ProductSnapshotShape {
  effects?: ProductEffectsJson;
  playfab_item_id?: string | null;
  playfab_store_id?: string | null;
}

@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly state: OrderStateService,
    @Inject(MAIL_DISPATCHER) private readonly dispatcher: MailDispatcher,
  ) {}

  /**
   * 對 CONFIRMED 的訂單派發到遊戲信件
   *
   * 流程:
   *   1. 確認 order.status = CONFIRMED 且未派發成功過(冪等)
   *   2. 組 payload(從 product_snapshot.effects)
   *   3. 呼叫 dispatcher.dispatch
   *   4. 記 delivery_attempts
   *   5. 成功 → state.transition(CONFIRMED → DELIVERED)
   *   6. 失敗 → 看 attempt 次數,< 3 留 CONFIRMED 等重試,≥ 3 轉 DELIVERY_FAILED
   *
   * @param orderId 訂單 id
   * @param opts.force true = 跳過冪等檢查強制重新派發(後台「強制重派」用,
   *                   危險:可能讓玩家拿到第二份禮包。前端必須二次確認)
   * @returns 是否成功派發
   */
  async tryDispatch(
    orderId: string,
    opts: { force?: boolean } = {},
  ): Promise<{ ok: boolean; status: OrderStatus }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: { select: { uid: true } },
        deliveryAttempts: {
          where: { status: DeliveryStatus.SUCCESS },
          take: 1,
        },
      },
    });

    if (!order) throw new Error(`Order ${orderId} not found`);

    // 已派發成功 → 冪等,跳過(force 時跳過此檢查)
    if (!opts.force && order.deliveryAttempts.length > 0) {
      this.logger.log(`Order ${order.facTradeSeq} 已派發成功過,跳過`);
      return { ok: true, status: order.status };
    }

    // 只能在 CONFIRMED / DELIVERY_FAILED / DELIVERED(force)派發
    if (
      !opts.force &&
      order.status !== OrderStatus.CONFIRMED &&
      order.status !== OrderStatus.DELIVERY_FAILED
    ) {
      this.logger.warn(
        `Order ${order.facTradeSeq} 狀態為 ${order.status},非 CONFIRMED/DELIVERY_FAILED,跳過派發`,
      );
      return { ok: false, status: order.status };
    }

    if (opts.force) {
      this.logger.warn(
        `Order ${order.facTradeSeq} 強制重派(force=true) — 目前 status=${order.status}, prev success attempts=${order.deliveryAttempts.length}`,
      );
    }

    // 組 payload
    const snapshot = order.productSnapshot as ProductSnapshotShape;
    const productEffects = (snapshot.effects ?? {}) as ProductEffectsJson;
    const payload = {
      subject: productEffects.mail?.subject ?? `購買成功 - ${order.facTradeSeq}`,
      body: productEffects.mail?.body ?? '感謝您的購買',
      expire_days: productEffects.mail?.expire_days ?? 30,
      effects: productEffects.effects ?? [],
    };

    // 算目前是第幾次
    const attemptCount = await this.prisma.deliveryAttempt.count({
      where: { orderId: order.id },
    });
    const attemptNumber = attemptCount + 1;

    // 呼叫 dispatcher
    let result: DispatchResult;
    try {
      result = await this.dispatcher.dispatch({
        orderId: order.id,
        facTradeSeq: order.facTradeSeq,
        uid: order.user.uid,
        priceTwd: Math.round(Number(order.amount)),
        playfabItemId: snapshot.playfab_item_id ?? null,
        playfabStoreId: snapshot.playfab_store_id ?? null,
        payload,
      });
    } catch (err) {
      result = {
        ok: false,
        errorMessage: err instanceof Error ? err.message : String(err),
        durationMs: 0,
      };
    }

    // 記 delivery_attempts
    await this.prisma.deliveryAttempt.create({
      data: {
        orderId: order.id,
        attemptNumber,
        status: result.ok ? DeliveryStatus.SUCCESS : DeliveryStatus.FAILED,
        requestPayload: payload as unknown as Prisma.InputJsonValue,
        responseStatus: result.responseStatus ?? null,
        responseBody: result.responseBody ?? null,
        errorMessage: result.errorMessage ?? null,
        durationMs: result.durationMs,
      },
    });

    if (result.ok) {
      // 已是 DELIVERED 的 force 重派,不再 transition(避免 DELIVERED→DELIVERED 同態轉換 throw)
      if (order.status !== OrderStatus.DELIVERED) {
        await this.state.transition({
          orderId: order.id,
          toStatus: OrderStatus.DELIVERED,
          triggeredBy: 'system',
          reason: `Dispatched (attempt #${attemptNumber}, mail_id=${result.mailId ?? 'unknown'})`,
          metadata: { mail_id: result.mailId ?? null, attempt: attemptNumber },
        });
      } else {
        this.logger.log(
          `Order ${order.facTradeSeq} force re-dispatched while already DELIVERED, no state change`,
        );
      }
      return { ok: true, status: OrderStatus.DELIVERED };
    }

    // 失敗:重試 ≥ 3 → 進 DELIVERY_FAILED(人工)
    const MAX_AUTO_RETRY = 3;
    if (attemptNumber >= MAX_AUTO_RETRY) {
      await this.state.transition({
        orderId: order.id,
        toStatus: OrderStatus.DELIVERY_FAILED,
        triggeredBy: 'system',
        reason: `Dispatch failed after ${attemptNumber} attempts: ${result.errorMessage}`,
        metadata: { last_error: result.errorMessage ?? null },
      });
      this.logger.error(
        `Order ${order.facTradeSeq} 派發失敗 ${attemptNumber} 次,標記 DELIVERY_FAILED`,
      );
      return { ok: false, status: OrderStatus.DELIVERY_FAILED };
    }

    // 失敗但未滿次數:留 CONFIRMED 等下次重試
    this.logger.warn(
      `Order ${order.facTradeSeq} 派發失敗(${attemptNumber}/${MAX_AUTO_RETRY}),維持 ${order.status}`,
    );
    return { ok: false, status: order.status };
  }
}
