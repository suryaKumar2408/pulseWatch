import axios from 'axios';

/**
 * Pre-configured axios instance.
 *
 * Base URL comes from the VITE_API_URL env var when deployed.
 * In development, the Vite dev server proxies /api → http://localhost:3000
 * so no explicit base URL is needed locally.
 */
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  timeout: 10_000,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

// ── Request interceptor ────────────────────────────────────────────────────
api.interceptors.request.use(
  (config) => {
    // Attach JWT from localStorage if present
    const token = localStorage.getItem('pw_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// ── Response interceptor ───────────────────────────────────────────────────
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // 401 → clear stored credentials and redirect to login
    if (error.response?.status === 401) {
      localStorage.removeItem('pw_token');
      localStorage.removeItem('pw_user');
      delete api.defaults.headers.common['Authorization'];
      // Only redirect if not already on an auth page to avoid infinite loops
      if (!window.location.pathname.startsWith('/login') && !window.location.pathname.startsWith('/register')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);

export default api;
