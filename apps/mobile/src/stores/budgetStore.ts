/**
 * Budget Store
 * Manages budget tracking, transactions, income and expenses
 * Uses local-first approach: data is stored in AsyncStorage and synced with Supabase
 */
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as api from '../services/api';

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
}

export interface CategoryBreakdown {
  name: string;
  amount: number;
  color: string;
}

export const EXPENSE_CATEGORIES = [
  'Food & Drink',
  'Shopping',
  'Transport',
  'Home',
  'Bills & Fees',
  'Entertainment',
  'Car',
  'Travel',
  'Health',
  'Education',
  'Groceries',
  'Gifts',
  'Other',
];

export const INCOME_CATEGORIES = [
  'Salary',
  'Freelance',
  'Investment',
  'Gift',
  'Allowance',
  'Other',
];

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
    category: 'Food & Drink',
    description: 'Lunch at restaurant',
    date: new Date().toISOString().split('T')[0],
  },
  {
    id: 'trans-2',
    userId: 'demo-user',
    type: 'EXPENSE',
    amount: 15000,
    category: 'Transport',
    description: 'Uber rides this week',
    date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  },
  {
    id: 'trans-3',
    userId: 'demo-user',
    type: 'INCOME',
    amount: 150000,
    category: 'Salary',
    description: 'Monthly salary',
    date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  },
  {
    id: 'trans-4',
    userId: 'demo-user',
    type: 'EXPENSE',
    amount: 25000,
    category: 'Shopping',
    description: 'New shoes',
    date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  },
  {
    id: 'trans-5',
    userId: 'demo-user',
    type: 'EXPENSE',
    amount: 8000,
    category: 'Entertainment',
    description: 'Movie tickets',
    date: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  },
  {
    id: 'trans-6',
    userId: 'demo-user',
    type: 'EXPENSE',
    amount: 12000,
    category: 'Bills & Fees',
    description: 'Internet subscription',
    date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  },
  {
    id: 'trans-7',
    userId: 'demo-user',
    type: 'INCOME',
    amount: 25000,
    category: 'Freelance',
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

interface BudgetState {
  transactions: Transaction[];
  budget: Budget | null;
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
  setBudget: (userId: string, amount: number) => Promise<void>;
  computeStats: () => void;
  clearError: () => void;
}

export const useBudgetStore = create<BudgetState>((set, get) => ({
  transactions: [],
  budget: null,
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
      const localTransactions = stored ? JSON.parse(stored) : [];
      set({ transactions: localTransactions });
      get().computeStats();

      // Then fetch from API and sync
      try {
        const apiTransactions = await api.fetchBudgetTransactions(userId);
        if (apiTransactions && apiTransactions.length > 0) {
          const transactions: Transaction[] = apiTransactions.map((t) => ({
            id: t.id,
            userId: t.user_id,
            type: t.type.toUpperCase() as TransactionType,
            amount: t.amount,
            category: t.category || 'Other',
            description: t.description || '',
            date: t.date,
          }));
          // Merge with local and update storage
          const mergedTransactions = mergeTransactions(localTransactions, transactions);
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
        id: `trans-${Date.now()}`,
      };

      const updatedTransactions = [newTransaction, ...get().transactions].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );

      // Update local storage immediately
      await AsyncStorage.setItem('budgetTransactions', JSON.stringify(updatedTransactions));
      set({ transactions: updatedTransactions, isLoading: false });
      get().computeStats();

      // Sync to API in background
      if (!DEMO_MODE) {
        try {
          await api.saveBudgetTransaction(transactionData.userId, {
            id: newTransaction.id,
            type: transactionData.type.toLowerCase(),
            amount: transactionData.amount,
            category: transactionData.category,
            description: transactionData.description,
            date: transactionData.date,
          });
        } catch (apiError) {
          console.warn('Failed to sync transaction to API:', apiError);
          // Transaction is saved locally, will sync later
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

      // Sync to API in background
      if (!DEMO_MODE && userId) {
        try {
          await api.deleteBudgetTransaction(userId, transactionId);
        } catch (apiError) {
          console.warn('Failed to sync delete to API:', apiError);
        }
      }
    } catch (error: any) {
      console.error('Failed to delete transaction:', error);
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  setBudget: async (userId: string, amount: number) => {
    try {
      set({ isLoading: true, error: null });

      const currentMonth = new Date().toISOString().slice(0, 7);
      const newBudget: Budget = {
        userId,
        month: currentMonth,
        targetAmount: amount,
      };

      // Update local storage immediately
      await AsyncStorage.setItem('monthlyBudget', JSON.stringify(newBudget));
      set({ budget: newBudget, isLoading: false });
      get().computeStats();

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
      .map(([name, amount], index) => ({
        name,
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
