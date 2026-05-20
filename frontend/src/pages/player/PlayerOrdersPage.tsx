import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { extractErrorMessage } from '@/api/client';
import { fetchMyOrders, type OrderStatus, type PlayerOrderListItem } from '@/api/player';
import { isValidUid, normalizeUid } from '@/features/player/uid.store';

const STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: '待付款',
  AUTHED: '已授權,待付款',
  PAID: '付款完成,結算中',
  CONFIRMED: '已請款,等待派發',
  DELIVERED: '已派發',
  DELIVERY_FAILED: '派發失敗',
  CANCELLED: '已取消',
  FAILED: '失敗',
};

const STATUS_STYLES: Record<OrderStatus, string> = {
  PENDING: 'bg-slate-100 text-slate-700',
  AUTHED: 'bg-amber-100 text-amber-700',
  PAID: 'bg-blue-100 text-blue-700',
  CONFIRMED: 'bg-blue-100 text-blue-700',
  DELIVERED: 'bg-emerald-100 text-emerald-700',
  DELIVERY_FAILED: 'bg-rose-100 text-rose-700',
  CANCELLED: 'bg-slate-200 text-slate-600',
  FAILED: 'bg-rose-100 text-rose-700',
};

function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={'rounded-full px-2.5 py-0.5 text-xs font-medium ' + STATUS_STYLES[status]}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}/${m}/${day} ${hh}:${mm}`;
}

/**
 * 我的訂單 — 輸入 UID 搜尋。
 *
 * 跟商品頁的 UID 輸入框獨立,不會自動帶入(這是搜尋頁,不是登入頁)。
 * 沒搜尋過 → 顯示說明 + 範例 UID。
 * 搜尋後 → 顯示該 UID 的所有訂單。
 */
export function PlayerOrdersPage() {
  const [uidInput, setUidInput] = useState('');
  const [searchedUid, setSearchedUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, error: queryError } = useQuery({
    queryKey: ['player', 'orders', searchedUid],
    queryFn: () => fetchMyOrders(searchedUid!),
    enabled: !!searchedUid,
    staleTime: 10_000,
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const value = normalizeUid(uidInput);
    if (!isValidUid(value)) {
      setError('UID 必須是 16 碼英數(0-9, A-F)');
      return;
    }
    setSearchedUid(value);
  };

  return (
    <div className="mx-auto max-w-3xl px-3 py-4 sm:px-6 sm:py-6">
      <header className="mb-4 sm:mb-6">
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">我的訂單</h1>
        <p className="mt-1 text-sm text-slate-500">輸入遊戲 UID 查詢儲值紀錄</p>
      </header>

      <form
        onSubmit={onSubmit}
        className="mb-4 rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:mb-6 sm:p-4"
      >
        <label htmlFor="search-uid" className="label mb-2 block">
          遊戲 UID
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="search-uid"
            type="text"
            value={uidInput}
            onChange={(e) => {
              setUidInput(e.target.value);
              if (error) setError(null);
            }}
            placeholder="E9E3E1A9071AF9DC"
            maxLength={16}
            inputMode="text"
            autoCapitalize="characters"
            className={
              'input flex-1 font-mono uppercase tracking-wider ' +
              (error ? 'border-rose-400 ring-2 ring-rose-200' : '')
            }
            autoComplete="off"
          />
          <button type="submit" className="btn-primary py-3 sm:w-32 sm:py-2.5">
            搜尋
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          16 碼大寫英數,例:<span className="font-mono">E9E3E1A9071AF9DC</span>
        </p>
        {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
      </form>

      {/* 尚未搜尋 — 顯示說明 */}
      {!searchedUid && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
          <div className="mb-2 text-3xl">🔍</div>
          <p>輸入您的遊戲 UID 後按「搜尋」即可看到該 UID 的所有訂單。</p>
          <Link to="/" className="mt-3 inline-block text-brand-600 hover:underline">
            ← 回商品列表
          </Link>
        </div>
      )}

      {/* 已搜尋 — 顯示結果 */}
      {searchedUid && (
        <ResultsArea
          uid={searchedUid}
          loading={isLoading}
          error={queryError}
          orders={data?.items ?? []}
          total={data?.total ?? 0}
        />
      )}
    </div>
  );
}

function ResultsArea({
  uid,
  loading,
  error,
  orders,
  total,
}: {
  uid: string;
  loading: boolean;
  error: unknown;
  orders: PlayerOrderListItem[];
  total: number;
}) {
  if (loading) return <div className="card">載入中…</div>;
  if (error)
    return (
      <div className="card text-sm text-rose-600">載入失敗:{extractErrorMessage(error)}</div>
    );
  if (orders.length === 0)
    return (
      <div className="card text-center text-sm text-slate-500">
        <div className="mb-2 text-3xl">📦</div>
        <p>
          UID <span className="font-mono text-slate-800">{uid}</span> 尚無訂單紀錄。
        </p>
        <p className="mt-1 text-xs text-slate-400">
          (UID 不存在 / 該 UID 沒下過單 都會顯示此畫面)
        </p>
      </div>
    );
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        UID <span className="font-mono text-slate-800">{uid}</span> — 共 {total} 筆訂單
      </p>
      {orders.map((o) => (
        <OrderRow key={o.fac_trade_seq} order={o} />
      ))}
    </div>
  );
}

function OrderRow({ order }: { order: PlayerOrderListItem }) {
  return (
    <Link
      to={`/orders/${order.fac_trade_seq}`}
      className="block rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-400 hover:shadow active:scale-[0.99] sm:p-4"
    >
      <div className="flex items-center justify-between gap-2 sm:gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <StatusBadge status={order.status} />
            <span className="truncate text-sm font-semibold text-slate-800">
              {order.product_name}
            </span>
          </div>
          <div className="mt-1 break-all font-mono text-[11px] text-slate-500 sm:text-xs">
            {order.fac_trade_seq}
          </div>
          <div className="mt-1 text-[11px] text-slate-400 sm:text-xs">
            建立於 {formatDateTime(order.created_at)}
            {order.delivered_at && (
              <>
                <span className="hidden sm:inline"> · </span>
                <br className="sm:hidden" />
                <span>派發於 {formatDateTime(order.delivered_at)}</span>
              </>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold text-brand-700">NT$ {order.amount}</div>
          <div className="text-xs text-slate-400">查看詳情 →</div>
        </div>
      </div>
    </Link>
  );
}
