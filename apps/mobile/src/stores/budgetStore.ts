/**
 * Budget Store
 * Manages budget tracking, transactions, income/expenses, savings goals,
 * expense splits, wallet balance, and category budgets.
 * Uses local-first approach: data is stored in AsyncStorage and synced with Supabase.
 */
import { toDateOnlyLocal } from '@lantern/shared/utils/dateOnly';
import {
  isBudgetForMonth,
  normalizeMonthlyPlans,
  readPlanForMonth,
  toMonthYear,
  writePlanForMonth,
  type MonthlyPlans,
} from '@lantern/shared/utils';
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as api from '../services/api';
import { syncService } from '../services/syncService';
import { fetchBudgetExtras, saveBudgetExtras } from '../services/budgetExtrasSync';
import {
  STUDENT_EXPENSE_CATEGORIES,
  STUDENT_INCOME_CATEGORIES,
} from '@lantern/shared';
import {
  fetchBudgetTransactions as fetchBudgetTransactionsFromSupabase,
  saveBudgetTransaction as saveBudgetTransactionToSupabase,
  deleteBudgetTransaction as deleteBudgetTransactionFromSupabase,
} from '../services/supabase';

// Demo mode flag
const DEMO_MODE = false;

export type TransactionType = 'INCOME' | 'EXPENSE' | 'INVESTMENT';

export interface Transaction {
  id: string;
  userId: string;
  type: TransactionType;
  amount: number;
  category: string;
  description: string;
  date: string; // ISO Date string
}

/**
 * NOTE: `targetAmount` here is the same concept the web client and the API call
 * `monthlyLimit` (mapped in fetchBudget below). The plan fields deliberately use
 * the shared names so both clients feed @lantern/shared's budgetPlan helpers
 * unchanged; folding targetAmount into that shared shape is the remaining step.
 */
export interface Budget {
  userId: string;
  month: string; // YYYY-MM format
  /** Monthly expense cap. Same field the API and web client call monthlyLimit. */
  monthlyLimit: number;
  categoryBudgets?: Record<string, number>; // category -> allocated amount
  /** Planned income per category — the other half of a zero-based plan. */
  plannedIncome?: Record<string, number>;
  /** Planned savings allocation for the month. */
  plannedSavings?: number;
}

export interface SavingsGoal {
  id: string;
  userId: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  emoji?: string;
  /** Web-parity fields — the API returns these; store + render them too. */
  icon?: string;
  deadline?: string;
  completedAt?: string;
  createdAt: string;
}

// Matches the web ExpenseSplit shape (services/../types) so splits sync
// interchangeably between platforms via budgetExtras.
export interface ExpenseSplitParticipant {
  userId: string;
  userName: string;
  amount: number;
  paid: boolean;
}

export interface ExpenseSplit {
  id: string;
  creatorId: string;
  title: string;
  totalAmount: number;
  category: string;
  participants: ExpenseSplitParticipant[];
  status: 'active' | 'settled';
  createdAt: string;
}

export interface CategoryBreakdown {
  name: string;
  amount: number;
  color: string;
}

export const EXPENSE_CATEGORIES = STUDENT_EXPENSE_CATEGORIES;
export const INCOME_CATEGORIES = STUDENT_INCOME_CATEGORIES;

const LEGACY_EXPENSE_CATEGORY_MAP: Record<string, string> = {
  'Food & Drink': 'food_feeding',
  Shopping: 'clothing_fashion',
  Transport: 'transport',
  Home: 'accommodation',
  'Bills & Fees': 'bills_utilities',
  Entertainment: 'social_entertainment',
  Car: 'transport',
  Travel: 'transport',
  Health: 'health_pharmacy',
  Education: 'books_materials',
  Groceries: 'food_feeding',
  Gifts: 'other',
  Other: 'other',
  Food: 'food_feeding',
  Bills: 'bills_utilities',
};

const LEGACY_INCOME_CATEGORY_MAP: Record<string, string> = {
  Salary: 'allowance',
  Freelance: 'freelance',
  Investment: 'other',
  Gift: 'gift',
  Allowance: 'allowance',
  Other: 'other',
};

const EXPENSE_CATEGORY_IDS = new Set<string>(STUDENT_EXPENSE_CATEGORIES.map(c => c.id));
const INCOME_CATEGORY_IDS = new Set<string>(STUDENT_INCOME_CATEGORIES.map(c => c.id));

