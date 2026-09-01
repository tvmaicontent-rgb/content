import { handleMe } from '../../server/auth';
import { sendJson, toCtx } from '../../server/adapter';

export default function handler(req: any, res: any) {
  sendJson(res, handleMe(toCtx(req)));
}
