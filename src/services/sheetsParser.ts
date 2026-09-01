import {
  ProductItem,
  TaskItem,
  CategoryGroup,
  GroupOrderItem,
  NewProductItem,
  SupplierContact,
  DepartmentType,
} from '../types';
import { MANAGERS_DICT } from '../constants';

export function parseCSV(text: string): string[][] {
  const lines: string[][] = [];
  let row: string[] = [];
  let inQuotes = false;
  let field = '';

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

function parseProducts(csv: string, department: DepartmentType, idPrefix: string): ProductItem[] {
  const rows = parseCSV(csv).slice(1);
  return rows
    .filter(r => r && r.some(cell => cleanStr(cell).length > 0))
    .map((r, idx) => {
      const rawId = cleanStr(r[0]);
      const externalCode = cleanStr(r[1]);
      const group3 = cleanStr(r[2]);
      const title = cleanStr(r[3]);
      const dateUploaded = cleanStr(r[12]) || cleanStr(r[8]) || '';
      const sourceFile =
        cleanStr(r[11]) ||
        (dateUploaded ? `Партия от ${dateUploaded}` : rawId ? `Файл ${rawId}` : 'Google Sheets');

      return {
        id: `${idPrefix}-${rawId || idx + 1}`,
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
        department,
      };
    })
    .filter(p => p.externalCode || p.title || p.group3);
}

function parseTasks(csv: string): TaskItem[] {
  return parseCSV(csv)
    .slice(1)
    .map((r, idx) => ({
      id: cleanStr(r[0]) || String(idx + 1),
      title: cleanStr(r[1]),
      description: cleanStr(r[2]),
      executors: cleanStr(r[3]),
      status: (cleanStr(r[4]) || 'Новая') as TaskItem['status'],
      urgency: (cleanStr(r[5]) || 'Текущая задача') as TaskItem['urgency'],
      imageBase64: cleanStr(r[6]),
      createdAt: cleanStr(r[7]),
      updatedAt: cleanStr(r[8]),
    }));
}

function parseContacts(csv: string): SupplierContact[] {
  if (!csv) return [];
  return parseCSV(csv)
    .slice(1)
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
}

function parseManagersDict(csv: string): Record<string, string> {
  const dict: Record<string, string> = { ...MANAGERS_DICT };
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

function parseNewProducts(csv: string, managersDict: Record<string, string>): NewProductItem[] {
  const newProductRawRows = parseCSV(csv);
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

  return newProductItems;
}

function parseGroups(csv: string): CategoryGroup[] {
  if (!csv) return [];
  const groupsRows = parseCSV(csv).slice(1);
  const groups: CategoryGroup[] = [];

  for (let i = 0; i < groupsRows.length; i++) {
    const r = groupsRows[i];
    if (!r || r.every(cell => !cleanStr(cell))) continue;
    const g3 = cleanStr(r[2]);
    if (!g3) continue;

    groups.push({
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

  return groups;
}

function parseSiteOrder(csv: string): GroupOrderItem[] {
  if (!csv) return [];
  const orderRows = parseCSV(csv);
  let currentGroup1 = '';
  let currentGroup2Cols: string[] = [];
  const parsedOrders: GroupOrderItem[] = [];

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

  return parsedOrders;
}

export interface ParsedSheetsData {
  contentProducts: ProductItem[];
  kamProducts: ProductItem[];
  products: ProductItem[];
  tasks: TaskItem[];
  groups: CategoryGroup[];
  groupOrders: GroupOrderItem[];
  newProducts: NewProductItem[];
  contacts: SupplierContact[];
}

export interface RawSheetCsvs {
  content: string;
  kam: string;
  tasks: string;
  newProducts: string;
  contacts: string;
  managers: string;
  groups: string;
  siteOrder: string;
}

export function parseSheetsData(csvs: RawSheetCsvs): ParsedSheetsData {
  const managersDict = parseManagersDict(csvs.managers);
  const contentProducts = parseProducts(csvs.content, 'Отдел контента', 'cnt');
  const kamProducts = parseProducts(csvs.kam, 'Коммерческий отдел', 'kam');

  return {
    contentProducts,
    kamProducts,
    products: [...contentProducts, ...kamProducts],
    tasks: parseTasks(csvs.tasks),
    groups: parseGroups(csvs.groups),
    groupOrders: parseSiteOrder(csvs.siteOrder),
    newProducts: parseNewProducts(csvs.newProducts, managersDict),
    contacts: parseContacts(csvs.contacts),
  };
}
