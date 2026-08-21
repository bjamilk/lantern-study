import React, { useState, useRef, useEffect } from 'react';
import { todayDateOnlyLocal } from '@lantern/shared/utils/dateOnly';
import { useToastStore } from '../stores/toastStore';
import { TransactionType, Transaction, STUDENT_EXPENSE_CATEGORIES, STUDENT_INCOME_CATEGORIES } from '../types';
import { XMarkIcon } from '@heroicons/react/24/outline';
import Modal from './ui/Modal';

type TxKind = 'expense' | 'income';

interface AddTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Which side the sheet opens on (the toggle can still flip it). */
  initialType?: TxKind;
  onSubmit: (transaction: Omit<Transaction, 'id' | 'userId'>) => void;
}

const QUICK_AMOUNTS = [100, 500, 1000, 2000, 5000];

const AddTransactionModal: React.FC<AddTransactionModalProps> = ({ isOpen, onClose, initialType = 'expense', onSubmit }) => {
  const [kind, setKind] = useState<TxKind>(initialType);
  const [amount, setAmount] = useState<number | ''>('');
  const [category, setCategory] = useState(STUDENT_EXPENSE_CATEGORIES[0].id);
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayDateOnlyLocal());
  const amountRef = useRef<HTMLInputElement>(null);

  const cats = kind === 'income' ? STUDENT_INCOME_CATEGORIES : STUDENT_EXPENSE_CATEGORIES;
  // One accent drives the whole sheet so it reads as income (green) or expense
  // (red). Full literal class names (not interpolated) so Tailwind emits them.
  const ringClass = kind === 'income' ? 'focus:ring-lantern-success' : 'focus:ring-lantern-error';

  // Open on the requested side and clear the form.
  useEffect(() => {
    if (isOpen) {
      setKind(initialType);
      setAmount('');
      setDescription('');
      setDate(todayDateOnlyLocal());
    }
  }, [isOpen, initialType]);

  // Keep the category valid for the current side.
  useEffect(() => {
    setCategory(cats[0].id);
  }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const bumpAmount = (delta: number) => {
    setAmount(prev => (prev === '' ? delta : Math.round((Number(prev) + delta) * 100) / 100));
    amountRef.current?.focus();
  };

  const save = (closeAfter: boolean) => {
    if (amount === '' || amount <= 0) {
      useToastStore.getState().showToast('Please enter a valid positive amount.', 'error');
      return;
    }
    const selected = cats.find(c => c.id === category);
    onSubmit({
      type: kind === 'income' ? TransactionType.INCOME : TransactionType.EXPENSE,
      amount: Number(amount),
      category,
      description: description.trim() || selected?.label || (kind === 'income' ? 'Income' : 'Expense'),
      date,
    });
    setAmount('');
    setDescription('');
    if (closeAfter) {
      onClose();
    } else {
      useToastStore.getState().showToast(`${kind === 'income' ? 'Income' : 'Expense'} added ✓`, 'success');
      amountRef.current?.focus();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    save(true);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="add-transaction-modal-title"
      maxWidthClass="max-w-md"
      panelClassName="!p-0 overflow-hidden max-h-[90vh] flex flex-col"
    >
      <div className={`bg-gradient-to-r ${kind === 'income' ? 'from-lantern-success to-emerald-600' : 'from-lantern-error to-rose-600'} px-5 py-4 flex justify-between items-center shrink-0 transition-colors`}>
        <h2 id="add-transaction-modal-title" className="text-lg font-bold text-white">Add transaction</h2>
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-white/70 hover:text-white rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          aria-label="Close add transaction dialog"
        >
          <XMarkIcon className="w-6 h-6" aria-hidden />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="p-5 space-y-4 bg-lantern-surface overflow-y-auto">
        {/* Expense / Income toggle */}
        <div className="flex gap-1 bg-lantern-background-secondary rounded-xl p-1" role="tablist" aria-label="Transaction type">
          {(['expense', 'income'] as const).map(k => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              onClick={() => setKind(k)}
              className={`flex-1 min-h-[40px] rounded-lg text-sm font-semibold transition-colors ${
                kind === k
                  ? k === 'income'
                    ? 'bg-lantern-success text-white'
                    : 'bg-lantern-error text-white'
                  : 'text-lantern-text-secondary'
              }`}
            >
              {k === 'income' ? 'Income' : 'Expense'}
            </button>
          ))}
        </div>

        {/* Amount + quick chips */}
        <div>
          <label htmlFor="tx-amount" className="block text-sm font-medium text-lantern-text mb-1">Amount (₦)</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lantern-text-muted font-semibold">₦</span>
            <input
              ref={amountRef}
              type="number"
              id="tx-amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value === '' ? '' : parseFloat(e.target.value))}
              required
              min="0.01"
              step="0.01"
              autoFocus
              className={`w-full min-h-[44px] p-2.5 pl-8 border border-lantern-border rounded-xl bg-lantern-surface text-lantern-text text-lg font-semibold focus:ring-2 ${ringClass} focus:border-transparent`}
              placeholder="0.00"
            />
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {QUICK_AMOUNTS.map(v => (
              <button
                key={v}
                type="button"
                onClick={() => bumpAmount(v)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-lantern-background-secondary text-lantern-text-secondary hover:bg-lantern-border"
              >
                +₦{v.toLocaleString('en-NG')}
              </button>
            ))}
            {amount !== '' && (
              <button
                type="button"
                onClick={() => { setAmount(''); amountRef.current?.focus(); }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-lantern-text-tertiary hover:text-lantern-error"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Category */}
        <div>
          <p className="block text-sm font-medium text-lantern-text mb-1">{kind === 'income' ? 'Source' : 'Category'}</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-44 overflow-y-auto" role="group" aria-label="Category">
            {cats.map(cat => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategory(cat.id)}
                aria-pressed={category === cat.id}
                className={`flex flex-col items-center p-2 rounded-xl text-xs font-medium transition-all min-h-[44px] min-w-0 ${
                  category === cat.id
                    ? kind === 'income'
                      ? 'bg-lantern-success/10 ring-2 ring-lantern-success text-lantern-success'
                      : 'bg-lantern-error/10 ring-2 ring-lantern-error text-lantern-error'
                    : 'bg-lantern-background-secondary text-lantern-text-muted hover:bg-lantern-surface-secondary'
                }`}
              >
                <span className="text-lg mb-0.5" aria-hidden>{cat.icon}</span>
                <span className="line-clamp-2 text-center leading-tight text-[11px] sm:text-xs">{cat.label.split('(')[0].split('/')[0].split('&')[0].trim()}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Description */}
        <div>
          <label htmlFor="tx-description" className="block text-sm font-medium text-lantern-text mb-1">Description <span className="text-lantern-text-muted font-normal">(optional)</span></label>
          <input
            type="text"
            id="tx-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={`w-full min-h-[44px] p-2.5 border border-lantern-border rounded-xl bg-lantern-surface text-lantern-text focus:ring-2 ${ringClass} focus:border-transparent`}
            placeholder={kind === 'income' ? 'e.g. Allowance from Dad' : 'What did you spend on?'}
          />
        </div>

        {/* Date */}
        <div>
          <label htmlFor="tx-date" className="block text-sm font-medium text-lantern-text mb-1">Date</label>
          <input
            type="date"
            id="tx-date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            className={`w-full min-h-[44px] p-2.5 border border-lantern-border rounded-xl bg-lantern-surface text-lantern-text focus:ring-2 ${ringClass} focus:border-transparent`}
          />
        </div>

        <div className="space-y-2 pt-1">
          <button
            type="submit"
            className={`w-full min-h-[44px] px-4 py-2.5 text-sm font-semibold text-white rounded-xl shadow-sm hover:opacity-90 ${kind === 'income' ? 'bg-lantern-success' : 'bg-lantern-error'}`}
          >
            {kind === 'income' ? 'Add income' : 'Add expense'}
          </button>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 min-h-[44px] px-4 py-2.5 text-sm font-medium text-lantern-text bg-lantern-background-secondary rounded-xl hover:opacity-90"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => save(false)}
              className={`flex-1 min-h-[44px] px-4 py-2.5 text-sm font-medium rounded-xl ${kind === 'income' ? 'text-lantern-success bg-lantern-success/10 hover:bg-lantern-success/20' : 'text-lantern-error bg-lantern-error/10 hover:bg-lantern-error/20'}`}
            >
              Add another
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
};

export default AddTransactionModal;
