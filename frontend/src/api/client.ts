import axios, { AxiosError } from 'axios';
import { useAuthStore } from '@/features/auth/auth.store';

export const api = axios.create({
  baseURL: '/',
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptor:自動帶上 Bearer token
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor:401 → 登出 + 導回登入頁
api.interceptors.response.use(
  (res) => res,
  (err: AxiosError) => {
    if (err.response?.status === 401) {
      const wasAuthed = !!useAuthStore.getState().token;
      useAuthStore.getState().logout();
      if (wasAuthed && window.location.pathname.startsWith('/admin')) {
        window.location.href = '/admin/login';
      }
    }
    return Promise.reject(err);
  },
);

export interface ApiError {
  message: string | string[];
  error?: string;
  statusCode: number;
}

export function extractErrorMessage(err: unknown): string {
  if (axios.isAxiosError<ApiError>(err)) {
    const data = err.response?.data;
    if (data?.message) {
      return Array.isArray(data.message) ? data.message.join(', ') : data.message;
    }
    if (err.message) return err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Unknown error';
}
