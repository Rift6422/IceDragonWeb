/**
 * 模擬 .NET `HttpUtility.UrlEncode` 行為(MyCard SHA-256 Hash 計算用)
 *
 * 規則(對照 v3.9 附錄 B 表格):
 * - 不編碼:`A-Z` `a-z` `0-9` `-` `_` `.` `!` `*` `(` `)`
 * - 空白 ` ` → `+`
 * - 其他 → UTF-8 percent encode(`%XX`,大寫 hex,呼叫端會再 toLowerCase())
 *
 * 注意:`encodeURIComponent` 與 .NET 行為不同
 * - `~` 在 .NET 編碼為 `%7E`,但 `encodeURIComponent` 不編碼
 * - `'` 在 .NET 編碼為 `%27`,但 `encodeURIComponent` 不編碼
 * 因此必須自己實作,不能用內建函式。
 */
export function dotnetUrlEncode(input: string): string {
  if (input === '' || input === null || input === undefined) return '';

  let result = '';
  const buf = Buffer.from(input, 'utf-8');

  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i];

    if (
      (byte >= 0x30 && byte <= 0x39) || // 0-9
      (byte >= 0x41 && byte <= 0x5a) || // A-Z
      (byte >= 0x61 && byte <= 0x7a) || // a-z
      byte === 0x2d || // -
      byte === 0x5f || // _
      byte === 0x2e || // .
      byte === 0x21 || // !
      byte === 0x2a || // *
      byte === 0x28 || // (
      byte === 0x29 //   )
    ) {
      result += String.fromCharCode(byte);
    } else if (byte === 0x20) {
      // space → +
      result += '+';
    } else {
      // %XX 大寫
      result += '%' + byte.toString(16).toUpperCase().padStart(2, '0');
    }
  }

  return result;
}
