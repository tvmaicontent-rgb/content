import { handleHealth } from '../server/http';
import { sendJson, toCtx } from '../server/adapter';

export default function handler(req: any, res: any) {
  sendJson(res, handleHealth(toCtx(req)));
}
