import { api } from './client';

// ============================================================
// 公開商品(玩家前台,無需登入)
// ============================================================

export type ProductCategory = 'BUNDLE' | 'CURRENCY';

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
  amount: string;
  currency: string;
  effects: ProductEffectsJson;
  sort_order: number;
  category: ProductCategory;
  purchase_limit_label?: string | null;
  /** PlayFab itemId(若有設,代表有限購) */
  playfab_item_id?: string | null;
  /** 限購狀態 — 只在 fetch 帶 uid 時填入 */
  limitation?: ItemLimitation | null;
}

export interface PublicProductsResponse {
  total: number;
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
  product_name: string;
  payment_type?: string | null;
  pay_result?: number | null;
  created_at: string;
  paid_at: string | null;
  delivered_at: string | null;
}

export async function fetchMyOrderDetail(facTradeSeq: string): Promise<PlayerOrderDetail> {
  const { data } = await api.get<PlayerOrderDetail>(`/api/orders/${facTradeSeq}`);
  return data;
}
