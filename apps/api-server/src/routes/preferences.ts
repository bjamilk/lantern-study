import { Router, type Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth';
import { allowDevAuthBypass } from '../middleware/authorizeResource';
import { handleValidationErrors, validateUserId } from '../middleware/validation';
import type { DataLayer } from '../services/data';
import { CacheService } from '../services/cache';
import { logger } from '../utils/logger';
import { rejectMismatchedUserId } from '../utils/requestAuth';
import { clientErrorMessage } from '../utils/safeError';
import type { AuthenticatedRequest } from '../types';

const router = Router();

let dataLayer: DataLayer;
let cacheService: CacheService;

export const initializePreferencesRoutes = (layer: DataLayer, cache: CacheService) => {
  dataLayer = layer;
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

    if (await rejectMismatchedUserId(req, res, userId)) return;

    logger.debug('Fetching user preferences', { userId, requestingUserId: req.user?.id });

    const cacheKey = `user:preferences:${userId}`;
    let preferences = await cacheService.get(cacheKey);

    if (!preferences) {
      preferences = await dataLayer.categories.getUserPreferences(userId);

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
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { userId, theme, preferences } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'userId is required',
      });
    }

    if (await rejectMismatchedUserId(req, res, userId)) return;

    logger.debug('Saving user preferences', { userId, theme, requestingUserId: req.user?.id });

    try {
      // Merge with existing prefs. Wallet balance/awards are server-authoritative —
      // clients must not overwrite them via preferences POST (race with awards).
      const existing = await dataLayer.categories.getUserPreferences(userId);
      const existingPrefs =
        existing?.preferences && typeof existing.preferences === 'object'
          ? existing.preferences
          : {};
      const existingExtras =
        existingPrefs.budgetExtras && typeof existingPrefs.budgetExtras === 'object'
          ? existingPrefs.budgetExtras
          : {};
      const incomingPrefs = preferences && typeof preferences === 'object' ? preferences : {};
      const incomingExtras =
        incomingPrefs.budgetExtras && typeof incomingPrefs.budgetExtras === 'object'
          ? incomingPrefs.budgetExtras
          : {};

      const mergedPreferences = {
        ...existingPrefs,
        ...incomingPrefs,
        budgetExtras: {
          ...existingExtras,
          ...incomingExtras,
          walletBalance:
            typeof existingExtras.walletBalance === 'number'
              ? existingExtras.walletBalance
              : typeof incomingExtras.walletBalance === 'number'
                ? incomingExtras.walletBalance
                : 0,
          walletAwards:
            existingExtras.walletAwards && typeof existingExtras.walletAwards === 'object'
              ? existingExtras.walletAwards
              : incomingExtras.walletAwards && typeof incomingExtras.walletAwards === 'object'
                ? incomingExtras.walletAwards
                : {},
        },
      };

      const result = await dataLayer.categories.upsertUserPreferences(userId, {
        theme: theme || existing?.theme || 'light',
        preferences: mergedPreferences,
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
