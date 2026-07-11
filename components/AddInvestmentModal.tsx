import React, { useState } from 'react';
import { useToastStore } from '../stores/toastStore';
import { TransactionType, Transaction } from '../types';
import { XMarkIcon } from '@heroicons/react/24/outline';
import Modal from './ui/Modal';

interface AddInvestmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (transaction: Omit<Transaction, 'id' | 'userId'>) => void;
}

const AddInvestmentModal: React.FC<AddInvestmentModalProps> = ({ isOpen, onClose, onSubmit }) => {
  const [amount, setAmount] = useState<number | ''>('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (amount === '' || amount <= 0) {
      useToastStore.getState().showToast('Please enter a valid positive amount.', 'error');
      return;
    }
    onSubmit({
      type: TransactionType.INVESTMENT,
      amount: Number(amount),
      category: 'other',
      description,
      date,
    });
    setAmount('');
    setDescription('');
    setDate(new Date().toISOString().split('T')[0]);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="add-investment-modal-title"
      maxWidthClass="max-w-md"
      panelClassName="!p-0 overflow-hidden"
    >
      <div className="bg-gradient-to-r from-lantern-primary to-lantern-primary-dark px-5 py-4 flex justify-between items-center">
        <h2 id="add-investment-modal-title" className="text-lg font-bold text-white">Add Investment</h2>
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-white/70 hover:text-white rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          aria-label="Close add investment dialog"
        >
          <XMarkIcon className="w-6 h-6" aria-hidden />
        </button>
      </div>
      <form onSubmit={handleSubmit} className="p-5 space-y-4 bg-lantern-surface">
        <p className="text-xs text-lantern-text-muted">Log savings or investment contributions.</p>
        <div>
          <label htmlFor="investment-amount" className="block text-sm font-medium text-lantern-text mb-1">Amount (₦)</label>
          <input
            id="investment-amount"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value === '' ? '' : parseFloat(e.target.value))}
            required
            min="0.01"
            step="0.01"
            className="w-full min-h-[44px] p-2.5 border border-lantern-border rounded-xl bg-lantern-surface text-lantern-text focus:ring-2 focus:ring-lantern-primary focus:border-transparent"
            placeholder="0.00"
          />
        </div>
        <div>
          <label htmlFor="investment-description" className="block text-sm font-medium text-lantern-text mb-1">Description</label>
          <input
            id="investment-description"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
            className="w-full min-h-[44px] p-2.5 border border-lantern-border rounded-xl bg-lantern-surface text-lantern-text focus:ring-2 focus:ring-lantern-primary focus:border-transparent"
            placeholder="e.g. Savings plan deposit"
          />
        </div>
        <div>
          <label htmlFor="investment-date" className="block text-sm font-medium text-lantern-text mb-1">Date</label>
          <input
            id="investment-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            className="w-full min-h-[44px] p-2.5 border border-lantern-border rounded-xl bg-lantern-surface text-lantern-text focus:ring-2 focus:ring-lantern-primary focus:border-transparent"
          />
        </div>
        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose} className="flex-1 min-h-[44px] px-4 py-2.5 text-sm font-medium text-lantern-text bg-lantern-background-secondary rounded-xl hover:opacity-90">Cancel</button>
          <button type="submit" className="flex-1 min-h-[44px] px-4 py-2.5 text-sm font-semibold text-white bg-lantern-primary hover:bg-lantern-primary-dark rounded-xl">Add Investment</button>
        </div>
      </form>
    </Modal>
  );
};

export default AddInvestmentModal;
