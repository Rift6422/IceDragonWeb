import { Link, NavLink, Outlet } from 'react-router-dom';

/**
 * 玩家前台 layout — 簡化版:
 *   - 左:logo「冰龍遊戲」
 *   - 中:兩個 nav 連結(商品 / 我的訂單),永遠可點
 *   - 右:無(刻意拿掉 UID badge / 更換 / 「尚未登入」狀態 — 不做登入感)
 *
 * UID 由各頁面自己處理:
 *   - 商品頁有 inline UID 輸入欄(購買時用)
 *   - 我的訂單頁有獨立的 UID 搜尋欄
 */
export function PlayerLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-slate-50 to-white">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-3 py-2.5 sm:gap-6 sm:px-6 sm:py-3">
          <Link to="/" className="text-base font-bold text-brand-600 sm:text-xl">
            冰龍遊戲
          </Link>

          <nav className="flex items-center gap-3 text-sm sm:gap-5">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                'rounded px-1.5 py-1 transition-colors ' +
                (isActive
                  ? 'font-medium text-brand-700'
                  : 'text-slate-600 hover:text-brand-600')
              }
            >
              商品
            </NavLink>
            <NavLink
              to="/orders"
              className={({ isActive }) =>
                'rounded px-1.5 py-1 transition-colors ' +
                (isActive
                  ? 'font-medium text-brand-700'
                  : 'text-slate-600 hover:text-brand-600')
              }
            >
              我的訂單
            </NavLink>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-500">
        © 2026 冰龍遊戲. 官方儲值站.
      </footer>
    </div>
  );
}
