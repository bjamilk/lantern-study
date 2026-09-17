import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { handleValidationErrors, validateCreateChallenge, validateSubmitChallenge, validateChallengeId } from '../middleware/validation';
import { requireAuthUserId } from '../utils/requestAuth';
import { ChallengeService } from '../services/challengeService';
import type { DataLayer } from '../services/data';
import { CacheService } from '../services/cache';
import { CacheKeys, CacheTTL } from '../services/cachePolicy';
import { logger } from '../utils/logger';
import { clientErrorMessage } from '../utils/safeError';

const router = Router();

let challengeService: ChallengeService;
let cacheService: CacheService;

export const initializeChallengeRoutes = (layer: DataLayer, cache: CacheService) => {
  // TRANSITIONAL (M2a): ChallengeService still takes the `SupabaseService`
  // facade whole; it is the same instance the data layer is built from.
  challengeService = new ChallengeService(layer.legacyService);
  cacheService = cache;
};

// POST /api/v1/challenges - Send a challenge
router.post(
  '/',
  authMiddleware,
  validateCreateChallenge,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { groupId, opponentId, config } = req.body;
    logger.debug('Creating challenge', { groupId, opponentId, userId });

    try {
      const challenge = await challengeService.createChallenge(userId, { groupId, opponentId, config });
      // List caches are invalidated inside createChallenge; do not block the response.
      res.status(201).json({ success: true, data: challenge });
    } catch (err: any) {
      const status = err.statusCode || 500;
      res.status(status).json({ success: false, error: clientErrorMessage(err, 'Failed to create challenge') });
    }
  })
);

// GET /api/v1/challenges - List my challenges
router.get(
  '/',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { status } = req.query;
    const cacheKey = CacheKeys.challengeList(userId, status as string | undefined);
    const cached = await cacheService.get<any[]>(cacheKey);
    if (cached) {
      return res.json({ success: true, data: cached });
    }

    const challenges = await challengeService.listChallenges(userId, status as string | undefined);
    await cacheService.set(cacheKey, challenges, CacheTTL.challengeList);
    res.json({ success: true, data: challenges });
  })
);

// GET /api/v1/challenges/:challengeId
router.get(
  '/:challengeId',
  authMiddleware,
  validateChallengeId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { challengeId } = req.params;
    const challenge = await challengeService.getChallenge(challengeId, userId);
    if (!challenge) {
      return res.status(404).json({ success: false, error: 'Challenge not found' });
    }
    res.json({ success: true, data: challenge });
  })
);

// POST /api/v1/challenges/:challengeId/accept
router.post(
  '/:challengeId/accept',
  authMiddleware,
  validateChallengeId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    try {
      const challenge = await challengeService.acceptChallenge(req.params.challengeId, userId);
      res.json({ success: true, data: challenge });
    } catch (err: any) {
      res.status(err.statusCode || 500).json({ success: false, error: clientErrorMessage(err) });
    }
  })
);

// POST /api/v1/challenges/:challengeId/decline
router.post(
  '/:challengeId/decline',
  authMiddleware,
  validateChallengeId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    try {
      const challenge = await challengeService.declineChallenge(req.params.challengeId, userId);
      res.json({ success: true, data: challenge });
    } catch (err: any) {
      res.status(err.statusCode || 500).json({ success: false, error: clientErrorMessage(err) });
    }
  })
);

// POST /api/v1/challenges/:challengeId/forfeit
router.post(
  '/:challengeId/forfeit',
  authMiddleware,
  validateChallengeId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    try {
      const challenge = await challengeService.forfeitChallenge(req.params.challengeId, userId);
      res.json({ success: true, data: challenge });
    } catch (err: any) {
      res.status(err.statusCode || 500).json({ success: false, error: clientErrorMessage(err) });
    }
  })
);

// POST /api/v1/challenges/:challengeId/submit
router.post(
  '/:challengeId/submit',
  authMiddleware,
  validateChallengeId,
  validateSubmitChallenge,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { answers } = req.body;
    try {
      const challenge = await challengeService.submitChallenge(req.params.challengeId, userId, answers);
      res.json({ success: true, data: challenge });
    } catch (err: any) {
      res.status(err.statusCode || 500).json({ success: false, error: clientErrorMessage(err) });
    }
  })
);

export default router;
