import React, { useState } from 'react';
import { ExpenseSplit, STUDENT_EXPENSE_CATEGORIES } from '../types';
import { PlusIcon, TrashIcon, UserPlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useBudgetStore } from '../stores/budgetStore';
import Modal from './ui/Modal';

interface ExpenseSplitModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUserId: string;
  currentUserName: string;
}

const ExpenseSplitModal: React.FC<ExpenseSplitModalProps> = ({ isOpen, onClose, currentUserId, currentUserName }) => {
  const { expenseSplits, addExpenseSplit, updateExpenseSplit, removeExpenseSplit } = useBudgetStore();
  const [mode, setMode] = useState<'list' | 'create'>('list');
  const [title, setTitle] = useState('');
  const [totalAmount, setTotalAmount] = useState<number | ''>('');
  const [category, setCategory] = useState('food_feeding');
  const [participants, setParticipants] = useState<{ name: string }[]>([{ name: '' }]);

  if (!isOpen) return null;

  const activeSplits = expenseSplits.filter(s => s.status === 'active');
  const settledSplits = expenseSplits.filter(s => s.status === 'settled');

  const handleAddParticipant = () => {
    setParticipants([...participants, { name: '' }]);
  };

  const handleRemoveParticipant = (index: number) => {
    setParticipants(participants.filter((_, i) => i !== index));
  };

  const handleParticipantName = (index: number, name: string) => {
    const updated = [...participants];
    updated[index] = { name };
    setParticipants(updated);
  };

  const handleCreate = () => {
    if (!title.trim() || !totalAmount || totalAmount <= 0) return;
    const validParticipants = participants.filter(p => p.name.trim());
    if (validParticipants.length === 0) return;

    // Include creator + other participants
    const allNames = [currentUserName, ...validParticipants.map(p => p.name.trim())];
    const perPerson = Number(totalAmount) / allNames.length;

    const split: ExpenseSplit = {
      id: crypto.randomUUID(),
      creatorId: currentUserId,
      title: title.trim(),
      totalAmount: Number(totalAmount),
      category,
      participants: allNames.map((name, i) => ({
        userId: i === 0 ? currentUserId : `participant_${crypto.randomUUID().slice(0, 8)}`,
        userName: name,
        amount: Math.round(perPerson * 100) / 100,
        paid: i === 0, // creator is already "paid"
      })),
      status: 'active',
      createdAt: new Date().toISOString(),
    };

    addExpenseSplit(split);
    setTitle(''); setTotalAmount(''); setCategory('food_feeding'); setParticipants([{ name: '' }]);
    setMode('list');
  };

  const togglePaid = (splitId: string, participantIndex: number) => {
    const split = expenseSplits.find(s => s.id === splitId);
    if (!split) return;
    const updatedParticipants = split.participants.map((p, i) =>
      i === participantIndex ? { ...p, paid: !p.paid } : p
    );
    const allPaid = updatedParticipants.every(p => p.paid);
    updateExpenseSplit(splitId, {
      participants: updatedParticipants,
      status: allPaid ? 'settled' : 'active',
    });
  };

  const selectedCat = STUDENT_EXPENSE_CATEGORIES.find(c => c.id === category);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="expense-split-modal-title"
      maxWidthClass="max-w-md"
      panelClassName="!p-0 overflow-hidden max-h-[85vh] flex flex-col"
    >
      <div className="bg-gradient-to-r from-lantern-primary to-lantern-primary-dark px-5 py-4 flex justify-between items-center shrink-0">
        <h2 id="expense-split-modal-title" className="text-lg font-bold text-white">
          {mode === 'create' ? 'Split an Expense' : 'Expense Splits'}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-white/70 hover:text-white rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          aria-label="Close expense splits"
        >
          <XMarkIcon className="w-6 h-6" aria-hidden />
        </button>
      </div>

      <div className="p-5 overflow-y-auto flex-1 bg-lantern-surface">
          {/* LIST MODE */}
          {mode === 'list' && (
            <div className="space-y-4">
              <button onClick={() => setMode('create')}
                className="w-full py-3 border-2 border-dashed border-purple-300 dark:border-purple-700 rounded-xl text-sm font-medium text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors">
                + New Split
              </button>

              {activeSplits.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold uppercase text-lantern-text-tertiary tracking-wider">Active Splits</h3>
                  {activeSplits.map(split => {
                    const paidCount = split.participants.filter(p => p.paid).length;
                    const cat = STUDENT_EXPENSE_CATEGORIES.find(c => c.id === split.category);
                    return (
                      <div key={split.id} className="bg-lantern-background dark:bg-lantern-surface-secondary/50 rounded-xl p-4">
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <h4 className="font-medium text-sm text-lantern-text">
                              {cat?.icon || '📦'} {split.title}
                            </h4>
                            <p className="text-xs text-lantern-text-tertiary">₦{split.totalAmount.toLocaleString('en-NG')} total &middot; {split.participants.length} people</p>
                          </div>
                          <button onClick={() => removeExpenseSplit(split.id)} className="text-lantern-text-tertiary hover:text-red-500 text-xs">✕</button>
                        </div>
                        <div className="space-y-1.5">
                          {split.participants.map((p, i) => (
                            <div key={i} className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <button onClick={() => togglePaid(split.id, i)}
                                  className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
                                    p.paid ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-lantern-border dark:border-lantern-border'
                                  }`}>
                                  {p.paid && <span className="text-xs">✓</span>}
                                </button>
                                <span className={`text-sm ${p.paid ? 'text-lantern-text-tertiary line-through' : 'text-lantern-text'}`}>
                                  {p.userName} {p.userId === currentUserId ? '(you)' : ''}
                                </span>
                              </div>
                              <span className={`text-sm font-medium ${p.paid ? 'text-emerald-500' : 'text-lantern-text-secondary'}`}>
                                ₦{p.amount.toLocaleString('en-NG')}
                              </span>
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-1 mt-3">
                          {split.participants.map((p, i) => (
                            <div key={i} className={`flex-1 h-1.5 rounded-full ${p.paid ? 'bg-emerald-400' : 'bg-lantern-border'}`} />
                          ))}
                        </div>
                        <p className="text-xs text-lantern-text-tertiary mt-1">{paidCount}/{split.participants.length} paid</p>
                      </div>
                    );
                  })}
                </div>
              )}

              {settledSplits.length > 0 && (
                <div className="space-y-3 mt-4">
                  <h3 className="text-xs font-semibold uppercase text-lantern-text-tertiary tracking-wider">Settled</h3>
                  {settledSplits.slice(0, 3).map(split => {
                    const cat = STUDENT_EXPENSE_CATEGORIES.find(c => c.id === split.category);
                    return (
                      <div key={split.id} className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-3 flex items-center gap-3">
                        <span className="text-lg">{cat?.icon || '📦'}</span>
                        <div className="flex-1">
                          <p className="font-medium text-sm text-emerald-700 dark:text-emerald-300">{split.title}</p>
                          <p className="text-xs text-emerald-500">₦{split.totalAmount.toLocaleString('en-NG')} &middot; All settled!</p>
                        </div>
                        <span className="text-emerald-500">✓</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {expenseSplits.length === 0 && (
                <div className="text-center py-6">
                  <div className="text-4xl mb-2">🤝</div>
                  <p className="text-lantern-text-tertiary text-sm">Split rent, food, data, or any shared expense with roommates or friends!</p>
                </div>
              )}
            </div>
          )}

          {/* CREATE MODE */}
          {mode === 'create' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-lantern-text mb-1">What are you splitting?</label>
                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required
                  className="w-full p-2.5 border border-lantern-border rounded-xl bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text focus:ring-2 focus:ring-purple-400 focus:border-transparent"
                  placeholder="e.g. Monthly rent, Data subscription, Cooking gas" />
              </div>
              <div>
                <label className="block text-sm font-medium text-lantern-text mb-1">Total Amount (₦)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lantern-text-tertiary font-semibold">₦</span>
                  <input type="number" value={totalAmount} onChange={(e) => setTotalAmount(e.target.value === '' ? '' : parseFloat(e.target.value))} required min="1"
                    className="w-full p-2.5 pl-8 border border-lantern-border rounded-xl bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text text-lg font-semibold focus:ring-2 focus:ring-purple-400 focus:border-transparent"
                    placeholder="0" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-lantern-text mb-1">Category</label>
                <select value={category} onChange={(e) => setCategory(e.target.value)}
                  className="w-full p-2.5 border border-lantern-border rounded-xl bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text focus:ring-2 focus:ring-purple-400 focus:border-transparent">
                  {STUDENT_EXPENSE_CATEGORIES.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.icon} {cat.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-lantern-text mb-1">
                  Split with (you + {participants.filter(p => p.name.trim()).length} others)
                </label>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 bg-purple-50 dark:bg-purple-900/20 rounded-lg px-3 py-2">
                    <span className="text-sm text-purple-600 dark:text-purple-400 font-medium">{currentUserName} (you)</span>
                  </div>
                  {participants.map((p, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input type="text" value={p.name} onChange={(e) => handleParticipantName(i, e.target.value)}
                        className="flex-1 p-2 border border-lantern-border rounded-lg bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text text-sm focus:ring-2 focus:ring-purple-400 focus:border-transparent"
                        placeholder="Name of person" />
                      {participants.length > 1 && (
                        <button onClick={() => handleRemoveParticipant(i)} className="text-lantern-text-tertiary hover:text-red-500">
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                  <button onClick={handleAddParticipant}
                    className="flex items-center gap-1 text-sm text-purple-500 hover:text-purple-600 font-medium">
                    <UserPlusIcon className="w-4 h-4" /> Add person
                  </button>
                </div>
                {totalAmount && participants.filter(p => p.name.trim()).length > 0 && (
                  <p className="text-xs text-lantern-text-tertiary mt-2">
                    Each person pays: ₦{(Number(totalAmount) / (participants.filter(p => p.name.trim()).length + 1)).toLocaleString('en-NG', { maximumFractionDigits: 2 })}
                  </p>
                )}
              </div>
              <div className="flex gap-3 pt-1">
                <button onClick={() => setMode('list')} className="flex-1 px-4 py-2.5 text-sm font-medium text-lantern-text bg-lantern-background-secondary dark:bg-lantern-surface-secondary rounded-xl hover:bg-lantern-border">Back</button>
                <button onClick={handleCreate} disabled={!title.trim() || !totalAmount || participants.filter(p => p.name.trim()).length === 0}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-purple-500 hover:bg-purple-600 rounded-xl shadow-sm disabled:opacity-40">
                  Create Split
                </button>
              </div>
            </div>
          )}
        </div>
    </Modal>
  );
};

export default ExpenseSplitModal;
