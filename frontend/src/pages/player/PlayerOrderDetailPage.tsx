import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { extractErrorMessage } from '@/api/client';
import { fetchMyOrderDetail, type OrderStatus, type PlayerOrderDetail } from '@/api/player';

const STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: '待付款',
  AUTHED: '已授權,待付款',
  PAID: '付款完成,結算中',
  CONFIRMED: '已請款,等待派發',
  DELIVERED: '已派發到信箱',
  DELIVERY_FAILED: '派發失敗,請聯絡客服',
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

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${y}/${m}/${day} ${hh}:${mm}:${ss}`;
}

export function PlayerOrderDetailPage() {
  const { facTradeSeq } = useParams<{ facTradeSeq: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ['player', 'order-detail', facTradeSeq],
    queryFn: () => fetchMyOrderDetail(facTradeSeq!),
    enabled: !!facTradeSeq,
    refetchInterval: (q) => {
      // 終態不再輪詢;中間狀態 10 秒重抓一次,讓 callback 完成後玩家頁能自動更新
      const status = (q.state.data as PlayerOrderDetail | undefined)?.status;
      if (!status) return false;
      const terminal: OrderStatus[] = ['DELIVERED', 'CANCELLED', 'FAILED', 'DELIVERY_FAILED'];
      return terminal.includes(status) ? false : 10_000;
    },
  });

  return (
    <div className="mx-auto max-w-2xl px-3 py-4 sm:px-6 sm:py-6">
      <header className="mb-4 flex items-baseline justify-between sm:mb-6">
        <Link to="/orders" className="text-sm text-brand-600 hover:underline">
          ← 我的訂單
        </Link>
      </header>

      {isLoading ? (
        <div className="card">載入中…</div>
      ) : error ? (
        <div className="card text-sm text-rose-600">
          載入失敗:{extractErrorMessage(error)}
        </div>
      ) : !data ? (
        <div className="card text-sm text-slate-500">找不到此訂單</div>
      ) : (
        <OrderDetailBody order={data} />
      )}
    </div>
  );
}

function OrderDetailBody({ order }: { order: PlayerOrderDetail }) {
  return (
    <article className="space-y-3 sm:space-y-4">
      {/* 狀態與商品 */}
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-3 flex items-center gap-2">
          <span
            className={
              'rounded-full px-3 py-1 text-xs font-medium sm:text-sm ' +
              STATUS_STYLES[order.status]
            }
          >
            {STATUS_LABELS[order.status]}
          </span>
        </div>
        <h1 className="text-lg font-bold text-slate-900 sm:text-xl">
          {order.product_name}
        </h1>
        <p className="mt-1 text-xs text-slate-500 sm:text-sm">{order.product_code}</p>
        <div className="mt-3 text-2xl font-bold text-brand-700 sm:mt-4 sm:text-3xl">
          NT$ {order.amount}
          <span className="ml-2 text-xs font-normal text-slate-400 sm:text-sm">
            {order.currency}
          </span>
        </div>
      </section>

      {/* 交易序號 */}
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          交易序號
        </h2>
        <p className="break-all font-mono text-xs text-slate-800 sm:text-sm">
          {order.fac_trade_seq}
        </p>
      </section>

      {/* 時間軸 */}
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          進度時間軸
        </h2>
        <ul className="space-y-3 text-sm">
          <Timeline label="建單" at={order.created_at} done />
          <Timeline label="付款完成" at={order.paid_at} done={!!order.paid_at} />
          <Timeline
            label="派發到信箱"
            at={order.delivered_at}
            done={!!order.delivered_at}
            failed={order.status === 'DELIVERY_FAILED'}
          />
        </ul>
      </section>

      {/* MyCard 付款資訊(只在已付款後顯示)*/}
      {order.payment_type && (
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            付款資訊
          </h2>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">MyCard 付款方式</dt>
              <dd className="font-mono">{order.payment_type}</dd>
            </div>
            {order.pay_result !== null && order.pay_result !== undefined && (
              <div className="flex justify-between">
                <dt className="text-slate-500">付款結果</dt>
                <dd className="font-mono">
                  {order.pay_result === 3 ? '✅ 成功 (3)' : `❌ 失敗 (${order.pay_result})`}
                </dd>
              </div>
            )}
          </dl>
        </section>
      )}

      {/* 派發失敗時的客服提示 */}
      {order.status === 'DELIVERY_FAILED' && (
        <section className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          <strong>派發失敗:</strong> 系統重試多次後仍無法將商品送進遊戲信箱。
          請聯絡客服並提供上方交易序號。
        </section>
      )}
    </article>
  );
}

function Timeline({
  label,
  at,
  done,
  failed,
}: {
  label: string;
  at: string | null;
  done: boolean;
  failed?: boolean;
}) {
  const dot = failed ? '✗' : done ? '✓' : '○';
  const dotColor = failed
    ? 'bg-rose-500 text-white'
    : done
      ? 'bg-emerald-500 text-white'
      : 'bg-slate-200 text-slate-500';
  return (
    <li className="flex items-start gap-3">
      <span
        className={
          'mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ' + dotColor
        }
        aria-hidden
      >
        {dot}
      </span>
      <div className="flex-1">
        <div className={done ? 'text-slate-800' : 'text-slate-400'}>{label}</div>
        <div className="font-mono text-xs text-slate-400">{formatDateTime(at)}</div>
      </div>
    </li>
  );
}
