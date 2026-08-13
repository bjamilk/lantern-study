/**
 * Web Budget Store — Campus Pocket
 * Manages budget, transactions, savings goals, expense splits, and wallet
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Transaction, Budget, TransactionType, SavingsGoal, ExpenseSplit } from '../types';
import type { MonthlyPlans } from '@lantern/shared/utils';

interface BudgetState {
  // State
  ownerUserId: string | null;
  transactions: Transaction[];
  budget: Budget | null;
  /** Per-month plans, keyed yyyy-mm — the source of truth for history. */
  plansByMonth: MonthlyPlans;
  savingsGoals: SavingsGoal[];
  expenseSplits: ExpenseSplit[];
  walletBalance: number; // virtual study-reward coins
  isLoading: boolean;
  error: string | null;
  
  // Actions — Transactions
  setTransactions: (transactions: Transaction[]) => void;
  addTransaction: (transaction: Transaction) => void;
  removeTransaction: (transactionId: string) => void;
  
  // Actions — Budget
  setBudget: (budget: Budget | null) => void;
  setPlansByMonth: (plans: MonthlyPlans) => void;
  
  // Actions — Savings Goals
  setSavingsGoals: (goals: SavingsGoal[]) => void;
  addSavingsGoal: (goal: SavingsGoal) => void;
  updateSavingsGoal: (id: string, updates: Partial<SavingsGoal>) => void;
  removeSavingsGoal: (id: string) => void;
  contributeTo: (goalId: string, amount: number) => void;
  
  // Actions — Expense Splits
  setExpenseSplits: (splits: ExpenseSplit[]) => void;
  addExpenseSplit: (split: ExpenseSplit) => void;
  updateExpenseSplit: (id: string, updates: Partial<ExpenseSplit>) => void;
  removeExpenseSplit: (id: string) => void;
  
  // Actions — Wallet
  setWalletBalance: (balance: number) => void;
  addWalletCoins: (amount: number) => void;
  
  // Computed
  getTotalExpenses: () => number;
  getTotalIncome: () => number;
  getBalance: () => number;
  getTransactionsByType: (type: TransactionType) => Transaction[];
  getTransactionsByCategory: (category: string) => Transaction[];
  getMonthlyTransactions: (year: number, month: number) => Transaction[];
  
  // Utility
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
  ensureOwner: (userId: string) => void;
  reset: () => void;
}

export const useBudgetStore = create<BudgetState>()(
  persist(
    (set, get) => ({
      // Initial State
      ownerUserId: null,
      transactions: [],
      budget: null,
      plansByMonth: {},
      savingsGoals: [],
      expenseSplits: [],
      walletBalance: 0,
      isLoading: false,
      error: null,
      
      // Transactions
      setTransactions: (transactions) => set({ transactions }),
      
      addTransaction: (transaction) => set((state) => ({
        transactions: [transaction, ...state.transactions],
      })),
      
      removeTransaction: (transactionId) => set((state) => ({
        transactions: state.transactions.filter(t => t.id !== transactionId),
      })),
      
      setBudget: (budget) => set({ budget }),
      setPlansByMonth: (plans) => set({ plansByMonth: plans }),
      
      // Savings Goals
      setSavingsGoals: (goals) => set({ savingsGoals: goals }),
      
      addSavingsGoal: (goal) => set((state) => ({
        savingsGoals: [...state.savingsGoals, goal],
      })),
      
      updateSavingsGoal: (id, updates) => set((state) => ({
        savingsGoals: state.savingsGoals.map(g => g.id === id ? { ...g, ...updates } : g),
      })),
      
      removeSavingsGoal: (id) => set((state) => ({
        savingsGoals: state.savingsGoals.filter(g => g.id !== id),
      })),
      
      contributeTo: (goalId, amount) => set((state) => ({
        savingsGoals: state.savingsGoals.map(g => {
          if (g.id !== goalId) return g;
          const newAmount = g.currentAmount + amount;
          return {
            ...g,
            currentAmount: newAmount,
            completedAt: newAmount >= g.targetAmount ? new Date().toISOString() : g.completedAt,
          };
        }),
      })),
      
      // Expense Splits
      setExpenseSplits: (splits) => set({ expenseSplits: splits }),
      
      addExpenseSplit: (split) => set((state) => ({
        expenseSplits: [split, ...state.expenseSplits],
      })),
      
      updateExpenseSplit: (id, updates) => set((state) => ({
        expenseSplits: state.expenseSplits.map(s => s.id === id ? { ...s, ...updates } : s),
      })),
      
      removeExpenseSplit: (id) => set((state) => ({
        expenseSplits: state.expenseSplits.filter(s => s.id !== id),
      })),
      
      // Wallet
      setWalletBalance: (balance) => set({ walletBalance: balance }),
      addWalletCoins: (amount) => set((state) => ({ walletBalance: state.walletBalance + amount })),
      
      // Computed
      getTotalExpenses: () => {
        return get().transactions
          .filter(t => t.type === TransactionType.EXPENSE)
          .reduce((sum, t) => sum + t.amount, 0);
      },
      
      getTotalIncome: () => {
        return get().transactions
          .filter(t => t.type === TransactionType.INCOME)
          .reduce((sum, t) => sum + t.amount, 0);
      },
      
      getBalance: () => {
        return get().getTotalIncome() - get().getTotalExpenses();
      },
      
      getTransactionsByType: (type) => {
        return get().transactions.filter(t => t.type === type);
      },
      
      getTransactionsByCategory: (category) => {
        return get().transactions.filter(t => t.category === category);
      },
      
      getMonthlyTransactions: (year, month) => {
        return get().transactions.filter(t => {
          const date = new Date(t.date);
          return date.getFullYear() === year && date.getMonth() === month;
        });
      },
      
      // Utility
      setLoading: (loading) => set({ isLoading: loading }),
      setError: (error) => set({ error }),
      clearError: () => set({ error: null }),

      ensureOwner: (userId) => {
        const state = get();
        if (state.ownerUserId === userId) return;
        set({
          ownerUserId: userId,
          transactions: [],
          budget: null,
          savingsGoals: [],
          expenseSplits: [],
          walletBalance: 0,
          isLoading: false,
          error: null,
        });
      },

      reset: () => set({
        ownerUserId: null,
        transactions: [],
        budget: null,
        savingsGoals: [],
        expenseSplits: [],
        walletBalance: 0,
        isLoading: false,
        error: null,
      }),
    }),
    {
      name: 'budget-storage',
      version: 3,
      // walletBalance is server-authoritative — never persist or rehydrate it.
      partialize: (state) => ({
        ownerUserId: state.ownerUserId,
        transactions: state.transactions,
        budget: state.budget,
        savingsGoals: state.savingsGoals,
        expenseSplits: state.expenseSplits,
      }),
      migrate: (persisted: unknown, version) => {
        const state = (persisted || {}) as Record<string, unknown>;
        delete state.walletBalance;
        if (version < 3 && state.ownerUserId === undefined) {
          state.ownerUserId = null;
        }
        return state as typeof persisted;
      },
      merge: (persisted, current) => {
        const p = (persisted || {}) as Partial<BudgetState>;
        return {
          ...current,
          ...p,
          // Always keep in-memory/server balance; ignore any legacy localStorage value.
          walletBalance: current.walletBalance,
        };
      },
    }
  )
);
