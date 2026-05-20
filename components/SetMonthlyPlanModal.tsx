import React, { useState, useMemo } from 'react';
import { Budget, STUDENT_EXPENSE_CATEGORIES } from '../types';
import { XCircleIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';

interface SetMonthlyPlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentBudget: Budget | null;
  onSave: (categoryBudgets: Record<string, number>) => void;
}

const SetMonthlyPlanModal: React.FC<SetMonthlyPlanModalProps> = ({ isOpen, onClose, currentBudget, onSave }) => {
  const existingBudgets = currentBudget?.categoryBudgets || {};
  const [allocations, setAllocations] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(existingBudgets).map(([k, v]) => [k, String(v)]))
  );
  const [showAdd, setShowAdd] = useState(false);

  if (!isOpen) return null;

  const activeCategories = Object.keys(allocations);
  const availableCategories = STUDENT_EXPENSE_CATEGORIES.filter(c => !activeCategories.includes(c.id));

  const totalAllocated = Object.values(allocations).reduce((sum, v) => sum + (parseFloat(v) || 0), 0);
  const monthlyLimit = currentBudget?.monthlyLimit || 0;
  const remaining = monthlyLimit - totalAllocated;

  const handleChange = (catId: string, value: string) => {
    setAllocations(prev => ({ ...prev, [catId]: value }));
  };

  const handleAdd = (catId: string) => {
    setAllocations(prev => ({ ...prev, [catId]: '' }));
    setShowAdd(false);
  };

  const handleRemove = (catId: string) => {
    setAllocations(prev => {
      const next = { ...prev };
      delete next[catId];
      return next;
    });
  };

  const handleSave = () => {
    const result: Record<string, number> = {};
    for (const [k, v] of Object.entries(allocations)) {
      const num = parseFloat(v);
      if (num > 0) result[k] = num;
    }
    onSave(result);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 dark:bg-black/75 flex items-center justify-center p-4 z-[80]" role="dialog" aria-modal="true">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-lg overflow-hidden max-h-[85vh] flex flex-col">
        <div className="bg-gradient-to-r from-indigo-500 to-purple-600 px-5 py-4 flex justify-between items-center shrink-0">
          <h2 className="text-lg font-bold text-white">Category Budgets</h2>
          <button onClick={onClose} className="text-white/70 hover:text-white"><XCircleIcon className="w-6 h-6" /></button>
        </div>

        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {/* Summary */}
          {monthlyLimit > 0 && (
            <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-3">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500 dark:text-slate-400">Monthly Budget</span>
                <span className="font-semibold text-slate-700 dark:text-slate-200">₦{monthlyLimit.toLocaleString('en-NG')}</span>
              </div>
              <div className="flex justify-between text-sm mt-1">
                <span className="text-slate-500 dark:text-slate-400">Allocated</span>
                <span className="font-semibold text-indigo-500">₦{totalAllocated.toLocaleString('en-NG')}</span>
              </div>
              <div className="flex justify-between text-sm mt-1">
                <span className="text-slate-500 dark:text-slate-400">Unallocated</span>
                <span className={`font-semibold ${remaining >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>₦{remaining.toLocaleString('en-NG')}</span>
              </div>
              <div className="w-full bg-slate-200 dark:bg-slate-600 rounded-full h-2 mt-2">
                <div className={`h-2 rounded-full transition-all ${remaining >= 0 ? 'bg-indigo-400' : 'bg-red-400'}`} style={{ width: `${Math.min((totalAllocated / monthlyLimit) * 100, 100)}%` }} />
              </div>
            </div>
          )}

          <p className="text-xs text-slate-500 dark:text-slate-400">
            Set spending limits per category. You'll see progress bars on the Overview tab.
          </p>

          {/* Category list */}
          <div className="space-y-3">
            {activeCategories.map(catId => {
              const cat = STUDENT_EXPENSE_CATEGORIES.find(c => c.id === catId);
              if (!cat) return null;
              return (
                <div key={catId} className="flex items-center gap-3">
                  <span className="text-xl">{cat.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate">{cat.label}</p>
                  </div>
                  <div className="relative w-28">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">₦</span>
                    <input
                      type="number"
                      value={allocations[catId]}
                      onChange={(e) => handleChange(catId, e.target.value)}
                      className="w-full p-2 pl-6 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
                      placeholder="0"
                      min="0"
                    />
                  </div>
                  <button onClick={() => handleRemove(catId)} className="text-slate-300 dark:text-slate-600 hover:text-red-500">
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Add category */}
          {availableCategories.length > 0 && (
            <div>
              {showAdd ? (
                <div className="grid grid-cols-4 gap-2 mt-2">
                  {availableCategories.map(cat => (
                    <button key={cat.id} type="button" onClick={() => handleAdd(cat.id)}
                      className="flex flex-col items-center p-2 rounded-xl text-xs font-medium bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
                      <span className="text-lg mb-0.5">{cat.icon}</span>
                      <span className="line-clamp-1 text-center leading-tight" style={{ fontSize: '9px' }}>{cat.label.split('/')[0].split('&')[0].trim()}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <button onClick={() => setShowAdd(true)}
                  className="w-full py-2 border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-xl text-sm text-slate-400 hover:border-indigo-400 hover:text-indigo-500 flex items-center justify-center gap-1 transition-colors">
                  <PlusIcon className="w-4 h-4" /> Add Category
                </button>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-700 flex gap-3 shrink-0">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600">Cancel</button>
          <button type="button" onClick={handleSave} className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-indigo-500 hover:bg-indigo-600 rounded-xl shadow-sm">Save Plan</button>
        </div>
      </div>
    </div>
  );
};

export default SetMonthlyPlanModal;
