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

export async function fetchOrderDetail(id: string): Promise<unknown> {
  const { data } = await api.get<unknown>(`/api/admin/orders/${id}`);
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

export async function deactivateProduct(id: string): Promise<AdminProduct> {
  const { data } = await api.delete<AdminProduct>(`/api/admin/products/${id}`);
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
