import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getHeader, json, methodNotAllowed, type JsonResult, type RequestCtx, type UserRole } from './http';

const loginAttempts = new Map<string, { count: number; blockedUntil: number }>();

function jwtSecret(): string {
  return process.env.JWT_SECRET || '';
}

function maxAttempts(): number {
  return Number(process.env.LOGIN_MAX_ATTEMPTS) || 5;
}

function blockMs(): number {
  return (Number(process.env.LOGIN_BLOCK_MINUTES) || 1) * 60 * 1000;
}

export function signToken(role: UserRole): string {
  return jwt.sign({ role }, jwtSecret(), { expiresIn: '7d' });
}

export function verifyToken(token: string): UserRole | null {
  const secret = jwtSecret();
  if (!secret || !token) return null;
  try {
    const payload = jwt.verify(token, secret) as { role?: string };
    if (payload.role !== 'admin' && payload.role !== 'observer') return null;
    return payload.role;
  } catch {
    return null;
  }
}

export function getBearerToken(ctx: RequestCtx): string {
  const header = getHeader(ctx.headers, 'authorization');
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

export function requireUser(ctx: RequestCtx): { ok: true; role: UserRole } | { ok: false; result: JsonResult } {
  const role = verifyToken(getBearerToken(ctx));
  if (!role) return { ok: false, result: json(401, { error: 'Unauthorized' }) };
  return { ok: true, role };
}

export function requireAdmin(ctx: RequestCtx): { ok: true; role: UserRole } | { ok: false; result: JsonResult } {
  const user = requireUser(ctx);
  if (user.ok === false) return user;
  if (user.role !== 'admin') return { ok: false, result: json(403, { error: 'Forbidden' }) };
  return user;
}

function remainingBlockSeconds(blockedUntil: number): number {
  return Math.max(1, Math.ceil((blockedUntil - Date.now()) / 1000));
}

function getLoginAttempt(ip: string): { count: number; blockedUntil: number } {
  const state = loginAttempts.get(ip);
  if (!state) return { count: 0, blockedUntil: 0 };
  if (state.blockedUntil > 0 && state.blockedUntil <= Date.now()) {
    loginAttempts.delete(ip);
    return { count: 0, blockedUntil: 0 };
  }
  return state;
}

function blockedResult(blockedUntil: number): JsonResult {
  const retryAfter = remainingBlockSeconds(blockedUntil);
  return json(
    429,
    {
      ok: false,
      error: `Слишком много попыток. Попробуйте через ${retryAfter} секунд.`,
      retryAfter,
    },
    { 'Retry-After': String(retryAfter) }
  );
}

export async function handleLogin(ctx: RequestCtx): Promise<JsonResult> {
  if (ctx.method !== 'POST') return methodNotAllowed(['POST']);

  const attempt = getLoginAttempt(ctx.ip);
  if (attempt.blockedUntil > Date.now()) {
    return blockedResult(attempt.blockedUntil);
  }

  const password = String((ctx.body as { password?: string } | null)?.password || '');
  if (!password) {
    return json(400, { ok: false, error: 'Введите пароль' });
  }

  const adminHash = process.env.ADMIN_PASSWORD_HASH || '';
  const observerHash = process.env.OBSERVER_PASSWORD_HASH || '';

  try {
    if (adminHash && (await bcrypt.compare(password, adminHash))) {
      loginAttempts.delete(ctx.ip);
      return json(200, { ok: true, token: signToken('admin'), role: 'admin' });
    }
    if (observerHash && (await bcrypt.compare(password, observerHash))) {
      loginAttempts.delete(ctx.ip);
      return json(200, { ok: true, token: signToken('observer'), role: 'observer' });
    }
  } catch (err: any) {
    console.error('Login error:', err);
    return json(500, { ok: false, error: 'Ошибка авторизации' });
  }

  const nextCount = attempt.count + 1;
  if (nextCount >= maxAttempts()) {
    const blockedUntil = Date.now() + blockMs();
    loginAttempts.set(ctx.ip, { count: nextCount, blockedUntil });
    return blockedResult(blockedUntil);
  }

  loginAttempts.set(ctx.ip, { count: nextCount, blockedUntil: 0 });
  return json(401, {
    ok: false,
    error: `Неверный пароль. Осталось попыток: ${maxAttempts() - nextCount}`,
  });
}

export function handleMe(ctx: RequestCtx): JsonResult {
  if (ctx.method !== 'GET') return methodNotAllowed(['GET']);
  const user = requireUser(ctx);
  if (user.ok === false) return user.result;
  return json(200, { ok: true, role: user.role });
}
