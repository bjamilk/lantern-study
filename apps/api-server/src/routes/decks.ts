import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { handleValidationErrors, validatePagination, validateDeckId, validateDeckCreate, validateDeckUpdate } from '../middleware/validation';
import { requireAuthUserId } from '../utils/requestAuth';
import { runSyncOrEnqueue } from '../queue/enqueue';
import { sendAsyncJobAccepted } from '../queue/respondAsync';
import { requireDeckAccess } from '../middleware/authorizeResource';
import { uploadBurstRateLimit } from '../middleware/rateLimit';
import { SupabaseService } from '../services/supabase';
import { CacheService } from '../services/cache';
import { logger } from '../utils/logger';
import { COURSE_FILTER_INVALID_MESSAGE, courseFilterKey, parseCourseFilter } from '../services/academicCourses';

const router = Router();
const DEFAULT_DECK_PAGE_SIZE = 20;
const MAX_DECK_PAGE_SIZE = 50;
const resolveResponseProfile = (profile: unknown): 'compact' | 'full' =>
  profile === 'compact' ? 'compact' : 'full';

let supabaseService: SupabaseService;
let cacheService: CacheService;

export const initializeDeckRoutes = (supabase: SupabaseService, cache: CacheService) => {
  supabaseService = supabase;
  cacheService = cache;
};

router.get(
  '/',
  authMiddleware,
  validatePagination,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { page = 1, limit, includeShared, responseProfile, courseId } = req.query;
    const parsedPage = Math.max(1, parseInt(page as string, 10) || 1);
    const requestedLimit = parseInt((limit as string) || `${DEFAULT_DECK_PAGE_SIZE}`, 10);
    const parsedLimit = Math.min(MAX_DECK_PAGE_SIZE, Math.max(1, requestedLimit || DEFAULT_DECK_PAGE_SIZE));
    const profile = resolveResponseProfile(responseProfile);
    const includeSharedFlag = includeShared === 'true';
    // ?courseId= — uuid, the literal "null" (unfiled) or absent; anything else is a 400.
    const courseFilter = parseCourseFilter(courseId);
    if (courseFilter.kind === 'invalid') {
      return res.status(400).json({ success: false, error: COURSE_FILTER_INVALID_MESSAGE });
    }
    const courseKey = courseFilterKey(courseFilter);

    logger.debug('Fetching decks', { page: parsedPage, limit: parsedLimit, userId, includeShared: includeSharedFlag, profile, courseId: courseKey });

    // v2 busts caches that previously listed every globally shared deck.
    const cacheKey = `decks:${userId}:scope:${includeSharedFlag ? "owned_collab" : "owned"}:${parsedPage}:${parsedLimit}:profile:${profile}:course:${courseKey}:v2`;
    let decks = await cacheService.get(cacheKey) as any[];

    if (!decks) {
      decks = await supabaseService.getDecks(userId, includeSharedFlag, {
        page: parsedPage,
        limit: parsedLimit,
        responseProfile: profile,
        courseFilter,
      });
      await cacheService.set(cacheKey, decks, 300);
    }

    res.json({
      success: true,
      data: decks,
      pagination: { page: parsedPage, limit: parsedLimit, total: decks.length },
      responseProfile: profile,
    });
  })
);

router.get(
  '/:deckId',
  authMiddleware,
  requireDeckAccess('deckId', 'read'),
  validateDeckId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { deckId } = req.params;
    const deck = await supabaseService.getDeckForUser(deckId, userId);

    if (!deck) {
      return res.status(404).json({ success: false, error: 'Deck not found or access denied' });
    }

    res.json({ success: true, data: deck });
  })
);

router.post(
  '/',
  authMiddleware,
  validateDeckCreate,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { name, description, isShared, courseId } = req.body;
    const deck = await supabaseService.createDeck({ name, description, isShared, courseId }, userId);

    await cacheService.delete(`decks:user:${userId}`);
    await cacheService.deletePattern(`decks:user:${userId}*`);
    // The list above caches under `decks:<userId>:scope:...`, which the
    // `decks:user:<userId>` patterns never match — without this the deck list
    // stays stale for the full 300s TTL.
    await cacheService.deletePattern(`decks:${userId}*`);

    res.status(201).json({ success: true, data: deck });
  })
);

