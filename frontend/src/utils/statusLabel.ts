/**
 * 集中管理後台狀態欄位的繁體中文顯示。
 *
 * 訂單狀態(對應 prisma OrderStatus enum):
 *   PENDING / AUTHED / PAID / CONFIRMED / DELIVERED / DELIVERY_FAILED /
 *   CANCELLED / FAILED
 *
 * UI 合併規則(後端狀態機未變,僅前端顯示)
 *   - PENDING + AUTHED → 「待付款」(同一階段:玩家還在 MyCard 頁面)
 *   - PAID + CONFIRMED → 「已付款」(同一階段:錢已到手,等派發)
 *
 * 商品狀態(對應 prisma ProductStatus enum):
 *   ACTIVE / INACTIVE
 */

const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING: '待付款',
  AUTHED: '待付款',
  PAID: '已付款',
  CONFIRMED: '已付款',
  DELIVERED: '已派發',
  DELIVERY_FAILED: '派發失敗',
  CANCELLED: '已取消',
  FAILED: '付款失敗',
};

const ORDER_STATUS_COLOR: Record<string, string> = {
  PENDING: 'bg-slate-100 text-slate-600',
  AUTHED: 'bg-slate-100 text-slate-600',
  PAID: 'bg-cyan-100 text-cyan-700',
  CONFIRMED: 'bg-cyan-100 text-cyan-700',
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

/**
 * Filter 下拉只列「使用者視角」的合併群組:
 *   AUTHED / CONFIRMED 是 transient 狀態,撐不過幾秒,filter 不單獨列。
 *   要看精準狀態請進訂單詳情頁(badge 仍會顯示 PAID vs CONFIRMED 的差別?
 *   不會 — 因為 label/color 已合併,精準狀態看 raw JSON 區塊)
 */
export const ORDER_STATUS_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '全部' },
  { value: 'PENDING', label: '待付款' },
  { value: 'PAID', label: '已付款' },
  { value: 'DELIVERED', label: '已派發' },
  { value: 'DELIVERY_FAILED', label: '派發失敗' },
  { value: 'CANCELLED', label: '已取消' },
  { value: 'FAILED', label: '付款失敗' },
];

const PRODUCT_STATUS_LABEL: Record<string, string> = {
  ACTIVE: '啟用',
  INACTIVE: '下架',
};

export function productStatusLabel(status: string): string {
  return PRODUCT_STATUS_LABEL[status] ?? status;
}
