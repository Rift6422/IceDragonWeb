/**
 * Facebook Pixel(瀏覽器端)— 廣告歸因
 *
 * 跟 backend FbCapiService 是同一個事件雙端送(Pixel 在瀏覽器、CAPI 在 server),
 * FB 用 event_id(= facTradeSeq)去重,絕不會算成兩筆。
 *
 * 環境變數:
 *   - VITE_FB_PIXEL_ID:Pixel 數字 ID(同一個值,跟 backend FB_PIXEL_ID 一致)
 *     沒設 → 整個模組變 no-op,不會 crash 也不會打 FB
 */

declare global {
  interface Window {
    // FB SDK 注入後存在
    fbq?: ((...args: unknown[]) => void) & { queue?: unknown[]; loaded?: boolean; version?: string; push?: unknown };
    _fbq?: unknown;
  }
}

const PIXEL_ID = import.meta.env.VITE_FB_PIXEL_ID as string | undefined;
let pixelLoaded = false;
let pixelInited = false;

/** 注入 FB Pixel SDK script(冪等;只跑一次)*/
export function loadFbPixel(): void {
  if (!PIXEL_ID) return;
  if (pixelLoaded) return;
  if (typeof window === 'undefined') return;

  // 官方 snippet,改寫成 TS-safe 版本
  const w = window;
  if (w.fbq) {
    pixelLoaded = true;
    return;
  }
  const fbq = function (...args: unknown[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (fbq as any).callMethod ? (fbq as any).callMethod.apply(fbq, args) : (fbq as any).queue.push(args);
  } as Window['fbq'];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (fbq as any).queue = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (fbq as any).loaded = true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (fbq as any).version = '2.0';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (fbq as any).push = fbq;
  w.fbq = fbq;
  if (!w._fbq) w._fbq = fbq;

  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://connect.facebook.net/en_US/fbevents.js';
  const first = document.getElementsByTagName('script')[0];
  first?.parentNode?.insertBefore(script, first);
  pixelLoaded = true;
}

/**
 * init Pixel + 送 PageView
 *
 * 在玩家輸入完 UID(LoginScreen → onLogin)後呼叫一次。
 * 為了跨裝置歸因,把玩家 UID 當 external_id 一起送。
 */
export function initFbPixel(uid: string): void {
  if (!PIXEL_ID) return;
  loadFbPixel();
  if (!window.fbq) return;
  if (pixelInited) {
    // 已經 init 過 — 換成 init 同 ID 是 no-op,但 external_id 變了要重發 PageView
    return;
  }
  window.fbq('init', PIXEL_ID, { external_id: uid });
  window.fbq('track', 'PageView');
  pixelInited = true;
}

/**
 * 送 Purchase 事件
 *
 * @param eventId  facTradeSeq — 跟 backend CAPI 的 event_id 必須一致(去重)
 * @param value    金額(數字,例 150)
 * @param currency 幣別 ISO,例 'TWD'
 *
 * 如果還沒 init 會跳過(不會堆積或 fail);Modal 進場時 UID 一定已經 init 過了。
 */
export function trackFbPurchase(eventId: string, value: number, currency: string): void {
  if (!PIXEL_ID) return;
  if (!window.fbq) return;
  window.fbq('track', 'Purchase', { value, currency }, { eventID: eventId });
}

/** 讀 _fbp cookie(FB 自動寫的,seven-segment 結構)*/
export function readFbp(): string | null {
  return readCookie('_fbp');
}

/**
 * 讀 _fbc cookie(從 fbclid 衍生)
 *
 * Pixel SDK 會在使用者第一次帶 ?fbclid=... 進站時自動寫 _fbc。
 * 若 SDK 還沒寫(玩家剛進站就刷新),也從當前 URL 的 fbclid 手動組一個:
 *   _fbc = `fb.${subdomainIdx}.{epoch_ms}.{fbclid}` — FB 官方規格
 */
export function readFbc(): string | null {
  const c = readCookie('_fbc');
  if (c) return c;
  if (typeof window === 'undefined') return null;
  const fbclid = new URLSearchParams(window.location.search).get('fbclid');
  if (!fbclid) return null;
  return `fb.1.${Date.now()}.${fbclid}`;
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${name}=`;
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }
  return null;
}
