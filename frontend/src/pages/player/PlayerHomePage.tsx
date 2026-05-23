import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { extractErrorMessage } from '@/api/client';
import {
  createPlayerOrder,
  fetchMyOrderDetail,
  fetchPlayerProducts,
  verifyPlayerUid,
  type OrderStatus,
  type PlayerOrderDetail,
  type ProductCategory,
  type ProductEffect,
  type PublicProduct,
} from '@/api/player';
import { isValidUid, normalizeUid, usePlayerStore } from '@/features/player/uid.store';

/**
 * 玩家儲值兩段式流程:
 *   Stage 1:LoginScreen — 沒登入時的 UID 輸入閘門
 *   Stage 2:ProductsScreen — 登入後的商品列表 + modal + 購買流程
 *
 * Deep link `/?uid=...&item=...` 會自動 setIdentity + 後續開 modal。
 */

const TAB_LABELS: Record<ProductCategory, string> = {
  BUNDLE: '超值禮包',
  CURRENCY: '啟源石',
};

const TAB_ORDER: ProductCategory[] = ['BUNDLE', 'CURRENCY'];

const EFFECT_FALLBACK_NAMES: Record<string, string> = {
  DIAMOND: '啟源石',
  STONE: '啟源石',
  CRYSTAL: '源結晶',
};

function effectLabel(e: ProductEffect): string {
  return e.display_label ?? EFFECT_FALLBACK_NAMES[e.code] ?? e.code;
}
function effectAmount(e: ProductEffect): number {
  return e.amount ?? e.qty ?? 0;
}

const DEFAULT_BUNDLE_ICON = '/icons/bundle-default.jpg';
const DEFAULT_CURRENCY_ICON = '/icons/stone-default.jpg';

function productIcon(p: PublicProduct): string {
  return p.effects.icon ?? (p.category === 'BUNDLE' ? DEFAULT_BUNDLE_ICON : DEFAULT_CURRENCY_ICON);
}

export function isImageIcon(s: string): boolean {
  return s.startsWith('/') || s.startsWith('http://') || s.startsWith('https://');
}

function IconView({
  icon,
  alt,
  size,
}: {
  icon: string;
  alt: string;
  size: 'card' | 'modal';
}) {
  if (isImageIcon(icon)) {
    const px = size === 'modal' ? 96 : 72;
    return (
      <img
        src={icon}
        alt={alt}
        width={px}
        height={px}
        className="object-contain"
        style={{ imageRendering: 'pixelated', width: px, height: px }}
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = 'none';
        }}
      />
    );
  }
  return <span className={size === 'modal' ? 'text-7xl' : 'text-5xl'}>{icon}</span>;
}

// ============================================================
// PlayerHomePage — 登入閘門
// ============================================================

export function PlayerHomePage() {
  const [searchParams] = useSearchParams();
  const deepLinkUidRaw = (searchParams.get('uid') ?? '').toUpperCase();
  const deepLinkUid = /^[0-9A-F]{16}$/.test(deepLinkUidRaw) ? deepLinkUidRaw : '';
  const deepLinkItem = (
    searchParams.get('item') ??
    searchParams.get('itemId') ??
    searchParams.get('itemid') ??
    ''
  ).toUpperCase();
  /** ?paid={FacTradeSeq} = 玩家剛付完款從 MyCard 返回,要刷新限購狀態 */
  const paidFacTradeSeq = searchParams.get('paid') ?? '';
  /** ?result=success|fail|delivery_failed|cancelled = backend wait-and-join 已確認終態 */
  const paidResultHint = (searchParams.get('result') ?? '').toLowerCase();

  const { uid: storedUid, email, setIdentity, clear } = usePlayerStore();

  // Deep link UID 自動登入(只一次,且 store 內沒有相同 UID 時)
  const autoLoginRef = useRef(false);
  useEffect(() => {
    if (autoLoginRef.current) return;
    if (deepLinkUid && deepLinkUid !== storedUid) {
      setIdentity(deepLinkUid);
      autoLoginRef.current = true;
    }
  }, [deepLinkUid, storedUid, setIdentity]);

  const loggedIn = !!storedUid && isValidUid(storedUid);

  if (!loggedIn) {
    return <LoginScreen onLogin={(uid) => setIdentity(uid)} />;
  }

  return (
    <ProductsScreen
      uid={storedUid!}
      email={email}
      deepLinkItem={deepLinkItem}
      paidFacTradeSeq={paidFacTradeSeq}
      paidResultHint={paidResultHint}
      onChangeUid={clear}
    />
  );
}

