import React, { useEffect, useState } from 'react';
import { Navbar, MainTabType } from './components/Navbar';
import { ProductsTab } from './components/products/ProductsTab';
import { GroupsTab } from './components/groups/GroupsTab';
import { TasksTab } from './components/tasks/TasksTab';
import { AnalyticsTab } from './components/analytics/AnalyticsTab';
import { DeveloperModal } from './components/modals/DeveloperModal';
import { LoginPage } from './components/LoginPage';
import { storageService } from './services/storageService';
import { googleSheetsService } from './services/googleSheetsService';
import { useAuth } from './context/AuthContext';
import { motion, AnimatePresence } from 'motion/react';
import { Code2, LogOut, Loader2 } from 'lucide-react';

export default function App() {
  const { token, ready, isAdmin, logout, role } = useAuth();
  const [activeTab, setActiveTab] = useState<MainTabType>('products');
  const [resetKey, setResetKey] = useState(0);
  const [isDeveloperModalOpen, setIsDeveloperModalOpen] = useState(false);

  useEffect(() => {
    if (!token) return;
    googleSheetsService.syncAll().catch(() => {});
    googleSheetsService.refreshWebhookStatus().catch(() => {});
    return googleSheetsService.startAutoSync(3);
  }, [token]);

  if (!ready) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#d8eaf8] via-[#eaf3fb] to-[#f6f9fc] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-sky-600 animate-spin" />
      </div>
    );
  }

  if (!token) {
    return <LoginPage />;
  }

  const handleResetData = () => {
    if (confirm('Сбросить все данные к исходным демонстрационным? Все несохраненные изменения будут перезаписаны.')) {
      storageService.resetAll();
      setResetKey(prev => prev + 1);
    }
  };

  return (
    <div key={resetKey} className="min-h-screen bg-gradient-to-b from-[#d8eaf8] via-[#eaf3fb] to-[#f6f9fc] text-slate-800 flex flex-col font-sans selection:bg-sky-200 selection:text-sky-900">
      <Navbar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onResetData={handleResetData}
        onSyncComplete={() => setResetKey(prev => prev + 1)}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <AnimatePresence mode="wait">
          {activeTab === 'products' && (
            <motion.div
              key="products"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
            >
              <ProductsTab />
            </motion.div>
          )}

          {activeTab === 'groups' && (
            <motion.div
              key="groups"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
            >
              <GroupsTab />
            </motion.div>
          )}

          {activeTab === 'tasks' && (
            <motion.div
              key="tasks"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
            >
              <TasksTab />
            </motion.div>
          )}

          {activeTab === 'analytics' && (
            <motion.div
              key="analytics"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
            >
              <AnalyticsTab />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="h-14 bg-slate-900 px-4 sm:px-8 flex items-center justify-between shrink-0 text-[11px] text-slate-400 border-t border-slate-800 mt-auto">
        <div className="flex items-center gap-3 sm:gap-6 font-mono">
          <span className="text-slate-300 font-semibold">ОТДЕЛ КОНТЕНТА & КАМ</span>
          <span className="hidden sm:inline text-slate-700">|</span>
          <span className="hidden sm:inline">ФОРМАТ: XLSX / XLS</span>
          <span className="hidden md:inline text-slate-700">|</span>
          <span className="hidden md:inline">СИНХРОНИЗАЦИЯ GOOGLE SHEETS</span>
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden sm:inline px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-slate-300 font-mono">
            {role === 'admin' ? 'Админ' : 'Наблюдатель'}
          </span>

          {isAdmin && (
            <button
              type="button"
              id="developer-panel-btn"
              onClick={() => setIsDeveloperModalOpen(true)}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-400 hover:text-sky-300 border border-slate-700 font-mono text-xs font-semibold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer hover:border-sky-500/50"
              title="Панель разработчика: синхронизация, вебхук и отправка данных"
            >
              <Code2 className="w-3.5 h-3.5 text-sky-400" />
              <span>Для разработчика</span>
            </button>
          )}

          <button
            type="button"
            onClick={logout}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 font-mono text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
            title="Выйти"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Выйти</span>
          </button>

          <div className="hidden sm:flex items-center gap-2 pl-2 border-l border-slate-800">
            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
            <span className="font-mono text-slate-400">Online</span>
          </div>
        </div>
      </footer>

      {isAdmin && (
        <DeveloperModal
          isOpen={isDeveloperModalOpen}
          onClose={() => setIsDeveloperModalOpen(false)}
          onSyncComplete={() => setResetKey(prev => prev + 1)}
        />
      )}
    </div>
  );
}
