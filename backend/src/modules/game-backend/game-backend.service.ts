import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import {
  GameBackendEnvelope,
  GetStoreItemsArgs,
  ItemLimitation,
  RawStoreItem,
  StoreItem,
  mapPeriod,
} from './game-backend.types';

/**
 * 遊戲端 Azure Function client。
 *
 * 對接規格(2026-05-26 確認,欄位統一 camelCase):
 *   POST {BASE_URL}/api/getstoreitems?code={STOREITEMS_FUNCTION_CODE}
 *   body: { storeIds: string[], playerId, timeZone }   (timeZone = 毫秒,UTC+8 = 28800000)
 *   resp: { success: true, args: "<JSON-string>" }
 *   args 解開後:{ ownPremiums: string[], storeItems: { [storeId]: RawStoreItem[] } }
 *
 * 注意:舊 /api/getstorelimitations 已於 2026-05-26 從遊戲端下架,不再支援 v1 fallback。
 *
 * 設計:
 *   - 缺 env(BASE_URL / STOREITEMS_FUNCTION_CODE)→ 進 stub 模式回空,
 *     讓本地 dev / 沒對接的環境也能跑流程
 *   - 失敗回空 + log,**不 throw** — 主流程不能被遊戲端壞掉拖垮
 *   - 5 秒 timeout,避免拖死建單流程
 */
@Injectable()
export class GameBackendService implements OnModuleInit {
  private readonly logger = new Logger(GameBackendService.name);
  private http: AxiosInstance | null = null;
  private baseURL = '';
  private grantFunctionCode = '';
  private storeItemsFunctionCode = '';
  private couponFunctionCode = '';
  private lockFunctionCode = '';
  private unlockFunctionCode = '';
  private catalog = '';
  private stubMode = true;

  /** UTC+8 in milliseconds — 對齊台灣玩家視角的「今天」 */
  static readonly TAIPEI_TIMEZONE_MS = 8 * 60 * 60 * 1000;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const baseURL = this.config.get<string>('GAME_BACKEND_BASE_URL');
    const grantCode = this.config.get<string>('GAME_BACKEND_GRANT_FUNCTION_CODE');
    const storeItemsCode = this.config.get<string>('GAME_BACKEND_STOREITEMS_FUNCTION_CODE');
    const couponCode = this.config.get<string>('GAME_BACKEND_COUPON_FUNCTION_CODE');
    const lockCode = this.config.get<string>('GAME_BACKEND_LOCK_FUNCTION_CODE');
    const unlockCode = this.config.get<string>('GAME_BACKEND_UNLOCK_FUNCTION_CODE');
    const catalog = this.config.get<string>('GAME_BACKEND_CATALOG');
    const timeoutMs = Number(this.config.get<number>('GAME_BACKEND_TIMEOUT_MS', 5000));

    if (!baseURL) {
      this.logger.warn(
        '⚠️  GAME_BACKEND_BASE_URL 未設,進入 stub 模式(限購查詢回空,派發走 mock,序號兌換停用)',
      );
      return;
    }