// ============================================================
// LoginScreen
// ============================================================

function LoginScreen({ onLogin }: { onLogin: (uid: string) => void }) {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const verifyMut = useMutation({
    mutationFn: (uid: string) => verifyPlayerUid(uid),
    onSuccess: (result, uid) => {
      if (result.valid) {
        onLogin(uid);
      } else {
        setError(
          result.reason === 'NOT_FOUND'
            ? '此 UID 在遊戲端找不到,請確認 UID 是否正確'
            : '驗證失敗,請稍後再試',
        );
      }
    },
    onError: (err) => {
      // 網路 / server 錯,給友善訊息
      setError(`連線失敗:${extractErrorMessage(err)}`);
    },
  });

  const submit = () => {
    const normalized = normalizeUid(input);
    if (!isValidUid(normalized)) {
      setError('UID 必須是 16 碼英數(0-9, A-F)');
      return;
    }
    setError(null);
    verifyMut.mutate(normalized);
  };

  const submitting = verifyMut.isPending;

  return (
    <div className="mx-auto flex min-h-[85vh] max-w-md flex-col items-center justify-center px-4 py-6">
      <div className="mb-6 flex items-center gap-3 text-center">
        <img
          src="/icons/icedragon-shop.webp"
          alt="冰龍遊戲"
          className="h-16 w-16 flex-shrink-0 rounded-lg"
          style={{ imageRendering: 'pixelated' }}
        />
        <h1 className="text-xl font-bold leading-tight text-slate-900 sm:text-2xl">
          冰龍遊戲<br className="sm:hidden" />
          <span className="block sm:inline sm:ml-1">官方儲值中心</span>
        </h1>
      </div>

      <div className="w-full rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="mb-1 text-base font-semibold text-slate-900">
          請輸入遊戲 UID
        </h2>
        <p className="mb-4 text-xs text-slate-500">
          UID 可在遊戲設定畫面複製,輸入後將以此帳號驗證並顯示對應的禮包剩餘購買次數
        </p>

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
          placeholder="E9E3E1A9071AF9DC"
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
          {submitting ? '驗證中…' : '進入儲值中心'}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// ProductsScreen
// ============================================================

function ProductsScreen({
  uid,
  email,
  deepLinkItem,
  paidFacTradeSeq,
  paidResultHint,
  onChangeUid,
}: {
  uid: string;
  email: string | null;
  deepLinkItem: string;
  paidFacTradeSeq: string;
  paidResultHint: string;
  onChangeUid: () => void;
}) {
  const [tab, setTab] = useState<ProductCategory>('BUNDLE');
  const [selected, setSelected] = useState<PublicProduct | null>(null);
  const [, setSearchParams] = useSearchParams();
  const deepLinkOpenedRef = useRef(false);
  const refreshAfterPayRef = useRef(false);
  const queryClient = useQueryClient();

  // 「剛付完款」流程
  // ─────────────────────────────────────────────────────────
  // 玩家在 MyCard 點「返回商家」→ 後端 302 導回 /?paid={facTradeSeq}
  // 這裡顯示 PaymentResultModal,實時 poll 訂單狀態。
  //
  // ?paid= 不會立刻從 URL 拿掉,讓玩家手動關掉 modal 後才清(避免關掉但訂單狀態還沒收到的狀況)
  const [showPaymentResult, setShowPaymentResult] = useState(false);
  useEffect(() => {
    if (refreshAfterPayRef.current) return;
    if (!paidFacTradeSeq) return;
    refreshAfterPayRef.current = true;
    setShowPaymentResult(true);
  }, [paidFacTradeSeq]);

  const handlePaymentResultClose = () => {
    setShowPaymentResult(false);
    // 收起 modal → 清 URL(?paid + ?result)+ 重撈商品(限購可能已扣)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('paid');
        next.delete('result');
        return next;
      },
      { replace: true },
    );
    queryClient.invalidateQueries({ queryKey: ['player', 'products', uid] });
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ['player', 'products', uid],
    queryFn: () => fetchPlayerProducts(uid),
    staleTime: 5_000, // 短快取:限購狀態要新鮮
  });

  // Deep link item:自動切 tab + 開 modal(只一次)
  useEffect(() => {
    if (deepLinkOpenedRef.current) return;
    if (!deepLinkItem || !data?.items) return;
    const found = data.items.find((p) => p.code === deepLinkItem);
    if (found) {
      setTab(found.category);
      setSelected(found);
      deepLinkOpenedRef.current = true;
    }
  }, [deepLinkItem, data]);

  const buckets = useMemo(() => {
    const init: Record<ProductCategory, PublicProduct[]> = { BUNDLE: [], CURRENCY: [] };
    (data?.items ?? []).forEach((p) => init[p.category].push(p));
    return init;
  }, [data]);

  // redirecting:purchase 成功後保持 loading 直到 window.location 真正換頁
  // (避免 onSuccess 跑完 → isPending = false → overlay 消失 → 0.x 秒後才導頁的閃爍)
  const [redirecting, setRedirecting] = useState(false);

  const purchase = useMutation({
    mutationFn: (productCode: string) =>
      createPlayerOrder({ uid, productCode, email: email ?? undefined }),
    onSuccess: (res) => {
      setRedirecting(true);
      window.location.href = res.redirect_url;
    },
  });

  const showPurchaseOverlay = purchase.isPending || redirecting;

  return (
    <div className="mx-auto max-w-5xl px-3 py-4 sm:px-6 sm:py-6">
      {/* Header — UID 顯示 + 更換按鈕 */}
      <section className="mb-4 overflow-hidden rounded-lg bg-gradient-to-r from-brand-600 to-brand-800 p-4 text-white shadow-lg sm:mb-6 sm:rounded-xl sm:p-6">
        <div className="flex items-center justify-between gap-3 sm:gap-4">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <img
              src="/icons/icedragon-shop.webp"
              alt="冰龍遊戲"
              className="h-12 w-12 flex-shrink-0 rounded-lg bg-white/10 p-1 sm:h-16 sm:w-16"
              style={{ imageRendering: 'pixelated' }}
            />
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold leading-tight sm:text-2xl md:text-3xl">
                冰龍遊戲 官方儲值中心
              </h1>
              <p className="mt-0.5 truncate text-xs text-white/80 sm:text-sm">
                <span className="opacity-70">UID:</span>{' '}
                <span className="font-mono">{uid}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onChangeUid}
            className="flex-shrink-0 rounded border border-white/30 px-2.5 py-1.5 text-xs font-medium text-white/90 transition-colors hover:bg-white/10 sm:px-3 sm:py-2 sm:text-sm"
          >
            更換 UID
          </button>
        </div>
      </section>

      {/* 商品分類 tabs */}
      <section className="mb-3">
        <h2 className="label mb-2 block">選擇商品</h2>
        <div
          className="-mx-1 flex gap-1 overflow-x-auto border-b border-slate-200 px-1"
          role="tablist"
        >
          {TAB_ORDER.map((t) => {
            const active = t === tab;
            const count = buckets[t]?.length ?? 0;
            return (
              <button
                key={t}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t)}
                className={
                  'whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors sm:px-4 sm:py-3 ' +
                  (active
                    ? 'border-brand-600 text-brand-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800')
                }
              >
                {TAB_LABELS[t]}
                <span className="ml-1 text-xs text-slate-400">({count})</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 商品 grid */}
      {isLoading ? (
        <div className="card">載入中…</div>
      ) : error ? (
        <div className="card text-sm text-rose-600">
          載入失敗:{extractErrorMessage(error)}
        </div>
      ) : buckets[tab].length === 0 ? (
        <div className="card text-sm text-slate-400">此分類目前沒有上架商品</div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
          {buckets[tab].map((p) => (
            <ProductCard key={p.id} product={p} onClick={() => setSelected(p)} />
          ))}
        </div>
      )}

      {selected && (
        <ProductDetailModal
          product={selected}
          purchasing={purchase.isPending}
          purchaseError={purchase.error ? extractErrorMessage(purchase.error) : null}
          onPurchase={() => purchase.mutate(selected.code)}
          onClose={() => {
            if (!purchase.isPending && !redirecting) {
              setSelected(null);
              purchase.reset();
            }
          }}
        />
      )}

      {/* 購買 loading overlay — 完全擋住 UI 直到跳轉 MyCard */}
      {showPurchaseOverlay && <PurchaseLoadingOverlay />}

      {/* 付款結果 modal — MyCard 返回後 poll 訂單狀態實時顯示 */}
      {showPaymentResult && paidFacTradeSeq && (
        <PaymentResultModal
          facTradeSeq={paidFacTradeSeq}
          resultHint={paidResultHint}
          onClose={handlePaymentResultClose}
        />
      )}
    </div>
  );
}

