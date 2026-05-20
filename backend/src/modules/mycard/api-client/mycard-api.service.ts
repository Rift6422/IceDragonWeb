import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance, AxiosResponse } from 'axios';
import { randomUUID } from 'crypto';
import { CallbackKind, CallbackDirection, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MyCardHashService } from '../hash/mycard-hash.service';
import type {
  AuthGlobalRequest,
  AuthGlobalResponse,
  MyCardCallResult,
  PaymentConfirmRequest,
  PaymentConfirmResponse,
  TradeQueryRequest,
  TradeQueryResponse,
} from './mycard-api.types';

/**
 * MyCard 對外 API client(v3.9 §3.1 / §3.3 / §3.4)
 *
 * 特性:
 *   - 自動掛 Hash(MyCardHashService)
 *   - 自動寫 callback_logs(direction=OUTBOUND)
 *   - Timeout 10s(MyCard 文件未強制,但避免被 hang 死)
 *   - Mock mode:沒 MyCard 帳號時回 stub 資料,本地完整流程可跑
 */
@Injectable()
export class MyCardApiService implements OnModuleInit {
  private readonly logger = new Logger(MyCardApiService.name);
  private http!: AxiosInstance;
  private hash!: MyCardHashService;
  private mockMode = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.mockMode = this.config.get<string>('MYCARD_MOCK_MODE') === 'true';
    const isSandbox = this.config.get<string>('MYCARD_SANDBOX_MODE') === 'true';
    const baseURL = isSandbox
      ? this.config.get<string>('MYCARD_API_BASE_TEST', 'https://testb2b.mycard520.com.tw/MyBillingPay/v1.6')
      : this.config.get<string>('MYCARD_API_BASE_PROD', 'https://b2b.mycard520.com.tw/MyBillingPay/v1.6');

    this.http = axios.create({
      baseURL,
      timeout: 10_000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      validateStatus: () => true, // 自己處理 status
    });

