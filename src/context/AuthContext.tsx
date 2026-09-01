import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  UserRole,
  clearAuthSession,
  getAuthRole,
  getAuthToken,
  setAuthSession,
} from '../utils/auth';

interface AuthState {
  role: UserRole | null;
  token: string | null;
  ready: boolean;
  login: (password: string) => Promise<{ ok: boolean; error?: string; retryAfter?: number }>;
  logout: () => void;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const storedToken = getAuthToken();
    const storedRole = getAuthRole();
    if (!storedToken) {
      setReady(true);
      return;
    }

    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${storedToken}` },
    })
      .then(async res => {
        if (!res.ok) throw new Error('unauthorized');
        const data = await res.json();
        const nextRole: UserRole = data.role === 'admin' ? 'admin' : 'observer';
        setToken(storedToken);
        setRole(nextRole);
        setAuthSession(storedToken, nextRole);
      })
      .catch(() => {
        clearAuthSession();
        setToken(null);
        setRole(null);
      })
      .finally(() => setReady(true));
  }, []);

  const login = useCallback(async (password: string) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || !data.token) {
        return {
          ok: false,
          error: data?.error || 'Неверный пароль',
          retryAfter: typeof data?.retryAfter === 'number' ? data.retryAfter : undefined,
        };
      }
      const nextRole: UserRole = data.role === 'admin' ? 'admin' : 'observer';
      setAuthSession(data.token, nextRole);
      setToken(data.token);
      setRole(nextRole);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Не удалось связаться с сервером' };
    }
  }, []);

  const logout = useCallback(() => {
    clearAuthSession();
    setToken(null);
    setRole(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      role,
      token,
      ready,
      login,
      logout,
      isAdmin: role === 'admin',
    }),
    [role, token, ready, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