router.put(
  '/:deckId',
  authMiddleware,
  requireDeckAccess('deckId', 'edit'),
  validateDeckId,
  validateDeckUpdate,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { deckId } = req.params;
    const { name, description, isShared, courseId } = req.body;
    const updatedDeck = await supabaseService.updateDeck(deckId, { name, description, isShared, courseId }, userId);

    if (!updatedDeck) {
      return res.status(404).json({ success: false, error: 'Deck not found or access denied' });
    }

    await cacheService.deletePattern(`deck:${deckId}:user:*`);
    await cacheService.delete(`decks:user:${userId}`);
    await cacheService.deletePattern(`decks:user:${userId}*`);
    await cacheService.deletePattern(`decks:${userId}*`);

    res.json({ success: true, data: updatedDeck });
  })
);

router.delete(
  '/:deckId',
  authMiddleware,
  requireDeckAccess('deckId', 'owner'),
  validateDeckId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { deckId } = req.params;
    const deleted = await supabaseService.deleteDeck(deckId, userId);

    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Deck not found or access denied' });
    }

    await cacheService.deletePattern(`deck:${deckId}:user:*`);
    await cacheService.delete(`decks:user:${userId}`);
    await cacheService.deletePattern(`decks:user:${userId}*`);
    await cacheService.deletePattern(`decks:${userId}*`);

    res.json({ success: true, message: 'Deck deleted successfully' });
  })
);

router.get(
  '/:deckId/collaborators',
  authMiddleware,
  requireDeckAccess('deckId', 'read'),
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { deckId } = req.params;
    const collaborators = await supabaseService.getDeckCollaborators(deckId, userId);
    res.json({ success: true, data: collaborators });
  })
);

router.post(
  '/:deckId/collaborators',
  authMiddleware,
  requireDeckAccess('deckId', 'edit'),
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { deckId } = req.params;
    const { userId: collaboratorId, role } = req.body;

    if (!collaboratorId) {
      return res.status(400).json({ success: false, error: 'userId is required' });
    }

    try {
      const collaborator = await supabaseService.addDeckCollaborator(deckId, collaboratorId, role, userId);

      // Phase 3 M: added_deck_collaborator had no writer. Addressed to the
      // owner's followers — "X is collaborating on Y" is their news, and the
      // collaborator themselves already knows.
      const { getActivityFeedService } = await import('../services/activityFeed');
      await getActivityFeedService(supabaseService).record({
        actorId: userId,
        verb: 'added_deck_collaborator',
        objectType: 'deck',
        objectId: deckId,
        audienceType: 'followers',
      });

      res.status(201).json({ success: true, data: collaborator });
    } catch (error: any) {
      if (error.message === 'Access denied') {
        return res.status(403).json({ success: false, error: 'Access denied' });
      }
      throw error;
    }
  })
);

router.delete(
  '/:deckId/collaborators/:userId',
  authMiddleware,
  requireDeckAccess('deckId', 'edit'),
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const authUserId = requireAuthUserId(req, res);
    if (!authUserId) return;

    const { deckId, userId } = req.params;
    try {
      await supabaseService.removeDeckCollaborator(deckId, userId, authUserId);
      res.json({ success: true, message: 'Collaborator removed' });
    } catch (error: any) {
      if (error.message === 'Access denied') {
        return res.status(403).json({ success: false, error: 'Access denied' });
      }
      throw error;
    }
  })
);

router.post(
  '/:deckId/reset',
  authMiddleware,
  requireDeckAccess('deckId', 'edit'),
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { deckId } = req.params;
    try {
      const result = await supabaseService.resetDeckStatistics(deckId, userId);
      await cacheService.deletePattern(`deck:${deckId}:user:*`);
      res.json({ success: true, data: result });
    } catch (error: any) {
      if (error.message === 'Deck not found or access denied') {
        return res.status(404).json({ success: false, error: 'Deck not found or access denied' });
      }
      throw error;
    }
  })
);

