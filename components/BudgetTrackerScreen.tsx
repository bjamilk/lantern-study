import React, { useMemo, useEffect, useRef, useState } from 'react';
import { parseDateOnlyLocal } from '@lantern/shared/utils/dateOnly';
import {
  addMonths,
  compareMonthYear,
  computePeriodPace,
  computeSpendPace,
  formatMonthYear,
  isBudgetForMonth,
  normalizeBudgetPlan,
  readPlanForMonth,
  summarizeBudgetPlan,
  toMonthYear,
} from '@lantern/shared/utils';
import { fetchUserBudget } from '../services/supabase';
import { User, Transaction, Budget, TransactionType, SavingsGoal, STUDENT_EXPENSE_CATEGORIES, STUDENT_INCOME_CATEGORIES, FinancialTip } from '../types';
import {
  CreditCardIcon, ArrowUpIcon, ArrowDownIcon, PlusCircleIcon,
  Cog6ToothIcon, TrashIcon, WalletIcon, BanknotesIcon,
  ChartBarIcon, LightBulbIcon, FunnelIcon, ArrowTrendingUpIcon,
  TrophyIcon, UserGroupIcon, ArrowPathIcon, SparklesIcon,
} from '@heroicons/react/24/outline';
import type { Chart as ChartType } from 'chart.js';
import { useBudgetStore } from '../stores/budgetStore';
import { useBudgetHandlers } from '../hooks/useBudgetHandlers';
import { FeatureHero, StatChip, Tabs, TabList, Tab, TabPanel } from './ui';
import { BudgetQuickLinks } from './budget/BudgetQuickLinks';
import StudyWalletPanel from './StudyWalletPanel';
import { featureAccents } from '@lantern/shared/design';
import { confirmDialog } from '../stores/confirmStore';
import { useUIStore } from '../stores/uiStore';
import { navigateToPath } from '../utils/appNavigation';
import type { BudgetTabParam } from '../utils/appRoutes';

type BudgetTab = BudgetTabParam;

interface BudgetTrackerScreenProps {
  currentUser: User;
  transactions: Transaction[];
  budget: Budget | null;
  onOpenAddExpense: () => void;
  onOpenAddIncome: () => void;
  onOpenSetBudget: () => void;
  onDeleteTransaction: (transactionId: string) => void;
  onToggleSidebar: () => void;
  onOpenSetMonthlyPlan?: () => void;
  onOpenSavingsGoal?: () => void;
  onOpenRecurring?: () => void;
  onOpenExpenseSplit?: () => void;
  onOpenFinancialToolkit?: () => void;
}

// Helper: look up category label+icon
const getCategoryInfo = (categoryId: string, type: TransactionType) => {
  // Savings-goal contributions are recorded as INVESTMENT transactions
  // (category 'savings'); give them a friendly label instead of a bare id.
  if (type === TransactionType.INVESTMENT) {
    return { id: categoryId, label: 'Savings', icon: '🐷', color: '#8b5cf6' };
  }
  const cats = type === TransactionType.INCOME ? STUDENT_INCOME_CATEGORIES : STUDENT_EXPENSE_CATEGORIES;
  const found = cats.find(c => c.id === categoryId);
  return found || { id: categoryId, label: categoryId, icon: '📦', color: '#94a3b8' };
};

// Row presentation by type. Investments (savings contributions) are money moved
// aside, not spent — shown neutrally (violet, no minus) so they don't read as an
// expense, matching the fact that they don't count toward Spent/Balance.
const getTxPresentation = (type: TransactionType) => {
  if (type === TransactionType.INCOME) {
    return { sign: '+', amountClass: 'text-emerald-500', iconBg: 'bg-emerald-100 dark:bg-emerald-900/30' };
  }
  if (type === TransactionType.INVESTMENT) {
    return { sign: '', amountClass: 'text-violet-500', iconBg: 'bg-violet-100 dark:bg-violet-900/30' };
  }
  return { sign: '-', amountClass: 'text-red-500', iconBg: 'bg-red-100 dark:bg-red-900/30' };
};

