import { handleWebhookProxy } from '../../server/sheets';
import { sendJson, toCtx } from '../../server/adapter';

export const config = { maxDuration: 60 };

export default async function handler(req: any, res: any) {
  sendJson(res, await handleWebhookProxy(toCtx(req)));
}
