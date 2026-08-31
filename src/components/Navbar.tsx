import React, { useState, useEffect } from 'react';
import {
  Package,
  Layers,
  CheckSquare,
  BarChart3,
  RotateCcw,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  LogOut,
  User,
} from 'lucide-react';
import { googleSheetsService, SyncResult } from '../services/googleSheetsService';
import { storageService } from '../services/storageService';
import { authService } from '../services/authService';
import { AuthUser } from '../types/auth';

export type MainTabType = 'products' | 'groups' | 'tasks' | 'analytics';

interface NavbarProps {
  activeTab: MainTabType;
  onTabChange: (tab: MainTabType) => void;
  onResetData: () => void;
  onSyncComplete?: () => void;
  onLogout?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onTabChange,
  onResetData,
  onSyncComplete,
  onLogout,
}) => {
  const [productCount, setProductCount] = useState(storageService.getProducts().length);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(googleSheetsService.getLastSyncTime());
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(authService.getUser());

  useEffect(() => {
    // Subscribe to sheets updates
    const unsubSheets = googleSheetsService.subscribe(() => {
      setProductCount(storageService.getProducts().length);
      setIsSyncing(googleSheetsService.getIsSyncing());
      setLastSyncTime(googleSheetsService.getLastSyncTime());
    });

    // Subscribe to auth updates
    const unsubAuth = authService.subscribe(session => {
      setCurrentUser(session?.user || null);
    });

    setCurrentUser(authService.getUser());

    return () => {
      unsubSheets();
      unsubAuth();
    };
  }, []);

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncStatus('Выгрузка свежих данных через защищенный серверный прокси...');

    try {
      const result: SyncResult = await googleSheetsService.syncAll();
      setIsSyncing(false);

      if (result.success) {
        setSyncStatus(`Успешно загружено: ${result.contentCount + result.kamCount} SKU (${result.contentCount} контент, ${result.kamCount} КАМ), ${result.tasksCount} задач, ${result.newProductsCount} новых товаров`);
        setProductCount(result.contentCount + result.kamCount);
        if (onSyncComplete) onSyncComplete();
        setTimeout(() => setSyncStatus(null), 6000);
      } else {
        setSyncStatus(`Ошибка синхронизации: ${result.error || 'проверьте сервер'}`);
        setTimeout(() => setSyncStatus(null), 8000);
      }
    } catch (err: any) {
      setIsSyncing(false);
      setSyncStatus(`Ошибка: ${err.message || 'не удалось выполнить синхронизацию'}`);
      setTimeout(() => setSyncStatus(null), 8000);
    }
  };

  const handleLogoutClick = async () => {
    if (confirm('Вы уверены, что хотите выйти из системы?')) {
      await authService.logout();
      if (onLogout) onLogout();
    }
  };

  const roleEmoji =
    currentUser?.role === 'admin'
      ? '🛡️'
      : currentUser?.role === 'content'
      ? '🎨'
      : currentUser?.role === 'kam'
      ? '💼'
      : '👁️';

  const roleLabel =
    currentUser?.role === 'admin'
      ? 'Администратор'
      : currentUser?.role === 'content'
      ? 'Контент'
      : currentUser?.role === 'kam'
      ? 'КАМ'
      : 'Наблюдатель';

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
            {/* User Profile Badge */}
            {currentUser && (
              <div
                id="user-profile-badge"
                className="px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-900 text-white border border-slate-700 flex items-center gap-2 shadow-xs"
              >
                <span className="text-sm leading-none">{roleEmoji}</span>
                <div className="flex flex-col text-left leading-tight hidden sm:flex">
                  <span className="font-mono text-sky-300 font-bold text-[11px]">{currentUser.username}</span>
                  <span className="text-[10px] text-slate-400">{roleLabel}</span>
                </div>
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 ml-0.5" title="Сессия активна"></div>
              </div>
            )}

            {/* Logout Button */}
            <button
              type="button"
              id="logout-button"
              onClick={handleLogoutClick}
              className="px-2.5 py-2 text-xs font-bold text-slate-700 hover:text-rose-700 bg-slate-100 hover:bg-rose-50 rounded-xl flex items-center gap-1.5 transition-colors border border-slate-200 hover:border-rose-200 cursor-pointer"
              title="Выйти из системы"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Выйти</span>
            </button>

            {/* Prominent Sync Button */}
            <button
              type="button"
              id="main-sync-button"
              onClick={handleSync}
              disabled={isSyncing}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all shadow-xs cursor-pointer ${
                isSyncing
                  ? 'bg-sky-100 text-sky-700 border border-sky-300 cursor-not-allowed'
                  : 'bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-700 hover:to-indigo-700 text-white shadow-sky-200 hover:shadow-md active:scale-98'
              }`}
              title="Выгрузить свежие данные через защищенный серверный прокси"
            >
              <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${isSyncing ? 'animate-spin' : ''}`} />
              <span className="font-extrabold hidden sm:inline">
                {isSyncing ? 'Выгрузка через сервер...' : 'Синхронизация с таблицей'}
              </span>
              <span className="font-extrabold sm:hidden">
                {isSyncing ? 'Выгрузка...' : 'Синхр.'}
              </span>
            </button>

            <button
              type="button"
              onClick={onResetData}
              className="px-2.5 sm:px-3 py-2 text-xs font-bold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl flex items-center gap-1.5 transition-colors border border-slate-200 cursor-pointer"
              title="Сбросить локальные изменения"
            >
              <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
              <span className="hidden md:inline">Сброс</span>
            </button>
          </div>
        </div>

        {/* Sync Status Banner */}
        {syncStatus && (
          <div
            className={`py-2 px-3.5 my-2 border rounded-xl text-xs flex items-center justify-between font-semibold transition-all ${
              syncStatus.startsWith('Ошибка')
                ? 'bg-rose-50 border-rose-200 text-rose-800'
                : isSyncing
                ? 'bg-sky-50 border-sky-200 text-sky-800 animate-pulse'
                : 'bg-emerald-50 border-emerald-200 text-emerald-900'
            }`}
          >
            <div className="flex items-center gap-2">
              {isSyncing ? (
                <RefreshCw className="w-3.5 h-3.5 text-sky-600 animate-spin shrink-0" />
              ) : syncStatus.startsWith('Ошибка') ? (
                <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              )}
              <span>{syncStatus}</span>
            </div>
            {lastSyncTime && (
              <span className="text-[11px] font-mono text-slate-500 shrink-0 ml-2">
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

