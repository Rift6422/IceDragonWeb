import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './index.css';
import {
  DEFAULT_GAME,
  GAME_CODES,
  PLAYER_ROOT_SEGMENTS,
} from './lib/game-namespace';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * 玩家商城統一收斂在遊戲命名空間(/shindai-record)底下:
 *   - 帶遊戲代號前綴(/shindai-record/…)→ 用 basename 讓整個 storefront 在該前綴運作,
 *     所有路由/連結/導覽零修改自動帶前綴。
 *   - 無前綴的玩家路徑(root `/`、`/products`、`/orders`、`/redeem`…)→ 強制轉入
 *     /shindai-record/…(保留後續路徑 + query + hash,例 `/?paid=x` → `/shindai-record/?paid=x`)。
 *   - /admin、/api、/uploads、未知路徑 → 不收斂(allowlist 只認玩家商城路徑)。
 *
 * 未來多遊戲時 GAME_CODES 改由後端下發。見 memory: multi-game-url-namespace。
 */
const firstSegment = window.location.pathname.split('/')[1] ?? '';

const shouldRedirectToGameNamespace =
  !GAME_CODES.includes(firstSegment) && PLAYER_ROOT_SEGMENTS.includes(firstSegment);

if (shouldRedirectToGameNamespace) {
  const rest = window.location.pathname.replace(/^\/+/, '');
  const target = `/${DEFAULT_GAME}/${rest}${window.location.search}${window.location.hash}`;
  window.location.replace(target);
} else {
  const basename = GAME_CODES.includes(firstSegment) ? `/${firstSegment}` : undefined;
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter basename={basename}>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </React.StrictMode>,
  );
}
