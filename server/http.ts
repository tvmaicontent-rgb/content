export type UserRole = 'admin' | 'observer';

export interface RequestCtx {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  ip: string;
}

export interface JsonResult {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export function getHeader(headers: RequestCtx['headers'], name: string): string {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

export function getClientIp(headers: RequestCtx['headers'], fallback = 'unknown'): string {
  const forwarded = getHeader(headers, 'x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return fallback;
}

export function handleHealth(ctx: RequestCtx): JsonResult {
  if (ctx.method !== 'GET') return methodNotAllowed(['GET']);
  return json(200, { status: 'ok', timestamp: new Date().toISOString() });
}

export function json(status: number, body: unknown, headers?: Record<string, string>): JsonResult {
  return { status, body, headers };
}

export function methodNotAllowed(allowed: string[]): JsonResult {
  return json(405, { error: 'Method Not Allowed' }, { Allow: allowed.join(', ') });
}