// Budget ring — the at-a-glance "am I on track" hero, like Monefy/PocketGuard.
// Shows ₦ left (or ₦ over) in the centre with the % of the cap used, and colours
// the arc green→amber→orange→red as spend approaches and passes the limit.
const BudgetRing: React.FC<{ pct: number; remaining: number }> = ({ pct, remaining }) => {
  const size = 132;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const clamped = Math.min(Math.max(pct, 0), 100);
  const dash = (clamped / 100) * circ;
  const over = remaining < 0;
  const ringColor = over ? '#ef4444' : pct > 80 ? '#f97316' : pct > 50 ? '#f59e0b' : '#10b981';
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${Math.round(pct)} percent of budget used`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-lantern-background-secondary" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          stroke={ringColor}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dasharray 0.5s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-2">
        {over ? (
          <>
            <span className="text-[11px] font-medium text-red-500">over by</span>
            <span className="text-lg font-bold text-red-500 leading-tight">₦{Math.abs(remaining).toLocaleString('en-NG')}</span>
          </>
        ) : (
          <>
            <span className="text-lg font-bold text-lantern-text leading-tight">₦{remaining.toLocaleString('en-NG')}</span>
            <span className="text-[11px] text-lantern-text-tertiary">left</span>
          </>
        )}
        <span className="text-[11px] text-lantern-text-tertiary mt-0.5">{Math.round(pct)}% used</span>
      </div>
    </div>
  );
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
  onOpenAddExpense, onOpenAddIncome, onOpenSetBudget, onDeleteTransaction,
  onToggleSidebar, onOpenSetMonthlyPlan, onOpenSavingsGoal, onOpenRecurring, onOpenExpenseSplit, onOpenFinancialToolkit,
}) => {
  const budgetTab = useUIStore(s => s.budgetTab);
  const setBudgetTab = useUIStore(s => s.setBudgetTab);
  const [activeTab, setActiveTab] = useState<BudgetTab>(() => useUIStore.getState().budgetTab);
  const [txFilter, setTxFilter] = useState<'all' | 'income' | 'expense'>('all');
  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInstanceRef = useRef<ChartType | null>(null);
  const { savingsGoals, expenseSplits } = useBudgetStore();
  const { refreshBudgetTransactions, refreshBudgetWallet, materializeRecurring, claimUnderBudgetAward } = useBudgetHandlers();
  const [budgetBanner, setBudgetBanner] = useState<string | null>(null);
  const [awardToast, setAwardToast] = useState<string | null>(null);

  const handleConfirmDeleteTransaction = async (transaction: Transaction) => {
    const amountLabel = `₦${transaction.amount.toLocaleString('en-NG')}`;
    const ok = await confirmDialog({
      title: 'Delete transaction?',
      message: `Are you sure you want to delete "${transaction.description}" (${amountLabel})? This cannot be undone.`,
      danger: true,
      confirmLabel: 'Yes',
      cancelLabel: 'No',
    });
    if (ok) onDeleteTransaction(transaction.id);
  };

  useEffect(() => {
    if (!currentUser?.id) return;
    const refresh = () => {
      void refreshBudgetTransactions(currentUser.id);
      void refreshBudgetWallet();
    };
    refresh();
    // Post any due recurring rules once on open (idempotent server-side).
    void materializeRecurring();
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
  }, [currentUser?.id, refreshBudgetTransactions, refreshBudgetWallet, materializeRecurring, claimUnderBudgetAward]);

  // LOCAL month — transactions are keyed by local date (parseDateOnlyLocal), so a
  // UTC month here would show the wrong month for the first hours of each month in WAT.
  const currentMonth = toMonthYear(new Date());
  // Which month is on screen. Everything below reads this rather than the clock.
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const isCurrentMonth = selectedMonth === currentMonth;
  const monthName = formatMonthYear(selectedMonth);

  const { monthlyExpenses, monthlyIncome, monthlyTransactions } = useMemo(() => {
    const filtered = transactions.filter(t => t.date.startsWith(selectedMonth));
    const expenses = filtered.filter(t => t.type === TransactionType.EXPENSE).reduce((sum, t) => sum + t.amount, 0);
    const income = filtered.filter(t => t.type === TransactionType.INCOME).reduce((sum, t) => sum + t.amount, 0);
    return { monthlyExpenses: expenses, monthlyIncome: income, monthlyTransactions: filtered };
  }, [transactions, selectedMonth]);

  // A past month's cap lives in user_budgets, keyed by month.
  const [historicalBudget, setHistoricalBudget] = useState<Budget | null>(null);
  useEffect(() => {
    if (isCurrentMonth || !currentUser?.id) {
      setHistoricalBudget(null);
      return;
    }
    let cancelled = false;
    setHistoricalBudget(null);
    void fetchUserBudget(currentUser.id, selectedMonth)
      .then((row: any) => {
        if (cancelled) return;
        const limit = Number(row?.monthlyLimit ?? row?.monthly_limit ?? 0);
        setHistoricalBudget(
          limit > 0 ? { monthlyLimit: limit, monthYear: selectedMonth, userId: currentUser.id } : null
        );
      })
      .catch(() => {
        if (!cancelled) setHistoricalBudget(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isCurrentMonth, selectedMonth, currentUser?.id]);

  // A budget belongs to the month it was saved for; a stored one from an earlier
  // month must not become this month's cap when the calendar rolls over.
  // Past months recover only the cap: the plan (expected income, planned
  // savings) is stored as one current blob, not per month.
  // Plans are stored per month, so a past month recovers its whole plan —
  // expected income, planned savings and category budgets — not just the cap.
  const plansByMonth = useBudgetStore(s => s.plansByMonth);
  const monthPlan = useMemo(
    () =>
      readPlanForMonth(
        {
          plansByMonth,
          categoryBudgets: budget?.categoryBudgets,
          plannedIncome: budget?.plannedIncome,
          plannedSavings: budget?.plannedSavings,
        },
        selectedMonth,
        currentMonth
      ),
    [plansByMonth, budget, selectedMonth, currentMonth]
  );

  const activeBudget = isCurrentMonth
    ? budget && isBudgetForMonth(budget.monthYear, currentMonth)
      ? budget
      : null
    : historicalBudget || monthPlan
      ? {
          monthlyLimit: historicalBudget?.monthlyLimit ?? 0,
          monthYear: selectedMonth,
          userId: currentUser.id,
          categoryBudgets: monthPlan?.plannedExpenses,
          plannedIncome: monthPlan?.plannedIncome,
          plannedSavings: monthPlan?.plannedSavings,
        }
      : null;
  const budgetLimit = activeBudget?.monthlyLimit || 0;
  const budgetProgress = budgetLimit > 0 ? (monthlyExpenses / budgetLimit) * 100 : 0;

  // Zero-based view of the month plus calendar pace. Both come from
  // @lantern/shared so mobile renders exactly the same figures.
  const plan = React.useMemo(
    () => normalizeBudgetPlan(activeBudget, selectedMonth),
    [activeBudget, selectedMonth]
  );
  const planSummary = React.useMemo(() => summarizeBudgetPlan(plan), [plan]);
  const pace = React.useMemo(() => computePeriodPace(selectedMonth, new Date()), [selectedMonth]);
  // Pace measures spend against the SAME denominator as the headline progress bar
  // (the monthly limit), so the bar's "% used" and this line's "% spent" can never
  // disagree. (It previously divided by the sum of category budgets, which could
  // differ from the cap and show two contradicting percentages one line apart.)
  const spendPace = React.useMemo(
    () => computeSpendPace(monthlyExpenses, budgetLimit, pace),
    [monthlyExpenses, budgetLimit, pace]
  );

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
    if (activeTab !== 'overview') return;
    if (!chartRef.current) return;
    if (chartInstanceRef.current) {
      chartInstanceRef.current.destroy();
      chartInstanceRef.current = null;
    }
    const ctx = chartRef.current.getContext('2d');
    if (!ctx || expenseByCategory.length === 0) return;

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
            // Stable per-category colours from the shared def, so a slice matches
            // its Top-Categories bar and the mobile chart.
            datasets: [{ data: expenseByCategory.map(c => c.amount), backgroundColor: expenseByCategory.map(c => c.color), borderWidth: 0, hoverOffset: 8 }],
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
  useEffect(() => {
    if (budgetTab !== activeTab) setActiveTab(budgetTab);
  }, [budgetTab, activeTab]);

  const selectBudgetTab = (tab: BudgetTab) => {
    setActiveTab(tab);
    setBudgetTab(tab);
    const nextPath = tab === 'wallet' ? '/budget/wallet' : '/budget';
    if (typeof window !== 'undefined' && window.location.pathname !== nextPath) {
      navigateToPath(nextPath);
    }
  };

  const tabs: { key: BudgetTab; label: string; icon: React.ReactNode }[] = [
    { key: 'overview', label: 'Overview', icon: <ChartBarIcon className="w-4 h-4" /> },
    { key: 'transactions', label: 'Transactions', icon: <BanknotesIcon className="w-4 h-4" /> },
    { key: 'goals', label: 'Goals', icon: <TrophyIcon className="w-4 h-4" /> },
    { key: 'wallet', label: 'Study wallet', icon: <SparklesIcon className="w-4 h-4" /> },
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-lantern-background text-lantern-text">
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
      <div className="shrink-0 px-4 md:px-6 pt-3 pb-2 bg-lantern-background">
        <FeatureHero
          title="Budget"
          subtitle={monthName}
          accentColor={featureAccents.budget}
          icon={<WalletIcon className="w-6 h-6" style={{ color: featureAccents.budget }} />}
          actions={
            <>
              {onOpenRecurring && (
                <button
                  type="button"
                  onClick={onOpenRecurring}
                  className="h-9 px-3 bg-lantern-surface border border-lantern-border text-lantern-text rounded-lantern text-xs font-medium flex items-center gap-1 hover:border-teal-500/30 transition-colors"
                >
                  <ArrowPathIcon className="w-4 h-4" />
                  Recurring
                </button>
              )}
              <button
                type="button"
                onClick={onOpenSetBudget}
                className="h-9 px-3 bg-lantern-primary text-white hover:bg-lantern-primary-dark rounded-lantern text-xs font-medium flex items-center gap-1 transition-colors"
              >
                <Cog6ToothIcon className="w-4 h-4" />
                Set budget
              </button>
            </>
          }
        >
          <div className="flex flex-wrap gap-2">
            <StatChip label={`Income ₦${monthlyIncome.toLocaleString('en-NG')}`} variant="success" />
            <StatChip label={`Spent ₦${monthlyExpenses.toLocaleString('en-NG')}`} variant="accent" />
            <StatChip
              label={`Balance ₦${(monthlyIncome - monthlyExpenses).toLocaleString('en-NG')}`}
              variant={monthlyIncome - monthlyExpenses >= 0 ? 'primary' : 'danger'}
            />
          </div>
        </FeatureHero>
      </div>

      {/* ─── TAB BAR ─── */}
      <Tabs value={activeTab} onValueChange={(value) => selectBudgetTab(value as BudgetTab)} aria-label="Budget sections" className="shrink-0 flex flex-col flex-1 min-h-0">
      <TabList className="bg-lantern-surface border-b border-lantern-border px-4 gap-1 overflow-x-auto !border-solid">
        {tabs.map((t, index) => (
          <Tab
            key={t.key}
            value={t.key}
            index={index}
            icon={t.icon}
            className="!rounded-none whitespace-nowrap !px-4 !py-3"
          >
            {t.label}
          </Tab>
        ))}
      </TabList>

      <div className="p-4 md:p-6 flex-1 min-h-0 overflow-y-auto">
        <TabPanel value="overview" className="space-y-6">
            {/* Month switcher — forward stops at the current month. */}
            <div className="flex items-center justify-between bg-lantern-surface rounded-2xl px-2 py-2 shadow-sm">
              <button
                type="button"
                onClick={() => setSelectedMonth(m => addMonths(m, -1))}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-lantern-text hover:bg-lantern-background-secondary"
                aria-label="Previous month"
              >
                ‹
              </button>
              <div className="text-center">
                <p className="text-sm font-semibold text-lantern-text">{monthName}</p>
                {!isCurrentMonth && (
                  <button
                    type="button"
                    onClick={() => setSelectedMonth(currentMonth)}
                    className="text-xs text-lantern-primary hover:underline"
                  >
                    Back to this month
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedMonth(m => addMonths(m, 1))}
                disabled={compareMonthYear(selectedMonth, currentMonth) >= 0}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-lantern-text hover:bg-lantern-background-secondary disabled:opacity-25"
                aria-label="Next month"
              >
                ›
              </button>
            </div>

            {/* Budget Progress */}
            {budgetLimit > 0 ? (
              <div className="bg-lantern-surface rounded-2xl p-5 shadow-sm">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-semibold text-lantern-text">
                    {isCurrentMonth ? 'Monthly Budget' : `${monthName} Budget`}
                  </h3>
                  {isCurrentMonth && onOpenSetMonthlyPlan && (
                    <button onClick={onOpenSetMonthlyPlan} className="text-xs text-lantern-primary hover:underline">Category Budgets</button>
                  )}
                </div>
                <div className="flex items-center gap-5">
                  <BudgetRing pct={budgetProgress} remaining={budgetLimit - monthlyExpenses} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1.5 flex-wrap">
                      <span className="text-2xl font-bold text-lantern-text">₦{monthlyExpenses.toLocaleString('en-NG')}</span>
                      <span className="text-sm text-lantern-text-tertiary">of ₦{budgetLimit.toLocaleString('en-NG')} spent</span>
                    </div>
                    {budgetProgress > 100 && (
                      <p className="text-sm mt-1 text-red-500 font-medium">
                        ⚠️ ₦{(monthlyExpenses - budgetLimit).toLocaleString('en-NG')} over budget
                      </p>
                    )}

                    {/* Pace — a percentage spent is only meaningful beside the date. */}
                    {spendPace.verdict !== 'no-budget' && (
                      <p
                        className={`text-xs mt-2 ${
                          spendPace.verdict === 'over'
                            ? 'text-red-500'
                            : spendPace.verdict === 'ahead'
                              ? 'text-amber-500'
                              : 'text-emerald-500'
                        }`}
                      >
                        Day {pace.daysElapsed} of {pace.daysInPeriod} ({Math.round(pace.elapsedRatio * 100)}%)
                        {' · '}
                        {Math.round(spendPace.spentRatio * 100)}% spent
                        {spendPace.verdict === 'ahead'
                          ? ` — ₦${Math.round(spendPace.spendVsExpected).toLocaleString('en-NG')} ahead of pace`
                          : ''}
                      </p>
                    )}
                  </div>
                </div>

                {/* Zero-based check: unassigned income is money without a job. */}
                {planSummary.totalPlannedIncome > 0 && (
                  <div
                    className={`mt-4 pt-3 border-t border-lantern-border flex items-center justify-between ${
                      planSummary.isBalanced ? 'text-emerald-500' : ''
                    }`}
                  >
                    <span className="text-sm text-lantern-text-secondary">
                      {planSummary.isBalanced
                        ? 'Every naira has a job'
                        : planSummary.leftToAllocate > 0
                          ? 'Left to allocate'
                          : 'Over-committed by'}
                    </span>
                    <span
                      className={`text-base font-bold ${
                        planSummary.isBalanced
                          ? 'text-emerald-500'
                          : planSummary.leftToAllocate > 0
                            ? 'text-lantern-text'
                            : 'text-red-500'
                      }`}
                    >
                      {planSummary.isBalanced
                        ? '✓'
                        : `₦${Math.abs(Math.round(planSummary.leftToAllocate)).toLocaleString('en-NG')}`}
                    </span>
                  </div>
                )}
                {/* Category budget bars */}
                {activeBudget?.categoryBudgets && Object.keys(activeBudget.categoryBudgets).length > 0 && (
                  <div className="mt-4 pt-4 border-t border-lantern-border space-y-2">
                    {Object.entries(activeBudget.categoryBudgets).slice(0, 5).map(([catId, limit]) => {
                      const spent = monthlyTransactions.filter(t => t.type === TransactionType.EXPENSE && t.category === catId).reduce((s, t) => s + t.amount, 0);
                      const cat = getCategoryInfo(catId, TransactionType.EXPENSE);
                      const pct = limit > 0 ? (spent / limit) * 100 : 0;
                      return (
                        <div key={catId}>
                          <div className="flex justify-between text-xs">
                            <span>{cat.icon} {cat.label}</span>
                            <span className={pct > 100 ? 'text-red-500 font-medium' : 'text-lantern-text-tertiary'}>₦{spent.toLocaleString('en-NG')} / ₦{limit.toLocaleString('en-NG')}</span>
                          </div>
                          <div className="w-full bg-lantern-background-secondary dark:bg-lantern-surface-secondary rounded-full h-1.5 mt-1">
                            <div className={`h-1.5 rounded-full ${pct > 100 ? 'bg-red-500' : 'bg-lantern-primary-light'}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-lantern-surface rounded-2xl p-5 shadow-sm text-center">
                <div className="text-4xl mb-2">💰</div>
                <p className="text-lantern-text-secondary">
                  {isCurrentMonth
                    ? 'No budget set for this month'
                    : `No budget was set for ${monthName}`}
                </p>
                {isCurrentMonth && (
                  <button
                    onClick={onOpenSetBudget}
                    className="mt-3 inline-flex items-center gap-1.5 bg-lantern-primary text-white hover:bg-lantern-primary-dark px-4 py-2.5 rounded-xl text-sm font-semibold shadow-sm transition-colors"
                  >
                    <Cog6ToothIcon className="w-4 h-4" />
                    Set your monthly budget
                  </button>
                )}
              </div>
            )}

            <BudgetQuickLinks
              onAddExpense={onOpenAddExpense}
              onAddIncome={onOpenAddIncome}
              onSavingsGoal={onOpenSavingsGoal || (() => selectBudgetTab('goals'))}
              onExpenseSplit={onOpenExpenseSplit}
            />

            {/* Spending by Category */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-lantern-surface rounded-2xl p-5 shadow-sm">
                <h3 className="font-semibold text-lantern-text mb-4">Spending Breakdown</h3>
                {expenseByCategory.length > 0 ? (
                  <div className="h-56">
                    <canvas ref={chartRef} />
                  </div>
                ) : (
                  <p className="text-center text-sm text-lantern-text-tertiary py-8">No expenses yet this month</p>
                )}
              </div>
              <div className="bg-lantern-surface rounded-2xl p-5 shadow-sm">
                <h3 className="font-semibold text-lantern-text mb-3">Top Categories</h3>
                {expenseByCategory.length > 0 ? (
                  <div className="space-y-3">
                    {expenseByCategory.slice(0, 6).map((cat) => {
                      const pct = monthlyExpenses > 0 ? (cat.amount / monthlyExpenses) * 100 : 0;
                      return (
                        <div key={cat.id} className="flex items-center gap-3">
                          <span className="text-xl">{cat.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between text-sm">
                              <span className="truncate font-medium text-lantern-text">{cat.label}</span>
                              <span className="text-lantern-text-secondary ml-2">₦{cat.amount.toLocaleString('en-NG')}</span>
                            </div>
                            <div className="w-full bg-lantern-background-secondary dark:bg-lantern-surface-secondary rounded-full h-1.5 mt-1">
                              <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, backgroundColor: cat.color }} />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-center text-sm text-lantern-text-tertiary py-8">No data yet</p>
                )}
              </div>
            </div>

            {/* Savings Goals preview */}
            {savingsGoals.length > 0 && (
              <div className="bg-lantern-surface rounded-2xl p-5 shadow-sm">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-semibold text-lantern-text">Savings Goals</h3>
                  <button onClick={() => selectBudgetTab('goals')} className="text-xs text-lantern-primary hover:underline">View All</button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {savingsGoals.slice(0, 2).map(goal => {
                    const pct = goal.targetAmount > 0 ? (goal.currentAmount / goal.targetAmount) * 100 : 0;
                    return (
                      <div key={goal.id} className="bg-lantern-background dark:bg-lantern-surface-secondary/50 rounded-xl p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xl">{goal.icon}</span>
                          <span className="font-medium text-sm text-lantern-text">{goal.name}</span>
                          {goal.completedAt && <span className="text-xs bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-full">Done!</span>}
                        </div>
                        <div className="flex justify-between text-xs text-lantern-text-secondary mb-1">
                          <span>₦{goal.currentAmount.toLocaleString('en-NG')}</span>
                          <span>₦{goal.targetAmount.toLocaleString('en-NG')}</span>
                        </div>
                        <div className="w-full bg-lantern-border rounded-full h-2">
                          <div className="h-2 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all" style={{ width: `${Math.min(pct, 100)}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {/* ── Insights (folded into Overview so the feature reads as one screen) ── */}
            <div className="bg-lantern-surface rounded-2xl p-5 shadow-sm">
              <h3 className="font-semibold text-lantern-text mb-3 flex items-center gap-2">
                <ArrowTrendingUpIcon className="w-5 h-5 text-lantern-primary" /> Spending Summary
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center">
                  <p className="text-2xl font-bold text-lantern-text">{monthlyTransactions.length}</p>
                  <p className="text-xs text-lantern-text-tertiary">Transactions</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-red-500">₦{monthlyExpenses > 0 ? Math.round(monthlyExpenses / Math.max(monthlyTransactions.filter(t => t.type === TransactionType.EXPENSE).length, 1)).toLocaleString('en-NG') : '0'}</p>
                  <p className="text-xs text-lantern-text-tertiary">Avg Expense</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-lantern-primary">{expenseByCategory.length}</p>
                  <p className="text-xs text-lantern-text-tertiary">Categories</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-amber-500">{savingsGoals.filter(g => !g.completedAt).length}</p>
                  <p className="text-xs text-lantern-text-tertiary">Active Goals</p>
                </div>
              </div>
            </div>

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
              <h3 className="font-semibold text-lantern-text mb-3 flex items-center gap-2">
                <LightBulbIcon className="w-5 h-5 text-amber-500" /> Money Tips for Students
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {FINANCIAL_TIPS.map(tip => (
                  <div key={tip.id} className="bg-lantern-surface rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">{tip.icon}</span>
                      <div>
                        <h4 className="font-medium text-sm text-lantern-text">{tip.title}</h4>
                        <p className="text-xs text-lantern-text-secondary mt-0.5 leading-relaxed">{tip.content}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
        </TabPanel>

        <TabPanel value="transactions" className="space-y-4">
            {/* Filter + Actions */}
            <div className="flex flex-wrap gap-2 items-center justify-between">
              <div className="flex gap-1 bg-lantern-surface rounded-xl p-1 shadow-sm">
                {(['all', 'income', 'expense'] as const).map(f => (
                  <button key={f} onClick={() => setTxFilter(f)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                      txFilter === f
                        ? 'bg-lantern-primary text-white'
                        : 'text-lantern-text-secondary hover:bg-lantern-background-secondary'
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
            <div className="bg-lantern-surface rounded-2xl shadow-sm overflow-hidden">
              {filteredTransactions.length > 0 ? (
                <ul className="divide-y divide-lantern-border">
                  {filteredTransactions.map(t => {
                    const cat = getCategoryInfo(t.category, t.type);
                    const pres = getTxPresentation(t.type);
                    return (
                      <li key={t.id} className="px-4 py-3 flex justify-between items-center hover:bg-lantern-background dark:hover:bg-lantern-surface-secondary/30 transition-colors">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${pres.iconBg}`}>
                            {cat.icon}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-sm text-lantern-text truncate">{t.description}</p>
                            <p className="text-xs text-lantern-text-tertiary">{cat.label} &middot; {parseDateOnlyLocal(t.date).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`font-semibold text-sm ${pres.amountClass}`}>
                            {pres.sign}₦{t.amount.toLocaleString('en-NG')}
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleConfirmDeleteTransaction(t)}
                            aria-label={`Delete transaction ${t.description}`}
                            className="text-lantern-text-tertiary hover:text-red-500 dark:hover:text-red-400 transition-colors"
                          >
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
                  <p className="text-lantern-text-tertiary text-sm">
                    No {txFilter !== 'all' ? txFilter : ''} transactions in {monthName}
                  </p>
                </div>
              )}
            </div>
        </TabPanel>

        <TabPanel value="goals" className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold text-lantern-text">Savings Goals</h3>
              {onOpenSavingsGoal && (
                <button onClick={onOpenSavingsGoal} className="bg-lantern-primary text-white px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 hover:bg-lantern-primary">
                  <PlusCircleIcon className="w-4 h-4" /> New Goal
                </button>
              )}
            </div>

            {savingsGoals.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {savingsGoals.map(goal => {
                  const pct = goal.targetAmount > 0 ? (goal.currentAmount / goal.targetAmount) * 100 : 0;
                  return (
                    <div key={goal.id} className="bg-lantern-surface rounded-2xl p-5 shadow-sm">
                      <div className="flex items-center gap-3 mb-3">
                        <span className="text-3xl">{goal.icon}</span>
                        <div>
                          <h4 className="font-semibold text-lantern-text">{goal.name}</h4>
                          {goal.deadline && (
                            <p className="text-xs text-lantern-text-tertiary">
                              Due {parseDateOnlyLocal(goal.deadline).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </p>
                          )}
                        </div>
                        {goal.completedAt && (
                          <span className="ml-auto bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 text-xs font-semibold px-2 py-1 rounded-full">✓ Complete</span>
                        )}
                      </div>
                      <div className="flex justify-between text-sm mb-2">
                        <span className="font-medium text-lantern-text">₦{goal.currentAmount.toLocaleString('en-NG')}</span>
                        <span className="text-lantern-text-tertiary">₦{goal.targetAmount.toLocaleString('en-NG')}</span>
                      </div>
                      <div className="w-full bg-lantern-background-secondary dark:bg-lantern-surface-secondary rounded-full h-3">
                        <div className="h-3 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all duration-500" style={{ width: `${Math.min(pct, 100)}%` }} />
                      </div>
                      <p className="text-xs text-lantern-text-tertiary mt-2">{pct.toFixed(0)}% saved</p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="bg-lantern-surface rounded-2xl p-8 shadow-sm text-center">
                <div className="text-5xl mb-3">🎯</div>
                <h4 className="font-semibold text-lantern-text mb-1">No savings goals yet</h4>
                <p className="text-sm text-lantern-text-tertiary mb-3">Set a goal to save for something special — a new phone, textbooks, or a trip!</p>
                {onOpenSavingsGoal && (
                  <button onClick={onOpenSavingsGoal} className="bg-lantern-primary text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-lantern-primary">
                    Create Your First Goal
                  </button>
                )}
              </div>
            )}

            {/* Active Expense Splits */}
            {expenseSplits.length > 0 && (
              <div className="mt-6">
                <h3 className="text-lg font-semibold text-lantern-text mb-3">Expense Splits</h3>
                <div className="space-y-3">
                  {expenseSplits.filter(s => s.status === 'active').map(split => (
                    <div key={split.id} className="bg-lantern-surface rounded-2xl p-4 shadow-sm">
                      <div className="flex justify-between items-center mb-2">
                        <div>
                          <h4 className="font-medium text-lantern-text">{split.title}</h4>
                          <p className="text-xs text-lantern-text-tertiary">{split.participants.length} people &middot; ₦{split.totalAmount.toLocaleString('en-NG')} total</p>
                        </div>
                        <span className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs px-2 py-1 rounded-full font-medium">Active</span>
                      </div>
                      <div className="flex gap-1 mt-2">
                        {split.participants.map(p => (
                          <div key={p.userId} className={`flex-1 h-2 rounded-full ${p.paid ? 'bg-emerald-400' : 'bg-lantern-border'}`} title={`${p.userName}: ${p.paid ? 'Paid' : 'Unpaid'}`} />
                        ))}
                      </div>
                      <p className="text-xs text-lantern-text-tertiary mt-1">
                        {split.participants.filter(p => p.paid).length}/{split.participants.length} paid
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
        </TabPanel>

        <TabPanel value="wallet" className="space-y-4">
          <StudyWalletPanel />
        </TabPanel>

      </div>
      </Tabs>
    </div>
  );
};

export default BudgetTrackerScreen;