export function normalizeTransactionCategory(category: string, type: TransactionType): string {
  if (type === 'EXPENSE') {
    if (EXPENSE_CATEGORY_IDS.has(category)) return category;
    return LEGACY_EXPENSE_CATEGORY_MAP[category] || 'other';
  }
  if (type === 'INCOME') {
    if (INCOME_CATEGORY_IDS.has(category)) return category;
    return LEGACY_INCOME_CATEGORY_MAP[category] || 'other';
  }
  return category || 'other';
}

export function getCategoryLabel(categoryId: string, type: TransactionType): string {
  const cats = type === 'INCOME' ? STUDENT_INCOME_CATEGORIES : STUDENT_EXPENSE_CATEGORIES;
  return cats.find(c => c.id === categoryId)?.label ?? categoryId;
}

export function getCategoryIcon(categoryId: string, type: TransactionType): string {
  const cats = type === 'INCOME' ? STUDENT_INCOME_CATEGORIES : STUDENT_EXPENSE_CATEGORIES;
  return cats.find(c => c.id === categoryId)?.icon ?? '📦';
}

// Stable per-category swatch from the shared def — the same colour the web charts
// use, so a category looks identical on both platforms (no index-based drift).
export function getCategoryColor(categoryId: string, type: TransactionType): string {
  const cats = type === 'INCOME' ? STUDENT_INCOME_CATEGORIES : STUDENT_EXPENSE_CATEGORIES;
  return cats.find(c => c.id === categoryId)?.color ?? '#94a3b8';
}

function normalizeTransactions(transactions: Transaction[]): Transaction[] {
  return transactions.map(t => ({
    ...t,
    category: normalizeTransactionCategory(t.category, t.type),
  }));
}

export const CATEGORY_COLORS = [
  '#6366f1', // Indigo
  '#ec4899', // Pink
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#3b82f6', // Blue
  '#8b5cf6', // Violet
  '#06b6d4', // Cyan
  '#f97316', // Orange
  '#ef4444', // Red
  '#84cc16', // Lime
  '#14b8a6', // Teal
  '#a855f7', // Purple
  '#6b7280', // Gray
];

// Demo transactions
const DEMO_TRANSACTIONS: Transaction[] = [
  {
    id: 'trans-1',
    userId: 'demo-user',
    type: 'EXPENSE',
    amount: 5500,
    category: 'food_feeding',
    description: 'Lunch at restaurant',
    date: toDateOnlyLocal(new Date()),
  },
  {
    id: 'trans-2',
    userId: 'demo-user',
    type: 'EXPENSE',
    amount: 15000,
    category: 'transport',
    description: 'Uber rides this week',
    date: toDateOnlyLocal(new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)),
  },
  {
    id: 'trans-3',
    userId: 'demo-user',
    type: 'INCOME',
    amount: 150000,
    category: 'allowance',
    description: 'Monthly salary',
    date: toDateOnlyLocal(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)),
  },
  {
    id: 'trans-4',
    userId: 'demo-user',
    type: 'EXPENSE',
    amount: 25000,
    category: 'clothing_fashion',
    description: 'New shoes',
    date: toDateOnlyLocal(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)),
  },
  {
    id: 'trans-5',
    userId: 'demo-user',
    type: 'EXPENSE',
    amount: 8000,
    category: 'social_entertainment',
    description: 'Movie tickets',
    date: toDateOnlyLocal(new Date(Date.now() - 4 * 24 * 60 * 60 * 1000)),
  },
  {
    id: 'trans-6',
    userId: 'demo-user',
    type: 'EXPENSE',
    amount: 12000,
    category: 'bills_utilities',
    description: 'Internet subscription',
    date: toDateOnlyLocal(new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)),
  },
  {
    id: 'trans-7',
    userId: 'demo-user',
    type: 'INCOME',
    amount: 25000,
    category: 'freelance',
    description: 'Side project payment',
    date: toDateOnlyLocal(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000)),
  },
];

const DEMO_BUDGET: Budget = {
  userId: 'demo-user',
  month: new Date().toISOString().slice(0, 7),
  monthlyLimit: 100000,
};

/** Accept both the current and pre-rename cached budget shapes. */
function normalizeStoredBudget(raw: unknown): Budget | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Partial<Budget> & { targetAmount?: number };
  const limit = Number(b.monthlyLimit ?? b.targetAmount ?? 0);
  return {
    userId: String(b.userId ?? ''),
    month: String(b.month ?? new Date().toISOString().slice(0, 7)),
    monthlyLimit: Number.isFinite(limit) ? limit : 0,
    categoryBudgets: b.categoryBudgets,
    plannedIncome: b.plannedIncome,
    plannedSavings: b.plannedSavings,
  };
}