    this.http = axios.create({
      baseURL,
      timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json' },
      validateStatus: () => true,
    });
    this.baseURL = baseURL;
    this.grantFunctionCode = grantCode ?? '';
    this.storeItemsFunctionCode = storeItemsCode ?? '';
    this.couponFunctionCode = couponCode ?? '';
    this.lockFunctionCode = lockCode ?? '';
    this.unlockFunctionCode = unlockCode ?? '';
    this.catalog = catalog ?? '';
    // storeItems code 沒設 → 商品/限購/驗證/派發仍走 stub,但 http 已可用(序號兌換等獨立功能照常)
    this.stubMode = !storeItemsCode;
    if (this.stubMode) {
      this.logger.warn(
        '⚠️  GAME_BACKEND_STOREITEMS_FUNCTION_CODE 未設 → 商品/限購/驗證/派發走 stub(序號兌換等其他功能仍可用)',
      );
    }
    this.logger.log(
      `GameBackend client ready (base=${baseURL}, store=${this.config.get('GAME_BACKEND_STORE_ID')}, catalog=${this.catalog || '(empty)'}, grant=${this.grantFunctionCode ? 'enabled' : 'disabled'}, lock=${this.lockFunctionCode ? 'enabled' : 'disabled'}, unlock=${this.unlockFunctionCode ? 'enabled' : 'disabled'})`,
    );
  }

  /** lock 流程是否完整啟用(check + lock + unlock 兩個 code 都要有) */
  isLockFlowEnabled(): boolean {
    return !this.stubMode && this.lockFunctionCode !== '' && this.unlockFunctionCode !== '';
  }

  /** 派發功能是否啟用(grant code 是否有設) */
  isGrantEnabled(): boolean {
    return !this.stubMode && this.grantFunctionCode !== '';
  }

  /**
   * 批次取多個 storeId 的「全部商品」+ 限購狀態(/api/getstoreitems)
   *
   *   1. 一次帶 storeIds[],一次 RTT 全部 store
   *   2. 列出「全部商品」(連無限購的也回 limitation=null)
   *   3. 多回 canDouble(該品項是否支援加倍)
   *
   * 失敗 / stub → 回空 map(不擋主流程)
   *
   * @param playerId  16 碼大寫 hex UID
   * @param storeIds  e.g. ['RMPacksStore', 'OrigemStore']
   * @returns         { storeItems: Map<storeId, StoreItem[]>, ownPremiums: string[] }
   */
  async getStoreItems(
    playerId: string,
    storeIds: string[],
  ): Promise<{ storeItems: Map<string, StoreItem[]>; ownPremiums: string[] }> {
    const empty = { storeItems: new Map<string, StoreItem[]>(), ownPremiums: [] };
    if (this.stubMode || !this.http) return empty;
    if (storeIds.length === 0) return empty;

    const start = Date.now();
    try {
      const response = await this.http.post<GameBackendEnvelope>(
        `/api/getstoreitems?code=${encodeURIComponent(this.storeItemsFunctionCode)}`,
        {
          storeIds,
          playerId,
          timeZone: GameBackendService.TAIPEI_TIMEZONE_MS,
        },
      );
      const elapsed = Date.now() - start;

      if (response.status !== 200 || !response.data?.success) {
        this.logger.warn(
          `GameBackend getStoreItems non-success (status=${response.status}, body=${JSON.stringify(response.data).slice(0, 200)}, ${elapsed}ms)`,
        );
        return empty;
      }

      const raw = this.safeParseArgs(response.data.args) as GetStoreItemsArgs | null;
      if (!raw || typeof raw !== 'object' || !raw.storeItems) {
        this.logger.warn(`GameBackend getStoreItems args shape unexpected (${elapsed}ms)`);
        return empty;
      }

      const map = new Map<string, StoreItem[]>();
      for (const [storeId, items] of Object.entries(raw.storeItems)) {
        if (!Array.isArray(items)) continue;
        map.set(
          storeId,
          items.map((r) => this.normalizeStoreItem(r)),
        );
      }
      return { storeItems: map, ownPremiums: raw.ownPremiums ?? [] };
    } catch (err) {
      const elapsed = Date.now() - start;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`GameBackend getStoreItems failed: ${msg} (${elapsed}ms)`);
      return empty;
    }
  }

  /**
   * 反向驗證 UID 是否存在於 PlayFab — 改走 /api/getstoreitems。
   *
   * 規則:
   *   - HTTP 200 + body.success = true  → UID 有效(PlayFab 找得到玩家)
   *   - HTTP 200 + body.success = false → UID 不存在(PlayFab 回 ResourceNotFound)
   *   - 其他(網路爆 / 4xx / 5xx)→ fail open(視為有效),避免遊戲端掛掉時封鎖所有玩家
   *   - Stub mode(沒對接)→ fail open
   */
  async validatePlayer(
    playerId: string,
    storeId?: string,
  ): Promise<{ valid: boolean; reason: 'OK' | 'NOT_FOUND' | 'BACKEND_DOWN' | 'STUB' }> {
    if (this.stubMode || !this.http) {
      return { valid: true, reason: 'STUB' };
    }

    const effectiveStoreId =
      storeId ?? this.config.get<string>('GAME_BACKEND_STORE_ID') ?? 'RMPacksStore';

    try {
      const response = await this.http.post<GameBackendEnvelope>(
        `/api/getstoreitems?code=${encodeURIComponent(this.storeItemsFunctionCode)}`,
        {
          storeIds: [effectiveStoreId],
          playerId,
          timeZone: GameBackendService.TAIPEI_TIMEZONE_MS,
        },
      );

      if (response.status !== 200) {
        this.logger.warn(`validatePlayer non-200 ${response.status} → fail open`);
        return { valid: true, reason: 'BACKEND_DOWN' };
      }

      if (response.data?.success === true) {
        return { valid: true, reason: 'OK' };
      }

      // success=false 才視為「UID 不存在」(配合 PlayFab ResourceNotFound)
      this.logger.log(`validatePlayer rejected for ${playerId}: ${JSON.stringify(response.data).slice(0, 200)}`);
      return { valid: false, reason: 'NOT_FOUND' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`validatePlayer network error: ${msg} → fail open`);
      return { valid: true, reason: 'BACKEND_DOWN' };
    }
  }

  /**
   * 派發 — 呼叫遊戲端 grantrmproduct。
   *
   * 已知問題(2026-05-23 確認):
   *   - 遊戲端目前無冪等,同 orderId 重打會重複扣 LeftQuantity(扣到 -1)
   *     → 依賴我方 deliveryAttempts 表的 SUCCESS 紀錄防重打
   *   - response 只回 { success: bool },無法區分 OK / DUPLICATE / 失敗原因
   *
   * 設計:
   *   - status != 200 → ok=false,讓 dispatch retry 機制接手
   *   - body.success=false → ok=false,進 retry(目前測試環境永遠回 true)
   *   - 失敗訊息盡量塞進 errorMessage 留 debug 線索
   *
   * @returns ok / responseStatus / responseBody / durationMs / errorMessage
   */
  async grantProduct(input: {
    orderId: string;
    storeId: string;
    itemId: string;
    /** 該商品的 catalog;傳 null/undefined 走 env 預設 */
    catalog?: string | null;
    playerId: string;
    priceTwd: number;
    language?: string;
  }): Promise<{
    ok: boolean;
    responseStatus: number | null;
    responseBody: string | null;
    errorMessage: string | null;
    durationMs: number;
  }> {
    const start = Date.now();

    if (!this.isGrantEnabled() || !this.http) {
      this.logger.warn(
        `grantProduct 走 stub 模式(GAME_BACKEND_GRANT_FUNCTION_CODE 未設)— order=${input.orderId}`,
      );
      return {
        ok: false,
        responseStatus: null,
        responseBody: null,
        errorMessage: 'GameBackend grant disabled (env not set)',
        durationMs: 0,
      };
    }

    const body = {
      orderId: input.orderId,
      timestamp: new Date().toISOString(),
      catalog: input.catalog || this.catalog,
      storeId: input.storeId,
      itemId: input.itemId,
      playerId: input.playerId,
      price: input.priceTwd,
      timeZone: GameBackendService.TAIPEI_TIMEZONE_MS,
      language: input.language ?? 'zh-TW',
    };
    this.logRequest('grantrmproduct', this.grantFunctionCode, body);

    try {
      const response = await this.http.post(
        `/api/grantrmproduct?code=${encodeURIComponent(this.grantFunctionCode)}`,
        body,
      );
      const elapsed = Date.now() - start;
      const respBody = response.data ? JSON.stringify(response.data) : null;
      this.logResponse('grantrmproduct', response.status, response.data, elapsed);

      if (response.status !== 200) {
        return {
          ok: false,
          responseStatus: response.status,
          responseBody: respBody,
          errorMessage: `non-200 status`,
          durationMs: elapsed,
        };
      }

      const success = response.data?.success === true;
      return {
        ok: success,
        responseStatus: response.status,
        responseBody: respBody,
        errorMessage: success ? null : `success=false from grantrmproduct`,
        durationMs: elapsed,
      };
    } catch (err) {
      const elapsed = Date.now() - start;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`grantProduct failed: ${msg} (${elapsed}ms)`);
      return {
        ok: false,
        responseStatus: null,
        responseBody: null,
        errorMessage: msg,
        durationMs: elapsed,
      };
    }
  }

  /**
   * 購買前檢查商品是否可購買(遊戲端鎖狀態查詢)。
   *
   * 對接 /api/getneworderavailable,payload 對齊 C# GetNewOrderAvailableRequest:
   *   { playerId, storeId, itemId, timeZone }
   *
   * 契約(2026-05-30 遊戲端確認):
   *   success:true + available:true  → 無鎖,可購(ok=true, locked=false)
   *   success:true + available:false → 鎖定中(ok=false, locked=true)
   *   success:false                  → 遊戲端訂單系統異常,擋下(ok=false, locked=false)
   *
   * 沒設 GAME_BACKEND_LOCK_FUNCTION_CODE → 跳過(回 ok=true)。
   * 傳輸層失敗(非 200 / 連線爆)→ fail open(回 ok=true):基礎設施抖動不該
   *   讓全站玩家都不能買;只有遊戲端「明確回 success:false」才 fail closed。
   *
   * @returns ok      可不可購
   *          locked  true=被鎖(可進「解自己的鎖」判斷)/ false=可購或系統異常
   */
  async checkOrderAvailable(input: {
    playerId: string;
    storeId: string;
    itemId: string;
  }): Promise<{ ok: boolean; locked: boolean; errorMessage: string | null; durationMs: number }> {
    const start = Date.now();

    if (!this.http || !this.lockFunctionCode) {
      return { ok: true, locked: false, errorMessage: null, durationMs: 0 };
    }

    const body = {
      playerId: input.playerId,
      storeId: input.storeId,
      itemId: input.itemId,
      timeZone: GameBackendService.TAIPEI_TIMEZONE_MS,
    };
    this.logRequest('getneworderavailable', this.lockFunctionCode, body);

    try {
      const response = await this.http.post<GameBackendEnvelope>(
        `/api/getneworderavailable?code=${encodeURIComponent(this.lockFunctionCode)}`,
        body,
      );
      const elapsed = Date.now() - start;
      this.logResponse('getneworderavailable', response.status, response.data, elapsed);

      if (response.status !== 200) {
        this.logger.warn(`checkOrderAvailable non-200 status=${response.status} → fail open (${elapsed}ms)`);
        return { ok: true, locked: false, errorMessage: null, durationMs: elapsed };
      }

      if (response.data?.success === true) {
        // success:true → 看 available 判斷有沒有鎖
        if (response.data?.available === false) {
          this.logger.warn(
            `[game-backend] getneworderavailable itemId=${input.itemId} → 鎖定中(available=false) (${elapsed}ms)`,
          );
          return { ok: false, locked: true, errorMessage: '此商品正在處理中,請稍後再試', durationMs: elapsed };
        }
        this.logger.log(
          `[game-backend] getneworderavailable itemId=${input.itemId} → 可購(available=true) (${elapsed}ms)`,
        );
        return { ok: true, locked: false, errorMessage: null, durationMs: elapsed };
      }

      // success:false → 遊戲端訂單系統異常,擋下(非「鎖定」)
      const errStr = response.data?.error ?? response.data?.errorMessage ?? '';
      this.logger.error(
        `checkOrderAvailable 遊戲端系統異常 playerId=${input.playerId} itemId=${input.itemId} err=${errStr.slice(0, 120)} (${elapsed}ms)`,
      );
      return {
        ok: false,
        locked: false,
        errorMessage: '遊戲端確認訂單系統異常,請稍後再試',
        durationMs: elapsed,
      };
    } catch (err) {
      const elapsed = Date.now() - start;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`checkOrderAvailable failed: ${msg} (${elapsed}ms) → fail open`);
      return { ok: true, locked: false, errorMessage: null, durationMs: elapsed };
    }
  }

  /**
   * 更新訂單鎖狀態。對接 /api/updateorderstatus,payload 對齊 C# UpdateOrderStatusRequest:
   *   { orderId, playerId, action: 'Lock' | 'Unlock' }
   *
   * 觸發時機:
   *   - 建單後 PENDING(action='Lock')
   *   - 終態 DELIVERED / FAILED / CANCELLED(action='Unlock')
   *   - DELIVERY_FAILED 不 unlock,等人工介入
   *
   * ⚠ 目前遊戲端 API 對 Lock 回 success:false + ResourceNotFound 但 record 有寫入,
   *   Unlock 一律回 success:true。我們把 ResourceNotFound 視為 OK(fail-soft)。
   *
   * Best-effort:失敗只 log 不擋主流程(已收錢的訂單不能因 unlock 失敗回滾)。
   */
  async updateOrderStatus(input: {
    orderId: string;
    playerId: string;
    action: 'Lock' | 'Unlock';
  }): Promise<{ ok: boolean; durationMs: number }> {
    const start = Date.now();

    if (this.stubMode || !this.http || !this.unlockFunctionCode) {
      return { ok: true, durationMs: 0 };
    }

    const body = {
      orderId: input.orderId,
      playerId: input.playerId,
      action: input.action,
    };
    this.logRequest('updateorderstatus', this.unlockFunctionCode, body);

    try {
      const response = await this.http.post<GameBackendEnvelope>(
        `/api/updateorderstatus?code=${encodeURIComponent(this.unlockFunctionCode)}`,
        body,
      );
      const elapsed = Date.now() - start;
      this.logResponse('updateorderstatus', response.status, response.data, elapsed);

      if (response.status !== 200) {
        this.logger.warn(
          `updateOrderStatus(${input.action}) non-200 order=${input.orderId} status=${response.status} (${elapsed}ms)`,
        );
        return { ok: false, durationMs: elapsed };
      }

      if (response.data?.success === true) {
        this.logger.log(
          `[game-backend] updateOrderStatus(${input.action}) order=${input.orderId} → success (${elapsed}ms)`,
        );
        return { ok: true, durationMs: elapsed };
      }

      const errStr = response.data?.error ?? '';
      if (errStr.includes('ResourceNotFound')) {
        // 已知遊戲端行為:Lock 首次 / Unlock 已不存在 都回這個 → 視為 OK
        this.logger.log(
          `[game-backend] updateOrderStatus(${input.action}) order=${input.orderId} → ResourceNotFound(視為OK) (${elapsed}ms)`,
        );
        return { ok: true, durationMs: elapsed };
      }

      this.logger.warn(
        `updateOrderStatus(${input.action}) rejected order=${input.orderId} err=${errStr.slice(0, 100)} (${elapsed}ms)`,
      );
      return { ok: false, durationMs: elapsed };
    } catch (err) {
      const elapsed = Date.now() - start;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`updateOrderStatus(${input.action}) failed: ${msg} (${elapsed}ms)`);
      return { ok: false, durationMs: elapsed };
    }
  }

  /** 序號兌換是否啟用(獨立於 storeItems stub:只要有 http + coupon code 就行) */
  isCouponRedeemEnabled(): boolean {
    return !!this.http && this.couponFunctionCode !== '';
  }

  /**
   * 序號兌換 — 呼叫遊戲端 /api/redeemmycoupon。
   *
   * 對接 C# RedeemMyCouponRequest:{ playerId, couponCode }
   *
   * 設計:
   *   - 未設 GAME_BACKEND_COUPON_FUNCTION_CODE / stub → 回友善訊息(不 throw)
   *   - 一律把遊戲端回傳的訊息原樣帶回前端顯示(成功 / 失敗都顯示)
   *   - 回應 shape 不確定 → extractCouponMessage 盡量挖出文字訊息
   *
   * @returns success / message(給玩家看的文字)
   */
  async redeemCoupon(
    playerId: string,
    couponCode: string,
  ): Promise<{ success: boolean; message: string }> {
    if (!this.isCouponRedeemEnabled() || !this.http) {
      this.logger.warn('redeemCoupon 走 stub(GAME_BACKEND_COUPON_FUNCTION_CODE 未設)');
      return { success: false, message: '序號兌換功能尚未開通,請稍後再試' };
    }

    const start = Date.now();
    const body = { playerId, couponCode };
    this.logRequest('redeemmycoupon', this.couponFunctionCode, body);

    try {
      const response = await this.http.post(
        `/api/redeemmycoupon?code=${encodeURIComponent(this.couponFunctionCode)}`,
        body,
      );
      const elapsed = Date.now() - start;
      this.logResponse('redeemmycoupon', response.status, response.data, elapsed);

      const data = response.data as Record<string, unknown> | string | null;
      const message = this.extractCouponMessage(data);

      if (response.status !== 200) {
        return { success: false, message: message || '兌換失敗,請稍後再試' };
      }

      const success =
        typeof data === 'object' && data !== null
          ? data.success === true || data.Success === true
          : false;
      return { success, message: message || (success ? '兌換成功' : '兌換失敗') };
    } catch (err) {
      const elapsed = Date.now() - start;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`redeemCoupon failed: ${msg} (${elapsed}ms)`);
      return { success: false, message: '兌換服務連線失敗,請稍後再試' };
    }
  }

  /**
   * 從遊戲端回應裡盡量挖出「給玩家看的訊息」。
   * 支援直接欄位(message/messages/Message/msg/error)、純文字、{ args } envelope。
   */
  private extractCouponMessage(data: Record<string, unknown> | string | null): string {
    if (data == null) return '';
    if (typeof data === 'string') return data.trim();

    const direct =
      data.message ?? data.messages ?? data.Message ?? data.msg ?? data.error ?? data.Error;
    if (typeof direct === 'string' && direct.trim()) return direct.trim();

    if (typeof data.args === 'string' && data.args.trim()) {
      const parsed = this.safeParseArgs(data.args);
      if (parsed && typeof parsed === 'object') {
        const inner = (parsed as Record<string, unknown>).message ??
          (parsed as Record<string, unknown>).messages ??
          (parsed as Record<string, unknown>).Message;
        if (typeof inner === 'string' && inner.trim()) return inner.trim();
      }
      return data.args.trim();
    }
    return '';
  }

  /** Azure Function code 是金鑰 → log 只留頭 4 尾 4,中間遮掉 */
  private maskCode(code: string): string {
    if (!code) return '(none)';
    if (code.length <= 8) return '****';
    return `${code.slice(0, 4)}…${code.slice(-4)}`;
  }

  /** 印出對遊戲端的完整 request(URL code 遮蔽;body 獨立一行方便整段複製貼給遊戲端)*/
  private logRequest(fn: string, code: string, body: unknown): void {
    this.logger.log(`[game-backend] → POST ${this.baseURL}/api/${fn}?code=${this.maskCode(code)}`);
    this.logger.log(`[game-backend] ↑ ${fn} request body(可直接複製)= ${JSON.stringify(body)}`);
  }

  /** 印出遊戲端的完整 response(HTTP status;body 獨立一行方便複製)*/
  private logResponse(fn: string, status: number, data: unknown, elapsed: number): void {
    this.logger.log(`[game-backend] ← ${fn} HTTP ${status} (${elapsed}ms)`);
    this.logger.log(`[game-backend] ↓ ${fn} response body(可直接複製)= ${JSON.stringify(data)}`);
  }

  private safeParseArgs(args: string): unknown {
    try {
      return JSON.parse(args);
    } catch {
      this.logger.warn(`GameBackend args JSON.parse failed: ${args.slice(0, 100)}`);
      return null;
    }
  }

  private normalizeStoreItem(raw: RawStoreItem): StoreItem {
    let limitation: ItemLimitation | null = null;
    if (raw.limitation) {
      const left = raw.limitation.LeftQuantity;
      limitation = {
        store_id: raw.storeId,
        item_id: raw.itemId,
        limit_period: mapPeriod(raw.limitation.LimitPeriod),
        max_quantity: raw.limitation.MaxQuantity,
        left_quantity: left < 0 ? 0 : left,
        reset_at: raw.limitation.ResetLimitDate,
      };
    }
    return {
      store_id: raw.storeId,
      item_id: raw.itemId,
      limitation,
      can_double: !!raw.canDouble,
    };
  }

}
