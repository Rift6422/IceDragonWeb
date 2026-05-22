import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { GameBackendService } from '../game-backend/game-backend.service';
import type { DispatchInput, DispatchResult, MailDispatcher } from './mail-dispatcher.interface';

/**
 * 真實 dispatcher — 呼叫遊戲端 grantrmproduct。
 *
 * 路徑:
 *   1. order 有 playfabItemId + 環境變數齊全 → 打 grantrmproduct
 *   2. 沒 playfabItemId(例:散買啟源石不在 PlayFab store)→ 走 mock-like 成功
 *      (還沒有別的派發渠道,先當 DELIVERED 處理避免訂單卡住)
 *   3. 環境變數沒設 → 走 mock-like(同上)
 *
 * 注意:
 *   - 遊戲端 grantrmproduct 目前無冪等,**重打會多扣**
 *     → DispatchService 用 deliveryAttempts(status=SUCCESS)守第一層
 *   - 遊戲端 response 只有 `{success: bool}`,無法區分原因,失敗一律進 retry
 */
@Injectable()
export class GameBackendMailDispatcher implements MailDispatcher {
  private readonly logger = new Logger(GameBackendMailDispatcher.name);

  constructor(
    private readonly gameBackend: GameBackendService,
    private readonly config: ConfigService,
  ) {}

  async dispatch(input: DispatchInput): Promise<DispatchResult> {
    // 沒對應到 PlayFab itemId → 沒有可派發的渠道,fallback 為 mock success
    // (例如散買啟源石未進 RMPacksStore;之後若加 DiamondStore 再走真實派發)
    if (!input.playfabItemId) {
      const mockMailId = `MOCK_${randomUUID().slice(0, 8).toUpperCase()}`;
      this.logger.log(
        `[mock] order=${input.facTradeSeq} 無 playfabItemId,標記成功 mail=${mockMailId}`,
      );
      return {
        ok: true,
        mailId: mockMailId,
        responseStatus: 200,
        responseBody: JSON.stringify({ mock_reason: 'no_playfab_item_id', mail_id: mockMailId }),
        durationMs: 0,
      };
    }

    // grant 功能未啟用 → fallback mock(讓本地 / 未對接環境照樣跑完訂單流程)
    if (!this.gameBackend.isGrantEnabled()) {
      const mockMailId = `MOCK_${randomUUID().slice(0, 8).toUpperCase()}`;
      this.logger.warn(
        `[mock] grant 功能未啟用,order=${input.facTradeSeq} 標記成功 mail=${mockMailId}`,
      );
      return {
        ok: true,
        mailId: mockMailId,
        responseStatus: 200,
        responseBody: JSON.stringify({ mock_reason: 'grant_disabled', mail_id: mockMailId }),
        durationMs: 0,
      };
    }

    const storeID =
      input.playfabStoreId ??
      this.config.get<string>('GAME_BACKEND_STORE_ID') ??
      'RMPacksStore';

    const result = await this.gameBackend.grantProduct({
      orderId: input.orderId,
      storeID,
      itemID: input.playfabItemId,
      playerID: input.uid,
      priceTwd: input.priceTwd,
      language: 'zh-TW',
    });

    return {
      ok: result.ok,
      // 遊戲端目前不回 mail_id,用 orderId 當對帳 key 留底
      mailId: result.ok ? `grant:${input.orderId}` : undefined,
      responseStatus: result.responseStatus ?? undefined,
      responseBody: result.responseBody ?? undefined,
      errorMessage: result.errorMessage ?? undefined,
      durationMs: result.durationMs,
    };
  }
}
