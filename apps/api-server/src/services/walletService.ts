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
  categoryBudgets?: Record<string, number>;
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

export class WalletService {
  constructor(
    private supabase: SupabaseService,
    private cache?: CacheService
  ) {}

  private async loadPrefsRow(userId: string): Promise<{
    theme: string;
    preferences: Record<string, any>;
  }> {
    // Always read through to DB — never use preferences cache for wallet mutations.
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
    const extras = await this.getBudgetExtras(userId);
    const next = extras.walletBalance + delta;
    if (next < 0) {
      throw new WalletInsufficientError(extras.walletBalance, Math.abs(delta));
    }
    extras.walletBalance = next;
    await this.saveBudgetExtras(userId, extras);
    logger.info('Wallet adjusted', { userId, delta, reason, walletBalance: next });
    return { walletBalance: next, awarded: delta > 0 ? delta : 0 };
  }

  async awardWalletOnce(
    userId: string,
    awardKey: string,
    amount: number,
    reason: string
  ): Promise<WalletAdjustResult> {
    if (amount <= 0) {
      const balance = await this.getWalletBalance(userId);
      return { walletBalance: balance, awarded: 0 };
    }
    const extras = await this.getBudgetExtras(userId);
    const awards = extras.walletAwards || {};
    if (awards[awardKey] != null) {
      return { walletBalance: extras.walletBalance, awarded: 0, alreadyAwarded: true };
    }
    awards[awardKey] = amount;
    extras.walletAwards = awards;
    extras.walletBalance = extras.walletBalance + amount;
    await this.saveBudgetExtras(userId, extras);
    logger.info('Wallet award', { userId, awardKey, amount, reason, walletBalance: extras.walletBalance });
    return { walletBalance: extras.walletBalance, awarded: amount };
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
