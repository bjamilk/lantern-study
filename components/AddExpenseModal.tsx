import React, { useState } from 'react';
import { TransactionType, Transaction, STUDENT_EXPENSE_CATEGORIES } from '../types';
import { XCircleIcon } from '@heroicons/react/24/outline';

interface AddExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (transaction: Omit<Transaction, 'id' | 'userId'>) => void;
}

const AddExpenseModal: React.FC<AddExpenseModalProps> = ({ isOpen, onClose, onSubmit }) => {
  const [amount, setAmount] = useState<number | ''>('');
  const [category, setCategory] = useState(STUDENT_EXPENSE_CATEGORIES[0].id);
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (amount === '' || amount <= 0) {
      alert('Please enter a valid positive amount.');
      return;
    }
    onSubmit({
      type: TransactionType.EXPENSE,
      amount: Number(amount),
      category,
      description,
      date,
    });
    setAmount(''); setDescription(''); setDate(new Date().toISOString().split('T')[0]);
  };

  const selectedCat = STUDENT_EXPENSE_CATEGORIES.find(c => c.id === category);

  return (
    <div className="fixed inset-0 bg-black/60 dark:bg-black/75 flex items-center justify-center p-4 z-[80]" role="dialog" aria-modal="true">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="bg-gradient-to-r from-red-500 to-rose-600 px-5 py-4 flex justify-between items-center">
          <h2 className="text-lg font-bold text-white">Add Expense</h2>
          <button onClick={onClose} className="text-white/70 hover:text-white"><XCircleIcon className="w-6 h-6" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Amount (₦)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-semibold">₦</span>
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value === '' ? '' : parseFloat(e.target.value))} required min="0.01" step="0.01" className="w-full p-2.5 pl-8 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-lg font-semibold focus:ring-2 focus:ring-red-400 focus:border-transparent" placeholder="0.00"/>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Category</label>
            <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto">
              {STUDENT_EXPENSE_CATEGORIES.map(cat => (
                <button key={cat.id} type="button" onClick={() => setCategory(cat.id)}
                  className={`flex flex-col items-center p-2 rounded-xl text-xs font-medium transition-all ${
                    category === cat.id
                      ? 'bg-red-50 dark:bg-red-900/30 ring-2 ring-red-400 text-red-700 dark:text-red-300'
                      : 'bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-600'
                  }`}>
                  <span className="text-lg mb-0.5">{cat.icon}</span>
                  <span className="line-clamp-1 text-center leading-tight" style={{fontSize: '10px'}}>{cat.label.split('/')[0].split('&')[0].trim()}</span>
                </button>
              ))}
            </div>
            {selectedCat && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">Selected: {selectedCat.icon} {selectedCat.label}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Description</label>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} required className="w-full p-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-red-400 focus:border-transparent" placeholder="What did you spend on?"/>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className="w-full p-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-red-400 focus:border-transparent"/>
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600">Cancel</button>
            <button type="submit" className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-red-500 hover:bg-red-600 rounded-xl shadow-sm">Add Expense</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddExpenseModal;