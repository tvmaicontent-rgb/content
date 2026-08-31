import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import * as archiverPkg from 'archiver';
const archiver = ((archiverPkg as any).default || archiverPkg) as any;
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Secret for signing Bearer tokens
const JWT_SECRET = process.env.JWT_SECRET || 'content-ops-portal-secret-token-key-2026';

// Server-side Google Sheets Configuration
const DEFAULT_SPREADSHEET_ID = '1vCZQgzBPv8uahr8ckRI1f-TA_QS6Afz2B9NP_ZMj6ek';
const GROUPS_SPREADSHEET_ID = '1LABW3U4TdX6cDjps_g_mBBsWRW8_Xx7W8LqBZB4CO2g';

const GIDS = {
  CONTENT: '59376984',
  KAM: '183144046',
  TASKS: '1482592400',
  NEW_PRODUCTS: '413377182',
  CONTACTS: '1825148105',
  MANAGERS: '1474629181',
  WORKING_KAM: '1367779997',
  WORKING_CONTENT: '33531424',
  GROUPS: '0',
  SITE_ORDER: '442661295',
};

let serverWebhookUrl = (process.env.GOOGLE_SHEETS_WEBHOOK_URL || '').trim();

// Users Database & Roles
interface UserRecord {
  id: string;
  username: string;
  name: string;
  role: 'admin' | 'content' | 'kam' | 'guest';
  department: string;
  passwords: string[];
}

const USERS: UserRecord[] = [
  {
    id: 'user-admin',
    username: 'admin',
    name: 'Разработчик / Администратор',
    role: 'admin',
    department: 'Отдел контента & КАМ',
    passwords: ['OK261283', 'admin', 'admin123', (process.env.ADMIN_PASSWORD || '').trim()].filter(Boolean),
  },
  {
    id: 'user-content',
    username: 'content',
    name: 'Специалист отдела контента',
    role: 'content',
    department: 'Отдел контента',
    passwords: ['content', 'content2026', '123456'],
  },
  {
    id: 'user-kam',
    username: 'kam',
    name: 'Менеджер коммерческого отдела (КАМ)',
    role: 'kam',
    department: 'Коммерческий отдел',
    passwords: ['kam', 'kam2026', '123456'],
  },
  {
    id: 'user-guest',
    username: 'guest',
    name: 'Наблюдатель (Только чтение)',
    role: 'guest',
    department: 'Общий доступ',
    passwords: ['guest', 'guest2026', 'guest123', '12345'],
  },
];

// Persistent API Tokens Store
interface StoredApiToken {
  id: string;
  name: string;
  token: string;
  userId: string;
  role: 'admin' | 'content' | 'kam' | 'guest';
  createdAt: string;
  expiresAt: string;
  createdBy: string;
}

const apiTokensStore = new Map<string, StoredApiToken>();

// Initialize a master default API token for automation / integrations
const masterToken = signBearerToken({
  userId: 'user-admin',
  username: 'admin',
  role: 'admin',
  department: 'Отдел контента & КАМ',
  tokenId: 'master-api-token',
  expiresInDays: 365,
});

apiTokensStore.set('master-api-token', {
  id: 'master-api-token',
  name: 'Master System Bearer Token',
  token: masterToken,
  userId: 'user-admin',
  role: 'admin',
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
  createdBy: 'System',
});

// --- TOKEN HELPERS ---
function signBearerToken(payload: {
  userId: string;
  username: string;
  role: string;
  department: string;
  tokenId?: string;
  expiresInDays?: number;
}): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const exp = Math.floor(Date.now() / 1000) + (payload.expiresInDays || 7) * 24 * 3600;
  const body = {
    ...payload,
    exp,
    iat: Math.floor(Date.now() / 1000),
    jti: payload.tokenId || `tok-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
  };

  const b64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const b64Body = Buffer.from(JSON.stringify(body)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${b64Header}.${b64Body}`)
    .digest('base64url');

  return `${b64Header}.${b64Body}.${signature}`;
}

function verifyBearerToken(tokenString: string): any | null {
  if (!tokenString || typeof tokenString !== 'string') return null;
  const parts = tokenString.trim().split('.');
  if (parts.length !== 3) return null;

  const [b64Header, b64Body, signature] = parts;
  const expectedSig = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${b64Header}.${b64Body}`)
    .digest('base64url');

  if (signature !== expectedSig) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(b64Body, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null; // Expired
    }
    return payload;
  } catch {
    return null;
  }
}

// Authentication Middleware
interface AuthenticatedRequest extends Request {
  user?: any;
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  let token = '';
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (req.query.token) {
    token = String(req.query.token).trim();
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Требуется авторизация: заголовок Authorization: Bearer <токен> отсутствует',
    });
  }

  const payload = verifyBearerToken(token);
  if (!payload) {
    return res.status(401).json({
      success: false,
      error: 'Недействительный или истекший Bearer токен',
    });
  }

  req.user = payload;
  next();
}

function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: 'Доступ разрешен только администраторам',
    });
  }
  next();
}

// --- CSV & SHEETS PARSER HELPERS ---
function parseCSV(text: string): string[][] {
  const lines: string[][] = [];
  let row: string[] = [];
  let inQuotes = false;
  let field = '';

  let cleanText = text || '';
  if (cleanText.charCodeAt(0) === 0xfeff) {
    cleanText = cleanText.slice(1);
  }

  for (let i = 0; i < cleanText.length; i++) {
    const c = cleanText[i];
    if (inQuotes) {
      if (c === '"') {
        if (i + 1 < cleanText.length && cleanText[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && i + 1 < cleanText.length && cleanText[i + 1] === '\n') {
          i++;
        }
        row.push(field);
        field = '';
        if (row.some(f => f.trim().length > 0)) {
          lines.push(row);
        }
        row = [];
      } else {
        field += c;
      }
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some(f => f.trim().length > 0)) {
      lines.push(row);
    }
  }

  return lines;
}

function cleanStr(val: string | undefined | null): string {
  if (!val) return '';
  return val.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
}

function extractBatchInfo(header: string) {
  const raw = cleanStr(header);
  let fileName = '';
  const fileMatch =
    raw.match(/\((export_[^)]+\.(?:xlsx|xls))\)/i) ||
    raw.match(/\(([^)]+\.(?:xlsx|xls))\)/i) ||
    raw.match(/\(([^)]+)\)/);
  if (fileMatch) {
    fileName = fileMatch[1].trim();
  }

  const dateMatch = raw.match(/(\d{2}\.\d{2}\.\d{4}(?:\s+\d{2}:\d{2}(?::\d{2})?)?)/);
  const dateStr = dateMatch ? dateMatch[1] : '';

  let displayTitle = raw;
  if (!displayTitle.startsWith('📅') && !displayTitle.startsWith('Партия')) {
    displayTitle = `📅 ${raw}`;
  }

  return {
    title: displayTitle,
    date: dateStr || raw,
    file: fileName || (dateStr ? `Партия от ${dateStr}` : raw),
  };
}

// In-Memory Server Cache for fast responses & resilience
let cachedData: any = null;
let lastSyncTimestamp = '';
let syncStats = {
  totalSyncs: 0,
  lastSuccess: '',
  lastError: '',
};

async function fetchGoogleSheetCsv(docId: string, gid: string): Promise<string> {
  const url = `https://docs.google.com/spreadsheets/d/${docId}/export?format=csv&gid=${gid}&_t=${Date.now()}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Pragma': 'no-cache',
      'Cache-Control': 'no-cache',
    },
  });
  if (!res.ok) {
    throw new Error(`Google Sheets HTTP ${res.status} for gid ${gid}`);
  }
  return res.text();
}

