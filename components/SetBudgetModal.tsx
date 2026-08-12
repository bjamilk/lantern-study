import React, { useState, useEffect } from 'react';
import { useToastStore } from '../stores/toastStore';
import { Budget, STUDENT_INCOME_CATEGORIES } from '../types';
import { summarizeBudgetPlan } from '@lantern/shared/utils';
import { XMarkIcon } from '@heroicons/react/24/outline';
import Modal from './ui/Modal';

interface SetBudgetModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** A full Budget carries the plan; a bare number is the legacy cap-only call. */
  onSubmit: (budget: Budget | number) => void;
  currentBudget: Budget | null;
}

const SetBudgetModal: React.FC<SetBudgetModalProps> = ({ isOpen, onClose, onSubmit, currentBudget }) => {
  const [amount, setAmount] = useState<number | ''>('');
  // Planned income per category and a savings allocation — the half that makes
  // "income − (expenses + savings)" answerable.
  const [income, setIncome] = useState<Record<string, string>>({});
  const [savings, setSavings] = useState('');

  useEffect(() => {
    if (isOpen) {
      setAmount(currentBudget?.monthlyLimit || '');
      setIncome(
        Object.fromEntries(
          Object.entries(currentBudget?.plannedIncome ?? {}).map(([k, v]) => [k, String(v)])
        )
      );
      setSavings(currentBudget?.plannedSavings ? String(currentBudget.plannedSavings) : '');
    }
  }, [isOpen, currentBudget]);

  const toNumber = (value: string) => {
    const n = parseFloat(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  const plannedIncome = React.useMemo(() => {
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(income)) {
      const n = toNumber(value);
      if (n > 0) out[key] = n;
    }
    return out;
  }, [income]);

  const currentMonth = new Date().toISOString().slice(0, 7);

  const planSummary = React.useMemo(
    () =>
      summarizeBudgetPlan({
        monthYear: currentBudget?.monthYear ?? currentMonth,
        monthlyLimit: amount === '' ? 0 : Number(amount),
        plannedExpenses: currentBudget?.categoryBudgets ?? {},
        plannedIncome,
        plannedSavings: toNumber(savings),
      }),
    [amount, savings, plannedIncome, currentBudget, currentMonth]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (amount === '' || amount <= 0) {
      useToastStore.getState().showToast('Please enter a valid positive amount for your budget.', 'error');
      return;
    }
    onSubmit({
      monthlyLimit: Number(amount),
      monthYear: currentBudget?.monthYear ?? currentMonth,
      categoryBudgets: currentBudget?.categoryBudgets,
      plannedIncome,
      plannedSavings: toNumber(savings),
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="set-budget-modal-title"
      maxWidthClass="max-w-md"
    >
      <div className="flex justify-between items-center mb-4">
        <h2 id="set-budget-modal-title" className="text-xl font-semibold text-lantern-text">
          {currentBudget ? 'Edit' : 'Set'} Monthly Budget
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-lantern-text-muted hover:text-lantern-text rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
          aria-label="Close budget dialog"
        >
          <XMarkIcon className="w-6 h-6" aria-hidden />
        </button>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="budget-amount" className="block text-sm font-medium text-lantern-text">
            Total Budget Amount for this Month (₦)
          </label>
          <div className="relative mt-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lantern-text-muted">₦</span>
            <input
              type="number"
              id="budget-amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value === '' ? '' : parseFloat(e.target.value))}
              required
              min="0.01"
              step="0.01"
              className="w-full min-h-[44px] p-2 pl-8 border border-lantern-border rounded-lg bg-lantern-surface text-lantern-text focus:ring-2 focus:ring-lantern-primary focus:border-transparent"
              placeholder="e.g., 50000.00"
            />
          </div>
        </div>
        {/* Planned income — nothing to balance against without it. */}
        <div>
          <p className="block text-sm font-medium text-lantern-text">Expected income this month</p>
          <p className="text-xs text-lantern-text-tertiary mt-0.5">
            Leave a row blank if it does not apply.
          </p>
          <div className="mt-2 space-y-2 max-h-52 overflow-y-auto pr-1">
            {STUDENT_INCOME_CATEGORIES.map(cat => (
              <div key={cat.id} className="flex items-center gap-2">
                <span className="text-sm text-lantern-text-secondary flex-1 truncate">
                  {cat.icon} {cat.label}
                </span>
                <div className="relative w-32">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-lantern-text-muted">₦</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    aria-label={`Expected income from ${cat.label}`}
                    value={income[cat.id] ?? ''}
                    onChange={e => setIncome(prev => ({ ...prev, [cat.id]: e.target.value }))}
                    className="w-full min-h-[36px] p-1.5 pl-6 text-sm text-right border border-lantern-border rounded-lg bg-lantern-surface text-lantern-text focus:ring-2 focus:ring-lantern-primary focus:border-transparent"
                    placeholder="0"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Savings as a planned allocation, not whatever survives the month. */}
        <div>
          <label htmlFor="budget-savings" className="block text-sm font-medium text-lantern-text">
            Planned savings (₦)
          </label>
          <div className="relative mt-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lantern-text-muted">₦</span>
            <input
              type="number"
              id="budget-savings"
              min="0"
              step="0.01"
              value={savings}
              onChange={e => setSavings(e.target.value)}
              className="w-full min-h-[44px] p-2 pl-8 border border-lantern-border rounded-lg bg-lantern-surface text-lantern-text focus:ring-2 focus:ring-lantern-primary focus:border-transparent"
              placeholder="0.00"
            />
          </div>
        </div>

        {/* The zero-based check, live as you type. */}
        {planSummary.totalPlannedIncome > 0 && (
          <div
            className={`rounded-lg border p-3 text-center ${
              planSummary.isBalanced
                ? 'border-emerald-500 bg-emerald-500/10'
                : 'border-lantern-border bg-lantern-background-secondary'
            }`}
          >
            <p className="text-sm text-lantern-text-secondary">
              {planSummary.isBalanced
                ? 'Balanced — every naira has a job'
                : planSummary.leftToAllocate > 0
                  ? 'Left to allocate'
                  : 'Over-committed by'}
            </p>
            <p
              className={`text-2xl font-bold ${
                planSummary.isBalanced
                  ? 'text-emerald-500'
                  : planSummary.leftToAllocate > 0
                    ? 'text-lantern-text'
                    : 'text-red-500'
              }`}
            >
              {planSummary.isBalanced
                ? '✓'
                : `₦${Math.abs(Math.round(planSummary.leftToAllocate)).toLocaleString('en-NG')}`}
            </p>
            <p className="text-xs text-lantern-text-tertiary mt-1">
              ₦{planSummary.totalPlannedIncome.toLocaleString('en-NG')} income − ₦
              {planSummary.totalPlannedExpenses.toLocaleString('en-NG')} expenses − ₦
              {planSummary.plannedSavings.toLocaleString('en-NG')} savings
            </p>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 py-2 text-sm font-medium text-lantern-text bg-lantern-background-secondary rounded-lg hover:opacity-90"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="min-h-[44px] px-4 py-2 text-sm font-medium text-white bg-lantern-primary hover:bg-lantern-primary-dark rounded-lg shadow-sm"
          >
            Save Budget
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default SetBudgetModal;
