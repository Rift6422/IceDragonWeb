import { Injectable, Logger } from '@nestjs/common';
import { CallbackDirection, CallbackKind, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStateService } from '../orders/order-state.service';
import { MyCardApiService } from '../mycard/api-client/mycard-api.service';
import { MyCardHashFactory } from '../mycard/hash/mycard-hash.factory';
import { DispatchService } from '../dispatch/dispatch.service';

interface TradeResultPayload {
  ReturnCode: string;
  ReturnMsg?: string;
  PayResult?: string;
  FacTradeSeq?: string;
  PaymentType?: string;
  Amount?: string;
  Currency?: string;
  MyCardTradeNo?: string;
  MyCardType?: string;
  PromoCode?: string;
  SerialId?: string;
  Hash?: string;
}

interface SupplementDataPayload {
  ReturnCode?: string;
  ReturnMsg?: string;
  FacServiceId?: string;
  TotalNum?: number;
  FacTradeSeq?: string[];
}

@Injectable()
export class MyCardCallbackService {
  private readonly logger = new Logger(MyCardCallbackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly state: OrderStateService,
    private readonly mycard: MyCardApiService,
    private readonly hashFactory: MyCardHashFactory,
    private readonly dispatch: DispatchService,
  ) {}

  // ============================================================
  // §3.2.4 交易結果回傳(POST,MyCard 跳轉回我們)
  // ============================================================

  async handleTradeResult(
    payload: TradeResultPayload,
    meta: { sourceIp?: string; userAgent?: string; rawBody?: string },
  ): Promise<{ ok: boolean; processed: boolean }> {
    this.logger.log(
      `[INBOUND] TRADE_RESULT FacTradeSeq=${payload.FacTradeSeq} PayResult=${payload.PayResult} MyCardTradeNo=${payload.MyCardTradeNo} from=${meta.sourceIp} UA=${(meta.userAgent ?? '').slice(0, 40)}`,
    );

    // 1. 記 inbound log
    const log = await this.writeInboundLog(CallbackKind.TRADE_RESULT, meta, payload);

    // 2. 驗 Hash
    const hashValid = this.verifyTradeResultHash(payload);
    await this.prisma.callbackLog.update({
      where: { id: log.id },
      data: { hashValid },
    });
    if (!hashValid) {
      await this.markLogProcessed(log.id, false, 'Hash mismatch');
      this.logger.warn(`TradeResult callback hash invalid for ${payload.FacTradeSeq}`);
      return { ok: false, processed: false };
    }

    // 3. 找訂單
    if (!payload.FacTradeSeq) {
      await this.markLogProcessed(log.id, false, 'Missing FacTradeSeq');
      return { ok: false, processed: false };
    }
    const order = await this.prisma.order.findUnique({
      where: { facTradeSeq: payload.FacTradeSeq },
    });
    if (!order) {
      await this.markLogProcessed(log.id, false, 'Order not found');
      return { ok: false, processed: false };
    }

    // 連回 callback log 到該訂單
    await this.prisma.callbackLog.update({
      where: { id: log.id },
      data: { orderId: order.id },
    });

    // 4. 只認 PayResult=3 為成功
    if (payload.PayResult !== '3') {
      // 已是終態就跳過
      if (order.status === OrderStatus.FAILED || order.status === OrderStatus.CANCELLED) {
        await this.markLogProcessed(log.id, true, null);
        return { ok: true, processed: false };
      }
      await this.state.transition({
        orderId: order.id,
        toStatus: OrderStatus.FAILED,
        triggeredBy: 'mycard_callback',
        reason: `PayResult=${payload.PayResult} (${payload.ReturnMsg ?? ''})`,
        metadata: payload as unknown as Prisma.InputJsonValue,
      });
      await this.markLogProcessed(log.id, true, null);
      return { ok: true, processed: true };
    }

    // 5. 防重複儲值 — 用 mycard_trade_no unique
    if (payload.MyCardTradeNo) {
      const existed = await this.prisma.transaction.findUnique({
        where: { mycardTradeNo: payload.MyCardTradeNo },
      });
      if (existed && existed.orderId !== order.id) {
        await this.markLogProcessed(log.id, false, 'Duplicate MyCardTradeNo for different order');
        this.logger.error(
          `Duplicate MyCardTradeNo ${payload.MyCardTradeNo} — existing order ${existed.orderId}, incoming ${order.id}`,
        );
        return { ok: false, processed: false };
      }
    }

    // 6. 更新 transaction 欄位
    await this.prisma.transaction.update({
      where: { orderId: order.id },
      data: {
        mycardTradeNo: payload.MyCardTradeNo ?? null,
        paymentType: payload.PaymentType ?? null,
        mycardType: payload.MyCardType ?? null,
        payResult: 3,
        promoCode: payload.PromoCode ?? null,
        serialId: payload.SerialId ?? null,
        resultRawBody: payload as unknown as Prisma.InputJsonValue,
      },
    });

    // 7. AUTHED → PAID(冪等:已是 PAID 不會錯)
    if (order.status === OrderStatus.AUTHED) {
      await this.state.transition({
        orderId: order.id,
        toStatus: OrderStatus.PAID,
        triggeredBy: 'mycard_callback',
        reason: 'TradeResult PayResult=3',
        metadata: { my_card_trade_no: payload.MyCardTradeNo ?? null },
      });
    }

    // 8. 立刻打 PaymentConfirm(請款)→ CONFIRMED
    const tx = await this.prisma.transaction.findUnique({ where: { orderId: order.id } });
    if (tx?.authCode) {
      const confirmResult = await this.mycard.paymentConfirm(tx.authCode, order.id);
      if (confirmResult.ok) {
        await this.prisma.transaction.update({
          where: { orderId: order.id },
          data: { confirmRawResponse: confirmResult.data as unknown as Prisma.InputJsonValue },
        });
        const afterConfirm = await this.prisma.order.findUnique({ where: { id: order.id } });
        if (afterConfirm && afterConfirm.status === OrderStatus.PAID) {
          await this.state.transition({
            orderId: order.id,
            toStatus: OrderStatus.CONFIRMED,
            triggeredBy: 'system',
            reason: 'PaymentConfirm success',
          });
        }
        // 9. 派發
        await this.dispatch.tryDispatch(order.id);
      } else {
        this.logger.warn(
          `PaymentConfirm failed for ${order.facTradeSeq}: ${confirmResult.returnCode} ${confirmResult.returnMsg}`,
        );
      }
    }

    await this.markLogProcessed(log.id, true, null);
    return { ok: true, processed: true };
  }

