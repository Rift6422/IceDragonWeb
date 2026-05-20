import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useAuthStore } from '@/features/auth/auth.store';

const nav = [
  { to: '/admin/dashboard', label: '儀表板' },
  { to: '/admin/orders', label: '訂單' },
  { to: '/admin/products', label: '商品' },
  { to: '/admin/users', label: '玩家' },
];

export function AdminLayout() {
  const admin = useAuthStore((s) => s.admin);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/admin/login', { replace: true });
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold text-brand-600">冰龍遊戲</span>
            <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
              後台
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-600">
              {admin?.username}{' '}
              <span className="rounded bg-brand-100 px-2 py-0.5 text-xs text-brand-700">
                {admin?.role}
              </span>
            </span>
            <button onClick={handleLogout} className="btn-secondary">
              登出
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-6 px-6 py-6">
        <aside className="w-48 flex-shrink-0">
          <nav className="space-y-1">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  clsx(
                    'block rounded-md px-3 py-2 text-sm font-medium transition',
                    isActive
                      ? 'bg-brand-600 text-white'
                      : 'text-slate-700 hover:bg-slate-200',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>

        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
