/**
 * Budget Store
 * Manages budget tracking, transactions, income/expenses, savings goals,
 * expense splits, wallet balance, and category budgets.
 * Uses local-first approach: data is stored in AsyncStorage and synced with Supabase.
 */
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

export interface Budget {
  userId: string;
  month: string; // YYYY-MM format
  targetAmount: number;
  categoryBudgets?: Record<string, number>; // category -> allocated amount
}

export interface SavingsGoal {
  id: string;
  userId: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  emoji?: string;
  createdAt: string;
}

export interface ExpenseSplitParticipant {
  name: string;
  amount: number;
  paid: boolean;
}

export interface ExpenseSplit {
  id: string;
  userId: string;
  title: string;
  totalAmount: number;
  participants: ExpenseSplitParticipant[];
  createdAt: string;
  settled: boolean;
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
    date: new Date().toISOString().split('T')[0],
  },
  {
    id: 'trans-2',
    userId: 'demo-user',
    type: 'EXPENSE',
    amount: 15000,
    category: 'transport',
    description: 'Uber rides this week',
    date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  },
  {
    id: 'trans-3',
    userId: 'demo-user',
    type: 'INCOME',
    amount: 150000,
    category: 'allowance',
    description: 'Monthly salary',
    date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  },
  {
    id: 'trans-4',
    userId: 'demo-user',
    type: 'EXPENSE',
    amount: 25000,
    category: 'clothing_fashion',
    description: 'New shoes',
    date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  },
  {
    id: 'trans-5',
    userId: 'demo-user',
    type: 'EXPENSE',
    amount: 8000,
    category: 'social_entertainment',
    description: 'Movie tickets',
    date: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  },
  {
    id: 'trans-6',
    userId: 'demo-user',
    type: 'EXPENSE',
    amount: 12000,
    category: 'bills_utilities',
    description: 'Internet subscription',
    date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  },
  {
    id: 'trans-7',
    userId: 'demo-user',
    type: 'INCOME',
    amount: 25000,
    category: 'freelance',
    description: 'Side project payment',
    date: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  },
];

const DEMO_BUDGET: Budget = {
  userId: 'demo-user',
  month: new Date().toISOString().slice(0, 7),
  targetAmount: 100000,
};

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
    const { savingsGoals, expenseSplits, walletBalance, budget } = getState();
    saveBudgetExtras(userId, {
      savingsGoals,
      expenseSplits,
      walletBalance,
      categoryBudgets: budget?.categoryBudgets,
    }).catch(err => {
      console.warn('Failed to sync budget extras:', err);
    });
  }, 1500);
};

const cacheBudgetExtrasLocally = async (
  userId: string,
  extras: { savingsGoals: SavingsGoal[]; expenseSplits: ExpenseSplit[]; walletBalance: number }
) => {
  await Promise.all([
    AsyncStorage.setItem(`savingsGoals_${userId}`, JSON.stringify(extras.savingsGoals)),
    AsyncStorage.setItem(`expenseSplits_${userId}`, JSON.stringify(extras.expenseSplits)),
    AsyncStorage.setItem(`walletBalance_${userId}`, extras.walletBalance.toString()),
  ]);
};

interface BudgetState {
  transactions: Transaction[];
  budget: Budget | null;
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
  computeStats: () => void;
  clearError: () => void;

  // Savings goals actions
  loadSavingsGoals: (userId: string) => Promise<void>;
  addSavingsGoal: (goal: Omit<SavingsGoal, 'id' | 'createdAt'>) => Promise<void>;
  contributeToGoal: (goalId: string, amount: number) => Promise<void>;
  removeSavingsGoal: (goalId: string) => Promise<void>;

  // Expense split actions
  loadExpenseSplits: (userId: string) => Promise<void>;
  addExpenseSplit: (split: Omit<ExpenseSplit, 'id' | 'createdAt' | 'settled'>) => Promise<void>;
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
      const localBudget = stored ? JSON.parse(stored) : null;
      set({ budget: localBudget });
      get().computeStats();

