import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  deleteMedia,
  fetchMediaList,
  uploadMedia,
  MEDIA_ALLOWED_MIMES,
  MEDIA_MAX_BYTES,
  type MediaItem,
} from '@/api/admin';
import { extractErrorMessage } from '@/api/client';
import { StaticBackdrop } from './StaticBackdrop';

/**
 * 圖庫選擇器 — 後台商品 icon / 廣告素材通用
 *
 * 行為:
 *   - 進場拉一次 /api/admin/media 列表
 *   - 點縮圖 → onSelect(item.url) + 自動關閉
 *   - 「上傳新圖」走 multipart,成功後立刻選中(同步觸發 onSelect)
 *   - 右上角刪除(軟刪),僅後台檢視用,既存商品 icon 仍可顯示
 */
export function MediaPicker({
  onSelect,
  onClose,
}: {
  onSelect: (url: string) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'media', { includeDeleted: false }],
    queryFn: () => fetchMediaList(),
  });

  const uploadMut = useMutation({
    mutationFn: (file: File) => uploadMedia(file),
    onSuccess: (item) => {
      qc.invalidateQueries({ queryKey: ['admin', 'media'] });
      onSelect(item.url);
      onClose();
    },
    onError: (err) => setUploadErr(extractErrorMessage(err)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteMedia(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'media'] });
      setDeleteConfirmId(null);
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploadErr(null);
    const pre = validateMedia(f);
    if (pre) {
      setUploadErr(pre);
      e.target.value = '';
      return;
    }
    uploadMut.mutate(f);
    e.target.value = ''; // 同檔再上傳也能觸發
  };

  return (
    <StaticBackdrop boxClassName="w-full max-w-4xl">
      <div className="overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3">
          <div>
            <h2 className="text-lg font-semibold">圖庫</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              點縮圖選用;或從本機上傳新圖(支援 JPG / PNG / WebP / GIF,5MB 內)
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadMut.isPending}
              className="btn-primary text-sm"
            >
              {uploadMut.isPending ? '上傳中…' : '⬆ 上傳新圖'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              hidden
              onChange={handleFileChange}
            />
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600"
              aria-label="關閉"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-4">
          {uploadErr && (
            <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              上傳失敗:{uploadErr}
            </div>
          )}

          {isLoading ? (
            <div className="py-12 text-center text-sm text-slate-400">載入中…</div>
          ) : !data || data.items.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-400">
              圖庫是空的 — 點右上「上傳新圖」加第一張
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
              {data.items.map((item) => (
                <MediaTile
                  key={item.id}
                  item={item}
                  onPick={() => {
                    onSelect(item.url);
                    onClose();
                  }}
                  onAskDelete={() => setDeleteConfirmId(item.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* 內嵌的刪除確認列(避免再開一個 confirm 彈框 chain) */}
        {deleteConfirmId && (
          <div className="border-t border-rose-200 bg-rose-50 px-5 py-3">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-rose-700">
                確定要從圖庫移除這張圖?(既存商品 icon 仍會繼續顯示)
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setDeleteConfirmId(null)}
                  className="rounded border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-100"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => deleteMut.mutate(deleteConfirmId)}
                  disabled={deleteMut.isPending}
                  className="rounded bg-rose-600 px-3 py-1 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-60"
                >
                  {deleteMut.isPending ? '處理中…' : '確定移除'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </StaticBackdrop>
  );
}

/** client-side 預檢,跟後端 admin-media.service 同步:5MB / 4 種 mime */
function validateMedia(file: File): string | null {
  if (!MEDIA_ALLOWED_MIMES.includes(file.type as (typeof MEDIA_ALLOWED_MIMES)[number])) {
    return `不支援的檔案類型 ${file.type || '未知'}(允許:JPG / PNG / WebP / GIF)`;
  }
  if (file.size > MEDIA_MAX_BYTES) {
    return `檔案過大(限制 5MB,實際 ${(file.size / 1024 / 1024).toFixed(2)}MB)`;
  }
  return null;
}

function MediaTile({
  item,
  onPick,
  onAskDelete,
}: {
  item: MediaItem;
  onPick: () => void;
  onAskDelete: () => void;
}) {
  return (
    <div className="group relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
      <button
        type="button"
        onClick={onPick}
        className="block h-full w-full"
        title={item.original_name ?? item.filename}
      >
        <img
          src={item.url}
          alt={item.original_name ?? ''}
          className="h-full w-full object-contain p-1"
          loading="lazy"
        />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onAskDelete();
        }}
        className="absolute right-1 top-1 rounded-full bg-white/90 px-1.5 py-0.5 text-[10px] text-rose-600 opacity-0 shadow group-hover:opacity-100"
        title="從圖庫移除"
      >
        ✕
      </button>
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-slate-900/60 px-1.5 py-0.5 text-[10px] text-white opacity-0 group-hover:opacity-100"
        title={item.original_name ?? item.filename}
      >
        {item.original_name ?? item.filename}
      </div>
    </div>
  );
}
