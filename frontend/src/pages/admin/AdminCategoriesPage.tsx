import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { extractErrorMessage } from '@/api/client';
import {
  createCategory,
  deactivateCategory,
  fetchCategories,
  updateCategory,
  type AdminCategory,
  type CreateCategoryInput,
} from '@/api/admin';

export function AdminCategoriesPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<{ mode: 'create' | 'edit'; cat?: AdminCategory } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'categories'],
    queryFn: fetchCategories,
  });

  const createMut = useMutation({
    mutationFn: (input: CreateCategoryInput) => createCategory(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'categories'] });
      setEditing(null);
    },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<CreateCategoryInput> }) =>
      updateCategory(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'categories'] });
      setEditing(null);
    },
  });
  const deactivateMut = useMutation({
    mutationFn: (id: string) => deactivateCategory(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'categories'] }),
  });
  const reactivateMut = useMutation({
    mutationFn: (id: string) => updateCategory(id, { status: 'ACTIVE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'categories'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">商品分類</h1>
        <button onClick={() => setEditing({ mode: 'create' })} className="btn-primary">
          + 新增分類
        </button>
      </div>

      {isLoading ? (
        <div className="card">載入中…</div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Code</th>
                <th className="px-3 py-2 text-left">顯示名稱</th>
                <th className="px-3 py-2 text-center">商品數</th>
                <th className="px-3 py-2 text-center">排序</th>
                <th className="px-3 py-2 text-center">狀態</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data?.items.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono text-xs text-slate-700">{c.code}</td>
                  <td className="px-3 py-2 font-medium">{c.displayName}</td>
                  <td className="px-3 py-2 text-center text-xs text-slate-500">{c.product_count}</td>
                  <td className="px-3 py-2 text-center text-xs text-slate-500">{c.sortOrder}</td>
                  <td className="px-3 py-2 text-center">
                    {c.status === 'ACTIVE' ? (
                      <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">啟用</span>
                    ) : (
                      <span className="rounded bg-slate-200 px-2 py-0.5 text-xs text-slate-500">停用</span>
                    )}
                  </td>
                  <td className="space-x-3 px-3 py-2 text-right text-xs">
                    <button
                      onClick={() => setEditing({ mode: 'edit', cat: c })}
                      className="text-brand-600 hover:underline"
                    >
                      編輯
                    </button>
                    {c.status === 'ACTIVE' ? (
                      <button
                        onClick={() => {
                          if (c.product_count > 0) {
                            if (!confirm(`分類「${c.displayName}」底下還有 ${c.product_count} 個商品,停用後玩家頁不會再顯示這個 tab,確定?`))
                              return;
                          } else if (!confirm(`確定停用「${c.displayName}」?`)) return;
                          deactivateMut.mutate(c.id);
                        }}
                        className="text-red-600 hover:underline"
                      >
                        停用
                      </button>
                    ) : (
                      <button
                        onClick={() => reactivateMut.mutate(c.id)}
                        className="text-emerald-600 hover:underline"
                      >
                        重新啟用
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <EditorModal
          mode={editing.mode}
          cat={editing.cat}
          submitting={createMut.isPending || updateMut.isPending}
          error={
            createMut.error
              ? extractErrorMessage(createMut.error)
              : updateMut.error
              ? extractErrorMessage(updateMut.error)
              : null
          }
          onSave={(input) => {
            if (editing.mode === 'create') {
              createMut.mutate(input);
            } else if (editing.cat) {
              const { code: _code, ...patch } = input;
              void _code;
              updateMut.mutate({ id: editing.cat.id, patch });
            }
          }}
          onCancel={() => {
            createMut.reset();
            updateMut.reset();
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function EditorModal({
  mode,
  cat,
  submitting,
  error,
  onSave,
  onCancel,
}: {
  mode: 'create' | 'edit';
  cat?: AdminCategory;
  submitting: boolean;
  error: string | null;
  onSave: (input: CreateCategoryInput) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState(cat?.code ?? '');
  const [displayName, setDisplayName] = useState(cat?.displayName ?? '');
  const [sortOrder, setSortOrder] = useState(String(cat?.sortOrder ?? 0));
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>(cat?.status ?? 'ACTIVE');
  const [validationErr, setValidationErr] = useState<string | null>(null);

  useEffect(() => {
    if (cat) {
      setCode(cat.code);
      setDisplayName(cat.displayName);
      setSortOrder(String(cat.sortOrder));
      setStatus(cat.status);
    }
  }, [cat]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationErr(null);
    if (mode === 'create' && !/^[A-Z0-9_]+$/.test(code)) {
      setValidationErr('Code 必須是 UPPER_SNAKE_CASE(A-Z 0-9 _)');
      return;
    }
    if (!displayName.trim()) {
      setValidationErr('顯示名稱必填');
      return;
    }
    onSave({
      code,
      display_name: displayName.trim(),
      sort_order: parseInt(sortOrder, 10) || 0,
      status,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 px-4 py-8"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3">
          <h2 className="text-lg font-semibold">
            {mode === 'create' ? '新增分類' : `編輯分類 — ${cat?.code}`}
          </h2>
          <button onClick={onCancel} disabled={submitting} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4 px-5 py-4">
          <div>
            <label className="label mb-1 block text-xs">Code(UPPER_SNAKE_CASE)</label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              className="input font-mono"
              placeholder="例:BUNDLE、CURRENCY、SEASON_PASS"
              disabled={mode === 'edit'}
              required
            />
            <p className="mt-1 text-xs text-slate-400">建後不可改,Player 端用 code 對應 fallback 圖示</p>
          </div>
          <div>
            <label className="label mb-1 block text-xs">顯示名稱(玩家看到)</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="input"
              placeholder="超值禮包"
              maxLength={100}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label mb-1 block text-xs">排序(小到大)</label>
              <input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                className="input"
                min={0}
              />
            </div>
            <div>
              <label className="label mb-1 block text-xs">狀態</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as 'ACTIVE' | 'INACTIVE')}
                className="input"
              >
                <option value="ACTIVE">啟用</option>
                <option value="INACTIVE">停用</option>
              </select>
            </div>
          </div>

          {(validationErr || error) && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {validationErr || error}
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
            <button type="button" onClick={onCancel} disabled={submitting} className="btn-secondary">
              取消
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? '儲存中…' : mode === 'create' ? '建立' : '儲存變更'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
