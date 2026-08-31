import { AuthUser, AuthSession, ApiTokenItem, UserRole } from '../types/auth';

const STORAGE_KEY = 'content_ops_auth_session';

class AuthService {
  private session: AuthSession | null = null;
  private listeners: Array<(session: AuthSession | null) => void> = [];
  private isCheckingAuth = false;

  constructor() {
    this.initFromStorage();
  }

  private initFromStorage(): void {
    if (typeof window === 'undefined') return;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: AuthSession = JSON.parse(saved);
        if (parsed.expiresAt && parsed.expiresAt > Date.now() && parsed.token) {
          this.session = parsed;
        } else {
          localStorage.removeItem(STORAGE_KEY);
          this.session = null;
        }
      }
    } catch (e) {
      console.warn('Failed to load auth session:', e);
      this.session = null;
    }
  }

  /**
   * Validates saved token with the backend. If invalid or missing, clears session and returns null.
   */
  async checkAuth(): Promise<AuthUser | null> {
    if (!this.session || !this.session.token) {
      this.setSession(null);
      return null;
    }

    if (this.session.expiresAt && this.session.expiresAt <= Date.now()) {
      this.setSession(null);
      return null;
    }

    try {
      this.isCheckingAuth = true;
      const res = await fetch('/api/auth/me', {
        headers: {
          Authorization: `Bearer ${this.session.token}`,
          Accept: 'application/json',
        },
      });

      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const data = await res.json();
        if (data && data.success && data.user) {
          // Update user info
          this.session.user = data.user;
          this.saveToStorage();
          this.notify();
          return data.user;
        }
      }

      // If token rejected by server or response not JSON
      this.setSession(null);
      return null;
    } catch (err) {
      console.warn('Failed to verify token with server:', err);
      // If network offline but token exists locally and not expired, keep session
      if (this.session && this.session.expiresAt > Date.now()) {
        return this.session.user;
      }
      this.setSession(null);
      return null;
    } finally {
      this.isCheckingAuth = false;
    }
  }

  getSession(): AuthSession | null {
    return this.session;
  }

  getUser(): AuthUser | null {
    return this.session?.user || null;
  }

  getToken(): string | null {
    return this.session?.token || null;
  }

  isAuthenticated(): boolean {
    return Boolean(this.session && this.session.token && this.session.expiresAt > Date.now());
  }

  isAdmin(): boolean {
    return this.session?.user?.role === 'admin';
  }

  getRole(): UserRole {
    return this.session?.user?.role || 'guest';
  }

  getAuthHeader(): Record<string, string> {
    const token = this.getToken();
    if (!token) return {};
    return {
      Authorization: `Bearer ${token}`,
    };
  }

  private saveToStorage(): void {
    if (typeof window !== 'undefined') {
      try {
        if (this.session) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(this.session));
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch (e) {
        console.warn('Failed to save auth session:', e);
      }
    }
  }

  setSession(session: AuthSession | null): void {
    this.session = session;
    this.saveToStorage();
    this.notify();
  }

  async login(username: string, password?: string): Promise<{ success: boolean; user?: AuthUser; error?: string }> {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          username: (username || '').trim(),
          password: (password || '').trim(),
        }),
      });

      const contentType = res.headers.get('content-type') || '';
      let data: any = null;

      if (contentType.includes('application/json')) {
        data = await res.json();
      } else {
        const rawText = await res.text();
        console.warn('Server responded with non-JSON response:', rawText);
        try {
          data = JSON.parse(rawText);
        } catch {
          return {
            success: false,
            error: res.status === 404
              ? 'Сервер авторизации не найден (/api/auth/login)'
              : `Ошибка сервера (код ${res.status}): ${rawText.substring(0, 100)}`,
          };
        }
      }

      if (res.ok && data?.success && data?.token) {
        const newSession: AuthSession = {
          token: data.token,
          user: data.user,
          expiresAt: data.expiresAt || (Date.now() + 7 * 24 * 3600 * 1000),
        };
        this.setSession(newSession);
        return { success: true, user: data.user };
      }

      return { success: false, error: data?.error || 'Неверный логин или пароль' };
    } catch (err: any) {
      return { success: false, error: err.message || 'Ошибка соединения с сервером' };
    }
  }

  async loginWithToken(token: string): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await fetch('/api/auth/me', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token.trim()}`,
          Accept: 'application/json',
        },
      });

      const contentType = res.headers.get('content-type') || '';
      let data: any = null;

      if (contentType.includes('application/json')) {
        data = await res.json();
      } else {
        const rawText = await res.text();
        try {
          data = JSON.parse(rawText);
        } catch {
          return { success: false, error: 'Недействительный ответ сервера' };
        }
      }

      if (res.ok && data?.success && data?.user) {
        this.setSession({
          token: token.trim(),
          user: data.user,
          expiresAt: data.expiresAt || (Date.now() + 7 * 24 * 3600 * 1000),
        });
        return { success: true };
      }
      return { success: false, error: data?.error || 'Недействительный Bearer токен' };
    } catch (err: any) {
      return { success: false, error: err.message || 'Ошибка проверки токена' };
    }
  }

  async logout(): Promise<void> {
    const token = this.getToken();
    if (token) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // ignore
      }
    }
    this.setSession(null);
  }

  async fetchWithAuth(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers || {});
    const token = this.getToken();
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const response = await fetch(input, {
      ...init,
      headers,
    });

    // If 401 Unauthorized, token has expired or is invalid
    if (response.status === 401) {
      console.warn('Bearer token unauthorized (401). Logging out...');
      this.setSession(null);
    }

    return response;
  }

  async getApiTokens(): Promise<ApiTokenItem[]> {
    try {
      const res = await this.fetchWithAuth('/api/auth/tokens');
      const data = await res.json();
      if (data && data.success && Array.isArray(data.tokens)) {
        return data.tokens;
      }
      return [];
    } catch {
      return [];
    }
  }

  async createApiToken(name: string, role: UserRole = 'admin', expiresInDays: number = 30): Promise<{ success: boolean; token?: string; item?: ApiTokenItem; error?: string }> {
    try {
      const res = await this.fetchWithAuth('/api/auth/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, role, expiresInDays }),
      });
      const data = await res.json();
      if (data && data.success) {
        return { success: true, token: data.token, item: data.item };
      }
      return { success: false, error: data.error || 'Не удалось создать токен' };
    } catch (e: any) {
      return { success: false, error: e.message || 'Ошибка сети' };
    }
  }

  async revokeApiToken(tokenId: string): Promise<boolean> {
    try {
      const res = await this.fetchWithAuth(`/api/auth/tokens/${tokenId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      return Boolean(data && data.success);
    } catch {
      return false;
    }
  }

  subscribe(listener: (session: AuthSession | null) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify(): void {
    this.listeners.forEach(l => l(this.session));
  }
}

export const authService = new AuthService();