      // Sync with API
      try {
        const apiBudget = await api.fetchUserBudget(userId);
        if (apiBudget) {
          const budget: Budget = {
            userId: userId,
            month: apiBudget.month_year,
            targetAmount: apiBudget.monthly_limit,
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
        targetAmount: amount,
        categoryBudgets: categoryBudgets ?? get().budget?.categoryBudgets,
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

    // Calculate budget progress
    const budgetProgress = budget ? (monthlyExpenses / budget.targetAmount) * 100 : 0;

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
          budget: currentBudget
            ? {
                ...currentBudget,
                categoryBudgets: cloudExtras.categoryBudgets ?? currentBudget.categoryBudgets,
              }
            : cloudExtras.categoryBudgets
              ? {
                  userId,
                  month: new Date().toISOString().slice(0, 7),
                  targetAmount: 0,
                  categoryBudgets: cloudExtras.categoryBudgets,
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
      const newGoal: SavingsGoal = {
        ...goal,
        id: `goal-${Date.now()}`,
        createdAt: new Date().toISOString(),
      };
      const updated = [...get().savingsGoals, newGoal];
      set({ savingsGoals: updated });
      await AsyncStorage.setItem(`savingsGoals_${goal.userId}`, JSON.stringify(updated));
      scheduleBudgetExtrasSync(goal.userId, get);
    } catch (e: any) {
      set({ error: e.message });
      throw e;
    }
  },

  contributeToGoal: async (goalId: string, amount: number) => {
    try {
      const updated = get().savingsGoals.map(g =>
        g.id === goalId
          ? { ...g, currentAmount: Math.min(g.currentAmount + amount, g.targetAmount) }
          : g
      );
      set({ savingsGoals: updated });
      const goal = updated.find(g => g.id === goalId);
      if (goal) {
        await AsyncStorage.setItem(`savingsGoals_${goal.userId}`, JSON.stringify(updated));
        scheduleBudgetExtrasSync(goal.userId, get);
      }
    } catch (e: any) {
      set({ error: e.message });
      throw e;
    }
  },

  removeSavingsGoal: async (goalId: string) => {
    try {
      const goal = get().savingsGoals.find(g => g.id === goalId);
      const updated = get().savingsGoals.filter(g => g.id !== goalId);
      set({ savingsGoals: updated });
      if (goal) {
        await AsyncStorage.setItem(`savingsGoals_${goal.userId}`, JSON.stringify(updated));
        scheduleBudgetExtrasSync(goal.userId, get);
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
        settled: false,
      };
      const updated = [newSplit, ...get().expenseSplits];
      set({ expenseSplits: updated });
      await AsyncStorage.setItem(`expenseSplits_${split.userId}`, JSON.stringify(updated));
      scheduleBudgetExtrasSync(split.userId, get);
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
        return { ...s, participants };
      });
      set({ expenseSplits: updated });
      const split = updated.find(s => s.id === splitId);
      if (split) {
        await AsyncStorage.setItem(`expenseSplits_${split.userId}`, JSON.stringify(updated));
        scheduleBudgetExtrasSync(split.userId, get);
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
        await AsyncStorage.setItem(`expenseSplits_${split.userId}`, JSON.stringify(updated));
        scheduleBudgetExtrasSync(split.userId, get);
      }
    } catch (e: any) {
      set({ error: e.message });
      throw e;
    }
  },

  settleExpenseSplit: async (splitId: string) => {
    try {
      const updated = get().expenseSplits.map(s =>
        s.id === splitId ? { ...s, settled: true, participants: s.participants.map(p => ({ ...p, paid: true })) } : s
      );
      set({ expenseSplits: updated });
      const split = updated.find(s => s.id === splitId);
      if (split) {
        await AsyncStorage.setItem(`expenseSplits_${split.userId}`, JSON.stringify(updated));
        scheduleBudgetExtrasSync(split.userId, get);
      }
    } catch (e: any) {
      set({ error: e.message });
      throw e;
    }
  },

  // ─── Wallet ─────────────────────────────────────────────────────────────────
  loadWalletBalance: async (userId: string) => {
    try {
      const stored = await AsyncStorage.getItem(`walletBalance_${userId}`);
      set({ walletBalance: stored ? parseFloat(stored) : 0 });
    } catch (e) {
      console.warn('Failed to load wallet balance:', e);
    }
  },

  adjustWalletBalance: async (amount: number, userId?: string) => {
    try {
      const newBalance = Math.max(0, get().walletBalance + amount);
      set({ walletBalance: newBalance });
      const effectiveUserId =
        userId ||
        get().budget?.userId ||
        get().savingsGoals[0]?.userId ||
        get().expenseSplits[0]?.userId;
      if (effectiveUserId) {
        await AsyncStorage.setItem(`walletBalance_${effectiveUserId}`, newBalance.toString());
        scheduleBudgetExtrasSync(effectiveUserId, get);
      } else {
        await AsyncStorage.setItem('walletBalance', newBalance.toString());
      }
    } catch (e: any) {
      set({ error: e.message });
      throw e;
    }
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