    // Hash service 構造(只在非 mock 時要有 key)
    const key = this.config.get<string>('MYCARD_HASH_KEY');
    if (this.mockMode) {
      this.logger.warn(
        `⚠️  MyCard MOCK MODE 啟用 — API 呼叫回 stub 資料,不會真打 MyCard。正式環境必設 MYCARD_MOCK_MODE=false`,
      );
      // mock 也用 dummy key,避免 throw
      this.hash = new MyCardHashService(key && /^[0-9a-zA-Z]+$/.test(key) ? key : 'mockkey1234');
    } else {
      if (!key) throw new Error('MYCARD_HASH_KEY 必填(正式模式)');
      const facServiceId = this.config.get<string>('MYCARD_FAC_SERVICE_ID');
      if (!facServiceId) throw new Error('MYCARD_FAC_SERVICE_ID 必填(正式模式)');
      this.hash = new MyCardHashService(key);
      this.logger.log(`MyCard API client ready (base=${baseURL}, sandbox=${isSandbox})`);
    }
  }

  // ============================================================
  // 3.1 AuthGlobal
  // ============================================================

  async authGlobal(params: {
    facTradeSeq: string;
    customerId: string;
    productName: string;
    amount: string;
    paymentType?: string;
    itemCode?: string;
    serverId?: string;
    currency?: string;
    facReturnURL?: string;
    orderId?: string;
  }): Promise<MyCardCallResult<AuthGlobalResponse>> {
    const facServiceId = this.config.get<string>('MYCARD_FAC_SERVICE_ID', 'mockservice');
    const facGameId = this.config.get<string>('MYCARD_FAC_GAME_ID', 'icedragon');
    const facGameName = this.config.get<string>('MYCARD_FAC_GAME_NAME', 'icedragon');
    const sandBoxMode = this.config.get<string>('MYCARD_SANDBOX_MODE', 'true');

    const body: AuthGlobalRequest = {
      FacServiceId: facServiceId,
      FacTradeSeq: params.facTradeSeq,
      FacGameId: facGameId,
      FacGameName: facGameName,
      TradeType: '2',
      ServerId: params.serverId ?? '',
      CustomerId: params.customerId,
      PaymentType: params.paymentType ?? '',
      ItemCode: params.itemCode ?? '',
      ProductName: params.productName,
      Amount: params.amount,
      Currency: params.currency ?? 'TWD',
      SandBoxMode: sandBoxMode,
      FacReturnURL: params.facReturnURL ?? '',
      Hash: this.hash.forAuthGlobal({
        facServiceId,
        facTradeSeq: params.facTradeSeq,
        facGameId,
        facGameName,
        tradeType: '2',
        serverId: params.serverId ?? '',
        customerId: params.customerId,
        paymentType: params.paymentType ?? '',
        itemCode: params.itemCode ?? '',
        productName: params.productName,
        amount: params.amount,
        currency: params.currency ?? 'TWD',
        sandBoxMode,
        facReturnURL: params.facReturnURL ?? '',
      }),
    };

    if (this.mockMode) {
      return this.mockResponse(CallbackKind.AUTH_GLOBAL, body, params.orderId, () => ({
        ReturnCode: '1',
        ReturnMsg: 'MOCK: 授權成功',
        AuthCode: `MOCK_AUTH_${randomUUID().replace(/-/g, '').toUpperCase()}`,
        TradeSeq: `MOCK_TS_${Date.now()}`,
        InGameSaveType: '2',
        TransactionUrl: `https://test.mycard520.com.tw/MyCardPay/?AuthCode=MOCK_${randomUUID().slice(0, 8)}`,
      }));
    }

    return this.callMyCard<AuthGlobalRequest, AuthGlobalResponse>(
      '/AuthGlobal',
      body,
      CallbackKind.AUTH_GLOBAL,
      params.orderId,
    );
  }

  // ============================================================
  // 3.3 TradeQuery
  // ============================================================

  async tradeQuery(authCode: string, orderId?: string): Promise<MyCardCallResult<TradeQueryResponse>> {
    const body: TradeQueryRequest = { AuthCode: authCode };

    if (this.mockMode) {
      return this.mockResponse(CallbackKind.TRADE_QUERY, body, orderId, () => ({
        ReturnCode: '1',
        ReturnMsg: 'MOCK: 查詢成功',
        PayResult: '3',
        FacTradeSeq: 'MOCK_FTS',
        PaymentType: 'INGAME',
        Amount: '150',
        Currency: 'TWD',
        MyCardTradeNo: `MOCK_MCTN_${Date.now()}`,
        MyCardType: '1',
        PromoCode: '',
      }));
    }

    return this.callMyCard<TradeQueryRequest, TradeQueryResponse>(
      '/TradeQuery',
      body,
      CallbackKind.TRADE_QUERY,
      orderId,
    );
  }

  // ============================================================
  // 3.4 PaymentConfirm
  // ============================================================

  async paymentConfirm(
    authCode: string,
    orderId?: string,
  ): Promise<MyCardCallResult<PaymentConfirmResponse>> {
    const body: PaymentConfirmRequest = { AuthCode: authCode };

    if (this.mockMode) {
      return this.mockResponse(CallbackKind.PAYMENT_CONFIRM, body, orderId, () => ({
        ReturnCode: '1',
        ReturnMsg: 'MOCK: 請款成功',
        FacTradeSeq: 'MOCK_FTS',
        TradeSeq: `MOCK_TS_${Date.now()}`,
      }));
    }

    return this.callMyCard<PaymentConfirmRequest, PaymentConfirmResponse>(
      '/PaymentConfirm',
      body,
      CallbackKind.PAYMENT_CONFIRM,
      orderId,
    );
  }

  // ============================================================
  // 共用底層
  // ============================================================

  private async callMyCard<TReq extends object, TResp>(
    path: string,
    body: TReq,
    kind: CallbackKind,
    orderId?: string,
  ): Promise<MyCardCallResult<TResp>> {
    const start = Date.now();
    const formBody = new URLSearchParams(
      Object.entries(body as Record<string, unknown>).reduce<Record<string, string>>((acc, [k, v]) => {
        acc[k] = v == null ? '' : String(v);
        return acc;
      }, {}),
    ).toString();

    let response: AxiosResponse<TResp> | null = null;
    let errorMessage: string | null = null;
    try {
      response = await this.http.post<TResp>(path, formBody);
    } catch (err) {
      const ae = err as AxiosError;
      errorMessage = ae.message;
      this.logger.error(`MyCard ${path} failed: ${ae.message}`);
    }
    const durationMs = Date.now() - start;

    const data = (response?.data ?? {}) as TResp & {
      ReturnCode?: string;
      ReturnMsg?: string;
    };
    const returnCode = data.ReturnCode ?? 'NETWORK_ERROR';
    const returnMsg = data.ReturnMsg ?? errorMessage ?? '';
    const ok = returnCode === '1';

    // 寫 callback_logs(失敗不應 throw,以免主流程壞掉)
    const callbackLogId = await this.writeOutboundLog({
      kind,
      orderId,
      url: `${this.http.defaults.baseURL}${path}`,
      requestBody: formBody,
      responseStatus: response?.status ?? null,
      responseBody: response ? JSON.stringify(data) : null,
      errorMessage,
      durationMs,
      processed: true,
    });

    return { ok, returnCode, returnMsg, data, durationMs, callbackLogId };
  }

  private async mockResponse<TResp>(
    kind: CallbackKind,
    body: object,
    orderId: string | undefined,
    build: () => TResp,
  ): Promise<MyCardCallResult<TResp>> {
    // 模擬 50-150ms 延遲
    await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));
    const data = build() as TResp & { ReturnCode: string; ReturnMsg: string };
    const callbackLogId = await this.writeOutboundLog({
      kind,
      orderId,
      url: `MOCK_${kind}`,
      requestBody: JSON.stringify(body),
      responseStatus: 200,
      responseBody: JSON.stringify(data),
      errorMessage: null,
      durationMs: 100,
      processed: true,
    });
    return {
      ok: data.ReturnCode === '1',
      returnCode: data.ReturnCode,
      returnMsg: data.ReturnMsg,
      data,
      durationMs: 100,
      callbackLogId,
    };
  }

  private async writeOutboundLog(input: {
    kind: CallbackKind;
    orderId: string | undefined;
    url: string;
    requestBody: string;
    responseStatus: number | null;
    responseBody: string | null;
    errorMessage: string | null;
    durationMs: number;
    processed: boolean;
  }): Promise<string> {
    try {
      const log = await this.prisma.callbackLog.create({
        data: {
          direction: CallbackDirection.OUTBOUND,
          kind: input.kind,
          orderId: input.orderId ?? null,
          httpMethod: 'POST',
          url: input.url,
          requestHeaders: { 'Content-Type': 'application/x-www-form-urlencoded' } as Prisma.InputJsonValue,
          requestBody: input.requestBody,
          responseStatus: input.responseStatus,
          responseBody: input.responseBody,
          processed: input.processed,
          errorMessage: input.errorMessage,
          durationMs: input.durationMs,
        },
        select: { id: true },
      });
      return log.id;
    } catch (err) {
      this.logger.error('Failed to write outbound callback log', err);
      return 'log-write-failed';
    }
  }
}
