import React, { useEffect, useState, useCallback } from 'react';
import { todayDateOnlyLocal } from '@lantern/shared/utils/dateOnly';
import { STUDENT_EXPENSE_CATEGORIES, STUDENT_INCOME_CATEGORIES } from '../types';
import { useToastStore } from '../stores/toastStore';
import {
  fetchRecurringRules,
  createRecurringRule,
  deleteRecurringRule,
  runRecurring,
  type RecurringRule,
} from '../services/budgetApi';
import { XMarkIcon, TrashIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import Modal from './ui/Modal';

interface RecurringModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after a rule is added/removed so the screen can re-run/refresh. */
  onChanged?: () => void;
}

const labelFor = (rule: RecurringRule) => {
  const cats = rule.type === 'income' ? STUDENT_INCOME_CATEGORIES : STUDENT_EXPENSE_CATEGORIES;
  const cat = cats.find(c => c.id === rule.category);
  return cat ? `${cat.icon} ${cat.label}` : rule.category || (rule.type === 'income' ? 'Income' : 'Expense');
};

const RecurringModal: React.FC<RecurringModalProps> = ({ isOpen, onClose, onChanged }) => {
  const [rules, setRules] = useState<RecurringRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [type, setType] = useState<'expense' | 'income'>('expense');
  const [amount, setAmount] = useState<number | ''>('');
  const [category, setCategory] = useState(STUDENT_EXPENSE_CATEGORIES[0].id);
  const [description, setDescription] = useState('');
  const [frequency, setFrequency] = useState<'weekly' | 'monthly'>('monthly');
  const [startDate, setStartDate] = useState(todayDateOnlyLocal());

  const categories = type === 'income' ? STUDENT_INCOME_CATEGORIES : STUDENT_EXPENSE_CATEGORIES;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRules(await fetchRecurringRules());
    } catch {
      useToastStore.getState().showToast('Could not load recurring items.', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void load();
      // Reset the form each open.
      setType('expense');
      setAmount('');
      setCategory(STUDENT_EXPENSE_CATEGORIES[0].id);
      setDescription('');
      setFrequency('monthly');
      setStartDate(todayDateOnlyLocal());
    }
  }, [isOpen, load]);

  // Keep the category valid when the type flips.
  useEffect(() => {
    setCategory(categories[0].id);
  }, [type]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAdd = async () => {
    if (amount === '' || amount <= 0) {
      useToastStore.getState().showToast('Enter a valid amount.', 'error');
      return;
    }
    setSaving(true);
    try {
      await createRecurringRule({
        type,
        amount: Number(amount),
        category,
        description: description.trim() || undefined,
        frequency,
        dayOfMonth: frequency === 'monthly' ? Number(startDate.slice(8, 10)) : undefined,
        nextDate: startDate,
      });
      useToastStore.getState().showToast('Recurring item added ✓', 'success');
      setAmount('');
      setDescription('');
      // If the start date is today/past, post it now so it shows immediately.
      await runRecurring().catch(() => {});
      await load();
      onChanged?.();
    } catch {
      useToastStore.getState().showToast('Could not add recurring item.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteRecurringRule(id);
      setRules(prev => prev.filter(r => r.id !== id));
      onChanged?.();
    } catch {
      useToastStore.getState().showToast('Could not remove recurring item.', 'error');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="recurring-modal-title"
      maxWidthClass="max-w-lg"
      panelClassName="!p-0 overflow-hidden max-h-[88vh] flex flex-col"
    >
      <div className="bg-gradient-to-r from-lantern-primary to-lantern-primary-dark px-5 py-4 flex justify-between items-center shrink-0">
        <h2 id="recurring-modal-title" className="text-lg font-bold text-white flex items-center gap-2">
          <ArrowPathIcon className="w-5 h-5" aria-hidden /> Recurring
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-white/70 hover:text-white rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          aria-label="Close recurring"
        >
          <XMarkIcon className="w-6 h-6" aria-hidden />
        </button>
      </div>

      <div className="p-5 overflow-y-auto flex-1 space-y-5 bg-lantern-surface">
        <p className="text-xs text-lantern-text-muted">
          Set up items that repeat — allowance, hostel, data. They post automatically on their date when you open Budget.
        </p>

        {/* Existing rules */}
        <div className="space-y-2">
          {loading ? (
            <p className="text-sm text-lantern-text-tertiary text-center py-4">Loading…</p>
          ) : rules.length === 0 ? (
            <p className="text-sm text-lantern-text-tertiary text-center py-4">No recurring items yet.</p>
          ) : (
            rules.map(rule => (
              <div key={rule.id} className="flex items-center justify-between bg-lantern-background-secondary/60 rounded-xl px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-lantern-text truncate">
                    {rule.description || labelFor(rule)}
                  </p>
                  <p className="text-xs text-lantern-text-tertiary">
                    {labelFor(rule)} · {rule.frequency === 'monthly' ? 'Monthly' : 'Weekly'} · next {rule.nextDate}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-sm font-semibold ${rule.type === 'income' ? 'text-emerald-500' : 'text-red-500'}`}>
                    {rule.type === 'income' ? '+' : '-'}₦{rule.amount.toLocaleString('en-NG')}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleDelete(rule.id)}
                    aria-label={`Remove recurring ${rule.description || labelFor(rule)}`}
                    className="text-lantern-text-tertiary hover:text-red-500"
                  >
                    <TrashIcon className="w-4 h-4" aria-hidden />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Add form */}
        <div className="border-t border-lantern-border pt-4 space-y-3">
          <div className="flex gap-1 bg-lantern-background-secondary rounded-xl p-1">
            {(['expense', 'income'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`flex-1 min-h-[40px] rounded-lg text-sm font-medium transition-colors ${
                  type === t ? 'bg-lantern-primary text-white' : 'text-lantern-text-secondary'
                }`}
              >
                {t === 'expense' ? 'Expense' : 'Income'}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="rec-amount" className="block text-xs font-medium text-lantern-text mb-1">Amount (₦)</label>
              <input
                id="rec-amount"
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value === '' ? '' : parseFloat(e.target.value))}
                className="w-full min-h-[44px] p-2 border border-lantern-border rounded-xl bg-lantern-surface text-lantern-text"
                placeholder="0.00"
              />
            </div>
            <div>
              <label htmlFor="rec-freq" className="block text-xs font-medium text-lantern-text mb-1">Repeats</label>
              <select
                id="rec-freq"
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as 'weekly' | 'monthly')}
                className="w-full min-h-[44px] p-2 border border-lantern-border rounded-xl bg-lantern-surface text-lantern-text"
              >
                <option value="monthly">Monthly</option>
                <option value="weekly">Weekly</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="rec-cat" className="block text-xs font-medium text-lantern-text mb-1">Category</label>
            <select
              id="rec-cat"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full min-h-[44px] p-2 border border-lantern-border rounded-xl bg-lantern-surface text-lantern-text"
            >
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.icon} {c.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="rec-desc" className="block text-xs font-medium text-lantern-text mb-1">Description <span className="text-lantern-text-muted font-normal">(optional)</span></label>
            <input
              id="rec-desc"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full min-h-[44px] p-2 border border-lantern-border rounded-xl bg-lantern-surface text-lantern-text"
              placeholder="e.g. Monthly allowance"
            />
          </div>

          <div>
            <label htmlFor="rec-date" className="block text-xs font-medium text-lantern-text mb-1">
              {frequency === 'monthly' ? 'First / next date (its day-of-month repeats)' : 'First / next date (repeats every 7 days)'}
            </label>
            <input
              id="rec-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full min-h-[44px] p-2 border border-lantern-border rounded-xl bg-lantern-surface text-lantern-text"
            />
          </div>

          <button
            type="button"
            onClick={() => void handleAdd()}
            disabled={saving}
            className="w-full min-h-[44px] px-4 py-2.5 text-sm font-semibold text-white bg-lantern-primary hover:bg-lantern-primary-dark rounded-xl shadow-sm disabled:opacity-60"
          >
            {saving ? 'Adding…' : 'Add recurring item'}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default RecurringModal;
