import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { extractErrorMessage } from '@/api/client';
import { redeemCoupon, type RedeemCouponResponse } from '@/api/coupon';
import { verifyPlayerUid } from '@/api/player';
import { isValidUid, normalizeUid, usePlayerStore } from '@/features/player/uid.store';
import { notifyUnityCouponResult } from '@/lib/unity-bridge';

/**
 * 序號兌換頁(/redeem)。
 *
 * 兩段式,與商品頁同一套視覺:
 *   Stage 1:沒登入 → UID 輸入閘門(共用 usePlayerStore,商品頁登入過這裡免再登)
 *   Stage 2:登入後 → 頁首顯示 UID + 一個序號輸入框 + 兌換按鈕
 *
 * 序號兌換邏輯全在遊戲端,前端只送 UID + 序號,顯示遊戲端回的訊息。
 *
 * 註:每個遊戲各有自己的序號兌換(對應遊戲端的 redeemmycoupon function code,存 env)。
 *     未來多遊戲時改走路徑命名空間(見 docs / memory)。
 */
export function RedeemCouponPage() {
  const { uid, setIdentity, clear } = usePlayerStore();
  const loggedIn = !!uid && isValidUid(uid);

  if (!loggedIn) {
    return <UidGate onLogin={(value) => setIdentity(value)} />;
  }

  return <RedeemScreen uid={uid!} onChangeUid={clear} />;
}

// ============================================================
// UID 登入閘門(與商品頁同款)
// ============================================================

