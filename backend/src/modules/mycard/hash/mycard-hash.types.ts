/**
 * MyCard Hash 各 API 所需參數型別
 * 對照 v3.9 附錄 B「產生 Hash 的方法」
 *
 * 重要:hash 順序對 MyCard 來說是契約,**不可調換**
 */

/** 3.1 AuthGlobal 取得授權碼(一般流程)*/
export interface AuthGlobalHashParams {
  facServiceId: string;
  facTradeSeq: string;
  facGameId: string;
  facGameName: string;
  /** 1=Android SDK / 2=WEB / 5=WEB QR */
  tradeType: string;
  serverId: string;
  customerId: string;
  paymentType: string;
  itemCode: string;
  productName: string;
  amount: string;
  currency: string;
  /** "true" or "false" */
  sandBoxMode: string;
  facReturnURL: string;
}

/** 3.1 AuthGlobal 取得授權碼(Billing 不進 MyCard 填寫頁,客製信用卡流程)*/
export interface AuthGlobalBillingHashParams extends AuthGlobalHashParams {
  countryCallingCodes: string;
  phoneNumber: string;
  email: string;
  creditCardNumber: string;
  creditCardExpMonth: string;
  creditCardExpYear: string;
  creditCardSecurityCode: string;
}

/** 3.2 交易結果 callback(MyCard → 廠商,我們用來驗證 inbound)*/
export interface TradeResultHashParams {
  returnCode: string;
  payResult: string;
  facTradeSeq: string;
  paymentType: string;
  amount: string;
  currency: string;
  myCardTradeNo: string;
  myCardType: string;
  promoCode: string;
}

/** 3.5 IngamePay(卡片儲值)*/
export interface IngamePayHashParams {
  authCode: string;
  cardId: string;
  cardPw: string;
}

/** 4.2 SDKTradeQuery(自助交易查詢)*/
export interface SdkTradeQueryHashParams {
  facServiceId: string;
  facTradeSeq: string;
  startDateTime: string;
  endDateTime: string;
  /** 0/1/2/3 */
  cancelStatus: string;
}

/** 4.3 CostAgainService(訂閱續扣)*/
export interface CostAgainServiceHashParams {
  serialId: string;
  facTradeSeq: string;
  currency: string;
  amount: string;
}

/** 4.4 CostAgainCancel(取消訂閱)*/
export interface CostAgainCancelHashParams {
  serialId: string;
}
