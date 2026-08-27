import { ProductItem, TaskItem, CategoryGroup, NewProductItem, SupplierContact } from '../types';
import {
  SPREADSHEET_URL,
  KAM_SPREADSHEET_URL,
  TASKS_SPREADSHEET_URL,
  NEW_PRODUCTS_SPREADSHEET_URL,
  CONTACTS_SPREADSHEET_URL,
  MANAGERS_SPREADSHEET_URL,
  WORKING_GROUPS_CONTENT_URL,
  WORKING_GROUPS_KAM_URL,
  GROUPS_SPREADSHEET_URL,
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

export class GoogleSheetsService {
  private isSyncing = false;
  private lastSyncTime: string | null = null;
  private listeners: Array<() => void> = [];

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
      const groupsGid = getGidFromUrl(GROUPS_SPREADSHEET_URL, '0');

      const contentExportUrl = `https://docs.google.com/spreadsheets/d/1vCZQgzBPv8uahr8ckRI1f-TA_QS6Afz2B9NP_ZMj6ek/export?format=csv&gid=${contentGid}`;
      const kamExportUrl = `https://docs.google.com/spreadsheets/d/1vCZQgzBPv8uahr8ckRI1f-TA_QS6Afz2B9NP_ZMj6ek/export?format=csv&gid=${kamGid}`;
      const tasksExportUrl = `https://docs.google.com/spreadsheets/d/1vCZQgzBPv8uahr8ckRI1f-TA_QS6Afz2B9NP_ZMj6ek/export?format=csv&gid=${tasksGid}`;
      const newProductsExportUrl = `https://docs.google.com/spreadsheets/d/1vCZQgzBPv8uahr8ckRI1f-TA_QS6Afz2B9NP_ZMj6ek/export?format=csv&gid=${newProductsGid}`;
      const contactsExportUrl = `https://docs.google.com/spreadsheets/d/1vCZQgzBPv8uahr8ckRI1f-TA_QS6Afz2B9NP_ZMj6ek/export?format=csv&gid=${contactsGid}`;
      const managersExportUrl = `https://docs.google.com/spreadsheets/d/1vCZQgzBPv8uahr8ckRI1f-TA_QS6Afz2B9NP_ZMj6ek/export?format=csv&gid=${managersGid}`;
      const workingKamExportUrl = `https://docs.google.com/spreadsheets/d/1vCZQgzBPv8uahr8ckRI1f-TA_QS6Afz2B9NP_ZMj6ek/export?format=csv&gid=${workingKamGid}`;
      const workingContentExportUrl = `https://docs.google.com/spreadsheets/d/1vCZQgzBPv8uahr8ckRI1f-TA_QS6Afz2B9NP_ZMj6ek/export?format=csv&gid=${workingContentGid}`;
      const groupsExportUrl = `https://docs.google.com/spreadsheets/d/1LABW3U4TdX6cDjps_g_mBBsWRW8_Xx7W8LqBZB4CO2g/export?format=csv&gid=${groupsGid}`;

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

      // Process Category Groups directly from authoritative GROUPS_SPREADSHEET_URL
      let updatedCategoryGroups: CategoryGroup[] = [];
      if (groupsRes && groupsRes.trim().length > 50) {
        const groupRows = parseCSV(groupsRes).slice(1);
        if (groupRows.length > 0) {
          updatedCategoryGroups = groupRows.map((r, i) => {
            let kam = cleanStr(r[14]);
            if (kam.toLowerCase() === 'не добавлено') kam = 'Не добавлено';
            if (kam.toLowerCase() === 'добавлено') kam = 'Добавлено';
            if (kam.toLowerCase() === 'нет товаров') kam = 'Нет товаров';
            if (kam.toLowerCase() === 'только группа') kam = 'Только группа';

            let mgr = cleanStr(r[3]);
            if (mgr === 'Волчёк') mgr = 'Волчек';

            return {
              id: `grp-${i + 1}`,
              group1: cleanStr(r[0]),
              group2: cleanStr(r[1]),
              group3: cleanStr(r[2]),
              manager: mgr,
              includedMaterik: cleanStr(r[4]),
              includedPalas: cleanStr(r[5]),
              skuCount: cleanStr(r[6]),
              startDate: cleanStr(r[7]),
              donorRequestDate: cleanStr(r[8]),
              donorReceivedDate: cleanStr(r[9]),
              approvalSentDate: cleanStr(r[10]),
              approvalDate: cleanStr(r[11]),
              releaseDate: cleanStr(r[12]),
              palasAllocated: cleanStr(r[13]),
              kamFile: kam,
            };
          });
        }
      }

      // If groups sheet was unavailable, fallback to current memory groups
      if (updatedCategoryGroups.length === 0) {
        updatedCategoryGroups = storageService.getCategoryGroups();
      }

      // Update storage and indexedDB
      storageService.saveProducts(allMergedProducts);
      storageService.saveTasks(tasks);
      storageService.saveCategoryGroups(updatedCategoryGroups);
      if (contacts.length > 0) {
        storageService.saveContacts(contacts);
      }
      if (newProductItems.length > 0) {
        storageService.saveNewProducts(newProductItems);
      }

      // Save to IndexedDB
      await Promise.all([
        idb.setAll('products', allMergedProducts),
        idb.setAll('tasks', tasks),
        idb.setAll('groups', updatedCategoryGroups),
        contacts.length > 0 ? idb.setAll('contacts', contacts) : Promise.resolve(),
        idb.setAll('newProducts', newProductItems),
        idb.putMetadata('last_sync', {
          time: new Date().toLocaleString('ru-RU'),
          contentCount: contentProducts.length,
          kamCount: kamProducts.length,
          tasksCount: tasks.length,
          newProductsCount: newProductItems.length,
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
        groupsCount: updatedCategoryGroups.length,
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
