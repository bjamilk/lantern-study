import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { handleValidationErrors, validateUserId, validatePagination } from '../middleware/validation';
import { SupabaseService } from '../services/supabase';
import { CacheService } from '../services/cache';
import { logger } from '../utils/logger';
import { requireAuthUserId } from '../utils/requestAuth';
import {
  assertLivePlatformAdmin,
  isSelfOrLivePlatformAdmin,
} from '../utils/platformAdminAuth';
import { computeActivityXp } from '@lantern/shared/utils/xp';
import { canViewStudyActivity } from '@lantern/shared/settings';
import {
  WALLET_COINS,
  studyAwardKey,
  flashcardsAwardKey,
  streak7AwardKey,
  streakMilestoneFor,
} from '@lantern/shared/utils/walletCoins';
import { getWalletService, WalletInsufficientError } from '../services/walletService';
import { normalizeIdempotencyKey, withIdempotency } from '../services/idempotency';
import { idempotencyMiddleware } from '../middleware/idempotency';
import { resolveAllowedActivityDate } from '../utils/activityDate';

const router = Router();

// Initialize services (will be injected in main server)
let supabaseService: SupabaseService;
let cacheService: CacheService;

// Initialize function to be called from main server
export const initializeGamificationRoutes = (supabase: SupabaseService, cache: CacheService) => {
  supabaseService = supabase;
  cacheService = cache;
};

// GET /api/v1/gamification/leaderboard - Get leaderboard
router.get(
  '/leaderboard',
  authMiddleware,
  validatePagination,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { page = 1, limit = 50, timeframe = 'all', metric = 'points', institutionId, ambassador } = req.query;

    logger.debug('Fetching leaderboard', { page, limit, timeframe, metric, institutionId, ambassador, userId });

    const ambassadorFlag = ambassador === '1' || ambassador === 'true';
    const institution =
      typeof institutionId === 'string' && institutionId ? institutionId : undefined;

    const cacheKey = `gamification:leaderboard:${page}:${limit}:${timeframe}:${metric}:${institution || ''}:${ambassadorFlag ? '1' : '0'}`;
    let leaderboard = await cacheService.get(cacheKey) as any[];

    if (!leaderboard) {
      leaderboard = await supabaseService.getLeaderboard({
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        timeframe: timeframe as string,
        metric: metric as string,
        institutionId: institution,
        ambassador: ambassadorFlag,
      });

      // Cache for 5 minutes
      await cacheService.set(cacheKey, leaderboard, 300);
    }

    res.json({
      success: true,
      data: leaderboard,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total: leaderboard.length,
      },
    });
  })
);

// GET /api/v1/gamification/achievements - Get available achievements
router.get(
  '/achievements',
  authMiddleware,
  validatePagination,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { page = 1, limit = 20, category } = req.query;

    logger.debug('Fetching achievements', { page, limit, category, userId });

    const cacheKey = `gamification:achievements:${page}:${limit}:${category || ''}`;
    let achievements = await cacheService.get(cacheKey) as any[];

    if (!achievements) {
      achievements = await supabaseService.getAchievements({
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        category: category as string,
      });

      // Cache for 30 minutes (achievements don't change often)
      await cacheService.set(cacheKey, achievements, 1800);
    }

    res.json({
      success: true,
      data: achievements,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total: achievements.length,
      },
    });
  })
);

// GET /api/v1/gamification/user/:userId/achievements - Get user's achievements
router.get(
  '/user/:userId/achievements',
  authMiddleware,
  validateUserId,
  validatePagination,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const requestingUserId = requireAuthUserId(req, res);
    if (!requestingUserId) return;

    const { userId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    logger.debug('Fetching user achievements', { userId, page, limit, requestingUserId });

    // Check permissions (users can view their own achievements, admins can view anyone's)
    if (!(await isSelfOrLivePlatformAdmin(req, userId))) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    const cacheKey = `gamification:user:achievements:${userId}:${page}:${limit}`;
    let achievements = await cacheService.get(cacheKey) as any[];

    if (!achievements) {
      achievements = await supabaseService.getUserAchievements(userId, {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
      });

      // Cache for 10 minutes
      await cacheService.set(cacheKey, achievements, 600);
    }

    res.json({
      success: true,
      data: achievements,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total: achievements.length,
      },
    });
  })
);

