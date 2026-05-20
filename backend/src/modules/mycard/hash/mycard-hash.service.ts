import { createHash, timingSafeEqual } from 'crypto';
import { dotnetUrlEncode } from './dotnet-url-encode';
import type {
  AuthGlobalBillingHashParams,
  AuthGlobalHashParams,
  CostAgainCancelHashParams,
  CostAgainServiceHashParams,
  IngamePayHashParams,
  SdkTradeQueryHashParams,
  TradeResultHashParams,
} from './mycard-hash.types';

/**
 * MyCard SHA-256 Hash 計算服務
 *
 * 演算法(v3.9 附錄 B):
 *   1. 依各 API 規定順序串接參數 + 廠商 Key
 *   2. URL encode(.NET HttpUtility.UrlEncode 行為)+ 轉小寫
 *   3. SHA-256 → hex(小寫)
 *
 * 模擬器:https://test.mycard520.com.tw/FactoryTestTool/MyCardPayCpTest/HASHV12.aspx
 *
 * ⚠️ 廠商 Key 必須機密:不可在 React 端組 Hash,不可寫進 git。
 */
export class MyCardHashService {
  constructor(private readonly key: string) {
    if (!key) {
      throw new Error('MyCardHashService: hash key is required');
    }
    if (key.length > 32) {
      throw new Error('MyCardHashService: key length must be ≤ 32');
    }
    if (!/^[0-9a-zA-Z]+$/.test(key)) {
      throw new Error('MyCardHashService: key must be alphanumeric');
    }
  }

  /**
   * 通用底層:依文件演算法計算 hash
   * @param preValue 已依文件順序串好的字串(不含 key,由本方法附加)
   */
  computeHash(preValue: string): string {
    const withKey = preValue + this.key;
    const encoded = dotnetUrlEncode(withKey).toLowerCase();
    return createHash('sha256').update(encoded, 'utf-8').digest('hex');
  }

  /** 3.1 AuthGlobal — 取得交易授權碼 */
  forAuthGlobal(p: AuthGlobalHashParams): string {
    const pre =
      p.facServiceId +
      p.facTradeSeq +
      p.facGameId +
      p.facGameName +
      p.tradeType +
      p.serverId +
      p.customerId +
      p.paymentType +
      p.itemCode +
      p.productName +
      p.amount +
      p.currency +
      p.sandBoxMode +
      p.facReturnURL;
    return this.computeHash(pre);
  }

  /** 3.1 AuthGlobal — Billing 不進 MyCard 填寫頁 */
  forAuthGlobalBilling(p: AuthGlobalBillingHashParams): string {
    const pre =
      p.facServiceId +
      p.facTradeSeq +
      p.facGameId +
      p.facGameName +
      p.tradeType +
      p.serverId +
      p.customerId +
      p.paymentType +
      p.itemCode +
      p.productName +
      p.amount +
      p.currency +
      p.sandBoxMode +
      p.countryCallingCodes +
      p.phoneNumber +
      p.email +
      p.creditCardNumber +
      p.creditCardExpMonth +
      p.creditCardExpYear +
      p.creditCardSecurityCode +
      p.facReturnURL;
    return this.computeHash(pre);
  }

  /** 3.2 交易結果 callback hash(MyCard → 廠商,計算我方應收到的 hash)*/
  forTradeResult(p: TradeResultHashParams): string {
    const pre =
      p.returnCode +
      p.payResult +
      p.facTradeSeq +
      p.paymentType +
      p.amount +
      p.currency +
      p.myCardTradeNo +
      p.myCardType +
      p.promoCode;
    return this.computeHash(pre);
  }

  /**
   * 驗證 MyCard 傳來的 3.2 callback hash(time-safe 比對防 timing attack)
   * @returns true 表示驗證通過
   */
  verifyTradeResult(p: TradeResultHashParams, receivedHash: string): boolean {
    if (typeof receivedHash !== 'string' || receivedHash.length !== 64) {
      return false;
    }
    const expected = this.forTradeResult(p);
    return this.timingSafeHexEqual(expected, receivedHash);
  }

  /** 3.5 IngamePay — 在遊戲中卡號密碼儲值 */
  forIngamePay(p: IngamePayHashParams): string {
    const pre = p.authCode + p.cardId + p.cardPw;
    return this.computeHash(pre);
  }

  /** 4.2 SDKTradeQuery — 自助交易查詢 */
  forSdkTradeQuery(p: SdkTradeQueryHashParams): string {
    const pre =
      p.facServiceId + p.facTradeSeq + p.startDateTime + p.endDateTime + p.cancelStatus;
    return this.computeHash(pre);
  }

  /** 4.3 CostAgainService — 訂閱續扣 */
  forCostAgainService(p: CostAgainServiceHashParams): string {
    const pre = p.serialId + p.facTradeSeq + p.currency + p.amount;
    return this.computeHash(pre);
  }

  /** 4.4 CostAgainCancel — 取消訂閱 */
  forCostAgainCancel(p: CostAgainCancelHashParams): string {
    const pre = p.serialId;
    return this.computeHash(pre);
  }

  /** time-constant hex 字串比對(防 timing attack)*/
  private timingSafeHexEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    try {
      return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
    } catch {
      return false;
    }
  }
}