// ============================================================
// PaymentResultModal — MyCard 返回後顯示付款結果
// ============================================================

/**
 * Poll /api/orders/:facTradeSeq 看訂單目前狀態:
 *   PENDING / AUTHED        → 處理中(spinner)
 *   PAID / CONFIRMED        → 付款成功,正在派發(綠色 + spinner)
 *   DELIVERED               → ✓ 付款成功 + 商品已派發(綠色,終態)
 *   DELIVERY_FAILED         → ⚠ 付款成功但派發失敗(琥珀色,終態)
 *   FAILED / CANCELLED      → ✗ 付款失敗(紅色,終態)
 *
 * 終態到達後停止 poll;非終態每 2 秒重打一次,最多 60 秒。
 *
 * `resultHint`:backend wait-and-join 已確認終態時帶進來的暗示(`success` /
 * `fail` / `delivery_failed` / `cancelled`),這時 modal 跳過 poll 直接顯示
 * 終態畫面,只 fetch 一次拿訂單細節(訂單號 / 商品 / 金額)。
 */
function PaymentResultModal({
  facTradeSeq,
  resultHint,
  onClose,
}: {
  facTradeSeq: string;
  resultHint: string;
  onClose: () => void;
}) {
  const [elapsedSec, setElapsedSec] = useState(0);
  const hintedView = resultHintToView(resultHint);

  // 進度計時器 — 給 polling timeout 用(只在無 hint 時生效)
  useEffect(() => {
    if (hintedView) return;
    const t = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [hintedView]);

  const { data: order } = useQuery({
    queryKey: ['player', 'order-result', facTradeSeq],
    queryFn: () => fetchMyOrderDetail(facTradeSeq),
    refetchInterval: (query) => {
      // 有 hint 代表 backend 已確認終態 → 不必 poll(初次抓完就停)
      if (hintedView) return false;
      // 終態就停 poll
      const s = query.state.data?.status;
      if (s && isTerminalStatus(s)) return false;
      // 60 秒 timeout 後也停
      if (elapsedSec > 60) return false;
      return 2000;
    },
    retry: 1,
  });

  const view = hintedView ?? renderPaymentView(order, elapsedSec);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/70 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className={'flex flex-col items-center gap-3 px-5 py-6 sm:px-6 ' + view.bgClass}>
          <div className={'text-5xl ' + view.iconClass}>{view.icon}</div>
          <div className="text-center">
            <h2 className={'text-lg font-bold sm:text-xl ' + view.titleClass}>
              {view.title}
            </h2>
            {view.subtitle && (
              <p className={'mt-1 text-sm ' + view.subtitleClass}>{view.subtitle}</p>
            )}
          </div>
        </div>

        {order && (
          <div className="space-y-1 border-t border-slate-100 px-5 py-3 text-xs text-slate-500 sm:px-6">
            <div className="flex justify-between">
              <span>訂單編號</span>
              <span className="font-mono text-slate-700">{order.fac_trade_seq}</span>
            </div>
            <div className="flex justify-between">
              <span>商品</span>
              <span className="text-slate-700">{order.product_name}</span>
            </div>
            <div className="flex justify-between">
              <span>金額</span>
              <span className="font-semibold text-slate-700">
                NT$ {Number(order.amount).toLocaleString()}
              </span>
            </div>
          </div>
        )}

        <div className="border-t border-slate-100 bg-slate-50 px-5 py-3 sm:px-6">
          <button
            onClick={onClose}
            className={view.isTerminal ? 'btn-primary w-full py-2.5' : 'btn-secondary w-full py-2.5'}
          >
            {view.isTerminal ? '確定' : '我知道了'}
          </button>
        </div>
      </div>
    </div>
  );
}