// POST /api/v1/gamification/user/:userId/points - Award points to user
router.post(
  '/user/:userId/points',
  authMiddleware,
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const requestingUserId = requireAuthUserId(req, res);
    if (!requestingUserId) return;

    const { userId } = req.params;
    const { points, reason, source } = req.body;

    logger.debug('Awarding points', { userId, points, reason, source, requestingUserId });

    if (!points || typeof points !== 'number' || points <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Valid points amount is required',
      });
    }

    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Reason is required',
      });
    }

    if (!(await assertLivePlatformAdmin(req, res))) return;

    const result = await supabaseService.awardPoints(userId, points, reason, source);

    // Invalidate caches
    await cacheService.deletePattern(`gamification:leaderboard:*`);
    await cacheService.delete(`user:stats:${userId}`);
    await cacheService.deletePattern(`gamification:user:achievements:${userId}:*`);

    res.status(201).json({
      success: true,
      data: result,
    });
  })
);

// POST /api/v1/gamification/user/:userId/achievement - Award achievement to user
router.post(
  '/user/:userId/achievement',
  authMiddleware,
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const requestingUserId = requireAuthUserId(req, res);
    if (!requestingUserId) return;

    const { userId } = req.params;
    const { achievementId } = req.body;

    logger.debug('Awarding achievement', { userId, achievementId, requestingUserId });

    if (!achievementId) {
      return res.status(400).json({
        success: false,
        error: 'Achievement ID is required',
      });
    }

    if (!(await assertLivePlatformAdmin(req, res))) return;

    const result = await supabaseService.awardAchievement(userId, achievementId);

    // Invalidate caches
    await cacheService.deletePattern(`gamification:user:achievements:${userId}:*`);

    res.status(201).json({
      success: true,
      data: result,
    });
  })
);

// GET /api/v1/gamification/user/:userId/progress - Get user's gamification progress
router.get(
  '/user/:userId/progress',
  authMiddleware,
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const requestingUserId = requireAuthUserId(req, res);
    if (!requestingUserId) return;

    const { userId } = req.params;

    logger.debug('Fetching user progress', { userId, requestingUserId });

    // Check permissions (users can view their own progress, admins can view anyone's)
    if (!(await isSelfOrLivePlatformAdmin(req, userId))) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    const cacheKey = `gamification:user:progress:${userId}`;
    let progress = await cacheService.get(cacheKey);

    if (!progress) {
      progress = await supabaseService.getUserProgress(userId);

      // Cache for 5 minutes
      await cacheService.set(cacheKey, progress, 300);
    }

    res.json({
      success: true,
      data: progress,
    });
  })
);

// GET /api/v1/gamification/stats - Get gamification statistics
router.get(
  '/stats',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    logger.debug('Fetching gamification stats', { userId });

    const cacheKey = 'gamification:stats';
    let stats = await cacheService.get(cacheKey);

    if (!stats) {
      stats = await supabaseService.getGamificationStats();

      // Cache for 10 minutes
      await cacheService.set(cacheKey, stats, 600);
    }

    res.json({
      success: true,
      data: stats,
    });
  })
);

// GET /api/v1/gamification/badges - Get available badges
router.get(
  '/badges',
  authMiddleware,
  validatePagination,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { page = 1, limit = 20, category } = req.query;

    logger.debug('Fetching badges', { page, limit, category, userId });

    const cacheKey = `gamification:badges:${page}:${limit}:${category || ''}`;
    let badges = await cacheService.get(cacheKey) as any[];

    if (!badges) {
      badges = await supabaseService.getBadges({
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        category: category as string,
      });

      // Cache for 30 minutes
      await cacheService.set(cacheKey, badges, 1800);
    }

    res.json({
      success: true,
      data: badges,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total: badges.length,
      },
    });
  })
);

