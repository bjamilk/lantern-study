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
