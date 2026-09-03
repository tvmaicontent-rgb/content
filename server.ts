import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import * as archiverPkg from 'archiver';
const archiver = ((archiverPkg as any).default || archiverPkg) as any;
import { createServer as createViteServer } from 'vite';
import { parseSheetsData } from './src/services/sheetsParser';

const DATA_DIR = path.join(process.cwd(), 'src/data');

function loadPasswordHash(raw?: string, b64?: string): string {
  const encoded = (b64 || '').trim();
  if (encoded) {
    return Buffer.from(encoded, 'base64').toString('utf8');
  }
  return (raw || '').trim();
}

type UserRole = 'admin' | 'observer';

interface AuthedRequest extends express.Request {
  user?: { role: UserRole };
}

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const JWT_SECRET = process.env.JWT_SECRET || '';
const ADMIN_PASSWORD_HASH = loadPasswordHash(
  process.env.ADMIN_PASSWORD_HASH,
  process.env.ADMIN_PASSWORD_HASH_B64,
);
const OBSERVER_PASSWORD_HASH = loadPasswordHash(
  process.env.OBSERVER_PASSWORD_HASH,
  process.env.OBSERVER_PASSWORD_HASH_B64,
);
const WEBHOOK_URL = (process.env.GOOGLE_SHEETS_WEBHOOK_URL || '').trim();
const LOGIN_MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS) || 5;
const LOGIN_BLOCK_MS = (Number(process.env.LOGIN_BLOCK_MINUTES) || 1) * 60 * 1000;

const loginAttempts = new Map<string, { count: number; blockedUntil: number }>();

app.set('trust proxy', 1);

if (!JWT_SECRET) {
  console.warn('JWT_SECRET is not set. Authentication will reject all tokens.');
}

app.use(express.json({ limit: '50mb' }));

function csvExportUrl(spreadsheetId: string, gid: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
}

function envOr(name: string, fallback: string): string {
  const value = process.env[name];
  return value !== undefined && value !== '' ? value : fallback;
}

const SPREADSHEET_ID = envOr('SPREADSHEET_ID', '');
const GROUPS_SPREADSHEET_ID = envOr('GROUPS_SPREADSHEET_ID', '');

function signToken(role: UserRole): string {
  return jwt.sign({ role }, JWT_SECRET, { expiresIn: '7d' });
}