function isTerminalStatus(s: OrderStatus): boolean {
  return s === 'DELIVERED' || s === 'DELIVERY_FAILED' || s === 'FAILED' || s === 'CANCELLED';
}

/**
 * Backend wait-and-join 提早確認的終態 → 直接做出對應 view,不必等 poll
 * (拿不到 hint 或 hint 無法識別 → 回 null,fallback 走 renderPaymentView)
 */
function resultHintToView(hint: string): PaymentView | null {
  switch (hint) {
    case 'success':
      return {
        icon: '✓',
        iconClass: 'text-emerald-500',
        title: '付款成功,商品已派發',
        titleClass: 'text-emerald-900',
        subtitle: '已寄入您的遊戲信箱,登入遊戲即可領取',
        subtitleClass: 'text-emerald-700',
        bgClass: 'bg-emerald-50',
        isTerminal: true,
      };
    case 'delivery_failed':
      return {
        icon: '⚠',
        iconClass: 'text-amber-500',
        title: '付款成功,但派發失敗',
        titleClass: 'text-amber-900',
        subtitle: '我方已收到您的款項,客服將盡快為您手動補發',
        subtitleClass: 'text-amber-700',
        bgClass: 'bg-amber-50',
        isTerminal: true,
      };
    case 'fail':
      return {
        icon: '✗',
        iconClass: 'text-rose-500',
        title: '付款未完成',
        titleClass: 'text-rose-900',
        subtitle: '若您已扣款請聯繫客服協助處理',
        subtitleClass: 'text-rose-700',
        bgClass: 'bg-rose-50',
        isTerminal: true,
      };
    case 'cancelled':
      return {
        icon: '✗',
        iconClass: 'text-slate-400',
        title: '訂單已取消',
        titleClass: 'text-slate-800',
        subtitle: null,
        subtitleClass: 'text-slate-500',
        bgClass: 'bg-slate-50',
        isTerminal: true,
      };
    default:
      return null;
  }
}

