import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { submitAccountVerify, type VerifyResult } from '@/api/redeem';
import { isValidUid, normalizeUid } from '@/features/player/uid.store';

/**
 * MyCard Model B 第 4-7 步:玩家驗證頁。
 *
 * MyCard 把玩家瀏覽器導到 /api/mycard/direct-topup/account-verify?token=... ,
 * 後端 302 → 本頁 (/redeem-verify?token=...) 。
 *
 * 玩家在此輸入 UID,前端 POST 給 backend 驗證,顯示結果。
 */
export function RedeemVerifyPage() {
  const [search] = useSearchParams();
  const verifyToken = search.get('token') ?? '';

  const [uid, setUid] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!verifyToken) setError('缺少驗證 token,請從 MyCard 重新進入');
  }, [verifyToken]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const value = normalizeUid(uid);
    if (!isValidUid(value)) {
      setError('UID 必須是 16 碼英數(0-9, A-F)');
      return;
    }
    setSubmitting(true);
    try {
      const r = await submitAccountVerify(verifyToken, value);
      setResult(r);
    } catch (err) {
      setError((err as Error).message ?? 'submit failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-6 py-12">
      <section className="mb-6 text-center">
        <div className="mb-2 text-5xl">🔐</div>
        <h1 className="text-2xl font-bold text-slate-900">MyCard 直接儲值 — 帳號驗證</h1>
        <p className="mt-2 text-sm text-slate-500">
          請輸入您的遊戲 UID 完成驗證,系統會將商品送至遊戲信箱
        </p>
      </section>

      {result === 0 ? (
        <ResultPanel
          ok
          title="驗證成功"
          message="MyCard 將完成儲值,商品會自動寄入您的遊戲信箱。"
        />
      ) : result === -1 ? (
        <ResultPanel
          title="驗證失敗"
          message="UID 不存在或帳號已停用。請確認 UID 後從 MyCard 重新進入此頁。"
        />
      ) : result === -2 ? (
        <ResultPanel
          title="連結已過期"
          message="此驗證連結已過期或已使用。請從 MyCard 重新發起儲值流程。"
        />
      ) : (
        <form onSubmit={onSubmit} className="card space-y-4">
          <div>
            <label className="label mb-1 block">遊戲 UID</label>
            <input
              type="text"
              value={uid}
              onChange={(e) => setUid(e.target.value)}
              placeholder="E9E3E1A9071AF9DC"
              maxLength={16}
              className="input font-mono uppercase tracking-wider"
              autoFocus
              autoComplete="off"
            />
            <p className="mt-1 text-xs text-slate-400">
              16 碼大寫英數,例:<span className="font-mono">E9E3E1A9071AF9DC</span>
            </p>
            {error && <p className="mt-1 text-sm text-rose-600">{error}</p>}
          </div>

          <button type="submit" className="btn-primary w-full" disabled={submitting}>
            {submitting ? '驗證中…' : '確認驗證'}
          </button>

          <p className="mt-2 text-center text-xs text-slate-400">
            此頁面由 MyCard 安全跳轉,完成驗證後請勿關閉視窗
          </p>
        </form>
      )}

      <section className="mt-8 rounded-lg bg-slate-100 p-3 text-xs text-slate-500">
        <strong>Token:</strong>{' '}
        <span className="font-mono">{verifyToken || '(無)'}</span>
      </section>
    </div>
  );
}

function ResultPanel({
  ok,
  title,
  message,
}: {
  ok?: boolean;
  title: string;
  message: string;
}) {
  return (
    <div
      className={
        'card border ' +
        (ok ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50')
      }
    >
      <div className="mb-2 text-3xl">{ok ? '✅' : '❌'}</div>
      <h2 className={'mb-1 font-semibold ' + (ok ? 'text-emerald-800' : 'text-rose-800')}>
        {title}
      </h2>
      <p className={ok ? 'text-sm text-emerald-700' : 'text-sm text-rose-700'}>{message}</p>
    </div>
  );
}
