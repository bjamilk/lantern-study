import { SavingsGoal, ExpenseSplit } from '../types';
import { fetchUserPreferences, saveUserPreferences } from './supabase';

export interface BudgetExtras {
  savingsGoals: SavingsGoal[];
  expenseSplits: ExpenseSplit[];
  walletBalance: number;
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

export async function saveBudgetExtras(userId: string, extras: BudgetExtras): Promise<void> {
  const prefs = (await fetchUserPreferences(userId)) || { theme: 'light' as const };
  const existingExtras = prefs.preferences?.budgetExtras;
  const preservedAwards =
    extras.walletAwards ||
    (existingExtras?.walletAwards && typeof existingExtras.walletAwards === 'object'
      ? existingExtras.walletAwards
      : {});
  // Prefer server wallet balance when present (authoritative awards/debits).
  const serverBalance =
    typeof existingExtras?.walletBalance === 'number' ? existingExtras.walletBalance : null;
  await saveUserPreferences(userId, {
    theme: prefs.theme,
    lowDataMode: prefs.lowDataMode,
    preferences: {
      ...(prefs.preferences || {}),
      budgetExtras: {
        ...extras,
        walletBalance: serverBalance ?? extras.walletBalance,
        walletAwards: preservedAwards,
      },
    },
  });
}
