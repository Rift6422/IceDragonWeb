import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { extractErrorMessage } from '@/api/client';
import {
  createPlayerOrder,
  fetchMyOrderDetail,
  fetchPlayerProducts,
  releaseAbandonedOrder,
  verifyPlayerUid,
  type OrderStatus,
  type PlayerOrderDetail,
  type PublicCategory,
  type PublicProduct,
} from '@/api/player';
import { isValidUid, normalizeUid, usePlayerStore } from '@/features/player/uid.store';
import { initFbPixel, readFbc, readFbp, trackFbPurchase } from '@/lib/fb-pixel';
import { notifyUnityPaymentResult } from '@/lib/unity-bridge';

/**
 * 玩家儲值兩段式流程:
 *   Stage 1:LoginScreen — 沒登入時的 UID 輸入閘門
 *   Stage 2:ProductsScreen — 登入後的商品列表 + modal + 購買流程
 *
 * Deep link `/?uid=...&item=...` 會自動 setIdentity + 後續開 modal。
 */

/** 沒分類(舊資料 / 後台未指定)時的 fallback */
const UNCATEGORIZED_KEY = '__uncategorized__';
const UNCATEGORIZED_LABEL = '其他';
/** localStorage key:導去 MyCard 前記下 FacTradeSeq,跳回來時釋放未完成單的鎖 */
const PENDING_PAYMENT_FTS_KEY = 'pendingPaymentFts';

const DEFAULT_BUNDLE_ICON = '/icons/bundle-default.jpg';
const DEFAULT_CURRENCY_ICON = '/icons/stone-default.jpg';

