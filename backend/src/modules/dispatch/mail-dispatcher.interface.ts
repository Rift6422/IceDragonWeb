/**
 * MailDispatcher — 把訂單內容投到遊戲信箱
 *
 * 抽象介面,允許 v1.0 / v1.1 切換實作:
 *   - MockMailDispatcher:本地 dev / 整合測試用,永遠成功並 log
 *   - HttpMailDispatcher:正式環境,呼叫遊戲端 HTTP API(待遊戲端規格)
 *   - DirectDbDispatcher:備援方案(直接寫遊戲 DB)
 */
export interface DispatchInput {
  orderId: string;
  facTradeSeq: string;
  /** 玩家 UID(16-hex)*/
  uid: string;
  /** 派發 payload(從 product.effects.mail + effects 組成) */
  payload: {
    subject: string;
    body: string;
    expire_days?: number;
    effects: Array<{ type: string; code: string; amount?: number; qty?: number; duration_seconds?: number }>;
  };
}

export interface DispatchResult {
  ok: boolean;
  /** 遊戲端回的 mail_id(若有,後續可去重 / 對帳) */
  mailId?: string;
  /** 失敗時的訊息 */
  errorMessage?: string;
  responseStatus?: number;
  responseBody?: string;
  durationMs: number;
}

export const MAIL_DISPATCHER = Symbol('MAIL_DISPATCHER');

export interface MailDispatcher {
  dispatch(input: DispatchInput): Promise<DispatchResult>;
}
