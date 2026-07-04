/**
 * Budget goals, wallet, and awards — server-authoritative.
 */
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { requireAuthUserId } from '../utils/requestAuth';
import { SupabaseService } from '../services/supabase';
import { CacheService } from '../services/cache';
import { getWalletService, WalletInsufficientError } from '../services/walletService';
import {
  WALLET_COINS,
  goalAwardKey,
  underBudgetAwardKey,
} from '@lantern/shared/utils/walletCoins';
import { logger } from '../utils/logger';

const router = Router();

let supabaseService: SupabaseService;
let cacheService: CacheService;

export function initializeBudgetRoutes(supabase: SupabaseService, cache: CacheService): void {
  supabaseService = supabase;
  cacheService = cache;
}

async function invalidatePrefsCache(userId: string): Promise<void> {
  await cacheService.delete(`user:preferences:${userId}`);
}

// GET /api/v1/budget/wallet
router.get(
  '/wallet',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const wallet = getWalletService();
    const extras = await wallet.getBudgetExtras(userId);
    res.json({
      success: true,
      data: {
        walletBalance: extras.walletBalance,
        savingsGoals: extras.savingsGoals,
        expenseSplits: extras.expenseSplits,
        categoryBudgets: extras.categoryBudgets,
      },
    });
  })
);

// POST /api/v1/budget/goals
router.post(
  '/goals',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { name, targetAmount, icon, deadline } = req.body ?? {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Goal name is required' });
    }
    const target = Number(targetAmount);
    if (!Number.isFinite(target) || target <= 0) {
      return res.status(400).json({ success: false, error: 'targetAmount must be a positive number' });
    }

    const wallet = getWalletService();
    const extras = await wallet.getBudgetExtras(userId);
    const goal = {
      id: randomUUID(),
      userId,
      name: name.trim(),
      targetAmount: target,
      currentAmount: 0,
      icon: typeof icon === 'string' && icon ? icon : '🎯',
      deadline: typeof deadline === 'string' && deadline ? deadline : undefined,
      createdAt: new Date().toISOString(),
    };
    extras.savingsGoals = [...extras.savingsGoals, goal];
    await wallet.saveBudgetExtras(userId, extras);
    await invalidatePrefsCache(userId);

    res.status(201).json({ success: true, data: { goal, walletBalance: extras.walletBalance } });
  })
);

// DELETE /api/v1/budget/goals/:goalId
router.delete(
  '/goals/:goalId',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const { goalId } = req.params;

    const wallet = getWalletService();
    const extras = await wallet.getBudgetExtras(userId);
    const before = extras.savingsGoals.length;
    extras.savingsGoals = extras.savingsGoals.filter((g: any) => g.id !== goalId);
    if (extras.savingsGoals.length === before) {
      return res.status(404).json({ success: false, error: 'Goal not found' });
    }
    await wallet.saveBudgetExtras(userId, extras);
    await invalidatePrefsCache(userId);
    res.json({ success: true, data: { walletBalance: extras.walletBalance } });
  })
);

// POST /api/v1/budget/goals/:goalId/contribute
router.post(
  '/goals/:goalId/contribute',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const { goalId } = req.params;
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, error: 'amount must be a positive number' });
    }

    const wallet = getWalletService();
    const extras = await wallet.getBudgetExtras(userId);
    const goalIndex = extras.savingsGoals.findIndex((g: any) => g.id === goalId);
    if (goalIndex < 0) {
      return res.status(404).json({ success: false, error: 'Goal not found' });
    }

    const goal = { ...extras.savingsGoals[goalIndex] };
    const wasComplete = !!goal.completedAt || goal.currentAmount >= goal.targetAmount;
    const newAmount = Math.min(goal.currentAmount + amount, goal.targetAmount);
    goal.currentAmount = newAmount;
    const nowComplete = newAmount >= goal.targetAmount;
    if (nowComplete && !goal.completedAt) {
      goal.completedAt = new Date().toISOString();
    }
    extras.savingsGoals[goalIndex] = goal;
    await wallet.saveBudgetExtras(userId, extras);

    const txId = randomUUID();
    const date = new Date().toISOString().split('T')[0];
    const { error: txError } = await supabaseService.getClient()
      .from('budget_transactions')
      .insert({
        id: txId,
        user_id: userId,
        type: 'investment',
        amount,
        category: 'savings',
        description: `Savings: ${goal.name}`,
        date,
      });

    if (txError) {
      logger.error('Failed to insert savings contribution transaction', { userId, goalId, txError });
      return res.status(500).json({ success: false, error: 'Failed to record contribution transaction' });
    }

    let walletBalance = extras.walletBalance;
    let awarded = 0;
    if (nowComplete && !wasComplete) {
      const award = await wallet.awardWalletOnce(
        userId,
        goalAwardKey(goalId),
        WALLET_COINS.GOAL_COMPLETE,
        'savings_goal_complete'
      );
      walletBalance = award.walletBalance;
      awarded = award.awarded;
    }

    await invalidatePrefsCache(userId);

    res.json({
      success: true,
      data: {
        goal,
        transaction: {
          id: txId,
          userId,
          type: 'INVESTMENT',
          amount,
          category: 'savings',
          description: `Savings: ${goal.name}`,
          date,
        },
        walletBalance,
        awarded,
      },
    });
  })
);