async function performCompleteSheetsSync() {
  const [
    contentCsv,
    kamCsv,
    tasksCsv,
    newProductsCsv,
    contactsCsv,
    managersCsv,
    workingKamCsv,
    workingContentCsv,
    groupsCsv,
    orderCsv,
  ] = await Promise.all([
    fetchGoogleSheetCsv(DEFAULT_SPREADSHEET_ID, GIDS.CONTENT),
    fetchGoogleSheetCsv(DEFAULT_SPREADSHEET_ID, GIDS.KAM),
    fetchGoogleSheetCsv(DEFAULT_SPREADSHEET_ID, GIDS.TASKS),
    fetchGoogleSheetCsv(DEFAULT_SPREADSHEET_ID, GIDS.NEW_PRODUCTS),
    fetchGoogleSheetCsv(DEFAULT_SPREADSHEET_ID, GIDS.CONTACTS).catch(() => ''),
    fetchGoogleSheetCsv(DEFAULT_SPREADSHEET_ID, GIDS.MANAGERS).catch(() => ''),
    fetchGoogleSheetCsv(DEFAULT_SPREADSHEET_ID, GIDS.WORKING_KAM).catch(() => ''),
    fetchGoogleSheetCsv(DEFAULT_SPREADSHEET_ID, GIDS.WORKING_CONTENT).catch(() => ''),
    fetchGoogleSheetCsv(GROUPS_SPREADSHEET_ID, GIDS.GROUPS).catch(() => ''),
    fetchGoogleSheetCsv(GROUPS_SPREADSHEET_ID, GIDS.SITE_ORDER).catch(() => ''),
  ]);

  const contentRows = parseCSV(contentCsv).slice(1);
  const kamRows = parseCSV(kamCsv).slice(1);
  const taskRows = parseCSV(tasksCsv).slice(1);
  const newProductRawRows = parseCSV(newProductsCsv);
  const contactRawRows = contactsCsv ? parseCSV(contactsCsv).slice(1) : [];
  const managerRawRows = managersCsv ? parseCSV(managersCsv).slice(1) : [];
  const workingKamRawRows = workingKamCsv ? parseCSV(workingKamCsv).slice(1) : [];
  const workingContentRawRows = workingContentCsv ? parseCSV(workingContentCsv).slice(1) : [];

  // Parse Managers
  const managersDict: Record<string, string> = {};
  for (const mr of managerRawRows) {
    const code = cleanStr(mr[0]);
    const name = cleanStr(mr[1]);
    if (code && name) managersDict[code] = name;
  }

  // Parse Content Products
  const contentProducts = contentRows
    .filter(r => r && r.some(cell => cleanStr(cell).length > 0))
    .map((r, idx) => {
      const rawId = cleanStr(r[0]);
      const externalCode = cleanStr(r[1]);
      const group3 = cleanStr(r[2]);
      const title = cleanStr(r[3]);
      const dateUploaded = cleanStr(r[12]) || cleanStr(r[8]) || '';
      const sourceFile = cleanStr(r[11]) || (dateUploaded ? `Партия от ${dateUploaded}` : (rawId ? `Файл ${rawId}` : 'Google Sheets'));

      return {
        id: `cnt-${rawId || idx + 1}`,
        externalCode: externalCode || (rawId ? `SKU-${rawId}` : `SKU-${idx + 1}`),
        group3,
        title: title || group3 || `Товар ${externalCode || rawId || idx + 1}`,
        status: cleanStr(r[4]) || '🆕 Новый',
        pauseReason: cleanStr(r[5]),
        pauseDate: cleanStr(r[6]),
        executor: cleanStr(r[7]),
        dateTaken: cleanStr(r[8]),
        dateCompleted: cleanStr(r[9]),
        dateFinished: cleanStr(r[10]),
        sourceFile,
        dateUploaded: dateUploaded || new Date().toLocaleDateString('ru-RU'),
        department: 'Отдел контента',
      };
    })
    .filter(p => p.externalCode || p.title || p.group3);

  // Parse KAM Products
  const kamProducts = kamRows
    .filter(r => r && r.some(cell => cleanStr(cell).length > 0))
    .map((r, idx) => {
      const rawId = cleanStr(r[0]);
      const externalCode = cleanStr(r[1]);
      const group3 = cleanStr(r[2]);
      const title = cleanStr(r[3]);
      const dateUploaded = cleanStr(r[12]) || cleanStr(r[8]) || '';
      const sourceFile = cleanStr(r[11]) || (dateUploaded ? `Партия от ${dateUploaded}` : (rawId ? `Файл ${rawId}` : 'Google Sheets'));

      return {
        id: `kam-${rawId || idx + 1}`,
        externalCode: externalCode || (rawId ? `SKU-${rawId}` : `SKU-${idx + 1}`),
        group3,
        title: title || group3 || `Товар ${externalCode || rawId || idx + 1}`,
        status: cleanStr(r[4]) || '🆕 Новый',
        pauseReason: cleanStr(r[5]),
        pauseDate: cleanStr(r[6]),
        executor: cleanStr(r[7]),
        dateTaken: cleanStr(r[8]),
        dateCompleted: cleanStr(r[9]),
        dateFinished: cleanStr(r[10]),
        sourceFile,
        dateUploaded: dateUploaded || new Date().toLocaleDateString('ru-RU'),
        department: 'Коммерческий отдел',
      };
    })
    .filter(p => p.externalCode || p.title || p.group3);

  // Parse Tasks
  const tasks = taskRows.map((r, idx) => ({
    id: cleanStr(r[0]) || String(idx + 1),
    title: cleanStr(r[1]),
    description: cleanStr(r[2]),
    executors: cleanStr(r[3]),
    status: cleanStr(r[4]) || 'Новая',
    urgency: cleanStr(r[5]) || 'Текущая задача',
    imageBase64: cleanStr(r[6]),
    createdAt: cleanStr(r[7]),
    updatedAt: cleanStr(r[8]),
  }));

  // Parse Contacts
  const contacts = contactRawRows
    .map((r, idx) => ({
      id: `cont-${idx + 1}`,
      producer: cleanStr(r[0]),
      site: cleanStr(r[1]),
      contact: cleanStr(r[2]),
      name: cleanStr(r[3]),
      productGroups: cleanStr(r[4]),
      note: cleanStr(r[5]),
    }))
    .filter(c => c.producer || c.name || c.contact || c.site || c.productGroups || c.note);

  // Parse New Products Batches
  const newProductItems: any[] = [];
  let currentBatch = extractBatchInfo('Загрузка: 20.05.2026 09:15:20');

  for (let i = 0; i < newProductRawRows.length; i++) {
    const r = newProductRawRows[i];
    const firstCell = cleanStr(r[0]);
    const isBatchHeader =
      firstCell.startsWith('📅') ||
      firstCell.toLowerCase().startsWith('загрузка') ||
      (firstCell.length > 10 && !/^\d{5,10}$/.test(firstCell) && firstCell !== 'Внешний код');

    if (isBatchHeader) {
      currentBatch = extractBatchInfo(firstCell);
      continue;
    }

    if (firstCell === 'Внешний код' || !firstCell) continue;

    let mgrCode = cleanStr(r[3]);
    let mgrName = cleanStr(r[5]);
    let section = cleanStr(r[4]);

    if (/^\d+$/.test(section) && !mgrCode) {
      mgrCode = section;
      section = mgrName;
      mgrName = '';
    }

    if (!mgrName && mgrCode && managersDict[mgrCode]) {
      mgrName = managersDict[mgrCode];
    }

    const isAdded = (r[7] || '').toUpperCase() === 'TRUE' || (r[7] || '').toLowerCase().includes('да');
    const isExported = (r[8] || '').toUpperCase() === 'TRUE' || (r[8] || '').toLowerCase().includes('да');

    newProductItems.push({
      id: `np-${i}`,
      externalCode: firstCell,
      title: cleanStr(r[1]),
      createdDate: cleanStr(r[2]),
      managerCode: mgrCode,
      sectionName: section,
      manager: mgrName,
      content: cleanStr(r[6]),
      isAdded,
      isExported,
      batchDate: currentBatch.date,
      batchFile: currentBatch.file,
      batchTitle: currentBatch.title,
    });
  }

  // Parse Category Groups from GID 0
  const groupsRows = groupsCsv ? parseCSV(groupsCsv).slice(1) : [];
  const categoryGroups: any[] = [];
  if (groupsRows.length > 0) {
    for (let i = 0; i < groupsRows.length; i++) {
      const r = groupsRows[i];
      if (!r || r.every(cell => !cleanStr(cell))) continue;
      const g3 = cleanStr(r[2]);
      if (!g3) continue;

      categoryGroups.push({
        id: `grp-${i + 1}`,
        group1: cleanStr(r[0]),
        group2: cleanStr(r[1]),
        group3: g3,
        manager: cleanStr(r[3]),
        includedMaterik: cleanStr(r[4]) || '0',
        includedPalas: cleanStr(r[5]) || '0',
        skuCount: cleanStr(r[6]) || '0',
        startDate: cleanStr(r[7]),
        donorRequestDate: cleanStr(r[8]),
        donorReceivedDate: cleanStr(r[9]),
        approvalSentDate: cleanStr(r[10]),
        approvalDate: cleanStr(r[11]),
        releaseDate: cleanStr(r[12]),
        palasAllocated: cleanStr(r[13]),
        kamFile: cleanStr(r[14]),
      });
    }
  }

  // Parse Site Order
  const orderRows = orderCsv ? parseCSV(orderCsv) : [];
  let currentGroup1 = '';
  let currentGroup2Cols: string[] = [];
  const parsedOrders: any[] = [];

  if (orderRows.length > 0) {
    for (let rowIndex = 0; rowIndex < orderRows.length; rowIndex++) {
      const r = orderRows[rowIndex].map(c => cleanStr(c));
      if (r.every(c => !c)) continue;

      const firstCell = r[0];
      const otherCells = r.slice(1).filter(Boolean);

      if (firstCell && otherCells.length === 0 && isNaN(Number(firstCell))) {
        currentGroup1 = firstCell;
        currentGroup2Cols = [];
        continue;
      }

      if (!firstCell && otherCells.length > 0) {
        currentGroup2Cols = r.slice(1);
        continue;
      }

      if (firstCell && !isNaN(Number(firstCell)) && currentGroup2Cols.length > 0) {
        const pos = parseInt(firstCell, 10);
        for (let colIdx = 0; colIdx < currentGroup2Cols.length; colIdx++) {
          const g2 = currentGroup2Cols[colIdx];
          const g3 = r[colIdx + 1];
          if (g2 && g3) {
            parsedOrders.push({
              id: `order-${parsedOrders.length + 1}`,
              position: pos,
              group1: currentGroup1,
              group2: g2,
              group3: g3,
              groupName: g3,
              section: currentGroup1 ? `${currentGroup1} / ${g2}` : g2,
              status: 'В структуре',
              comment: '',
            });
          }
        }
      }
    }
  }

  const allProducts = [...contentProducts, ...kamProducts];
  const now = new Date();
  lastSyncTimestamp = `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  cachedData = {
    products: allProducts,
    contentProducts,
    kamProducts,
    tasks,
    contacts,
    newProducts: newProductItems,
    groups: categoryGroups,
    groupOrders: parsedOrders,
    managers: managersDict,
    timestamp: lastSyncTimestamp,
    counts: {
      content: contentProducts.length,
      kam: kamProducts.length,
      tasks: tasks.length,
      groups: categoryGroups.length,
      newProducts: newProductItems.length,
      contacts: contacts.length,
    },
  };

  syncStats.totalSyncs++;
  syncStats.lastSuccess = lastSyncTimestamp;
  return cachedData;
}

// -------------------------------------------------------------
// API ROUTES
// -------------------------------------------------------------

// 1. Health & Server Info
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    authRequired: true,
    authScheme: 'Bearer Token (JWT / Signed HS256)',
    version: '2.0.0',
    sheetsProxy: 'active',
  });
});

// 2. Auth Endpoints
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = USERS.find(u => u.username.toLowerCase() === (username || '').trim().toLowerCase());

  if (!user) {
    return res.status(401).json({ success: false, error: 'Пользователь не найден' });
  }

  // Check password strictly for all users
  const inputPwd = (password || '').trim();
  if (!inputPwd) {
    return res.status(400).json({ success: false, error: 'Пожалуйста, введите пароль' });
  }

  const isMatch = user.passwords.some(p => p.toLowerCase() === inputPwd.toLowerCase());
  if (!isMatch) {
    return res.status(401).json({ success: false, error: 'Неверный логин или пароль' });
  }

  const token = signBearerToken({
    userId: user.id,
    username: user.username,
    role: user.role,
    department: user.department,
    expiresInDays: 7,
  });

  res.json({
    success: true,
    token,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      department: user.department,
    },
    expiresAt: Date.now() + 7 * 24 * 3600 * 1000,
  });
});

app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const foundUser = USERS.find(u => u.id === req.user.userId);
  const user = {
    id: req.user.userId,
    username: req.user.username,
    name: foundUser?.name || req.user.username,
    role: req.user.role,
    department: foundUser?.department || req.user.department,
  };

  res.json({
    success: true,
    user,
    tokenInfo: {
      role: req.user.role,
      expiresAt: req.user.exp ? req.user.exp * 1000 : null,
      tokenId: req.user.jti,
    },
  });
});

app.post('/api/auth/logout', (req, res) => {
  res.json({ success: true, message: 'Сессия завершена' });
});

app.get('/api/auth/roles', (req, res) => {
  res.json({
    success: true,
    roles: USERS.map(u => ({
      username: u.username,
      name: u.name,
      role: u.role,
      department: u.department,
      requiresPassword: u.passwords.length > 0 && !u.passwords.includes(''),
    })),
  });
});

// API Tokens Management
app.get('/api/auth/tokens', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const list = Array.from(apiTokensStore.values());
  res.json({ success: true, tokens: list });
});

app.post('/api/auth/tokens', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const { name, role, expiresInDays } = req.body || {};
  const tokenRole = role || req.user.role || 'admin';
  const days = Number(expiresInDays) || 30;

  const tokenId = `token-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const token = signBearerToken({
    userId: req.user.userId,
    username: req.user.username,
    role: tokenRole,
    department: req.user.department || 'API Token',
    tokenId,
    expiresInDays: days,
  });

  const item: StoredApiToken = {
    id: tokenId,
    name: name || `API Token ${new Date().toLocaleDateString('ru-RU')}`,
    token,
    userId: req.user.userId,
    role: tokenRole,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + days * 24 * 3600 * 1000).toISOString(),
    createdBy: req.user.username || 'Admin',
  };

  apiTokensStore.set(tokenId, item);
  res.json({ success: true, token, item });
});

