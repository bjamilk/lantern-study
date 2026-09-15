import { getApiBaseUrl, createIdempotencyKey } from '@lantern/shared';
import { getAuthHeaders } from './supabase';
import { dedupe, isRateLimited, noteRateLimited, rateLimitedUntil } from './requestThrottle';
import type { SavingsGoal, Transaction } from '../types';

const API_BASE = getApiBaseUrl();

/**
 * A budget failure the caller can classify without re-parsing a sentence.
 * FIXED (SW): the plain `Error` this used to throw is why WEB-1S reads
 * "Too Many Requests" with no status attached, and why nothing upstream could
 * tell a 429 (wait) from a 400 (a bug).
 */
export class BudgetRequestError extends Error {
  readonly status: number;
  readonly retryAfterMs: number;
  constructor(message: string, status: number, retryAfterMs = 0) {
    super(message);
    this.name = 'BudgetRequestError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

async function budgetRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const key = `budget:${method}:${path}`;

  // A 429 means "stop asking", so honour it instead of re-entering the loop
  // that produced it. Reads answer from whatever the store already holds;
  // writes surface the wait to the caller.
  const cooldown = rateLimitedUntil(key);
  if (cooldown > 0) {
    throw new BudgetRequestError(
      `Budget is rate limited — retry in ${Math.ceil(cooldown / 1000)}s`,
      429,
      cooldown
    );
  }

  const send = async (): Promise<T> => {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE}/api/v1/budget${path}`, {
      ...options,
      headers: { ...headers, 'Content-Type': 'application/json', ...options.headers },
    });
    if (res.status === 429) {
      const wait = noteRateLimited(key, res.headers?.get?.('Retry-After'));
      // warn, not error: rate limiting is a server telling us to slow down,
      // and `console.error` here files a Sentry issue per attempt.
      console.warn(`[Budget] rate limited on ${path}; backing off ${Math.ceil(wait / 1000)}s`);
      throw new BudgetRequestError('Too many requests — try again in a moment.', 429, wait);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new BudgetRequestError(
        (typeof body.error === 'string' && body.error) ||
          (typeof body.message === 'string' && body.message) ||
          'Budget request failed',
        res.status
      );
    }
    return body.data as T;
  };

  // Only reads are shared: two concurrent writes are two different intents.
  return method === 'GET' ? dedupe(key, send) : send();
}

/** True while the budget wallet read is sitting out a 429. */
export function isBudgetWalletRateLimited(): boolean {
  return isRateLimited('budget:GET:/wallet');
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
    // Idempotency-Key lets the server dedupe a retried request (matches the
    // shared mobile client), so a network retry can't double-post a contribution.
    headers: { 'Idempotency-Key': createIdempotencyKey(`budget-contribute-${goalId}`) },
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
