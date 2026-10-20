import { api } from './client';

/**
 * 玩家序號兌換。
 *
 * 後端只做 proxy:把 UID + 序號轉呼遊戲端 /api/redeemmycoupon(function code 在後端,
 * 不進前端 bundle),再把遊戲端回傳的訊息原樣帶回顯示。
 */
export interface RedeemCouponResponse {
  success: boolean;
  /** 遊戲端回傳、要直接顯示給玩家看的訊息 */
  message: string;
}

export async function redeemCoupon(
  uid: string,
  couponCode: string,
): Promise<RedeemCouponResponse> {
  const { data } = await api.post<RedeemCouponResponse>('/api/coupons/redeem', {
    uid,
    couponCode,
  });
  return data;
}