// GET /api/v1/gamification/user/:userId/badges - Get user's badges
router.get(
  '/user/:userId/badges',
  authMiddleware,
  validateUserId,
  validatePagination,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const requestingUserId = requireAuthUserId(req, res);
    if (!requestingUserId) return;

    const { userId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    logger.debug('Fetching user badges', { userId, page, limit, requestingUserId });

    // Check permissions (users can view their own badges, admins can view anyone's)
    if (!(await isSelfOrLivePlatformAdmin(req, userId))) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    const cacheKey = `gamification:user:badges:${userId}:${page}:${limit}`;
    let badges = await cacheService.get(cacheKey) as any[];

    if (!badges) {
      badges = await supabaseService.getUserBadges(userId, {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
      });

      // Cache for 10 minutes
      await cacheService.set(cacheKey, badges, 600);
    }

    res.json({
      success: true,
      data: badges,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total: badges.length,
      },
    });
  })
);

// POST /api/v1/gamification/user/:userId/badge - Award badge to user
router.post(
  '/user/:userId/badge',
  authMiddleware,
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const requestingUserId = requireAuthUserId(req, res);
    if (!requestingUserId) return;

    const { userId } = req.params;
    const { badgeId } = req.body;

    logger.debug('Awarding badge', { userId, badgeId, requestingUserId });

    if (!badgeId) {
      return res.status(400).json({
        success: false,
        error: 'Badge ID is required',
      });
    }

    if (!(await assertLivePlatformAdmin(req, res))) return;

    const result = await supabaseService.awardBadge(userId, badgeId);

    // Invalidate caches
    await cacheService.deletePattern(`gamification:user:badges:${userId}:*`);

    res.status(201).json({
      success: true,
      data: result,
    });
  })
);

// GET /api/v1/gamification/levels - Get level system
router.get(
  '/levels',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    logger.debug('Fetching levels', { userId });

    const cacheKey = 'gamification:levels';
    let levels = await cacheService.get(cacheKey);

    if (!levels) {
      levels = await supabaseService.getLevels();

      // Cache for 60 minutes (levels don't change often)
      await cacheService.set(cacheKey, levels, 3600);
    }

    res.json({
      success: true,
      data: levels,
    });
  })
);

// GET /api/v1/gamification/user/:userId/level - Get user's current level
router.get(
  '/user/:userId/level',
  authMiddleware,
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const requestingUserId = requireAuthUserId(req, res);
    if (!requestingUserId) return;

    const { userId } = req.params;

    logger.debug('Fetching user level', { userId, requestingUserId });

    // Check permissions (users can view their own level, admins can view anyone's)
    if (!(await isSelfOrLivePlatformAdmin(req, userId))) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    const cacheKey = `gamification:user:level:${userId}`;
    let level = await cacheService.get(cacheKey);

    if (!level) {
      level = await supabaseService.getUserLevel(userId);

      // Cache for 5 minutes
      await cacheService.set(cacheKey, level, 300);
    }

    res.json({
      success: true,
      data: level,
    });
  })
);

const VALID_ACTIVITY_TYPES = new Set(['test', 'flashcard', 'flashcard_new', 'study_question', 'game', 'daily_quiz']);

/** study_activity column holding the day's running count for each type. */
const ACTIVITY_TYPE_COUNT_FIELD: Record<string, string> = {
  test: 'test_count',
  flashcard: 'flashcard_count',
  flashcard_new: 'flashcard_count',
  study_question: 'question_count',
  game: 'game_count',
  daily_quiz: 'daily_quiz_count',
};

const DAILY_QUEST_TEMPLATES = [
  { quest_type: 'review_cards', target_count: 10, reward_xp: 15 },
  { quest_type: 'answer_questions', target_count: 3, reward_xp: 20 },
  { quest_type: 'create_note', target_count: 1, reward_xp: 10 },
  { quest_type: 'complete_test', target_count: 1, reward_xp: 25 },
];

function resolveQuestDate(input?: unknown): string {
  return resolveAllowedActivityDate(input);
}

