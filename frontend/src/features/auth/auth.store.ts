import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AdminInfo } from '@/api/admin';

interface AuthState {
  token: string | null;
  expiresAt: number | null;
  admin: AdminInfo | null;

  setAuth: (token: string, expiresInSec: number, admin: AdminInfo) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      expiresAt: null,
      admin: null,

      setAuth: (token, expiresInSec, admin) => {
        set({
          token,
          expiresAt: Date.now() + expiresInSec * 1000,
          admin,
        });
      },

      logout: () => {
        set({ token: null, expiresAt: null, admin: null });
      },

      isAuthenticated: () => {
        const { token, expiresAt } = get();
        if (!token) return false;
        if (expiresAt && Date.now() > expiresAt) {
          // 過期清掉
          get().logout();
          return false;
        }
        return true;
      },
    }),
    { name: 'icedragon-admin-auth' },
  ),
);
