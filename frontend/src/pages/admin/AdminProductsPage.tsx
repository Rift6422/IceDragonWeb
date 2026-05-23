import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createProduct,
  deactivateProduct,
  fetchProducts,
  updateProduct,
  type AdminProduct,
  type CreateProductInput,
} from '@/api/admin';
import { extractErrorMessage } from '@/api/client';

// ============================================================
// 後台商品管理:列表 + Modal 表單(新增 / 編輯共用)
// 表單支援完整 effects JSON 編輯:
//   - 基本欄位:code, name_display, name_internal, amount, sort_order, status
//   - 展示:icon emoji, purchase_limit_label
//   - 包含內容:effects 陣列(每筆 type / code / display_label / amount)
//   - 信件:mail.subject / body / expire_days
// ============================================================

interface ProductFormState {
  name_display: string;
  amount: string;
  sort_order: string;
  status: 'ACTIVE' | 'INACTIVE';
  icon: string;
  purchase_limit_label: string;
  playfab_item_id: string;
  playfab_store_id: string;
}

const EMPTY_FORM: ProductFormState = {
  name_display: '',
  amount: '',
  sort_order: '0',
  status: 'ACTIVE',
  icon: '',
  purchase_limit_label: '',
  playfab_item_id: '',
  playfab_store_id: '',
};

function isImageIcon(s: string): boolean {
  return s.startsWith('/') || s.startsWith('http://') || s.startsWith('https://');
}

