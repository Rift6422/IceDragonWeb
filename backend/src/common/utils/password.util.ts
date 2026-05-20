import * as bcrypt from 'bcrypt';

/**
 * Bcrypt cost factor
 *
 * - 10:預設,平衡安全與效能(2026 年標準)
 * - 12:更安全但慢 4 倍
 * - 4:**僅限測試**(避免 jest timeout)
 */
const BCRYPT_COST = 10;

/** Hash 密碼(只在 admin 帳號建立 / 改密碼時呼叫) */
export async function hashPassword(plain: string): Promise<string> {
  if (!plain || plain.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  return bcrypt.hash(plain, BCRYPT_COST);
}

/**
 * 比對密碼(time-safe,bcrypt.compare 內建)
 * @returns true if match
 */
export async function comparePassword(plain: string, hash: string): Promise<boolean> {
  if (!plain || !hash) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}
