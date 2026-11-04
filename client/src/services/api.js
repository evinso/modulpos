import axios from 'axios';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

// The login session is an httpOnly cookie set by the API: JavaScript never sees the token. The browser sends it
// automatically (withCredentials); X-Requested-With proves to the API that a request comes from this page (CSRF guard).
const api = axios.create({
  baseURL: apiBaseUrl,
  timeout: 180000, // 3 minutes - XML converter can take up to 120s on slow servers
  withCredentials: true,
  headers: { 'X-Requested-With': 'XMLHttpRequest' },
});

// Failed credentials / logout are expected 401s, they must not bounce the page
const AUTH_ENDPOINTS = ['/auth/login', '/auth/register', '/auth/verify-otp', '/auth/logout'];

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const url = error.config?.url || '';
    if (error.response?.status === 401 && !AUTH_ENDPOINTS.some((p) => url.includes(p))) {
      localStorage.removeItem('auth-storage');
      if (window.location.pathname !== '/login') window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
