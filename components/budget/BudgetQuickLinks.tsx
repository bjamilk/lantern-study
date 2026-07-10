import React from 'react';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ArrowTrendingUpIcon,
  TrophyIcon,
  UserGroupIcon,
  WalletIcon,
} from '@heroicons/react/24/outline';

const linkBase =
  'flex flex-col items-center justify-center gap-2 p-4 rounded-lantern-xl border border-lantern-border bg-lantern-surface shadow-lantern transition-all duration-200 hover:scale-[1.02] hover:shadow-lantern-md hover:border-teal-500/30 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500';

interface BudgetQuickLinksProps {
  onAddExpense: () => void;
  onAddIncome: () => void;
  onAddInvestment?: () => void;
  onSavingsGoal?: () => void;
  onExpenseSplit?: () => void;
  onWallet?: () => void;
}

export const BudgetQuickLinks: React.FC<BudgetQuickLinksProps> = ({
  onAddExpense,
  onAddIncome,
  onAddInvestment,
  onSavingsGoal,
  onExpenseSplit,
  onWallet,
}) => (
  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
    <button type="button" onClick={onAddExpense} className={linkBase}>
      <ArrowDownIcon className="w-6 h-6 text-lantern-error" />
      <span className="text-xs font-semibold text-lantern-text">Add expense</span>
    </button>
    <button type="button" onClick={onAddIncome} className={linkBase}>
      <ArrowUpIcon className="w-6 h-6 text-lantern-success" />
      <span className="text-xs font-semibold text-lantern-text">Add income</span>
    </button>
    {onAddInvestment ? (
      <button type="button" onClick={onAddInvestment} className={linkBase}>
        <ArrowTrendingUpIcon className="w-6 h-6 text-lantern-primary" />
        <span className="text-xs font-semibold text-lantern-text">Investment</span>
      </button>
    ) : null}
    {onSavingsGoal ? (
      <button type="button" onClick={onSavingsGoal} className={linkBase}>
        <TrophyIcon className="w-6 h-6 text-lantern-accent" />
        <span className="text-xs font-semibold text-lantern-text">Savings goal</span>
      </button>
    ) : null}
    {onExpenseSplit ? (
      <button type="button" onClick={onExpenseSplit} className={linkBase}>
        <UserGroupIcon className="w-6 h-6 text-lantern-primary-light" />
        <span className="text-xs font-semibold text-lantern-text">Split expense</span>
      </button>
    ) : null}
    {onWallet ? (
      <button type="button" onClick={onWallet} className={linkBase}>
        <WalletIcon className="w-6 h-6 text-teal-600" />
        <span className="text-xs font-semibold text-lantern-text">Wallet</span>
      </button>
    ) : null}
  </div>
);

export default BudgetQuickLinks;