async function ensureDailyQuests(userId: string, questDate: string) {
  const client = supabaseService.getClient();
  const { error: insertError } = await client
    .from('daily_quests')
    .upsert(
      DAILY_QUEST_TEMPLATES.map((t) => ({ ...t, user_id: userId, quest_date: questDate })),
      { onConflict: 'user_id,quest_date,quest_type', ignoreDuplicates: true }
    );

  if (insertError && insertError.code !== '23505') throw insertError;

  const { data, error } = await client
    .from('daily_quests')
    .select('*')
    .eq('user_id', userId)
    .eq('quest_date', questDate);

  if (error) throw error;
  return data ?? [];
}

// POST /api/v1/gamification/streak/record - Reconcile study streak from activity heatmap
router.post(
  '/streak/record',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { activityDate } = req.body ?? {};
    const referenceDate = resolveAllowedActivityDate(activityDate);

    const data = await supabaseService.recomputeUserStreak(userId, referenceDate);
    let awarded = 0;
    let walletBalance = await getWalletService().getWalletBalance(userId);
    const milestone = streakMilestoneFor(data.current_streak);
    if (milestone) {
      const dateKey = data.last_login_date || referenceDate || new Date().toISOString().slice(0, 10);
      const award = await getWalletService().awardWalletOnce(
        userId,
        streak7AwardKey(dateKey, milestone),
        WALLET_COINS.STREAK_7,
        'streak_milestone'
      );
      awarded = award.awarded;
      walletBalance = award.walletBalance;
      await cacheService.delete(`user:preferences:${userId}`);
    }
    res.json({ success: true, data: { ...data, walletBalance, awarded } });
  })
);

// POST /api/v1/gamification/me/sync-progress - Re-evaluate badges from server-side stats only
router.post(
  '/me/sync-progress',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    try {
      const data = await supabaseService.syncGamificationProgress(userId);
      await cacheService.delete(`user:${userId}`);
      res.json({ success: true, data });
    } catch (err: any) {
      // Both clients call this on every dashboard load and neither surfaces a
      // failure, so a broken sync shows up only as badge progress that quietly
      // stops moving. Log the real cause before the global handler replaces it
      // with "Something went wrong"; the response stays on the standard shape.
      logger.error('Gamification sync failed', {
        userId,
        message: err?.message,
        code: err?.code,
        details: err?.details,
      });
      throw err;
    }
  })
);

