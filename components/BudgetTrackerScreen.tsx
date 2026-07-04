import React, { useMemo, useEffect, useRef, useState } from 'react';
import { User, Transaction, Budget, TransactionType, SavingsGoal, STUDENT_EXPENSE_CATEGORIES, STUDENT_INCOME_CATEGORIES, FinancialTip } from '../types';
import {
  CreditCardIcon, ArrowUpIcon, ArrowDownIcon, PlusCircleIcon,
  Cog6ToothIcon, TrashIcon, WalletIcon, BanknotesIcon,
  ChartBarIcon, LightBulbIcon, FunnelIcon, ArrowTrendingUpIcon,
  SparklesIcon, TrophyIcon, UserGroupIcon, ArrowPathIcon,
} from '@heroicons/react/24/outline';
import type { Chart as ChartType } from 'chart.js';
import { useBudgetStore } from '../stores/budgetStore';
import { useBudgetHandlers } from '../hooks/useBudgetHandlers';

type BudgetTab = 'overview' | 'transactions' | 'goals' | 'insights';

interface BudgetTrackerScreenProps {
  currentUser: User;
  transactions: Transaction[];
  budget: Budget | null;
  onOpenAddExpense: () => void;
  onOpenAddIncome: () => void;
  onOpenAddInvestment?: () => void;
  onOpenSetBudget: () => void;
  onDeleteTransaction: (transactionId: string) => void;
  onToggleSidebar: () => void;
  onOpenSetMonthlyPlan?: () => void;
  onOpenSavingsGoal?: () => void;
  onOpenWallet?: () => void;
  onOpenExpenseSplit?: () => void;
  onOpenFinancialToolkit?: () => void;
}

// Helper: look up category label+icon
const getCategoryInfo = (categoryId: string, type: TransactionType) => {
  const cats = type === TransactionType.INCOME ? STUDENT_INCOME_CATEGORIES : STUDENT_EXPENSE_CATEGORIES;
  const found = cats.find(c => c.id === categoryId);
  return found || { id: categoryId, label: categoryId, icon: '📦' };
};

// Financial tips data
const FINANCIAL_TIPS: FinancialTip[] = [
  { id: '1', title: 'Cook More, Spend Less', content: 'Cooking your own meals can save you up to 60% compared to buying food outside campus. Consider joining a cooking group!', category: 'saving', icon: '🍳' },
  { id: '2', title: 'Track Data Usage', content: 'Switch to night bundles and Wi-Fi when available. Data is one of the top student expenses — tracking it helps you budget better.', category: 'budgeting', icon: '📱' },
  { id: '3', title: 'Start Small Savings', content: 'Even ₦500/week adds up to ₦26,000/year. Small consistent savings beat irregular large deposits.', category: 'saving', icon: '🐷' },
  { id: '4', title: 'Use the 50/30/20 Rule', content: 'Allocate 50% to needs (food, transport), 30% to wants (entertainment), and 20% to savings from your allowance.', category: 'budgeting', icon: '📊' },
  { id: '5', title: 'Sell What You Don\'t Need', content: 'Use the Marketplace to sell textbooks, clothes, or electronics you no longer use. One person\'s trash is another\'s treasure!', category: 'campus', icon: '🏪' },
  { id: '6', title: 'Group Transport Saves', content: 'Share rides with classmates or roommates. Split fuel costs to save up to 70% on transportation.', category: 'campus', icon: '🚌' },
];

