import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import api from '../services/api';

function getDeviceId() {
  let id = localStorage.getItem('device_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('device_id', id);
  }
  return id;
}

export const useAuthStore = create(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      loading: false,
      error: null,

      login: async (email, password) => {
        set({ loading: true, error: null });
        try {
          const deviceId = getDeviceId();
          const res = await api.post('/auth/login', { email, password, deviceId });

          if (res.data.requires_otp) {
            set({ loading: false });
            return res.data; // { requires_otp: true, tempToken, phone }
          }

          set({ user: res.data.user, token: res.data.token, loading: false });
          return res.data;
        } catch (err) {
          const msg = err.response?.data?.error || 'Giriş başarısız';
          set({ loading: false, error: msg });
          throw new Error(msg);
        }
      },

      verifyOtp: async (tempToken, otp) => {
        set({ loading: true, error: null });
        try {
          const res = await api.post('/auth/verify-otp', { tempToken, otp });
          set({ user: res.data.user, token: res.data.token, loading: false });
          return res.data;
        } catch (err) {
          const msg = err.response?.data?.error || 'Doğrulama başarısız';
          set({ loading: false, error: msg });
          throw new Error(msg);
        }
      },

      register: async (data) => {
        set({ loading: true, error: null });
        try {
          const res = await api.post('/auth/register', data);
          set({ user: res.data.user, token: res.data.token, loading: false });
          return res.data;
        } catch (err) {
          const msg = err.response?.data?.error || 'Kayıt başarısız';
          set({ loading: false, error: msg });
          throw new Error(msg);
        }
      },

      logout: () => {
        set({ user: null, token: null });
      },

      fetchUser: async () => {
        try {
          const res = await api.get('/auth/me');
          set({ user: res.data });
        } catch {
          set({ user: null, token: null });
        }
      }
    }),
    { name: 'auth-storage', partialize: (state) => ({ token: state.token, user: state.user }) }
  )
);
