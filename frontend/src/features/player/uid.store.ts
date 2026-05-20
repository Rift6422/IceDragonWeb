import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * 玩家身分(MVP):只持有 16 碼 hex UID。
 * v1.1 接入 Google / Facebook OAuth 後,UID 改由 session 回傳,
 * 但對外介面(this store)維持不變,呼叫端不必動。
 */
interface PlayerIdentityState {
  uid: string | null;
  email: string | null;
  setIdentity: (uid: string, email?: string | null) => void;
  clear: () => void;
}

export const isValidUid = (s: string): boolean => /^[0-9A-Fa-f]{16}$/.test(s);

export const normalizeUid = (s: string): string => s.trim().toUpperCase();

export const usePlayerStore = create<PlayerIdentityState>()(
  persist(
    (set) => ({
      uid: null,
      email: null,
      setIdentity: (uid, email = null) => set({ uid: normalizeUid(uid), email }),
      clear: () => set({ uid: null, email: null }),
    }),
    { name: 'icedragon-player-identity' },
  ),
);
