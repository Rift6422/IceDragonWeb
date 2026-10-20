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
    // 注意:hash 是否通過先記在 log,但不在這裡 early-return。
    // 成功(派發)路徑稍後嚴格要求 hash;失敗類 callback 因已被 IP/UA 白名單守住、
    // 又不觸發派發,即使 hash 沒過也照樣記錄 MyCard 回傳供顯示/稽核。

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

    // 4. 不論成功/失敗,先把 MyCard 這次回傳的原始內容存進 transaction.resultRawBody,
    //    供後台稽核 + 前端顯示 ReturnCode / ReturnMsg。
    await this.prisma.transaction
      .update({
        where: { orderId: order.id },
        data: { resultRawBody: payload as unknown as Prisma.InputJsonValue },
      })
      .catch((e) =>
        this.logger.warn(`存 resultRawBody 失敗(不擋流程): ${e instanceof Error ? e.message : e}`),
      );

    // 5. 只認 PayResult=3 為成功
    if (payload.PayResult !== '3') {
      const decodedMsg = this.decodeReturnMsg(payload.ReturnMsg);
      // 已是終態就不重複轉狀態。但若這次 callback 帶了真正的 ReturnMsg、而原本 failureReason
      // 還是空的(常見:先被 TradeQuery 探測判 FAILED(ReturnMsg=成功被防呆設 null),
      // 之後 trade-result callback 才到),就把 failureReason 補回去,讓前端顯示得到 ReturnMsg。
      if (order.status === OrderStatus.FAILED || order.status === OrderStatus.CANCELLED) {
        if (decodedMsg && !order.failureReason) {
          await this.prisma.order.update({
            where: { id: order.id },
            data: { failureReason: decodedMsg },
          });
          this.logger.log(`回填 failureReason for ${order.facTradeSeq}: ${decodedMsg}`);
        }
        await this.markLogProcessed(log.id, true, null);
        return { ok: true, processed: false };
      }
      // 已付款 / 已請款 / 已派發的單,不能被一筆「PayResult≠3」打翻(特別是 hash 沒過時)
      if (
        order.status === OrderStatus.PAID ||
        order.status === OrderStatus.CONFIRMED ||
        order.status === OrderStatus.DELIVERED
      ) {
        this.logger.warn(
          `TradeResult PayResult=${payload.PayResult} 但 ${order.facTradeSeq} 已是 ${order.status} → 忽略,不轉 FAILED`,
        );
        await this.markLogProcessed(log.id, true, 'PayResult!=3 but order already paid/delivered — ignored');
        return { ok: true, processed: false };
      }
      if (!hashValid) {
        this.logger.warn(
          `TradeResult hash invalid for ${payload.FacTradeSeq}(PayResult≠3)— 仍記錄失敗供顯示(來源已過 IP/UA 白名單)`,
        );
      }
      await this.prisma.transaction
        .update({ where: { orderId: order.id }, data: { payResult: 0 } })
        .catch(() => undefined);
      await this.state.transition({
        orderId: order.id,
        toStatus: OrderStatus.FAILED,
        triggeredBy: 'mycard_callback',
        reason: `PayResult=${payload.PayResult} ReturnCode=${payload.ReturnCode ?? ''} (${this.decodeReturnMsg(payload.ReturnMsg) ?? ''})`,
        metadata: payload as unknown as Prisma.InputJsonValue,
        // MyCard 規定:交易失敗要顯示其回傳的 ReturnMsg(URL-decode 後),存進 failureReason 給前端顯示
        extraOrderUpdate: { failureReason: this.decodeReturnMsg(payload.ReturnMsg) },
      });
      await this.markLogProcessed(log.id, true, null);
      return { ok: true, processed: true };
    }

    // 6. 成功(會觸發派發)路徑 — 嚴格要求 hash 必須正確
    if (!hashValid) {
      await this.markLogProcessed(log.id, false, 'Hash mismatch');
      this.logger.warn(`TradeResult callback hash invalid for ${payload.FacTradeSeq}`);
      return { ok: false, processed: false };
    }

    // 7. 防重複儲值 — 用 mycard_trade_no unique
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
    let probeTriggered = false;

    while (Date.now() < deadline) {
      const order = await this.prisma.order.findUnique({
        where: { facTradeSeq },
        select: { status: true },
      });
      pollCount++;

      if (!order) {
        this.logger.warn(`wait-and-join: order ${facTradeSeq} not found after ${pollCount} polls`);
        return `/?paid=${encoded}`;
      }

      const s = order.status;
      if (s === OrderStatus.DELIVERED) {
        this.logger.log(`wait-and-join: ${facTradeSeq} DELIVERED after ${pollCount} polls`);
        return `/?paid=${encoded}&result=success`;
      }
      if (s === OrderStatus.DELIVERY_FAILED) return `/?paid=${encoded}&result=delivery_failed`;
      if (s === OrderStatus.FAILED) return `/?paid=${encoded}&result=fail`;
      if (s === OrderStatus.CANCELLED) return `/?paid=${encoded}&result=cancelled`;

      // 第一次看到還在 AUTHED → 主動觸發 reprocessOne(等同 supplement 的單筆處理)
      // 原因:MyCard sandbox 不主動推 trade-result,只靠 supplement(間隔 ~20 分鐘)
      // 我們有 AuthCode 可以直接打 TradeQuery 確認真實狀態,不必等 MyCard supplement。
      // fire-and-forget(不 await)— 讓 reprocessOne 跟我們的 polling 平行跑,
      // 0.2 秒 poll 會撈到 reprocessOne 推進後的最新 status。
      if (!probeTriggered && pollCount === 1 && s === OrderStatus.AUTHED) {
        probeTriggered = true;
        this.logger.log(`wait-and-join: ${facTradeSeq} still AUTHED → trigger active reprocess (don't wait MyCard supplement)`);
        this.reprocessOne(facTradeSeq).catch((err) => {
          this.logger.error(`active reprocess failed for ${facTradeSeq}: ${err instanceof Error ? err.message : err}`);
        });
      }

      await new Promise((r) => setTimeout(r, 200));
    }

    this.logger.warn(
      `wait-and-join: ${facTradeSeq} timeout after ${pollCount} polls (${timeoutMs}ms),probe=${probeTriggered}`,
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
  async forceReprocess(
    facTradeSeq: string,
    opts: { force?: boolean } = {},
  ): Promise<{ ok: boolean; status: OrderStatus | null; message: string }> {
    const before = await this.prisma.order.findUnique({ where: { facTradeSeq } });
    if (!before) {
      return { ok: false, status: null, message: 'Order not found' };
    }

    try {
      // force=true 模式:已 DELIVERED 也要再呼叫一次派發(後台「強制重派」)
      // 走 dispatch 而非 reprocessOne,因為 reprocessOne 內 status=DELIVERED 會 return
      if (opts.force && before.status === OrderStatus.DELIVERED) {
        this.logger.warn(`forceReprocess: ${facTradeSeq} status=DELIVERED but force=true → re-dispatch`);
        await this.dispatch.tryDispatch(before.id, { force: true });
        const after = await this.prisma.order.findUnique({ where: { facTradeSeq } });
        return {
          ok: true,
          status: after?.status ?? before.status,
          message: `強制重派完成(status 維持 ${after?.status ?? before.status})`,
        };
      }

      // 已 CONFIRMED / DELIVERY_FAILED → 跳過 reprocessOne(會重打 PaymentConfirm 撞 MBP019)
      // 直接 tryDispatch 走派發;成功時 state machine 自動 transition → DELIVERED
      if (
        before.status === OrderStatus.CONFIRMED ||
        before.status === OrderStatus.DELIVERY_FAILED
      ) {
        this.logger.log(
          `forceReprocess: ${facTradeSeq} status=${before.status} → 直接 tryDispatch(跳過 TradeQuery + PaymentConfirm)`,
        );
        await this.dispatch.tryDispatch(before.id);
      } else {
        await this.reprocessOne(facTradeSeq);
      }
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
    if (order.status === OrderStatus.FAILED || order.status === OrderStatus.CANCELLED) return; // 已終態

    // TradeQuery
    const q = await this.mycard.tradeQuery(order.transaction.authCode, order.id);
    if (!q.ok) return; // 查詢本身失敗(網路 / API 錯)→ 不動,等下次

    // PayResult=0 為明確失敗(MyCard 文件:0 = 失敗,3 = 成功)
    // 觸發時機:玩家在 MyCard 取消、輸錯驗證碼(如測試 27889188)等
    // 我們應該把訂單轉 FAILED,讓前端 modal 即時顯示「✗ 付款未完成」
    if (q.data.PayResult === '0') {
      this.logger.log(
        `reprocessOne: ${facTradeSeq} TradeQuery PayResult=0 → FAILED (msg=${q.data.ReturnMsg ?? ''})`,
      );
      await this.prisma.transaction.update({
        where: { orderId: order.id },
        data: {
          payResult: 0,
          paymentType: q.data.PaymentType ?? order.transaction.paymentType,
          mycardTradeNo: q.data.MyCardTradeNo ?? order.transaction.mycardTradeNo,
          resultRawBody: q.data as unknown as Prisma.InputJsonValue,
        },
      });
      await this.state.transition({
        orderId: order.id,
        toStatus: OrderStatus.FAILED,
        triggeredBy: 'system',
        reason: `Active probe / supplement: TradeQuery PayResult=0 (${q.data.ReturnMsg ?? ''})`,
        metadata: { my_card_trade_no: q.data.MyCardTradeNo ?? null },
        // 注意:TradeQuery 的 ReturnCode/ReturnMsg 是「查詢動作」的狀態(1/成功),
        //       不是付款失敗原因(付款狀態看 PayResult)。所以這條路徑不寫 failureReason,
        //       留 null 讓前端回退制式文案。真正的拒絕訊息只在 trade-result callback 帶。
        //       明確設 null:擋掉 state machine 預設把內部 reason 寫進 failureReason。
        extraOrderUpdate: { failureReason: null },
      });
      return;
    }

    // 其他 PayResult(非 0 非 3)→ 還沒明確結果(可能玩家還在 MyCard 頁面)
    // 維持原狀,等下次 supplement 或 probe
    if (q.data.PayResult !== '3') return;

    // 成功路徑 — 更新 transaction
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

    // 回報「已付款成功(payResult=3)」的所有訂單。
    // 對智冠對帳而言,只要 MyCard 付款成功就是一筆儲值成功交易;派發(遊戲信件)是我方下游、
    // 不影響對帳。故不再限 status=DELIVERED,避免「已收款但派發卡住(DELIVERY_FAILED / 尚未
    // DELIVERED)」的單被漏報,造成智冠有、我方差異網址查無的漏單。
    const where: Prisma.OrderWhereInput = {
      transaction: { payResult: 3 },
    };

    if (query.MyCardTradeNo) {
      where.transaction = { mycardTradeNo: query.MyCardTradeNo };
    } else if (query.StartDateTime && query.EndDateTime) {
      const gte = this.parseTwBoundary(query.StartDateTime, 'start');
      const lte = this.parseTwBoundary(query.EndDateTime, 'end');
      if (gte && lte) {
        where.confirmedAt = { gte, lte };
      } else {
        this.logger.warn(
          `DIFF_REPORT 日期無法解析,略過日期過濾:StartDateTime=${query.StartDateTime} EndDateTime=${query.EndDateTime}`,
        );
      }
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

    // 同 handleDiffReport:回報所有已付款成功(payResult=3)的訂單,不限 status=DELIVERED,
    // 避免已收款但派發卡住的單被漏報。
    const where: Prisma.OrderWhereInput = {
      transaction: { payResult: 3 },
    };

    if (query.MyCardID) {
      where.transaction = { mycardTradeNo: query.MyCardID };
    } else if (query.StartDate && query.EndDate) {
      const gte = this.parseTwBoundary(query.StartDate, 'start');
      const lte = this.parseTwBoundary(query.EndDate, 'end');
      if (gte && lte) {
        where.confirmedAt = { gte, lte };
      } else {
        this.logger.warn(
          `TOPUP_RECORDS 日期無法解析,略過日期過濾:StartDate=${query.StartDate} EndDate=${query.EndDate}`,
        );
      }
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

  /**
   * MyCard 的 ReturnMsg 文件規定是 URL-encoded(見「交易失敗範例」:
   * `%e6%b8%ac...` → URL Decode → 「測試金流測試交易失敗的訊息」)。
   *
   * 還原成可顯示文字給玩家看:
   *   - 含 %XX → decodeURIComponent(form parser 沒幫忙時)
   *   - 已是純文字(parser 已 decode)→ 原樣回
   *   - 空 / decode 失敗 → 回 null(前端 fallback 顯示制式文案)
   */
  private decodeReturnMsg(raw?: string | null): string | null {
    if (!raw) return null;
    let s = String(raw).trim();
    if (!s) return null;
    if (/%[0-9A-Fa-f]{2}/.test(s)) {
      try {
        s = decodeURIComponent(s.replace(/\+/g, ' '));
      } catch {
        /* decode 失敗就用原字串 */
      }
    }
    // 防呆:失敗單上永遠不該顯示「成功」字樣(某些 API 的 ReturnMsg 帶的是
    // 動作狀態而非拒絕原因)→ 視為無意義,回 null 讓前端走制式文案。
    if (/^(成功|success|ok)$/i.test(s.trim())) return null;
    return s.trim();
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

  /**
   * MyCard 差異比對 / 廠商儲值紀錄查詢傳來的日期,都是「台灣時間 (UTC+8)」的日界。
   * 但 `confirmed_at` 存的是 UTC,直接 `new Date(raw)`(無時區)在 UTC 容器上會被當成
   * UTC → 整個對帳窗口平移 8 小時,台灣 00:00–08:00 成交的單被歸到前一天。
   * 這裡統一補上 `+08:00` 時區,轉成正確的 UTC 瞬間。
   *
   * 另外修掉 GET 版原本 `new Date("2026/08/01T23:59:59")` = Invalid Date 的 bug
   * (MyCard 文件日期格式是斜線),先把 `/` 正規化成 `-`。
   *
   * 支援兩種輸入:
   *   - 日期時間: `2026-08-01T00:00:00` / `2026-08-01 00:00:00`(POST diff-report)
   *   - 純日期:   `2026/08/01` / `2026-08-01`(GET 廠商查詢)
   *
   * @param raw   MyCard 傳來的字串
   * @param edge  'start' | 'end' — 純日期補整日邊界;end 且無毫秒時補到該秒尾 .999,
   *              避免 `23:59:59.001~.999` 落在兩個對帳窗的縫隙
   * @returns 對應 UTC 的 Date;無法解析回 null
   */
  private parseTwBoundary(raw: string, edge: 'start' | 'end'): Date | null {
    if (!raw) return null;
    let s = raw.trim().replace(/\//g, '-').replace(' ', 'T');
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      s += edge === 'start' ? 'T00:00:00.000' : 'T23:59:59.999';
    } else if (edge === 'end' && /T\d{2}:\d{2}:\d{2}$/.test(s)) {
      s += '.999';
    }
    const d = new Date(`${s}+08:00`);
    return isNaN(d.getTime()) ? null : d;
  }

  private toUtc8(d: Date | null): string {
    if (!d) return '';
    // 將 UTC 時間 +8 後格式化為 'YYYY-MM-DDTHH:mm:ss'
    const utc8 = new Date(d.getTime() + 8 * 60 * 60 * 1000);
    return utc8.toISOString().replace(/\.\d{3}Z$/, '').replace('T', 'T');
  }
}
