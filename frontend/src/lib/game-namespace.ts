/**
 * 遊戲 URL 命名空間收斂(目前單一遊戲:神代紀事 = shindai-record)。
 *
 * 玩家商城統一收斂在 /shindai-record 底下運作:
 *   - 進 root(或無前綴的玩家路徑)→ 強制轉入 /shindai-record/...(見 main.tsx)
 *   - React Router basename 讓所有路由 / 連結 / 導覽自動帶前綴,零散改
 *   - /admin、/api、/uploads 等非玩家商城路徑不收斂
 *
 * 未來真正多遊戲時:GAME_CODES 改由後端依資料庫回傳,商城 by-game scope。
 * 見 memory: multi-game-url-namespace。
 */
export const GAME_CODES = ['shindai-record'];

/** 無前綴進站時要收斂到的預設遊戲代號 */
export const DEFAULT_GAME = 'shindai-record';

/** 商城 base path(帶前綴),例:/shindai-record */
export const STORE_BASE_PATH = `/${DEFAULT_GAME}`;

/**
 * 會被「強制收斂到 /{DEFAULT_GAME}」的 root(無前綴)玩家路徑第一段。
 * 空字串 = root `/`。刻意用 allowlist,避免誤轉 /admin、/api、未知路徑。
 */
export const PLAYER_ROOT_SEGMENTS = ['', 'products', 'orders', 'redeem', 'redeem-verify'];
