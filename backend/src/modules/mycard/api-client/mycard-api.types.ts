/**
 * MyCard API request / response 型別
 * 對齊 v3.9 §3.1 / §3.3 / §3.4
 */

// ============================================================
// 3.1 AuthGlobal
// ============================================================

export interface AuthGlobalRequest {
  FacServiceId: string;
  FacTradeSeq: string;
  FacGameId: string;
  FacGameName: string;
  /** 1=Android SDK / 2=WEB / 5=WEB QR */
  TradeType: '1' | '2' | '5';
  ServerId?: string;
  CustomerId: string;
  /** 空字串 = MyCard 列全部付費方式 */
  PaymentType?: string;
  ItemCode?: string;
  ProductName: string;
  Amount: string;
  /** 3-letter ISO 4217 */
  Currency: string;
  SandBoxMode: string;
  FacReturnURL?: string;
  Hash: string;
}

export interface AuthGlobalResponse {
  ReturnCode: string;
  ReturnMsg: string;
  AuthCode?: string;
  TradeSeq?: string;
  /** 1: server-side, 2: web-side */
  InGameSaveType?: string;
  /** 玩家要被導頁的 MyCard 交易網址 */
  TransactionUrl?: string;
}

// ============================================================
// 3.3 TradeQuery
// ============================================================

export interface TradeQueryRequest {
  AuthCode: string;
}

export interface TradeQueryResponse {
  ReturnCode: string;
  ReturnMsg: string;
  /** "3" = success, "0" = fail */
  PayResult?: string;
  FacTradeSeq?: string;
  PaymentType?: string;
  Amount?: string;
  Currency?: string;
  MyCardTradeNo?: string;
  MyCardType?: string;
  PromoCode?: string;
  SerialId?: string;
  TradeExpirationDate?: string;
  TradeExpirationStatus?: string;
}

// ============================================================
// 3.4 PaymentConfirm
// ============================================================

export interface PaymentConfirmRequest {
  AuthCode: string;
}

export interface PaymentConfirmResponse {
  ReturnCode: string;
  ReturnMsg: string;
  FacTradeSeq?: string;
  TradeSeq?: string;
  SerialId?: string;
}

// ============================================================
// 內部用:抽象 result
// ============================================================

export interface MyCardCallResult<TResp> {
  ok: boolean;
  /** MyCard 回傳的 ReturnCode (string,如 "1" / "MBP003")*/
  returnCode: string;
  returnMsg: string;
  data: TResp;
  /** 我方記錄用 */
  durationMs: number;
  /** 我方產生的 callback log id(便於後續追) */
  callbackLogId: string;
}