// POST /api/v1/gamification/activity/record - Record study activity for today
router.post(
  '/activity/record',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { type, amount = 1, activityDate, scorePercent } = req.body ?? {};
    if (!type || !VALID_ACTIVITY_TYPES.has(type)) {
      return res.status(400).json({ success: false, error: 'Invalid activity type' });
    }

    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount < 1 || parsedAmount > 500) {
      return res.status(400).json({ success: false, error: 'Invalid activity amount' });
    }

    const parsedScore =
      scorePercent === undefined || scorePercent === null ? undefined : Number(scorePercent);
    if (parsedScore !== undefined && (!Number.isFinite(parsedScore) || parsedScore < 0 || parsedScore > 100)) {
      return res.status(400).json({ success: false, error: 'Invalid scorePercent' });
    }

    const date = resolveAllowedActivityDate(activityDate);

    const data = await supabaseService.recordStudyActivity(
      userId,
      type,
      Math.floor(parsedAmount),
      date
    );
    const streak = await supabaseService.recomputeUserStreak(userId, date);

    // Volume XP with diminishing returns and quality weighting. The activity
    // row returns post-increment counts, so prior = updated − this recording.
    let xpAwarded = 0;
    try {
      const countField = ACTIVITY_TYPE_COUNT_FIELD[type];
      const updatedCount = Number(data?.[countField] ?? 0);
      const priorAmountToday = Math.max(0, updatedCount - Math.floor(parsedAmount));
      xpAwarded = computeActivityXp({
        type,
        amount: Math.floor(parsedAmount),
        priorAmountToday,
        scorePercent: parsedScore,
      });
      if (xpAwarded > 0) {
        await supabaseService.awardPoints(userId, xpAwarded, `Study activity: ${type}`, 'study_activity');
        await cacheService.delete(`user:stats:${userId}`);
      }
    } catch (xpError) {
      // XP is a bonus — never fail the activity recording over it.
      logger.warn('Volume XP award failed', {
        userId,
        type,
        message: xpError instanceof Error ? xpError.message : String(xpError),
      });
    }

    let awarded = 0;
    let walletBalance = 0;
    const wallet = getWalletService();
    if (Math.floor(parsedAmount) > 0) {
      const studyAward = await wallet.awardWalletOnce(
        userId,
        studyAwardKey(date),
        WALLET_COINS.STUDY_DAY,
        'study_day'
      );
      awarded += studyAward.awarded;
      walletBalance = studyAward.walletBalance;

      const flashCount = Number(data?.flashcard_count ?? 0);
      if (flashCount >= 20) {
        const fcAward = await wallet.awardWalletOnce(
          userId,
          flashcardsAwardKey(date),
          WALLET_COINS.FLASHCARDS_20,
          'flashcards_20'
        );
        awarded += fcAward.awarded;
        walletBalance = fcAward.walletBalance;
      }
    } else {
      walletBalance = await wallet.getWalletBalance(userId);
    }

    const milestone = streakMilestoneFor(streak.current_streak);
    if (milestone) {
      const sAward = await wallet.awardWalletOnce(
        userId,
        streak7AwardKey(date, milestone),
        WALLET_COINS.STREAK_7,
        'streak_milestone'
      );
      awarded += sAward.awarded;
      walletBalance = sAward.walletBalance;
    }

    if (awarded > 0) {
      await cacheService.delete(`user:preferences:${userId}`);
    }

    res.json({
      success: true,
      data: {
        ...data,
        walletBalance,
        awarded,
        xpAwarded,
        current_streak: streak.current_streak,
        longest_streak: streak.longest_streak,
      },
    });
  })
);

// GET /api/v1/gamification/activity - Fetch recent daily study activity
router.get(
  '/activity',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const viewerId = requireAuthUserId(req, res);
    if (!viewerId) return;

    const days = Math.min(365, Math.max(7, Number(req.query.days) || 112));
    const targetUserId =
      typeof req.query.userId === 'string' && req.query.userId.trim()
        ? req.query.userId.trim()
        : viewerId;

    if (targetUserId !== viewerId) {
      const targetUser = await supabaseService.getUserById(targetUserId);
      if (!targetUser) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }
      if (!canViewStudyActivity(targetUser.settings)) {
        return res.json({ success: true, data: [] });
      }
    }

    const data = await supabaseService.getStudyActivity(targetUserId, days);
    res.json({ success: true, data });
  })
);

// GET /api/v1/gamification/streak - Get user study streak (recomputed from activity)
router.get(
  '/streak',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const activityDate = resolveAllowedActivityDate(req.query.activityDate);

    const data = await supabaseService.recomputeUserStreak(userId, activityDate);
    res.json({ success: true, data });
  })
);

// POST /api/v1/gamification/streak/freeze - Use a streak freeze
router.post(
  '/streak/freeze',
  authMiddleware,
  idempotencyMiddleware({ operation: 'streak_freeze_use' }),
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { data: streak } = await supabaseService.getClient()
      .from('user_streaks')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (!streak || (streak.streak_freezes ?? 0) <= 0) {
      return res.status(400).json({ success: false, error: 'No streak freezes available' });
    }

    const today = new Date().toISOString().split('T')[0];
    const data = await req.runIdempotent!(async () => {
      const { data: updated, error } = await supabaseService.getClient()
        .from('user_streaks')
        .update({
          streak_freezes: streak.streak_freezes - 1,
          last_login_date: today,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;
      return { streak: updated as Record<string, unknown> };
    });

    res.json({ success: true, data: data.streak });
  })
);

