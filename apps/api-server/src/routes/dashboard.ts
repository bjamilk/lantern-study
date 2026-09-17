/**
 * Dashboard aggregate route.
 *
 * GET /api/v1/dashboard/summary collapses the N parallel requests the
 * dashboards previously made (tests, question stats, profile snapshot,
 * streak, activity) into one authenticated round trip. Raw inputs are
 * returned and stat computation stays on-device because period cutoffs
 * and activity-day labels are user-timezone sensitive.
 *
 * testResults are lean (no questions/userAnswers) so we can return a
 * larger history window for charts without huge payloads. Topic insights
 * that need per-question detail continue to use userQuestionStats.
 */
import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { requireAuthUserId } from '../utils/requestAuth';
import { resolveAllowedActivityDate } from '../utils/activityDate';
import type { DataLayer } from '../services/data';
import { CacheService } from '../services/cache';
import { logger } from '../utils/logger';

const router = Router();

let dataLayer: DataLayer;
let cacheService: CacheService;

export const initializeDashboardRoutes = (layer: DataLayer, cache: CacheService) => {
  dataLayer = layer;
  cacheService = cache;
};

/** Lean page size for completed-history charts / group performance. */
const TESTS_PAGE_SIZE = 500;
/** Safety cap so a pathological account cannot unboundedly fan out DB pages. */
const TESTS_MAX_PAGES = 100;

/**
 * Load the full lean completed-test history (paginated).
 * Reuses per-page `tests:${userId}:...` cache entries from getUserTests via deletePattern invalidation.
 */
async function getCompletedTests(userId: string) {
  const cacheKey = `tests:${userId}:all:${TESTS_PAGE_SIZE}:completed::lean:newest::`;
  const cached = await cacheService.get(cacheKey);
  if (cached) {
    if (Array.isArray(cached)) return cached;
    if (cached && typeof cached === 'object' && Array.isArray((cached as { tests?: unknown }).tests)) {
      return (cached as { tests: unknown[] }).tests;
    }
  }

  const all: unknown[] = [];
  let page = 1;
  let hasMore = true;
  while (hasMore && page <= TESTS_MAX_PAGES) {
    const result = await dataLayer.tests.getUserTests(userId, {
      page,
      limit: TESTS_PAGE_SIZE,
      status: 'completed',
      lean: true,
      sort: 'newest',
    });
    const tests = Array.isArray(result?.tests) ? result.tests : [];
    all.push(...tests);
    const total = typeof result?.total === 'number' ? result.total : all.length;
    hasMore = page * TESTS_PAGE_SIZE < total && tests.length > 0;
    page += 1;
  }

  if (hasMore) {
    logger.warn('Dashboard completed-test history hit page cap', {
      userId,
      loaded: all.length,
      maxPages: TESTS_MAX_PAGES,
      pageSize: TESTS_PAGE_SIZE,
    });
  }

  await cacheService.set(cacheKey, all, 300);
  return all;
}

async function getQuestionStats(userId: string) {
  const cacheKey = `user:question-stats:${userId}`;
  const cached = await cacheService.get(cacheKey);
  // Distinguish cache miss (null) from a cached empty list ([]).
  if (cached !== null && cached !== undefined) return cached;

  const stats = await dataLayer.offlineBundles.getUserQuestionStats(userId);
  const rows = Array.isArray(stats) ? stats : [];
  await cacheService.set(cacheKey, rows, 600);
  return rows;
}

// GET /api/v1/dashboard/summary - One-shot payload for the dashboard screens (self only)
router.get(
  '/summary',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const days = Math.min(365, Math.max(7, Number(req.query.days) || 112));
    const activityDate = resolveAllowedActivityDate(req.query.activityDate);

    const settled = await Promise.allSettled([
      getCompletedTests(userId),
      getQuestionStats(userId),
      dataLayer.users.getUserById(userId),
      dataLayer.gamification.recomputeUserStreak(userId, activityDate),
      dataLayer.gamification.getStudyActivity(userId, days),
    ]);

    const unwrap = <T,>(result: PromiseSettledResult<T>, section: string): T | null => {
      if (result.status === 'fulfilled') return result.value;
      logger.warn('Dashboard summary section failed', { userId, section, reason: `${result.reason}` });
      return null;
    };

    const testResults = unwrap(settled[0], 'testResults');
    let questionStats = unwrap(settled[1], 'userQuestionStats');
    const profile = unwrap(settled[2], 'profile');
    const streak = unwrap(settled[3], 'streak');
    const activityDays = unwrap(settled[4], 'activityDays');

    // Question stats power "Questions to review". Retry once on failure so a
    // transient error is not silently turned into an empty list for clients.
    let questionStatsFailed = questionStats === null;
    if (questionStatsFailed) {
      try {
        questionStats = await getQuestionStats(userId);
        questionStatsFailed = false;
      } catch (retryErr) {
        logger.warn('Dashboard question-stats retry failed', {
          userId,
          reason: `${retryErr}`,
        });
      }
    }

    const user = profile as {
      points?: number;
      badges?: unknown[];
      stats?: unknown;
    } | null;

    res.json({
      success: true,
      data: {
        testResults: Array.isArray(testResults) ? testResults : [],
        // null => section failed (clients must fall back). [] => loaded, truly empty.
        userQuestionStats: questionStatsFailed
          ? null
          : Array.isArray(questionStats)
            ? questionStats
            : [],
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