app.delete('/api/auth/tokens/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const existed = apiTokensStore.delete(id);
  res.json({ success: true, deleted: existed });
});

// -------------------------------------------------------------
// 3. SECURE GOOGLE SHEETS BACKEND PROXY (All protected by Bearer auth)
// -------------------------------------------------------------

// Main Data Sync: Pull from Google Sheets on Server, Return to Client
app.get('/api/sheets/sync', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = await performCompleteSheetsSync();
    res.json({
      success: true,
      ...data,
      source: 'Google Sheets (Server Proxy)',
      requestedBy: req.user.username,
    });
  } catch (err: any) {
    console.error('Server Google Sheets sync error:', err);
    syncStats.lastError = err.message || 'Error';

    // If cache exists in memory, serve cache
    if (cachedData) {
      return res.json({
        success: true,
        ...cachedData,
        fromCache: true,
        warning: `Использованы кэшированные данные сервера: ${err.message}`,
      });
    }

    // Fallback: Read initial json snapshots from disk
    try {
      const pFile = path.join(__dirname, 'src/data/initialProducts.json');
      const tFile = path.join(__dirname, 'src/data/initialTasks.json');
      const gFile = path.join(__dirname, 'src/data/initialGroups.json');
      const cFile = path.join(__dirname, 'src/data/initialContacts.json');
      const nFile = path.join(__dirname, 'src/data/initialNewProducts.json');

      const products = fs.existsSync(pFile) ? JSON.parse(fs.readFileSync(pFile, 'utf8')) : [];
      const tasks = fs.existsSync(tFile) ? JSON.parse(fs.readFileSync(tFile, 'utf8')) : [];
      const groups = fs.existsSync(gFile) ? JSON.parse(fs.readFileSync(gFile, 'utf8')) : [];
      const contacts = fs.existsSync(cFile) ? JSON.parse(fs.readFileSync(cFile, 'utf8')) : [];
      const newProducts = fs.existsSync(nFile) ? JSON.parse(fs.readFileSync(nFile, 'utf8')) : [];

      return res.json({
        success: true,
        products,
        tasks,
        groups,
        contacts,
        newProducts,
        timestamp: 'Локальный снапшот данных',
        fromSnapshot: true,
        warning: `Ошибка подключения к Google Sheets: ${err.message}. Загружен локальный снапшот.`,
      });
    } catch {
      // ignore
    }

    res.status(500).json({
      success: false,
      error: `Ошибка выгрузки данных с Google Sheets: ${err.message}`,
    });
  }
});

