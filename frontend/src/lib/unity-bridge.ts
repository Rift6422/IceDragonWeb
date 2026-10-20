/**
 * Unity WebView bridge。
 *
 * 玩家是在遊戲端用 unity-webview 外掛(WebViewObject)開這個儲值站時,外掛會把
 * `window.Unity` 物件注入頁面。網頁呼叫 `window.Unity.call(msg)` 可把「字串」訊息
 * 送回 Unity C#(WebViewObject 的 onMessage callback)。
 *
 * 一般瀏覽器(非 WebView)沒有 window.Unity → 所有呼叫安靜略過(no-op)。
 */
interface UnityWebViewBridge {
  call?: (message: string) => void;
}

declare global {
  interface Window {
    Unity?: UnityWebViewBridge;
  }
}

/** 送回 Unity 的付款結果。`success` / `itemId` 是遊戲端要求的欄位,其餘供未來細分用。 */
export interface UnityPaymentResult {
  /** true = 付款成功(款項已收);false = 未完成 / 失敗 / 取消 */
  success: boolean;
  /** 遊戲端 itemId(送 PlayFab / 遊戲端的識別碼,例 origem_1dollar);未設時 fallback 為商品代號 */
  itemId: string;
  /** 訂單終態(DELIVERED / DELIVERY_FAILED / FAILED / CANCELLED),供遊戲端細分 */
  status?: string;
  /** 廠商交易序號,方便遊戲端對單 / log */
  facTradeSeq?: string;
}

/** 送回 Unity 的序號兌換結果。`type` 讓遊戲端能和付款結果區分。 */
export interface UnityCouponResult {
  /** 固定 'coupon' — 序號兌換,讓遊戲端 onMessage 能和付款結果分流 */
  type: 'coupon';
  /** true = 兌換成功(商品已寄入信箱);false = 失敗 / 無效序號 */
  success: boolean;
  /** 遊戲端回傳、給玩家看的訊息(成功 / 失敗都帶)*/
  message: string;
  /** 玩家輸入的序號,方便遊戲端對單 / log */
  couponCode: string;
}

/**
 * 把結果送回 Unity。不在 WebView 內(window.Unity 不存在)則直接回 false,不報錯。
 * @returns 是否真的送出
 */
function sendToUnity(label: string, result: object): boolean {
  const payload = JSON.stringify(result);
  const bridge = window.Unity;
  if (!bridge || typeof bridge.call !== 'function') {
    console.log(`[unity-bridge] window.Unity 不存在(非 WebView 環境),略過送出${label}:`, payload);
    return false;
  }
  try {
    bridge.call(payload);
    console.log(`[unity-bridge] 已送出${label}給 Unity:`, payload);
    return true;
  } catch (err) {
    console.error(`[unity-bridge] 送出${label}給 Unity 失敗:`, err, payload);
    return false;
  }
}

/**
 * 把付款結果送回 Unity。不在 WebView 內則直接回 false。
 * @returns 是否真的送出
 */
export function notifyUnityPaymentResult(result: UnityPaymentResult): boolean {
  return sendToUnity('付款結果', result);
}

/**
 * 把序號兌換結果送回 Unity(與付款流程一致:完成後通知遊戲端刷新)。
 * 不在 WebView 內則直接回 false。
 * @returns 是否真的送出
 */
export function notifyUnityCouponResult(result: UnityCouponResult): boolean {
  return sendToUnity('序號兌換結果', result);
}
