import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchUsers } from '@/api/admin';

export function AdminUsersPage() {
  const [search, setSearch] = useState({ uid: '', email: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', search],
    queryFn: () =>
      fetchUsers({
        uid: search.uid || undefined,
        email: search.email || undefined,
        limit: 100,
      }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">玩家(GameUser)</h1>
        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
          read-only(由遊戲端建立)
        </span>
      </div>

      <div className="card flex gap-3">
        <div>
          <label className="label text-xs">UID(部分或完整)</label>
          <input
            className="input mt-1 w-44 font-mono uppercase"
            placeholder="E9E3E1A9..."
            value={search.uid}
            onChange={(e) => setSearch((s) => ({ ...s, uid: e.target.value.toUpperCase() }))}
          />
        </div>
        <div>
          <label className="label text-xs">Email</label>
          <input
            className="input mt-1 w-64"
            placeholder="player@example.com"
            value={search.email}
            onChange={(e) => setSearch((s) => ({ ...s, email: e.target.value }))}
          />
        </div>
        <div className="self-end">
          <button onClick={() => setSearch({ uid: '', email: '' })} className="btn-secondary">
            清除
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="card">載入中...</div>
      ) : !data || data.items.length === 0 ? (
        <div className="card text-sm text-slate-400">無資料</div>
      ) : (
        <>
          <div className="text-sm text-slate-600">共 {data.total} 筆</div>
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">UID</th>
                  <th className="px-3 py-2 text-left">Email</th>
                  <th className="px-3 py-2 text-left">顯示名稱</th>
                  <th className="px-3 py-2 text-center">狀態</th>
                  <th className="px-3 py-2 text-left">最後登入</th>
                  <th className="px-3 py-2 text-left">建立時間</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono text-xs">{u.uid}</td>
                    <td className="px-3 py-2 text-xs">{u.email ?? '—'}</td>
                    <td className="px-3 py-2 text-xs">{u.display_name ?? '—'}</td>
                    <td className="px-3 py-2 text-center">
                      {u.is_active ? (
                        <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">
                          active
                        </span>
                      ) : (
                        <span className="rounded bg-slate-200 px-2 py-0.5 text-xs text-slate-500">
                          inactive
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {u.last_login_at ? new Date(u.last_login_at).toLocaleString('zh-TW') : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {new Date(u.created_at).toLocaleString('zh-TW')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