// Helper function to merge local and remote transactions
const mergeTransactions = (local: Transaction[], remote: Transaction[]): Transaction[] => {
  const merged = new Map<string, Transaction>();
  
  // Add local transactions
  local.forEach(t => merged.set(t.id, t));
  
  // Override with remote transactions (they are the source of truth)
  remote.forEach(t => merged.set(t.id, t));
  
  // Sort by date descending
  return Array.from(merged.values()).sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
};

let budgetExtrasSyncTimer: ReturnType<typeof setTimeout> | null = null;

const scheduleBudgetExtrasSync = (userId: string, getState: () => BudgetState) => {
  if (DEMO_MODE || !userId) return;
  if (budgetExtrasSyncTimer) clearTimeout(budgetExtrasSyncTimer);
  budgetExtrasSyncTimer = setTimeout(() => {
    const { savingsGoals, expenseSplits, budget, plansByMonth } = getState();
    saveBudgetExtras(userId, {
      savingsGoals,
      expenseSplits,
      categoryBudgets: budget?.categoryBudgets,
      plannedIncome: budget?.plannedIncome,
      plannedSavings: budget?.plannedSavings,
      plansByMonth,
    }).catch(err => {
      console.warn('Failed to sync budget extras:', err);
    });
  }, 1500);
};

const cacheBudgetExtrasLocally = async (
  userId: string,
  // walletBalance is optional to match BudgetExtras; fetchBudgetExtras always
  // supplies a number, so the 0 fallback only guards the type.
  extras: { savingsGoals: SavingsGoal[]; expenseSplits: ExpenseSplit[]; walletBalance?: number }
) => {
  await Promise.all([
    AsyncStorage.setItem(`savingsGoals_${userId}`, JSON.stringify(extras.savingsGoals)),
    AsyncStorage.setItem(`expenseSplits_${userId}`, JSON.stringify(extras.expenseSplits)),
    AsyncStorage.setItem(`walletBalance_${userId}`, (extras.walletBalance ?? 0).toString()),
  ]);
};

interface BudgetState {
  transactions: Transaction[];
  budget: Budget | null;
  /** Per-month plans, keyed yyyy-mm — the source of truth for history. */
  plansByMonth: MonthlyPlans;
  savingsGoals: SavingsGoal[];
  expenseSplits: ExpenseSplit[];
  walletBalance: number;
  isLoading: boolean;
  error: string | null;

  // Computed values
  monthlyExpenses: number;
  monthlyIncome: number;
  budgetProgress: number;
  expensesByCategory: CategoryBreakdown[];

  // Actions
  fetchTransactions: (userId: string) => Promise<void>;
  fetchBudget: (userId: string) => Promise<void>;
  addTransaction: (transaction: Omit<Transaction, 'id'>) => Promise<void>;
  deleteTransaction: (transactionId: string) => Promise<void>;
  setBudget: (userId: string, amount: number, categoryBudgets?: Record<string, number>) => Promise<void>;
  setBudgetPlan: (
    userId: string,
    plan: { plannedIncome?: Record<string, number>; plannedSavings?: number },
    /** Which month the plan belongs to; defaults to the current month. */
    monthYear?: string
  ) => Promise<void>;
  /** The stored plan for a month, with the legacy fallback for the current one. */
  getPlanForMonth: (monthYear: string) => ReturnType<typeof readPlanForMonth>;
  computeStats: () => void;
  clearError: () => void;

  // Savings goals actions
  loadSavingsGoals: (userId: string) => Promise<void>;
  addSavingsGoal: (
    // icon/deadline are accepted by the API (POST /budget/goals) but are not
    // part of the locally persisted SavingsGoal shape.
    goal: Omit<SavingsGoal, 'id' | 'createdAt'> & { icon?: string; deadline?: string }
  ) => Promise<void>;
  contributeToGoal: (goalId: string, amount: number) => Promise<void>;
  removeSavingsGoal: (goalId: string) => Promise<void>;

  // Expense split actions
  loadExpenseSplits: (userId: string) => Promise<void>;
  addExpenseSplit: (split: Omit<ExpenseSplit, 'id' | 'createdAt' | 'status'>) => Promise<void>;
  toggleSplitParticipantPaid: (splitId: string, participantIndex: number) => Promise<void>;
  removeExpenseSplit: (splitId: string) => Promise<void>;
  settleExpenseSplit: (splitId: string) => Promise<void>;