function UidGate({ onLogin }: { onLogin: (uid: string) => void }) {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const verifyMut = useMutation({
    mutationFn: (value: string) => verifyPlayerUid(value),
    onSuccess: (result, value) => {
      if (result.valid) {
        onLogin(value);
      } else {
        setError(
          result.reason === 'NOT_FOUND'
            ? '此 UID 在遊戲端找不到,請確認 UID 是否正確'
            : '驗證失敗,請稍後再試',
        );
      }
    },
    onError: (err) => setError(`連線失敗:${extractErrorMessage(err)}`),
  });

  const submitting = verifyMut.isPending;

  const submit = () => {
    const normalized = normalizeUid(input);
    if (!isValidUid(normalized)) {
      setError('UID 必須是 16 碼英數(0-9, A-F)');
      return;
    }
    setError(null);
    verifyMut.mutate(normalized);
  };

  return (
    <div className="mx-auto flex min-h-[85vh] max-w-md flex-col items-center justify-center px-4 py-6">
      <div className="mb-6 flex items-center gap-3 text-center">
        <img
          src="/brand/shindai-icon.png"
          alt="神代紀事"
          className="h-16 w-16 flex-shrink-0 rounded-lg"
          style={{ imageRendering: 'pixelated' }}
        />
        <h1 className="text-xl font-bold leading-tight text-slate-900 sm:text-2xl">
          神代紀事<br className="sm:hidden" />
          <span className="block sm:inline sm:ml-1">序號兌換</span>
        </h1>
      </div>

      <div className="w-full rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="mb-4 text-base font-semibold text-slate-900">請輸入遊戲 UID</h2>
        <input
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !submitting) submit();
          }}
          placeholder="請輸入遊戲 UID"
          maxLength={16}
          inputMode="text"
          autoCapitalize="characters"
          autoFocus
          disabled={submitting}
          className={
            'input w-full font-mono uppercase tracking-wider ' +
            (error ? 'border-rose-400 ring-2 ring-rose-200' : '')
          }
          autoComplete="off"
        />
        {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
        <button
          onClick={submit}
          disabled={submitting}
          className="btn-primary mt-4 w-full py-3 text-base"
        >
          {submitting ? '驗證中…' : '下一步'}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// 兌換畫面
// ============================================================

function RedeemScreen({ uid, onChangeUid }: { uid: string; onChangeUid: () => void }) {
  const [code, setCode] = useState('');
  const [result, setResult] = useState<RedeemCouponResponse | null>(null);
  /** 兌換完成後的短暫冷卻,避免連點(延遲防呆)*/
  const [cooldown, setCooldown] = useState(false);

  const redeemMut = useMutation({
    mutationFn: async (couponCode: string) => {
      // 最短 700ms loading:避免畫面閃爍,同時讓玩家明確感受到「處理中」(防呆)
      const [res] = await Promise.all([
        redeemCoupon(uid, couponCode),
        new Promise((r) => setTimeout(r, 700)),
      ]);
      return res;
    },
    onSuccess: (res, couponCode) => {
      setResult(res);
      // 與購買流程一致:兌換完成後通知 Unity(讓遊戲端刷新信箱/道具)
      notifyUnityCouponResult({
        type: 'coupon',
        success: res.success,
        message: res.message,
        couponCode,
      });
    },
    onError: (err, couponCode) => {
      const res: RedeemCouponResponse = {
        success: false,
        message: extractErrorMessage(err) || '兌換失敗,請稍後再試',
      };
      setResult(res);
      notifyUnityCouponResult({
        type: 'coupon',
        success: false,
        message: res.message,
        couponCode,
      });
    },
    onSettled: () => {
      setCooldown(true);
      setTimeout(() => setCooldown(false), 1200);
    },
  });

  const trimmed = code.trim();
  const busy = redeemMut.isPending || cooldown;
  const canSubmit = trimmed.length > 0 && !busy;

  const submit = () => {
    if (!canSubmit) return;
    setResult(null);
    redeemMut.mutate(trimmed);
  };

  return (
    <div className="mx-auto max-w-5xl px-3 py-4 sm:px-6 sm:py-6">
      {/* 頁首 — 與商品頁同款(同寬 max-w-5xl),中間呈現登入(UID)資訊 */}
      <section className="mb-4 overflow-hidden rounded-lg bg-gradient-to-r from-brand-600 to-brand-800 p-4 text-white shadow-lg sm:mb-6 sm:rounded-xl sm:p-6">
        <div className="flex items-center justify-between gap-3 sm:gap-4">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <img
              src="/brand/shindai-icon.png"
              alt="神代紀事"
              className="h-12 w-12 flex-shrink-0 rounded-lg bg-white/10 p-1 sm:h-16 sm:w-16"
              style={{ imageRendering: 'pixelated' }}
            />
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold leading-tight sm:text-2xl md:text-3xl">
                神代紀事 序號兌換
              </h1>
              <p className="mt-0.5 truncate text-xs text-white/80 sm:text-sm">
                <span className="opacity-70">UID:</span>{' '}
                <span className="font-mono">{uid}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onChangeUid}
            disabled={redeemMut.isPending}
            className="flex-shrink-0 rounded border border-white/30 px-2.5 py-1.5 text-xs font-medium text-white/90 transition-colors hover:bg-white/10 disabled:opacity-40 sm:px-3 sm:py-2 sm:text-sm"
          >
            更換 UID
          </button>
        </div>
      </section>

      {/* 序號輸入卡 — 頁首維持全寬,輸入卡置中為易讀寬度 */}
      <section className="mx-auto max-w-xl rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <label htmlFor="coupon-code" className="label mb-1.5 block">
          兌換序號
        </label>
        <input
          id="coupon-code"
          type="text"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            if (result) setResult(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          placeholder="請輸入兌換序號"
          maxLength={64}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          disabled={redeemMut.isPending}
          className="input w-full font-mono tracking-wider"
        />
        <p className="mt-1.5 text-xs text-slate-400">
          兌換成功的商品將直接存入倉庫
        </p>

        <button
          onClick={submit}
          disabled={!canSubmit}
          className="btn-primary mt-4 flex w-full items-center justify-center gap-2 py-3 text-base"
        >
          {redeemMut.isPending && (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          )}
          {redeemMut.isPending ? '兌換中…' : '確認兌換'}
        </button>
      </section>

      {/* 兌換結果 — 成功 / 失敗都跳 modal 提醒 */}
      {result && !redeemMut.isPending && (
        <RedeemResultModal
          result={result}
          onClose={() => {
            // 兌換成功後清空序號欄,避免重複送同一組
            if (result.success) setCode('');
            setResult(null);
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// RedeemResultModal — 兌換結果提醒彈窗
// ============================================================

/**
 * 兌換完成後跳出的提醒(成功 / 失敗共用)。
 * 顯示遊戲端回傳的 message;失敗時為紅色警示樣式,成功時為綠色。
 */
function RedeemResultModal({
  result,
  onClose,
}: {
  result: RedeemCouponResponse;
  onClose: () => void;
}) {
  const ok = result.success;
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/70 px-4 backdrop-blur-sm"
      onClick={onClose}
      role="alertdialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 色塊 header + 大字 ✓ / ✗ — 與購買付款結果 modal 一致 */}
        <div
          className={
            'flex flex-col items-center gap-3 px-5 py-6 sm:px-6 ' +
            (ok ? 'bg-emerald-50' : 'bg-rose-50')
          }
        >
          <div className={'text-5xl ' + (ok ? 'text-emerald-500' : 'text-rose-500')}>
            {ok ? '✓' : '✗'}
          </div>
          <div className="text-center">
            <h2
              className={
                'text-lg font-bold sm:text-xl ' + (ok ? 'text-emerald-900' : 'text-rose-900')
              }
            >
              {ok ? '兌換成功' : '兌換失敗'}
            </h2>
            <p
              className={
                'mt-1 whitespace-pre-line text-sm ' + (ok ? 'text-emerald-700' : 'text-rose-700')
              }
            >
              {result.message}
            </p>
          </div>
        </div>
        <div className="border-t border-slate-100 bg-slate-50 px-5 py-3 sm:px-6">
          <button onClick={onClose} className="btn-primary w-full py-2.5" autoFocus>
            我知道了
          </button>
        </div>
      </div>
    </div>
  );
}
