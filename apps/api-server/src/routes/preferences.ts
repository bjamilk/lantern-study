import { Router, type Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth';
import { allowDevAuthBypass } from '../middleware/authorizeResource';
import { handleValidationErrors, validateUserId } from '../middleware/validation';
import { SupabaseService } from '../services/supabase';
import { CacheService } from '../services/cache';
import { logger } from '../utils/logger';
import { rejectMismatchedUserId } from '../utils/requestAuth';
import { clientErrorMessage } from '../utils/safeError';
import type { AuthenticatedRequest } from '../types';

const router = Router();

let supabaseService: SupabaseService;
let cacheService: CacheService;

export const initializePreferencesRoutes = (supabase: SupabaseService, cache: CacheService) => {
  supabaseService = supabase;
  cacheService = cache;
};

const preferencesAuth = allowDevAuthBypass() ? optionalAuthMiddleware : authMiddleware;

// GET /api/v1/preferences/:userId - Get user preferences
router.get(
  '/:userId',
  preferencesAuth,
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { userId } = req.params;

    if (rejectMismatchedUserId(req, res, userId)) return;

    logger.debug('Fetching user preferences', { userId, requestingUserId: req.user?.id });

    const cacheKey = `user:preferences:${userId}`;
    let preferences = await cacheService.get(cacheKey);

    if (!preferences) {
      preferences = await supabaseService.getUserPreferences(userId);

      if (preferences) {
        await cacheService.set(cacheKey, preferences, 1800);
      }
    }

    res.json({
      success: true,
      data: preferences,
    });
  })
);

// POST /api/v1/preferences - Save/update user preferences
router.post(
  '/',
  preferencesAuth,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { userId, theme, preferences } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'userId is required',
      });
    }

    if (rejectMismatchedUserId(req, res, userId)) return;

    logger.debug('Saving user preferences', { userId, theme, requestingUserId: req.user?.id });

    try {
      const result = await supabaseService.upsertUserPreferences(userId, {
        theme,
        preferences,
      });

      await cacheService.delete(`user:preferences:${userId}`);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error: unknown) {
      logger.error('Error saving preferences', { error: clientErrorMessage(error), userId });
      res.status(500).json({
        success: false,
        error: clientErrorMessage(error, 'Failed to save preferences'),
      });
    }
  })
);

export default router;
