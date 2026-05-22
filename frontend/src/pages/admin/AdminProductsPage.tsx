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

const EFFECT_TYPES = ['currency', 'item', 'buff'] as const;
type EffectType = (typeof EFFECT_TYPES)[number];

interface EffectRow {
  type: EffectType;
  code: string;
  display_label: string;
  amount: string;
}

interface ProductFormState {
  code: string;
  name_display: string;
  name_internal: string;
  amount: string;
  sort_order: string;
  status: 'ACTIVE' | 'INACTIVE';
  icon: string;
  purchase_limit_label: string;
  effects: EffectRow[];
  mail_subject: string;
  mail_body: string;
  mail_expire_days: string;
  playfab_item_id: string;
  playfab_store_id: string;
}

const EMPTY_FORM: ProductFormState = {
  code: '',
  name_display: '',
  name_internal: '',
  amount: '',
  sort_order: '0',
  status: 'ACTIVE',
  icon: '',
  purchase_limit_label: '',
  effects: [{ type: 'currency', code: 'DIAMOND', display_label: '啟源石', amount: '' }],
  mail_subject: '',
  mail_body: '感謝您支持 icedragon!',
  mail_expire_days: '30',
  playfab_item_id: '',
  playfab_store_id: '',
};

const ICON_EMOJI_PRESETS = ['🎁', '🌟', '⚔️', '🎴', '📅', '🗓️', '📆', '🔮', '💎', '🏆', '👑', '⭐'];

/**
 * 圖片 preset:檔案放在 frontend/public/icons/,vite build 會打進 Docker image。
 * 後台填入這些路徑後,玩家前台會用 <img> render(自動偵測是路徑就 render 圖)。
 *
 * 加新圖片步驟:
 *   1. 圖檔丟進 `frontend/public/icons/`
 *   2. 在這個陣列 push 一行 { label, path }
 *   3. 重 build Docker image
 */