// POST /api/v1/budget/awards/under-budget — claim previous month under-budget award
router.post(
  '/awards/under-budget',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const now = new Date();
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const monthYear = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;

    const { data: budgetRow } = await supabaseService.getClient()
      .from('user_budgets')
      .select('monthly_limit')
      .eq('user_id', userId)
      .eq('month_year', monthYear)
      .maybeSingle();

    const monthlyLimit = Number(budgetRow?.monthly_limit) || 0;
    if (monthlyLimit <= 0) {
      return res.json({
        success: true,
        data: { awarded: 0, walletBalance: await getWalletService().getWalletBalance(userId), reason: 'no_budget' },
      });
    }

    const monthStart = `${monthYear}-01`;
    const nextMonth = new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth() + 1, 1));
    const monthEnd = nextMonth.toISOString().slice(0, 10);

    const { data: txs } = await supabaseService.getClient()
      .from('budget_transactions')
      .select('amount, type, date')
      .eq('user_id', userId)
      .gte('date', monthStart)
      .lt('date', monthEnd);

    const expenses = (txs || [])
      .filter((t: any) => t.type === 'expense')
      .reduce((sum: number, t: any) => sum + Number(t.amount || 0), 0);

    if (expenses >= monthlyLimit) {
      return res.json({
        success: true,
        data: {
          awarded: 0,
          walletBalance: await getWalletService().getWalletBalance(userId),
          reason: 'over_budget',
          expenses,
          monthlyLimit,
        },
      });
    }

    const award = await getWalletService().awardWalletOnce(
      userId,
      underBudgetAwardKey(monthYear),
      WALLET_COINS.UNDER_BUDGET,
      `under_budget_${monthYear}`
    );
    await invalidatePrefsCache(userId);

    res.json({
      success: true,
      data: {
        awarded: award.awarded,
        walletBalance: award.walletBalance,
        alreadyAwarded: award.alreadyAwarded,
        monthYear,
        expenses,
        monthlyLimit,
      },
    });
  })
);

// POST /api/v1/budget/transactions — create expense/income with optional category overspend warning
router.post(
  '/transactions',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { id, type, amount, category, description, date } = req.body ?? {};
    const amt = Number(amount);
    if (!type || !['income', 'expense', 'investment'].includes(type)) {
      return res.status(400).json({ success: false, error: 'Invalid type' });
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ success: false, error: 'amount must be positive' });
    }

    let txId: string = randomUUID();
    if (typeof id === 'string' && id.trim()) {
      const trimmedId = id.trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmedId)) {
        return res.status(400).json({ success: false, error: 'Invalid transaction id' });
      }

      const { data: existing, error: existingError } = await supabaseService.getClient()
        .from('budget_transactions')
        .select('user_id')
        .eq('id', trimmedId)
        .maybeSingle();

      if (existingError) throw existingError;
      if (existing && existing.user_id !== userId) {
        return res.status(403).json({ success: false, error: 'Access denied' });
      }
      txId = trimmedId;
    }
    const txDate = typeof date === 'string' && date ? date.split('T')[0] : new Date().toISOString().split('T')[0];
    const cat = typeof category === 'string' ? category : 'other';

    const { error } = await supabaseService.getClient()
      .from('budget_transactions')
      .upsert(
        {
          id: txId,
          user_id: userId,
          type,
          amount: amt,
          category: cat,
          description: typeof description === 'string' ? description : '',
          date: txDate,
        },
        { onConflict: 'id' }
      );

    if (error) throw error;

    let categoryOverspend = false;
    let categorySpent = 0;
    let categoryLimit = 0;
    if (type === 'expense') {
      const extras = await getWalletService().getBudgetExtras(userId);
      categoryLimit = Number(extras.categoryBudgets?.[cat]) || 0;
      if (categoryLimit > 0) {
        const monthYear = txDate.slice(0, 7);
        const { data: monthTxs } = await supabaseService.getClient()
          .from('budget_transactions')
          .select('amount')
          .eq('user_id', userId)
          .eq('type', 'expense')
          .eq('category', cat)
          .gte('date', `${monthYear}-01`)
          .lt('date', `${monthYear}-32`);
        categorySpent = (monthTxs || []).reduce((s: number, t: any) => s + Number(t.amount || 0), 0);
        categoryOverspend = categorySpent > categoryLimit;
      }
    }

    res.status(201).json({
      success: true,
      data: {
        transaction: {
          id: txId,
          userId,
          type: type.toUpperCase(),
          amount: amt,
          category: cat,
          description: description || '',
          date: txDate,
        },
        warning: categoryOverspend
          ? {
              code: 'category_overspend',
              category: cat,
              spent: categorySpent,
              limit: categoryLimit,
            }
          : null,
      },
    });
  })
);

// DELETE /api/v1/budget/transactions/:transactionId
router.delete(
  '/transactions/:transactionId',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const { transactionId } = req.params;

    const { data, error } = await supabaseService.getClient()
      .from('budget_transactions')
      .delete()
      .eq('id', transactionId)
      .eq('user_id', userId)
      .select('id')
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, error: 'Transaction not found' });
    }
    res.json({ success: true });
  })
);

export default router;
