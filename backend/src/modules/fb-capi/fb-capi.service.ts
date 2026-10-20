import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';

/**
 * Facebook Conversions API(CAPI) — Purchase 事件 server-to-server
 *
 * 目的:補槍 Pixel
 *   - 玩家裝 iOS ATT、AdBlock → Pixel 收不到
 *   - 後端確實知道訂單成功(DELIVERED)→ 直接告訴 FB
 *   - 用 event_id = facTradeSeq 跟前端 Pixel 去重,FB 不會算成 2 筆
 *
 * 文件:https://developers.facebook.com/docs/marketing-api/conversions-api/
 *
 * 機制:
 *   - 失敗不 throw、不重試(打 FB 不是核心流程,失敗不能阻礙訂單)
 *   - 留 log + Order.fbCapiSentAt 標記已送
 *   - 沒設 env 時直接 skip(local dev / 沒接 FB 的環境)
 */
@Injectable()
export class FbCapiService implements OnModuleInit {
  private readonly logger = new Logger(FbCapiService.name);
  private readonly pixelId: string | null;
  private readonly accessToken: string | null;
  private readonly testEventCode: string | null;
  private readonly apiVersion = 'v19.0';

  constructor(private readonly config: ConfigService) {
    this.pixelId = this.config.get<string>('FB_PIXEL_ID') || null;
    this.accessToken = this.config.get<string>('FB_TOKEN') || null;
    this.testEventCode = this.config.get<string>('FB_EVENT_CODE') || null;
  }

  /**
   * 開機時印一次狀態,deploy log 直接看得到目前是否啟用。
   * 之後 sendPurchase 的 hot path 不會再印 [skip] log,避免 log 噪音。
   */
  onModuleInit(): void {
    if (this.disabled) {
      this.logger.warn(
        '⚠️  FB Pixel / CAPI 未啟用(FB_PIXEL_ID 或 FB_TOKEN 留空)— Purchase 事件全部 skip,訂單流程不受影響',
      );
    } else {
      this.logger.log(
        `FB CAPI ready (pixel=${this.maskedPixelId()}, test_event_code=${this.testEventCode ? 'set' : 'off'})`,
      );
    }
  }

  /** 模組未設定環境變數時為 true → 上游可直接 skip 不打 API */
  get disabled(): boolean {
    return !this.pixelId || !this.accessToken;
  }

  private maskedPixelId(): string {
    if (!this.pixelId) return '(none)';
    return this.pixelId.length > 6 ? `…${this.pixelId.slice(-4)}` : '***';
  }

  /**
   * 送 Purchase 事件給 FB CAPI
   *
   * @param params.eventId       FB 用來跟前端 Pixel 去重的 ID。必須跟前端 fbq('track', 'Purchase', ..., { eventID }) 一致 → 用我們的 facTradeSeq
   * @param params.uid           玩家 UID(16 碼 hex)— 給 external_id(會 hash)
   * @param params.value         金額(數字,例 150)
   * @param params.currency      幣別 ISO code,例 'TWD'
   * @param params.email         玩家 email(可選,有就送)
   * @param params.clientIp      建單時玩家 IP(可選)
   * @param params.clientUserAgent 建單時玩家 UA(可選)
   * @param params.fbp           前端讀的 `_fbp` cookie(可選但強烈建議)
   * @param params.fbc           前端讀的 `_fbc` cookie(可選但強烈建議)
   * @param params.eventTime     事件時間(epoch seconds)。預設 = 現在
   */
  async sendPurchase(params: {
    eventId: string;
    uid: string;
    value: number;
    currency: string;
    email?: string | null;
    clientIp?: string | null;
    clientUserAgent?: string | null;
    fbp?: string | null;
    fbc?: string | null;
    eventTime?: number;
  }): Promise<{ sent: boolean; reason?: string }> {
    if (this.disabled) {
      // 開機時已 warn 過一次,hot path 不再印,避免每筆訂單都吃一行 log
      return { sent: false, reason: 'not_configured' };
    }

    const userData: Record<string, unknown> = {
      external_id: [this.hash(params.uid)],
    };
    if (params.email) {
      userData.em = [this.hash(params.email)];
    }
    if (params.clientIp) {
      userData.client_ip_address = params.clientIp;
    }
    if (params.clientUserAgent) {
      userData.client_user_agent = params.clientUserAgent;
    }
    if (params.fbp) {
      userData.fbp = params.fbp;
    }
    if (params.fbc) {
      userData.fbc = params.fbc;
    }

    const payload: Record<string, unknown> = {
      data: [
        {
          event_name: 'Purchase',
          event_time: params.eventTime ?? Math.floor(Date.now() / 1000),
          event_id: params.eventId,
          action_source: 'website',
          user_data: userData,
          custom_data: {
            value: params.value,
            currency: params.currency,
          },
        },
      ],
    };
    if (this.testEventCode) {
      payload.test_event_code = this.testEventCode;
    }

    const url = `https://graph.facebook.com/${this.apiVersion}/${this.pixelId}/events?access_token=${encodeURIComponent(
      this.accessToken!,
    )}`;

    try {
      const t0 = Date.now();
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const dt = Date.now() - t0;
      const text = await res.text();
      if (!res.ok) {
        this.logger.warn(
          `FB CAPI Purchase 失敗 status=${res.status} dt=${dt}ms event_id=${params.eventId} body=${text.slice(0, 200)}`,
        );
        return { sent: false, reason: `http_${res.status}` };
      }
      this.logger.log(`FB CAPI Purchase 已送 dt=${dt}ms event_id=${params.eventId}`);
      return { sent: true };
    } catch (err) {
      this.logger.warn(
        `FB CAPI Purchase 例外 event_id=${params.eventId} err=${err instanceof Error ? err.message : String(err)}`,
      );
      return { sent: false, reason: 'exception' };
    }
  }

  /** FB 官方規定:lowercase + trim → SHA-256 hex */
  private hash(input: string): string {
    return createHash('sha256').update(input.trim().toLowerCase()).digest('hex');
  }
}