  // ============================================================
  // §3.6 補儲通知(POST x-www-form-urlencoded,DATA=JSON)
  // ============================================================

  async handleSupplement(
    rawData: string,
    meta: { sourceIp?: string; userAgent?: string; rawBody?: string },
  ): Promise<{ ok: boolean; processed: number }> {
    this.logger.log(
      `[INBOUND] SUPPLEMENT from=${meta.sourceIp} UA=${(meta.userAgent ?? '').slice(0, 40)} data=${rawData.slice(0, 200)}`,
    );

    const log = await this.writeInboundLog(CallbackKind.SUPPLEMENT, meta, { DATA: rawData });

    let data: SupplementDataPayload;
    try {
      data = JSON.parse(rawData) as SupplementDataPayload;
    } catch {
      await this.markLogProcessed(log.id, false, 'Invalid JSON in DATA');
      return { ok: false, processed: 0 };
    }

    const seqList = data.FacTradeSeq ?? [];
    let processed = 0;
    for (const facTradeSeq of seqList) {
      try {
        await this.reprocessOne(facTradeSeq);
        processed++;
      } catch (err) {
        this.logger.error(
          `Supplement reprocess failed for ${facTradeSeq}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    await this.markLogProcessed(log.id, true, null);
    return { ok: true, processed };
  }

  /**
   * 給玩家瀏覽器 form-submit 用:hold 連線等 server-to-server callback 把
   * 訂單推進到終態,再回傳該導去的 URL(含 ?result= query 提示終態)。
   *
   * 為什麼這樣設計:
   *   MyCard 同時送「server callback」和「瀏覽器 form-submit」兩條路。
   *   瀏覽器通常會比 server callback 先到,玩家被 redirect 後會看到
   *   「處理中...」轉圈,等 server callback 跑完才變成功。
   *   wait-and-join 做的是:瀏覽器到了我們這先 hold 連線 N 秒輪詢訂單
   *   狀態,等 server callback 把 status 推到 DELIVERED 才放人,玩家
   *   一進到 / 就直接看到最終結果。
   *
   * @param facTradeSeq  訂單序號(可能空字串,代表 MyCard 沒帶,此時直接回 /)
   * @param timeoutMs    最長等多久(建議 5-8 秒;Cloudflare 邊界是 100 秒,但
   *                     hold 太久容易讓玩家覺得卡住)
   * @returns            前端要去的 URL,含 ?paid= 和 ?result=(若已知終態)
   */
  async waitForOrderResolution(facTradeSeq: string, timeoutMs: number): Promise<string> {
    if (!facTradeSeq) return '/';

    const encoded = encodeURIComponent(facTradeSeq);
    const deadline = Date.now() + timeoutMs;
    let pollCount = 0;

    while (Date.now() < deadline) {
      const order = await this.prisma.order.findUnique({
        where: { facTradeSeq },
        select: { status: true },
      });
      pollCount++;

      if (!order) {
        // 找不到單就放行,前端 modal 會 fallback 到 poll(也會撈不到)
        this.logger.warn(`wait-and-join: order ${facTradeSeq} not found after ${pollCount} polls`);
        return `/?paid=${encoded}`;
      }

      const s = order.status;
      if (s === OrderStatus.DELIVERED) {
        this.logger.log(`wait-and-join: ${facTradeSeq} DELIVERED after ${pollCount} polls`);
        return `/?paid=${encoded}&result=success`;
      }
      if (s === OrderStatus.DELIVERY_FAILED) {
        return `/?paid=${encoded}&result=delivery_failed`;
      }
      if (s === OrderStatus.FAILED) {
        return `/?paid=${encoded}&result=fail`;
      }
      if (s === OrderStatus.CANCELLED) {
        return `/?paid=${encoded}&result=cancelled`;
      }

      // 還在 PENDING / AUTHED / PAID / CONFIRMED → 再等
      await new Promise((r) => setTimeout(r, 200));
    }

    // timeout:server callback 還沒處理完(可能網路慢、可能根本沒到)
    // 不帶 ?result=,讓前端 modal poll 接手
    this.logger.warn(
      `wait-and-join: ${facTradeSeq} timeout after ${pollCount} polls (${timeoutMs}ms),no terminal state yet`,
    );
    return `/?paid=${encoded}`;
  }

  /**
   * 對外公開:手動觸發某張單的補儲流程(等同 MyCard 主動推 supplement)。
   *
   * 用途:
   *   - 因網路 / IP 白名單問題導致 callback 漏接,後台手動補救
   *   - QA 在沒等 MyCard 真實 supplement(~20 min)前先驗證流程
   *
   * 回傳當下訂單狀態,呼叫端可據此判斷補儲是否成功推進。
   */
  async forceReprocess(facTradeSeq: string): Promise<{ ok: boolean; status: OrderStatus | null; message: string }> {
    const before = await this.prisma.order.findUnique({ where: { facTradeSeq } });
    if (!before) {
      return { ok: false, status: null, message: 'Order not found' };
    }
    try {
      await this.reprocessOne(facTradeSeq);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, status: before.status, message: `reprocessOne threw: ${msg}` };
    }
    const after = await this.prisma.order.findUnique({ where: { facTradeSeq } });
    return {
      ok: true,
      status: after?.status ?? before.status,
      message: `${before.status} → ${after?.status ?? '(unchanged)'}`,
    };
  }

  /**
   * 單筆補儲處理:打 TradeQuery + PaymentConfirm + 派發
   */
  private async reprocessOne(facTradeSeq: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { facTradeSeq },
      include: { transaction: true },
    });
    if (!order || !order.transaction?.authCode) return;
    if (order.status === OrderStatus.DELIVERED) return; // 已派發,跳過

    // TradeQuery
    const q = await this.mycard.tradeQuery(order.transaction.authCode, order.id);
    if (!q.ok || q.data.PayResult !== '3') return;

    // 更新 transaction
    await this.prisma.transaction.update({
      where: { orderId: order.id },
      data: {
        mycardTradeNo: q.data.MyCardTradeNo ?? order.transaction.mycardTradeNo,
        paymentType: q.data.PaymentType ?? order.transaction.paymentType,
        payResult: 3,
        resultRawBody: q.data as unknown as Prisma.InputJsonValue,
      },
    });

    // AUTHED → PAID(若還在 AUTHED)
    if (order.status === OrderStatus.AUTHED) {
      await this.state.transition({
        orderId: order.id,
        toStatus: OrderStatus.PAID,
        triggeredBy: 'mycard_callback',
        reason: 'Supplement: TradeQuery PayResult=3',
      });
    }

    // PaymentConfirm + 派發
    const c = await this.mycard.paymentConfirm(order.transaction.authCode, order.id);
    if (c.ok) {
      const refreshed = await this.prisma.order.findUnique({ where: { id: order.id } });
      if (refreshed && refreshed.status === OrderStatus.PAID) {
        await this.state.transition({
          orderId: order.id,
          toStatus: OrderStatus.CONFIRMED,
          triggeredBy: 'system',
          reason: 'Supplement: PaymentConfirm success',
        });
      }
      await this.dispatch.tryDispatch(order.id);
    }
  }

  // ============================================================
  // §3.7 差異比對(POST,回 JSON 給 MyCard)
  // ============================================================

  async handleDiffReport(
    query: { StartDateTime?: string; EndDateTime?: string; MyCardTradeNo?: string },
    meta?: { sourceIp?: string; userAgent?: string; rawBody?: string; httpMethod?: string; url?: string },
  ): Promise<{ trades: unknown[] }> {
    this.logger.log(
      `[INBOUND] DIFF_REPORT from=${meta?.sourceIp} StartDateTime=${query.StartDateTime} EndDateTime=${query.EndDateTime} MyCardTradeNo=${query.MyCardTradeNo}`,
    );

    const log = meta
      ? await this.writeInboundLog(CallbackKind.DIFF_REPORT, meta, query)
      : null;

    // 找成功訂單
    const where: Prisma.OrderWhereInput = {
      status: OrderStatus.DELIVERED,
      transaction: { payResult: 3 },
    };

    if (query.MyCardTradeNo) {
      where.transaction = { mycardTradeNo: query.MyCardTradeNo };
    } else if (query.StartDateTime && query.EndDateTime) {
      where.confirmedAt = {
        gte: new Date(query.StartDateTime),
        lte: new Date(query.EndDateTime),
      };
    }

    const orders = await this.prisma.order.findMany({
      where,
      include: { transaction: true, user: { select: { uid: true, createdAt: true, createdIp: true } } },
      orderBy: { confirmedAt: 'asc' },
      take: 1000,
    });

    const result = {
      trades: orders.map((o) => ({
        PaymentType: o.transaction?.paymentType ?? '',
        TradeSeq: o.transaction?.tradeSeq ?? '',
        MyCardTradeNo: o.transaction?.mycardTradeNo ?? '',
        FacTradeSeq: o.facTradeSeq,
        CustomerId: o.user.uid,
        Amount: o.amount.toString(),
        Currency: o.currency,
        TradeDateTime: this.toUtc8(o.confirmedAt ?? o.createdAt),
        CreateAccountDateTime: this.toUtc8(o.user.createdAt),
        CreateAccountIP: o.user.createdIp ?? '',
      })),
    };

    if (log) {
      await this.prisma.callbackLog.update({
        where: { id: log.id },
        data: {
          processed: true,
          responseStatus: 200,
          responseBody: JSON.stringify({ tradeCount: result.trades.length }),
        },
      });
    }

    return result;
  }

  // ============================================================
  // 廠商儲值紀錄查詢(GET,回 CSV+<BR>)
  // ============================================================

  async handleTopupRecords(
    query: { StartDate?: string; EndDate?: string; MyCardID?: string },
    meta?: { sourceIp?: string; userAgent?: string; rawBody?: string; httpMethod?: string; url?: string },
  ): Promise<string> {
    this.logger.log(
      `[INBOUND] TOPUP_RECORDS from=${meta?.sourceIp} StartDate=${query.StartDate} EndDate=${query.EndDate} MyCardID=${query.MyCardID}`,
    );

    const log = meta
      ? await this.writeInboundLog(CallbackKind.TOPUP_RECORDS, meta, query)
      : null;

    const where: Prisma.OrderWhereInput = {
      status: OrderStatus.DELIVERED,
    };

    if (query.MyCardID) {
      where.transaction = { mycardTradeNo: query.MyCardID };
    } else if (query.StartDate && query.EndDate) {
      where.confirmedAt = {
        gte: new Date(query.StartDate),
        lte: new Date(`${query.EndDate}T23:59:59`),
      };
    }

    const orders = await this.prisma.order.findMany({
      where,
      include: {
        transaction: true,
        product: { select: { code: true, nameDisplay: true } },
        user: { select: { uid: true, createdAt: true, createdIp: true } },
      },
      orderBy: { confirmedAt: 'asc' },
      take: 5000,
    });

    // CSV 11 欄,每筆 <BR> 結尾
    const csv = orders
      .map((o) => {
        const fields = [
          o.transaction?.mycardTradeNo ?? '',
          o.user.uid,
          o.transaction?.tradeSeq ?? '',
          o.facTradeSeq,
          this.toUtc8(o.confirmedAt ?? o.createdAt),
          o.amount.toString(),
          o.currency,
          o.product.code,
          o.product.nameDisplay,
          this.toUtc8(o.user.createdAt),
          o.user.createdIp ?? '',
        ];
        return fields.join(',') + ' <BR>';
      })
      .join('\n');

    if (log) {
      await this.prisma.callbackLog.update({
        where: { id: log.id },
        data: {
          processed: true,
          responseStatus: 200,
          responseBody: JSON.stringify({ recordCount: orders.length }),
        },
      });
    }

    return csv;
  }

  // ============================================================
  // helpers
  // ============================================================

  private verifyTradeResultHash(payload: TradeResultPayload): boolean {
    if (!payload.Hash) return false;
    return this.hashFactory.get().verifyTradeResult(
      {
        returnCode: payload.ReturnCode ?? '',
        payResult: payload.PayResult ?? '',
        facTradeSeq: payload.FacTradeSeq ?? '',
        paymentType: payload.PaymentType ?? '',
        amount: payload.Amount ?? '',
        currency: payload.Currency ?? '',
        myCardTradeNo: payload.MyCardTradeNo ?? '',
        myCardType: payload.MyCardType ?? '',
        promoCode: payload.PromoCode ?? '',
      },
      payload.Hash,
    );
  }

  private async writeInboundLog(
    kind: CallbackKind,
    meta: { sourceIp?: string; userAgent?: string; rawBody?: string; httpMethod?: string; url?: string },
    body: unknown,
  ): Promise<{ id: string }> {
    return this.prisma.callbackLog.create({
      data: {
        direction: CallbackDirection.INBOUND,
        kind,
        httpMethod: meta.httpMethod ?? 'POST',
        url: meta.url ?? `/api/mycard/${kind.toLowerCase().replace(/_/g, '-')}`,
        requestBody: meta.rawBody ?? JSON.stringify(body),
        sourceIp: meta.sourceIp ?? null,
        userAgent: meta.userAgent ?? null,
        processed: false,
      },
      select: { id: true },
    });
  }

  private async markLogProcessed(
    logId: string,
    processed: boolean,
    errorMessage: string | null,
  ): Promise<void> {
    await this.prisma.callbackLog.update({
      where: { id: logId },
      data: { processed, errorMessage },
    });
  }

  private toUtc8(d: Date | null): string {
    if (!d) return '';
    // 將 UTC 時間 +8 後格式化為 'YYYY-MM-DDTHH:mm:ss'
    const utc8 = new Date(d.getTime() + 8 * 60 * 60 * 1000);
    return utc8.toISOString().replace(/\.\d{3}Z$/, '').replace('T', 'T');
  }
}
