import React, { useState } from 'react';
import { Budget, STUDENT_EXPENSE_CATEGORIES } from '../types';
import { PlusIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import Modal from './ui/Modal';

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
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="monthly-plan-modal-title"
      maxWidthClass="max-w-lg"
      panelClassName="!p-0 overflow-hidden max-h-[85vh] flex flex-col"
    >
      <div className="bg-gradient-to-r from-lantern-primary to-lantern-primary-dark px-5 py-4 flex justify-between items-center shrink-0">
        <h2 id="monthly-plan-modal-title" className="text-lg font-bold text-white">Category Budgets</h2>
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-white/70 hover:text-white rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          aria-label="Close category budgets"
        >
          <XMarkIcon className="w-6 h-6" aria-hidden />
        </button>
      </div>

      <div className="p-5 overflow-y-auto flex-1 space-y-4 bg-lantern-surface">
        {monthlyLimit > 0 && (
          <div className="bg-lantern-background-secondary/60 rounded-xl p-3">
            <div className="flex justify-between text-sm">
              <span className="text-lantern-text-muted">Monthly Budget</span>
              <span className="font-semibold text-lantern-text">₦{monthlyLimit.toLocaleString('en-NG')}</span>
            </div>
            <div className="flex justify-between text-sm mt-1">
              <span className="text-lantern-text-muted">Allocated</span>
              <span className="font-semibold text-lantern-primary">₦{totalAllocated.toLocaleString('en-NG')}</span>
            </div>
            <div className="flex justify-between text-sm mt-1">
              <span className="text-lantern-text-muted">Unallocated</span>
              <span className={`font-semibold ${remaining >= 0 ? 'text-lantern-success' : 'text-lantern-error'}`}>
                ₦{remaining.toLocaleString('en-NG')}
              </span>
            </div>
            <div className="w-full bg-lantern-background-secondary rounded-full h-2 mt-2">
              <div
                className={`h-2 rounded-full transition-all ${remaining >= 0 ? 'bg-lantern-primary' : 'bg-lantern-error'}`}
                style={{ width: `${Math.min((totalAllocated / monthlyLimit) * 100, 100)}%` }}
              />
            </div>
          </div>
        )}

        <p className="text-xs text-lantern-text-muted">
          Set spending limits per category. You&apos;ll see progress bars on the Overview tab.
        </p>

        <div className="space-y-3">
          {activeCategories.map(catId => {
            const cat = STUDENT_EXPENSE_CATEGORIES.find(c => c.id === catId);
            if (!cat) return null;
            return (
              <div key={catId} className="flex items-center gap-3">
                <span className="text-xl" aria-hidden>{cat.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-lantern-text truncate">{cat.label}</p>
                </div>
                <div className="relative w-28">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-lantern-text-muted">₦</span>
                  <input
                    type="number"
                    value={allocations[catId]}
                    onChange={(e) => handleChange(catId, e.target.value)}
                    aria-label={`${cat.label} budget amount`}
                    className="w-full p-2 pl-6 text-sm border border-lantern-border rounded-lg bg-lantern-surface text-lantern-text focus:ring-2 focus:ring-lantern-primary focus:border-transparent"
                    placeholder="0"
                    min="0"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(catId)}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center text-lantern-text-muted hover:text-lantern-error rounded-lg"
                  aria-label={`Remove ${cat.label}`}
                >
                  <TrashIcon className="w-4 h-4" aria-hidden />
                </button>
              </div>
            );
          })}
        </div>

        {availableCategories.length > 0 && (
          <div>
            {showAdd ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 mt-2">
                {availableCategories.map(cat => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => handleAdd(cat.id)}
                    className="flex flex-col items-center p-2 rounded-xl text-xs font-medium bg-lantern-surface-secondary text-lantern-text-muted hover:bg-lantern-primary/10 hover:text-lantern-primary transition-colors min-h-[44px] min-w-0"
                  >
                    <span className="text-lg mb-0.5" aria-hidden>{cat.icon}</span>
                    <span className="line-clamp-2 text-center leading-tight text-[11px] sm:text-xs">{cat.label.split('/')[0].split('&')[0].trim()}</span>
                  </button>
                ))}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowAdd(true)}
                className="w-full min-h-[44px] py-2 border-2 border-dashed border-lantern-border rounded-xl text-sm text-lantern-text-muted hover:border-lantern-primary hover:text-lantern-primary flex items-center justify-center gap-1 transition-colors"
              >
                <PlusIcon className="w-4 h-4" aria-hidden /> Add Category
              </button>
            )}
          </div>
        )}
      </div>

      <div className="px-5 py-4 border-t border-lantern-border flex gap-3 shrink-0 bg-lantern-surface">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 min-h-[44px] px-4 py-2.5 text-sm font-medium text-lantern-text bg-lantern-background-secondary rounded-xl hover:opacity-90"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="flex-1 min-h-[44px] px-4 py-2.5 text-sm font-semibold text-white bg-lantern-primary hover:bg-lantern-primary-dark rounded-xl shadow-sm"
        >
          Save Plan
        </button>
      </div>
    </Modal>
  );
};

export default SetMonthlyPlanModal;
