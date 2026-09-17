import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import {
  handleValidationErrors,
  validateUserId,
  validateUserStatsUpsert,
} from '../middleware/validation';
import { rejectMismatchedUserId } from '../utils/requestAuth';
import type { DataLayer } from '../services/data';
import { CacheService } from '../services/cache';
import { logger } from '../utils/logger';

const router = Router();

let dataLayer: DataLayer;
let cacheService: CacheService;

export const initializeUserStatsRoutes = (layer: DataLayer, cache: CacheService) => {
  dataLayer = layer;
  cacheService = cache;
};

router.get(
  '/:userId',
  authMiddleware,
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { userId } = req.params;
    if (await rejectMismatchedUserId(req, res, userId)) return;

    logger.debug('Fetching user question stats', { userId });

    const cacheKey = `user:question-stats:${userId}`;
    let stats = await cacheService.get(cacheKey);

    if (!stats) {
      stats = await dataLayer.offlineBundles.getUserQuestionStats(userId);
      await cacheService.set(cacheKey, stats, 600);
    }

    res.json({
      success: true,
      data: stats,
    });
  })
);

router.post(
  '/',
  authMiddleware,
  validateUserStatsUpsert,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { userId, questionId, correctAttempts, incorrectAttempts, lastAttempted } = req.body;
    if (await rejectMismatchedUserId(req, res, userId)) return;

    logger.debug('Upserting user question stat', { userId, questionId });

    const result = await dataLayer.offlineBundles.upsertUserQuestionStat(userId, questionId, {
      correctAttempts,
      incorrectAttempts,
      lastAttempted,
    });

    await cacheService.delete(`user:question-stats:${userId}`);

    res.status(201).json({
      success: true,
      data: result,
    });
  })
);

export default router;
