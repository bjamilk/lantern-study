import React, { useState, useRef } from 'react';
import { todayDateOnlyLocal } from '@lantern/shared/utils/dateOnly';
import { useToastStore } from '../stores/toastStore';
import { TransactionType, Transaction, STUDENT_EXPENSE_CATEGORIES } from '../types';
import { XMarkIcon } from '@heroicons/react/24/outline';
import Modal from './ui/Modal';

interface AddExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (transaction: Omit<Transaction, 'id' | 'userId'>) => void;
}

const AddExpenseModal: React.FC<AddExpenseModalProps> = ({ isOpen, onClose, onSubmit }) => {
  const [amount, setAmount] = useState<number | ''>('');
  const [category, setCategory] = useState(STUDENT_EXPENSE_CATEGORIES[0].id);
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayDateOnlyLocal());
  const amountRef = useRef<HTMLInputElement>(null);

  // closeAfter=false keeps the sheet open for rapid multi-entry (a day's
  // spending in one sitting): the amount/description clear, category+date stay.
  const save = (closeAfter: boolean) => {
    if (amount === '' || amount <= 0) {
      useToastStore.getState().showToast('Please enter a valid positive amount.', 'error');
      return;
    }
    const selected = STUDENT_EXPENSE_CATEGORIES.find(c => c.id === category);
    onSubmit({
      type: TransactionType.EXPENSE,
      amount: Number(amount),
      category,
      // Description is optional — fall back to the category label so the row
      // still reads sensibly in the list.
      description: description.trim() || selected?.label || 'Expense',
      date,
    });
    setAmount('');
    setDescription('');
    if (closeAfter) {
      onClose();
    } else {
      useToastStore.getState().showToast('Expense added ✓', 'success');
      amountRef.current?.focus();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    save(true);
  };

  const selectedCat = STUDENT_EXPENSE_CATEGORIES.find(c => c.id === category);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="add-expense-modal-title"
      maxWidthClass="max-w-md"
      panelClassName="!p-0 overflow-hidden"
    >
      <div className="bg-gradient-to-r from-lantern-error to-rose-600 px-5 py-4 flex justify-between items-center">
        <h2 id="add-expense-modal-title" className="text-lg font-bold text-white">Add Expense</h2>
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-white/70 hover:text-white rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          aria-label="Close add expense dialog"
        >
          <XMarkIcon className="w-6 h-6" aria-hidden />
        </button>
      </div>
      <form onSubmit={handleSubmit} className="p-5 space-y-4 bg-lantern-surface">
        <div>
          <label htmlFor="expense-amount" className="block text-sm font-medium text-lantern-text mb-1">Amount (₦)</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lantern-text-muted font-semibold">₦</span>
            <input
              ref={amountRef}
              type="number"
              id="expense-amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value === '' ? '' : parseFloat(e.target.value))}
              required
              min="0.01"
              step="0.01"
              className="w-full min-h-[44px] p-2.5 pl-8 border border-lantern-border rounded-xl bg-lantern-surface text-lantern-text text-lg font-semibold focus:ring-2 focus:ring-lantern-error focus:border-transparent"
              placeholder="0.00"
            />
          </div>
        </div>
        <div>
          <p className="block text-sm font-medium text-lantern-text mb-1">Category</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-48 overflow-y-auto" role="group" aria-label="Expense category">
            {STUDENT_EXPENSE_CATEGORIES.map(cat => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategory(cat.id)}
                aria-pressed={category === cat.id}
                className={`flex flex-col items-center p-2 rounded-xl text-xs font-medium transition-all min-h-[44px] min-w-0 ${
                  category === cat.id
                    ? 'bg-lantern-error/10 ring-2 ring-lantern-error text-lantern-error'
                    : 'bg-lantern-background-secondary text-lantern-text-muted hover:bg-lantern-surface-secondary'
                }`}
              >
                <span className="text-lg mb-0.5" aria-hidden>{cat.icon}</span>
                <span className="line-clamp-2 text-center leading-tight text-[11px] sm:text-xs">{cat.label.split('/')[0].split('&')[0].trim()}</span>
              </button>
            ))}
          </div>
          {selectedCat && (
            <p className="text-xs text-lantern-text-muted mt-1.5">Selected: {selectedCat.icon} {selectedCat.label}</p>
          )}
        </div>
        <div>
          <label htmlFor="expense-description" className="block text-sm font-medium text-lantern-text mb-1">Description <span className="text-lantern-text-muted font-normal">(optional)</span></label>
          <input
            type="text"
            id="expense-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full min-h-[44px] p-2.5 border border-lantern-border rounded-xl bg-lantern-surface text-lantern-text focus:ring-2 focus:ring-lantern-error focus:border-transparent"
            placeholder="What did you spend on?"
          />
        </div>
        <div>
          <label htmlFor="expense-date" className="block text-sm font-medium text-lantern-text mb-1">Date</label>
          <input
            type="date"
            id="expense-date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            className="w-full min-h-[44px] p-2.5 border border-lantern-border rounded-xl bg-lantern-surface text-lantern-text focus:ring-2 focus:ring-lantern-error focus:border-transparent"
          />
        </div>
        <div className="space-y-2 pt-1">
          <button
            type="submit"
            className="w-full min-h-[44px] px-4 py-2.5 text-sm font-semibold text-white bg-lantern-error hover:opacity-90 rounded-xl shadow-sm"
          >
            Add expense
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
              className="flex-1 min-h-[44px] px-4 py-2.5 text-sm font-medium text-lantern-error bg-lantern-error/10 rounded-xl hover:bg-lantern-error/20"
            >
              Add another
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
};

export default AddExpenseModal;
