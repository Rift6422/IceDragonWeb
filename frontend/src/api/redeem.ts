import axios from 'axios';

/**
 * Model B 直接儲值 API client。
 *
 * 跟既有 `/api/client.ts` 不一樣的地方:
 *   - 後端回應是 **純文字**(不是 JSON)
 *   - 不帶 admin JWT(那是 admin 用的)
 */

const directApi = axios.create({
  baseURL: '/',
  headers: { 'Content-Type': 'application/json' },
  // 強制以純文字解析
  transformResponse: [(data) => (typeof data === 'string' ? data : String(data))],
  responseType: 'text',
});

export type VerifyResult = 0 | -1 | -2;

export async function submitAccountVerify(
  verifyToken: string,
  uid: string,
): Promise<VerifyResult> {
  const { data } = await directApi.post<string>('/api/mycard/direct-topup/account-verify', {
    verifyToken,
    uid,
  });
  const n = parseInt(String(data).trim(), 10);
  if (n === 0 || n === -1 || n === -2) return n;
  return -1;
}
