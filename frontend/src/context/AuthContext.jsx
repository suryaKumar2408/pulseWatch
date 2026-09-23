import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';
import { AuthContext } from './authContext';

export { AuthContext };

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem('pw_user');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const [token, setToken] = useState(() => {
    const stored = localStorage.getItem('pw_token');
    if (stored) {
      api.defaults.headers.common['Authorization'] = `Bearer ${stored}`;
    }
    return stored;
  });
  const [isLoading, setIsLoading] = useState(() => Boolean(localStorage.getItem('pw_token')));

  // Initial session restoration & validation on mount
  useEffect(() => {
    let active = true;

    async function verifySession() {
      const storedToken = localStorage.getItem('pw_token');
      if (!storedToken) {
        if (active) setIsLoading(false);
        return;
      }

      try {
        const { data } = await api.get('/api/v1/auth/me');
        if (active) {
          const verifiedUser = data.data.user;
          setUser(verifiedUser);
          setToken(storedToken);
          localStorage.setItem('pw_user', JSON.stringify(verifiedUser));
          api.defaults.headers.common['Authorization'] = `Bearer ${storedToken}`;
        }
      } catch {
        // Token expired, revoked, or server rejected
        if (active) {
          localStorage.removeItem('pw_token');
          localStorage.removeItem('pw_user');
          delete api.defaults.headers.common['Authorization'];
          setUser(null);
          setToken(null);
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    verifySession();
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (email, password) => {
    try {
      const response = await api.post('/api/v1/auth/login', {
        email: email.trim().toLowerCase(),
        password,
      });

      const { user: loggedInUser, token: authToken } = response.data.data;

      // Update local storage and token headers synchronously
      localStorage.setItem('pw_token', authToken);
      localStorage.setItem('pw_user', JSON.stringify(loggedInUser));
      if (authToken) {
        api.defaults.headers.common['Authorization'] = `Bearer ${authToken}`;
      }

      // Update state synchronously
      setToken(authToken);
      setUser(loggedInUser);
      setIsLoading(false);

      return { success: true, user: loggedInUser };
    } catch (err) {
      const errorMessage =
        err.response?.data?.error?.message ||
        err.response?.data?.message ||
        (err.response?.status === 401
          ? 'Invalid email or password'
          : 'Failed to sign in. Please verify your credentials or network connection.');
      const customError = new Error(errorMessage);
      customError.response = err.response;
      throw customError;
    }
  }, []);

  const register = useCallback(async (email, password) => {
    try {
      const response = await api.post('/api/v1/auth/register', {
        email: email.trim().toLowerCase(),
        password,
      });

      const { user: registeredUser, token: authToken } = response.data.data;

      // Update local storage and token headers synchronously
      localStorage.setItem('pw_token', authToken);
      localStorage.setItem('pw_user', JSON.stringify(registeredUser));
      if (authToken) {
        api.defaults.headers.common['Authorization'] = `Bearer ${authToken}`;
      }

      // Update state synchronously
      setToken(authToken);
      setUser(registeredUser);
      setIsLoading(false);

      return { success: true, user: registeredUser };
    } catch (err) {
      const errorMessage =
        err.response?.data?.error?.message ||
        err.response?.data?.message ||
        (err.response?.status === 409
          ? 'An account with this email address already exists'
          : 'Registration failed. Please check your details and try again.');
      const customError = new Error(errorMessage);
      customError.response = err.response;
      throw customError;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      // Fire-and-forget server logout to invalidate token in blocklist
      await api.post('/api/v1/auth/logout').catch(() => {});
    } finally {
      localStorage.removeItem('pw_token');
      localStorage.removeItem('pw_user');
      delete api.defaults.headers.common['Authorization'];
      setToken(null);
      setUser(null);
      setIsLoading(false);
    }
  }, []);

  const value = {
    user,
    token,
    isAuthenticated: Boolean(token && user),
    isLoading,
    loading: isLoading,
    login,
    register,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