router.get(
  '/:deckId/export/csv',
  authMiddleware,
  requireDeckAccess('deckId', 'read'),
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { deckId } = req.params;
    const exportedData = await supabaseService.exportDeck(deckId, userId);
    if (!exportedData) {
      return res.status(404).json({ success: false, error: 'Deck not found or access denied' });
    }

    const { deckToCsv } = await import('../utils/deckFormats');
    const csv = deckToCsv(exportedData);
    const safeName = (exportedData.deck?.name || 'deck').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.csv"`);
    res.send(csv);
  })
);

router.post(
  '/import/csv',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { csv, deckName } = req.body;
    if (!csv || typeof csv !== 'string') {
      return res.status(400).json({ success: false, error: 'csv field is required' });
    }

    const { csvToImportData } = await import('../utils/deckFormats');
    const importData = csvToImportData(csv, deckName || 'Imported Deck');
    const importedDeck = await supabaseService.importDeck(importData, userId);

    await cacheService.delete(`decks:user:${userId}`);
    await cacheService.deletePattern(`decks:user:${userId}*`);
    await cacheService.deletePattern(`decks:${userId}*`);

    res.status(201).json({ success: true, data: importedDeck });
  })
);

router.post(
  '/import/apkg',
  authMiddleware,
  uploadBurstRateLimit,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { apkgBase64 } = req.body;
    if (!apkgBase64 || typeof apkgBase64 !== 'string') {
      return res.status(400).json({ success: false, error: 'apkgBase64 field is required' });
    }

    const buffer = Buffer.from(apkgBase64, 'base64');
    const outcome = await runSyncOrEnqueue(
      'deck.importApkg',
      { apkgBase64, userId },
      userId,
      async () => {
        const { parseApkgBuffer } = await import('../services/apkgImport');
        const importData = await parseApkgBuffer(buffer);
        return supabaseService.importDeck(importData, userId);
      }
    );

    if (outcome.mode === 'async') {
      sendAsyncJobAccepted(res, outcome.jobId);
      return;
    }

    const importedDeck = outcome.result;

    await cacheService.delete(`decks:user:${userId}`);
    await cacheService.deletePattern(`decks:user:${userId}*`);
    await cacheService.deletePattern(`decks:${userId}*`);

    res.status(201).json({ success: true, data: importedDeck });
  })
);

router.get(
  '/:deckId/export',
  authMiddleware,
  requireDeckAccess('deckId', 'read'),
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { deckId } = req.params;
    const exportedData = await supabaseService.exportDeck(deckId, userId);
    if (!exportedData) {
      return res.status(404).json({ success: false, error: 'Deck not found or access denied' });
    }
    res.json({ success: true, data: exportedData });
  })
);

router.post(
  '/import',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { importData } = req.body;
    if (!importData || typeof importData !== 'object' || Array.isArray(importData)) {
      return res.status(400).json({ success: false, error: 'importData object is required' });
    }
    if (!importData.deck || typeof importData.deck.name !== 'string') {
      return res.status(400).json({ success: false, error: 'importData.deck.name is required' });
    }
    // Reject multi-deck payloads — import always creates exactly one deck for the auth user.
    if (Array.isArray((importData as { decks?: unknown }).decks)) {
      return res.status(400).json({
        success: false,
        error: 'Multi-deck import is not supported. Export and import one deck at a time.',
      });
    }

    const importedDeck = await supabaseService.importDeck(importData, userId);

    await cacheService.delete(`decks:user:${userId}`);
    await cacheService.deletePattern(`decks:user:${userId}*`);
    await cacheService.deletePattern(`decks:${userId}*`);

    res.status(201).json({ success: true, data: importedDeck });
  })
);

export default router;
