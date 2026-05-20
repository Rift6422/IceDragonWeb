import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { adminLogin } from '@/api/admin';
import { useAuthStore } from '@/features/auth/auth.store';
import { extractErrorMessage } from '@/api/client';

interface LoginForm {
  username: string;
  password: string;
}

export function AdminLoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { register, handleSubmit, formState } = useForm<LoginForm>({
    defaultValues: { username: 'admin', password: '' },
  });

  const onSubmit = async (data: LoginForm) => {
    setError(null);
    setLoading(true);
    try {
      const res = await adminLogin(data.username, data.password);
      setAuth(res.access_token, res.expires_in, res.admin);
      const from = (location.state as { from?: string } | null)?.from ?? '/admin/dashboard';
      navigate(from, { replace: true });
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md card">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-brand-700">冰龍遊戲 後台</h1>
          <p className="mt-1 text-sm text-slate-500">Admin Login</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="label">帳號</label>
            <input
              {...register('username', { required: '請輸入帳號' })}
              className="input mt-1"
              autoComplete="username"
            />
            {formState.errors.username && (
              <p className="mt-1 text-xs text-red-600">{formState.errors.username.message}</p>
            )}
          </div>

          <div>
            <label className="label">密碼</label>
            <input
              type="password"
              {...register('password', { required: '請輸入密碼', minLength: { value: 8, message: '至少 8 字元' } })}
              className="input mt-1"
              autoComplete="current-password"
            />
            {formState.errors.password && (
              <p className="mt-1 text-xs text-red-600">{formState.errors.password.message}</p>
            )}
          </div>

          {error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? '登入中...' : '登入'}
          </button>

          <p className="text-center text-xs text-slate-400">
            預設帳號:admin / admin123(僅 dev)
          </p>
        </form>
      </div>
    </div>
  );
}
