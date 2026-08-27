import React, { useState, useEffect } from 'react';
import { Package, Layers, CheckSquare, BarChart3, RotateCcw, ExternalLink, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import { SPREADSHEET_URL, KAM_SPREADSHEET_URL } from '../constants';
import { googleSheetsService, SyncResult } from '../services/googleSheetsService';
import { storageService } from '../services/storageService';

export type MainTabType = 'products' | 'groups' | 'tasks' | 'analytics';

interface NavbarProps {
  activeTab: MainTabType;
  onTabChange: (tab: MainTabType) => void;
  onResetData: () => void;
  onSyncComplete?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onTabChange,
  onResetData,
  onSyncComplete,
}) => {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [productCount, setProductCount] = useState(storageService.getProducts().length);

  useEffect(() => {
    const unsubscribe = googleSheetsService.subscribe(() => {
      setIsSyncing(googleSheetsService.getIsSyncing());
      setLastSyncTime(googleSheetsService.getLastSyncTime());
      setProductCount(storageService.getProducts().length);
    });
    return unsubscribe;
  }, []);

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncStatus('Загрузка таблиц Google Sheets...');
    const result: SyncResult = await googleSheetsService.syncAll();
    setIsSyncing(false);

    if (result.success) {
      setSyncStatus(`Синхронизировано: ${result.contentCount + result.kamCount} товаров, ${result.tasksCount} задач`);
      setProductCount(result.contentCount + result.kamCount);
      if (onSyncComplete) onSyncComplete();
      setTimeout(() => setSyncStatus(null), 5000);
    } else {
      setSyncStatus(`Ошибка: ${result.error || 'не удалось синхронизировать'}`);
      setTimeout(() => setSyncStatus(null), 7000);
    }
  };

  return (
    <header className="bg-white/95 backdrop-blur-md border-b border-sky-100 sticky top-0 z-40 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Top brand line */}
        <div className="flex items-center justify-between h-16 border-b border-slate-100 gap-2">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-tr from-sky-600 to-indigo-600 rounded-xl flex items-center justify-center shrink-0 shadow-xs">
              <div className="w-4 h-4 border-2 border-white rotate-45 rounded-xs"></div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-extrabold text-slate-900 tracking-tight leading-none">
                  Панель управления отделом контента
                </h1>
                <span className="hidden sm:inline-block text-[11px] bg-sky-50 text-sky-800 px-2.5 py-0.5 rounded-full font-bold border border-sky-200">
                  {productCount.toLocaleString('ru-RU')} SKU
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-medium hidden md:block">
                Синхронизация и операционный учет товаров, групп и задач
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-2.5">
            {/* Live Sync Button */}
            <button
              type="button"
              onClick={handleSync}
              disabled={isSyncing}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer ${
                isSyncing
                  ? 'bg-sky-50 text-sky-500 border border-sky-200 cursor-not-allowed'
                  : 'bg-sky-600 hover:bg-sky-700 text-white hover:shadow-sky-200'
              }`}
              title="Загрузить свежие данные напрямую из Google Sheets"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">
                {isSyncing ? 'Синхронизация...' : 'Синхронизация Sheets'}
              </span>
              <span className="sm:hidden">{isSyncing ? '...' : 'Sync'}</span>
            </button>

            {/* Google Sheets external links dropdown/buttons */}
            <div className="hidden lg:flex items-center gap-1.5">
              <a
                href={SPREADSHEET_URL}
                target="_blank"
                rel="noreferrer"
                className="px-2.5 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors flex items-center gap-1"
                title="Google Таблица: Отдел контента"
              >
                <ExternalLink className="w-3 h-3 text-slate-500" />
                <span>Контент</span>
              </a>
              <a
                href={KAM_SPREADSHEET_URL}
                target="_blank"
                rel="noreferrer"
                className="px-2.5 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors flex items-center gap-1"
                title="Google Таблица: КАМ"
              >
                <ExternalLink className="w-3 h-3 text-slate-500" />
                <span>КАМ</span>
              </a>
            </div>

            <button
              type="button"
              onClick={onResetData}
              className="px-3 py-2 text-xs font-bold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl flex items-center gap-1.5 transition-colors border border-slate-200 cursor-pointer"
              title="Сбросить локальные изменения"
            >
              <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
              <span className="hidden md:inline">Сброс</span>
            </button>
          </div>
        </div>

        {/* Sync notification banner if active */}
        {syncStatus && (
          <div className="py-2 px-3.5 my-1.5 bg-sky-50 border border-sky-200 text-sky-900 rounded-xl text-xs flex items-center justify-between font-semibold animate-fadeIn">
            <div className="flex items-center gap-2">
              {isSyncing ? (
                <RefreshCw className="w-3.5 h-3.5 text-sky-600 animate-spin" />
              ) : syncStatus.startsWith('Ошибка') ? (
                <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              )}
              <span>{syncStatus}</span>
            </div>
            {lastSyncTime && (
              <span className="text-[11px] text-sky-700 font-mono">
                {lastSyncTime}
              </span>
            )}
          </div>
        )}

        {/* Navigation Main Tabs */}
        <nav className="flex justify-start sm:justify-center -mb-px overflow-x-auto no-scrollbar gap-2 sm:gap-4 pt-1">
          <button
            type="button"
            onClick={() => onTabChange('products')}
            className={`flex items-center gap-2 py-3 px-4 border-b-2 font-extrabold text-xs sm:text-sm transition-all whitespace-nowrap cursor-pointer rounded-t-lg ${
              activeTab === 'products'
                ? 'border-sky-600 text-sky-700 bg-sky-50/70'
                : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
            }`}
          >
            <Package className="w-4 h-4" />
            <span>ДОБАВЛЕНИЕ ТОВАРОВ</span>
          </button>

          <button
            type="button"
            onClick={() => onTabChange('groups')}
            className={`flex items-center gap-2 py-3 px-4 border-b-2 font-extrabold text-xs sm:text-sm transition-all whitespace-nowrap cursor-pointer rounded-t-lg ${
              activeTab === 'groups'
                ? 'border-sky-600 text-sky-700 bg-sky-50/70'
                : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>ВЫВОД ГРУПП</span>
          </button>

          <button
            type="button"
            onClick={() => onTabChange('tasks')}
            className={`flex items-center gap-2 py-3 px-4 border-b-2 font-extrabold text-xs sm:text-sm transition-all whitespace-nowrap cursor-pointer rounded-t-lg ${
              activeTab === 'tasks'
                ? 'border-sky-600 text-sky-700 bg-sky-50/70'
                : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
            }`}
          >
            <CheckSquare className="w-4 h-4" />
            <span>ЗАДАЧИ</span>
          </button>

          <button
            type="button"
            onClick={() => onTabChange('analytics')}
            className={`flex items-center gap-2 py-3 px-4 border-b-2 font-extrabold text-xs sm:text-sm transition-all whitespace-nowrap cursor-pointer rounded-t-lg ${
              activeTab === 'analytics'
                ? 'border-sky-600 text-sky-700 bg-sky-50/70'
                : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            <span>АНАЛИТИКА</span>
          </button>
        </nav>
      </div>
    </header>
  );
};
