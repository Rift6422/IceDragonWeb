import { createHash, timingSafeEqual } from 'crypto';
import type {
  BAccountVerifyHashParams,
  BAuthResultHashParams,
  BTopupResultHashParams,
} from './mycard-direct-hash.types';

/**
 * MyCard 直接儲值 (Model B, v1.3.0) Hash 計算服務。
 *
 * 演算法:
 *   1. `Key1 | param1 | param2 | ... | paramN | Key2`(`|` 是 literal 字串)
 *   2. SHA-1
 *   3. lowercase hex
 *
 * ⚠️ 跟 Model A(SHA-256 + URL encode)完全不同。**不要復用 MyCardHashService**。
 *
 * Key1 / Key2 由 MyCard 提供 — 環境變數:
 *   MYCARD_DIRECT_KEY1, MYCARD_DIRECT_KEY2
 *
 * 各 step 參數順序 **以 MyCard sample 為準**。目前實作是依文件文字推斷,
 * 拿到 sample 後若有差異,只需調整 `for...()` 方法內的 push 順序與 fixture。
 */
export class MyCardDirectHashService {
  constructor(
    private readonly key1: string,
    private readonly key2: string,
  ) {
    if (!key1 || !key2) {
      throw new Error('MyCardDirectHashService: key1 and key2 are required');
    }
    // SHA-1 沒有跟 Model A 一樣的 32 字元上限,但保留 alphanum 風格檢查
    if (!/^[\x21-\x7E]+$/.test(key1) || !/^[\x21-\x7E]+$/.test(key2)) {
      throw new Error('MyCardDirectHashService: keys must be printable ASCII');
    }
  }

  /** 通用:把 parts 用 `|` 串接後加 SHA-1 */
  computeHash(parts: string[]): string {
    const pre = [this.key1, ...parts, this.key2].join('|');
    return createHash('sha1').update(pre, 'utf-8').digest('hex');
  }

  // ============================================================
  // 第 2 步 — 商家授權結果(MyCard 推進來,我方驗 hash)
  // ============================================================
  forBAuthResult(p: BAuthResultHashParams): string {
    return this.computeHash([p.tradeSeq, p.preText, p.customerId ?? '']);
  }

  verifyBAuthResult(p: BAuthResultHashParams, receivedHash: string): boolean {
    return this.timingSafeHexEqual(this.forBAuthResult(p), receivedHash);
  }

  // ============================================================
  // 第 3-7 步 — 帳密驗證結果(我方 → MyCard)
  // ============================================================
  forBAccountVerify(p: BAccountVerifyHashParams): string {
    return this.computeHash([
      p.tradeSeq,
      p.submittedUid,
      String(p.vresult),
      p.preText ?? '',
    ]);
  }

  // ============================================================
  // 第 9-11 步 — 儲值結果回覆
  // (MyCard 推來 hash 我方要驗;我方回覆也帶 hash 給 MyCard)
  // ============================================================
  forBTopupResult(p: BTopupResultHashParams): string {
    return this.computeHash([
      p.tradeSeq,
      p.mycardId,
      p.mycardProjectNo,
      p.mycardType,
      String(p.sresult),
      p.amount ?? '',
      p.currency ?? '',
    ]);
  }

  verifyBTopupResult(p: BTopupResultHashParams, receivedHash: string): boolean {
    return this.timingSafeHexEqual(this.forBTopupResult(p), receivedHash);
  }

  /** time-constant hex 字串比對(防 timing attack) */
  private timingSafeHexEqual(a: string, b: string): boolean {
    if (typeof b !== 'string') return false;
    if (a.length !== b.length) return false;
    try {
      return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
    } catch {
      return false;
    }
  }
}
