import { handleLogin } from '../../server/auth';
import { sendJson, toCtx } from '../../server/adapter';

export default async function handler(req: any, res: any) {
  sendJson(res, await handleLogin(toCtx(req)));
}
