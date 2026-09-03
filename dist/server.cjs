var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_config = require("dotenv/config");
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_fs = __toESM(require("fs"), 1);
var import_bcryptjs = __toESM(require("bcryptjs"), 1);
var import_jsonwebtoken = __toESM(require("jsonwebtoken"), 1);
var archiverPkg = __toESM(require("archiver"), 1);
var import_vite = require("vite");

// src/constants/index.ts
var MANAGERS_DICT = {
  "4": "\u0412\u043E\u043B\u0447\u0435\u043A",
  "5": "\u041C\u0438\u043B\u0435\u0432\u0441\u043A\u0430\u044F",
  "6": "\u041A\u043E\u043D\u043E\u043D\u043E\u0432\u0430",
  "10": "\u0421\u0438\u043D\u043A\u043E\u0432\u0435\u0446",
  "11": "\u041A\u0440\u0435\u043C\u0435\u043D\u044C",
  "14": "\u0413\u0438\u043B\u044C",
  "17": "\u041A\u043E\u0447\u0435\u0442\u043A\u043E\u0432",
  "27": "\u0415\u0432\u0442\u0443\u0445",
  "31": "\u041E\u043F\u043E\u043B\u044C\u043A\u043E",
  "32": "\u0413\u0440\u0443\u0434\u0438\u043D\u0430",
  "34": "\u0411\u0430\u0440\u0442\u0430\u0448\u0435\u0432\u0438\u0447",
  "35": "\u041A\u043E\u0436\u0435\u0434\u0443\u0431",
  "37": "\u0427\u0435\u0440\u0442\u043E\u043A"
};

