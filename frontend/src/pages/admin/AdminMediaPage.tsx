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

/**
 * 圖庫管理頁(/admin/media)— 只顯示啟用中的媒體。
 * 軟刪除的還在 DB / 磁碟,只是後台不顯示。
 */
export function AdminMediaPage() {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'media'],
    queryFn: () => fetchMediaList(),
  });

  const uploadMut = useMutation({
    mutationFn: (file: File) => uploadMedia(file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'media'] }),
    onError: (err) => setUploadErr(extractErrorMessage(err)),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteMedia(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'media'] });
      setConfirmId(null);
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
    e.target.value = '';
  };

  const items = data?.items ?? [];
  const totalBytes = items.reduce((acc, m) => acc + m.size_bytes, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">圖庫</h1>
          <p className="mt-1 text-xs text-slate-500">
            上限 5MB,支援 JPG / PNG / WebP / GIF。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMut.isPending}
            className="btn-primary"
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
        </div>
      </div>

      {uploadErr && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          上傳失敗:{uploadErr}
        </div>
      )}

      <div className="card flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-600">
        <span>
          顯示中:<strong>{items.length}</strong> 張
        </span>
        <span>
          佔用空間:<strong>{(totalBytes / 1024 / 1024).toFixed(2)} MB</strong>
        </span>
      </div>

      {isLoading ? (
        <div className="card text-sm text-slate-400">載入中…</div>
      ) : items.length === 0 ? (
        <div className="card py-12 text-center text-sm text-slate-400">
          圖庫是空的 — 點右上「上傳新圖」加第一張
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {items.map((m) => (
            <MediaCard key={m.id} item={m} onDelete={() => setConfirmId(m.id)} />
          ))}
        </div>
      )}

      {confirmId && (
        <div className="card border-rose-200 bg-rose-50">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="text-rose-700">
              確定要刪除這張圖?既存商品 icon 仍會繼續顯示。
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmId(null)}
                className="rounded border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-100"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => deleteMut.mutate(confirmId)}
                disabled={deleteMut.isPending}
                className="rounded bg-rose-600 px-3 py-1 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-60"
              >
                {deleteMut.isPending ? '處理中…' : '確定刪除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MediaCard({ item, onDelete }: { item: MediaItem; onDelete: () => void }) {
  return (
    <div className="flex flex-col rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="relative aspect-square overflow-hidden rounded-t-lg bg-slate-50">
        <img
          src={item.url}
          alt={item.original_name ?? ''}
          className="h-full w-full object-contain p-2"
          loading="lazy"
        />
      </div>
      <div className="space-y-1 px-2 py-2 text-[11px]">
        <div className="truncate font-medium text-slate-800" title={item.original_name ?? item.filename}>
          {item.original_name ?? item.filename}
        </div>
        <div className="flex items-center justify-between text-slate-500">
          <span>{(item.size_bytes / 1024).toFixed(1)} KB</span>
          <span title={new Date(item.uploaded_at).toLocaleString('zh-TW')}>
            {new Date(item.uploaded_at).toLocaleDateString('zh-TW')}
          </span>
        </div>
        <div className="flex gap-1 pt-1">
          <CopyUrlButton url={item.url} />
          <button
            type="button"
            onClick={onDelete}
            className="flex-1 rounded border border-rose-300 px-2 py-1 text-rose-600 hover:bg-rose-50"
          >
            刪除
          </button>
        </div>
      </div>
    </div>
  );
}

function CopyUrlButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          window.prompt('複製 URL:', url);
        }
      }}
      className="flex-1 rounded border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-100"
      title="複製檔案 URL(可直接貼進商品 icon 欄位)"
    >
      {copied ? '✓ 已複製' : '複製連結'}
    </button>
  );
}

function validateMedia(file: File): string | null {
  if (!MEDIA_ALLOWED_MIMES.includes(file.type as (typeof MEDIA_ALLOWED_MIMES)[number])) {
    return `不支援的檔案類型 ${file.type || '未知'}(允許:JPG / PNG / WebP / GIF)`;
  }
  if (file.size > MEDIA_MAX_BYTES) {
    return `檔案過大(限制 5MB,實際 ${(file.size / 1024 / 1024).toFixed(2)}MB)`;
  }
  return null;
}
