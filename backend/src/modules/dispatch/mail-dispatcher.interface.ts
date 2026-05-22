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
  /** 訂單金額(TWD,整數)— 給遊戲端 grantrmproduct 對帳用 */
  priceTwd: number;
  /** PlayFab catalog itemId — 給遊戲端派發識別。null = 不打 PlayFab(走 mock 模擬) */
  playfabItemId: string | null;
  /** PlayFab storeID(空 fallback 到 GAME_BACKEND_STORE_ID env)*/
  playfabStoreId: string | null;
  /** 派發 payload(MockMailDispatcher 用;真實 dispatcher 用上面欄位)*/
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
