import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchDashboard } from '@/api/admin';

function StatCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'default' | 'warning' | 'danger' | 'success';
}) {
  const toneClass = {
    default: 'border-slate-200',
    warning: 'border-amber-300 bg-amber-50',
    danger: 'border-red-300 bg-red-50',
    success: 'border-emerald-300 bg-emerald-50',
  }[tone];

  return (
    <div className={`rounded-lg border bg-white p-4 ${toneClass}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

export function AdminDashboardPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: fetchDashboard,
    refetchInterval: 60_000,
  });

  if (isLoading) return <div className="card">載入中...</div>;
  if (isError) return <div className="card text-red-600">{(error as Error).message}</div>;
  if (!data) return null;

  const fmt = (n: number) => new Intl.NumberFormat('zh-TW').format(n);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">儀表板</h1>

      {/* 今日 */}
      <section>
        <h2 className="mb-2 text-sm font-medium text-slate-600">今日</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="今日成功訂單" value={data.today.delivered_count} tone="success" />
          <StatCard label="今日營收(TWD)" value={`NT$ ${fmt(data.today.revenue_twd)}`} />
          <StatCard
            label="今日訂單狀態"
            value={
              Object.keys(data.today.by_status).length === 0
                ? '無'
                : `${Object.keys(data.today.by_status).length} 種狀態`
            }
            hint={
              Object.entries(data.today.by_status)
                .map(([k, v]) => `${k}: ${v}`)
                .join(' / ') || undefined
            }
          />
        </div>
      </section>

      {/* 需要關注 */}
      <section>
        <h2 className="mb-2 text-sm font-medium text-slate-600">需要關注</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            label="派發失敗"
            value={data.attention.delivery_failed_count}
            tone={data.attention.delivery_failed_count > 0 ? 'danger' : 'default'}
            hint="需人工補單"
          />
          <StatCard
            label="24h callback 失敗"
            value={data.attention.callback_failed_24h}
            tone={data.attention.callback_failed_24h > 0 ? 'warning' : 'default'}
          />
          <StatCard
            label="超時未付款"
            value={data.attention.stale_authed_count}
            tone={data.attention.stale_authed_count > 0 ? 'warning' : 'default'}
            hint="AUTHED 超過 30 分"
          />
        </div>
      </section>

      {/* 累積 */}
      <section>
        <h2 className="mb-2 text-sm font-medium text-slate-600">累積</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="累積成功訂單" value={fmt(data.totals.delivered_count)} />
          <StatCard label="累積營收(TWD)" value={`NT$ ${fmt(data.totals.delivered_revenue_twd)}`} />
          <StatCard label="玩家總數" value={fmt(data.totals.game_user_count)} />
          <StatCard
            label="商品上架中"
            value={`${data.totals.product_active_count} / ${data.totals.product_total_count}`}
          />
        </div>
      </section>

      {/* 最近訂單 */}
      <section>
        <h2 className="mb-2 text-sm font-medium text-slate-600">最近訂單</h2>
        {data.recent_orders.length === 0 ? (
          <div className="card text-sm text-slate-400">尚無訂單</div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">交易序號</th>
                  <th className="px-4 py-2 text-left">狀態</th>
                  <th className="px-4 py-2 text-right">金額</th>
                  <th className="px-4 py-2 text-left">時間</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.recent_orders.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2">
                      <Link to={`/admin/orders/${o.id}`} className="font-mono text-xs text-brand-600 hover:underline">
                        {o.fac_trade_seq}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-xs">{o.status}</td>
                    <td className="px-4 py-2 text-right">NT$ {o.amount}</td>
                    <td className="px-4 py-2 text-xs text-slate-500">{new Date(o.created_at).toLocaleString('zh-TW')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