interface PaymentView {
  icon: string;
  iconClass: string;
  title: string;
  titleClass: string;
  subtitle: string | null;
  subtitleClass: string;
  bgClass: string;
  isTerminal: boolean;
}

function renderPaymentView(order: PlayerOrderDetail | undefined, elapsedSec: number): PaymentView {
  // 還沒撈到資料 — 初始狀態
  if (!order) {
    return {
      icon: '⟳',
      iconClass: 'animate-spin text-slate-400',
      title: '查詢付款結果中...',
      titleClass: 'text-slate-800',
      subtitle: '請稍候,正在連線後端',
      subtitleClass: 'text-slate-500',
      bgClass: 'bg-slate-50',
      isTerminal: false,
    };
  }

  const s = order.status;

  if (s === 'DELIVERED') {
    return {
      icon: '✓',
      iconClass: 'text-emerald-500',
      title: '付款成功,商品已派發',
      titleClass: 'text-emerald-900',
      subtitle: '已寄入您的遊戲信箱,登入遊戲即可領取',
      subtitleClass: 'text-emerald-700',
      bgClass: 'bg-emerald-50',
      isTerminal: true,
    };
  }

  if (s === 'PAID' || s === 'CONFIRMED') {
    return {
      icon: '⟳',
      iconClass: 'animate-spin text-emerald-500',
      title: '付款成功,正在派發商品',
      titleClass: 'text-emerald-900',
      subtitle: '通常 5-10 秒內完成,請稍候...',
      subtitleClass: 'text-emerald-700',
      bgClass: 'bg-emerald-50',
      isTerminal: false,
    };
  }

  if (s === 'AUTHED' || s === 'PENDING') {
    // MyCard 結果尚未回到我們(callback 還在路上),或 supplement 走補儲機制
    const slow = elapsedSec > 15;
    return {
      icon: '⟳',
      iconClass: 'animate-spin text-amber-500',
      title: slow ? '正在確認付款結果' : '處理中...',
      titleClass: 'text-amber-900',
      subtitle: slow
        ? '若超過 20 分鐘仍未完成,請聯繫客服(訂單編號已下方顯示)'
        : '請稍候,正在從 MyCard 確認付款',
      subtitleClass: 'text-amber-700',
      bgClass: 'bg-amber-50',
      isTerminal: false,
    };
  }

  if (s === 'DELIVERY_FAILED') {
    return {
      icon: '⚠',
      iconClass: 'text-amber-500',
      title: '付款成功,但派發失敗',
      titleClass: 'text-amber-900',
      subtitle: '我方已收到您的款項,客服將盡快為您手動補發',
      subtitleClass: 'text-amber-700',
      bgClass: 'bg-amber-50',
      isTerminal: true,
    };
  }

  if (s === 'FAILED') {
    return {
      icon: '✗',
      iconClass: 'text-rose-500',
      title: '付款未完成',
      titleClass: 'text-rose-900',
      subtitle: '若您已扣款請聯繫客服協助處理',
      subtitleClass: 'text-rose-700',
      bgClass: 'bg-rose-50',
      isTerminal: true,
    };
  }

  if (s === 'CANCELLED') {
    return {
      icon: '✗',
      iconClass: 'text-slate-400',
      title: '訂單已取消',
      titleClass: 'text-slate-800',
      subtitle: null,
      subtitleClass: 'text-slate-500',
      bgClass: 'bg-slate-50',
      isTerminal: true,
    };
  }

  // fallback
  return {
    icon: '?',
    iconClass: 'text-slate-400',
    title: `狀態:${s}`,
    titleClass: 'text-slate-800',
    subtitle: null,
    subtitleClass: 'text-slate-500',
    bgClass: 'bg-slate-50',
    isTerminal: false,
  };
}

