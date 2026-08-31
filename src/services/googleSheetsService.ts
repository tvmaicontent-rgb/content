import { ProductItem, TaskItem, CategoryGroup, GroupOrderItem, NewProductItem, SupplierContact, DepartmentType } from '../types';
import { idb } from './indexedDbService';
import { storageService } from './storageService';
import { authService } from './authService';

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
  source?: string;
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
    // Also save to server if admin
    if (authService.isAdmin()) {
      authService.fetchWithAuth('/api/sheets/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl: this.webhookUrl }),
      }).catch(() => {});
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

  /**
   * Test webhook connection securely via server proxy
   */
  async testWebhook(targetUrl?: string): Promise<{ success: boolean; message: string; spreadsheetName?: string }> {
    const url = (targetUrl !== undefined ? targetUrl : this.webhookUrl).trim();

    try {
      const res = await authService.fetchWithAuth('/api/sheets/test-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl: url }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        return {
          success: true,
          message: data.message || 'Связь с Google Apps Script активна',
          spreadsheetName: data.spreadsheetName,
        };
      }
      return {
        success: false,
        message: data.message || data.error || 'Ошибка связи с Google Apps Script',
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Ошибка соединения с сервером: ${err.message}`,
      };
    }
  }

  /**
   * Main Synchronization method: Requests server proxy with Bearer authentication
   */
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
      // Secure call through server with Bearer auth header
      const res = await authService.fetchWithAuth('/api/sheets/sync');
      if (!res.ok && res.status !== 304) {
        const errorJson = await res.json().catch(() => ({}));
        throw new Error(errorJson.error || `HTTP ${res.status} при обращении к серверному прокси`);
      }

      const data = await res.json();
      if (!data || data.success === false) {
        throw new Error(data?.error || 'Сервер не вернул данные');
      }

      const contentProducts: ProductItem[] = data.contentProducts || [];
      const kamProducts: ProductItem[] = data.kamProducts || [];
      const tasks: TaskItem[] = data.tasks || [];
      const categoryGroups: CategoryGroup[] = data.groups || [];
      const groupOrders: GroupOrderItem[] = data.groupOrders || [];
      const contacts: SupplierContact[] = data.contacts || [];
      const newProducts: NewProductItem[] = data.newProducts || [];

      // Preserve any locally uploaded custom files not yet on Google Sheets
      const currentProducts = storageService.getProducts();
      const existingGoogleCodes = new Set(
        [...contentProducts, ...kamProducts].map(p => `${p.department}_${p.externalCode}_${p.sourceFile}`)
      );
      const customLocalProducts = currentProducts.filter(
        p => !existingGoogleCodes.has(`${p.department}_${p.externalCode}_${p.sourceFile}`) && p.sourceFile && !p.id.startsWith('cnt-') && !p.id.startsWith('kam-')
      );

      const allMergedProducts = [...customLocalProducts, ...contentProducts, ...kamProducts];

      // Update storage and indexedDB
      storageService.saveProducts(allMergedProducts);
      storageService.saveTasks(tasks);
      if (categoryGroups.length > 0) {
        storageService.saveCategoryGroups(categoryGroups);
      }
      if (groupOrders.length > 0) {
        storageService.saveGroupOrders(groupOrders);
      }
      if (contacts.length > 0) {
        storageService.saveContacts(contacts);
      }

      // Preserve local new products
      const currentLocalNewProducts = storageService.getNewProducts();
      let mergedNewProducts: NewProductItem[] = [];
      if (newProducts.length > 0) {
        const googleCodes = new Set(
          newProducts.map(it => (it.externalCode || '').trim().toLowerCase()).filter(Boolean)
        );
        const unSyncedLocalItems = currentLocalNewProducts.filter(loc => {
          const code = (loc.externalCode || '').trim().toLowerCase();
          return code && !googleCodes.has(code);
        });
        mergedNewProducts = [...unSyncedLocalItems, ...newProducts];
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
        categoryGroups.length > 0 ? idb.setAll('groups', categoryGroups) : Promise.resolve(),
        groupOrders.length > 0 ? idb.setAll('groupOrders', groupOrders) : Promise.resolve(),
        contacts.length > 0 ? idb.setAll('contacts', contacts) : Promise.resolve(),
        mergedNewProducts.length > 0 ? idb.setAll('newProducts', mergedNewProducts) : Promise.resolve(),
        idb.putMetadata('last_sync', {
          time: data.timestamp || new Date().toLocaleString('ru-RU'),
          contentCount: contentProducts.length,
          kamCount: kamProducts.length,
          tasksCount: tasks.length,
          groupsCount: categoryGroups.length,
          newProductsCount: mergedNewProducts.length,
          contactsCount: contacts.length,
          source: data.source || 'Server Proxy',
        }),
      ]);

      this.lastSyncTime = data.timestamp || new Date().toLocaleString('ru-RU');
      this.isSyncing = false;
      this.notify();

      return {
        success: true,
        contentCount: contentProducts.length,
        kamCount: kamProducts.length,
        tasksCount: tasks.length,
        groupsCount: categoryGroups.length,
        newProductsCount: mergedNewProducts.length,
        contactsCount: contacts.length,
        timestamp: this.lastSyncTime,
        source: data.source || 'Server Proxy',
      };
    } catch (err: any) {
      console.error('Secure syncAll error:', err);
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
        error: err.message || 'Ошибка синхронизации через сервер',
      };
    }
  }

  /**
   * Push product status updates through server proxy
   */
  async pushProductStatusUpdate(
    files: string[],
    department: DepartmentType,
    updates: Partial<ProductItem>,
    externalCodes?: string[]
  ): Promise<boolean> {
    const title = `Обновление статуса: ${updates.status || 'изменения'}`;
    const details = `${department} — файлов: ${files.length} (${files.slice(0, 2).join(', ')}${files.length > 2 ? '...' : ''})`;
    const logId = this.addLog(title, details, 'pending');

    try {
      const res = await authService.fetchWithAuth('/api/sheets/push-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          department,
          files,
          updates,
          externalCodes,
          webhookUrl: this.webhookUrl,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        this.updateLog(logId, 'success', `${details} — отправлено через сервер в Google Sheets`);
        return true;
      } else {
        this.updateLog(logId, 'error', `${details} — ${data.error || 'ошибка сервера'}`);
        return false;
      }
    } catch (err: any) {
      this.updateLog(logId, 'error', `${details} — ${err.message || 'ошибка сети'}`);
      return false;
    }
  }

  /**
   * Push category group updates through server proxy
   */
  async pushGroupUpdate(group3: string, updates: Partial<CategoryGroup>): Promise<boolean> {
    const title = `Обновление группы: ${group3}`;
    const details = `Менеджер: ${updates.manager || '—'}, Файл КАМ: ${updates.kamFile || '—'}`;
    const logId = this.addLog(title, details, 'pending');

    try {
      const res = await authService.fetchWithAuth('/api/sheets/push-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group3,
          updates,
          webhookUrl: this.webhookUrl,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        this.updateLog(logId, 'success', `${details} — синхронизировано с Google Sheets`);
        return true;
      } else {
        this.updateLog(logId, 'error', `${details} — ${data.error || 'ошибка сервера'}`);
        return false;
      }
    } catch (err: any) {
      this.updateLog(logId, 'error', `${details} — ${err.message || 'ошибка сети'}`);
      return false;
    }
  }

  /**
   * Push task updates through server proxy
   */
  async pushTaskUpdate(task: TaskItem): Promise<boolean> {
    const title = `Сохранение задачи: #${task.id} ${task.title}`;
    const details = `Статус: ${task.status}, Срочность: ${task.urgency}`;
    const logId = this.addLog(title, details, 'pending');

    try {
      const res = await authService.fetchWithAuth('/api/sheets/push-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task,
          action: 'updateTask',
          webhookUrl: this.webhookUrl,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        this.updateLog(logId, 'success', `${details} — сохранено в Google Sheets`);
        return true;
      } else {
        this.updateLog(logId, 'error', `${details} — ${data.error || 'ошибка сервера'}`);
        return false;
      }
    } catch (err: any) {
      this.updateLog(logId, 'error', `${details} — ${err.message || 'ошибка сети'}`);
      return false;
    }
  }

  /**
   * Push task deletion through server proxy
   */
  async pushTaskDelete(id: string): Promise<boolean> {
    const title = `Удаление задачи: #${id}`;
    const details = `Удалена из списка`;
    const logId = this.addLog(title, details, 'pending');

    try {
      const res = await authService.fetchWithAuth('/api/sheets/push-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: id,
          action: 'deleteTask',
          webhookUrl: this.webhookUrl,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        this.updateLog(logId, 'success', `${details} — удалено из Google Sheets`);
        return true;
      } else {
        this.updateLog(logId, 'error', `${details} — ${data.error || 'ошибка'}`);
        return false;
      }
    } catch (err: any) {
      this.updateLog(logId, 'error', `${details} — ${err.message || 'ошибка сети'}`);
      return false;
    }
  }

  /**
   * Push department products batch through server proxy
   */
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

    try {
      const res = await authService.fetchWithAuth('/api/sheets/push-products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          department,
          products,
          webhookUrl: this.webhookUrl,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        this.updateLog(logId, 'success', `${details} — выгружено в Google Sheets`);
        return {
          success: true,
          message: data.message || `Успешно выгружено ${products.length} SKU в Google Таблицу (лист «${targetSheetName}»)!`,
          count: products.length,
        };
      } else {
        this.updateLog(logId, 'error', `${details} — ${data.error || 'ошибка сервера'}`);
        return {
          success: false,
          message: data.error || 'Ошибка при отправке в Google Sheets через сервер',
          count: 0,
        };
      }
    } catch (err: any) {
      this.updateLog(logId, 'error', `${details} — ${err.message || 'ошибка сети'}`);
      return {
        success: false,
        message: err.message || 'Сетевая ошибка при отправке через сервер',
        count: 0,
      };
    }
  }

  /**
   * Push new products batch through server proxy
   */
  async pushNewProductsBatch(
    items: NewProductItem[],
    batchTitle?: string
  ): Promise<{ success: boolean; message: string; count: number }> {
    const title = batchTitle || (items[0]?.batchTitle || items[0]?.batchFile || `Партия от ${new Date().toLocaleDateString('ru-RU')}`);
    const details = `Новые товары: ${items.length} SKU (${title})`;
    const logId = this.addLog(`Отправка партии в Google Sheets`, details, 'pending');

    try {
      const res = await authService.fetchWithAuth('/api/sheets/push-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchTitle: title,
          items,
          webhookUrl: this.webhookUrl,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        this.updateLog(logId, 'success', `${details} — записано в лист «Новые товары»`);
        return {
          success: true,
          message: data.message || `Успешно отправлено ${items.length} SKU в Google Таблицу (лист «Новые товары»)`,
          count: items.length,
        };
      } else {
        this.updateLog(logId, 'error', `${details} — ${data.error || 'ошибка'}`);
        return {
          success: false,
          message: data.error || 'Ошибка при отправке в Google Sheets через сервер',
          count: 0,
        };
      }
    } catch (err: any) {
      this.updateLog(logId, 'error', `${details} — ${err.message || 'ошибка сети'}`);
      return {
        success: false,
        message: err.message || 'Сетевая ошибка при обращении к серверу',
        count: 0,
      };
    }
  }

  /**
   * Push all new products batch alias
   */
  async pushAllNewProducts(items: NewProductItem[], batchTitle?: string) {
    return this.pushNewProductsBatch(items, batchTitle);
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
}

export const googleSheetsService = new GoogleSheetsService();
