import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth';
import { handleValidationErrors, validateUserId } from '../middleware/validation';
import { SupabaseService } from '../services/supabase';
import { CacheService } from '../services/cache';
import { logger } from '../utils/logger';

const router = Router();

// Initialize services (will be injected in main server)
let supabaseService: SupabaseService;
let cacheService: CacheService;

// Initialize function to be called from main server
export const initializePreferencesRoutes = (supabase: SupabaseService, cache: CacheService) => {
  supabaseService = supabase;
  cacheService = cache;
};

// GET /api/v1/preferences/:userId - Get user preferences
router.get(
  '/:userId',
  optionalAuthMiddleware,
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { userId } = req.params;
    const requestingUserId = req.user?.id;

    logger.debug('Fetching user preferences', { userId, requestingUserId });

    // In development, allow fetching preferences without strict auth
    // In production, require auth
    const isDev = process.env.NODE_ENV !== 'production';
    if (!isDev && requestingUserId && requestingUserId !== userId && !req.user?.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    const cacheKey = `user:preferences:${userId}`;
    let preferences = await cacheService.get(cacheKey);

    if (!preferences) {
      preferences = await supabaseService.getUserPreferences(userId);

      if (preferences) {
        // Cache for 30 minutes
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
  optionalAuthMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { userId, theme, preferences } = req.body;
    const requestingUserId = req.user?.id;

    logger.debug('Saving user preferences', { userId, theme, requestingUserId });

    // Validate userId is provided
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'userId is required',
      });
    }

    // In development, allow saving preferences without strict auth
    // In production, require auth and matching user
    const isDev = process.env.NODE_ENV !== 'production';
    if (!isDev && requestingUserId && requestingUserId !== userId && !req.user?.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    try {
      const result = await supabaseService.upsertUserPreferences(userId, {
        theme,
        preferences,
      });

      // Invalidate user's preferences cache
      await cacheService.delete(`user:preferences:${userId}`);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      logger.error('Error saving preferences', { error: error.message, userId });
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to save preferences',
      });
    }
  })
);

export default router;
