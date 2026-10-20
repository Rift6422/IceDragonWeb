import { api } from './client';

// ============================================================
// Auth
// ============================================================

export interface AdminInfo {
  id: string;
  username: string;
  role: string;
  email?: string;
}

export interface LoginResponse {
  access_token: string;
  expires_in: number;
  admin: AdminInfo;
}

export async function adminLogin(username: string, password: string): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>('/api/admin/auth/login', { username, password });
  return data;
}

export async function adminMe(): Promise<AdminInfo> {
  const { data } = await api.get<AdminInfo>('/api/admin/auth/me');
  return data;
}

// ============================================================
// Dashboard
// ============================================================

export interface DashboardStats {
  today: {
    by_status: Record<string, number>;
    revenue_twd: number;
    delivered_count: number;
  };
  totals: {
    delivered_count: number;
    delivered_revenue_twd: number;
    game_user_count: number;
    product_active_count: number;
    product_total_count: number;
  };
  attention: {
    delivery_failed_count: number;
    callback_failed_24h: number;
    stale_authed_count: number;
  };
  recent_orders: Array<{
    id: string;
    fac_trade_seq: string;
    status: string;
    amount: string;
    created_at: string;
  }>;
}

export async function fetchDashboard(): Promise<DashboardStats> {
  const { data } = await api.get<DashboardStats>('/api/admin/dashboard');
  return data;
}

// ============================================================
// Orders
// ============================================================

export interface AdminOrderListItem {
  id: string;
  fac_trade_seq: string;
  status: string;
  amount: string;
  currency: string;
  user: { id: string; uid: string; email: string | null };
  product: { id: string; code: string; name_internal: string };
  created_at: string;
  paid_at: string | null;
  delivered_at: string | null;
}

export interface AdminOrderListResponse {
  total: number;
  items: AdminOrderListItem[];
}