// src/services/sheetsParser.ts
function parseCSV(text) {
  const lines = [];
  let row = [];
  let inQuotes = false;
  let field = "";
  let cleanText = text;
  if (cleanText.charCodeAt(0) === 65279) {
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
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && i + 1 < cleanText.length && cleanText[i + 1] === "\n") {
          i++;
        }
        row.push(field);
        field = "";
        if (row.some((f) => f.trim().length > 0)) {
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
    if (row.some((f) => f.trim().length > 0)) {
      lines.push(row);
    }
  }
  return lines;
}
function cleanStr(val) {
  if (!val) return "";
  return val.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();
}
function extractBatchInfo(header) {
  const raw = cleanStr(header);
  let fileName = "";
  const fileMatch = raw.match(/\((export_[^)]+\.(?:xlsx|xls))\)/i) || raw.match(/\(([^)]+\.(?:xlsx|xls))\)/i) || raw.match(/\(([^)]+)\)/);
  if (fileMatch) {
    fileName = fileMatch[1].trim();
  }
  const dateMatch = raw.match(/(\d{2}\.\d{2}\.\d{4}(?:\s+\d{2}:\d{2}(?::\d{2})?)?)/);
  const dateStr = dateMatch ? dateMatch[1] : "";
  let displayTitle = raw;
  if (!displayTitle.startsWith("\u{1F4C5}") && !displayTitle.startsWith("\u041F\u0430\u0440\u0442\u0438\u044F")) {
    displayTitle = `\u{1F4C5} ${raw}`;
  }
  return {
    title: displayTitle,
    date: dateStr || raw,
    file: fileName || (dateStr ? `\u041F\u0430\u0440\u0442\u0438\u044F \u043E\u0442 ${dateStr}` : raw)
  };
}
function parseProducts(csv, department, idPrefix) {
  const rows = parseCSV(csv).slice(1);
  return rows.filter((r) => r && r.some((cell) => cleanStr(cell).length > 0)).map((r, idx) => {
    const rawId = cleanStr(r[0]);
    const externalCode = cleanStr(r[1]);
    const group3 = cleanStr(r[2]);
    const title = cleanStr(r[3]);
    const dateUploaded = cleanStr(r[12]) || cleanStr(r[8]) || "";
    const sourceFile = cleanStr(r[11]) || (dateUploaded ? `\u041F\u0430\u0440\u0442\u0438\u044F \u043E\u0442 ${dateUploaded}` : rawId ? `\u0424\u0430\u0439\u043B ${rawId}` : "Google Sheets");
    return {
      id: `${idPrefix}-${rawId || idx + 1}`,
      externalCode: externalCode || (rawId ? `SKU-${rawId}` : `SKU-${idx + 1}`),
      group3,
      title: title || group3 || `\u0422\u043E\u0432\u0430\u0440 ${externalCode || rawId || idx + 1}`,
      status: cleanStr(r[4]) || "\u{1F195} \u041D\u043E\u0432\u044B\u0439",
      pauseReason: cleanStr(r[5]),
      pauseDate: cleanStr(r[6]),
      executor: cleanStr(r[7]),
      dateTaken: cleanStr(r[8]),
      dateCompleted: cleanStr(r[9]),
      dateFinished: cleanStr(r[10]),
      sourceFile,
      dateUploaded: dateUploaded || (/* @__PURE__ */ new Date()).toLocaleDateString("ru-RU"),
      department
    };
  }).filter((p) => p.externalCode || p.title || p.group3);
}
function parseTasks(csv) {
  return parseCSV(csv).slice(1).map((r, idx) => ({
    id: cleanStr(r[0]) || String(idx + 1),
    title: cleanStr(r[1]),
    description: cleanStr(r[2]),
    executors: cleanStr(r[3]),
    status: cleanStr(r[4]) || "\u041D\u043E\u0432\u0430\u044F",
    urgency: cleanStr(r[5]) || "\u0422\u0435\u043A\u0443\u0449\u0430\u044F \u0437\u0430\u0434\u0430\u0447\u0430",
    imageBase64: cleanStr(r[6]),
    createdAt: cleanStr(r[7]),
    updatedAt: cleanStr(r[8])
  }));
}
function parseContacts(csv) {
  if (!csv) return [];
  return parseCSV(csv).slice(1).map((r, idx) => ({
    id: `cont-${idx + 1}`,
    producer: cleanStr(r[0]),
    site: cleanStr(r[1]),
    contact: cleanStr(r[2]),
    name: cleanStr(r[3]),
    productGroups: cleanStr(r[4]),
    note: cleanStr(r[5])
  })).filter((c) => c.producer || c.name || c.contact || c.site || c.productGroups || c.note);
}
function parseManagersDict(csv) {
  const dict = { ...MANAGERS_DICT };
  if (!csv) return dict;
  for (const mr of parseCSV(csv).slice(1)) {
    const code = cleanStr(mr[0]);
    const name = cleanStr(mr[1]);
    if (code && name) {
      dict[code] = name;
    }
  }
  return dict;
}
function parseNewProducts(csv, managersDict) {
  const newProductRawRows = parseCSV(csv);
  const newProductItems = [];
  let currentBatch = extractBatchInfo("\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430: 20.05.2026 09:15:20");
  for (let i = 0; i < newProductRawRows.length; i++) {
    const r = newProductRawRows[i];
    const firstCell = cleanStr(r[0]);
    const isBatchHeader = firstCell.startsWith("\u{1F4C5}") || firstCell.toLowerCase().startsWith("\u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0430") || firstCell.length > 10 && !/^\d{5,10}$/.test(firstCell) && firstCell !== "\u0412\u043D\u0435\u0448\u043D\u0438\u0439 \u043A\u043E\u0434";
    if (isBatchHeader) {
      currentBatch = extractBatchInfo(firstCell);
      continue;
    }
    if (firstCell === "\u0412\u043D\u0435\u0448\u043D\u0438\u0439 \u043A\u043E\u0434" || !firstCell) continue;
    let mgrCode = cleanStr(r[3]);
    let mgrName = cleanStr(r[5]);
    let section = cleanStr(r[4]);
    if (/^\d+$/.test(section) && !mgrCode) {
      mgrCode = section;
      section = mgrName;
      mgrName = "";
    }
    if (!mgrName && mgrCode && managersDict[mgrCode]) {
      mgrName = managersDict[mgrCode];
    }
    const isAdded = (r[7] || "").toUpperCase() === "TRUE" || (r[7] || "").toLowerCase().includes("\u0434\u0430");
    const isExported = (r[8] || "").toUpperCase() === "TRUE" || (r[8] || "").toLowerCase().includes("\u0434\u0430");
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
      batchTitle: currentBatch.title
    });
  }
  return newProductItems;
}
function parseGroups(csv) {
  if (!csv) return [];
  const groupsRows = parseCSV(csv).slice(1);
  const groups = [];
  for (let i = 0; i < groupsRows.length; i++) {
    const r = groupsRows[i];
    if (!r || r.every((cell) => !cleanStr(cell))) continue;
    const g3 = cleanStr(r[2]);
    if (!g3) continue;
    groups.push({
      id: `grp-${i + 1}`,
      group1: cleanStr(r[0]),
      group2: cleanStr(r[1]),
      group3: g3,
      manager: cleanStr(r[3]),
      includedMaterik: cleanStr(r[4]) || "0",
      includedPalas: cleanStr(r[5]) || "0",
      skuCount: cleanStr(r[6]) || "0",
      startDate: cleanStr(r[7]),
      donorRequestDate: cleanStr(r[8]),
      donorReceivedDate: cleanStr(r[9]),
      approvalSentDate: cleanStr(r[10]),
      approvalDate: cleanStr(r[11]),
      releaseDate: cleanStr(r[12]),
      palasAllocated: cleanStr(r[13]),
      kamFile: cleanStr(r[14])
    });
  }
  return groups;
}
function parseSiteOrder(csv) {
  if (!csv) return [];
  const orderRows = parseCSV(csv);
  let currentGroup1 = "";
  let currentGroup2Cols = [];
  const parsedOrders = [];
  for (let rowIndex = 0; rowIndex < orderRows.length; rowIndex++) {
    const r = orderRows[rowIndex].map((c) => cleanStr(c));
    if (r.every((c) => !c)) continue;
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
            status: "\u0412 \u0441\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u0435",
            comment: ""
          });
        }
      }
    }
  }
  return parsedOrders;
}
function parseSheetsData(csvs) {
  const managersDict = parseManagersDict(csvs.managers);
  const contentProducts = parseProducts(csvs.content, "\u041E\u0442\u0434\u0435\u043B \u043A\u043E\u043D\u0442\u0435\u043D\u0442\u0430", "cnt");
  const kamProducts = parseProducts(csvs.kam, "\u041A\u043E\u043C\u043C\u0435\u0440\u0447\u0435\u0441\u043A\u0438\u0439 \u043E\u0442\u0434\u0435\u043B", "kam");
  return {
    contentProducts,
    kamProducts,
    products: [...contentProducts, ...kamProducts],
    tasks: parseTasks(csvs.tasks),
    groups: parseGroups(csvs.groups),
    groupOrders: parseSiteOrder(csvs.siteOrder),
    newProducts: parseNewProducts(csvs.newProducts, managersDict),
    contacts: parseContacts(csvs.contacts)
  };
}

