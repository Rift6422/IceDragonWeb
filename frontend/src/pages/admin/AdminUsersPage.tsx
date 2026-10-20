import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchUserDetail, fetchUsers, type AdminUserDetail } from '@/api/admin';

export function AdminUsersPage() {
  const [uidSearch, setUidSearch] = useState('');
  const [openUserId, setOpenUserId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', uidSearch],
    queryFn: () =>
      fetchUsers({
        uid: uidSearch || undefined,
        limit: 100,
      }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">玩家(GameUser)</h1>
        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
          read-only(由遊戲端建立)
        </span>
      </div>

      <div className="card flex gap-3">
        <div>
          <label className="label text-xs">UID(部分或完整)</label>
          <input
            className="input mt-1 w-44 font-mono uppercase"
            placeholder="E9E3E1A9..."
            value={uidSearch}
            onChange={(e) => setUidSearch(e.target.value.toUpperCase())}
          />
        </div>
        {uidSearch && (
          <div className="self-end">
            <button onClick={() => setUidSearch('')} className="btn-secondary">
              清除
            </button>
          </div>
        )}
      </div>

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
                  <th className="px-3 py-2 text-left">UID</th>
                  <th className="px-3 py-2 text-right">累積消費</th>
                  <th className="px-3 py-2 text-center">訂單數</th>
                  <th className="px-3 py-2 text-left">建立時間</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono text-xs">{u.uid}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-slate-800">
                      {Number(u.total_spent_twd) > 0
                        ? `NT$ ${Number(u.total_spent_twd).toLocaleString('zh-TW')}`
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-center text-xs text-slate-500">
                      {u.delivered_order_count}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {new Date(u.created_at).toLocaleString('zh-TW')}
                    </td>
                    <td className="px-3 py-2 text-right text-xs">
                      <button
                        onClick={() => setOpenUserId(u.id)}
                        className="text-brand-600 hover:underline"
                      >
                        詳情
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {openUserId && <UserDetailModal userId={openUserId} onClose={() => setOpenUserId(null)} />}
    </div>
  );
}

function UserDetailModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'user-detail', userId],
    queryFn: () => fetchUserDetail(userId),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 px-4 py-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3">
          <h2 className="text-lg font-semibold">玩家詳情</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="關閉">
            ✕
          </button>
        </div>

        <div className="space-y-5 px-5 py-4">
          {isLoading ? (
            <div className="py-8 text-center text-sm text-slate-400">載入中…</div>
          ) : error ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              載入失敗
            </div>
          ) : data ? (
            <UserDetailBody data={data} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

const ORDERS_PER_PAGE = 10;

function UserDetailBody({ data }: { data: AdminUserDetail }) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(data.orders.length / ORDERS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const startIdx = (currentPage - 1) * ORDERS_PER_PAGE;
  const pageOrders = data.orders.slice(startIdx, startIdx + ORDERS_PER_PAGE);

  return (
    <>
      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">基本資料</h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <Info label="UID" value={<span className="font-mono">{data.uid}</span>} />
          <Info
            label="累積消費"
            value={
              <span className="font-mono font-semibold text-brand-700">
                NT$ {Number(data.total_spent_twd).toLocaleString('zh-TW')}
              </span>
            }
          />
          <Info label="訂單數" value={String(data.delivered_order_count)} />
          <Info label="建立時間" value={new Date(data.created_at).toLocaleString('zh-TW')} />
        </dl>
      </section>

      {data.inventory_currencies.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">虛擬貨幣餘額</h3>
          <div className="flex flex-wrap gap-2">
            {data.inventory_currencies.map((c) => (
              <span
                key={c.currency_code}
                className="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-700"
              >
                {c.currency_code}: {c.balance}
              </span>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">
          已派發訂單(最近 100 筆,共 {data.orders.length} 筆)
        </h3>
        {data.orders.length === 0 ? (
          <div className="text-sm text-slate-400">尚無已派發訂單</div>
        ) : (
          <>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-2 py-1.5 text-left">派發時間</th>
                    <th className="px-2 py-1.5 text-left">商品</th>
                    <th className="px-2 py-1.5 text-right">金額</th>
                    <th className="px-2 py-1.5 text-left">交易序號</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pageOrders.map((o) => (
                    <tr key={o.id} className="hover:bg-slate-50">
                      <td className="px-2 py-1.5 text-slate-600">
                        {o.delivered_at
                          ? new Date(o.delivered_at).toLocaleString('zh-TW')
                          : new Date(o.created_at).toLocaleString('zh-TW')}
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="font-medium text-slate-800">{o.product_name}</div>
                        <div className="font-mono text-[10px] text-slate-400">{o.product_code}</div>
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        NT$ {Number(o.amount).toLocaleString('zh-TW')}
                      </td>
                      <td className="px-2 py-1.5">
                        <Link
                          to={`/admin/orders/${o.id}`}
                          className="font-mono text-[10px] text-brand-600 hover:underline"
                        >
                          {o.fac_trade_seq}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="mt-3 flex items-center justify-between text-xs">
                <div className="text-slate-500">
                  第 {startIdx + 1}–{Math.min(startIdx + ORDERS_PER_PAGE, data.orders.length)} 筆 /
                  共 {data.orders.length} 筆
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="rounded border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ← 上一頁
                  </button>
                  <span className="px-2 text-slate-600">
                    {currentPage} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="rounded border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    下一頁 →
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-800">{value}</dd>
    </div>
  );
}

