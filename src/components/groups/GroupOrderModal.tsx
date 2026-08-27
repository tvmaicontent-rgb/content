import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { GroupOrderItem } from '../../types';
import { SortHeader } from '../common/SortHeader';
import { SortConfig, sortData } from '../../utils/sortUtils';
import { ListOrdered, Search } from 'lucide-react';

interface GroupOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  orders: GroupOrderItem[];
}

export const GroupOrderModal: React.FC<GroupOrderModalProps> = ({
  isOpen,
  onClose,
  orders,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState<SortConfig<GroupOrderItem>>({
    key: 'position',
    direction: 'asc',
  });

  const handleSort = (key: string) => {
    setSortConfig(prev => {
      if (prev.key === key) {
        if (prev.direction === 'asc') return { key, direction: 'desc' };
        if (prev.direction === 'desc') return { key: '', direction: null };
        return { key, direction: 'asc' };
      }
      return { key, direction: 'asc' };
    });
  };

  const filtered = orders.filter(o => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      o.groupName.toLowerCase().includes(q) ||
      o.section.toLowerCase().includes(q) ||
      o.status.toLowerCase().includes(q) ||
      (o.comment && o.comment.toLowerCase().includes(q)) ||
      String(o.position).includes(q)
    );
  });

  const sortedOrders: GroupOrderItem[] = sortData<GroupOrderItem>(filtered, sortConfig);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="📌 Порядок расположения групп на сайте" maxWidth="4xl">
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            Справочная иерархия расположения товарных категорий в каталоге интернет-магазина ({orders.length} позиций).
          </p>

          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Поиск по названию или разделу..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            />
          </div>
        </div>

        <div className="border border-slate-200 rounded-xl overflow-hidden max-h-[60vh] overflow-y-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead className="bg-slate-100 text-slate-600 font-semibold uppercase sticky top-0 border-b border-slate-200 z-10">
              <tr>
                <th className="px-3.5 py-2.5 w-24 text-center">
                  <SortHeader
                    label="№ Поз."
                    columnKey="position"
                    currentSortKey={sortConfig.key}
                    currentDirection={sortConfig.direction}
                    onSort={handleSort}
                    align="center"
                  />
                </th>
                <th className="px-4 py-2.5 min-w-[200px]">
                  <SortHeader
                    label="Группа товара"
                    columnKey="groupName"
                    currentSortKey={sortConfig.key}
                    currentDirection={sortConfig.direction}
                    onSort={handleSort}
                  />
                </th>
                <th className="px-4 py-2.5 min-w-[180px]">
                  <SortHeader
                    label="Родительский раздел"
                    columnKey="section"
                    currentSortKey={sortConfig.key}
                    currentDirection={sortConfig.direction}
                    onSort={handleSort}
                  />
                </th>
                <th className="px-4 py-2.5 min-w-[120px]">
                  <SortHeader
                    label="Статус"
                    columnKey="status"
                    currentSortKey={sortConfig.key}
                    currentDirection={sortConfig.direction}
                    onSort={handleSort}
                  />
                </th>
                <th className="px-4 py-2.5 min-w-[150px]">
                  <SortHeader
                    label="Примечание"
                    columnKey="comment"
                    currentSortKey={sortConfig.key}
                    currentDirection={sortConfig.direction}
                    onSort={handleSort}
                  />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {sortedOrders.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                    Информация не найдена.
                  </td>
                </tr>
              ) : (
                sortedOrders.map(o => (
                  <tr key={o.id} className="hover:bg-slate-50/70">
                    <td className="px-3.5 py-2 text-center font-bold text-slate-800 bg-slate-50/40 font-mono">
                      {o.position}
                    </td>
                    <td className="px-4 py-2 font-medium text-slate-900">{o.groupName}</td>
                    <td className="px-4 py-2 text-slate-600">{o.section}</td>
                    <td className="px-4 py-2">
                      <span className="px-2 py-0.5 rounded-full text-2xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        {o.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-slate-500">{o.comment || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            Закрыть
          </button>
        </div>
      </div>
    </Modal>
  );
};
