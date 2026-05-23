import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { extractErrorMessage } from '@/api/client';
import { fetchOrderDetail, retryCallback } from '@/api/admin';
import { orderStatusColor, orderStatusLabel } from '@/utils/statusLabel';

export function AdminOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [showRaw, setShowRaw] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'orders', id],
    queryFn: () => fetchOrderDetail(id!),
    enabled: !!id,
  });

  const retryMut = useMutation({
    mutationFn: (input: { facTradeSeq: string; force?: boolean }) =>
      retryCallback(input.facTradeSeq, { force: input.force }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'orders', id] });
    },
  });

  if (isLoading) return <div className="card">載入中…</div>;
  if (error) return <div className="card text-red-600">{(error as Error).message}</div>;
  if (!data) return <div className="card text-slate-500">查無此訂單</div>;

  const order = data;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link to="/admin/orders" className="text-sm text-brand-600 hover:underline">
          ← 返回列表
        </Link>
        <h1 className="text-2xl font-bold">訂單詳情</h1>
      </div>

      {/* Summary card */}
      <div className="card space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs text-slate-500">廠商交易序號</div>
            <div className="font-mono text-base">{order.facTradeSeq}</div>
          </div>
          <span className={`rounded px-3 py-1 text-sm font-medium ${orderStatusColor(order.status)}`}>
            {orderStatusLabel(order.status)}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <Field label="玩家 UID">
            <span className="font-mono text-xs">{order.user?.uid}</span>
          </Field>
          <Field label="商品">{order.product?.nameDisplay ?? order.product?.code}</Field>
          <Field label="金額">NT$ {order.amount}</Field>
          <Field label="付款方式">{order.transaction?.paymentType ?? '—'}</Field>
          <Field label="MyCard 交易號">
            <span className="font-mono text-xs">{order.transaction?.mycardTradeNo ?? '—'}</span>
          </Field>
          <Field label="PayResult">{order.transaction?.payResult ?? '—'}</Field>
          <Field label="建立">{formatTs(order.createdAt)}</Field>
          <Field label="已授權">{formatTs(order.authedAt)}</Field>
          <Field label="已付款">{formatTs(order.paidAt)}</Field>
          <Field label="已請款">{formatTs(order.confirmedAt)}</Field>
          <Field label="已派發">{formatTs(order.deliveredAt)}</Field>
        </div>
      </div>

      {/* 補派獎按鈕 */}
      <div className="card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-slate-900">補派獎至遊戲端</h3>
            <p className="mt-1 text-xs text-slate-500">
              {order.status === 'DELIVERED'
                ? '此單已派發成功。如玩家堅稱未收到禮包,可強制重派 — 注意:會再呼叫一次 PlayFab grantrmproduct,可能導致玩家收到第二份禮包或多扣限購 quota。'
                : '觸發後端 reprocessOne:打 MyCard TradeQuery 確認付款狀態,若已付款則 PaymentConfirm + 派發到 PlayFab。與 §3.6 supplement 同一支邏輯,有冪等保護。'}
            </p>
          </div>
          <button
            onClick={() => {
              if (order.status === 'DELIVERED') {
                // 強制重派 — 需要二次確認
                const confirmed = window.confirm(
                  `⚠️ 此訂單已派發成功(${formatTs(order.deliveredAt)})\n\n` +
                    `強制重派會再次呼叫遊戲端 grantrmproduct,可能讓玩家收到第二份禮包,` +
                    `也可能多扣 PlayFab 限購 quota。\n\n` +
                    `確定要強制重派嗎?`,
                );
                if (!confirmed) return;
                retryMut.mutate({ facTradeSeq: order.facTradeSeq, force: true });
                return;
              }
              retryMut.mutate({ facTradeSeq: order.facTradeSeq });
            }}
            disabled={retryMut.isPending}
            className={
              order.status === 'DELIVERED'
                ? 'btn-secondary whitespace-nowrap border-amber-400 text-amber-700 hover:bg-amber-50'
                : 'btn-primary whitespace-nowrap'
            }
          >
            {retryMut.isPending
              ? '處理中…'
              : order.status === 'DELIVERED'
              ? '強制重派'
              : '補派獎'}
          </button>
        </div>
        {retryMut.data && (
          <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            {retryMut.data.message ?? `已執行:狀態 ${retryMut.data.status}`}
          </div>
        )}
        {retryMut.error && (
          <div className="mt-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            失敗:{extractErrorMessage(retryMut.error)}
          </div>
        )}
      </div>

      {/* Raw JSON toggle */}
      <div className="card">
        <button
          onClick={() => setShowRaw((s) => !s)}
          className="text-sm text-slate-600 hover:text-brand-600"
        >
          {showRaw ? '▼' : '▶'} 完整 JSON(含 callback / status history / delivery attempts)
        </button>
        {showRaw && (
          <pre className="mt-3 max-h-[600px] overflow-auto rounded bg-slate-900 p-4 text-xs text-slate-100">
            {JSON.stringify(order, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-sm text-slate-800">{children}</div>
    </div>
  );
}

function formatTs(s: string | null | undefined): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString('zh-TW');
  } catch {
    return '—';
  }
}

