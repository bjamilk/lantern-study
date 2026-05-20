import React, { useState, useEffect } from 'react';
import { Budget } from '../types';
import { XCircleIcon } from '@heroicons/react/24/outline';

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

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (amount === '' || amount <= 0) {
      alert('Please enter a valid positive amount for your budget.');
      return;
    }
    onSubmit(Number(amount));
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true" aria-labelledby="set-budget-modal-title">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-md transform">
        <div className="flex justify-between items-center mb-4">
          <h2 id="set-budget-modal-title" className="text-xl font-semibold text-gray-800 dark:text-gray-100">{currentBudget ? 'Edit' : 'Set'} Monthly Budget</h2>
          <button onClick={onClose} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            <XCircleIcon className="w-6 h-6" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="budget-amount" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Total Budget Amount for this Month (₦)</label>
            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400">₦</span>
              <input 
                  type="number" 
                  id="budget-amount" 
                  value={amount} 
                  onChange={(e) => setAmount(e.target.value === '' ? '' : parseFloat(e.target.value))} 
                  required 
                  min="0.01" 
                  step="0.01" 
                  className="w-full p-2 pl-8 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200"
                  placeholder="e.g., 50000.00"
              />
            </div>
          </div>
          <div className="flex justify-end space-x-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-md dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600">Cancel</button>
            <button type="submit" className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm dark:bg-blue-500 dark:hover:bg-blue-600">Save Budget</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SetBudgetModal;