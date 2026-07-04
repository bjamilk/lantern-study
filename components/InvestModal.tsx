import React, { useState } from 'react';
import { XCircleIcon } from '@heroicons/react/24/outline';
import { useBudgetStore } from '../stores/budgetStore';
import {
  createSavingsGoalApi,
  contributeToSavingsGoalApi,
  deleteSavingsGoalApi,
} from '../services/budgetApi';
import { TransactionType } from '../types';

interface SavingsGoalModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUserId: string;
}

const GOAL_ICONS = ['🎯', '📱', '💻', '📚', '✈️', '🏠', '🎓', '🛵', '👟', '🎮', '💍', '🐷', '🎸', '📷', '🎂'];

const SavingsGoalModal: React.FC<SavingsGoalModalProps> = ({ isOpen, onClose, currentUserId }) => {
  const {
    savingsGoals,
    addSavingsGoal,
    updateSavingsGoal,
    removeSavingsGoal,
    setWalletBalance,
    addTransaction,
  } = useBudgetStore();
  const [mode, setMode] = useState<'list' | 'create' | 'contribute'>('list');
  const [name, setName] = useState('');
  const [targetAmount, setTargetAmount] = useState<number | ''>('');
  const [icon, setIcon] = useState('🎯');
  const [deadline, setDeadline] = useState('');
  const [contributeGoalId, setContributeGoalId] = useState('');
  const [contributeAmount, setContributeAmount] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleCreateGoal = async () => {
    if (!name.trim() || !targetAmount || targetAmount <= 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createSavingsGoalApi({
        name: name.trim(),
        targetAmount: Number(targetAmount),
        icon,
        deadline: deadline || undefined,
      });
      addSavingsGoal({ ...result.goal, userId: currentUserId });
      setWalletBalance(result.walletBalance);
      setName('');
      setTargetAmount('');
      setIcon('🎯');
      setDeadline('');
      setMode('list');
    } catch (e: any) {
      setError(e?.message || 'Failed to create goal');
    } finally {
      setBusy(false);
    }
  };

  const handleContribute = async () => {
    if (!contributeGoalId || !contributeAmount || contributeAmount <= 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await contributeToSavingsGoalApi(contributeGoalId, Number(contributeAmount));
      updateSavingsGoal(contributeGoalId, {
        currentAmount: result.goal.currentAmount,
        completedAt: result.goal.completedAt,
      });
      setWalletBalance(result.walletBalance);
      if (result.transaction) {
        addTransaction({
          id: result.transaction.id,
          userId: currentUserId,
          type: TransactionType.INVESTMENT,
          amount: result.transaction.amount,
          category: result.transaction.category || 'savings',
          description: result.transaction.description || '',
          date: result.transaction.date,
        });
      }
      setContributeAmount('');
      setMode('list');
    } catch (e: any) {
      setError(e?.message || 'Failed to contribute');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (goalId: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await deleteSavingsGoalApi(goalId);
      removeSavingsGoal(goalId);
      setWalletBalance(result.walletBalance);
    } catch (e: any) {
      setError(e?.message || 'Failed to delete goal');
    } finally {
      setBusy(false);
    }
  };

  const openContribute = (goalId: string) => {
    setContributeGoalId(goalId);
    setContributeAmount('');
    setMode('contribute');
  };

  const activeGoals = savingsGoals.filter(g => !g.completedAt);
  const completedGoals = savingsGoals.filter(g => g.completedAt);
  const contributeGoal = savingsGoals.find(g => g.id === contributeGoalId);

  return (
    <div className="fixed inset-0 bg-black/60 dark:bg-black/75 flex items-center justify-center p-4 z-[80]" role="dialog" aria-modal="true">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-md overflow-hidden max-h-[85vh] flex flex-col">
        <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-4 flex justify-between items-center shrink-0">
          <h2 className="text-lg font-bold text-white">
            {mode === 'create' ? 'New Savings Goal' : mode === 'contribute' ? 'Add to Goal' : 'Savings Goals'}
          </h2>
          <button onClick={onClose} className="text-white/70 hover:text-white"><XCircleIcon className="w-6 h-6" /></button>
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          {error && (
            <p className="mb-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{error}</p>
          )}

          {mode === 'list' && (
            <div className="space-y-4">
              <button onClick={() => setMode('create')} disabled={busy}
                className="w-full py-3 border-2 border-dashed border-amber-300 dark:border-amber-700 rounded-xl text-sm font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors">
                + Create New Goal
              </button>

              {activeGoals.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold uppercase text-slate-400 tracking-wider">Active Goals</h3>
                  {activeGoals.map(goal => {
                    const pct = goal.targetAmount > 0 ? (goal.currentAmount / goal.targetAmount) * 100 : 0;
                    return (
                      <div key={goal.id} className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-4">
                        <div className="flex items-center gap-3 mb-2">
                          <span className="text-2xl">{goal.icon}</span>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-medium text-sm text-slate-800 dark:text-slate-100 truncate">{goal.name}</h4>
                            {goal.deadline && (
                              <p className="text-xs text-slate-400">Due {new Date(goal.deadline).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                            )}
                          </div>
                          <button onClick={() => void handleRemove(goal.id)} disabled={busy} className="text-slate-300 hover:text-red-500 text-xs">✕</button>
                        </div>
                        <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
                          <span>₦{goal.currentAmount.toLocaleString('en-NG')}</span>
                          <span>₦{goal.targetAmount.toLocaleString('en-NG')}</span>
                        </div>
                        <div className="w-full bg-slate-200 dark:bg-slate-600 rounded-full h-2.5 mb-2">
                          <div className="h-2.5 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all" style={{ width: `${Math.min(pct, 100)}%` }} />
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-slate-400">{pct.toFixed(0)}%</span>
                          <button onClick={() => openContribute(goal.id)}
                            className="text-xs font-semibold text-amber-600 dark:text-amber-400 hover:underline">
                            + Add Funds
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {completedGoals.length > 0 && (
                <div className="space-y-3 mt-4">
                  <h3 className="text-xs font-semibold uppercase text-slate-400 tracking-wider">Completed</h3>
                  {completedGoals.map(goal => (
                    <div key={goal.id} className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-3 flex items-center gap-3">
                      <span className="text-xl">{goal.icon}</span>
                      <div className="flex-1">
                        <p className="font-medium text-sm text-emerald-700 dark:text-emerald-300">{goal.name}</p>
                        <p className="text-xs text-emerald-500">₦{goal.targetAmount.toLocaleString('en-NG')} saved!</p>
                      </div>
                      <span className="text-emerald-500 text-lg">✓</span>
                    </div>
                  ))}
                </div>
              )}

              {savingsGoals.length === 0 && (
                <div className="text-center py-6">
                  <div className="text-4xl mb-2">🎯</div>
                  <p className="text-slate-400 text-sm">Set goals like "New Laptop", "Emergency Fund", or "Vacation"!</p>
                </div>
              )}
            </div>
          )}

          {mode === 'create' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Goal Name</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} required
                  className="w-full p-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                  placeholder="e.g. New Laptop, Emergency Fund" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Target Amount (₦)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-semibold">₦</span>
                  <input type="number" value={targetAmount} onChange={(e) => setTargetAmount(e.target.value === '' ? '' : parseFloat(e.target.value))} required min="100"
                    className="w-full p-2.5 pl-8 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-lg font-semibold focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                    placeholder="50,000" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Icon</label>
                <div className="flex flex-wrap gap-2">
                  {GOAL_ICONS.map(i => (
                    <button key={i} type="button" onClick={() => setIcon(i)}
                      className={`w-10 h-10 rounded-xl text-xl flex items-center justify-center transition-all ${
                        icon === i ? 'bg-amber-100 dark:bg-amber-900/30 ring-2 ring-amber-400' : 'bg-slate-50 dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600'
                      }`}>
                      {i}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Deadline (optional)</label>
                <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)}
                  className="w-full p-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-amber-400 focus:border-transparent" />
              </div>
              <div className="flex gap-3 pt-1">
                <button onClick={() => setMode('list')} className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600">Back</button>
                <button onClick={() => void handleCreateGoal()} disabled={busy || !name.trim() || !targetAmount} className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-xl shadow-sm disabled:opacity-40">Create Goal</button>
              </div>
            </div>
          )}

          {mode === 'contribute' && contributeGoal && (
            <div className="space-y-4">
              <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-4 text-center">
                <span className="text-3xl">{contributeGoal.icon}</span>
                <h3 className="font-semibold text-slate-800 dark:text-slate-100 mt-1">{contributeGoal.name}</h3>
                <p className="text-sm text-slate-400 mt-1">
                  ₦{contributeGoal.currentAmount.toLocaleString('en-NG')} / ₦{contributeGoal.targetAmount.toLocaleString('en-NG')}
                </p>
                <p className="text-xs text-amber-500 mt-0.5">
                  ₦{(contributeGoal.targetAmount - contributeGoal.currentAmount).toLocaleString('en-NG')} remaining
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Amount to Add (₦)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-semibold">₦</span>
                  <input type="number" value={contributeAmount} onChange={(e) => setContributeAmount(e.target.value === '' ? '' : parseFloat(e.target.value))} required min="1"
                    className="w-full p-2.5 pl-8 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-lg font-semibold focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                    placeholder="0" />
                </div>
              </div>
              <div className="flex gap-3 pt-1">
                <button onClick={() => setMode('list')} className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600">Back</button>
                <button onClick={() => void handleContribute()} disabled={busy || !contributeAmount || contributeAmount <= 0} className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-xl shadow-sm disabled:opacity-40">Add Funds</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SavingsGoalModal;