  // Wallet actions
  loadWalletBalance: (userId: string) => Promise<void>;
  adjustWalletBalance: (amount: number, userId?: string) => Promise<void>;
  loadBudgetExtras: (userId: string) => Promise<void>;
}

export const useBudgetStore = create<BudgetState>((set, get) => ({
  transactions: [],
  budget: null,
  plansByMonth: {},
  savingsGoals: [],
  expenseSplits: [],
  walletBalance: 0,
  isLoading: false,
  error: null,
  monthlyExpenses: 0,
  monthlyIncome: 0,
  budgetProgress: 0,
  expensesByCategory: [],

  fetchTransactions: async (userId: string) => {
    try {
      set({ isLoading: true, error: null });

      if (DEMO_MODE) {
        await new Promise(resolve => setTimeout(resolve, 300));
        set({ transactions: DEMO_TRANSACTIONS, isLoading: false });
        get().computeStats();
        return;
      }

      // First, load from local storage for instant UI
      const stored = await AsyncStorage.getItem('budgetTransactions');
      const localTransactions = normalizeTransactions(stored ? JSON.parse(stored) : []);
      set({ transactions: localTransactions });
      get().computeStats();

      // Then fetch from Supabase (same source as web) and sync
      try {
        const apiTransactions = await fetchBudgetTransactionsFromSupabase(userId);
        if (apiTransactions && apiTransactions.length > 0) {
          const transactions: Transaction[] = apiTransactions.map((t) => ({
            id: t.id,
            userId: t.user_id,
            type: t.type.toUpperCase() as TransactionType,
            amount: t.amount,
            category: normalizeTransactionCategory(t.category || 'other', t.type.toUpperCase() as TransactionType),
            description: t.description || '',
            date: t.date,
          }));
          // Merge with local and update storage
          const mergedTransactions = normalizeTransactions(mergeTransactions(localTransactions, transactions));
          await AsyncStorage.setItem('budgetTransactions', JSON.stringify(mergedTransactions));
          set({ transactions: mergedTransactions, isLoading: false });
          get().computeStats();
        } else {
          set({ isLoading: false });
        }
      } catch (apiError) {
        console.warn('Failed to sync with API, using local data:', apiError);
        set({ isLoading: false });
      }
    } catch (error: any) {
      console.error('Failed to fetch transactions:', error);
      set({ error: error.message, isLoading: false });
    }
  },

  fetchBudget: async (userId: string) => {
    try {
      set({ isLoading: true, error: null });

      if (DEMO_MODE) {
        await new Promise(resolve => setTimeout(resolve, 200));
        set({ budget: DEMO_BUDGET, isLoading: false });
        get().computeStats();
        return;
      }

      // Load from local storage first
      const stored = await AsyncStorage.getItem('monthlyBudget');
      // Payloads cached before the rename carry targetAmount; without this an
      // upgrading user's budget reads as undefined until the next server fetch.
      const localBudget = stored ? normalizeStoredBudget(JSON.parse(stored)) : null;
      set({ budget: localBudget });
      get().computeStats();

      // Sync with API
      try {
        // Ask for THIS month explicitly rather than relying on the default.
        const apiBudget = await api.fetchUserBudget(userId, new Date().toISOString().slice(0, 7));
        if (apiBudget) {
          const existing = get().budget;
          const budget: Budget = {
            userId: userId,
            month: (apiBudget as any).month_year || (apiBudget as any).monthYear || existing?.month || new Date().toISOString().slice(0, 7),
            monthlyLimit: Number((apiBudget as any).monthly_limit ?? (apiBudget as any).monthlyLimit ?? 0),
            // The budget row holds only the limit; the plan lives in budgetExtras.
            categoryBudgets: existing?.categoryBudgets,
            plannedIncome: existing?.plannedIncome,
            plannedSavings: existing?.plannedSavings,
          };
          await AsyncStorage.setItem('monthlyBudget', JSON.stringify(budget));
          set({ budget, isLoading: false });
          get().computeStats();
        } else {
          set({ isLoading: false });
        }
      } catch (apiError) {
        console.warn('Failed to sync budget with API, using local data:', apiError);
        set({ isLoading: false });
      }

      await get().loadBudgetExtras(userId);
    } catch (error: any) {
      console.error('Failed to fetch budget:', error);
      set({ error: error.message, isLoading: false });
    }
  },

  addTransaction: async (transactionData) => {
    try {
      set({ isLoading: true, error: null });

      const newTransaction: Transaction = {
        ...transactionData,
        id: Crypto.randomUUID(),
      };

      const updatedTransactions = [newTransaction, ...get().transactions].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );

      // Update local storage immediately
      await AsyncStorage.setItem('budgetTransactions', JSON.stringify(updatedTransactions));
      set({ transactions: updatedTransactions, isLoading: false });
      get().computeStats();

      // Sync to Supabase in background (same DB as web)
      if (!DEMO_MODE) {
        try {
          const saved = await saveBudgetTransactionToSupabase(transactionData.userId, {
            id: newTransaction.id,
            type: transactionData.type.toLowerCase(),
            amount: transactionData.amount,
            category: transactionData.category,
            description: transactionData.description,
            date: transactionData.date,
          });
          if (!saved) throw new Error('Failed to save budget transaction');
        } catch (apiError) {
          console.warn('Failed to sync transaction to API:', apiError);
          await syncService.queueOperation(
            'transaction',
            newTransaction.id,
            'create',
            {
              id: newTransaction.id,
              type: transactionData.type.toLowerCase(),
              amount: transactionData.amount,
              category: transactionData.category,
              description: transactionData.description,
              date: transactionData.date,
            },
            transactionData.userId
          );
        }
      }
    } catch (error: any) {
      console.error('Failed to add transaction:', error);
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  deleteTransaction: async (transactionId: string) => {
    try {
      set({ isLoading: true, error: null });

      // Get userId from the transaction being deleted
      const transaction = get().transactions.find(t => t.id === transactionId);
      const userId = transaction?.userId || '';
      
      const updatedTransactions = get().transactions.filter(t => t.id !== transactionId);

      // Update local storage immediately
      await AsyncStorage.setItem('budgetTransactions', JSON.stringify(updatedTransactions));
      set({ transactions: updatedTransactions, isLoading: false });
      get().computeStats();

      // Sync delete to Supabase in background
      if (!DEMO_MODE && userId) {
        try {
          const deleted = await deleteBudgetTransactionFromSupabase(transactionId);
          if (!deleted) throw new Error('Failed to delete budget transaction');
        } catch (apiError) {
          console.warn('Failed to sync delete to API:', apiError);
          await syncService.queueOperation(
            'transaction',
            transactionId,
            'delete',
            {},
            userId
          );
        }
      }
    } catch (error: any) {
      console.error('Failed to delete transaction:', error);
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  setBudget: async (userId: string, amount: number, categoryBudgets?: Record<string, number>) => {
    try {
      set({ isLoading: true, error: null });

      const currentMonth = new Date().toISOString().slice(0, 7);
      const newBudget: Budget = {
        userId,
        month: currentMonth,
        monthlyLimit: amount,
        categoryBudgets: categoryBudgets ?? get().budget?.categoryBudgets,
        plannedIncome: get().budget?.plannedIncome,
        plannedSavings: get().budget?.plannedSavings,
      };

      // Update local storage immediately
      await AsyncStorage.setItem('monthlyBudget', JSON.stringify(newBudget));
      set({ budget: newBudget, isLoading: false });
      get().computeStats();

      if (!DEMO_MODE) {
        scheduleBudgetExtrasSync(userId, get);
      }

      // Sync to API in background
      if (!DEMO_MODE) {
        try {
          await api.saveUserBudget(userId, {
            monthlyLimit: amount,
            monthYear: currentMonth,
          });
        } catch (apiError) {
          console.warn('Failed to sync budget to API:', apiError);
        }
      }
    } catch (error: any) {
      console.error('Failed to set budget:', error);
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  getPlanForMonth: (monthYear: string) => {
    const { plansByMonth, budget } = get();
    return readPlanForMonth(
      {
        plansByMonth,
        categoryBudgets: budget?.categoryBudgets,
        plannedIncome: budget?.plannedIncome,
        plannedSavings: budget?.plannedSavings,
      },
      monthYear,
      toMonthYear(new Date())
    );
  },

  /**
   * Save the planning half of the budget: what income is expected and how much
   * of it is earmarked for savings. Stored in budgetExtras alongside the
   * per-category expense plan — the user_budgets row only holds the limit.
   */
  setBudgetPlan: async (userId, plan, monthYear) => {
    const currentMonth = toMonthYear(new Date());
    const targetMonth = monthYear ?? currentMonth;
    const current = get().budget;

    // The per-month map is the source of truth; writePlanForMonth also mirrors
    // a current-month edit into the flat fields for older builds.
    const written = writePlanForMonth(
      { plansByMonth: get().plansByMonth },
      targetMonth,
      {
        plannedExpenses: current?.categoryBudgets,
        plannedIncome: plan.plannedIncome,
        plannedSavings: plan.plannedSavings,
      },
      currentMonth
    );

    const next: Budget = {
      userId,
      month: current?.month ?? currentMonth,
      monthlyLimit: current?.monthlyLimit ?? 0,
      categoryBudgets: current?.categoryBudgets,
      plannedIncome:
        targetMonth === currentMonth ? plan.plannedIncome : current?.plannedIncome,
      plannedSavings:
        targetMonth === currentMonth ? plan.plannedSavings : current?.plannedSavings,
    };

    set({ budget: next, plansByMonth: written.plansByMonth ?? {} });
    get().computeStats();
    try {
      await AsyncStorage.setItem('monthlyBudget', JSON.stringify(next));
    } catch (error) {
      console.warn('Failed to cache budget plan locally:', error);
    }
    if (!DEMO_MODE) scheduleBudgetExtrasSync(userId, get);
  },

  computeStats: () => {
    const { transactions, budget } = get();
    const currentMonth = new Date().toISOString().slice(0, 7);

    // Filter transactions for current month
    const monthlyTransactions = transactions.filter(t => t.date.startsWith(currentMonth));

    // Calculate monthly totals
    const monthlyExpenses = monthlyTransactions
      .filter(t => t.type === 'EXPENSE')
      .reduce((sum, t) => sum + t.amount, 0);

    const monthlyIncome = monthlyTransactions
      .filter(t => t.type === 'INCOME')
      .reduce((sum, t) => sum + t.amount, 0);

    // Only a budget saved FOR this month may score this month. Without the
    // check, on the 1st the previous month's cap silently became the new one.
    const activeBudget =
      budget && isBudgetForMonth(budget.month, currentMonth) ? budget : null;
    const budgetProgress =
      activeBudget && activeBudget.monthlyLimit > 0
        ? (monthlyExpenses / activeBudget.monthlyLimit) * 100
        : 0;

    // Calculate expenses by category
    const categoryMap: { [key: string]: number } = {};
    monthlyTransactions
      .filter(t => t.type === 'EXPENSE')
      .forEach(t => {
        categoryMap[t.category] = (categoryMap[t.category] || 0) + t.amount;
      });

    const expensesByCategory = Object.entries(categoryMap)
      .map(([categoryId, amount], index) => ({
        name: getCategoryLabel(categoryId, 'EXPENSE'),
        amount,
        color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
      }))
      .sort((a, b) => b.amount - a.amount);

    set({
      monthlyExpenses,
      monthlyIncome,
      budgetProgress,
      expensesByCategory,
    });
  },

  clearError: () => set({ error: null }),

  loadBudgetExtras: async (userId: string) => {
    if (DEMO_MODE) return;

    try {
      const cloudExtras = await fetchBudgetExtras(userId);
      if (cloudExtras) {
        const currentBudget = get().budget;
        set({
          savingsGoals: cloudExtras.savingsGoals,
          expenseSplits: cloudExtras.expenseSplits,
          walletBalance: cloudExtras.walletBalance,
          plansByMonth: normalizeMonthlyPlans(cloudExtras.plansByMonth),
          budget: currentBudget
            ? {
                ...currentBudget,
                categoryBudgets: cloudExtras.categoryBudgets ?? currentBudget.categoryBudgets,
                plannedIncome: cloudExtras.plannedIncome ?? currentBudget.plannedIncome,
                plannedSavings: cloudExtras.plannedSavings ?? currentBudget.plannedSavings,
              }
            : cloudExtras.categoryBudgets || cloudExtras.plannedIncome || cloudExtras.plannedSavings
              ? {
                  userId,
                  month: new Date().toISOString().slice(0, 7),
                  monthlyLimit: 0,
                  categoryBudgets: cloudExtras.categoryBudgets,
                  plannedIncome: cloudExtras.plannedIncome,
                  plannedSavings: cloudExtras.plannedSavings,
                }
              : currentBudget,
        });
        await cacheBudgetExtrasLocally(userId, cloudExtras);
        return;
      }
    } catch (error) {
      console.warn('Failed to load budget extras from cloud:', error);
    }

    await Promise.all([
      get().loadSavingsGoals(userId),
      get().loadExpenseSplits(userId),
      get().loadWalletBalance(userId),
    ]);
  },

  // ─── Savings Goals ─────────────────────────────────────────────────────────
  loadSavingsGoals: async (userId: string) => {
    try {
      const stored = await AsyncStorage.getItem(`savingsGoals_${userId}`);
      const goals: SavingsGoal[] = stored ? JSON.parse(stored) : [];
      set({ savingsGoals: goals });
    } catch (e) {
      console.warn('Failed to load savings goals:', e);
    }
  },

  addSavingsGoal: async (goal) => {
    try {
      if (!DEMO_MODE) {
        const result = await api.createSavingsGoal({
          name: goal.name,
          targetAmount: goal.targetAmount,
          icon: goal.icon,
          deadline: goal.deadline,
        });
        const newGoal: SavingsGoal = {
          ...result.goal,
          userId: goal.userId,
        };
        const updated = [...get().savingsGoals, newGoal];
        set({ savingsGoals: updated, walletBalance: result.walletBalance });
        await cacheBudgetExtrasLocally(goal.userId, {
          savingsGoals: updated,
          expenseSplits: get().expenseSplits,
          walletBalance: result.walletBalance,
        });
        return;
      }
      const newGoal: SavingsGoal = {
        ...goal,
        id: `goal-${Date.now()}`,
        createdAt: new Date().toISOString(),
      };
      const updated = [...get().savingsGoals, newGoal];
      set({ savingsGoals: updated });
      await AsyncStorage.setItem(`savingsGoals_${goal.userId}`, JSON.stringify(updated));
    } catch (e: any) {
      set({ error: e.message });
      throw e;
    }
  },

  contributeToGoal: async (goalId: string, amount: number) => {
    try {
      if (!DEMO_MODE) {
        const result = await api.contributeToSavingsGoal(goalId, amount);
        const updated = get().savingsGoals.map(g =>
          g.id === goalId
            ? {
                ...g,
                currentAmount: result.goal.currentAmount,
                completedAt: result.goal.completedAt,
              }
            : g
        );
        set({ savingsGoals: updated, walletBalance: result.walletBalance });
        const goal = updated.find(g => g.id === goalId);
        if (goal) {
          await cacheBudgetExtrasLocally(goal.userId, {
            savingsGoals: updated,
            expenseSplits: get().expenseSplits,
            walletBalance: result.walletBalance,
          });
        }
        if (result.transaction) {
          const tx: Transaction = {
            id: result.transaction.id,
            userId: goal?.userId || '',
            type: 'INVESTMENT',
            amount: result.transaction.amount,
            category: result.transaction.category || 'savings',
            description: result.transaction.description || '',
            date: result.transaction.date,
          };
          set({ transactions: [tx, ...get().transactions] });
        }
        return;
      }
      const updated = get().savingsGoals.map(g =>
        g.id === goalId
          ? { ...g, currentAmount: Math.min(g.currentAmount + amount, g.targetAmount) }
          : g
      );
      set({ savingsGoals: updated });
      const goal = updated.find(g => g.id === goalId);
      if (goal) {
        await AsyncStorage.setItem(`savingsGoals_${goal.userId}`, JSON.stringify(updated));
      }
    } catch (e: any) {
      set({ error: e.message });
      throw e;
    }
  },

  removeSavingsGoal: async (goalId: string) => {
    try {
      const goal = get().savingsGoals.find(g => g.id === goalId);
      if (!DEMO_MODE) {
        const result = await api.deleteSavingsGoal(goalId);
        const updated = get().savingsGoals.filter(g => g.id !== goalId);
        set({ savingsGoals: updated, walletBalance: result.walletBalance });
        if (goal) {
          await cacheBudgetExtrasLocally(goal.userId, {
            savingsGoals: updated,
            expenseSplits: get().expenseSplits,
            walletBalance: result.walletBalance,
          });
        }
        return;
      }
      const updated = get().savingsGoals.filter(g => g.id !== goalId);
      set({ savingsGoals: updated });
      if (goal) {
        await AsyncStorage.setItem(`savingsGoals_${goal.userId}`, JSON.stringify(updated));
      }
    } catch (e: any) {
      set({ error: e.message });
      throw e;
    }
  },

  // ─── Expense Splits ─────────────────────────────────────────────────────────
  loadExpenseSplits: async (userId: string) => {
    try {
      const stored = await AsyncStorage.getItem(`expenseSplits_${userId}`);
      const splits: ExpenseSplit[] = stored ? JSON.parse(stored) : [];
      set({ expenseSplits: splits });
    } catch (e) {
      console.warn('Failed to load expense splits:', e);
    }
  },

  addExpenseSplit: async (split) => {
    try {
      const newSplit: ExpenseSplit = {
        ...split,
        id: `split-${Date.now()}`,
        createdAt: new Date().toISOString(),
        status: 'active',
      };
      const updated = [newSplit, ...get().expenseSplits];
      set({ expenseSplits: updated });
      await AsyncStorage.setItem(`expenseSplits_${split.creatorId}`, JSON.stringify(updated));
      scheduleBudgetExtrasSync(split.creatorId, get);
    } catch (e: any) {
      set({ error: e.message });
      throw e;
    }
  },

  toggleSplitParticipantPaid: async (splitId: string, participantIndex: number) => {
    try {
      const updated = get().expenseSplits.map(s => {
        if (s.id !== splitId) return s;
        const participants = s.participants.map((p, i) =>
          i === participantIndex ? { ...p, paid: !p.paid } : p
        );
        // Mirror web: a split auto-settles once every participant has paid.
        const status: 'active' | 'settled' = participants.every(p => p.paid) ? 'settled' : 'active';
        return { ...s, participants, status };
      });
      set({ expenseSplits: updated });
      const split = updated.find(s => s.id === splitId);
      if (split) {
        await AsyncStorage.setItem(`expenseSplits_${split.creatorId}`, JSON.stringify(updated));
        scheduleBudgetExtrasSync(split.creatorId, get);
      }
    } catch (e: any) {
      set({ error: e.message });
      throw e;
    }
  },

  removeExpenseSplit: async (splitId: string) => {
    try {
      const split = get().expenseSplits.find(s => s.id === splitId);
      const updated = get().expenseSplits.filter(s => s.id !== splitId);
      set({ expenseSplits: updated });
      if (split) {
        await AsyncStorage.setItem(`expenseSplits_${split.creatorId}`, JSON.stringify(updated));
        scheduleBudgetExtrasSync(split.creatorId, get);
      }
    } catch (e: any) {
      set({ error: e.message });
      throw e;
    }
  },

  settleExpenseSplit: async (splitId: string) => {
    try {
      const updated = get().expenseSplits.map(s =>
        s.id === splitId ? { ...s, status: 'settled' as const, participants: s.participants.map(p => ({ ...p, paid: true })) } : s
      );
      set({ expenseSplits: updated });
      const split = updated.find(s => s.id === splitId);
      if (split) {
        await AsyncStorage.setItem(`expenseSplits_${split.creatorId}`, JSON.stringify(updated));
        scheduleBudgetExtrasSync(split.creatorId, get);
      }
    } catch (e: any) {
      set({ error: e.message });
      throw e;
    }
  },

  // ─── Wallet ─────────────────────────────────────────────────────────────────
  loadWalletBalance: async (userId: string) => {
    try {
      if (!DEMO_MODE) {
        const data = await api.fetchBudgetWallet();
        set({
          walletBalance: data.walletBalance,
          savingsGoals: Array.isArray(data.savingsGoals) ? data.savingsGoals : get().savingsGoals,
          expenseSplits: Array.isArray(data.expenseSplits) ? data.expenseSplits : get().expenseSplits,
        });
        if (data.categoryBudgets && get().budget) {
          set({ budget: { ...get().budget!, categoryBudgets: data.categoryBudgets } });
        }
        await cacheBudgetExtrasLocally(userId, {
          savingsGoals: get().savingsGoals,
          expenseSplits: get().expenseSplits,
          walletBalance: data.walletBalance,
        });
        try {
          const award = await api.claimUnderBudgetAward();
          if (typeof award.walletBalance === 'number') {
            set({ walletBalance: award.walletBalance });
          }
        } catch {
          // non-critical
        }
        return;
      }
      const stored = await AsyncStorage.getItem(`walletBalance_${userId}`);
      set({ walletBalance: stored ? parseFloat(stored) : 0 });
    } catch (e) {
      console.warn('Failed to load wallet balance:', e);
      try {
        const stored = await AsyncStorage.getItem(`walletBalance_${userId}`);
        set({ walletBalance: stored ? parseFloat(stored) : 0 });
      } catch {
        // ignore
      }
    }
  },

  adjustWalletBalance: async (_amount: number, _userId?: string) => {
    // Wallet balance is server-authoritative; clients must not mint coins locally.
    throw new Error('Wallet balance can only be changed by study rewards or streak freeze purchases');
  },
}));

// Helper to format currency
export const formatCurrency = (amount: number): string => {
  return `₦${amount.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
};

// Helper to get progress bar color
export const getProgressBarColor = (progress: number): string => {
  if (progress > 100) return '#ef4444'; // Red
  if (progress > 80) return '#f97316'; // Orange
  if (progress > 50) return '#f59e0b'; // Amber
  return '#22c55e'; // Green
};
