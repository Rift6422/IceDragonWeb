import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import {
  GameBackendEnvelope,
  ItemLimitation,
  RawStoreItemLimitation,
  mapPeriod,
} from './game-backend.types';

/**
 * 遊戲端 Azure Function client。
 *
 * 對接規格(2026-05-22 確認):
 *   POST {BASE_URL}/api/getstorelimitations?code={FUNCTION_CODE}
 *   body: { storeID, playerID, timeZone }     (timeZone = 毫秒,如 UTC+8 = 28800000)
 *   resp: { success: true, args: "<JSON-string>" }
 *
 * 設計:
 *   - 缺 env(BASE_URL / FUNCTION_CODE)→ 進 stub 模式回 []
 *     讓本地 dev / 沒對接的環境也能跑流程
 *   - 失敗回 [] + log,**不 throw** — 主流程不能被遊戲端壞掉拖垮
 *   - 5 秒 timeout,避免拖死建單流程
 */
@Injectable()
export class GameBackendService implements OnModuleInit {
  private readonly logger = new Logger(GameBackendService.name);
  private http: AxiosInstance | null = null;
  private functionCode = '';
  private grantFunctionCode = '';
  private stubMode = true;

  /** UTC+8 in milliseconds — 對齊台灣玩家視角的「今天」 */
  static readonly TAIPEI_TIMEZONE_MS = 8 * 60 * 60 * 1000;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const baseURL = this.config.get<string>('GAME_BACKEND_BASE_URL');
    const code = this.config.get<string>('GAME_BACKEND_FUNCTION_CODE');
    const grantCode = this.config.get<string>('GAME_BACKEND_GRANT_FUNCTION_CODE');
    const timeoutMs = Number(this.config.get<number>('GAME_BACKEND_TIMEOUT_MS', 5000));

    if (!baseURL || !code) {
      this.logger.warn(
        '⚠️  GAME_BACKEND_BASE_URL / GAME_BACKEND_FUNCTION_CODE 未設,進入 stub 模式(限購查詢回空陣列,派發走 mock)',
      );
      return;
    }