export interface ListOrdersQuery {
  status?: string;
  fac_trade_seq?: string;
  user_uid?: string;
  mycard_trade_no?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export async function fetchOrders(query: ListOrdersQuery = {}): Promise<AdminOrderListResponse> {
  const { data } = await api.get<AdminOrderListResponse>('/api/admin/orders', { params: query });
  return data;
}

export interface AdminOrderDetail {
  id: string;
  facTradeSeq: string;
  status: string;
  amount: string;
  currency: string;
  createdAt: string;
  updatedAt: string;
  authedAt: string | null;
  paidAt: string | null;
  confirmedAt: string | null;
  deliveredAt: string | null;
  failureReason: string | null;
  productSnapshot: unknown;
  user: { id: string; uid: string; email: string | null; displayName: string | null } | null;
  product: {
    id: string;
    code: string;
    nameDisplay: string;
    nameInternal: string;
    mycardItemCode: string | null;
  } | null;
  transaction: {
    authCode: string | null;
    tradeSeq: string | null;
    mycardTradeNo: string | null;
    paymentType: string | null;
    payResult: number | null;
  } | null;
  callbackLogs?: unknown[];
  statusHistory?: unknown[];
  deliveryAttempts?: unknown[];
}

export async function fetchOrderDetail(id: string): Promise<AdminOrderDetail> {
  const { data } = await api.get<AdminOrderDetail>(`/api/admin/orders/${id}`);
  return data;
}

export interface RetryCallbackResponse {
  ok: boolean;
  status: string | null;
  message: string;
}

export async function retryCallback(
  facTradeSeq: string,
  opts: { force?: boolean } = {},
): Promise<RetryCallbackResponse> {
  const { data } = await api.post<RetryCallbackResponse>('/api/admin/orders/retry-callback', {
    facTradeSeq,
    force: opts.force ?? false,
  });
  return data;
}

// ============================================================
// Products
// ============================================================

export interface AdminProduct {
  id: string;
  code: string;
  mycardItemCode: string | null;
  nameDisplay: string;
  nameInternal: string;
  description: string | null;
  amount: string;
  currency: string;
  effects: unknown;
  status: 'ACTIVE' | 'INACTIVE';
  sortOrder: number;
  playfabItemId: string | null;
  playfabStoreId: string | null;
  playfabCatalog: string | null;
  categoryId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminProductsResponse {
  total: number;
  items: AdminProduct[];
}

export async function fetchProducts(params: { status?: 'ACTIVE' | 'INACTIVE'; limit?: number; offset?: number } = {}): Promise<AdminProductsResponse> {
  const { data } = await api.get<AdminProductsResponse>('/api/admin/products', { params });
  return data;
}

export interface CreateProductInput {
  code: string;
  mycard_item_code?: string;
  name_display: string;
  name_internal: string;
  description?: string;
  amount: string;
  currency?: string;
  effects: Record<string, unknown>;
  status?: 'ACTIVE' | 'INACTIVE';
  sort_order?: number;
  playfab_item_id?: string;
  playfab_store_id?: string;
  playfab_catalog?: string;
  category_id?: string;
}

export async function createProduct(input: CreateProductInput): Promise<AdminProduct> {
  const { data } = await api.post<AdminProduct>('/api/admin/products', input);
  return data;
}

export async function updateProduct(
  id: string,
  patch: Partial<CreateProductInput>,
): Promise<AdminProduct> {
  const { data } = await api.patch<AdminProduct>(`/api/admin/products/${id}`, patch);
  return data;
}

/** 下架(可重新上架,仍留在後台列表)— 走 PATCH status:'INACTIVE' */
export async function deactivateProduct(id: string): Promise<AdminProduct> {
  return updateProduct(id, { status: 'INACTIVE' });
}

/** 軟刪除(從後台列表消失,保留歷史訂單 FK)— DELETE endpoint 走真刪除 */
export async function deleteProduct(id: string): Promise<AdminProduct> {
  const { data } = await api.delete<AdminProduct>(`/api/admin/products/${id}`);
  return data;
}

// 商品限購狀態(以指定 UID 視角從遊戲端拉) ----------------------------

export type LimitPeriod = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR' | 'ALL_TIME';

export interface AdminStoreItemEntry {
  playfab_item_id: string;
  store_id: string;
  can_double: boolean;
  limitation: null | {
    limit_period: LimitPeriod;
    max_quantity: number;
    left_quantity: number;
    reset_at: string | null;
  };
}

export interface AdminStoreItemsResponse {
  uid: string;
  fetched_at: string;
  store_ids: string[];
  stub_or_failed: boolean;
  items: Record<string, AdminStoreItemEntry>;
  /** 玩家已擁有的 premium itemId 清單(月卡類)*/
  own_premiums: string[];
}

export async function fetchAdminStoreItems(uid: string): Promise<AdminStoreItemsResponse> {
  const { data } = await api.get<AdminStoreItemsResponse>('/api/admin/products/store-items', {
    params: { uid },
  });
  return data;
}

// 圖庫(Media)----------------------------

export interface MediaItem {
  id: string;
  url: string;
  filename: string;
  original_name: string | null;
  mime_type: string;
  size_bytes: number;
  uploaded_at: string;
  /** 軟刪時間;null = 仍啟用 */
  deleted_at: string | null;
}

export interface MediaListResponse {
  total: number;
  items: MediaItem[];
  /** 軟刪除總數,獨立於 total */
  deleted_count: number;
}

/** 5MB,跟後端 MAX_BYTES 一致 — client-side 預檢避免浪費上傳時間 */
export const MEDIA_MAX_BYTES = 5 * 1024 * 1024;
export const MEDIA_ALLOWED_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;

export async function fetchMediaList(
  opts: { includeDeleted?: boolean } = {},
): Promise<MediaListResponse> {
  const { data } = await api.get<MediaListResponse>('/api/admin/media', {
    params: { limit: 200, include_deleted: opts.includeDeleted ? 'true' : undefined },
  });
  return data;
}

export async function uploadMedia(file: File): Promise<MediaItem> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.post<MediaItem>('/api/admin/media/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function deleteMedia(id: string): Promise<{ id: string; deleted: boolean }> {
  const { data } = await api.delete<{ id: string; deleted: boolean }>(`/api/admin/media/${id}`);
  return data;
}

export async function restoreMedia(id: string): Promise<MediaItem> {
  const { data } = await api.patch<MediaItem>(`/api/admin/media/${id}/restore`);
  return data;
}

// ============================================================
// Categories(商品分類)
// ============================================================

export interface AdminCategory {
  id: string;
  code: string;
  displayName: string;
  sortOrder: number;
  status: 'ACTIVE' | 'INACTIVE';
  product_count: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminCategoriesResponse {
  total: number;
  items: AdminCategory[];
}

export async function fetchCategories(): Promise<AdminCategoriesResponse> {
  const { data } = await api.get<AdminCategoriesResponse>('/api/admin/categories');
  return data;
}

export interface CreateCategoryInput {
  code: string;
  display_name: string;
  sort_order?: number;
  status?: 'ACTIVE' | 'INACTIVE';
}

export async function createCategory(input: CreateCategoryInput): Promise<AdminCategory> {
  const { data } = await api.post<AdminCategory>('/api/admin/categories', input);
  return data;
}

export async function updateCategory(
  id: string,
  patch: Partial<Omit<CreateCategoryInput, 'code'>>,
): Promise<AdminCategory> {
  const { data } = await api.patch<AdminCategory>(`/api/admin/categories/${id}`, patch);
  return data;
}

/** 停用(可重新啟用,仍留在後台列表)— 走 PATCH status:'INACTIVE' */
export async function deactivateCategory(id: string): Promise<AdminCategory> {
  return updateCategory(id, { status: 'INACTIVE' });
}

/** 軟刪除分類 — 底下商品 categoryId 一起設 null(歸到「未分類」)*/
export async function deleteCategory(
  id: string,
): Promise<{ category: AdminCategory; products_unlinked: number }> {
  const { data } = await api.delete<{ category: AdminCategory; products_unlinked: number }>(
    `/api/admin/categories/${id}`,
  );
  return data;
}

// ============================================================
// Users(GameUser,read-only)
// ============================================================

export interface AdminUserListItem {
  id: string;
  uid: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
  last_login_at: string | null;
  is_active: boolean;
  /** 累積成立訂單數(只算 DELIVERED) */
  delivered_order_count: number;
  /** 累積消費金額 TWD(只算 DELIVERED 訂單) */
  total_spent_twd: string;
}

export interface AdminUsersResponse {
  total: number;
  items: AdminUserListItem[];
}

export async function fetchUsers(params: {
  uid?: string;
  email?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<AdminUsersResponse> {
  const { data } = await api.get<AdminUsersResponse>('/api/admin/users', { params });
  return data;
}

export interface AdminUserOrder {
  id: string;
  fac_trade_seq: string;
  status: string;
  amount: string;
  currency: string;
  created_at: string;
  delivered_at: string | null;
  product_code: string;
  product_name: string;
}

export interface AdminUserDetail extends AdminUserListItem {
  orders: AdminUserOrder[];
  inventory_currencies: Array<{ currency_code: string; balance: string }>;
}

export async function fetchUserDetail(id: string): Promise<AdminUserDetail> {
  const { data } = await api.get<AdminUserDetail>(`/api/admin/users/${id}`);
  return data;
}
