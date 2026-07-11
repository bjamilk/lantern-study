import React, { useState, useEffect } from 'react';
import { useToastStore } from '../stores/toastStore';
import { Budget } from '../types';
import { XMarkIcon } from '@heroicons/react/24/outline';
import Modal from './ui/Modal';

interface SetBudgetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (amount: number) => void;
  currentBudget: Budget | null;
}

const SetBudgetModal: React.FC<SetBudgetModalProps> = ({ isOpen, onClose, onSubmit, currentBudget }) => {
  const [amount, setAmount] = useState<number | ''>('');

  useEffect(() => {
    if (isOpen) {
      setAmount(currentBudget?.monthlyLimit || '');
    }
  }, [isOpen, currentBudget]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (amount === '' || amount <= 0) {
      useToastStore.getState().showToast('Please enter a valid positive amount for your budget.', 'error');
      return;
    }
    onSubmit(Number(amount));
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
