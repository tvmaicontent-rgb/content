import path from 'path';
import fs from 'fs';
import { parseSheetsData } from '../src/services/sheetsParser';
import { json, methodNotAllowed, type JsonResult, type RequestCtx } from './http';
import { requireAdmin, requireUser } from './auth';

function envOr(name: string, fallback: string): string {
  const value = process.env[name];
  return value !== undefined && value !== '' ? value : fallback;
}

function webhookUrl(): string {
  return (process.env.GOOGLE_SHEETS_WEBHOOK_URL || '').trim();
}

function csvExportUrl(spreadsheetId: string, gid: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
}

async function fetchCsv(url: string, required = true): Promise<string> {
  const res = await fetch(url, {
    cache: 'no-store',
    headers: {
      Pragma: 'no-cache',
      'Cache-Control': 'no-cache',
    },
  });
  if (!res.ok) {
    if (!required) return '';
    throw new Error(`HTTP ${res.status} fetching sheet`);
  }
  return res.text();
}

let cachedData: any = null;

export async function fetchFromSheets() {
  const spreadsheetId = envOr('SPREADSHEET_ID', '');
  const groupsSpreadsheetId = envOr('GROUPS_SPREADSHEET_ID', '');
  if (!spreadsheetId || !groupsSpreadsheetId) {
    throw new Error('SPREADSHEET_ID or GROUPS_SPREADSHEET_ID is not configured');
  }

  const cacheBust = `_t=${Date.now()}`;
  const contentUrl = `${csvExportUrl(spreadsheetId, envOr('GID_CONTENT', '59376984'))}&${cacheBust}`;
  const kamUrl = `${csvExportUrl(spreadsheetId, envOr('GID_KAM', '183144046'))}&${cacheBust}`;
  const tasksUrl = `${csvExportUrl(spreadsheetId, envOr('GID_TASKS', '1482592400'))}&${cacheBust}`;
  const newProductsUrl = `${csvExportUrl(spreadsheetId, envOr('GID_NEW_PRODUCTS', '413377182'))}&${cacheBust}`;
  const contactsUrl = `${csvExportUrl(spreadsheetId, envOr('GID_CONTACTS', '1825148105'))}&${cacheBust}`;
  const managersUrl = `${csvExportUrl(spreadsheetId, envOr('GID_MANAGERS', '1474629181'))}&${cacheBust}`;
  const workingKamUrl = `${csvExportUrl(spreadsheetId, envOr('GID_WORKING_KAM', '1367779997'))}&${cacheBust}`;
  const workingContentUrl = `${csvExportUrl(spreadsheetId, envOr('GID_WORKING_CONTENT', '33531424'))}&${cacheBust}`;
  const groupsUrl = `${csvExportUrl(groupsSpreadsheetId, envOr('GID_GROUPS', '0'))}&${cacheBust}`;
  const orderUrl = `${csvExportUrl(groupsSpreadsheetId, envOr('GID_SITE_ORDER', '442661295'))}&${cacheBust}`;

  const [content, kam, tasks, newProducts, contacts, managers, _workingKam, _workingContent, groups, siteOrder] =
    await Promise.all([
      fetchCsv(contentUrl),
      fetchCsv(kamUrl),
      fetchCsv(tasksUrl),
      fetchCsv(newProductsUrl),
      fetchCsv(contactsUrl, false),
      fetchCsv(managersUrl, false),
      fetchCsv(workingKamUrl, false),
      fetchCsv(workingContentUrl, false),
      fetchCsv(groupsUrl, false),
      fetchCsv(orderUrl, false),
    ]);

  const parsed = parseSheetsData({
    content,
    kam,
    tasks,
    newProducts,
    contacts,
    managers,
    groups,
    siteOrder,
  });

  const now = new Date();
  const lastSyncTime = `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  cachedData = {
    ...parsed,
    lastSyncTime,
    counts: {
      content: parsed.contentProducts.length,
      kam: parsed.kamProducts.length,
      tasks: parsed.tasks.length,
      groups: parsed.groups.length,
      newProducts: parsed.newProducts.length,
      contacts: parsed.contacts.length,
    },
  };

  return cachedData;
}

function readLocalSnapshot() {
  const pFile = path.join(process.cwd(), 'src/data/initialProducts.json');
  const tFile = path.join(process.cwd(), 'src/data/initialTasks.json');
  const gFile = path.join(process.cwd(), 'src/data/initialGroups.json');
  if (!fs.existsSync(pFile)) return null;
  const products = JSON.parse(fs.readFileSync(pFile, 'utf8'));
  const tasks = fs.existsSync(tFile) ? JSON.parse(fs.readFileSync(tFile, 'utf8')) : [];
  const groups = fs.existsSync(gFile) ? JSON.parse(fs.readFileSync(gFile, 'utf8')) : [];
  return { products, tasks, groups };
}

function snapshotPayload(snapshot: { products: any[]; tasks: any[]; groups: any[] }, lastSyncTime: string) {
  const products = snapshot.products || [];
  const contentProducts = products.filter((p: any) => p.department === 'Отдел контента');
  const kamProducts = products.filter((p: any) => p.department === 'Коммерческий отдел');
  return {
    success: true,
    products,
    contentProducts,
    kamProducts,
    tasks: snapshot.tasks,
    groups: snapshot.groups,
    groupOrders: [],
    newProducts: [],
    contacts: [],
    lastSyncTime,
    fromSnapshot: true,
  };
}

export function handleSheetsStatus(ctx: RequestCtx): JsonResult {
  if (ctx.method !== 'GET') return methodNotAllowed(['GET']);
  const user = requireUser(ctx);
  if (user.ok === false) return user.result;
  return json(200, { webhookConfigured: Boolean(webhookUrl()) });
}

export async function handleSyncSheets(ctx: RequestCtx): Promise<JsonResult> {
  if (ctx.method !== 'GET') return methodNotAllowed(['GET']);
  const user = requireUser(ctx);
  if (user.ok === false) return user.result;

  try {
    const data = await fetchFromSheets();
    return json(200, { success: true, ...data });
  } catch (err: any) {
    console.error('API sync error:', err);
    if (cachedData) {
      return json(200, { success: true, ...cachedData, fromCache: true });
    }
    try {
      const snapshot = readLocalSnapshot();
      if (snapshot) {
        return json(200, snapshotPayload(snapshot, 'Из локального снапшота'));
      }
    } catch {
      // ignore
    }
    return json(500, { success: false, error: err.message || 'Ошибка синхронизации' });
  }
}

export function handleDataSnapshot(ctx: RequestCtx): JsonResult {
  if (ctx.method !== 'GET') return methodNotAllowed(['GET']);
  const user = requireUser(ctx);
  if (user.ok === false) return user.result;

  if (cachedData) {
    return json(200, cachedData);
  }
  try {
    const snapshot = readLocalSnapshot();
    if (snapshot) {
      return json(200, {
        ...snapshot,
        lastSyncTime: 'Снапшот Google Sheets',
      });
    }
  } catch {
    // fallback
  }
  return json(200, { products: [], tasks: [], groups: [] });
}

export async function handleWebhookProxy(ctx: RequestCtx): Promise<JsonResult> {
  if (ctx.method !== 'POST') return methodNotAllowed(['POST']);
  const user = requireAdmin(ctx);
  if (user.ok === false) return user.result;

  const url = webhookUrl();
  if (!url) {
    return json(503, { success: false, error: 'Webhook не настроен на сервере' });
  }

  try {
    const payload = (ctx.body as { payload?: unknown } | null)?.payload;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
      redirect: 'follow',
    });

    const text = await response.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      if (text.includes('<!DOCTYPE') || text.includes('<html') || text.includes('Google Accounts')) {
        return json(403, {
          success: false,
          error:
            'Google Apps Script вернул страницу авторизации. Проверьте развертывание скрипта: в поле «У кого есть доступ» обязательно выберите «Все» (Anyone).',
          isAuthHtml: true,
        });
      }
      data = { raw: text, success: false, error: text.slice(0, 200) };
    }

    if (data && data.success === false) {
      return json(400, data);
    }

    return json(200, { success: true, ...data });
  } catch (err: any) {
    console.error('Webhook proxy error:', err);
    return json(500, { success: false, error: err.message || 'Webhook request failed' });
  }
}
