import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { extractErrorMessage } from '@/api/client';
import {
  createPlayerOrder,
  fetchPlayerProducts,
  type ProductCategory,
  type ProductEffect,
  type PublicProduct,
} from '@/api/player';
import { isValidUid, normalizeUid, usePlayerStore } from '@/features/player/uid.store';

/**
 * 玩家儲值單頁 — 對齊 shop.garena.tw 的 UX:
 *   1. UID 輸入(頁首,自動帶入 store 內存的 UID)
 *   2. 商品 tabs(超值禮包 / 鑽石)
 *   3. 商品卡 grid
 *   4. 點卡 → modal 顯示內容 + 立即購買 → POST /api/orders → 跳 MyCard
 *
 * 沒 UID 就不能買 → 點購買時 highlight 輸入框並 scroll,不再強制 redirect。
 * UID 寫入 localStorage 持久化,下次回來自動填入。
 */

const TAB_LABELS: Record<ProductCategory, string> = {
  BUNDLE: '超值禮包',
  CURRENCY: '啟源石',
};

const TAB_ORDER: ProductCategory[] = ['BUNDLE', 'CURRENCY'];

const EFFECT_FALLBACK_NAMES: Record<string, string> = {
  DIAMOND: '啟源石', // 內部 code 維持 DIAMOND 為穩定識別,顯示名統一改為啟源石
  STONE: '啟源石',
  CRYSTAL: '源結晶',
};

function effectLabel(e: ProductEffect): string {
  return e.display_label ?? EFFECT_FALLBACK_NAMES[e.code] ?? e.code;
}
function effectAmount(e: ProductEffect): number {
  return e.amount ?? e.qty ?? 0;
}

/**
 * icon 系統:支援兩種型態,後台輸入哪種就 render 哪種。
 *   - 圖片(以 `/` 或 `http(s)://` 開頭)→ 用 <img> render
 *   - 其他字串(通常是 emoji)→ 用文字 render(沿用舊行為,向下相容)
 *
 * fallback 用 demo 圖(在 `frontend/public/icons/` 下,跟著 vite build 進 Docker)。
 */
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
          // 圖片載不到就降級成 emoji 預設
          (e.currentTarget as HTMLImageElement).style.display = 'none';
        }}
      />
    );
  }
  // 文字 / emoji
  return <span className={size === 'modal' ? 'text-7xl' : 'text-5xl'}>{icon}</span>;
}

export function PlayerHomePage() {
  /**
   * Deep link 支援:URL 可帶 `?uid=...&item=...` 預填 + 自動開 modal。
   *
   *   /?uid=E9E3E1A9071AF9DC                   ← 只預填 UID
   *   /?item=BUNDLE_VALUE_CHAR                  ← 只開特定商品 modal
   *   /?uid=...&item=BUNDLE_VALUE_CHAR          ← UID + 商品都預填,玩家進場直接付款
   *
   * UID 也吃 ?itemId= 作為 alias(部分行銷工具會用 camelCase)。
   */
  const [searchParams] = useSearchParams();
  const deepLinkUidRaw = (searchParams.get('uid') ?? '').toUpperCase();
  const deepLinkUid = /^[0-9A-F]{16}$/.test(deepLinkUidRaw) ? deepLinkUidRaw : '';
  const deepLinkItem = (
    searchParams.get('item') ??
    searchParams.get('itemId') ??
    searchParams.get('itemid') ??
    ''
  )
    .toUpperCase();

  const { uid: storedUid, email, setIdentity } = usePlayerStore();
  // UID 優先順序:URL > localStorage > 空
  const [uidInput, setUidInput] = useState(deepLinkUid || storedUid || '');
  const [uidError, setUidError] = useState<string | null>(null);
  const [tab, setTab] = useState<ProductCategory>('BUNDLE');
  const [selected, setSelected] = useState<PublicProduct | null>(null);
  const uidInputRef = useRef<HTMLInputElement>(null);
  // 確保 deep link 只自動開一次 modal,玩家手動關掉就不再自動開
  const deepLinkOpenedRef = useRef(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['player', 'products'],
    queryFn: fetchPlayerProducts,
    staleTime: 30_000,
  });

  // Deep link:商品載入後,若 URL 有 item 且在 ACTIVE 清單裡,自動切 tab + 開 modal
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

  const purchase = useMutation({
    mutationFn: (productCode: string) => {
      const normalized = normalizeUid(uidInput);
      if (!isValidUid(normalized)) {
        return Promise.reject(new Error('UID 必須是 16 碼英數(0-9, A-F)'));
      }
      setIdentity(normalized);
      return createPlayerOrder({
        uid: normalized,
        productCode,
        email: email ?? undefined,
      });
    },
    onSuccess: (res) => {
      window.location.href = res.redirect_url;
    },
  });

  const tryPurchase = (product: PublicProduct) => {
    const normalized = normalizeUid(uidInput);
    if (!isValidUid(normalized)) {
      setUidError('請先填入正確的遊戲 UID(16 碼 0-9 / A-F)');
      uidInputRef.current?.focus();
      uidInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setUidError(null);
    purchase.mutate(product.code);
  };

  return (
    <div className="mx-auto max-w-5xl px-3 py-4 sm:px-6 sm:py-6">
      {/* hero banner — RWD:手機 48px icon + 18px title;平板/桌機 64px + 24-30px */}
      <section className="mb-4 overflow-hidden rounded-lg bg-gradient-to-r from-brand-600 to-brand-800 p-4 text-white shadow-lg sm:mb-6 sm:rounded-xl sm:p-6">
        <div className="flex items-center gap-3 sm:gap-4">
          <img
            src="/icons/icedragon-shop.webp"
            alt="冰龍遊戲"
            className="h-12 w-12 rounded-lg bg-white/10 p-1 sm:h-16 sm:w-16"
            style={{ imageRendering: 'pixelated' }}
          />
          <h1 className="text-lg font-bold leading-tight sm:text-2xl md:text-3xl">
            冰龍遊戲 官方儲值中心
          </h1>
        </div>
      </section>

      {/* UID 輸入 */}
      <section className="mb-4 rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:mb-6 sm:p-4">
        <label htmlFor="player-uid" className="label mb-2 block">
          1. 輸入遊戲 UID
        </label>
        <input
          id="player-uid"
          ref={uidInputRef}
          type="text"
          value={uidInput}
          onChange={(e) => {
            setUidInput(e.target.value);
            if (uidError) setUidError(null);
          }}
          placeholder="E9E3E1A9071AF9DC"
          maxLength={16}
          inputMode="text"
          autoCapitalize="characters"
          className={
            'input w-full font-mono uppercase tracking-wider ' +
            (uidError ? 'border-rose-400 ring-2 ring-rose-200' : '')
          }
          autoComplete="off"
        />
        <p className="mt-1 text-xs text-slate-400">
          16 碼大寫英數(<span className="font-mono">0-9, A-F</span>)
        </p>
        {uidError && <p className="mt-2 text-sm text-rose-600">{uidError}</p>}

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-400">或使用社群帳號:</span>
          <button
            disabled
            title="v1.1 開放"
            className="rounded border border-slate-300 px-2 py-1 text-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            G Google
            <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-amber-700">
              v1.1
            </span>
          </button>
          <button
            disabled
            title="v1.2 開放"
            className="rounded border border-slate-300 px-2 py-1 text-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            f Facebook
            <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-amber-700">
              v1.2
            </span>
          </button>
        </div>
      </section>

      {/* 商品分類 tabs — 手機橫向 scroll 不卡 */}
      <section className="mb-3">
        <h2 className="label mb-2 block">2. 選擇商品</h2>
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

      {/* 商品 grid — 手機 2 / 平板 3 / 桌機 4 */}
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

      {/* 付款方式說明 */}
      <section className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600 sm:p-4">
        <h3 className="mb-1 font-semibold text-slate-700">💳 付款方式</h3>
        <p>
          點購買後將導向 MyCard 安全付款頁,可選{' '}
          <strong>信用卡 / 行動支付 / 電信帳單 / 銀行轉帳</strong> 等多種方式。
        </p>
      </section>

      {selected && (
        <ProductDetailModal
          product={selected}
          purchasing={purchase.isPending}
          purchaseError={purchase.error ? extractErrorMessage(purchase.error) : null}
          uidMissing={!isValidUid(normalizeUid(uidInput))}
          onPurchase={() => tryPurchase(selected)}
          onClose={() => {
            if (!purchase.isPending) {
              setSelected(null);
              purchase.reset();
            }
          }}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------
// Components
// ------------------------------------------------------------

function ProductCard({ product, onClick }: { product: PublicProduct; onClick: () => void }) {
  const icon = productIcon(product);
  return (
    <button
      onClick={onClick}
      className="group flex min-h-[180px] flex-col rounded-lg border border-slate-200 bg-white p-2.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-400 hover:shadow-md active:scale-[0.98] sm:min-h-[200px] sm:p-3"
    >
      <div className="mb-1 line-clamp-1 text-xs font-semibold text-slate-800 sm:text-sm">
        {product.name_display}
      </div>
      <div className="flex flex-1 items-center justify-center py-2 sm:py-3">
        <IconView icon={icon} alt={product.name_display} size="card" />
      </div>
      {product.purchase_limit_label && (
        <div className="mb-1 self-start rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 sm:px-2 sm:text-xs">
          {product.purchase_limit_label}
        </div>
      )}
      <div className="mt-1 text-right text-base font-bold text-brand-700 sm:text-lg">
        NT$ {product.amount}
      </div>
    </button>
  );
}

function ProductDetailModal({
  product,
  purchasing,
  purchaseError,
  uidMissing,
  onPurchase,
  onClose,
}: {
  product: PublicProduct;
  purchasing: boolean;
  purchaseError: string | null;
  uidMissing: boolean;
  onPurchase: () => void;
  onClose: () => void;
}) {
  const effects = product.effects.effects ?? [];
  const icon = productIcon(product);

  return (
    // 手機:底部彈出 bottom sheet 風(items-end + rounded-t-2xl);桌機:置中 modal
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
          {product.purchase_limit_label && (
            <div className="mt-1 inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
              {product.purchase_limit_label}
            </div>
          )}
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

          {uidMissing && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              請先在上方填入遊戲 UID 才能購買
            </div>
          )}

          {purchaseError && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              建單失敗:{purchaseError}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 border-t border-slate-200 bg-slate-50 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5 sm:py-4">
          <button
            onClick={onPurchase}
            disabled={purchasing}
            className="btn-primary w-full py-3 text-base sm:py-2.5"
          >
            {purchasing ? '處理中…' : `立即購買  NT$ ${product.amount}`}
          </button>
          <p className="mt-2 text-center text-xs text-slate-500">
            點擊購買將導向 MyCard 付款頁
          </p>
        </div>
      </div>
    </div>
  );
}
