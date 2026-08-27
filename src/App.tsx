import React, { useState } from 'react';
import { Navbar, MainTabType } from './components/Navbar';
import { ProductsTab } from './components/products/ProductsTab';
import { GroupsTab } from './components/groups/GroupsTab';
import { TasksTab } from './components/tasks/TasksTab';
import { AnalyticsTab } from './components/analytics/AnalyticsTab';
import { storageService } from './services/storageService';
import { motion, AnimatePresence } from 'motion/react';

export default function App() {
  const [activeTab, setActiveTab] = useState<MainTabType>('products');
  const [resetKey, setResetKey] = useState(0);

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

      {/* Geometric Balance dark technical footer */}
      <footer className="h-12 bg-slate-900 px-6 sm:px-8 flex items-center justify-between shrink-0 text-[11px] text-slate-400 border-t border-slate-800 mt-auto">
        <div className="flex items-center gap-4 sm:gap-6 font-mono">
          <span>ОТДЕЛ КОНТЕНТА & КАМ</span>
          <span className="hidden sm:inline text-slate-600">|</span>
          <span className="hidden sm:inline">ФОРМАТ: XLSX / XLS</span>
          <span className="hidden md:inline text-slate-600">|</span>
          <span className="hidden md:inline">СИНХРОНИЗАЦИЯ С GOOGLE SHEETS</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
          <span className="font-mono text-slate-300">System Ready</span>
        </div>
      </footer>
    </div>
  );
}