export function AdminProductsPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<{ mode: 'create' | 'edit'; product?: AdminProduct } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'products'],
    queryFn: () => fetchProducts({ limit: 200 }),
  });

  const createMut = useMutation({
    mutationFn: (input: CreateProductInput) => createProduct(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'products'] });
      setEditing(null);
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<CreateProductInput> }) =>
      updateProduct(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'products'] });
      setEditing(null);
    },
  });

  const deactivateMut = useMutation({
    mutationFn: (id: string) => deactivateProduct(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'products'] }),
  });

  const reactivateMut = useMutation({
    mutationFn: (id: string) => updateProduct(id, { status: 'ACTIVE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'products'] }),
  });

  const submitting = createMut.isPending || updateMut.isPending;
  const error =
    createMut.error || updateMut.error
      ? extractErrorMessage(createMut.error || updateMut.error)
      : null;

  const onSave = (input: CreateProductInput) => {
    if (editing?.mode === 'edit' && editing.product) {
      const { code, ...patch } = input;
      void code;
      updateMut.mutate({ id: editing.product.id, patch });
    } else {
      createMut.mutate(input);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">商品</h1>
        <button
          onClick={() => setEditing({ mode: 'create' })}
          className="btn-primary"
        >
          + 新增商品
        </button>
      </div>

      {isLoading ? (
        <div className="card">載入中...</div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">code</th>
                <th className="px-3 py-2 text-left">圖示</th>
                <th className="px-3 py-2 text-left">顯示名稱</th>
                <th className="px-3 py-2 text-left">限購</th>
                <th className="px-3 py-2 text-right">金額</th>
                <th className="px-3 py-2 text-center">狀態</th>
                <th className="px-3 py-2 text-center">sort</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data?.items.map((p) => {
                const effects = (p.effects ?? {}) as {
                  icon?: string;
                  purchase_limit_label?: string;
                };
                return (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono text-xs">{p.code}</td>
                    <td className="px-3 py-2">
                      {effects.icon ? (
                        isImageIcon(effects.icon) ? (
                          <img
                            src={effects.icon}
                            alt=""
                            width={32}
                            height={32}
                            style={{ imageRendering: 'pixelated', width: 32, height: 32 }}
                            className="rounded"
                          />
                        ) : (
                          <span className="text-xl">{effects.icon}</span>
                        )
                      ) : (
                        <span className="text-slate-300">·</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{p.nameDisplay}</td>
                    <td className="px-3 py-2 text-xs text-amber-700">
                      {effects.purchase_limit_label ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right">NT$ {p.amount}</td>
                    <td className="px-3 py-2 text-center">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="px-3 py-2 text-center text-xs text-slate-500">
                      {p.sortOrder}
                    </td>
                    <td className="space-x-3 px-3 py-2 text-right text-xs">
                      <CopyLinkButton code={p.code} />
                      <button
                        onClick={() => setEditing({ mode: 'edit', product: p })}
                        className="text-brand-600 hover:underline"
                      >
                        編輯
                      </button>
                      {p.status === 'ACTIVE' ? (
                        <button
                          onClick={() => {
                            if (confirm(`確定下架 ${p.code}?`)) deactivateMut.mutate(p.id);
                          }}
                          className="text-red-600 hover:underline"
                        >
                          下架
                        </button>
                      ) : (
                        <button
                          onClick={() => reactivateMut.mutate(p.id)}
                          className="text-emerald-600 hover:underline"
                        >
                          重新上架
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ProductFormModal
          mode={editing.mode}
          product={editing.product}
          submitting={submitting}
          error={error}
          onSave={onSave}
          onCancel={() => {
            if (!submitting) {
              setEditing(null);
              createMut.reset();
              updateMut.reset();
            }
          }}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: AdminProduct['status'] }) {
  return status === 'ACTIVE' ? (
    <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">啟用</span>
  ) : (
    <span className="rounded bg-slate-200 px-2 py-0.5 text-xs text-slate-500">下架</span>
  );
}

/**
 * 複製商品 deep link 到剪貼簿。
 *
 * 行銷用:把 deep link 貼到 Discord / FB / Line,玩家點進來會直接看到該商品 modal,
 * 不必自己翻 tab 找。`{uid}` 是 placeholder,行銷可以手動 sed 換成個別玩家 UID 後發送。
 *
 * 注意:此 deep link 是「網頁版」推廣用 — App 內絕對不能放(違反 Google Play 政策)。
 */
function CopyLinkButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const base = window.location.origin;
    const url = `${base}/?item=${encodeURIComponent(code)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 部分 browser 不支援 → 退回 prompt 讓用戶手動複製
      window.prompt('複製此連結:', url);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="text-slate-500 hover:text-slate-800 hover:underline"
      title="複製商品連結(行銷推廣用,玩家點進來會直接顯示此商品 modal)"
    >
      {copied ? '✓ 已複製' : '🔗 連結'}
    </button>
  );
}

// ============================================================
// Modal form
// ============================================================

function ProductFormModal({
  mode,
  product,
  submitting,
  error,
  onSave,
  onCancel,
}: {
  mode: 'create' | 'edit';
  product?: AdminProduct;
  submitting: boolean;
  error: string | null;
  onSave: (input: CreateProductInput) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<ProductFormState>(() =>
    product ? productToForm(product) : EMPTY_FORM,
  );
  const [validationErr, setValidationErr] = useState<string | null>(null);

  useEffect(() => {
    setForm(product ? productToForm(product) : EMPTY_FORM);
  }, [product]);

  const update = <K extends keyof ProductFormState>(k: K, v: ProductFormState[K]) =>
    setForm((s) => ({ ...s, [k]: v }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationErr(null);

    const playfabItemId = form.playfab_item_id.trim();
    if (mode === 'create' && !playfabItemId) {
      setValidationErr('PlayFab itemId 必填(會被當作商品 code 使用)');
      return;
    }
    // 新建商品時 code = playfab_item_id 大寫(後端 schema 要求 UPPER_SNAKE_CASE)
    // 編輯既有商品時 code 不可改(訂單 FK 依賴),維持原值
    const code = mode === 'create' ? playfabItemId.toUpperCase() : product!.code;
    if (mode === 'create' && !/^[A-Z0-9_]+$/.test(code)) {
      setValidationErr('PlayFab itemId 只能含英數與底線(會被轉成 UPPER_SNAKE_CASE 當 code)');
      return;
    }
    if (!form.name_display) {
      setValidationErr('顯示名稱必填');
      return;
    }
    if (!/^\d+(\.\d{1,2})?$/.test(form.amount)) {
      setValidationErr('金額格式錯誤');
      return;
    }

    // effects 內容由遊戲端 PlayFab catalog 主控,後台只維護 web 端展示資訊
    // 保留既有商品的 effects(避免清空後派發少資料);新建商品 effects 留空
    const existingEffects =
      mode === 'edit' && product?.effects && typeof product.effects === 'object'
        ? (product.effects as Record<string, unknown>)
        : {};

    const effectsJson: Record<string, unknown> = { ...existingEffects };
    if (form.icon) effectsJson.icon = form.icon;
    else delete effectsJson.icon;
    if (form.purchase_limit_label) effectsJson.purchase_limit_label = form.purchase_limit_label;
    else delete effectsJson.purchase_limit_label;

    onSave({
      code,
      // 內部名稱不再分離,直接同步顯示名稱(後台 / 對帳查詢仍可用)
      name_display: form.name_display,
      name_internal: form.name_display,
      amount: form.amount,
      sort_order: parseInt(form.sort_order, 10) || 0,
      status: form.status,
      effects: effectsJson,
      playfab_item_id: playfabItemId || undefined,
      playfab_store_id: form.playfab_store_id.trim() || undefined,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 px-4 py-8"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3">
          <h2 className="text-lg font-semibold">
            {mode === 'create' ? '新增商品' : `編輯商品 — ${product?.code}`}
          </h2>
          <button
            onClick={onCancel}
            disabled={submitting}
            className="text-slate-400 hover:text-slate-600"
            aria-label="關閉"
          >
            ✕
          </button>
        </div>

        <form onSubmit={submit} className="space-y-5 px-5 py-4">
          {/* 基本資料 */}
          <Section title="基本資料">
            {mode === 'edit' && (
              <Field label="Code(自動由 PlayFab itemId 產生,不可改)">
                <input
                  type="text"
                  value={product?.code ?? ''}
                  className="input font-mono"
                  disabled
                />
              </Field>
            )}
            <Field label="顯示名稱(玩家看到)">
              <input
                type="text"
                value={form.name_display}
                onChange={(e) => update('name_display', e.target.value)}
                className="input"
                placeholder="新手啟源包"
                maxLength={100}
              />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="金額(TWD)">
                <input
                  type="text"
                  value={form.amount}
                  onChange={(e) => update('amount', e.target.value)}
                  className="input"
                  placeholder="290"
                />
              </Field>
              <Field label="排序">
                <input
                  type="number"
                  value={form.sort_order}
                  onChange={(e) => update('sort_order', e.target.value)}
                  className="input"
                  min={0}
                />
              </Field>
              <Field label="狀態">
                <select
                  value={form.status}
                  onChange={(e) => update('status', e.target.value as 'ACTIVE' | 'INACTIVE')}
                  className="input"
                >
                  <option value="ACTIVE">啟用</option>
                  <option value="INACTIVE">下架</option>
                </select>
              </Field>
            </div>
          </Section>

          {/* 展示 */}
          <Section title="玩家端展示">
            <Field
              label="圖示(可填 emoji 或 圖片路徑 /icons/xxx.jpg)"
              hint="路徑型(/ 或 http:// 開頭)會用 <img> render;其他文字當 emoji"
            >
              <div className="space-y-3">
                <input
                  type="text"
                  value={form.icon}
                  onChange={(e) => update('icon', e.target.value)}
                  className="input"
                  placeholder="🎁  或  /icons/bundle-default.jpg"
                />

                {/* 即時預覽 */}
                {form.icon && (
                  <div className="flex items-center gap-3 rounded border border-slate-200 bg-slate-50 p-2">
                    <span className="text-xs text-slate-500">預覽:</span>
                    {isImageIcon(form.icon) ? (
                      <img
                        src={form.icon}
                        alt="preview"
                        width={48}
                        height={48}
                        style={{ imageRendering: 'pixelated', width: 48, height: 48 }}
                        className="rounded"
                      />
                    ) : (
                      <span className="text-3xl">{form.icon}</span>
                    )}
                  </div>
                )}

              </div>
            </Field>
            <Field label="限購標籤(純展示,例:限購 1/1、每日限購 2/2)">
              <input
                type="text"
                value={form.purchase_limit_label}
                onChange={(e) => update('purchase_limit_label', e.target.value)}
                className="input"
                placeholder="限購 1/1"
              />
            </Field>
          </Section>

          {/* PlayFab 對應 */}
          <Section title="PlayFab 對應(限購由遊戲端控管)">
            <div className="grid grid-cols-2 gap-3">
              <Field label="PlayFab itemId">
                <input
                  type="text"
                  value={form.playfab_item_id}
                  onChange={(e) => update('playfab_item_id', e.target.value)}
                  className="input font-mono"
                  placeholder="all_time_pack_1"
                  maxLength={64}
                  disabled={mode === 'edit'}
                />
              </Field>
              <Field label="PlayFab storeID">
                <input
                  type="text"
                  value={form.playfab_store_id}
                  onChange={(e) => update('playfab_store_id', e.target.value)}
                  className="input font-mono"
                  placeholder="RMPacksStore"
                  maxLength={64}
                />
              </Field>
            </div>
          </Section>

          {(validationErr || error) && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {validationErr || error}
            </div>
          )}

          <div className="sticky bottom-0 -mx-5 flex justify-end gap-2 border-t border-slate-200 bg-white px-5 pt-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="btn-secondary"
            >
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

// ============================================================
// Helpers
// ============================================================

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-slate-700">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label mb-1 block text-xs">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

interface ProductEffectsShape {
  icon?: string;
  purchase_limit_label?: string;
}

function productToForm(p: AdminProduct): ProductFormState {
  const e = (p.effects ?? {}) as ProductEffectsShape;
  return {
    name_display: p.nameDisplay,
    amount: String(p.amount),
    sort_order: String(p.sortOrder),
    status: p.status,
    icon: e.icon ?? '',
    purchase_limit_label: e.purchase_limit_label ?? '',
    playfab_item_id: p.playfabItemId ?? '',
    playfab_store_id: p.playfabStoreId ?? '',
  };
}