const ICON_IMAGE_PRESETS: Array<{ label: string; path: string }> = [
  { label: '禮包預設', path: '/icons/bundle-default.jpg' },
  { label: '啟源石預設', path: '/icons/stone-default.jpg' },
  { label: '商店 mascot', path: '/icons/icedragon-shop.webp' },
];

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
    <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">ACTIVE</span>
  ) : (
    <span className="rounded bg-slate-200 px-2 py-0.5 text-xs text-slate-500">INACTIVE</span>
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

  const addEffect = () =>
    setForm((s) => ({
      ...s,
      effects: [...s.effects, { type: 'currency', code: '', display_label: '', amount: '' }],
    }));

  const removeEffect = (i: number) =>
    setForm((s) => ({ ...s, effects: s.effects.filter((_, idx) => idx !== i) }));

  const updateEffect = (i: number, patch: Partial<EffectRow>) =>
    setForm((s) => ({
      ...s,
      effects: s.effects.map((e, idx) => (idx === i ? { ...e, ...patch } : e)),
    }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationErr(null);

    if (mode === 'create' && !/^[A-Z0-9_]+$/.test(form.code)) {
      setValidationErr('Code 必須是 UPPER_SNAKE_CASE(A-Z 0-9 _)');
      return;
    }
    if (!form.name_display || !form.name_internal) {
      setValidationErr('顯示名稱與內部名稱必填');
      return;
    }
    if (!/^\d+(\.\d{1,2})?$/.test(form.amount)) {
      setValidationErr('金額格式錯誤');
      return;
    }
    for (const [i, eff] of form.effects.entries()) {
      if (!eff.code || !eff.display_label || !eff.amount) {
        setValidationErr(`包含內容第 ${i + 1} 列:code、標籤、數量都要填`);
        return;
      }
      if (!/^\d+$/.test(eff.amount)) {
        setValidationErr(`包含內容第 ${i + 1} 列:數量必須是整數`);
        return;
      }
    }

    const effectsJson: Record<string, unknown> = {
      effects: form.effects.map((e) => ({
        type: e.type,
        code: e.code,
        display_label: e.display_label,
        amount: parseInt(e.amount, 10),
      })),
      mail: {
        subject: form.mail_subject || `購買成功 — ${form.name_display}`,
        body: form.mail_body,
        expire_days: parseInt(form.mail_expire_days, 10) || 30,
      },
    };
    if (form.icon) effectsJson.icon = form.icon;
    if (form.purchase_limit_label) effectsJson.purchase_limit_label = form.purchase_limit_label;

    onSave({
      code: form.code,
      name_display: form.name_display,
      name_internal: form.name_internal,
      amount: form.amount,
      sort_order: parseInt(form.sort_order, 10) || 0,
      status: form.status,
      effects: effectsJson,
      playfab_item_id: form.playfab_item_id.trim() || undefined,
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
            <Field label="Code(UPPER_SNAKE_CASE)" hint="例:DIAMOND_200、BUNDLE_DAILY">
              <input
                type="text"
                value={form.code}
                onChange={(e) => update('code', e.target.value.toUpperCase())}
                className="input font-mono"
                disabled={mode === 'edit'}
                placeholder="BUNDLE_NEW"
              />
            </Field>
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
            <Field label="內部名稱(後台 / 對帳用)">
              <input
                type="text"
                value={form.name_internal}
                onChange={(e) => update('name_internal', e.target.value)}
                className="input"
                placeholder="新手啟源包(限購一次)"
                maxLength={200}
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
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
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

                <div>
                  <div className="mb-1 text-xs text-slate-500">圖片 preset</div>
                  <div className="flex flex-wrap gap-2">
                    {ICON_IMAGE_PRESETS.map((p) => (
                      <button
                        type="button"
                        key={p.path}
                        onClick={() => update('icon', p.path)}
                        className="flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs hover:border-brand-400 hover:bg-brand-50"
                        title={p.path}
                      >
                        <img
                          src={p.path}
                          alt={p.label}
                          width={28}
                          height={28}
                          style={{ imageRendering: 'pixelated', width: 28, height: 28 }}
                          className="rounded"
                        />
                        <span>{p.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-1 text-xs text-slate-500">Emoji preset</div>
                  <div className="flex flex-wrap gap-1">
                    {ICON_EMOJI_PRESETS.map((emoji) => (
                      <button
                        type="button"
                        key={emoji}
                        onClick={() => update('icon', emoji)}
                        className="rounded border border-slate-200 px-2 py-1 text-xl hover:border-brand-400 hover:bg-brand-50"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
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
              <Field
                label="PlayFab itemId"
                hint="對應 PlayFab catalog item。空 = 不查限購,所有玩家都能買"
              >
                <input
                  type="text"
                  value={form.playfab_item_id}
                  onChange={(e) => update('playfab_item_id', e.target.value)}
                  className="input font-mono"
                  placeholder="all_time_pack_1"
                  maxLength={64}
                />
              </Field>
              <Field
                label="PlayFab storeID"
                hint="空 = 用環境變數預設(GAME_BACKEND_STORE_ID)"
              >
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

          {/* 包含內容 */}
          <Section title="包含內容(派發給玩家的物品)">
            <div className="space-y-2">
              {form.effects.map((eff, i) => (
                <div
                  key={i}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2"
                >
                  <select
                    value={eff.type}
                    onChange={(e) =>
                      updateEffect(i, { type: e.target.value as EffectType })
                    }
                    className="input w-24"
                  >
                    {EFFECT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={eff.code}
                    onChange={(e) =>
                      updateEffect(i, { code: e.target.value.toUpperCase() })
                    }
                    className="input w-32 font-mono text-xs"
                    placeholder="DIAMOND"
                  />
                  <input
                    type="text"
                    value={eff.display_label}
                    onChange={(e) => updateEffect(i, { display_label: e.target.value })}
                    className="input flex-1"
                    placeholder="啟源石"
                  />
                  <input
                    type="number"
                    value={eff.amount}
                    onChange={(e) => updateEffect(i, { amount: e.target.value })}
                    className="input w-24"
                    placeholder="100"
                    min={0}
                  />
                  <button
                    type="button"
                    onClick={() => removeEffect(i)}
                    disabled={form.effects.length === 1}
                    className="text-rose-600 hover:text-rose-800 disabled:opacity-30"
                    title={form.effects.length === 1 ? '至少要留一筆' : '刪除'}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addEffect}
                className="rounded border border-dashed border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:border-brand-400 hover:bg-brand-50"
              >
                + 新增一筆
              </button>
            </div>
          </Section>

          {/* 信件 */}
          <Section title="派發信件(寄到玩家遊戲信箱的訊息)">
            <Field label="信件主旨">
              <input
                type="text"
                value={form.mail_subject}
                onChange={(e) => update('mail_subject', e.target.value)}
                className="input"
                placeholder={`(空白時自動帶:購買成功 — ${form.name_display})`}
              />
            </Field>
            <Field label="信件內文">
              <textarea
                value={form.mail_body}
                onChange={(e) => update('mail_body', e.target.value)}
                className="input min-h-[60px]"
              />
            </Field>
            <Field label="失效天數">
              <input
                type="number"
                value={form.mail_expire_days}
                onChange={(e) => update('mail_expire_days', e.target.value)}
                className="input w-24"
                min={1}
                max={365}
              />
            </Field>
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

interface ProductEffectShape {
  type?: string;
  code?: string;
  display_label?: string;
  amount?: number;
}
interface ProductEffectsShape {
  effects?: ProductEffectShape[];
  mail?: { subject?: string; body?: string; expire_days?: number };
  icon?: string;
  purchase_limit_label?: string;
}

function productToForm(p: AdminProduct): ProductFormState {
  const e = (p.effects ?? {}) as ProductEffectsShape;
  const effects: EffectRow[] =
    e.effects && e.effects.length > 0
      ? e.effects.map((x) => ({
          type: (EFFECT_TYPES.includes(x.type as EffectType)
            ? (x.type as EffectType)
            : 'currency'),
          code: x.code ?? '',
          display_label: x.display_label ?? '',
          amount: x.amount != null ? String(x.amount) : '',
        }))
      : [{ type: 'currency', code: 'DIAMOND', display_label: '啟源石', amount: '' }];

  return {
    code: p.code,
    name_display: p.nameDisplay,
    name_internal: p.nameInternal,
    amount: String(p.amount),
    sort_order: String(p.sortOrder),
    status: p.status,
    icon: e.icon ?? '',
    purchase_limit_label: e.purchase_limit_label ?? '',
    effects,
    mail_subject: e.mail?.subject ?? '',
    mail_body: e.mail?.body ?? '',
    mail_expire_days: String(e.mail?.expire_days ?? 30),
    playfab_item_id: p.playfabItemId ?? '',
    playfab_store_id: p.playfabStoreId ?? '',
  };
}