const BudgetTrackerScreen: React.FC<BudgetTrackerScreenProps> = ({
  currentUser, transactions, budget,
  onOpenAddExpense, onOpenAddIncome, onOpenAddInvestment, onOpenSetBudget, onDeleteTransaction,
  onToggleSidebar, onOpenSetMonthlyPlan, onOpenSavingsGoal, onOpenWallet, onOpenExpenseSplit, onOpenFinancialToolkit,
}) => {
  const [activeTab, setActiveTab] = useState<BudgetTab>('overview');
  const [txFilter, setTxFilter] = useState<'all' | 'income' | 'expense'>('all');
  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInstanceRef = useRef<ChartType | null>(null);
  const { savingsGoals, walletBalance, expenseSplits } = useBudgetStore();
  const { refreshBudgetTransactions, refreshBudgetWallet, claimUnderBudgetAward } = useBudgetHandlers();
  const [budgetBanner, setBudgetBanner] = useState<string | null>(null);
  const [awardToast, setAwardToast] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser?.id) return;
    const refresh = () => {
      void refreshBudgetTransactions(currentUser.id);
      void refreshBudgetWallet();
    };
    refresh();
    void claimUnderBudgetAward().then((result) => {
      if (result && result.awarded > 0) {
        setAwardToast(`+${result.awarded} coins for staying under last month's budget!`);
      }
    });
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refresh);
    };
  }, [currentUser?.id, refreshBudgetTransactions, refreshBudgetWallet, claimUnderBudgetAward]);

  const currentMonth = new Date().toISOString().slice(0, 7);
  const monthName = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });

  const { monthlyExpenses, monthlyIncome, monthlyTransactions } = useMemo(() => {
    const filtered = transactions.filter(t => t.date.startsWith(currentMonth));
    const expenses = filtered.filter(t => t.type === TransactionType.EXPENSE).reduce((sum, t) => sum + t.amount, 0);
    const income = filtered.filter(t => t.type === TransactionType.INCOME).reduce((sum, t) => sum + t.amount, 0);
    return { monthlyExpenses: expenses, monthlyIncome: income, monthlyTransactions: filtered };
  }, [transactions, currentMonth]);

  const budgetLimit = budget?.monthlyLimit || 0;
  const budgetProgress = budgetLimit > 0 ? (monthlyExpenses / budgetLimit) * 100 : 0;

  useEffect(() => {
    if (budgetLimit <= 0) {
      setBudgetBanner(null);
      return;
    }
    if (budgetProgress >= 100) {
      setBudgetBanner('You have exceeded your monthly budget limit.');
    } else if (budgetProgress >= 80) {
      setBudgetBanner('You have used 80% or more of your monthly budget.');
    } else {
      setBudgetBanner(null);
    }
  }, [budgetProgress, budgetLimit]);

  const getProgressColor = () => {
    if (budgetProgress > 100) return 'from-red-500 to-red-600';
    if (budgetProgress > 80) return 'from-orange-400 to-red-500';
    if (budgetProgress > 50) return 'from-yellow-400 to-orange-400';
    return 'from-emerald-400 to-green-500';
  };

  const expenseByCategory = useMemo(() => {
    const categoryMap: Record<string, number> = {};
    monthlyTransactions
      .filter(t => t.type === TransactionType.EXPENSE)
      .forEach(t => { categoryMap[t.category] = (categoryMap[t.category] || 0) + t.amount; });
    return Object.entries(categoryMap)
      .map(([id, amount]) => ({ ...getCategoryInfo(id, TransactionType.EXPENSE), amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [monthlyTransactions]);

  const filteredTransactions = useMemo(() => {
    let list = monthlyTransactions;
    if (txFilter === 'income') list = list.filter(t => t.type === TransactionType.INCOME);
    if (txFilter === 'expense') list = list.filter(t => t.type === TransactionType.EXPENSE);
    return list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [monthlyTransactions, txFilter]);

  // Chart
  useEffect(() => {
    if (activeTab !== 'overview' && activeTab !== 'insights') return;
    if (!chartRef.current) return;
    if (chartInstanceRef.current) {
      chartInstanceRef.current.destroy();
      chartInstanceRef.current = null;
    }
    const ctx = chartRef.current.getContext('2d');
    if (!ctx || expenseByCategory.length === 0) return;
    const colors = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#3b82f6', '#8b5cf6', '#06b6d4', '#f97316', '#ef4444', '#14b8a6', '#a855f7', '#64748b', '#e11d48', '#22c55e'];

    let active = true;
    let localChartInstance: ChartType | null = null;

    import('chart.js').then(({ Chart, registerables }) => {
      if (!active) return;
      Chart.register(...registerables);

      if (chartRef.current) {
        localChartInstance = new Chart(ctx, {
          type: 'doughnut',
          data: {
            labels: expenseByCategory.map(c => `${c.icon} ${c.label}`),
            datasets: [{ data: expenseByCategory.map(c => c.amount), backgroundColor: colors.slice(0, expenseByCategory.length), borderWidth: 0, hoverOffset: 8 }],
          },
          options: {
            responsive: true, maintainAspectRatio: false, cutout: '65%',
            plugins: { legend: { display: false } },
          },
        });
        chartInstanceRef.current = localChartInstance;
      }
    }).catch(err => {
      console.error('Failed to load chart.js dynamically:', err);
    });

    return () => {
      active = false;
      if (localChartInstance) {
        localChartInstance.destroy();
      }
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
    };
  }, [expenseByCategory, activeTab]);

  // ─── TAB CONTENT ───
  const tabs: { key: BudgetTab; label: string; icon: React.ReactNode }[] = [
    { key: 'overview', label: 'Overview', icon: <ChartBarIcon className="w-4 h-4" /> },
    { key: 'transactions', label: 'Transactions', icon: <BanknotesIcon className="w-4 h-4" /> },
    { key: 'goals', label: 'Goals', icon: <TrophyIcon className="w-4 h-4" /> },
    { key: 'insights', label: 'Insights', icon: <LightBulbIcon className="w-4 h-4" /> },
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200">
      {awardToast && (
        <div className="shrink-0 bg-emerald-600 text-white text-sm px-4 py-2 flex justify-between items-center">
          <span>{awardToast}</span>
          <button type="button" onClick={() => setAwardToast(null)} className="text-white/80 hover:text-white text-xs">Dismiss</button>
        </div>
      )}
      {budgetBanner && (
        <div className={`shrink-0 text-sm px-4 py-2 flex justify-between items-center ${budgetProgress >= 100 ? 'bg-red-600 text-white' : 'bg-amber-500 text-white'}`}>
          <span>{budgetBanner}</span>
          <button type="button" onClick={() => setBudgetBanner(null)} className="text-white/80 hover:text-white text-xs">Dismiss</button>
        </div>
      )}
      {/* ─── HEADER ─── */}
      <div className="bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-500 px-5 py-5 md:px-8 shrink-0">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-white flex items-center gap-2">
              <WalletIcon className="w-7 h-7" /> Campus Pocket
            </h1>
            <p className="text-white/70 text-sm mt-0.5">{monthName}</p>
          </div>
          <div className="flex gap-2">
            {onOpenWallet && (
              <button onClick={onOpenWallet} className="bg-white/15 hover:bg-white/25 text-white px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1">
                <SparklesIcon className="w-4 h-4" /> {walletBalance} coins
              </button>
            )}
            <button onClick={onOpenSetBudget} className="bg-white/15 hover:bg-white/25 text-white px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1">
              <Cog6ToothIcon className="w-4 h-4" /> Budget
            </button>
          </div>
        </div>
        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-3 mt-4">
          <div className="bg-white/10 backdrop-blur-sm rounded-xl px-3 py-2.5">
            <p className="text-white/60 text-xs">Income</p>
            <p className="text-white font-bold text-lg">₦{monthlyIncome.toLocaleString('en-NG')}</p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-xl px-3 py-2.5">
            <p className="text-white/60 text-xs">Expenses</p>
            <p className="text-white font-bold text-lg">₦{monthlyExpenses.toLocaleString('en-NG')}</p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-xl px-3 py-2.5">
            <p className="text-white/60 text-xs">Balance</p>
            <p className={`font-bold text-lg ${monthlyIncome - monthlyExpenses >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
              ₦{(monthlyIncome - monthlyExpenses).toLocaleString('en-NG')}
            </p>
          </div>
        </div>
      </div>

      {/* ─── TAB BAR ─── */}
      <div className="shrink-0 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-4 flex gap-1 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              activeTab === t.key
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            }`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div className="p-4 md:p-6 flex-1 min-h-0 overflow-y-auto">
        {/* ═══ OVERVIEW TAB ═══ */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Budget Progress */}
            {budgetLimit > 0 ? (
              <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 shadow-sm">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-semibold text-slate-700 dark:text-slate-200">Monthly Budget</h3>
                  {onOpenSetMonthlyPlan && (
                    <button onClick={onOpenSetMonthlyPlan} className="text-xs text-indigo-500 hover:underline">Category Budgets</button>
                  )}
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-slate-800 dark:text-slate-100">₦{monthlyExpenses.toLocaleString('en-NG')}</span>
                  <span className="text-slate-400">/ ₦{budgetLimit.toLocaleString('en-NG')}</span>
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-3 mt-3 overflow-hidden">
                  <div className={`h-3 rounded-full bg-gradient-to-r ${getProgressColor()} transition-all duration-500`} style={{ width: `${Math.min(budgetProgress, 100)}%` }} />
                </div>
                <p className="text-sm mt-2 text-slate-500 dark:text-slate-400">
                  {budgetProgress <= 100
                    ? `₦${(budgetLimit - monthlyExpenses).toLocaleString('en-NG')} remaining`
                    : `⚠️ ₦${(monthlyExpenses - budgetLimit).toLocaleString('en-NG')} over budget!`}
                </p>
                {/* Category budget bars */}
                {budget?.categoryBudgets && Object.keys(budget.categoryBudgets).length > 0 && (
                  <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700 space-y-2">
                    {Object.entries(budget.categoryBudgets).slice(0, 5).map(([catId, limit]) => {
                      const spent = monthlyTransactions.filter(t => t.type === TransactionType.EXPENSE && t.category === catId).reduce((s, t) => s + t.amount, 0);
                      const cat = getCategoryInfo(catId, TransactionType.EXPENSE);
                      const pct = limit > 0 ? (spent / limit) * 100 : 0;
                      return (
                        <div key={catId}>
                          <div className="flex justify-between text-xs">
                            <span>{cat.icon} {cat.label}</span>
                            <span className={pct > 100 ? 'text-red-500 font-medium' : 'text-slate-400'}>₦{spent.toLocaleString('en-NG')} / ₦{limit.toLocaleString('en-NG')}</span>
                          </div>
                          <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-1.5 mt-1">
                            <div className={`h-1.5 rounded-full ${pct > 100 ? 'bg-red-500' : 'bg-indigo-400'}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 shadow-sm text-center">
                <div className="text-4xl mb-2">💰</div>
                <p className="text-slate-500 dark:text-slate-400">No budget set for this month</p>
                <button onClick={onOpenSetBudget} className="mt-2 text-indigo-500 font-semibold hover:underline text-sm">Set your monthly budget</button>
              </div>
            )}

            {/* Quick Actions */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <button onClick={onOpenAddExpense} className="bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 rounded-2xl p-4 flex flex-col items-center gap-1.5 transition-colors">
                <ArrowDownIcon className="w-6 h-6" />
                <span className="text-xs font-semibold">Add Expense</span>
              </button>
              <button onClick={onOpenAddIncome} className="bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-2xl p-4 flex flex-col items-center gap-1.5 transition-colors">
                <ArrowUpIcon className="w-6 h-6" />
                <span className="text-xs font-semibold">Add Income</span>
              </button>
              {onOpenAddInvestment && (
                <button onClick={onOpenAddInvestment} className="bg-indigo-50 dark:bg-indigo-900/20 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-2xl p-4 flex flex-col items-center gap-1.5 transition-colors">
                  <ArrowTrendingUpIcon className="w-6 h-6" />
                  <span className="text-xs font-semibold">Investment</span>
                </button>
              )}
              <button onClick={onOpenSavingsGoal || (() => setActiveTab('goals'))} className="bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded-2xl p-4 flex flex-col items-center gap-1.5 transition-colors">
                <TrophyIcon className="w-6 h-6" />
                <span className="text-xs font-semibold">Savings Goal</span>
              </button>
              <button onClick={onOpenExpenseSplit || (() => {})} className="bg-purple-50 dark:bg-purple-900/20 hover:bg-purple-100 dark:hover:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-2xl p-4 flex flex-col items-center gap-1.5 transition-colors">
                <UserGroupIcon className="w-6 h-6" />
                <span className="text-xs font-semibold">Split Expense</span>
              </button>
            </div>

            {/* Spending by Category */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 shadow-sm">
                <h3 className="font-semibold text-slate-700 dark:text-slate-200 mb-4">Spending Breakdown</h3>
                {expenseByCategory.length > 0 ? (
                  <div className="h-56">
                    <canvas ref={chartRef} />
                  </div>
                ) : (
                  <p className="text-center text-sm text-slate-400 py-8">No expenses yet this month</p>
                )}
              </div>
              <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 shadow-sm">
                <h3 className="font-semibold text-slate-700 dark:text-slate-200 mb-3">Top Categories</h3>
                {expenseByCategory.length > 0 ? (
                  <div className="space-y-3">
                    {expenseByCategory.slice(0, 6).map((cat) => {
                      const pct = monthlyExpenses > 0 ? (cat.amount / monthlyExpenses) * 100 : 0;
                      return (
                        <div key={cat.id} className="flex items-center gap-3">
                          <span className="text-xl">{cat.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between text-sm">
                              <span className="truncate font-medium text-slate-700 dark:text-slate-300">{cat.label}</span>
                              <span className="text-slate-500 dark:text-slate-400 ml-2">₦{cat.amount.toLocaleString('en-NG')}</span>
                            </div>
                            <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-1.5 mt-1">
                              <div className="h-1.5 rounded-full bg-indigo-400" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-center text-sm text-slate-400 py-8">No data yet</p>
                )}
              </div>
            </div>

            {/* Savings Goals preview */}
            {savingsGoals.length > 0 && (
              <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 shadow-sm">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-semibold text-slate-700 dark:text-slate-200">Savings Goals</h3>
                  <button onClick={() => setActiveTab('goals')} className="text-xs text-indigo-500 hover:underline">View All</button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {savingsGoals.slice(0, 2).map(goal => {
                    const pct = goal.targetAmount > 0 ? (goal.currentAmount / goal.targetAmount) * 100 : 0;
                    return (
                      <div key={goal.id} className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xl">{goal.icon}</span>
                          <span className="font-medium text-sm text-slate-700 dark:text-slate-300">{goal.name}</span>
                          {goal.completedAt && <span className="text-xs bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-full">Done!</span>}
                        </div>
                        <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
                          <span>₦{goal.currentAmount.toLocaleString('en-NG')}</span>
                          <span>₦{goal.targetAmount.toLocaleString('en-NG')}</span>
                        </div>
                        <div className="w-full bg-slate-200 dark:bg-slate-600 rounded-full h-2">
                          <div className="h-2 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all" style={{ width: `${Math.min(pct, 100)}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ TRANSACTIONS TAB ═══ */}
        {activeTab === 'transactions' && (
          <div className="space-y-4">
            {/* Filter + Actions */}
            <div className="flex flex-wrap gap-2 items-center justify-between">
              <div className="flex gap-1 bg-white dark:bg-slate-800 rounded-xl p-1 shadow-sm">
                {(['all', 'income', 'expense'] as const).map(f => (
                  <button key={f} onClick={() => setTxFilter(f)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                      txFilter === f
                        ? 'bg-indigo-500 text-white'
                        : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}>
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={onOpenAddExpense} className="bg-red-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 hover:bg-red-600">
                  <ArrowDownIcon className="w-3.5 h-3.5" /> Expense
                </button>
                <button onClick={onOpenAddIncome} className="bg-emerald-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 hover:bg-emerald-600">
                  <ArrowUpIcon className="w-3.5 h-3.5" /> Income
                </button>
              </div>
            </div>

            {/* Transaction List */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden">
              {filteredTransactions.length > 0 ? (
                <ul className="divide-y divide-slate-100 dark:divide-slate-700/50">
                  {filteredTransactions.map(t => {
                    const cat = getCategoryInfo(t.category, t.type);
                    return (
                      <li key={t.id} className="px-4 py-3 flex justify-between items-center hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${
                            t.type === TransactionType.INCOME
                              ? 'bg-emerald-100 dark:bg-emerald-900/30'
                              : 'bg-red-100 dark:bg-red-900/30'
                          }`}>
                            {cat.icon}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-sm text-slate-800 dark:text-slate-100 truncate">{t.description}</p>
                            <p className="text-xs text-slate-400">{cat.label} &middot; {new Date(t.date).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`font-semibold text-sm ${t.type === TransactionType.INCOME ? 'text-emerald-500' : 'text-red-500'}`}>
                            {t.type === TransactionType.INCOME ? '+' : '-'}₦{t.amount.toLocaleString('en-NG')}
                          </span>
                          <button onClick={() => onDeleteTransaction(t.id)} className="text-slate-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 transition-colors">
                            <TrashIcon className="w-4 h-4" />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="text-center py-12">
                  <div className="text-4xl mb-2">📭</div>
                  <p className="text-slate-400 text-sm">No {txFilter !== 'all' ? txFilter : ''} transactions this month</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ GOALS TAB ═══ */}
        {activeTab === 'goals' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-200">Savings Goals</h3>
              {onOpenSavingsGoal && (
                <button onClick={onOpenSavingsGoal} className="bg-indigo-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 hover:bg-indigo-600">
                  <PlusCircleIcon className="w-4 h-4" /> New Goal
                </button>
              )}
            </div>

            {savingsGoals.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {savingsGoals.map(goal => {
                  const pct = goal.targetAmount > 0 ? (goal.currentAmount / goal.targetAmount) * 100 : 0;
                  return (
                    <div key={goal.id} className="bg-white dark:bg-slate-800 rounded-2xl p-5 shadow-sm">
                      <div className="flex items-center gap-3 mb-3">
                        <span className="text-3xl">{goal.icon}</span>
                        <div>
                          <h4 className="font-semibold text-slate-800 dark:text-slate-100">{goal.name}</h4>
                          {goal.deadline && (
                            <p className="text-xs text-slate-400">
                              Due {new Date(goal.deadline).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </p>
                          )}
                        </div>
                        {goal.completedAt && (
                          <span className="ml-auto bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 text-xs font-semibold px-2 py-1 rounded-full">✓ Complete</span>
                        )}
                      </div>
                      <div className="flex justify-between text-sm mb-2">
                        <span className="font-medium text-slate-700 dark:text-slate-300">₦{goal.currentAmount.toLocaleString('en-NG')}</span>
                        <span className="text-slate-400">₦{goal.targetAmount.toLocaleString('en-NG')}</span>
                      </div>
                      <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-3">
                        <div className="h-3 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all duration-500" style={{ width: `${Math.min(pct, 100)}%` }} />
                      </div>
                      <p className="text-xs text-slate-400 mt-2">{pct.toFixed(0)}% saved</p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 shadow-sm text-center">
                <div className="text-5xl mb-3">🎯</div>
                <h4 className="font-semibold text-slate-700 dark:text-slate-200 mb-1">No savings goals yet</h4>
                <p className="text-sm text-slate-400 mb-3">Set a goal to save for something special — a new phone, textbooks, or a trip!</p>
                {onOpenSavingsGoal && (
                  <button onClick={onOpenSavingsGoal} className="bg-indigo-500 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-indigo-600">
                    Create Your First Goal
                  </button>
                )}
              </div>
            )}

            {/* Active Expense Splits */}
            {expenseSplits.length > 0 && (
              <div className="mt-6">
                <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-200 mb-3">Expense Splits</h3>
                <div className="space-y-3">
                  {expenseSplits.filter(s => s.status === 'active').map(split => (
                    <div key={split.id} className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm">
                      <div className="flex justify-between items-center mb-2">
                        <div>
                          <h4 className="font-medium text-slate-800 dark:text-slate-100">{split.title}</h4>
                          <p className="text-xs text-slate-400">{split.participants.length} people &middot; ₦{split.totalAmount.toLocaleString('en-NG')} total</p>
                        </div>
                        <span className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs px-2 py-1 rounded-full font-medium">Active</span>
                      </div>
                      <div className="flex gap-1 mt-2">
                        {split.participants.map(p => (
                          <div key={p.userId} className={`flex-1 h-2 rounded-full ${p.paid ? 'bg-emerald-400' : 'bg-slate-200 dark:bg-slate-600'}`} title={`${p.userName}: ${p.paid ? 'Paid' : 'Unpaid'}`} />
                        ))}
                      </div>
                      <p className="text-xs text-slate-400 mt-1">
                        {split.participants.filter(p => p.paid).length}/{split.participants.length} paid
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ INSIGHTS TAB ═══ */}
        {activeTab === 'insights' && (
          <div className="space-y-6">
            {/* Spending Trend */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 shadow-sm">
              <h3 className="font-semibold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2">
                <ArrowTrendingUpIcon className="w-5 h-5 text-indigo-500" /> Spending Summary
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center">
                  <p className="text-2xl font-bold text-slate-800 dark:text-slate-100">{monthlyTransactions.length}</p>
                  <p className="text-xs text-slate-400">Transactions</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-red-500">₦{monthlyExpenses > 0 ? Math.round(monthlyExpenses / Math.max(monthlyTransactions.filter(t => t.type === TransactionType.EXPENSE).length, 1)).toLocaleString('en-NG') : '0'}</p>
                  <p className="text-xs text-slate-400">Avg Expense</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-indigo-500">{expenseByCategory.length}</p>
                  <p className="text-xs text-slate-400">Categories</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-amber-500">{savingsGoals.filter(g => !g.completedAt).length}</p>
                  <p className="text-xs text-slate-400">Active Goals</p>
                </div>
              </div>
            </div>

            {/* Top category this month */}
            {expenseByCategory.length > 0 && (
              <div className="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl p-5 text-white">
                <p className="text-white/70 text-xs mb-1">Biggest expense category</p>
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{expenseByCategory[0].icon}</span>
                  <div>
                    <p className="font-bold text-lg">{expenseByCategory[0].label}</p>
                    <p className="text-white/80">₦{expenseByCategory[0].amount.toLocaleString('en-NG')} ({monthlyExpenses > 0 ? ((expenseByCategory[0].amount / monthlyExpenses) * 100).toFixed(0) : 0}% of spending)</p>
                  </div>
                </div>
              </div>
            )}

            {/* Financial Toolkit CTA */}
            {onOpenFinancialToolkit && (
              <button onClick={onOpenFinancialToolkit} className="w-full bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-500 hover:to-orange-600 text-white rounded-2xl p-4 flex items-center gap-3 shadow-sm transition-all">
                <span className="text-2xl">🧮</span>
                <div className="text-left">
                  <p className="font-bold text-sm">Financial Toolkit</p>
                  <p className="text-xs text-white/80">Budget simulator, savings calculator & more tips</p>
                </div>
              </button>
            )}

            {/* Financial Tips */}
            <div>
              <h3 className="font-semibold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2">
                <LightBulbIcon className="w-5 h-5 text-amber-500" /> Money Tips for Students
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {FINANCIAL_TIPS.map(tip => (
                  <div key={tip.id} className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">{tip.icon}</span>
                      <div>
                        <h4 className="font-medium text-sm text-slate-800 dark:text-slate-100">{tip.title}</h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">{tip.content}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BudgetTrackerScreen;