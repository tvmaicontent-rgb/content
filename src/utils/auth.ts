export type UserRole = 'admin' | 'observer';

const TOKEN_KEY = 'content_ops_token';
const ROLE_KEY = 'content_ops_role';

export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getAuthRole(): UserRole | null {
  if (typeof window === 'undefined') return null;
  try {
    const role = localStorage.getItem(ROLE_KEY);
    if (role === 'admin' || role === 'observer') return role;
    return null;
  } catch {
    return null;
  }
}

export function setAuthSession(token: string, role: UserRole): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(ROLE_KEY, role);
}

export function clearAuthSession(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ROLE_KEY);
  } catch {
    // ignore
  }
}

export function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function handleUnauthorized(): void {
  clearAuthSession();
  if (typeof window !== 'undefined') {
    window.location.reload();
  }
}

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getAuthToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401 && token) {
    handleUnauthorized();
  }
  return res;
}
