import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { handleValidationErrors, validateUserId } from '../middleware/validation';
import { SupabaseService } from '../services/supabase';
import { CacheService } from '../services/cache';
import { logger } from '../utils/logger';

const router = Router();

// Initialize services (will be injected in main server)
let supabaseService: SupabaseService;
let cacheService: CacheService;

// Initialize function to be called from main server
export const initializeUserStatsRoutes = (supabase: SupabaseService, cache: CacheService) => {
  supabaseService = supabase;
  cacheService = cache;
};

// GET /api/v1/user-stats/:userId - Get user question stats
router.get(
  '/:userId',
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { userId } = req.params;

    logger.debug('Fetching user question stats', { userId });

    const cacheKey = `user:question-stats:${userId}`;
    let stats = await cacheService.get(cacheKey);

    if (!stats) {
      stats = await supabaseService.getUserQuestionStats(userId);

      // Cache for 10 minutes
      await cacheService.set(cacheKey, stats, 600);
    }

    res.json({
      success: true,
      data: stats,
    });
  })
);

// POST /api/v1/user-stats - Upsert user question stat
router.post(
  '/',
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { userId, questionId, correctAttempts, incorrectAttempts, lastAttempted } = req.body;

    logger.debug('Upserting user question stat', { userId, questionId });

    const result = await supabaseService.upsertUserQuestionStat(userId, questionId, {
      correctAttempts,
      incorrectAttempts,
      lastAttempted,
    });

    // Invalidate user's question stats cache
    await cacheService.delete(`user:question-stats:${userId}`);

    res.status(201).json({
      success: true,
      data: result,
    });
  })
);

export default router;