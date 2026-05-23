/**
 * 集中管理後台狀態欄位的繁體中文顯示。
 *
 * 訂單狀態(對應 prisma OrderStatus enum):
 *   PENDING / AUTHED / PAID / CONFIRMED / DELIVERED / DELIVERY_FAILED /
 *   CANCELLED / FAILED
 *
 * 商品狀態(對應 prisma ProductStatus enum):
 *   ACTIVE / INACTIVE
 */

const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING: '待付款',
  AUTHED: '已授權',
  PAID: '已付款',
  CONFIRMED: '已請款',
  DELIVERED: '已派發',
  DELIVERY_FAILED: '派發失敗',
  CANCELLED: '已取消',
  FAILED: '付款失敗',
};

const ORDER_STATUS_COLOR: Record<string, string> = {
  PENDING: 'bg-slate-100 text-slate-500',
  AUTHED: 'bg-slate-100 text-slate-700',
  PAID: 'bg-cyan-100 text-cyan-700',
  CONFIRMED: 'bg-blue-100 text-blue-700',
  DELIVERED: 'bg-emerald-100 text-emerald-700',
  DELIVERY_FAILED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-slate-100 text-slate-400',
  FAILED: 'bg-red-100 text-red-700',
};

export function orderStatusLabel(status: string): string {
  return ORDER_STATUS_LABEL[status] ?? status;
}

export function orderStatusColor(status: string): string {
  return ORDER_STATUS_COLOR[status] ?? 'bg-slate-100 text-slate-600';
}

export const ORDER_STATUS_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '全部' },
  ...Object.keys(ORDER_STATUS_LABEL).map((s) => ({
    value: s,
    label: `${ORDER_STATUS_LABEL[s]}(${s})`,
  })),
];

const PRODUCT_STATUS_LABEL: Record<string, string> = {
  ACTIVE: '啟用',
  INACTIVE: '下架',
};

export function productStatusLabel(status: string): string {
  return PRODUCT_STATUS_LABEL[status] ?? status;
}
