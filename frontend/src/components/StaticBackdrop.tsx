import { useState, type ReactNode } from 'react';

/**
 * Static backdrop modal wrapper(Bootstrap 風格)
 *
 * 點背景**不會關閉** modal,但會觸發內容區「輕震一下」的視覺回饋,
 * 提示用戶「請從 ✕ 或取消按鈕關閉」。
 *
 * 用法:把原本 modal 最外層的 `fixed inset-0 ...` 跟內層的 `w-full max-w-...`
 * 兩層都拔掉,改套這個元件 + 一個 `boxClassName` 控制 modal 寬度:
 *
 *   <StaticBackdrop boxClassName="w-full max-w-2xl">
 *     <div className="overflow-hidden rounded-xl bg-white shadow-2xl">
 *       ...modal content...
 *     </div>
 *   </StaticBackdrop>
 */
export function StaticBackdrop({
  children,
  boxClassName = '',
}: {
  children: ReactNode;
  /** 套用在內層的 wrapper(modal 寬度等)。動畫 class 會自動 merge 上來 */
  boxClassName?: string;
}) {
  const [shaking, setShaking] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 px-4 py-8"
      onClick={() => {
        if (!shaking) setShaking(true);
      }}
    >
      <div
        className={`${boxClassName} ${shaking ? 'animate-modal-shake' : ''}`}
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={() => setShaking(false)}
      >
        {children}
      </div>
    </div>
  );
}
