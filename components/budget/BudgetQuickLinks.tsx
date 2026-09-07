import React from 'react';
import { AppIcon } from '../ui/AppIcon';

const linkBase =
  'flex flex-col items-center justify-center gap-2 p-4 rounded-lantern-xl border border-lantern-border bg-lantern-surface shadow-lantern transition-all duration-200 hover:scale-[1.02] hover:shadow-lantern-md hover:border-teal-500/30 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500';

interface BudgetQuickLinksProps {
  onAddExpense: () => void;
  onAddIncome: () => void;
  onSavingsGoal?: () => void;
  onExpenseSplit?: () => void;
}

export const BudgetQuickLinks: React.FC<BudgetQuickLinksProps> = ({
  onAddExpense,
  onAddIncome,
  onSavingsGoal,
  onExpenseSplit,
}) => (
  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
    <button type="button" onClick={onAddExpense} className={linkBase}>
      <AppIcon name="arrow-down" size={24} className="text-lantern-error" />
      <span className="text-xs font-semibold text-lantern-text">Add expense</span>
    </button>
    <button type="button" onClick={onAddIncome} className={linkBase}>
      <AppIcon name="arrow-up" size={24} className="text-lantern-success" />
      <span className="text-xs font-semibold text-lantern-text">Add income</span>
    </button>
    {onSavingsGoal ? (
      <button type="button" onClick={onSavingsGoal} className={linkBase}>
        <AppIcon name="trophy" size={24} className="text-lantern-accent" />
        <span className="text-xs font-semibold text-lantern-text">Savings goal</span>
      </button>
    ) : null}
    {onExpenseSplit ? (
      <button type="button" onClick={onExpenseSplit} className={linkBase}>
        <AppIcon name="people" size={24} className="text-lantern-primary" />
        <span className="text-xs font-semibold text-lantern-text">Split expense</span>
      </button>
    ) : null}
  </div>
);

export default BudgetQuickLinks;
