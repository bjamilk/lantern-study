/**
 * Dashboard aggregate route.
 *
 * GET /api/v1/dashboard/summary collapses the N parallel requests the
 * dashboards previously made (tests, question stats, profile snapshot,
 * streak, activity) into one authenticated round trip. Raw inputs are
 * returned and stat computation stays on-device because period cutoffs
 * and activity-day labels are user-timezone sensitive.
 */
import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { handleValidationErrors } from '../middleware/validation';
import { requireAuthUserId } from '../utils/requestAuth';
import { resolveAllowedActivityDate } from '../utils/activityDate';
import { SupabaseService } from '../services/supabase';
import { CacheService } from '../services/cache';
import { logger } from '../utils/logger';

const router = Router();

let supabaseService: SupabaseService;
let cacheService: CacheService;

export const initializeDashboardRoutes = (supabase: SupabaseService, cache: CacheService) => {
  supabaseService = supabase;
  cacheService = cache;
};

const TESTS_LIMIT = 50;

/** Reuses the same cache keys as the individual routes so existing write-path invalidation applies. */
async function getCompletedTests(userId: string) {
  const cacheKey = `tests:${userId}:1:${TESTS_LIMIT}:completed:`;
  const cached = await cacheService.get(cacheKey);
  if (cached) return cached as unknown[];

  const tests = await supabaseService.getUserTests(userId, {
    page: 1,
    limit: TESTS_LIMIT,
    status: 'completed',
  });
  await cacheService.set(cacheKey, tests, 300);
  return tests;
}

async function getQuestionStats(userId: string) {
  const cacheKey = `user:question-stats:${userId}`;
  const cached = await cacheService.get(cacheKey);
  if (cached) return cached;

  const stats = await supabaseService.getUserQuestionStats(userId);
  await cacheService.set(cacheKey, stats, 600);
  return stats;
}

// GET /api/v1/dashboard/summary - One-shot payload for the dashboard screens (self only)
router.get(
  '/summary',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const days = Math.min(365, Math.max(7, Number(req.query.days) || 112));
    const activityDate = resolveAllowedActivityDate(req.query.activityDate);

    const [testResults, questionStats, profile, streak, activityDays] = await Promise.allSettled([
      getCompletedTests(userId),
      getQuestionStats(userId),
      supabaseService.getUserById(userId),
      supabaseService.recomputeUserStreak(userId, activityDate),
      supabaseService.getStudyActivity(userId, days),
    ]).then(results =>
      results.map(result => {
        if (result.status === 'fulfilled') return result.value;
        logger.warn('Dashboard summary section failed', { userId, reason: `${result.reason}` });
        return null;
      })
    );

    const user = profile as {
      points?: number;
      badges?: unknown[];
      stats?: unknown;
    } | null;

    res.json({
      success: true,
      data: {
        testResults: Array.isArray(testResults) ? testResults : [],
        userQuestionStats: Array.isArray(questionStats) ? questionStats : [],
        profile: user
          ? { points: user.points ?? 0, badges: user.badges ?? [], stats: user.stats ?? {} }
          : null,
        streak: streak ?? null,
        activityDays: Array.isArray(activityDays) ? activityDays : [],
      },
    });
  })
);

export default router;