// ============================================================
// PurchaseLoadingOverlay — 購買中全屏 loading
// ============================================================

/**
 * 玩家點立即購買 → API 建單 → 拿到 MyCard URL → 跳轉
 * 整段過程顯示全屏 loading,擋住所有 UI 互動,直到瀏覽器真的導頁離開。
 *
 * 設計要點:
 *   - z-100 高於 modal 的 z-50,確保覆蓋整個畫面
 *   - 沒有任何 onClick / 關閉按鈕,玩家無法關掉
 *   - 文字明確告知「不要關閉視窗、不要重新整理」
 */
function PurchaseLoadingOverlay() {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/85 px-4 backdrop-blur-sm">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-xl bg-white p-6 shadow-2xl">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
        <div className="text-center">
          <div className="text-base font-semibold text-slate-900">
            訂單建立中,請稍候
          </div>
          <p className="mt-1 text-sm text-slate-500">
            正在為您建立訂單並跳轉至 MyCard 付款頁面
          </p>
          <p className="mt-2 text-xs text-amber-700">
            ⚠️ 請勿關閉視窗或重新整理頁面
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// ProductCard
// ============================================================

function ProductCard({ product, onClick }: { product: PublicProduct; onClick: () => void }) {
  const icon = productIcon(product);
  const limit = product.limitation;
  const soldOut = !!limit && limit.left_quantity <= 0;
  const limitBadge = formatLimitBadge(product);

  return (
    <button
      onClick={onClick}
      disabled={soldOut}
      className={
        'group flex min-h-[180px] flex-col rounded-lg border bg-white p-2.5 text-left shadow-sm transition-all sm:min-h-[200px] sm:p-3 ' +
        (soldOut
          ? 'cursor-not-allowed border-slate-200 opacity-60'
          : 'border-slate-200 hover:-translate-y-0.5 hover:border-brand-400 hover:shadow-md active:scale-[0.98]')
      }
    >
      <div className="mb-1 line-clamp-1 text-xs font-semibold text-slate-800 sm:text-sm">
        {product.name_display}
      </div>
      <div className="relative flex flex-1 items-center justify-center py-2 sm:py-3">
        <IconView icon={icon} alt={product.name_display} size="card" />
        {soldOut && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="rounded-full bg-slate-900/80 px-3 py-1 text-xs font-bold text-white">
              已售完
            </span>
          </div>
        )}
      </div>
      {limitBadge && (
        <div
          className={
            'mb-1 self-start rounded px-1.5 py-0.5 text-[10px] font-medium sm:px-2 sm:text-xs ' +
            (soldOut ? 'bg-slate-200 text-slate-500' : 'bg-amber-100 text-amber-700')
          }
        >
          {limitBadge}
        </div>
      )}
      <div className="mt-1 text-right text-base font-bold text-brand-700 sm:text-lg">
        NT$ {product.amount}
      </div>
    </button>
  );
}