// POST /api/v1/gamification/streak/freeze/purchase - Buy a streak freeze with wallet coins (50)
router.post(
  '/streak/freeze/purchase',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const STREAK_FREEZE_COST = WALLET_COINS.STREAK_FREEZE_COST;
    const wallet = getWalletService();
    const idempotencyKey =
      normalizeIdempotencyKey(req.headers['idempotency-key']) ||
      `${userId}:streak_freeze_purchase:${Math.floor(Date.now() / 300_000)}`;

    const payload = await withIdempotency(
      supabaseService.getClient(),
      userId,
      'streak_freeze_purchase',
      idempotencyKey,
      async () => {
        let debitResult;
        try {
          debitResult = await wallet.adjustWallet(userId, -STREAK_FREEZE_COST, 'streak_freeze');
        } catch (err) {
          if (err instanceof WalletInsufficientError) {
            return {
              error: true as const,
              status: 400,
              body: {
                success: false,
                error: `You need ${STREAK_FREEZE_COST} wallet coins to buy a streak freeze.`,
                walletBalance: err.balance,
              },
            };
          }
          throw err;
        }

        const { data: streak, error: fetchErr } = await supabaseService.getClient()
          .from('user_streaks')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle();

        if (fetchErr) {
          await wallet.adjustWallet(userId, STREAK_FREEZE_COST, 'streak_freeze_refund');
          throw fetchErr;
        }

        const { data, error } = await supabaseService.getClient()
          .from('user_streaks')
          .upsert({
            user_id: userId,
            current_streak: streak?.current_streak ?? 0,
            longest_streak: streak?.longest_streak ?? 0,
            last_login_date: streak?.last_login_date ?? null,
            streak_freezes: (streak?.streak_freezes ?? 0) + 1,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id' })
          .select()
          .single();

        if (error) {
          await wallet.adjustWallet(userId, STREAK_FREEZE_COST, 'streak_freeze_refund');
          throw error;
        }

        await cacheService.delete(`user:preferences:${userId}`);
        return {
          error: false as const,
          body: {
            success: true,
            data: {
              ...data,
              cost: STREAK_FREEZE_COST,
              walletBalance: debitResult.walletBalance,
            },
          },
        };
      }
    );

    if (payload.error) {
      return res.status(payload.status).json(payload.body);
    }

    res.json(payload.body);
  })
);

// GET /api/v1/gamification/quests/daily - Get today's quests
router.get(
  '/quests/daily',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const questDate = resolveQuestDate(req.query.activityDate);
    const quests = await ensureDailyQuests(userId, questDate);
    res.json({ success: true, data: quests });
  })
);

// POST /api/v1/gamification/quests/progress - Increment quest progress
router.post(
  '/quests/progress',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { questType, increment = 1, activityDate } = req.body ?? {};
    if (!questType || typeof questType !== 'string') {
      return res.status(400).json({ success: false, error: 'questType is required' });
    }

    const questDate = resolveQuestDate(activityDate);
    await ensureDailyQuests(userId, questDate);

    const { data: quest } = await supabaseService.getClient()
      .from('daily_quests')
      .select('*')
      .eq('user_id', userId)
      .eq('quest_date', questDate)
      .eq('quest_type', questType)
      .maybeSingle();

    if (!quest) {
      return res.json({ success: true, data: null, skipped: true });
    }

    const newProgress = Math.min(quest.target_count, (quest.progress_count ?? 0) + increment);
    const completed = newProgress >= quest.target_count;
    const wasCompleted = !!quest.completed;

    const { data, error } = await supabaseService.getClient()
      .from('daily_quests')
      .update({ progress_count: newProgress, completed })
      .eq('id', quest.id)
      .select()
      .single();

    if (error) throw error;

    if (completed && !wasCompleted) {
      const rewardXp = Number(quest.reward_xp ?? 0);
      if (rewardXp > 0) {
        await supabaseService.awardPoints(userId, rewardXp, 'Daily quest completed', 'daily_quest');
        await cacheService.delete(`user:${userId}`);
      }
    }

    res.json({ success: true, data });
  })
);

export default router;