import { ProductItem, TaskItem, CategoryGroup, NewProductItem, DepartmentType } from '../types';
import { idb } from './indexedDbService';
import { storageService } from './storageService';
import { authFetch } from '../utils/auth';

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
  private webhookConfigured: boolean | null = null;
  private pushLogs: PushLogItem[] = [];
  private autoSyncInterval: any = null;

  getWebhookUrl(): string {
    return this.webhookConfigured ? 'configured' : '';
  }

  setWebhookUrl(_url: string): void {
    // Webhook URL is configured on the server via GOOGLE_SHEETS_WEBHOOK_URL
  }

  clearWebhookUrl(): void {
    this.webhookConfigured = false;
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

  async refreshWebhookStatus(): Promise<boolean> {
    try {
      const res = await authFetch('/api/sheets/status');
      const json = await res.json().catch(() => null);
      this.webhookConfigured = Boolean(json?.webhookConfigured);
      this.notify();
      return this.webhookConfigured;
    } catch {
      this.webhookConfigured = false;
      this.notify();
      return false;
    }
  }

  async testWebhook(_targetUrl?: string): Promise<{ success: boolean; message: string; spreadsheetName?: string }> {
    try {
      const proxyRes = await authFetch('/api/sheets/webhook-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: { action: 'ping' } }),
      });
      const pJson = await proxyRes.json().catch(() => null);
      if (proxyRes.ok && pJson && pJson.success) {
        this.webhookConfigured = true;
        this.notify();
        return {
          success: true,
          message: pJson.message || 'Связь с Google Таблицей активна',
          spreadsheetName: pJson.spreadsheetName,
        };
      }
      this.webhookConfigured = false;
      this.notify();
      return {
        success: false,
        message: pJson?.error || 'Webhook не настроен на сервере или недоступен',
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Не удалось связаться со скриптом: ${err.message || 'проверьте сервер'}`,
      };
    }
  }

  private async dispatchWebhook(payload: any): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      const proxyRes = await authFetch('/api/sheets/webhook-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload }),
      });
      const resJson = await proxyRes.json().catch(() => null);
      if (proxyRes.ok && resJson && resJson.success) {
        this.webhookConfigured = true;
        return { success: true, message: resJson.message || 'Успешно отправлено' };
      }
      return { success: false, error: resJson?.error || 'Ошибка отправки в Google Sheets' };
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
    }
    this.updateLog(logId, 'error', `${details} — ${res.error || 'ошибка отправки'}`);
    return false;
  }

  async pushGroupUpdate(group3: string, updates: Partial<CategoryGroup>): Promise<boolean> {
    const title = `Обновление группы: ${group3}`;
    const details = `Менеджер: ${updates.manager || '—'}, Файл КАМ: ${updates.kamFile || '—'}`;
    const logId = this.addLog(title, details, 'pending');

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
    }
    this.updateLog(logId, 'error', `${details} — ${res.error || 'ошибка отправки'}`);
    return false;
  }

  async pushTaskUpdate(task: TaskItem): Promise<boolean> {
    const title = `Сохранение задачи: #${task.id} ${task.title}`;
    const details = `Статус: ${task.status}, Срочность: ${task.urgency}`;
    const logId = this.addLog(title, details, 'pending');

    const payload = {
      action: 'updateTask',
      task,
      timestamp: new Date().toISOString(),
    };

    const res = await this.dispatchWebhook(payload);
    if (res.success) {
      this.updateLog(logId, 'success', `${details} — отправлено в Google Sheets`);
      return true;
    }
    this.updateLog(logId, 'error', `${details} — ${res.error || 'ошибка отправки'}`);
    return false;
  }

  async pushTaskDelete(id: string): Promise<boolean> {
    const title = `Удаление задачи: #${id}`;
    const details = `Удалена из списка`;
    const logId = this.addLog(title, details, 'pending');

    const payload = {
      action: 'deleteTask',
      id,
      timestamp: new Date().toISOString(),
    };

    const res = await this.dispatchWebhook(payload);
    if (res.success) {
      this.updateLog(logId, 'success', `${details} — отправлено в Google Sheets`);
      return true;
    }
    this.updateLog(logId, 'error', `${details} — ${res.error || 'ошибка отправки'}`);
    return false;
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
    }

    this.updateLog(logId, 'error', `${details} — ${lastError || 'ошибка отправки'}`);
    return {
      success: false,
      message: lastError || 'Ошибка при отправке в Google Sheets',
      count: 0,
    };
  }

  async pushNewProductsBatch(
    items: NewProductItem[],
    batchTitle?: string
  ): Promise<{ success: boolean; message: string; count: number }> {
    const title = batchTitle || (items[0]?.batchTitle || items[0]?.batchFile || `Партия от ${new Date().toLocaleDateString('ru-RU')}`);
    const details = `Новые товары: ${items.length} SKU (${title})`;
    const logId = this.addLog(`Отправка партии в Google Sheets`, details, 'pending');

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
    }

    this.updateLog(logId, 'error', `${details} — ${res.error || 'ошибка отправки'}`);
    return {
      success: false,
      message: res.error || 'Ошибка при отправке запроса в Google Apps Script Webhook.',
      count: 0,
    };
  }

  async pushAllNewProducts(
    items: NewProductItem[]
  ): Promise<{ success: boolean; message: string; count: number }> {
    const details = `Синхронизация всех партий: ${items.length} SKU`;
    const logId = this.addLog(`Полная выгрузка партий в Google Sheets`, details, 'pending');

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
    }

    this.updateLog(logId, 'error', `Ошибка отправки партий: ${lastError}`);
    return {
      success: false,
      message: lastError || 'Ошибка при отправке в Google Sheets.',
      count: 0,
    };
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
      const res = await authFetch('/api/sync-sheets');
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }

      const contentProducts: ProductItem[] = data.contentProducts || [];
      const kamProducts: ProductItem[] = data.kamProducts || [];
      const tasks: TaskItem[] = data.tasks || [];
      const sheetGroups: CategoryGroup[] = data.groups || [];
      const parsedOrders = data.groupOrders || [];
      const contacts = data.contacts || [];
      const newProductItems: NewProductItem[] = data.newProducts || [];

      const currentProducts = storageService.getProducts();
      const existingGoogleCodes = new Set(
        [...contentProducts, ...kamProducts].map(p => `${p.department}_${p.externalCode}_${p.sourceFile}`)
      );
      const customLocalProducts = currentProducts.filter(
        p =>
          !existingGoogleCodes.has(`${p.department}_${p.externalCode}_${p.sourceFile}`) &&
          p.sourceFile &&
          !p.id.startsWith('cnt-') &&
          !p.id.startsWith('kam-')
      );

      const allMergedProducts = [...customLocalProducts, ...contentProducts, ...kamProducts];
      const finalCategoryGroups = sheetGroups.length > 0 ? sheetGroups : storageService.getCategoryGroups();

      storageService.saveProducts(allMergedProducts);
      storageService.saveTasks(tasks);
      storageService.saveCategoryGroups(finalCategoryGroups);
      if (parsedOrders.length > 0) {
        storageService.saveGroupOrders(parsedOrders);
      }
      if (contacts.length > 0) {
        storageService.saveContacts(contacts);
      }

      const currentLocalNewProducts = storageService.getNewProducts();
      let mergedNewProducts: NewProductItem[] = [];

      if (newProductItems.length > 0) {
        const googleCodes = new Set(
          newProductItems.map(it => (it.externalCode || '').trim().toLowerCase()).filter(Boolean)
        );
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

      const timeStr = data.lastSyncTime || new Date().toLocaleString('ru-RU');
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