function authMiddleware(req: AuthedRequest, res: express.Response, next: express.NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!JWT_SECRET || !token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { role?: string };
    if (payload.role !== 'admin' && payload.role !== 'observer') {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = { role: payload.role };
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

function requireAdmin(req: AuthedRequest, res: express.Response, next: express.NextFunction) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
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

// In-memory cache
let cachedData: any = null;
let lastSyncTime = '';

async function fetchFromSheets() {
  if (!SPREADSHEET_ID || !GROUPS_SPREADSHEET_ID) {
    throw new Error('SPREADSHEET_ID or GROUPS_SPREADSHEET_ID is not configured');
  }

  const cacheBust = `_t=${Date.now()}`;
  const contentUrl = `${csvExportUrl(SPREADSHEET_ID, envOr('GID_CONTENT', '59376984'))}&${cacheBust}`;
  const kamUrl = `${csvExportUrl(SPREADSHEET_ID, envOr('GID_KAM', '183144046'))}&${cacheBust}`;
  const tasksUrl = `${csvExportUrl(SPREADSHEET_ID, envOr('GID_TASKS', '1482592400'))}&${cacheBust}`;
  const newProductsUrl = `${csvExportUrl(SPREADSHEET_ID, envOr('GID_NEW_PRODUCTS', '413377182'))}&${cacheBust}`;
  const contactsUrl = `${csvExportUrl(SPREADSHEET_ID, envOr('GID_CONTACTS', '1825148105'))}&${cacheBust}`;
  const managersUrl = `${csvExportUrl(SPREADSHEET_ID, envOr('GID_MANAGERS', '1474629181'))}&${cacheBust}`;
  const workingKamUrl = `${csvExportUrl(SPREADSHEET_ID, envOr('GID_WORKING_KAM', '1367779997'))}&${cacheBust}`;
  const workingContentUrl = `${csvExportUrl(SPREADSHEET_ID, envOr('GID_WORKING_CONTENT', '33531424'))}&${cacheBust}`;
  const groupsUrl = `${csvExportUrl(GROUPS_SPREADSHEET_ID, envOr('GID_GROUPS', '0'))}&${cacheBust}`;
  const orderUrl = `${csvExportUrl(GROUPS_SPREADSHEET_ID, envOr('GID_SITE_ORDER', '442661295'))}&${cacheBust}`;

  const [
    content,
    kam,
    tasks,
    newProducts,
    contacts,
    managers,
    _workingKam,
    _workingContent,
    groups,
    siteOrder,
  ] = await Promise.all([
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
  lastSyncTime = `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

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
  const pFile = path.join(DATA_DIR, 'initialProducts.json');
  const tFile = path.join(DATA_DIR, 'initialTasks.json');
  const gFile = path.join(DATA_DIR, 'initialGroups.json');
  if (!fs.existsSync(pFile)) return null;
  const products = JSON.parse(fs.readFileSync(pFile, 'utf8'));
  const tasks = fs.existsSync(tFile) ? JSON.parse(fs.readFileSync(tFile, 'utf8')) : [];
  const groups = fs.existsSync(gFile) ? JSON.parse(fs.readFileSync(gFile, 'utf8')) : [];
  return { products, tasks, groups };
}

function getClientIp(req: express.Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
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

function rejectBlocked(res: express.Response, blockedUntil: number) {
  const retryAfter = remainingBlockSeconds(blockedUntil);
  res.setHeader('Retry-After', String(retryAfter));
  return res.status(429).json({
    ok: false,
    error: `Слишком много попыток. Попробуйте через ${retryAfter} секунд.`,
    retryAfter,
  });
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/auth/login', async (req, res) => {
  const ip = getClientIp(req);
  const attempt = getLoginAttempt(ip);

  if (attempt.blockedUntil > Date.now()) {
    return rejectBlocked(res, attempt.blockedUntil);
  }

  const password = String(req.body?.password || '');
  if (!password) {
    return res.status(400).json({ ok: false, error: 'Введите пароль' });
  }

  try {
    if (ADMIN_PASSWORD_HASH && (await bcrypt.compare(password, ADMIN_PASSWORD_HASH))) {
      loginAttempts.delete(ip);
      return res.json({ ok: true, token: signToken('admin'), role: 'admin' });
    }
    if (OBSERVER_PASSWORD_HASH && (await bcrypt.compare(password, OBSERVER_PASSWORD_HASH))) {
      loginAttempts.delete(ip);
      return res.json({ ok: true, token: signToken('observer'), role: 'observer' });
    }
  } catch (err: any) {
    console.error('Login error:', err);
    return res.status(500).json({ ok: false, error: 'Ошибка авторизации' });
  }

  const nextCount = attempt.count + 1;
  if (nextCount >= LOGIN_MAX_ATTEMPTS) {
    const blockedUntil = Date.now() + LOGIN_BLOCK_MS;
    loginAttempts.set(ip, { count: nextCount, blockedUntil });
    return rejectBlocked(res, blockedUntil);
  }

  loginAttempts.set(ip, { count: nextCount, blockedUntil: 0 });
  const remaining = LOGIN_MAX_ATTEMPTS - nextCount;
  return res.status(401).json({
    ok: false,
    error: `Неверный пароль. Осталось попыток: ${remaining}`,
  });
});

app.use('/api', (req, res, next) => {
  if (req.path === '/auth/login' || req.path === '/health') {
    return next();
  }
  return authMiddleware(req as AuthedRequest, res, next);
});

app.get('/api/auth/me', (req: AuthedRequest, res) => {
  res.json({ ok: true, role: req.user?.role });
});

app.get('/api/sheets/status', (_req, res) => {
  res.json({ webhookConfigured: Boolean(WEBHOOK_URL) });
});

app.get('/api/sync-sheets', async (_req, res) => {
  try {
    const data = await fetchFromSheets();
    res.json({ success: true, ...data });
  } catch (err: any) {
    console.error('API sync error:', err);
    if (cachedData) {
      return res.json({ success: true, ...cachedData, fromCache: true });
    }
    try {
      const snapshot = readLocalSnapshot();
      if (snapshot) {
        const products = snapshot.products || [];
        const contentProducts = products.filter((p: any) => p.department === 'Отдел контента');
        const kamProducts = products.filter((p: any) => p.department === 'Коммерческий отдел');
        return res.json({
          success: true,
          products,
          contentProducts,
          kamProducts,
          tasks: snapshot.tasks,
          groups: snapshot.groups,
          groupOrders: [],
          newProducts: [],
          contacts: [],
          lastSyncTime: 'Из локального снапшота',
          fromSnapshot: true,
        });
      }
    } catch {
      // ignore
    }
    res.status(500).json({ success: false, error: err.message || 'Ошибка синхронизации' });
  }
});

app.post('/api/sheets/webhook-proxy', requireAdmin, async (req: AuthedRequest, res) => {
  try {
    const url = WEBHOOK_URL;
    if (!url) {
      return res.status(503).json({ success: false, error: 'Webhook не настроен на сервере' });
    }

    const { payload } = req.body || {};
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
        return res.status(403).json({
          success: false,
          error: 'Google Apps Script вернул страницу авторизации. Проверьте развертывание скрипта: в поле «У кого есть доступ» обязательно выберите «Все» (Anyone).',
          isAuthHtml: true,
        });
      }
      data = { raw: text, success: false, error: text.slice(0, 200) };
    }

    if (data && data.success === false) {
      return res.status(400).json(data);
    }

    res.json({ success: true, ...data });
  } catch (err: any) {
    console.error('Webhook proxy error:', err);
    res.status(500).json({ success: false, error: err.message || 'Webhook request failed' });
  }
});

app.get('/api/data-snapshot', (_req, res) => {
  if (cachedData) {
    return res.json(cachedData);
  }
  try {
    const snapshot = readLocalSnapshot();
    if (snapshot) {
      return res.json({
        ...snapshot,
        lastSyncTime: 'Снапшот Google Sheets',
      });
    }
  } catch {
    // fallback
  }
  res.json({ products: [], tasks: [], groups: [] });
});

app.get('/api/download-project-zip', requireAdmin, (req, res) => {
  try {
    const rootDir = process.cwd();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="content-ops-project.zip"');

    const archive = archiver('zip', {
      zlib: { level: 9 },
    });

    archive.on('error', (err: any) => {
      console.error('Archiver error:', err);
      res.status(500).send({ error: err.message });
    });

    archive.pipe(res);

    archive.glob('**/*', {
      cwd: rootDir,
      ignore: [
        'node_modules/**',
        'dist/**',
        '.git/**',
        '*.log',
        '.vite/**',
        '.env',
        '.env.*',
      ],
      dot: true,
    });

    archive.finalize();
  } catch (err: any) {
    console.error('Zip export error:', err);
    res.status(500).json({ error: 'Failed to create zip' });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
