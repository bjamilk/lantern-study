import React from 'react';
import { XCircleIcon, SparklesIcon, ArrowTrendingUpIcon, ShoppingBagIcon, AcademicCapIcon } from '@heroicons/react/24/outline';
import { useBudgetStore } from '../stores/budgetStore';
import { TransactionType, STUDENT_EXPENSE_CATEGORIES, STUDENT_INCOME_CATEGORIES } from '../types';

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const COIN_MILESTONES = [
  { coins: 100, reward: '🎨 Custom Theme Unlock', unlocked: false },
  { coins: 250, reward: '🏅 Silver Saver Badge', unlocked: false },
  { coins: 500, reward: '⭐ Premium Flashcard Templates', unlocked: false },
  { coins: 1000, reward: '🏆 Gold Achiever Badge', unlocked: false },
  { coins: 2500, reward: '💎 Diamond Status', unlocked: false },
];

const EARNING_METHODS = [
  { icon: '📝', action: 'Complete a study session', coins: '+5' },
  { icon: '✅', action: 'Pass a test (80%+)', coins: '+15' },
  { icon: '🃏', action: 'Review 20 flashcards', coins: '+10' },
  { icon: '🔥', action: 'Maintain 7-day streak', coins: '+50' },
  { icon: '💰', action: 'Stay under budget (monthly)', coins: '+100' },
  { icon: '🎯', action: 'Complete a savings goal', coins: '+75' },
];

const WalletModal: React.FC<WalletModalProps> = ({ isOpen, onClose }) => {
  const { walletBalance, transactions, savingsGoals } = useBudgetStore();

  if (!isOpen) return null;

  const currentMonth = new Date().toISOString().slice(0, 7);
  const monthlyTx = transactions.filter(t => t.date.startsWith(currentMonth));
  const monthlyExpenses = monthlyTx.filter(t => t.type === TransactionType.EXPENSE).reduce((s, t) => s + t.amount, 0);
  const monthlyIncome = monthlyTx.filter(t => t.type === TransactionType.INCOME).reduce((s, t) => s + t.amount, 0);
  const marketplacePurchases = monthlyTx.filter(t => t.category === 'marketplace_purchase').reduce((s, t) => s + t.amount, 0);
  const marketplaceSales = monthlyTx.filter(t => t.category === 'marketplace_sale').reduce((s, t) => s + t.amount, 0);
  const completedGoals = savingsGoals.filter(g => g.completedAt).length;

  const milestones = COIN_MILESTONES.map(m => ({ ...m, unlocked: walletBalance >= m.coins }));

  return (
    <div className="fixed inset-0 bg-black/60 dark:bg-black/75 flex items-center justify-center p-4 z-[80]" role="dialog" aria-modal="true">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-md overflow-hidden max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-600 to-pink-500 px-5 py-5 shrink-0">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <SparklesIcon className="w-5 h-5" /> Study Rewards Wallet
              </h2>
              <p className="text-white/60 text-xs mt-0.5">Earn coins by studying & saving smart</p>
            </div>
            <button onClick={onClose} className="text-white/70 hover:text-white"><XCircleIcon className="w-6 h-6" /></button>
          </div>
          <div className="mt-4 bg-white/15 backdrop-blur-sm rounded-xl p-4 text-center">
            <p className="text-white/60 text-xs">Your Balance</p>
            <p className="text-3xl font-bold text-white mt-0.5">{walletBalance.toLocaleString()} <span className="text-lg">coins</span></p>
          </div>
        </div>

        <div className="p-5 overflow-y-auto flex-1 space-y-5">
          {/* Quick Stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-3 text-center">
              <ShoppingBagIcon className="w-5 h-5 mx-auto text-indigo-500 mb-1" />
              <p className="text-xs text-slate-400">Marketplace Spend</p>
              <p className="font-semibold text-sm text-slate-700 dark:text-slate-200">₦{marketplacePurchases.toLocaleString('en-NG')}</p>
            </div>
            <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-3 text-center">
              <ArrowTrendingUpIcon className="w-5 h-5 mx-auto text-emerald-500 mb-1" />
              <p className="text-xs text-slate-400">Marketplace Earned</p>
              <p className="font-semibold text-sm text-slate-700 dark:text-slate-200">₦{marketplaceSales.toLocaleString('en-NG')}</p>
            </div>
            <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-3 text-center">
              <AcademicCapIcon className="w-5 h-5 mx-auto text-amber-500 mb-1" />
              <p className="text-xs text-slate-400">Goals Completed</p>
              <p className="font-semibold text-sm text-slate-700 dark:text-slate-200">{completedGoals}</p>
            </div>
            <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-3 text-center">
              <SparklesIcon className="w-5 h-5 mx-auto text-purple-500 mb-1" />
              <p className="text-xs text-slate-400">Net This Month</p>
              <p className={`font-semibold text-sm ${monthlyIncome - monthlyExpenses >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                ₦{(monthlyIncome - monthlyExpenses).toLocaleString('en-NG')}
              </p>
            </div>
          </div>

          {/* How to Earn */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">How to Earn Coins</h3>
            <div className="space-y-2">
              {EARNING_METHODS.map((m, i) => (
                <div key={i} className="flex items-center gap-3 bg-slate-50 dark:bg-slate-700/50 rounded-xl px-3 py-2">
                  <span className="text-lg">{m.icon}</span>
                  <span className="flex-1 text-xs text-slate-600 dark:text-slate-300">{m.action}</span>
                  <span className="text-xs font-bold text-emerald-500">{m.coins}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Milestones */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Milestones & Rewards</h3>
            <div className="space-y-2">
              {milestones.map((m, i) => (
                <div key={i} className={`flex items-center gap-3 rounded-xl px-3 py-2 ${m.unlocked ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-slate-50 dark:bg-slate-700/50'}`}>
                  <span className={`text-lg ${m.unlocked ? '' : 'grayscale opacity-40'}`}>{m.reward.split(' ')[0]}</span>
                  <div className="flex-1">
                    <p className={`text-xs font-medium ${m.unlocked ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-400'}`}>{m.reward.slice(m.reward.indexOf(' ') + 1)}</p>
                    <p className="text-xs text-slate-400">{m.coins} coins</p>
                  </div>
                  {m.unlocked ? (
                    <span className="text-emerald-500 text-xs font-semibold">✓ Unlocked</span>
                  ) : (
                    <span className="text-slate-300 dark:text-slate-600 text-xs">{m.coins - walletBalance} more</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-700 shrink-0">
          <button onClick={onClose} className="w-full px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600">Close</button>
        </div>
      </div>
    </div>
  );
};

export default WalletModal;
