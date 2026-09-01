import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'http';
import { getClientIp, type JsonResult, type RequestCtx } from './http';

type NodeReq = IncomingMessage & { body?: unknown; ip?: string };
type NodeRes = ServerResponse & {
  status: (code: number) => NodeRes;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

export function toCtx(req: NodeReq): RequestCtx {
  const headers = (req.headers || {}) as IncomingHttpHeaders;
  return {
    method: req.method || 'GET',
    headers: headers as RequestCtx['headers'],
    body: req.body,
    ip: req.ip || getClientIp(headers as RequestCtx['headers'], req.socket?.remoteAddress || 'unknown'),
  };
}

export function sendJson(res: NodeRes, result: JsonResult): void {
  if (result.headers) {
    for (const [key, value] of Object.entries(result.headers)) {
      res.setHeader(key, value);
    }
  }
  res.status(result.status).json(result.body);
}
