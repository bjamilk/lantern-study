import React from 'react';
import { SparklesIcon, ArrowTrendingUpIcon, ShoppingBagIcon, AcademicCapIcon } from '@heroicons/react/24/outline';
import { useBudgetStore } from '../stores/budgetStore';
import { TransactionType } from '../types';
import Modal from './ui/Modal';

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

  const currentMonth = new Date().toISOString().slice(0, 7);
  const monthlyTx = transactions.filter(t => t.date.startsWith(currentMonth));
  const monthlyExpenses = monthlyTx.filter(t => t.type === TransactionType.EXPENSE).reduce((s, t) => s + t.amount, 0);
  const monthlyIncome = monthlyTx.filter(t => t.type === TransactionType.INCOME).reduce((s, t) => s + t.amount, 0);
  const marketplacePurchases = monthlyTx.filter(t => t.category === 'marketplace_purchase').reduce((s, t) => s + t.amount, 0);
  const marketplaceSales = monthlyTx.filter(t => t.category === 'marketplace_sale').reduce((s, t) => s + t.amount, 0);
  const completedGoals = savingsGoals.filter(g => g.completedAt).length;

  const milestones = COIN_MILESTONES.map(m => ({ ...m, unlocked: walletBalance >= m.coins }));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="wallet-modal-title"
      maxWidthClass="max-w-md"
      panelClassName="!p-0 overflow-hidden max-h-[85vh] flex flex-col"
    >
      <div className="bg-gradient-to-r from-lantern-primary to-lantern-primary-dark px-5 py-5 shrink-0">
        <div className="flex justify-between items-start gap-3">
          <div>
            <h2 id="wallet-modal-title" className="text-lg font-bold text-white flex items-center gap-2">
              <SparklesIcon className="w-5 h-5" aria-hidden /> Study Rewards Wallet
            </h2>
            <p className="text-white/70 text-xs mt-0.5">Earn coins by studying and saving smart</p>
          </div>
        </div>
        <div className="mt-4 bg-white/15 backdrop-blur-sm rounded-xl p-4 text-center">
          <p className="text-white/70 text-xs">Your Balance</p>
          <p className="text-3xl font-bold text-white mt-0.5">
            {walletBalance.toLocaleString()} <span className="text-lg">coins</span>
          </p>
        </div>
      </div>

      <div className="p-5 overflow-y-auto flex-1 space-y-5 bg-lantern-surface">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-lantern-background-secondary rounded-xl p-3 text-center">
            <ShoppingBagIcon className="w-5 h-5 mx-auto text-lantern-primary mb-1" aria-hidden />
            <p className="text-xs text-lantern-text-tertiary">Marketplace Spend</p>
            <p className="font-semibold text-sm text-lantern-text">₦{marketplacePurchases.toLocaleString('en-NG')}</p>
          </div>
          <div className="bg-lantern-background-secondary rounded-xl p-3 text-center">
            <ArrowTrendingUpIcon className="w-5 h-5 mx-auto text-lantern-success mb-1" aria-hidden />
            <p className="text-xs text-lantern-text-tertiary">Marketplace Earned</p>
            <p className="font-semibold text-sm text-lantern-text">₦{marketplaceSales.toLocaleString('en-NG')}</p>
          </div>
          <div className="bg-lantern-background-secondary rounded-xl p-3 text-center">
            <AcademicCapIcon className="w-5 h-5 mx-auto text-amber-500 mb-1" aria-hidden />
            <p className="text-xs text-lantern-text-tertiary">Goals Completed</p>
            <p className="font-semibold text-sm text-lantern-text">{completedGoals}</p>
          </div>
          <div className="bg-lantern-background-secondary rounded-xl p-3 text-center">
            <SparklesIcon className="w-5 h-5 mx-auto text-lantern-primary mb-1" aria-hidden />
            <p className="text-xs text-lantern-text-tertiary">Net This Month</p>
            <p className={`font-semibold text-sm ${monthlyIncome - monthlyExpenses >= 0 ? 'text-lantern-success' : 'text-lantern-error'}`}>
              ₦{(monthlyIncome - monthlyExpenses).toLocaleString('en-NG')}
            </p>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-lantern-text mb-2">How to Earn Coins</h3>
          <div className="space-y-2">
            {EARNING_METHODS.map((m, i) => (
              <div key={i} className="flex items-center gap-3 bg-lantern-background-secondary rounded-xl px-3 py-2">
                <span className="text-lg" aria-hidden>{m.icon}</span>
                <span className="flex-1 text-xs text-lantern-text-secondary">{m.action}</span>
                <span className="text-xs font-bold text-lantern-success">{m.coins}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-lantern-text mb-2">Milestones & Rewards</h3>
          <div className="space-y-2">
            {milestones.map((m, i) => (
              <div key={i} className={`flex items-center gap-3 rounded-xl px-3 py-2 ${m.unlocked ? 'bg-lantern-success/10' : 'bg-lantern-background-secondary'}`}>
                <span className={`text-lg ${m.unlocked ? '' : 'grayscale opacity-40'}`} aria-hidden>{m.reward.split(' ')[0]}</span>
                <div className="flex-1">
                  <p className={`text-xs font-medium ${m.unlocked ? 'text-lantern-success' : 'text-lantern-text-secondary'}`}>{m.reward.slice(m.reward.indexOf(' ') + 1)}</p>
                  <p className="text-xs text-lantern-text-tertiary">{m.coins} coins</p>
                </div>
                {m.unlocked ? (
                  <span className="text-lantern-success text-xs font-semibold">Unlocked</span>
                ) : (
                  <span className="text-lantern-text-tertiary text-xs">{m.coins - walletBalance} more</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="px-5 py-4 border-t border-lantern-border shrink-0 bg-lantern-surface">
        <button
          type="button"
          onClick={onClose}
          className="w-full px-4 py-2.5 text-sm font-medium text-lantern-text bg-lantern-background-secondary rounded-xl hover:bg-lantern-border/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
        >
          Close
        </button>
      </div>
    </Modal>
  );
};

export default WalletModal;
