import { api } from './client';

// ============================================================
// 公開商品(玩家前台,無需登入)
// ============================================================

export interface PublicCategory {
  id: string;
  code: string;
  display_name: string;
  sort_order: number;
}

export interface ProductEffect {
  type: string;
  code: string;
  amount?: number;
  qty?: number;
  display_label?: string;
}

export interface ProductEffectsJson {
  effects?: ProductEffect[];
  mail?: { subject?: string; body?: string; expire_days?: number };
  purchase_limit_label?: string;
  /** 前端展示用 icon emoji,可選 */
  icon?: string;
}

export type LimitPeriod = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR' | 'ALL_TIME';

export interface ItemLimitation {
  store_id: string;
  item_id: string;
  limit_period: LimitPeriod;
  max_quantity: number;
  left_quantity: number;
  /** ISO 8601 UTC,或 null(AllTime / 無重置) */
  reset_at: string | null;
}

export interface PublicProduct {
  id: string;
  code: string;
  name_display: string;
  /** 自由文字商品說明;空時 fallback 顯示 effects 清單 */
  description?: string | null;
  amount: string;
  currency: string;
  effects: ProductEffectsJson;
  sort_order: number;
  category: PublicCategory | null;
  purchase_limit_label?: string | null;
  /** PlayFab itemId(若有設,代表有限購) */
  playfab_item_id?: string | null;
  /** 限購狀態 — 只在 fetch 帶 uid 時填入 */
  limitation?: ItemLimitation | null;
  /** 該品項是否參與加倍活動(v2 getstoreitems 帶來,舊 endpoint fallback 時為 null)*/
  can_double?: boolean | null;
  /** 玩家是否已擁有(月卡類 premium)— true 禁止購買;null = 未查 uid */
  owned?: boolean | null;
}

export interface PublicProductsResponse {
  total: number;
  /** 動態分類(後台可改),依 sort_order 排好 */
  categories: PublicCategory[];
  items: PublicProduct[];
}

export async function fetchPlayerProducts(uid?: string): Promise<PublicProductsResponse> {
  const params = uid ? { uid } : undefined;
  const { data } = await api.get<PublicProductsResponse>('/api/products', { params });
  return data;
}

// ============================================================
// UID 登入驗證
// ============================================================

export interface VerifyUidResponse {
  valid: boolean;
  /**
   * OK = PlayFab 認得;
   * NOT_FOUND = PlayFab 回不存在,擋住;
   * BACKEND_DOWN = 遊戲端掛了 / 沒對接,放行;
   * STUB = 我方環境未設遊戲端 endpoint,放行
   */
  reason: 'OK' | 'NOT_FOUND' | 'BACKEND_DOWN' | 'STUB';
}

export async function verifyPlayerUid(uid: string): Promise<VerifyUidResponse> {
  const { data } = await api.post<VerifyUidResponse>('/api/players/verify', { uid });
  return data;
}

// ============================================================
// 建單(玩家)
// ============================================================

export interface CreateOrderInput {
  uid: string;
  productCode: string;
  email?: string;
  /** FB Pixel _fbp cookie(可選但強烈建議),給 CAPI user_data.fbp */
  fbp?: string;
  /** FB Pixel _fbc cookie 或從 fbclid 衍生(可選),給 CAPI user_data.fbc */
  fbc?: string;
}

export interface CreateOrderResponse {
  order_id: string;
  fac_trade_seq: string;
  redirect_url: string;
  status: string;
}

export async function createPlayerOrder(input: CreateOrderInput): Promise<CreateOrderResponse> {
  const { data } = await api.post<CreateOrderResponse>('/api/orders', input);
  return data;
}

/**
 * 玩家從 MyCard 付款頁跳回商城時呼叫,主動釋放剛剛那筆未完成單的鎖,
 * 讓玩家能立刻重買。已付款的單後端會自動跳過(TradeQuery 確認)。best-effort。
 */
export async function releaseAbandonedOrder(
  facTradeSeq: string,
): Promise<{ released: boolean; reason: string }> {
  const { data } = await api.post<{ released: boolean; reason: string }>(
    `/api/orders/${facTradeSeq}/abandon`,
  );
  return data;
}

// ============================================================
// 玩家訂單(by UID)
// ============================================================

export type OrderStatus =
  | 'PENDING'
  | 'AUTHED'
  | 'PAID'
  | 'CONFIRMED'
  | 'DELIVERED'
  | 'DELIVERY_FAILED'
  | 'CANCELLED'
  | 'FAILED';

export interface PlayerOrderListItem {
  fac_trade_seq: string;
  status: OrderStatus;
  amount: string;
  currency: string;
  product_code: string;
  product_name: string;
  created_at: string;
  paid_at: string | null;
  delivered_at: string | null;
}

export interface PlayerOrdersResponse {
  total: number;
  items: PlayerOrderListItem[];
}

export async function fetchMyOrders(
  uid: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<PlayerOrdersResponse> {
  const { data } = await api.get<PlayerOrdersResponse>('/api/orders', {
    params: { uid, ...opts },
  });
  return data;
}

export interface PlayerOrderDetail {
  fac_trade_seq: string;
  status: OrderStatus;
  amount: string;
  currency: string;
  product_code: string;
  /** 遊戲端 itemId(送 PlayFab / 遊戲端的識別碼);未設 PlayFab 的商品為 null */
  game_item_id?: string | null;
  product_name: string;
  payment_type?: string | null;
  pay_result?: number | null;
  /** MyCard 交易失敗時回傳的 ReturnMsg(已 URL-decode);失敗畫面顯示給玩家 */
  failure_reason?: string | null;
  /** MyCard trade-result 回傳的 ReturnCode(如 PBEFF101);失敗畫面顯示 */
  return_code?: string | null;
  /** MyCard trade-result 回傳的 ReturnMsg(= failure_reason,已 decode);失敗畫面顯示 */
  return_msg?: string | null;
  created_at: string;
  paid_at: string | null;
  delivered_at: string | null;
}

export async function fetchMyOrderDetail(facTradeSeq: string): Promise<PlayerOrderDetail> {
  const { data } = await api.get<PlayerOrderDetail>(`/api/orders/${facTradeSeq}`);
  return data;
}
