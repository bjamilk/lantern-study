/**
 * Server-authoritative wallet balance stored in user_preferences.preferences.budgetExtras.
 */
import { SupabaseService } from './supabase';
import { CacheService } from './cache';
import { logger } from '../utils/logger';

export interface BudgetExtrasState {
  savingsGoals: any[];
  expenseSplits: any[];
  walletBalance: number;
  /** Planned expenses per category (legacy name, kept for stored data). */
  categoryBudgets?: Record<string, number>;
  /** Planned income per category — the other half of a zero-based plan. */
  plannedIncome?: Record<string, number>;
  /** Planned savings allocation for the month. */
  plannedSavings?: number;
  walletAwards?: Record<string, number>;
}

export interface WalletAdjustResult {
  walletBalance: number;
  awarded: number;
  alreadyAwarded?: boolean;
}

export class WalletInsufficientError extends Error {
  constructor(public balance: number, public required: number) {
    super(`Insufficient wallet balance (have ${balance}, need ${required})`);
    this.name = 'WalletInsufficientError';
  }
}

function parseInsufficientWalletError(err: unknown): WalletInsufficientError | null {
  if (!err || typeof err !== 'object') return null;
  const record = err as { message?: string; details?: string };
  const message = record.message || '';
  if (!message.includes('insufficient_wallet_balance')) return null;

  if (record.details) {
    try {
      const detail = JSON.parse(record.details) as { balance?: number; required?: number };
      return new WalletInsufficientError(
        Number(detail.balance) || 0,
        Number(detail.required) || 0
      );
    } catch {
      // fall through
    }
  }

  return new WalletInsufficientError(0, 0);
}

export class WalletService {
  constructor(
    private supabase: SupabaseService,
    private cache?: CacheService
  ) {}

  private get client() {
    return this.supabase.getClient();
  }

  private async loadPrefsRow(userId: string): Promise<{
    theme: string;
    preferences: Record<string, any>;
  }> {
    const row = await this.supabase.getUserPreferences(userId);
    return {
      theme: row?.theme || 'light',
      preferences: (row?.preferences && typeof row.preferences === 'object' ? row.preferences : {}) as Record<
        string,
        any
      >,
    };
  }

  private async invalidatePrefsCache(userId: string): Promise<void> {
    if (this.cache) {
      await this.cache.delete(`user:preferences:${userId}`);
    }
  }

  getExtrasFromPreferences(preferences: Record<string, any>): BudgetExtrasState {
    const extras = preferences.budgetExtras;
    if (!extras || typeof extras !== 'object') {
      return { savingsGoals: [], expenseSplits: [], walletBalance: 0, walletAwards: {} };
    }
    return {
      savingsGoals: Array.isArray(extras.savingsGoals) ? extras.savingsGoals : [],
      expenseSplits: Array.isArray(extras.expenseSplits) ? extras.expenseSplits : [],
      walletBalance: typeof extras.walletBalance === 'number' ? Math.max(0, extras.walletBalance) : 0,
      categoryBudgets:
        extras.categoryBudgets && typeof extras.categoryBudgets === 'object'
          ? extras.categoryBudgets
          : undefined,
      plannedIncome:
        extras.plannedIncome && typeof extras.plannedIncome === 'object'
          ? extras.plannedIncome
          : undefined,
      plannedSavings:
        typeof extras.plannedSavings === 'number' && Number.isFinite(extras.plannedSavings)
          ? Math.max(0, extras.plannedSavings)
          : undefined,
      walletAwards:
        extras.walletAwards && typeof extras.walletAwards === 'object' ? extras.walletAwards : {},
    };
  }

  async getBudgetExtras(userId: string): Promise<BudgetExtrasState> {
    const { preferences } = await this.loadPrefsRow(userId);
    return this.getExtrasFromPreferences(preferences);
  }

  async getWalletBalance(userId: string): Promise<number> {
    const extras = await this.getBudgetExtras(userId);
    return extras.walletBalance;
  }

  async saveBudgetExtras(userId: string, extras: BudgetExtrasState): Promise<BudgetExtrasState> {
    const { theme, preferences } = await this.loadPrefsRow(userId);
    const nextPrefs = {
      ...preferences,
      budgetExtras: {
        savingsGoals: extras.savingsGoals,
        expenseSplits: extras.expenseSplits,
        walletBalance: Math.max(0, extras.walletBalance),
        categoryBudgets: extras.categoryBudgets,
        plannedIncome: extras.plannedIncome,
        plannedSavings: extras.plannedSavings,
        walletAwards: extras.walletAwards || {},
      },
    };
    await this.supabase.upsertUserPreferences(userId, {
      theme,
      preferences: nextPrefs,
    });
    await this.invalidatePrefsCache(userId);
    return extras;
  }

  async adjustWallet(userId: string, delta: number, reason: string): Promise<WalletAdjustResult> {
    const { data, error } = await this.client.rpc('wallet_adjust_balance', {
      p_user_id: userId,
      p_delta: delta,
      p_reason: reason,
    });

    if (error) {
      const insufficient = parseInsufficientWalletError(error);
      if (insufficient) throw insufficient;
      throw error;
    }

    const payload = (data || {}) as { walletBalance?: number; awarded?: number };
    await this.invalidatePrefsCache(userId);
    const walletBalance = Number(payload.walletBalance) || 0;
    logger.info('Wallet adjusted', { userId, delta, reason, walletBalance });
    return { walletBalance, awarded: delta > 0 ? Number(payload.awarded) || delta : 0 };
  }

  async awardWalletOnce(
    userId: string,
    awardKey: string,
    amount: number,
    reason: string
  ): Promise<WalletAdjustResult> {
    const { data, error } = await this.client.rpc('wallet_award_once', {
      p_user_id: userId,
      p_award_key: awardKey,
      p_amount: amount,
      p_reason: reason,
    });

    if (error) throw error;

    const payload = (data || {}) as {
      walletBalance?: number;
      awarded?: number;
      alreadyAwarded?: boolean;
    };
    await this.invalidatePrefsCache(userId);
    const walletBalance = Number(payload.walletBalance) || 0;
    const awarded = Number(payload.awarded) || 0;
    if (awarded > 0) {
      logger.info('Wallet award', { userId, awardKey, amount, reason, walletBalance });
    }
    return {
      walletBalance,
      awarded,
      alreadyAwarded: payload.alreadyAwarded === true,
    };
  }
}

let walletService: WalletService | null = null;

export function initializeWalletService(
  supabase: SupabaseService,
  cache?: CacheService
): WalletService {
  walletService = new WalletService(supabase, cache);
  return walletService;
}

export function getWalletService(): WalletService {
  if (!walletService) {
    throw new Error('WalletService not initialized');
  }
  return walletService;
}
