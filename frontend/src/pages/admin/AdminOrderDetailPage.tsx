import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { fetchOrderDetail } from '@/api/admin';

export function AdminOrderDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'orders', id],
    queryFn: () => fetchOrderDetail(id!),
    enabled: !!id,
  });

  if (isLoading) return <div className="card">載入中...</div>;
  if (error) return <div className="card text-red-600">{(error as Error).message}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link to="/admin/orders" className="text-sm text-brand-600 hover:underline">
          ← 返回列表
        </Link>
        <h1 className="text-2xl font-bold">訂單詳情</h1>
      </div>

      <div className="card">
        <p className="text-sm text-slate-500">
          訂單詳情 raw JSON(後續會做精緻 UI,本期 MVP 直接顯示)
        </p>
        <pre className="mt-3 overflow-auto rounded bg-slate-900 p-4 text-xs text-slate-100">
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>

      <div className="card bg-amber-50 border-amber-200">
        <h3 className="font-semibold text-amber-900">v1.0 加強(Stage 3 Part 3 完成後)</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-800">
          <li>同步 MyCard 狀態(打 TradeQuery)</li>
          <li>手動補請款(打 PaymentConfirm)</li>
          <li>手動重派發</li>
          <li>狀態歷程時間軸 UI</li>
          <li>Callback 流水分頁顯示</li>
        </ul>
      </div>
    </div>
  );
}
