/**
 * MyCard 直接儲值 (Model B) Hash 參數型別
 *
 * 規格來源:MyCard 直接儲值 v1.3.0
 * Hash 演算法:`Key1 | params... | Key2` 字串串接 → SHA-1 → lowercase hex
 *
 * ⚠️ **每個 step 的參數順序需以 MyCard 提供的 sample 為準**。
 *    目前的順序是「依文件描述推斷」,先就位等 sample 進來再對齊。
 *    若 sample 跟此處不一致,只需改各 forXxx() 方法內的 push 順序,
 *    types 不必動。
 */

// ============================================================
// 第 2 步 — 商家授權結果(MyCard → 廠商)
// ============================================================
export interface BAuthResultHashParams {
  /** MyCard 交易序號 */
  tradeSeq: string;
  /** MyCard 預先帶來的 PreText(廠商需 echo)*/
  preText: string;
  /** 玩家會員代號(若有)*/
  customerId?: string;
}

// ============================================================
// 第 3-7 步 — 帳密驗證結果(廠商頁面 → MyCard)
// ============================================================
export interface BAccountVerifyHashParams {
  tradeSeq: string;
  /** 玩家在驗證頁輸入的 UID(我方驗證後的回應)*/
  submittedUid: string;
  /** 驗證結果代碼 */
  vresult: number;
  /** PreText 或 verify token(防回放)*/
  preText?: string;
}

// ============================================================
// 第 9-11 步 — 儲值結果回覆(廠商 → MyCard)
// ============================================================
export interface BTopupResultHashParams {
  tradeSeq: string;
  /** MyCard 卡號 / Billing 號 / CGM 號 */
  mycardId: string;
  /** MyCard 專案編號 */
  mycardProjectNo: string;
  /** 通路代碼:INGAME / COSTPOINT / FA2000000020… */
  mycardType: string;
  /** 儲值結果代碼:0 成功 / -1 失敗 / -2 重複 */
  sresult: number;
  /** 金額(若有)*/
  amount?: string;
  currency?: string;
}
