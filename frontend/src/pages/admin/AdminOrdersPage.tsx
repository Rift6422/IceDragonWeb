import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchOrders, type ListOrdersQuery } from '@/api/admin';
import { ORDER_STATUS_FILTER_OPTIONS, orderStatusColor, orderStatusLabel } from '@/utils/statusLabel';

export function AdminOrdersPage() {
  const [filter, setFilter] = useState<ListOrdersQuery>({ limit: 50, offset: 0 });

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'orders', filter],
    queryFn: () => fetchOrders(filter),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">訂單</h1>

      {/* Filter */}
      <div className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="label text-xs">狀態</label>
          <select
            className="input mt-1 w-40"
            value={filter.status ?? ''}
            onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value || undefined, offset: 0 }))}
          >
            {ORDER_STATUS_FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label text-xs">廠商交易序號</label>
          <input
            className="input mt-1 w-56"
            placeholder="FacTradeSeq"
            value={filter.fac_trade_seq ?? ''}
            onChange={(e) => setFilter((f) => ({ ...f, fac_trade_seq: e.target.value || undefined, offset: 0 }))}
          />
        </div>
        <div>
          <label className="label text-xs">玩家 UID</label>
          <input
            className="input mt-1 w-44"
            placeholder="16 碼 hex"
            value={filter.user_uid ?? ''}
            onChange={(e) => setFilter((f) => ({ ...f, user_uid: e.target.value.toUpperCase() || undefined, offset: 0 }))}
          />
        </div>
        <button
          className="btn-secondary"
          onClick={() => setFilter({ limit: 50, offset: 0 })}
        >
          清除
        </button>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="card">載入中...</div>
      ) : !data || data.items.length === 0 ? (
        <div className="card text-sm text-slate-400">無資料</div>
      ) : (
        <>
          <div className="text-sm text-slate-600">共 {data.total} 筆</div>
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">交易序號</th>
                  <th className="px-3 py-2 text-left">狀態</th>
                  <th className="px-3 py-2 text-left">玩家</th>
                  <th className="px-3 py-2 text-left">商品</th>
                  <th className="px-3 py-2 text-right">金額</th>
                  <th className="px-3 py-2 text-left">時間</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <Link to={`/admin/orders/${o.id}`} className="font-mono text-xs text-brand-600 hover:underline">
                        {o.fac_trade_seq}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <StatusBadge status={o.status} />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{o.user.uid}</td>
                    <td className="px-3 py-2 text-xs">{o.product.code}</td>
                    <td className="px-3 py-2 text-right">NT$ {o.amount}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{new Date(o.created_at).toLocaleString('zh-TW')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-500">
              {(filter.offset ?? 0) + 1} - {Math.min((filter.offset ?? 0) + (filter.limit ?? 50), data.total)} / {data.total}
            </div>
            <div className="flex gap-2">
              <button
                className="btn-secondary"
                disabled={(filter.offset ?? 0) === 0}
                onClick={() => setFilter((f) => ({ ...f, offset: Math.max(0, (f.offset ?? 0) - (f.limit ?? 50)) }))}
              >
                上一頁
              </button>
              <button
                className="btn-secondary"
                disabled={(filter.offset ?? 0) + (filter.limit ?? 50) >= data.total}
                onClick={() => setFilter((f) => ({ ...f, offset: (f.offset ?? 0) + (f.limit ?? 50) }))}
              >
                下一頁
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${orderStatusColor(status)}`}>
      {orderStatusLabel(status)}
    </span>
  );
}
