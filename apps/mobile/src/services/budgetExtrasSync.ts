/**
 * Sync budget sub-features (savings goals, expense splits, wallet) via user preferences.
 * Matches web `services/budgetExtrasSync.ts` — stored in user_preferences.preferences.budgetExtras.
 */
import { fetchUserPreferences } from './api';
import { API_BASE_URL, getAuthHeaders } from './supabase';
import type { ExpenseSplit, SavingsGoal } from '../stores/budgetStore';

export interface BudgetExtras {
  savingsGoals: SavingsGoal[];
  expenseSplits: ExpenseSplit[];
  walletBalance: number;
  categoryBudgets?: Record<string, number>;
}

export async function fetchBudgetExtras(userId: string): Promise<BudgetExtras | null> {
  try {
    const prefs = await fetchUserPreferences(userId);
    const extras = prefs?.preferences?.budgetExtras as Record<string, unknown> | undefined;
    if (!extras || typeof extras !== 'object') return null;
    return {
      savingsGoals: Array.isArray(extras.savingsGoals) ? (extras.savingsGoals as SavingsGoal[]) : [],
      expenseSplits: Array.isArray(extras.expenseSplits) ? (extras.expenseSplits as ExpenseSplit[]) : [],
      walletBalance: typeof extras.walletBalance === 'number' ? extras.walletBalance : 0,
      categoryBudgets:
        extras.categoryBudgets && typeof extras.categoryBudgets === 'object'
          ? (extras.categoryBudgets as Record<string, number>)
          : undefined,
    };
  } catch (error) {
    console.warn('[budgetExtrasSync] Failed to fetch budget extras:', error);
    return null;
  }
}

export async function saveBudgetExtras(userId: string, extras: BudgetExtras): Promise<void> {
  const prefs = (await fetchUserPreferences(userId)) || { theme: 'light', lowDataMode: false };
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_BASE_URL}/api/v1/preferences`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      userId,
      theme: prefs.theme || 'light',
      preferences: {
        ...(prefs.preferences || {}),
        ...(prefs.lowDataMode !== undefined ? { lowDataMode: prefs.lowDataMode } : {}),
        budgetExtras: extras,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || error.message || 'Failed to save budget extras');
  }
}
