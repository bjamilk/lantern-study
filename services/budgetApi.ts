import { getApiBaseUrl } from '@lantern/shared';
import { getAuthHeaders } from './supabase';
import type { SavingsGoal, Transaction } from '../types';

const API_BASE = getApiBaseUrl();

async function budgetRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}/api/v1/budget${path}`, {
    ...options,
    headers: { ...headers, 'Content-Type': 'application/json', ...options.headers },
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(
      (typeof body.error === 'string' && body.error) ||
        (typeof body.message === 'string' && body.message) ||
        'Budget request failed'
    );
  }
  return body.data as T;
}

export async function fetchBudgetWalletData(): Promise<{
  walletBalance: number;
  savingsGoals: SavingsGoal[];
  expenseSplits: any[];
  categoryBudgets?: Record<string, number>;
}> {
  return budgetRequest('/wallet');
}

export async function createSavingsGoalApi(goal: {
  name: string;
  targetAmount: number;
  icon?: string;
  deadline?: string;
}): Promise<{ goal: SavingsGoal; walletBalance: number }> {
  return budgetRequest('/goals', { method: 'POST', body: JSON.stringify(goal) });
}

export async function deleteSavingsGoalApi(goalId: string): Promise<{ walletBalance: number }> {
  return budgetRequest(`/goals/${goalId}`, { method: 'DELETE' });
}

export async function contributeToSavingsGoalApi(
  goalId: string,
  amount: number
): Promise<{
  goal: SavingsGoal;
  transaction: Transaction;
  walletBalance: number;
  awarded: number;
}> {
  return budgetRequest(`/goals/${goalId}/contribute`, {
    method: 'POST',
    body: JSON.stringify({ amount }),
  });
}

export async function claimUnderBudgetAwardApi(): Promise<{
  awarded: number;
  walletBalance: number;
  alreadyAwarded?: boolean;
  reason?: string;
}> {
  return budgetRequest('/awards/under-budget', { method: 'POST', body: '{}' });
}

export async function saveBudgetTransactionApi(transaction: {
  id?: string;
  type: string;
  amount: number;
  category?: string;
  description?: string;
  date?: string;
}): Promise<{
  transaction: Transaction;
  warning: { code: string; category: string; spent: number; limit: number } | null;
}> {
  const type = transaction.type.toLowerCase();
  return budgetRequest('/transactions', {
    method: 'POST',
    body: JSON.stringify({
      id: transaction.id,
      type,
      amount: transaction.amount,
      category: transaction.category,
      description: transaction.description,
      date: transaction.date,
    }),
  });
}

export async function deleteBudgetTransactionApi(transactionId: string): Promise<void> {
  await budgetRequest(`/transactions/${transactionId}`, { method: 'DELETE' });
}

// ── Recurring transactions ──────────────────────────────────────────────────

export interface RecurringRule {
  id: string;
  userId: string;
  type: 'income' | 'expense';
  amount: number;
  category: string | null;
  description: string | null;
  frequency: 'weekly' | 'monthly';
  dayOfMonth: number | null;
  nextDate: string;
  active: boolean;
}

export async function fetchRecurringRules(): Promise<RecurringRule[]> {
  const data = await budgetRequest<{ rules: RecurringRule[] }>('/recurring');
  return data.rules;
}

export async function createRecurringRule(input: {
  type: 'income' | 'expense';
  amount: number;
  category?: string | null;
  description?: string | null;
  frequency: 'weekly' | 'monthly';
  dayOfMonth?: number | null;
  nextDate: string;
}): Promise<RecurringRule> {
  const data = await budgetRequest<{ rule: RecurringRule }>('/recurring', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.rule;
}

export async function deleteRecurringRule(id: string): Promise<void> {
  await budgetRequest(`/recurring/${id}`, { method: 'DELETE' });
}

/** Materialise any due recurring rules. Idempotent — safe to call on every load. */
export async function runRecurring(): Promise<{ posted: number }> {
  return budgetRequest('/recurring/run', { method: 'POST', body: '{}' });
}