// server.ts
var archiver = archiverPkg.default || archiverPkg;
var DATA_DIR = import_path.default.join(process.cwd(), "src/data");
var app = (0, import_express.default)();
var PORT = Number(process.env.PORT) || 3e3;
var JWT_SECRET = process.env.JWT_SECRET || "";
var ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || "";
var OBSERVER_PASSWORD_HASH = process.env.OBSERVER_PASSWORD_HASH || "";
var WEBHOOK_URL = (process.env.GOOGLE_SHEETS_WEBHOOK_URL || "").trim();
var LOGIN_MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS) || 5;
var LOGIN_BLOCK_MS = (Number(process.env.LOGIN_BLOCK_MINUTES) || 1) * 60 * 1e3;
var loginAttempts = /* @__PURE__ */ new Map();
app.set("trust proxy", 1);
if (!JWT_SECRET) {
  console.warn("JWT_SECRET is not set. Authentication will reject all tokens.");
}
app.use(import_express.default.json({ limit: "50mb" }));
function csvExportUrl(spreadsheetId, gid) {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
}
function envOr(name, fallback) {
  const value = process.env[name];
  return value !== void 0 && value !== "" ? value : fallback;
}
var SPREADSHEET_ID = envOr("SPREADSHEET_ID", "");
var GROUPS_SPREADSHEET_ID = envOr("GROUPS_SPREADSHEET_ID", "");
function signToken(role) {
  return import_jsonwebtoken.default.sign({ role }, JWT_SECRET, { expiresIn: "7d" });
}
function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!JWT_SECRET || !token) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const payload = import_jsonwebtoken.default.verify(token, JWT_SECRET);
    if (payload.role !== "admin" && payload.role !== "observer") {
      return res.status(401).json({ error: "Unauthorized" });
    }
    req.user = { role: payload.role };
    next();
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
}
function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}
async function fetchCsv(url, required = true) {
  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      Pragma: "no-cache",
      "Cache-Control": "no-cache"
    }
  });
  if (!res.ok) {
    if (!required) return "";
    throw new Error(`HTTP ${res.status} fetching sheet`);
  }
  return res.text();
}
var cachedData = null;
var lastSyncTime = "";
async function fetchFromSheets() {
  if (!SPREADSHEET_ID || !GROUPS_SPREADSHEET_ID) {
    throw new Error("SPREADSHEET_ID or GROUPS_SPREADSHEET_ID is not configured");
  }
  const cacheBust = `_t=${Date.now()}`;
  const contentUrl = `${csvExportUrl(SPREADSHEET_ID, envOr("GID_CONTENT", "59376984"))}&${cacheBust}`;
  const kamUrl = `${csvExportUrl(SPREADSHEET_ID, envOr("GID_KAM", "183144046"))}&${cacheBust}`;
  const tasksUrl = `${csvExportUrl(SPREADSHEET_ID, envOr("GID_TASKS", "1482592400"))}&${cacheBust}`;
  const newProductsUrl = `${csvExportUrl(SPREADSHEET_ID, envOr("GID_NEW_PRODUCTS", "413377182"))}&${cacheBust}`;
  const contactsUrl = `${csvExportUrl(SPREADSHEET_ID, envOr("GID_CONTACTS", "1825148105"))}&${cacheBust}`;
  const managersUrl = `${csvExportUrl(SPREADSHEET_ID, envOr("GID_MANAGERS", "1474629181"))}&${cacheBust}`;
  const workingKamUrl = `${csvExportUrl(SPREADSHEET_ID, envOr("GID_WORKING_KAM", "1367779997"))}&${cacheBust}`;
  const workingContentUrl = `${csvExportUrl(SPREADSHEET_ID, envOr("GID_WORKING_CONTENT", "33531424"))}&${cacheBust}`;
  const groupsUrl = `${csvExportUrl(GROUPS_SPREADSHEET_ID, envOr("GID_GROUPS", "0"))}&${cacheBust}`;
  const orderUrl = `${csvExportUrl(GROUPS_SPREADSHEET_ID, envOr("GID_SITE_ORDER", "442661295"))}&${cacheBust}`;
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
    siteOrder
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
    fetchCsv(orderUrl, false)
  ]);
  const parsed = parseSheetsData({
    content,
    kam,
    tasks,
    newProducts,
    contacts,
    managers,
    groups,
    siteOrder
  });
  const now = /* @__PURE__ */ new Date();
  lastSyncTime = `${String(now.getDate()).padStart(2, "0")}.${String(now.getMonth() + 1).padStart(2, "0")}.${now.getFullYear()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
  cachedData = {
    ...parsed,
    lastSyncTime,
    counts: {
      content: parsed.contentProducts.length,
      kam: parsed.kamProducts.length,
      tasks: parsed.tasks.length,
      groups: parsed.groups.length,
      newProducts: parsed.newProducts.length,
      contacts: parsed.contacts.length
    }
  };
  return cachedData;
}
function readLocalSnapshot() {
  const pFile = import_path.default.join(DATA_DIR, "initialProducts.json");
  const tFile = import_path.default.join(DATA_DIR, "initialTasks.json");
  const gFile = import_path.default.join(DATA_DIR, "initialGroups.json");
  if (!import_fs.default.existsSync(pFile)) return null;
  const products = JSON.parse(import_fs.default.readFileSync(pFile, "utf8"));
  const tasks = import_fs.default.existsSync(tFile) ? JSON.parse(import_fs.default.readFileSync(tFile, "utf8")) : [];
  const groups = import_fs.default.existsSync(gFile) ? JSON.parse(import_fs.default.readFileSync(gFile, "utf8")) : [];
  return { products, tasks, groups };
}
function getClientIp(req) {
  return req.ip || req.socket.remoteAddress || "unknown";
}
function remainingBlockSeconds(blockedUntil) {
  return Math.max(1, Math.ceil((blockedUntil - Date.now()) / 1e3));
}
function getLoginAttempt(ip) {
  const state = loginAttempts.get(ip);
  if (!state) return { count: 0, blockedUntil: 0 };
  if (state.blockedUntil > 0 && state.blockedUntil <= Date.now()) {
    loginAttempts.delete(ip);
    return { count: 0, blockedUntil: 0 };
  }
  return state;
}
function rejectBlocked(res, blockedUntil) {
  const retryAfter = remainingBlockSeconds(blockedUntil);
  res.setHeader("Retry-After", String(retryAfter));
  return res.status(429).json({
    ok: false,
    error: `\u0421\u043B\u0438\u0448\u043A\u043E\u043C \u043C\u043D\u043E\u0433\u043E \u043F\u043E\u043F\u044B\u0442\u043E\u043A. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u0447\u0435\u0440\u0435\u0437 ${retryAfter} \u0441\u0435\u043A\u0443\u043D\u0434.`,
    retryAfter
  });
}
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
});
app.post("/api/auth/login", async (req, res) => {
  const ip = getClientIp(req);
  const attempt = getLoginAttempt(ip);
  if (attempt.blockedUntil > Date.now()) {
    return rejectBlocked(res, attempt.blockedUntil);
  }
  const password = String(req.body?.password || "");
  if (!password) {
    return res.status(400).json({ ok: false, error: "\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043F\u0430\u0440\u043E\u043B\u044C" });
  }
  try {
    if (ADMIN_PASSWORD_HASH && await import_bcryptjs.default.compare(password, ADMIN_PASSWORD_HASH)) {
      loginAttempts.delete(ip);
      return res.json({ ok: true, token: signToken("admin"), role: "admin" });
    }
    if (OBSERVER_PASSWORD_HASH && await import_bcryptjs.default.compare(password, OBSERVER_PASSWORD_HASH)) {
      loginAttempts.delete(ip);
      return res.json({ ok: true, token: signToken("observer"), role: "observer" });
    }
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ ok: false, error: "\u041E\u0448\u0438\u0431\u043A\u0430 \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u0438" });
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
    error: `\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u043F\u0430\u0440\u043E\u043B\u044C. \u041E\u0441\u0442\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u043F\u044B\u0442\u043E\u043A: ${remaining}`
  });
});
app.use("/api", (req, res, next) => {
  if (req.path === "/auth/login" || req.path === "/health") {
    return next();
  }
  return authMiddleware(req, res, next);
});
app.get("/api/auth/me", (req, res) => {
  res.json({ ok: true, role: req.user?.role });
});
app.get("/api/sheets/status", (_req, res) => {
  res.json({ webhookConfigured: Boolean(WEBHOOK_URL) });
});
app.get("/api/sync-sheets", async (_req, res) => {
  try {
    const data = await fetchFromSheets();
    res.json({ success: true, ...data });
  } catch (err) {
    console.error("API sync error:", err);
    if (cachedData) {
      return res.json({ success: true, ...cachedData, fromCache: true });
    }
    try {
      const snapshot = readLocalSnapshot();
      if (snapshot) {
        const products = snapshot.products || [];
        const contentProducts = products.filter((p) => p.department === "\u041E\u0442\u0434\u0435\u043B \u043A\u043E\u043D\u0442\u0435\u043D\u0442\u0430");
        const kamProducts = products.filter((p) => p.department === "\u041A\u043E\u043C\u043C\u0435\u0440\u0447\u0435\u0441\u043A\u0438\u0439 \u043E\u0442\u0434\u0435\u043B");
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
          lastSyncTime: "\u0418\u0437 \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u043E\u0433\u043E \u0441\u043D\u0430\u043F\u0448\u043E\u0442\u0430",
          fromSnapshot: true
        });
      }
    } catch {
    }
    res.status(500).json({ success: false, error: err.message || "\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u0438" });
  }
});
app.post("/api/sheets/webhook-proxy", requireAdmin, async (req, res) => {
  try {
    const url = WEBHOOK_URL;
    if (!url) {
      return res.status(503).json({ success: false, error: "Webhook \u043D\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043D \u043D\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0435" });
    }
    const { payload } = req.body || {};
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
      redirect: "follow"
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      if (text.includes("<!DOCTYPE") || text.includes("<html") || text.includes("Google Accounts")) {
        return res.status(403).json({
          success: false,
          error: "Google Apps Script \u0432\u0435\u0440\u043D\u0443\u043B \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443 \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u0438. \u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 \u0440\u0430\u0437\u0432\u0435\u0440\u0442\u044B\u0432\u0430\u043D\u0438\u0435 \u0441\u043A\u0440\u0438\u043F\u0442\u0430: \u0432 \u043F\u043E\u043B\u0435 \xAB\u0423 \u043A\u043E\u0433\u043E \u0435\u0441\u0442\u044C \u0434\u043E\u0441\u0442\u0443\u043F\xBB \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u043E \u0432\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \xAB\u0412\u0441\u0435\xBB (Anyone).",
          isAuthHtml: true
        });
      }
      data = { raw: text, success: false, error: text.slice(0, 200) };
    }
    if (data && data.success === false) {
      return res.status(400).json(data);
    }
    res.json({ success: true, ...data });
  } catch (err) {
    console.error("Webhook proxy error:", err);
    res.status(500).json({ success: false, error: err.message || "Webhook request failed" });
  }
});
app.get("/api/data-snapshot", (_req, res) => {
  if (cachedData) {
    return res.json(cachedData);
  }
  try {
    const snapshot = readLocalSnapshot();
    if (snapshot) {
      return res.json({
        ...snapshot,
        lastSyncTime: "\u0421\u043D\u0430\u043F\u0448\u043E\u0442 Google Sheets"
      });
    }
  } catch {
  }
  res.json({ products: [], tasks: [], groups: [] });
});
app.get("/api/download-project-zip", requireAdmin, (req, res) => {
  try {
    const rootDir = process.cwd();
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="content-ops-project.zip"');
    const archive = archiver("zip", {
      zlib: { level: 9 }
    });
    archive.on("error", (err) => {
      console.error("Archiver error:", err);
      res.status(500).send({ error: err.message });
    });
    archive.pipe(res);
    archive.glob("**/*", {
      cwd: rootDir,
      ignore: [
        "node_modules/**",
        "dist/**",
        ".git/**",
        "*.log",
        ".vite/**",
        ".env",
        ".env.*"
      ],
      dot: true
    });
    archive.finalize();
  } catch (err) {
    console.error("Zip export error:", err);
    res.status(500).json({ error: "Failed to create zip" });
  }
});
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = import_path.default.join(process.cwd(), "dist");
    app.use(import_express.default.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(import_path.default.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}
startServer();
//# sourceMappingURL=server.cjs.map
