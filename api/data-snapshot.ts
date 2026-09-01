import { handleDataSnapshot } from '../server/sheets';
import { sendJson, toCtx } from '../server/adapter';

export default function handler(req: any, res: any) {
  sendJson(res, handleDataSnapshot(toCtx(req)));
}
