import { randomBytes } from 'crypto';

/**
 * 產生 FacTradeSeq(廠商交易序號)
 *
 * 規格(MyCard 限制):
 *   - 長度 ≤ 50
 *   - 字元 [a-zA-Z0-9_-]
 *   - 唯一(我們 DB unique constraint 保證)
 *
 * 格式:`IDR-{14digit_timestamp}-{8hex_random}` 共 27 字元
 * 例:`IDR-20260519143025-A1B2C3D4`
 *
 * 設計:
 *   - 字頭 `IDR-`:identifier prefix,易於 log 過濾
 *   - 14 位 timestamp:`yyyymmddHHMMSS`,利於排序與時間定位
 *   - 8 位 hex random:62 bit 等效空間,1 秒內生 1000 筆碰撞機率 ~ 2.3e-12
 */
const PREFIX = 'IDR';

export function generateFacTradeSeq(now: Date = new Date()): string {
  const ts = formatTimestamp(now);
  const random = randomBytes(4).toString('hex').toUpperCase();
  return `${PREFIX}-${ts}-${random}`;
}

function formatTimestamp(d: Date): string {
  const y = d.getFullYear().toString().padStart(4, '0');
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ss = d.getSeconds().toString().padStart(2, '0');
  return `${y}${m}${day}${hh}${mm}${ss}`;
}

/** Regex 驗證 — 給 DTO 或 admin filter 用 */
export const FAC_TRADE_SEQ_REGEX = /^IDR-\d{14}-[0-9A-F]{8}$/;
