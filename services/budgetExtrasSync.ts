import { SavingsGoal, ExpenseSplit } from '../types';
import { fetchUserPreferences, saveUserPreferences } from './supabase';

export interface BudgetExtras {
  savingsGoals: SavingsGoal[];
  expenseSplits: ExpenseSplit[];
  /** Display-only on client; server preferences POST preserves authoritative balance. */
  walletBalance?: number;
  categoryBudgets?: Record<string, number>;
  walletAwards?: Record<string, number>;
}

export async function fetchBudgetExtras(userId: string): Promise<BudgetExtras | null> {
  const prefs = await fetchUserPreferences(userId);
  const extras = prefs?.preferences?.budgetExtras;
  if (!extras || typeof extras !== 'object') return null;
  return {
    savingsGoals: Array.isArray(extras.savingsGoals) ? extras.savingsGoals : [],
    expenseSplits: Array.isArray(extras.expenseSplits) ? extras.expenseSplits : [],
    walletBalance: typeof extras.walletBalance === 'number' ? extras.walletBalance : 0,
    categoryBudgets:
      extras.categoryBudgets && typeof extras.categoryBudgets === 'object'
        ? extras.categoryBudgets
        : undefined,
    walletAwards:
      extras.walletAwards && typeof extras.walletAwards === 'object' ? extras.walletAwards : undefined,
  };
}

/**
 * Persist goals / splits / category budgets only.
 * Wallet balance and awards are never sent — the API preserves them server-side.
 */
export async function saveBudgetExtras(userId: string, extras: BudgetExtras): Promise<void> {
  const prefs = (await fetchUserPreferences(userId)) || { theme: 'light' as const };
  const existingExtras = prefs.preferences?.budgetExtras;
  await saveUserPreferences(userId, {
    theme: prefs.theme,
    lowDataMode: prefs.lowDataMode,
    preferences: {
      ...(prefs.preferences || {}),
      budgetExtras: {
        savingsGoals: extras.savingsGoals,
        expenseSplits: extras.expenseSplits,
        categoryBudgets: extras.categoryBudgets,
        // Pass through existing server values so merge has a fallback if needed
        walletBalance:
          typeof existingExtras?.walletBalance === 'number' ? existingExtras.walletBalance : 0,
        walletAwards:
          existingExtras?.walletAwards && typeof existingExtras.walletAwards === 'object'
            ? existingExtras.walletAwards
            : {},
      },
    },
  });
}
