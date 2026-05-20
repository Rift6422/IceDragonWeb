import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './auth.store';

export function RequireAdmin({ children }: { children: ReactNode }) {
  const isAuth = useAuthStore((s) => s.isAuthenticated());
  const location = useLocation();

  if (!isAuth) {
    return <Navigate to="/admin/login" state={{ from: location.pathname }} replace />;
  }

  return <>{children}</>;
}