// ============================================================
// 限購 badge 文案
// ============================================================

/**
 * 規則:
 *   ALL_TIME → `限購 N/M`
 *   DAY      → `每日限購 N/M`
 *   WEEK     → `每週限購 N/M`
 *   MONTH    → `每月限購 N/M`
 *   YEAR     → `每年限購 N/M`
 *
 * 沒 PlayFab 限購資訊(無 itemId 或 API 失敗)→ fallback 到 admin 後台手打的純文字 label
 */
function formatLimitBadge(product: PublicProduct): string | null {
  const lim = product.limitation;
  if (lim) {
    const prefix = periodPrefix(lim.limit_period);
    return `${prefix}限購 ${lim.left_quantity}/${lim.max_quantity}`;
  }
  return product.purchase_limit_label || null;
}

function periodPrefix(p: NonNullable<PublicProduct['limitation']>['limit_period']): string {
  switch (p) {
    case 'DAY': return '每日';
    case 'WEEK': return '每週';
    case 'MONTH': return '每月';
    case 'YEAR': return '每年';
    case 'ALL_TIME': return '';
    default: return '';
  }
}

// reset 時間用 UTC,顯示給玩家轉成台北時間
function formatResetAt(iso: string): string {
  const d = new Date(iso);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const hh = d.getHours().toString().padStart(2, '0');
  return `${m}/${day} ${hh}:00`;
}

// ============================================================
// ProductDetailModal
// ============================================================

function ProductDetailModal({
  product,
  purchasing,
  purchaseError,
  onPurchase,
  onClose,
}: {
  product: PublicProduct;
  purchasing: boolean;
  purchaseError: string | null;
  onPurchase: () => void;
  onClose: () => void;
}) {
  const effects = product.effects.effects ?? [];
  const icon = productIcon(product);
  const soldOut = !!product.limitation && product.limitation.left_quantity <= 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-slate-900/60 sm:items-center sm:px-4 sm:py-8"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-200 bg-gradient-to-r from-brand-50 to-white px-4 py-3 pr-12 sm:px-5 sm:py-4">
          <button
            onClick={onClose}
            disabled={purchasing}
            className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40"
            aria-label="關閉"
          >
            ✕
          </button>
          <h2 className="text-base font-bold text-slate-900 sm:text-lg">
            {product.name_display}
          </h2>
          {(() => {
            const badge = formatLimitBadge(product);
            if (!badge) return null;
            return (
              <div
                className={
                  'mt-1 inline-block rounded px-2 py-0.5 text-xs font-medium ' +
                  (soldOut
                    ? 'bg-slate-200 text-slate-500'
                    : 'bg-amber-100 text-amber-700')
                }
              >
                {badge}
                {product.limitation?.reset_at && !soldOut && (
                  <span className="ml-1 text-amber-600">
                    · {formatResetAt(product.limitation.reset_at)} 重置
                  </span>
                )}
              </div>
            );
          })()}
        </div>

        <div className="space-y-3 px-4 py-4 sm:space-y-4 sm:px-5 sm:py-5">
          <div className="flex justify-center">
            <IconView icon={icon} alt={product.name_display} size="modal" />
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <div className="mb-2 font-semibold text-slate-700">包含:</div>
            {effects.length > 0 ? (
              <ul className="space-y-1 text-slate-700">
                {effects.map((e, i) => (
                  <li key={i} className="flex items-baseline justify-between">
                    <span>「{effectLabel(e)}」</span>
                    <span className="font-mono font-semibold">
                      × {effectAmount(e).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-slate-400">(此商品沒有 effects 資料)</p>
            )}
          </div>

          {purchaseError && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              建單失敗:{purchaseError}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 border-t border-slate-200 bg-slate-50 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5 sm:py-4">
          <button
            onClick={onPurchase}
            disabled={purchasing || soldOut}
            className="btn-primary w-full py-3 text-base sm:py-2.5"
          >
            {soldOut
              ? '已達購買上限'
              : purchasing
              ? '處理中…'
              : `立即購買  NT$ ${product.amount}`}
          </button>
          <p className="mt-2 text-center text-xs text-slate-500">
            點擊購買將導向 MyCard 付款頁
          </p>
        </div>
      </div>
    </div>
  );
}