    this.http = axios.create({
      baseURL,
      timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json' },
      validateStatus: () => true,
    });
    this.functionCode = code;
    this.grantFunctionCode = grantCode ?? '';
    this.stubMode = false;
    this.logger.log(
      `GameBackend client ready (base=${baseURL}, store=${this.config.get('GAME_BACKEND_STORE_ID')}, grant=${this.grantFunctionCode ? 'enabled' : 'disabled'})`,
    );
  }

  /** 派發功能是否啟用(grant code 是否有設) */
  isGrantEnabled(): boolean {
    return !this.stubMode && this.grantFunctionCode !== '';
  }

  /**
   * 取得指定 storeID 對某玩家的全部商品限購狀況。
   *
   * @param playerID  16 碼大寫 hex UID
   * @param storeID   覆寫預設 GAME_BACKEND_STORE_ID(可選)
   * @returns         空陣列 = 沒對接 / 失敗 / 該 store 沒商品
   */
  async getStoreLimitations(playerID: string, storeID?: string): Promise<ItemLimitation[]> {
    if (this.stubMode || !this.http) return [];

    const effectiveStoreID = storeID ?? this.config.get<string>('GAME_BACKEND_STORE_ID');
    if (!effectiveStoreID) {
      this.logger.warn('GAME_BACKEND_STORE_ID 未設,跳過限購查詢');
      return [];
    }

    const start = Date.now();
    try {
      const response = await this.http.post<GameBackendEnvelope>(
        `/api/getstorelimitations?code=${encodeURIComponent(this.functionCode)}`,
        {
          storeID: effectiveStoreID,
          playerID,
          timeZone: GameBackendService.TAIPEI_TIMEZONE_MS,
        },
      );
      const elapsed = Date.now() - start;

      if (response.status !== 200 || !response.data?.success) {
        this.logger.warn(
          `GameBackend getStoreLimitations non-success (status=${response.status}, body=${JSON.stringify(response.data).slice(0, 200)}, ${elapsed}ms)`,
        );
        return [];
      }

      const raw = this.safeParseArgs(response.data.args);
      if (!Array.isArray(raw)) {
        this.logger.warn(`GameBackend args is not array (${elapsed}ms)`);
        return [];
      }

      return raw.map((r) => this.normalize(r));
    } catch (err) {
      const elapsed = Date.now() - start;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`GameBackend getStoreLimitations failed: ${msg} (${elapsed}ms)`);
      return [];
    }
  }

  /**
   * 用 GetStoreLimitations 反向驗證 UID 是否存在於 PlayFab。
   *
   * 規則:
   *   - HTTP 200 + body.success = true  → UID 有效(PlayFab 找得到玩家)
   *   - HTTP 200 + body.success = false → UID 不存在(PlayFab 回 ResourceNotFound)
   *   - 其他(網路爆 / 4xx / 5xx)→ fail open(視為有效),避免遊戲端掛掉時封鎖所有玩家
   *   - Stub mode(沒對接)→ fail open
   *
   * 失敗原因會用 reason 標出,給呼叫方判斷該怎麼回應。
   */
  async validatePlayer(
    playerID: string,
    storeID?: string,
  ): Promise<{ valid: boolean; reason: 'OK' | 'NOT_FOUND' | 'BACKEND_DOWN' | 'STUB' }> {
    if (this.stubMode || !this.http) {
      return { valid: true, reason: 'STUB' };
    }

    const effectiveStoreID =
      storeID ?? this.config.get<string>('GAME_BACKEND_STORE_ID') ?? 'RMPacksStore';

    try {
      const response = await this.http.post<GameBackendEnvelope>(
        `/api/getstorelimitations?code=${encodeURIComponent(this.functionCode)}`,
        {
          storeID: effectiveStoreID,
          playerID,
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
      this.logger.log(`validatePlayer rejected for ${playerID}: ${JSON.stringify(response.data).slice(0, 200)}`);
      return { valid: false, reason: 'NOT_FOUND' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`validatePlayer network error: ${msg} → fail open`);
      return { valid: true, reason: 'BACKEND_DOWN' };
    }
  }

  /**
   * 查單一商品的限購狀態 — 給建單前 pre-check 用。
   *
   * @returns null = 找不到該 itemID(代表沒限購 / 不在這 store)→ 視為「允許」
   */
  async getItemLimitation(
    playerID: string,
    itemID: string,
    storeID?: string,
  ): Promise<ItemLimitation | null> {
    const all = await this.getStoreLimitations(playerID, storeID);
    return all.find((x) => x.item_id === itemID) ?? null;
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
    storeID: string;
    itemID: string;
    playerID: string;
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
      storeID: input.storeID,
      itemID: input.itemID,
      playerID: input.playerID,
      price: input.priceTwd,
      timeZone: GameBackendService.TAIPEI_TIMEZONE_MS,
      language: input.language ?? 'zh-TW',
    };

    try {
      const response = await this.http.post(
        `/api/grantrmproduct?code=${encodeURIComponent(this.grantFunctionCode)}`,
        body,
      );
      const elapsed = Date.now() - start;
      const respBody = response.data ? JSON.stringify(response.data) : null;

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

  private safeParseArgs(args: string): unknown {
    try {
      return JSON.parse(args);
    } catch {
      this.logger.warn(`GameBackend args JSON.parse failed: ${args.slice(0, 100)}`);
      return null;
    }
  }

  private normalize(raw: RawStoreItemLimitation): ItemLimitation {
    // left_quantity 統一夾到下限 0 — 遊戲端目前無冪等,重派時 LeftQuantity 可能變負數,
    // 但對玩家 / 後台來說「-1 剩餘」沒意義,顯示「0 剩餘 = 已售完」較直觀。
    // 不影響業務判斷:我方 pre-check 用 `<= 0` 擋,負數本來就會被擋。
    const left = raw.limitation.LeftQuantity;
    return {
      store_id: raw.storeID,
      item_id: raw.itemID,
      limit_period: mapPeriod(raw.limitation.LimitPeriod),
      max_quantity: raw.limitation.MaxQuantity,
      left_quantity: left < 0 ? 0 : left,
      reset_at: raw.limitation.ResetLimitDate,
    };
  }
}