function productIcon(p: PublicProduct): string {
  if (p.effects.icon) return p.effects.icon;
  // Fallback by category code(BUNDLE → bundle 預設,其他 / CURRENCY / 沒分類 → 啟源石預設)
  return p.category?.code === 'BUNDLE' ? DEFAULT_BUNDLE_ICON : DEFAULT_CURRENCY_ICON;
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

  // Pixel init / PageView — UID 一拿到就送(同 UID 重 render 是 no-op)
  useEffect(() => {
    if (loggedIn && storedUid) initFbPixel(storedUid);
  }, [loggedIn, storedUid]);

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
          src="/brand/shindai-icon.png"
          alt="神代紀事"
          className="h-16 w-16 flex-shrink-0 rounded-lg"
          style={{ imageRendering: 'pixelated' }}
        />
        <h1 className="text-xl font-bold leading-tight text-slate-900 sm:text-2xl">
          神代紀事<br className="sm:hidden" />
          <span className="block sm:inline sm:ml-1">官方儲值中心</span>
        </h1>
      </div>

      <div className="w-full rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="mb-4 text-base font-semibold text-slate-900">
          請輸入遊戲 UID
        </h2>

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
  /** 目前選的分類 id(或 UNCATEGORIZED_KEY)。空字串 = 還沒拿到資料前的初始值 */
  const [tab, setTab] = useState<string>('');
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

  // 算 tabs:後台啟用中的 categories + 「其他」(只有當有商品沒分類時才顯示)
  const tabs = useMemo<PublicCategory[]>(() => {
    if (!data) return [];
    const categories = data.categories ?? [];
    const hasUncategorized = (data.items ?? []).some((p) => !p.category);
    if (hasUncategorized) {
      return [
        ...categories,
        {
          id: UNCATEGORIZED_KEY,
          code: UNCATEGORIZED_KEY,
          display_name: UNCATEGORIZED_LABEL,
          sort_order: 99999,
        },
      ];
    }
    return categories;
  }, [data]);

  // 初始化:第一次拿到 data 時,把 tab 設成第一個分類
  useEffect(() => {
    if (tab) return;
    if (tabs.length > 0) setTab(tabs[0].id);
  }, [tab, tabs]);

  // 依分類分桶
  const buckets = useMemo<Record<string, PublicProduct[]>>(() => {
    const map: Record<string, PublicProduct[]> = {};
    for (const t of tabs) map[t.id] = [];
    for (const p of data?.items ?? []) {
      const key = p.category?.id ?? UNCATEGORIZED_KEY;
      if (!map[key]) map[key] = [];
      map[key].push(p);
    }
    return map;
  }, [data, tabs]);

  // Deep link item:自動切 tab + 開 modal(只一次)
  useEffect(() => {
    if (deepLinkOpenedRef.current) return;
    if (!deepLinkItem || !data?.items) return;
    // 比對商品 code 或遊戲端 PlayFab itemId。
    // 限購禮包的 code 是後台手打的(如 BUNDLE_DAILY),跟遊戲 itemId 不一定相同,
    // 只比 code 會導致帶 itemId 的連結找不到商品 → 停在列表。兩者都比才穩。
    const found = data.items.find(
      (p) =>
        p.code === deepLinkItem ||
        (p.playfab_item_id ?? '').toUpperCase() === deepLinkItem,
    );
    if (found) {
      setTab(found.category?.id ?? UNCATEGORIZED_KEY);
      setSelected(found);
      deepLinkOpenedRef.current = true;
    }
  }, [deepLinkItem, data]);

  // redirecting:purchase 成功後保持 loading 直到 window.location 真正換頁
  // (避免 onSuccess 跑完 → isPending = false → overlay 消失 → 0.x 秒後才導頁的閃爍)
  const [redirecting, setRedirecting] = useState(false);

  const purchase = useMutation({
    mutationFn: (productCode: string) =>
      createPlayerOrder({
        uid,
        productCode,
        email: email ?? undefined,
        fbp: readFbp() ?? undefined,
        fbc: readFbc() ?? undefined,
      }),
    onSuccess: (res) => {
      setRedirecting(true);
      // 記下這筆,等玩家若沒付就跳回來時(見下方 useEffect)主動釋放鎖
      try {
        localStorage.setItem(PENDING_PAYMENT_FTS_KEY, res.fac_trade_seq);
      } catch {
        /* ignore */
      }
      window.location.href = res.redirect_url;
    },
  });

  // D:玩家從 MyCard 付款頁跳回商城(按上一頁 / 關閉)→ 主動釋放上一筆未完成單的鎖。
  //   後端已用 TradeQuery 把關:真的付了的單不會被取消,所以這裡無腦打即可。
  //   手機強關收不到 → 不可靠,僅作輔助;主力靠建單時的「解自己的鎖」。
  useEffect(() => {
    let fts: string | null = null;
    try {
      fts = localStorage.getItem(PENDING_PAYMENT_FTS_KEY);
      if (fts) localStorage.removeItem(PENDING_PAYMENT_FTS_KEY);
    } catch {
      /* ignore */
    }
    if (fts) {
      releaseAbandonedOrder(fts).catch(() => {
        /* best-effort,失敗交給建單時的解鎖兜底 */
      });
    }
  }, []);

  const showPurchaseOverlay = purchase.isPending || redirecting;

  return (
    <div className="mx-auto max-w-5xl px-3 py-4 sm:px-6 sm:py-6">
      {/* Header — UID 顯示 + 更換按鈕 */}
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
                神代紀事 官方儲值中心
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
          {tabs.map((t) => {
            const active = t.id === tab;
            const count = buckets[t.id]?.length ?? 0;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                className={
                  'whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors sm:px-4 sm:py-3 ' +
                  (active
                    ? 'border-brand-600 text-brand-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800')
                }
              >
                {t.display_name}
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
      ) : (buckets[tab] ?? []).length === 0 ? (
        <div className="card text-sm text-slate-400">此分類目前沒有上架商品</div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
          {(buckets[tab] ?? []).map((p) => (
            <ProductCard key={p.id} product={p} onClick={() => setSelected(p)} />
          ))}
        </div>
      )}

      {selected && (
        <ProductDetailModal
          product={selected}
          purchasing={purchase.isPending}
          onPurchase={() => purchase.mutate(selected.code)}
          onClose={() => {
            if (!purchase.isPending && !redirecting) {
              setSelected(null);
              purchase.reset();
            }
          }}
        />
      )}

      {/* 建單被中止(遊戲端鎖定 / 已下架 / 系統異常)→ 跳出提醒。
          此時後端尚未建 MyCard 訂單、也不會跳轉,玩家點「我知道了」關掉即可。 */}
      {purchase.error && (
        <BuildBlockedDialog
          message={extractErrorMessage(purchase.error)}
          onClose={() => purchase.reset()}
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

  let view = hintedView ?? renderPaymentView(order, elapsedSec);
  // MyCard 規定:交易失敗要顯示其回傳的 ReturnCode / ReturnMsg,讓玩家了解失敗原因。
  // 任一有值就蓋掉制式副標,改顯示 MyCard 實際回傳;客服提示移到下方小字(見 render)。
  const returnCode = order?.return_code ?? null;
  const returnMsg = order?.return_msg ?? order?.failure_reason ?? null;
  const showFailReason =
    view.isTerminal && order?.status === 'FAILED' && (!!returnCode || !!returnMsg);
  if (showFailReason) {
    // 格式:[ReturnCode]ReturnMsg(無 code 只顯示 msg,無 msg 只顯示 [code])
    const subtitle = `${returnCode ? `[${returnCode}]` : ''}${returnMsg ?? ''}`.trim();
    view = { ...view, subtitle };
  }

  // 通知 Unity WebView — 到終態時送 { success, itemId } 回遊戲端(只送一次)。
  // itemId = 遊戲端 itemId(game_item_id),要等訂單載入後才送(沒 itemId 對遊戲端沒意義)。
  // 未設 PlayFab 的商品 game_item_id 為 null → fallback 用 product_code。
  // 非 WebView 環境(window.Unity 不存在)會自動 no-op。
  const unityFiredRef = useRef(false);
  useEffect(() => {
    if (unityFiredRef.current) return;
    if (!view.isTerminal) return;
    if (!order) return; // 等 itemId 到手再送
    notifyUnityPaymentResult({
      success: isPaymentSuccess(resultHint, order.status),
      itemId: order.game_item_id || order.product_code,
      status: order.status,
      facTradeSeq,
    });
    unityFiredRef.current = true;
  }, [view.isTerminal, resultHint, order, facTradeSeq]);

  // 派發成功才觸 FB Pixel Purchase(DELIVERED / hint=success)
  // 每筆 facTradeSeq 只送一次,backend CAPI 也會送同一個 event_id,FB 自動去重
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    const success =
      resultHint === 'success' || order?.status === 'DELIVERED';
    if (!success) return;
    if (!order) return; // 還沒拿到金額,等下次 render
    trackFbPurchase(facTradeSeq, Number(order.amount), order.currency || 'TWD');
    firedRef.current = true;
  }, [resultHint, order, facTradeSeq]);

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
            {showFailReason && (
              <p className="mt-1.5 text-xs text-rose-500/80">
                若您已扣款請聯繫客服協助處理
              </p>
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
 * 回給 Unity 的 success 判定 = 「款項是否已收」。
 *   付款成功(含 DELIVERY_FAILED:錢收了,商品改人工補發)→ true
 *   FAILED / CANCELLED → false
 */
function isPaymentSuccess(hint: string, status?: OrderStatus): boolean {
  if (hint === 'success' || hint === 'delivery_failed') return true;
  if (hint === 'fail' || hint === 'cancelled') return false;
  return (
    status === 'DELIVERED' ||
    status === 'PAID' ||
    status === 'CONFIRMED' ||
    status === 'DELIVERY_FAILED'
  );
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
        subtitle: '商品已直接存入您的倉庫',
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
      subtitle: '商品已直接存入您的倉庫',
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
  const owned = product.owned === true;
  const soldOut = !!limit && limit.left_quantity <= 0;
  // 已擁有優先於售完(都是不能買,但「已擁有」的圖示蓋章顏色不同 + 文案不同)
  const disabled = owned || soldOut;
  const limitBadge = formatLimitBadge(product);
  const showFirstDouble = !owned && isFirstPurchaseDouble(product);

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={
        'group relative flex min-h-[180px] flex-col rounded-lg border bg-white p-2.5 text-left shadow-sm transition-all sm:min-h-[200px] sm:p-3 ' +
        (disabled
          ? 'cursor-not-allowed border-slate-200 opacity-60'
          : 'border-slate-200 hover:-translate-y-0.5 hover:border-brand-400 hover:shadow-md active:scale-[0.98]')
      }
    >
      {showFirstDouble && (
        <span className="absolute -right-1 -top-1 rounded-full bg-gradient-to-r from-rose-500 to-amber-500 px-2 py-0.5 text-[10px] font-bold text-white shadow-md sm:text-xs">
          首儲雙倍
        </span>
      )}
      <div className="mb-1 line-clamp-1 text-xs font-semibold text-slate-800 sm:text-sm">
        {product.name_display}
      </div>
      <div className="relative flex flex-1 items-center justify-center py-2 sm:py-3">
        <IconView icon={icon} alt={product.name_display} size="card" />
        {owned ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="rounded-full bg-emerald-600/85 px-3 py-1 text-xs font-bold text-white">
              已擁有
            </span>
          </div>
        ) : soldOut ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="rounded-full bg-slate-900/80 px-3 py-1 text-xs font-bold text-white">
              已售完
            </span>
          </div>
        ) : null}
      </div>
      {limitBadge && !owned && (
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

/**
 * 首儲加倍是否要顯示在卡片角落
 *
 * 規則:
 *   - 只看 can_double(該品項是否參與加倍)— 跟遊戲端討論後簡化
 *   - null(舊 endpoint fallback / API 失敗)→ 不顯示
 */
function isFirstPurchaseDouble(p: PublicProduct): boolean {
  return p.can_double === true;
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

// ============================================================
// BuildBlockedDialog — 建單被中止的提醒彈窗
// ============================================================

/**
 * 建單在「打 MyCard 之前」就被中止時跳出的提醒。
 * 觸發來源:遊戲端鎖定(其他端口購買中 / 自己已付)、商品下架、遊戲端系統異常。
 * 此時後端尚未建立 MyCard 訂單、也不會跳轉付款頁,純提醒玩家。
 */
function BuildBlockedDialog({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  // 依訊息內容判斷是不是「鎖定」類(換個圖示與標題,其餘走通用提醒)
  const isLock = /鎖定|其他端口|處理中|已付款/.test(message);
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/60 sm:items-center sm:px-4"
      onClick={onClose}
      role="alertdialog"
      aria-modal="true"
    >
      <div
        className="relative w-full max-w-sm overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center px-6 pt-7 text-center">
          <div
            className={
              'flex h-14 w-14 items-center justify-center rounded-full text-3xl ' +
              (isLock ? 'bg-amber-100' : 'bg-rose-100')
            }
          >
            {isLock ? '🔒' : '⚠️'}
          </div>
          <h3 className="mt-4 text-lg font-bold text-slate-900">
            {isLock ? '暫時無法購買' : '無法建立訂單'}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{message}</p>
        </div>
        <div className="px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-6">
          <button
            onClick={onClose}
            className="btn-primary w-full py-3 text-base"
            autoFocus
          >
            我知道了
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// ProductDetailModal
// ============================================================

function ProductDetailModal({
  product,
  purchasing,
  onPurchase,
  onClose,
}: {
  product: PublicProduct;
  purchasing: boolean;
  onPurchase: () => void;
  onClose: () => void;
}) {
  const description = product.description?.trim() ?? '';
  const icon = productIcon(product);
  const owned = product.owned === true;
  const soldOut = !!product.limitation && product.limitation.left_quantity <= 0;
  const disabled = owned || soldOut;

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
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {owned && (
              <span className="rounded bg-emerald-600 px-2 py-0.5 text-xs font-bold text-white shadow-sm">
                已擁有
              </span>
            )}
            {!owned && isFirstPurchaseDouble(product) && (
              <span className="rounded bg-gradient-to-r from-rose-500 to-amber-500 px-2 py-0.5 text-xs font-bold text-white shadow-sm">
                首儲雙倍
              </span>
            )}
            {!owned &&
              (() => {
                const badge = formatLimitBadge(product);
                if (!badge) return null;
                return (
                  <span
                    className={
                      'rounded px-2 py-0.5 text-xs font-medium ' +
                      (soldOut
                        ? 'bg-slate-200 text-slate-500'
                        : 'bg-amber-100 text-amber-700')
                    }
                  >
                    {badge}
                  </span>
                );
              })()}
          </div>
        </div>

        <div className="space-y-3 px-4 py-4 sm:space-y-4 sm:px-5 sm:py-5">
          <div className="flex justify-center">
            <IconView icon={icon} alt={product.name_display} size="modal" />
          </div>

          {description && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <div className="mb-2 font-semibold text-slate-700">商品說明:</div>
              <p className="whitespace-pre-line leading-relaxed text-slate-700">
                {description}
              </p>
            </div>
          )}

        </div>

        <div className="sticky bottom-0 border-t border-slate-200 bg-slate-50 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5 sm:py-4">
          <button
            onClick={onPurchase}
            disabled={purchasing || disabled}
            className="btn-primary w-full py-3 text-base sm:py-2.5"
          >
            {owned
              ? '您已擁有此商品'
              : soldOut
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
