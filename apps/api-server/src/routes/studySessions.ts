import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { handleValidationErrors } from '../middleware/validation';
import { SupabaseService } from '../services/supabase';
import { CacheService } from '../services/cache';
import { logger } from '../utils/logger';

const router = Router();

// Initialize services (will be injected in main server)
let supabaseService: SupabaseService;
let cacheService: CacheService;

export const initializeStudySessionRoutes = (supabase: SupabaseService, cache: CacheService) => {
  supabaseService = supabase;
  cacheService = cache;
};

// POST /api/v1/study-sessions - Create a new study session
router.post(
  '/',
  // authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { deckId, userId, endsAt, metadata } = req.body;
    const authUserId = req.user?.id;

    logger.debug('Creating study session', { deckId, userId: userId || authUserId });

    const finalUserId = userId || authUserId;
    if (!finalUserId) {
      return res.status(400).json({ success: false, error: 'User ID is required' });
    }

    if (!deckId) {
      return res.status(400).json({ success: false, error: 'deckId is required' });
    }

    const session = await supabaseService.createStudySession(deckId, finalUserId, endsAt, metadata);

    // Invalidate any session caches
    await cacheService.deletePattern(`study_session:*`);

    res.status(201).json({ success: true, data: session });
  })
);

// POST /api/v1/study-sessions/:sessionId/join - Join an existing session
router.post(
  '/:sessionId/join',
  // authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { sessionId } = req.params;
    const { userId } = req.body;
    const authUserId = req.user?.id;

    logger.debug('Joining study session', { sessionId, userId: userId || authUserId });

    const finalUserId = userId || authUserId;
    if (!finalUserId) {
      return res.status(400).json({ success: false, error: 'User ID is required' });
    }

    const participant = await supabaseService.joinStudySession(sessionId, finalUserId);

    // Invalidate cache for this session participants
    await cacheService.delete(`study_session:${sessionId}:participants`);
    await cacheService.delete(`study_session:${sessionId}`);

    res.status(201).json({ success: true, data: participant });
  })
);

// POST /api/v1/study-sessions/:sessionId/leave - Leave a session
router.post(
  '/:sessionId/leave',
  // authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { sessionId } = req.params;
    const { userId } = req.body;
    const authUserId = req.user?.id;

    logger.debug('Leaving study session', { sessionId, userId: userId || authUserId });

    const finalUserId = userId || authUserId;
    if (!finalUserId) {
      return res.status(400).json({ success: false, error: 'User ID is required' });
    }

    await supabaseService.leaveStudySession(sessionId, finalUserId);

    // Invalidate cache
    await cacheService.delete(`study_session:${sessionId}:participants`);
    await cacheService.delete(`study_session:${sessionId}`);

    res.json({ success: true, message: 'Left session' });
  })
);

// POST /api/v1/study-sessions/:sessionId/end - End an existing session
router.post(
  '/:sessionId/end',
  // authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { sessionId } = req.params;
    const authUserId = req.user?.id;

    logger.debug('Ending study session', { sessionId, userId: authUserId });

    const session = await supabaseService.endStudySession(sessionId);

    // Invalidate cache
    await cacheService.delete(`study_session:${sessionId}`);

    res.json({ success: true, data: session });
  })
);

// GET /api/v1/study-sessions - List sessions (optionally filtered by deck)
router.get(
  '/',
  // authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { deckId } = req.query;
    const authUserId = req.user?.id;

    logger.debug('Listing study sessions', { deckId, userId: authUserId });

    if (!deckId) {
      return res.status(400).json({ success: false, error: 'deckId query parameter is required' });
    }

    const sessions = await supabaseService.getStudySessionsByDeck(deckId as string);

    res.json({ success: true, data: sessions });
  })
);

// GET /api/v1/study-sessions/:sessionId - Get session details
router.get(
  '/:sessionId',
  // authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { sessionId } = req.params;

    logger.debug('Fetching study session', { sessionId });

    const cacheKey = `study_session:${sessionId}`;
    let session = await cacheService.get(cacheKey);

    if (!session) {
      session = await supabaseService.getStudySession(sessionId);
      if (!session) {
        return res.status(404).json({ success: false, error: 'Study session not found' });
      }

      await cacheService.set(cacheKey, session, 300);
    }

    res.json({ success: true, data: session });
  })
);

export default router;
export { router };