// Legacy / alias sync endpoint
app.get('/api/sync-sheets', async (req, res) => {
  try {
    const data = await performCompleteSheetsSync();
    res.json({ success: true, ...data });
  } catch (err: any) {
    if (cachedData) {
      return res.json({ success: true, ...cachedData, fromCache: true });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// Webhook Proxy Endpoint: Dispatches requests to Google Apps Script safely from Backend
app.post('/api/sheets/webhook-proxy', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { webhookUrl, payload } = req.body || {};
    const url = (webhookUrl || serverWebhookUrl).trim();

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'URL Webhook Google Apps Script не настроен на сервере',
      });
    }

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
          error: 'Google Apps Script вернул страницу авторизации. Проверьте развертывание скрипта: доступ должен быть установлен "Все" (Anyone).',
        });
      }
      data = { raw: text, success: false, error: text.slice(0, 300) };
    }

    res.json({ success: true, ...data });
  } catch (err: any) {
    console.error('Server webhook proxy error:', err);
    res.status(500).json({ success: false, error: err.message || 'Ошибка вызова Webhook' });
  }
});

// Push endpoints for specialized operations
app.post('/api/sheets/push-products', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { department, products, webhookUrl } = req.body || {};
    const url = (webhookUrl || serverWebhookUrl).trim();

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'Webhook URL не настроен на сервере. Укажите его в настройках разработчика.',
      });
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'appendDepartmentProducts',
        department: department || 'Отдел контента',
        products: products || [],
        timestamp: new Date().toISOString(),
        user: req.user.username,
      }),
      redirect: 'follow',
    });

    const data = await response.json().catch(() => ({ success: true, message: 'Отправлено' }));
    res.json({ success: true, ...data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/sheets/push-status', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { department, files, updates, externalCodes, webhookUrl } = req.body || {};
    const url = (webhookUrl || serverWebhookUrl).trim();

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'Webhook URL не настроен на сервере',
      });
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'updateProductStatus',
        department: department || 'Отдел контента',
        files: files || [],
        updates: updates || {},
        externalCodes: externalCodes || [],
        timestamp: new Date().toISOString(),
        user: req.user.username,
      }),
      redirect: 'follow',
    });

    const data = await response.json().catch(() => ({ success: true, message: 'Статус обновлен' }));
    res.json({ success: true, ...data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/sheets/push-group', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { group3, updates, webhookUrl } = req.body || {};
    const url = (webhookUrl || serverWebhookUrl).trim();

    if (!url) {
      return res.status(400).json({ success: false, error: 'Webhook URL не настроен' });
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'updateGroup',
        group3,
        updates: updates || {},
        timestamp: new Date().toISOString(),
        user: req.user.username,
      }),
      redirect: 'follow',
    });

    const data = await response.json().catch(() => ({ success: true, message: 'Группа обновлена' }));
    res.json({ success: true, ...data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/sheets/push-task', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { task, action, taskId, webhookUrl } = req.body || {};
    const url = (webhookUrl || serverWebhookUrl).trim();

    if (!url) {
      return res.status(400).json({ success: false, error: 'Webhook URL не настроен' });
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: action || 'updateTask',
        task: task || {},
        id: taskId || task?.id,
        timestamp: new Date().toISOString(),
        user: req.user.username,
      }),
      redirect: 'follow',
    });

    const data = await response.json().catch(() => ({ success: true, message: 'Задача обновлена' }));
    res.json({ success: true, ...data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/sheets/push-batch', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { batchTitle, items, webhookUrl } = req.body || {};
    const url = (webhookUrl || serverWebhookUrl).trim();

    if (!url) {
      return res.status(400).json({ success: false, error: 'Webhook URL не настроен' });
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'appendNewProductsBatch',
        batchTitle,
        items: items || [],
        timestamp: new Date().toISOString(),
        user: req.user.username,
      }),
      redirect: 'follow',
    });

    const data = await response.json().catch(() => ({ success: true, message: 'Партия записана' }));
    res.json({ success: true, ...data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Test connection endpoint
app.post('/api/sheets/test-webhook', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { webhookUrl } = req.body || {};
    const url = (webhookUrl || serverWebhookUrl).trim();

    if (!url) {
      return res.status(400).json({ success: false, message: 'Webhook URL не указан' });
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ping', timestamp: new Date().toISOString() }),
      redirect: 'follow',
    });

    const text = await response.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      return res.json({
        success: false,
        message: 'Google Apps Script вернул некорректный ответ. Проверьте права доступа.',
      });
    }

    res.json({
      success: true,
      message: data.message || 'Связь с Google Apps Script активна!',
      spreadsheetName: data.spreadsheetName,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: `Ошибка связи: ${err.message}` });
  }
});

