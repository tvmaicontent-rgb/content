import React, { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import { NewProductItem } from '../../types';
import { storageService } from '../../services/storageService';
import { googleSheetsService } from '../../services/googleSheetsService';
import { parseNewProductsBatchFile, exportToExcel } from '../../services/excelService';
import { formatCurrentDate, NEW_PRODUCTS_SPREADSHEET_URL } from '../../constants';
import { SortHeader } from '../common/SortHeader';
import { SortConfig, sortData } from '../../utils/sortUtils';
import { UploadCloud, FileSpreadsheet, Download, Printer, Layers, Eye, Search, RefreshCw, ExternalLink, CheckCircle2 } from 'lucide-react';

interface NewProductsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NewProductsModal: React.FC<NewProductsModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'view' | 'summary' | 'upload'>('view');
  const [items, setItems] = useState<NewProductItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [selectedBatchKey, setSelectedBatchKey] = useState<string>('');
  const [selectedSummaryDate, setSelectedSummaryDate] = useState<string>('Все партии');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showPrintView, setShowPrintView] = useState(false);
  const [batchSortConfig, setBatchSortConfig] = useState<SortConfig<NewProductItem>>({
    key: '',
    direction: null,
  });
  const [pivotSortConfig, setPivotSortConfig] = useState<SortConfig<{ manager: string; section: string; count: number }>>({
    key: '',
    direction: null,
  });

  const getBatchKey = (i: NewProductItem) =>
    i.batchTitle || (i.batchDate ? `📅 ${i.batchDate} (${i.batchFile || 'Партия'})` : (i.batchFile || 'Партия'));

  const loadData = () => {
    const data = storageService.getNewProducts();
    setItems(data);
    const uniqueBatches = Array.from(new Set(data.map(getBatchKey)));
    if (uniqueBatches.length > 0 && (!selectedBatchKey || !uniqueBatches.includes(selectedBatchKey))) {
      setSelectedBatchKey(uniqueBatches[0]);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
      const unsub = storageService.subscribe(loadData);
      return () => unsub();
    }
  }, [isOpen]);

  const handleSyncFromSheets = async () => {
    setIsSyncing(true);
    setSyncStatus('Загрузка партий из Google Sheets...');
    const res = await googleSheetsService.syncAll();
    setIsSyncing(false);
    if (res.success) {
      loadData();
      setSyncStatus(`Синхронизировано ${res.newProductsCount || storageService.getNewProducts().length} товаров в партиях!`);
      setTimeout(() => setSyncStatus(null), 4000);
    } else {
      setSyncStatus(`Ошибка: ${res.error || 'не удалось синхронизировать'}`);
      setTimeout(() => setSyncStatus(null), 5000);
    }
  };

  // Group by Batch
  const batchKeys = Array.from(new Set(items.map(getBatchKey)));

  // Handle files upload
  const handleFilesUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    setUploadProgress(10);
    setUploadStatus(`Чтение ${files.length} файл(ов)...`);

    try {
      const nowStr = formatCurrentDate(false);
      const allParsed: NewProductItem[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setUploadStatus(`Обработка: ${file.name} (${i + 1}/${files.length})`);
        const parsed = await parseNewProductsBatchFile(file, nowStr);
        allParsed.push(...parsed);
        setUploadProgress(10 + Math.floor(((i + 1) / files.length) * 80));
      }

      storageService.addNewProductsBatch(allParsed);
      setUploadProgress(100);
      setUploadStatus(`Успешно добавлено ${allParsed.length} товаров из ${files.length} файлов!`);
      loadData();
      setTimeout(() => {
        setUploading(false);
        setActiveTab('view');
      }, 1000);
    } catch (err: any) {
      setUploadStatus(`Ошибка: ${err.message || 'Сбой при чтении Excel'}`);
      setUploading(false);
    }
  };

  const handleBatchSort = (key: string) => {
    setBatchSortConfig(prev => {
      if (prev.key === key) {
        if (prev.direction === 'asc') return { key, direction: 'desc' };
        if (prev.direction === 'desc') return { key: '', direction: null };
        return { key, direction: 'asc' };
      }
      return { key, direction: 'asc' };
    });
  };

  const handlePivotSort = (key: string) => {
    setPivotSortConfig(prev => {
      if (prev.key === key) {
        if (prev.direction === 'asc') return { key, direction: 'desc' };
        if (prev.direction === 'desc') return { key: '', direction: null };
        return { key, direction: 'asc' };
      }
      return { key, direction: 'asc' };
    });
  };

  // Filter items for View Batch
  const rawBatchItems = items.filter(i => getBatchKey(i) === selectedBatchKey);
  const filteredBatchItems = rawBatchItems.filter(i => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      i.externalCode.toLowerCase().includes(q) ||
      i.title.toLowerCase().includes(q) ||
      i.sectionName.toLowerCase().includes(q) ||
      i.manager.toLowerCase().includes(q)
    );
  });
  const currentBatchItems: NewProductItem[] = sortData<NewProductItem>(filteredBatchItems, batchSortConfig);

  // Summary Pivot data
  const summarySourceItems =
    selectedSummaryDate === 'Все партии'
      ? items
      : items.filter(i => getBatchKey(i) === selectedSummaryDate);

  // Calculate Pivot (Manager x Group)
  const pivotMap = new Map<string, { manager: string; section: string; count: number }>();
  for (const it of summarySourceItems) {
    const mng = it.manager || 'Не указан';
    const sec = it.sectionName || 'Без группы';
    const key = `${mng}___${sec}`;

    if (!pivotMap.has(key)) {
      pivotMap.set(key, { manager: mng, section: sec, count: 0 });
    }
    pivotMap.get(key)!.count += 1;
  }

  const rawPivotList = Array.from(pivotMap.values());
  const pivotList: { manager: string; section: string; count: number }[] = pivotSortConfig.direction
    ? sortData<{ manager: string; section: string; count: number }>(rawPivotList, pivotSortConfig)
    : rawPivotList.sort((a, b) => {
        if (a.manager !== b.manager) return a.manager.localeCompare(b.manager);
        return a.section.localeCompare(b.section);
      });

  const totalSummarySku = pivotList.reduce((acc, row) => acc + row.count, 0);
  const uniqueManagers = new Set(pivotList.map(r => r.manager)).size;
  const uniqueSections = new Set(pivotList.map(r => r.section)).size;

  const handleExportPivotExcel = () => {
    const exportRows = pivotList.map(r => ({
      'Менеджер': r.manager,
      'Группа (Раздел)': r.section,
      'Количество SKU': r.count,
    }));
    exportToExcel(exportRows, `Сводная_новые_товары_${selectedSummaryDate.replace(/[^a-zA-Z0-9а-яА-Я]/g, '_')}.xlsx`, 'Сводная');
  };

  const handleExportBatchExcel = () => {
    const exportRows = currentBatchItems.map(r => ({
      'Внешний код': r.externalCode,
      'Наименование': r.title,
      'Менеджер': r.manager,
      'Код менеджера': r.managerCode,
      'Раздел (Группа 3)': r.sectionName,
      'Дата партии': r.batchDate,
      'Файл партии': r.batchFile,
    }));
    exportToExcel(exportRows, `Партия_${selectedBatchKey.replace(/[^a-zA-Z0-9а-яА-Я]/g, '_')}.xlsx`, 'Партия');
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="📦 Новые товары" maxWidth="6xl">
      <div className="space-y-4">
        {/* Navigation Tabs and Sync Controls */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between border-b border-slate-200 gap-2">
          <div className="flex overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => setActiveTab('view')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${
                activeTab === 'view'
                  ? 'border-sky-600 text-sky-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Eye className="w-4 h-4" />
              📋 Просмотр партий ({batchKeys.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('summary')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${
                activeTab === 'summary'
                  ? 'border-sky-600 text-sky-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Layers className="w-4 h-4" />
              📊 Сводная (Менеджер + Группа)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('upload')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${
                activeTab === 'upload'
                  ? 'border-sky-600 text-sky-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <UploadCloud className="w-4 h-4" />
              📥 Загрузить Excel
            </button>
          </div>

          <div className="flex items-center gap-2 pb-2 sm:pb-0">
            <button
              type="button"
              onClick={handleSyncFromSheets}
              disabled={isSyncing}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors border ${
                isSyncing
                  ? 'bg-sky-50 text-sky-500 border-sky-200 cursor-not-allowed'
                  : 'bg-sky-50 text-sky-700 hover:bg-sky-100 border-sky-200'
              }`}
              title="Синхронизировать партии напрямую с Google Sheets"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Загрузка...' : 'Синхронизация'}</span>
            </button>
            <a
              href={NEW_PRODUCTS_SPREADSHEET_URL}
              target="_blank"
              rel="noreferrer"
              className="px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg flex items-center gap-1 transition-colors"
              title="Открыть лист Новые товары в Google Таблице"
            >
              <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
              <span>Google Sheet</span>
            </a>
          </div>
        </div>

        {/* Sync Status Banner */}
        {syncStatus && (
          <div className="p-2.5 text-xs font-medium text-sky-900 bg-sky-50 border border-sky-200 rounded-lg flex items-center gap-2 animate-fadeIn">
            {syncStatus.startsWith('Ошибка') ? (
              <span className="text-rose-600 font-bold">⚠️</span>
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            )}
            <span>{syncStatus}</span>
          </div>
        )}

        {/* Tab 1: View Batches */}
        {activeTab === 'view' && (
          <div className="py-2 space-y-3">
            {batchKeys.length === 0 ? (
              <div className="p-8 text-center text-slate-500">Нет загруженных партий новых товаров.</div>
            ) : (
              <>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-slate-700">Партия:</span>
                    <select
                      value={selectedBatchKey}
                      onChange={e => setSelectedBatchKey(e.target.value)}
                      className="px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 max-w-md"
                    >
                      {batchKeys.map(bk => {
                        const count = items.filter(i => getBatchKey(i) === bk).length;
                        return (
                          <option key={bk} value={bk}>
                            {bk} ({count} SKU)
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Поиск по SKU, названию..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white w-48 sm:w-60 focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleExportBatchExcel}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg shadow-xs transition-colors"
                      title="Экспорт в Excel"
                    >
                      <Download className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Excel</span>
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-slate-600 px-1">
                  <span>
                    Показано: <strong className="text-slate-900">{currentBatchItems.length}</strong> из{' '}
                    <strong>{rawBatchItems.length}</strong> SKU в выбранной партии
                  </span>
                  <span>Всего по всем партиям: <strong className="text-blue-600">{items.length}</strong> SKU</span>
                </div>

                <div className="border border-slate-200 rounded-xl overflow-hidden max-h-[50vh] overflow-y-auto shadow-xs">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead className="bg-slate-100 text-slate-600 font-semibold uppercase sticky top-0 border-b border-slate-200 z-10">
                      <tr>
                        <th className="px-3 py-2.5 min-w-[120px]">
                          <SortHeader
                            label="Внешний код"
                            columnKey="externalCode"
                            currentSortKey={batchSortConfig.key}
                            currentDirection={batchSortConfig.direction}
                            onSort={handleBatchSort}
                          />
                        </th>
                        <th className="px-3 py-2.5 min-w-[220px]">
                          <SortHeader
                            label="Наименование"
                            columnKey="title"
                            currentSortKey={batchSortConfig.key}
                            currentDirection={batchSortConfig.direction}
                            onSort={handleBatchSort}
                          />
                        </th>
                        <th className="px-3 py-2.5 min-w-[130px]">
                          <SortHeader
                            label="Менеджер"
                            columnKey="manager"
                            currentSortKey={batchSortConfig.key}
                            currentDirection={batchSortConfig.direction}
                            onSort={handleBatchSort}
                          />
                        </th>
                        <th className="px-3 py-2.5 min-w-[80px]">
                          <SortHeader
                            label="Код"
                            columnKey="managerCode"
                            currentSortKey={batchSortConfig.key}
                            currentDirection={batchSortConfig.direction}
                            onSort={handleBatchSort}
                          />
                        </th>
                        <th className="px-3 py-2.5 min-w-[160px]">
                          <SortHeader
                            label="Раздел (Группа 3)"
                            columnKey="sectionName"
                            currentSortKey={batchSortConfig.key}
                            currentDirection={batchSortConfig.direction}
                            onSort={handleBatchSort}
                          />
                        </th>
                        <th className="px-3 py-2.5 min-w-[120px]">
                          <SortHeader
                            label="Дата партии"
                            columnKey="batchDate"
                            currentSortKey={batchSortConfig.key}
                            currentDirection={batchSortConfig.direction}
                            onSort={handleBatchSort}
                          />
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {currentBatchItems.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                            {searchQuery ? 'Ничего не найдено по запросу' : 'В этой партии нет товаров'}
                          </td>
                        </tr>
                      ) : (
                        currentBatchItems.map(item => (
                          <tr key={item.id} className="hover:bg-slate-50/70">
                            <td className="px-3 py-2 font-mono font-medium text-slate-900">{item.externalCode}</td>
                            <td className="px-3 py-2 font-medium text-slate-800">{item.title}</td>
                            <td className="px-3 py-2 text-slate-700">{item.manager}</td>
                            <td className="px-3 py-2 text-slate-500 font-mono">{item.managerCode || '—'}</td>
                            <td className="px-3 py-2 text-slate-600">{item.sectionName}</td>
                            <td className="px-3 py-2 text-slate-400 font-mono text-[11px]">{item.batchDate}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {/* Tab 2: Summary (Manager + Group) */}
        {activeTab === 'summary' && (
          <div className="py-2 space-y-4">
            {/* Filter and Top metrics */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-700">Фильтр по партии:</span>
                <select
                  value={selectedSummaryDate}
                  onChange={e => setSelectedSummaryDate(e.target.value)}
                  className="px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 max-w-md"
                >
                  <option value="Все партии">Все партии ({items.length} SKU)</option>
                  {batchKeys.map(bk => {
                    const count = items.filter(i => getBatchKey(i) === bk).length;
                    return (
                      <option key={bk} value={bk}>
                        {bk} ({count} SKU)
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportPivotExcel}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow-xs transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Экспорт сводки в Excel
                </button>
                <button
                  type="button"
                  onClick={() => setShowPrintView(!showPrintView)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg shadow-xs transition-colors"
                >
                  <Printer className="w-3.5 h-3.5 text-slate-500" />
                  {showPrintView ? 'Скрыть печать' : 'Печать'}
                </button>
              </div>
            </div>

            {/* Metrics cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                <div className="text-2xs uppercase tracking-wider text-slate-400 font-bold">Всего SKU</div>
                <div className="text-xl font-bold font-mono text-slate-900 mt-1">{totalSummarySku}</div>
              </div>
              <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                <div className="text-2xs uppercase tracking-wider text-slate-400 font-bold">Менеджеров</div>
                <div className="text-xl font-bold font-mono text-indigo-600 mt-1">{uniqueManagers}</div>
              </div>
              <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                <div className="text-2xs uppercase tracking-wider text-slate-400 font-bold">Групп / Разделов</div>
                <div className="text-xl font-bold font-mono text-blue-600 mt-1">{uniqueSections}</div>
              </div>
            </div>

            {/* Pivot Table */}
            <div className="border border-slate-200 rounded-xl overflow-hidden max-h-[50vh] overflow-y-auto shadow-xs">
              <table className="w-full text-xs text-left border-collapse">
                <thead className="bg-slate-100 text-slate-600 font-semibold uppercase sticky top-0 border-b border-slate-200 z-10">
                  <tr>
                    <th className="px-4 py-2.5 min-w-[160px]">
                      <SortHeader
                        label="Менеджер"
                        columnKey="manager"
                        currentSortKey={pivotSortConfig.key}
                        currentDirection={pivotSortConfig.direction}
                        onSort={handlePivotSort}
                      />
                    </th>
                    <th className="px-4 py-2.5 min-w-[220px]">
                      <SortHeader
                        label="Группа (Раздел)"
                        columnKey="section"
                        currentSortKey={pivotSortConfig.key}
                        currentDirection={pivotSortConfig.direction}
                        onSort={handlePivotSort}
                      />
                    </th>
                    <th className="px-4 py-2.5 text-center min-w-[120px]">
                      <SortHeader
                        label="Количество SKU"
                        columnKey="count"
                        currentSortKey={pivotSortConfig.key}
                        currentDirection={pivotSortConfig.direction}
                        onSort={handlePivotSort}
                        align="center"
                      />
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {pivotList.map((row, i) => (
                    <tr key={i} className="hover:bg-slate-50/70">
                      <td className="px-4 py-2 font-medium text-slate-900">{row.manager}</td>
                      <td className="px-4 py-2 text-slate-700">{row.section}</td>
                      <td className="px-4 py-2 text-center font-mono font-bold text-blue-700">{row.count}</td>
                    </tr>
                  ))}
                  {pivotList.length > 0 && (
                    <tr className="bg-slate-50 font-bold border-t-2 border-slate-200">
                      <td colSpan={2} className="px-4 py-2.5 text-right text-slate-800">
                        Итого:
                      </td>
                      <td className="px-4 py-2.5 text-center font-mono font-bold text-blue-900 text-sm">
                        {totalSummarySku} SKU
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 3: Upload */}
        {activeTab === 'upload' && (
          <div className="py-4 space-y-4">
            <div className="border-2 border-dashed border-slate-300 hover:border-blue-500 bg-slate-50/60 rounded-xl p-8 text-center transition-colors">
              <UploadCloud className="w-12 h-12 mx-auto text-blue-500 mb-3" />
              <div className="text-base font-semibold text-slate-800 mb-1">
                Выберите один или несколько Excel файлов (.xlsx, .xls)
              </div>
              <p className="text-xs text-slate-500 max-w-md mx-auto mb-4">
                Колонки сопоставляются автоматически: Внешний код, Наименование, Раздел (Группа 3), Код менеджера (main_mng_code)
              </p>
              <label className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm cursor-pointer shadow-xs transition-colors">
                <FileSpreadsheet className="w-4 h-4" />
                Выбрать файлы на компьютере
                <input
                  type="file"
                  multiple
                  accept=".xlsx, .xls"
                  onChange={handleFilesUpload}
                  disabled={uploading}
                  className="hidden"
                />
              </label>
            </div>

            {uploading && (
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl space-y-2">
                <div className="flex justify-between text-xs font-medium text-blue-900">
                  <span>{uploadStatus}</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="w-full h-2 bg-blue-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};
