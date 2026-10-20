import { useEffect } from 'react';

/**
 * 設定瀏覽器分頁標題。SPA 只有一個靜態 <title>,前/後台共用,
 * 所以由各 layout 掛載時依自己的品牌覆寫(前台=神代紀事、後台=冰龍遊戲)。
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