// Config Endpoints
app.get('/api/sheets/config', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  res.json({
    success: true,
    hasWebhookConfigured: Boolean(serverWebhookUrl),
    webhookUrlMasked: serverWebhookUrl ? serverWebhookUrl.replace(/(macros\/s\/)[^/]+(\/exec)/, '$1...$2') : null,
    lastSyncTimestamp,
    syncStats,
    cacheItemsCount: cachedData?.counts || null,
  });
});

app.post('/api/sheets/config', requireAuth, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const { webhookUrl } = req.body || {};
  if (webhookUrl !== undefined) {
    serverWebhookUrl = (webhookUrl || '').trim();
  }
  res.json({
    success: true,
    message: 'Настройки сервера обновлены',
    hasWebhookConfigured: Boolean(serverWebhookUrl),
  });
});

// ZIP Export Endpoint
app.get('/api/download-project-zip', (req, res) => {
  try {
    const rootDir = process.cwd();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="content-ops-portal.zip"');

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err: any) => {
      console.error('Archiver error:', err);
      res.status(500).send({ error: err.message });
    });

    archive.pipe(res);
    archive.glob('**/*', {
      cwd: rootDir,
      ignore: ['node_modules/**', 'dist/**', '.git/**', '*.log', '.vite/**'],
      dot: true,
    });
    archive.finalize();
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to create zip' });
  }
});

// -------------------------------------------------------------
// VITE & STATIC SERVING
// -------------------------------------------------------------
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
    console.log(`[Server] Content Ops Portal listening on port ${PORT}`);
    console.log(`[Server] Bearer Token authentication & Google Sheets proxy active`);
  });
}

startServer();
