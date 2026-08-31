import { ProductItem, TaskItem, CategoryGroup, GroupOrderItem, NewProductItem, SupplierContact, DepartmentType } from '../types';
import {
  SPREADSHEET_URL,
  KAM_SPREADSHEET_URL,
  GROUPS_SPREADSHEET_URL,
  SITE_ORDER_SPREADSHEET_URL,
  TASKS_SPREADSHEET_URL,
  NEW_PRODUCTS_SPREADSHEET_URL,
  CONTACTS_SPREADSHEET_URL,
  MANAGERS_SPREADSHEET_URL,
  WORKING_GROUPS_CONTENT_URL,
  WORKING_GROUPS_KAM_URL,
  MANAGERS_DICT,
  CATEGORY_MANAGERS_MAP,
  getManagerForCategory,
  getCategoryHierarchy,
} from '../constants';
import { idb } from './indexedDbService';
import { storageService } from './storageService';

export interface SyncResult {
  success: boolean;
  contentCount: number;
  kamCount: number;
  tasksCount: number;
  groupsCount: number;
  newProductsCount: number;
  contactsCount: number;
  timestamp: string;
  error?: string;
}

/**
 * Robust CSV parser that handles quotes, commas, newlines within cells
 */
export function parseCSV(text: string): string[][] {
  const lines: string[][] = [];
  let row: string[] = [];
  let inQuotes = false;
  let field = '';

  // Strip BOM if present
  let cleanText = text;
  if (cleanText.charCodeAt(0) === 0xFEFF) {
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

/**
 * Extract GID from Google Sheets URL
 */
function getGidFromUrl(url: string, defaultGid: string): string {
  const match = url.match(/gid=([0-9]+)/);
  return match ? match[1] : defaultGid;
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

export interface PushLogItem {
  id: string;
  title: string;
  details: string;
  time: string;
  status: 'pending' | 'success' | 'error';
}

export class GoogleSheetsService {
  private isSyncing = false;
  private lastSyncTime: string | null = null;
  private listeners: Array<() => void> = [];
  private webhookUrl: string = '';
  private pushLogs: PushLogItem[] = [];
  private autoSyncInterval: any = null;

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('GOOGLE_SHEETS_WEBHOOK_URL');
        if (saved) {
          this.webhookUrl = saved;
        } else if ((import.meta as any).env?.VITE_GOOGLE_SHEETS_WEBHOOK_URL) {
          this.webhookUrl = (import.meta as any).env.VITE_GOOGLE_SHEETS_WEBHOOK_URL;
        }
      } catch {
        // ignore
      }
    }
  }

  getWebhookUrl(): string {
    return this.webhookUrl;
  }

  setWebhookUrl(url: string): void {
    this.webhookUrl = (url || '').trim();
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('GOOGLE_SHEETS_WEBHOOK_URL', this.webhookUrl);
      } catch {
        // ignore
      }
    }
    this.notify();
  }

  clearWebhookUrl(): void {
    this.webhookUrl = '';
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem('GOOGLE_SHEETS_WEBHOOK_URL');
      } catch {
        // ignore
      }
    }
    this.notify();
  }

  getPushLog(): PushLogItem[] {
    return [...this.pushLogs];
  }

  clearLogs(): void {
    this.pushLogs = [];
    this.notify();
  }

  private addLog(title: string, details: string, status: 'pending' | 'success' | 'error'): string {
    const id = `log-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    this.pushLogs.unshift({ id, title, details, time, status });
    if (this.pushLogs.length > 50) this.pushLogs.pop();
    this.notify();
    return id;
  }

  private updateLog(id: string, status: 'success' | 'error', details?: string) {
    const item = this.pushLogs.find(l => l.id === id);
    if (item) {
      item.status = status;
      if (details) item.details = details;
      this.notify();
    }
  }

  async testWebhook(targetUrl?: string): Promise<{ success: boolean; message: string; spreadsheetName?: string }> {
    const url = (targetUrl !== undefined ? targetUrl : this.webhookUrl).trim();
    if (!url) {
      return { success: false, message: 'URL веб-приложения Apps Script не указан' };
    }

    try {
      // Try GET ping test
      const testPingUrl = url.includes('?') ? `${url}&action=ping` : `${url}?action=ping`;
      const res = await fetch(testPingUrl, { method: 'GET', mode: 'cors' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json && json.success) {
        return {
          success: true,
          message: json.message || 'Связь успешно проверена',
          spreadsheetName: json.spreadsheetName,
        };
      }
      return { success: false, message: json.error || 'Ошибка ответа от скрипта' };
    } catch (err: any) {
      // If CORS blocks GET, try POST with no-cors or through server proxy
      try {
        const proxyRes = await fetch('/api/sheets/webhook-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ webhookUrl: url, payload: { action: 'ping' } }),
        });
        if (proxyRes.ok) {
          const pJson = await proxyRes.json();
          if (pJson && pJson.success) {
            return {
              success: true,
              message: pJson.message || 'Связь с Google Таблицей активна',
              spreadsheetName: pJson.spreadsheetName,
            };
          }
        }
      } catch {
        // ignore proxy failure on static hosts
      }

      return {
        success: false,
        message: `Не удалось связаться со скриптом: ${err.message || 'Проверьте доступ "Все" (Anyone) в настройках развертывания'}`,
      };
    }
  }

  private async dispatchWebhook(payload: any): Promise<{ success: boolean; message?: string; error?: string }> {
    const url = this.webhookUrl.trim();
    if (!url) {
      return { success: false, error: 'Webhook URL не настроен' };
    }

    try {
      // First try server proxy if running in full-stack mode
      try {
        const proxyRes = await fetch('/api/sheets/webhook-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ webhookUrl: url, payload }),
        });
        const resJson = await proxyRes.json().catch(() => null);
        if (proxyRes.ok && resJson && resJson.success) {
          return { success: true, message: resJson.message || 'Успешно отправлено' };
        } else if (resJson && resJson.error) {
          return { success: false, error: resJson.error };
        }
      } catch (err: any) {
        console.warn('Proxy dispatch error, trying direct client POST:', err);
      }

      // Direct client POST to Google Apps Script Web App
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        mode: 'no-cors', // standard for Google Apps Script 302 redirects
      });

      return { success: true, message: 'Данные переданы в Webhook' };
    } catch (err: any) {
      console.warn('Webhook dispatch error:', err);
      return { success: false, error: err.message || 'Ошибка связи с Webhook' };
    }
  }

  async pushProductStatusUpdate(
    files: string[],
    department: DepartmentType,
    updates: Partial<ProductItem>
  ): Promise<boolean> {
    const title = `Обновление статуса: ${updates.status || 'изменения'}`;
    const details = `${department} — файлов: ${files.length} (${files.slice(0, 2).join(', ')}${files.length > 2 ? '...' : ''})`;
    const logId = this.addLog(title, details, 'pending');

    if (!this.webhookUrl) {
      this.updateLog(logId, 'success', `${details} — сохранено локально`);
      return true;
    }

    const payload = {
      action: 'updateProductStatus',
      department,
      files,
      updates,
      timestamp: new Date().toISOString(),
    };

    const res = await this.dispatchWebhook(payload);
    if (res.success) {
      this.updateLog(logId, 'success', `${details} — отправлено в Google Sheets`);
      return true;
    } else {
      this.updateLog(logId, 'error', `${details} — ${res.error || 'ошибка отправки'}`);
      return false;
    }
  }

  async pushGroupUpdate(group3: string, updates: Partial<CategoryGroup>): Promise<boolean> {
    const title = `Обновление группы: ${group3}`;
    const details = `Менеджер: ${updates.manager || '—'}, Файл КАМ: ${updates.kamFile || '—'}`;
    const logId = this.addLog(title, details, 'pending');

    if (!this.webhookUrl) {
      this.updateLog(logId, 'success', `${details} — сохранено локально`);
      return true;
    }

    const payload = {
      action: 'updateGroup',
      group3,
      updates,
      timestamp: new Date().toISOString(),
    };

    const res = await this.dispatchWebhook(payload);
    if (res.success) {
      this.updateLog(logId, 'success', `${details} — отправлено в Google Sheets`);
      return true;
    } else {
      this.updateLog(logId, 'error', `${details} — ${res.error || 'ошибка отправки'}`);
      return false;
    }
  }

  async pushTaskUpdate(task: TaskItem): Promise<boolean> {
    const title = `Сохранение задачи: #${task.id} ${task.title}`;
    const details = `Статус: ${task.status}, Срочность: ${task.urgency}`;
    const logId = this.addLog(title, details, 'pending');

    if (!this.webhookUrl) {
      this.updateLog(logId, 'success', `${details} — сохранено локально`);
      return true;
    }

    const payload = {
      action: 'updateTask',
      task,
      timestamp: new Date().toISOString(),
    };

    const res = await this.dispatchWebhook(payload);
    if (res.success) {
      this.updateLog(logId, 'success', `${details} — отправлено в Google Sheets`);
      return true;
    } else {
      this.updateLog(logId, 'error', `${details} — ${res.error || 'ошибка отправки'}`);
      return false;
    }
  }

  async pushTaskDelete(id: string): Promise<boolean> {
    const title = `Удаление задачи: #${id}`;
    const details = `Удалена из списка`;
    const logId = this.addLog(title, details, 'pending');

    if (!this.webhookUrl) {
      this.updateLog(logId, 'success', `${details} — сохранено локально`);
      return true;
    }

    const payload = {
      action: 'deleteTask',
      id,
      timestamp: new Date().toISOString(),
    };

    const res = await this.dispatchWebhook(payload);
    if (res.success) {
      this.updateLog(logId, 'success', `${details} — отправлено в Google Sheets`);
      return true;
    } else {
      this.updateLog(logId, 'error', `${details} — ${res.error || 'ошибка отправки'}`);
      return false;
    }
  }

  async pushDepartmentProducts(
    department: DepartmentType,
    products: ProductItem[]
  ): Promise<{ success: boolean; message: string; count?: number }> {
    if (!products || products.length === 0) {
      return { success: true, message: 'Список товаров пуст', count: 0 };
    }

    const targetSheetName = department.includes('КАМ') || department.includes('Коммерческий')
      ? '📥 Загруженные данные КАМ'
      : '📥 Загруженные данные контента';

    const title = `Выгрузка товаров: ${department}`;
    const filesCount = new Set(products.map(p => p.sourceFile || 'Файл')).size;
    const details = `${products.length} SKU (${filesCount} файлов) в лист «${targetSheetName}»`;
    const logId = this.addLog(title, details, 'pending');

    if (!this.webhookUrl) {
      this.updateLog(logId, 'success', `${details} — сохранено локально`);
      return {
        success: true,
        message: `Товары сохранены локально (${products.length} SKU). Для автоматической записи в лист «${targetSheetName}» укажите Webhook.`,
        count: products.length,
      };
    }

    const CHUNK_SIZE = 500;
    let totalAdded = 0;
    let lastError = '';

    for (let i = 0; i < products.length; i += CHUNK_SIZE) {
      const chunk = products.slice(i, i + CHUNK_SIZE);
      const payload = {
        action: 'appendDepartmentProducts',
        department,
        products: chunk.map(p => ({
          externalCode: p.externalCode || '',
          group3: p.group3 || '',
          title: p.title || '',
          status: p.status || '🆕 Новый',
          pauseReason: p.pauseReason || '',
          pauseDate: p.pauseDate || '',
          executor: p.executor || '',
          dateTaken: p.dateTaken || '',
          dateCompleted: p.dateCompleted || '',
          dateFinished: p.dateFinished || '',
          sourceFile: p.sourceFile || '',
          dateUploaded: p.dateUploaded || '',
        })),
        timestamp: new Date().toISOString(),
      };

      const res = await this.dispatchWebhook(payload);
      if (res.success) {
        totalAdded += chunk.length;
      } else {
        lastError = res.error || 'Ошибка отправки';
      }
    }

    if (totalAdded > 0) {
      this.updateLog(logId, 'success', `${details} — отправлено в Google Sheets`);
      return {
        success: true,
        message: `Успешно выгружено ${totalAdded} SKU в Google Таблицу (лист «${targetSheetName}»)!`,
        count: totalAdded,
      };
    } else {
      this.updateLog(logId, 'error', `${details} — ${lastError || 'ошибка отправки'}`);
      return {
        success: false,
        message: lastError || 'Ошибка при отправке в Google Sheets',
        count: 0,
      };
    }
  }

  async pushNewProductsBatch(
    items: NewProductItem[],
    batchTitle?: string
  ): Promise<{ success: boolean; message: string; count: number }> {
    const title = batchTitle || (items[0]?.batchTitle || items[0]?.batchFile || `Партия от ${new Date().toLocaleDateString('ru-RU')}`);
    const details = `Новые товары: ${items.length} SKU (${title})`;
    const logId = this.addLog(`Отправка партии в Google Sheets`, details, 'pending');

    if (!this.webhookUrl) {
      this.updateLog(logId, 'error', `${details} — Webhook URL не настроен`);
      return {
        success: false,
        message: 'Webhook не настроен. Откройте настройки Google Sheets и укажите URL веб-приложения.',
        count: 0,
      };
    }

    const payload = {
      action: 'appendNewProductsBatch',
      batchTitle: title,
      items: items.map(it => ({
        externalCode: it.externalCode,
        title: it.title,
        createdDate: it.createdDate || it.batchDate || '',
        managerCode: it.managerCode || '',
        sectionName: it.sectionName || '',
        manager: it.manager || '',
        content: it.content || '',
        isAdded: Boolean(it.isAdded),
        isExported: Boolean(it.isExported),
      })),
      timestamp: new Date().toISOString(),
    };

    const res = await this.dispatchWebhook(payload);
    if (res.success) {
      this.updateLog(logId, 'success', `${details} — успешно записано в лист «Новые товары»`);
      return {
        success: true,
        message: `Успешно отправлено ${items.length} SKU в Google Таблицу (лист «Новые товары»)`,
        count: items.length,
      };
    } else {
      this.updateLog(logId, 'error', `${details} — ${res.error || 'ошибка отправки'}`);
      return {
        success: false,
        message: res.error || 'Ошибка при отправке запроса в Google Apps Script Webhook. Проверьте настройки доступа.',
        count: 0,
      };
    }
  }

  async pushAllNewProducts(
    items: NewProductItem[]
  ): Promise<{ success: boolean; message: string; count: number }> {
    const details = `Синхронизация всех партий: ${items.length} SKU`;
    const logId = this.addLog(`Полная выгрузка партий в Google Sheets`, details, 'pending');

    if (!this.webhookUrl) {
      this.updateLog(logId, 'error', `${details} — Webhook URL не настроен`);
      return {
        success: false,
        message: 'Webhook не настроен. Укажите URL веб-приложения в настройках.',
        count: 0,
      };
    }

    // Group items by batch
    const batchMap = new Map<string, NewProductItem[]>();
    for (const item of items) {
      const bKey = item.batchTitle || (item.batchDate ? `📅 ${item.batchDate} (${item.batchFile || 'Партия'})` : 'Партия');
      if (!batchMap.has(bKey)) {
        batchMap.set(bKey, []);
      }
      batchMap.get(bKey)!.push(item);
    }

    let successCount = 0;
    let lastError = '';
    for (const [bTitle, bItems] of batchMap.entries()) {
      const payload = {
        action: 'appendNewProductsBatch',
        batchTitle: bTitle,
        items: bItems.map(it => ({
          externalCode: it.externalCode,
          title: it.title,
          createdDate: it.createdDate || it.batchDate || '',
          managerCode: it.managerCode || '',
          sectionName: it.sectionName || '',
          manager: it.manager || '',
          content: it.content || '',
          isAdded: Boolean(it.isAdded),
          isExported: Boolean(it.isExported),
        })),
        timestamp: new Date().toISOString(),
      };
      const res = await this.dispatchWebhook(payload);
      if (res.success) {
        successCount += bItems.length;
      } else {
        lastError = res.error || 'Ошибка отправки';
      }
    }

    if (successCount > 0) {
      this.updateLog(logId, 'success', `Отправлено ${successCount} SKU из ${batchMap.size} партий`);
      return {
        success: true,
        message: `Успешно выгружено ${successCount} SKU в Google Таблицу (лист «Новые товары»)`,
        count: successCount,
      };
    } else {
      this.updateLog(logId, 'error', `Ошибка отправки партий: ${lastError}`);
      return {
        success: false,
        message: lastError || 'Ошибка при отправке в Google Sheets.',
        count: 0,
      };
    }
  }

  startAutoSync(intervalMinutes: number = 3): () => void {
    if (this.autoSyncInterval) {
      clearInterval(this.autoSyncInterval);
    }
    this.autoSyncInterval = setInterval(() => {
      this.syncAll().catch(() => {});
    }, intervalMinutes * 60 * 1000);

    return () => {
      if (this.autoSyncInterval) {
        clearInterval(this.autoSyncInterval);
        this.autoSyncInterval = null;
      }
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify() {
    this.listeners.forEach(l => l());
  }

  getIsSyncing(): boolean {
    return this.isSyncing;
  }

  getLastSyncTime(): string | null {
    return this.lastSyncTime;
  }

  async syncAll(): Promise<SyncResult> {
    if (this.isSyncing) {
      return {
        success: false,
        contentCount: 0,
        kamCount: 0,
        tasksCount: 0,
        groupsCount: 0,
        newProductsCount: 0,
        contactsCount: 0,
        timestamp: this.lastSyncTime || '',
        error: 'Синхронизация уже выполняется',
      };
    }

    this.isSyncing = true;
    this.notify();

    try {
      // Direct CSV export URLs
      const contentGid = getGidFromUrl(SPREADSHEET_URL, '59376984');
      const kamGid = getGidFromUrl(KAM_SPREADSHEET_URL, '183144046');
      const tasksGid = getGidFromUrl(TASKS_SPREADSHEET_URL, '1482592400');
      const newProductsGid = getGidFromUrl(NEW_PRODUCTS_SPREADSHEET_URL, '413377182');
      const contactsGid = getGidFromUrl(CONTACTS_SPREADSHEET_URL, '1825148105');
      const managersGid = getGidFromUrl(MANAGERS_SPREADSHEET_URL, '1474629181');
      const workingKamGid = getGidFromUrl(WORKING_GROUPS_KAM_URL, '1367779997');
      const workingContentGid = getGidFromUrl(WORKING_GROUPS_CONTENT_URL, '33531424');

      const contentExportUrl = `https://docs.google.com/spreadsheets/d/1vCZQgzBPv8uahr8ckRI1f-TA_QS6Afz2B9NP_ZMj6ek/export?format=csv&gid=${contentGid}`;
      const kamExportUrl = `https://docs.google.com/spreadsheets/d/1vCZQgzBPv8uahr8ckRI1f-TA_QS6Afz2B9NP_ZMj6ek/export?format=csv&gid=${kamGid}`;
      const tasksExportUrl = `https://docs.google.com/spreadsheets/d/1vCZQgzBPv8uahr8ckRI1f-TA_QS6Afz2B9NP_ZMj6ek/export?format=csv&gid=${tasksGid}`;
      const newProductsExportUrl = `https://docs.google.com/spreadsheets/d/1vCZQgzBPv8uahr8ckRI1f-TA_QS6Afz2B9NP_ZMj6ek/export?format=csv&gid=${newProductsGid}`;
      const contactsExportUrl = `https://docs.google.com/spreadsheets/d/1vCZQgzBPv8uahr8ckRI1f-TA_QS6Afz2B9NP_ZMj6ek/export?format=csv&gid=${contactsGid}`;
      const managersExportUrl = `https://docs.google.com/spreadsheets/d/1vCZQgzBPv8uahr8ckRI1f-TA_QS6Afz2B9NP_ZMj6ek/export?format=csv&gid=${managersGid}`;
      const workingKamExportUrl = `https://docs.google.com/spreadsheets/d/1vCZQgzBPv8uahr8ckRI1f-TA_QS6Afz2B9NP_ZMj6ek/export?format=csv&gid=${workingKamGid}`;
      const workingContentExportUrl = `https://docs.google.com/spreadsheets/d/1vCZQgzBPv8uahr8ckRI1f-TA_QS6Afz2B9NP_ZMj6ek/export?format=csv&gid=${workingContentGid}`;
      
      const groupsGid = getGidFromUrl(GROUPS_SPREADSHEET_URL, '0');
      const groupsExportUrl = `https://docs.google.com/spreadsheets/d/1LABW3U4TdX6cDjps_g_mBBsWRW8_Xx7W8LqBZB4CO2g/export?format=csv&gid=${groupsGid}`;
      const orderGid = getGidFromUrl(SITE_ORDER_SPREADSHEET_URL, '442661295');
      const orderExportUrl = `https://docs.google.com/spreadsheets/d/1LABW3U4TdX6cDjps_g_mBBsWRW8_Xx7W8LqBZB4CO2g/export?format=csv&gid=${orderGid}`;

      // Fetch all sheets in parallel
      const [
        contentRes,
        kamRes,
        tasksRes,
        newProductsRes,
        contactsRes,
        managersRes,
        workingKamRes,
        workingContentRes,
        groupsRes,
        orderRes,
      ] = await Promise.all([
        fetch(contentExportUrl).then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status} fetching content sheet`);
          return r.text();
        }),
        fetch(kamExportUrl).then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status} fetching KAM sheet`);
          return r.text();
        }),
        fetch(tasksExportUrl).then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status} fetching tasks sheet`);
          return r.text();
        }),
        fetch(newProductsExportUrl).then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status} fetching new products sheet`);
          return r.text();
        }),
        fetch(contactsExportUrl)
          .then(r => (r.ok ? r.text() : ''))
          .catch(() => ''),
        fetch(managersExportUrl)
          .then(r => (r.ok ? r.text() : ''))
          .catch(() => ''),
        fetch(workingKamExportUrl)
          .then(r => (r.ok ? r.text() : ''))
          .catch(() => ''),
        fetch(workingContentExportUrl)
          .then(r => (r.ok ? r.text() : ''))
          .catch(() => ''),
        fetch(groupsExportUrl)
          .then(r => (r.ok ? r.text() : ''))
          .catch(() => ''),
        fetch(orderExportUrl)
          .then(r => (r.ok ? r.text() : ''))
          .catch(() => ''),
      ]);

      const contentRows = parseCSV(contentRes).slice(1);
      const kamRows = parseCSV(kamRes).slice(1);
      const taskRows = parseCSV(tasksRes).slice(1);
      const newProductRawRows = parseCSV(newProductsRes);
      const contactRawRows = contactsRes ? parseCSV(contactsRes).slice(1) : [];
      const managerRawRows = managersRes ? parseCSV(managersRes).slice(1) : [];
      const workingKamRawRows = workingKamRes ? parseCSV(workingKamRes).slice(1) : [];
      const workingContentRawRows = workingContentRes ? parseCSV(workingContentRes).slice(1) : [];

      // Parse Dynamic Managers dictionary from "Менеджеры" sheet
      const dynamicManagersDict: Record<string, string> = { ...MANAGERS_DICT };
      for (const mr of managerRawRows) {
        const code = cleanStr(mr[0]);
        const name = cleanStr(mr[1]);
        if (code && name) {
          dynamicManagersDict[code] = name;
        }
      }

      // Parse Content Dept Products
      const contentProducts: ProductItem[] = contentRows.map((r, idx) => ({
        id: `cnt-${cleanStr(r[0]) || idx + 1}`,
        externalCode: cleanStr(r[1]),
        group3: cleanStr(r[2]),
        title: cleanStr(r[3]),
        status: cleanStr(r[4]) || '🆕 Новый',
        pauseReason: cleanStr(r[5]),
        pauseDate: cleanStr(r[6]),
        executor: cleanStr(r[7]),
        dateTaken: cleanStr(r[8]),
        dateCompleted: cleanStr(r[9]),
        dateFinished: cleanStr(r[10]),
        sourceFile: cleanStr(r[11]),
        dateUploaded: cleanStr(r[12]),
        department: 'Отдел контента',
      }));

      // Parse Commercial Dept (KAM) Products
      const kamProducts: ProductItem[] = kamRows.map((r, idx) => ({
        id: `kam-${cleanStr(r[0]) || idx + 1}`,
        externalCode: cleanStr(r[1]),
        group3: cleanStr(r[2]),
        title: cleanStr(r[3]),
        status: cleanStr(r[4]) || '🆕 Новый',
        pauseReason: cleanStr(r[5]),
        pauseDate: cleanStr(r[6]),
        executor: cleanStr(r[7]),
        dateTaken: cleanStr(r[8]),
        dateCompleted: cleanStr(r[9]),
        dateFinished: cleanStr(r[10]),
        sourceFile: cleanStr(r[11]),
        dateUploaded: cleanStr(r[12]),
        department: 'Коммерческий отдел',
      }));

      // Parse Tasks
      const tasks: TaskItem[] = taskRows.map((r, idx) => ({
        id: cleanStr(r[0]) || String(idx + 1),
        title: cleanStr(r[1]),
        description: cleanStr(r[2]),
        executors: cleanStr(r[3]),
        status: (cleanStr(r[4]) || 'Новая') as any,
        urgency: (cleanStr(r[5]) || 'Текущая задача') as any,
        imageBase64: cleanStr(r[6]),
        createdAt: cleanStr(r[7]),
        updatedAt: cleanStr(r[8]),
      }));

      // Parse Contacts
      const contacts: SupplierContact[] = contactRawRows
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

      // Section metadata accumulator from "Новые товары"
      const sectionDataMap = new Map<
        string,
        {
          managersCount: Record<string, number>;
          addedCount: number;
          exportedCount: number;
          total: number;
        }
      >();

      // Parse New Products (Batches)
      const newProductItems: NewProductItem[] = [];
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

        // Fix column shifts if section is numeric
        if (/^\d+$/.test(section) && !mgrCode) {
          mgrCode = section;
          section = mgrName;
          mgrName = '';
        }

        if (!mgrName && mgrCode && dynamicManagersDict[mgrCode]) {
          mgrName = dynamicManagersDict[mgrCode];
        }

        const isAdded = (r[7] || '').toUpperCase() === 'TRUE' || (r[7] || '').toLowerCase().includes('да');
        const isExported = (r[8] || '').toUpperCase() === 'TRUE' || (r[8] || '').toLowerCase().includes('да');

        if (section) {
          if (!sectionDataMap.has(section)) {
            sectionDataMap.set(section, {
              managersCount: {},
              addedCount: 0,
              exportedCount: 0,
              total: 0,
            });
          }
          const sData = sectionDataMap.get(section)!;
          sData.total++;
          if (isAdded) sData.addedCount++;
          if (isExported) sData.exportedCount++;
          if (mgrName && !/^\d+$/.test(mgrName)) {
            sData.managersCount[mgrName] = (sData.managersCount[mgrName] || 0) + 1;
          }
        }

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

      // Collect Working Groups Sets for KAM and Content
      const kamCompletedGroups = new Set<string>();
      const kamInWorkGroups = new Set<string>();
      for (const r of workingKamRawRows) {
        const g3 = cleanStr(r[1]);
        const status = cleanStr(r[6]);
        if (g3) {
          if (status.includes('Выполнен') || status.includes('Выполнено')) {
            kamCompletedGroups.add(g3);
          } else if (status.includes('работе') || status.includes('процесс')) {
            kamInWorkGroups.add(g3);
          }
        }
      }

      const contentCompletedGroups = new Set<string>();
      for (const r of workingContentRawRows) {
        const g3 = cleanStr(r[1]);
        const status = cleanStr(r[6]);
        if (g3 && (status.includes('Выполнен') || status.includes('Выполнено'))) {
          contentCompletedGroups.add(g3);
        }
      }

      // Preserve any locally uploaded custom files that are not present in Google Sheets
      const currentProducts = storageService.getProducts();
      const existingGoogleCodes = new Set(
        [...contentProducts, ...kamProducts].map(p => `${p.department}_${p.externalCode}_${p.sourceFile}`)
      );
      const customLocalProducts = currentProducts.filter(
        p => !existingGoogleCodes.has(`${p.department}_${p.externalCode}_${p.sourceFile}`) && p.sourceFile && !p.id.startsWith('cnt-') && !p.id.startsWith('kam-')
      );

      const allMergedProducts = [...customLocalProducts, ...contentProducts, ...kamProducts];

      // Build product group stats
      const productGroupStats = new Map<string, {
        skuCount: number;
        startDate: string;
        releaseDate: string;
        doneCount: number;
        inWorkCount: number;
      }>();

      for (const p of allMergedProducts) {
        const g3 = p.group3;
        if (!g3) continue;
        if (!productGroupStats.has(g3)) {
          productGroupStats.set(g3, {
            skuCount: 0,
            startDate: '',
            releaseDate: '',
            doneCount: 0,
            inWorkCount: 0,
          });
        }
        const item = productGroupStats.get(g3)!;
        item.skuCount++;
        if (!item.startDate && (p.dateTaken || p.dateUploaded)) {
          item.startDate = p.dateTaken || p.dateUploaded;
        }
        if (!item.releaseDate && (p.dateCompleted || p.dateFinished)) {
          item.releaseDate = p.dateCompleted || p.dateFinished;
        }
        if (p.status.includes('Выполнен') || p.status.includes('Выполнено')) {
          item.doneCount++;
        }
        if (p.status.includes('В работе') || p.status.includes('работе')) {
          item.inWorkCount++;
        }
      }

      // Parse Groups from GID 0
      const groupsRows = groupsRes ? parseCSV(groupsRes).slice(1) : [];
      let finalCategoryGroups: CategoryGroup[] = [];

      if (groupsRows.length > 0) {
        for (let i = 0; i < groupsRows.length; i++) {
          const r = groupsRows[i];
          if (!r || r.every(cell => !cleanStr(cell))) continue;
          const g3 = cleanStr(r[2]);
          if (!g3) continue;

          finalCategoryGroups.push({
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

      if (finalCategoryGroups.length === 0) {
        finalCategoryGroups = storageService.getCategoryGroups();
      }

      // Parse Site Order from GID 442661295
      const orderRows = orderRes ? parseCSV(orderRes) : [];
      let currentGroup1 = '';
      let currentGroup2Cols: string[] = [];
      const parsedOrders: GroupOrderItem[] = [];

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

      // Update storage and indexedDB
      storageService.saveProducts(allMergedProducts);
      storageService.saveTasks(tasks);
      storageService.saveCategoryGroups(finalCategoryGroups);
      if (parsedOrders.length > 0) {
        storageService.saveGroupOrders(parsedOrders);
      }
      if (contacts.length > 0) {
        storageService.saveContacts(contacts);
      }

      // Preserve and merge locally added new products with Google Sheets
      const currentLocalNewProducts = storageService.getNewProducts();
      let mergedNewProducts: NewProductItem[] = [];

      if (newProductItems.length > 0) {
        const googleCodes = new Set(
          newProductItems.map(it => (it.externalCode || '').trim().toLowerCase()).filter(Boolean)
        );

        // Keep local items whose externalCode is not yet in Google Sheets
        const unSyncedLocalItems = currentLocalNewProducts.filter(loc => {
          const code = (loc.externalCode || '').trim().toLowerCase();
          return code && !googleCodes.has(code);
        });

        mergedNewProducts = [...unSyncedLocalItems, ...newProductItems];
      } else {
        mergedNewProducts = currentLocalNewProducts;
      }

      if (mergedNewProducts.length > 0) {
        storageService.saveNewProducts(mergedNewProducts);
      }

      // Save to IndexedDB
      await Promise.all([
        idb.setAll('products', allMergedProducts),
        idb.setAll('tasks', tasks),
        idb.setAll('groups', finalCategoryGroups),
        parsedOrders.length > 0 ? idb.setAll('groupOrders', parsedOrders) : Promise.resolve(),
        contacts.length > 0 ? idb.setAll('contacts', contacts) : Promise.resolve(),
        idb.setAll('newProducts', mergedNewProducts),
        idb.putMetadata('last_sync', {
          time: new Date().toLocaleString('ru-RU'),
          contentCount: contentProducts.length,
          kamCount: kamProducts.length,
          tasksCount: tasks.length,
          groupsCount: finalCategoryGroups.length,
          newProductsCount: mergedNewProducts.length,
          contactsCount: contacts.length,
        }),
      ]);

      const now = new Date();
      const timeStr = `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
      this.lastSyncTime = timeStr;

      this.isSyncing = false;
      this.notify();

      return {
        success: true,
        contentCount: contentProducts.length,
        kamCount: kamProducts.length,
        tasksCount: tasks.length,
        groupsCount: finalCategoryGroups.length,
        newProductsCount: newProductItems.length,
        contactsCount: contacts.length,
        timestamp: timeStr,
      };
    } catch (err: any) {
      console.error('Google Sheets sync error:', err);
      this.isSyncing = false;
      this.notify();
      return {
        success: false,
        contentCount: 0,
        kamCount: 0,
        tasksCount: 0,
        groupsCount: 0,
        newProductsCount: 0,
        contactsCount: 0,
        timestamp: this.lastSyncTime || '',
        error: err.message || 'Ошибка синхронизации',
      };
    }
  }
}

export const googleSheetsService = new GoogleSheetsService();
