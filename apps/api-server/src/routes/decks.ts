import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { handleValidationErrors, validatePagination, validateDeckId, validateDeckCreate, validateDeckUpdate } from '../middleware/validation';
import { requireAuthUserId } from '../utils/requestAuth';
import { SupabaseService } from '../services/supabase';
import { CacheService } from '../services/cache';
import { logger } from '../utils/logger';

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

    const { page = 1, limit, includeShared, responseProfile } = req.query;
    const parsedPage = Math.max(1, parseInt(page as string, 10) || 1);
    const requestedLimit = parseInt((limit as string) || `${DEFAULT_DECK_PAGE_SIZE}`, 10);
    const parsedLimit = Math.min(MAX_DECK_PAGE_SIZE, Math.max(1, requestedLimit || DEFAULT_DECK_PAGE_SIZE));
    const profile = resolveResponseProfile(responseProfile);
    const includeSharedFlag = includeShared === 'true';

    logger.debug('Fetching decks', { page: parsedPage, limit: parsedLimit, userId, includeShared: includeSharedFlag, profile });

    const cacheKey = `decks:${userId}:includeShared:${includeSharedFlag}:${parsedPage}:${parsedLimit}:profile:${profile}`;
    let decks = await cacheService.get(cacheKey) as any[];

    if (!decks) {
      decks = await supabaseService.getDecks(userId, includeSharedFlag, {
        page: parsedPage,
        limit: parsedLimit,
        responseProfile: profile,
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

    const { name, description, isShared } = req.body;
    const deck = await supabaseService.createDeck({ name, description, isShared }, userId);

    await cacheService.delete(`decks:user:${userId}`);
    await cacheService.deletePattern(`decks:user:${userId}*`);

    res.status(201).json({ success: true, data: deck });
  })
);

router.put(
  '/:deckId',
  authMiddleware,
  validateDeckId,
  validateDeckUpdate,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { deckId } = req.params;
    const { name, description, isShared } = req.body;
    const updatedDeck = await supabaseService.updateDeck(deckId, { name, description, isShared }, userId);

    if (!updatedDeck) {
      return res.status(404).json({ success: false, error: 'Deck not found or access denied' });
    }

    await cacheService.deletePattern(`deck:${deckId}:user:*`);
    await cacheService.delete(`decks:user:${userId}`);
    await cacheService.deletePattern(`decks:user:${userId}*`);

    res.json({ success: true, data: updatedDeck });
  })
);

router.delete(
  '/:deckId',
  authMiddleware,
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

    res.json({ success: true, message: 'Deck deleted successfully' });
  })
);

router.get(
  '/:deckId/collaborators',
  authMiddleware,
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
        return res.status(404).json({ success: false, error: error.message });
      }
      throw error;
    }
  })
);

router.get(
  '/:deckId/export/csv',
  authMiddleware,
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

    res.status(201).json({ success: true, data: importedDeck });
  })
);

router.post(
  '/import/apkg',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { apkgBase64 } = req.body;
    if (!apkgBase64 || typeof apkgBase64 !== 'string') {
      return res.status(400).json({ success: false, error: 'apkgBase64 field is required' });
    }

    const buffer = Buffer.from(apkgBase64, 'base64');
    const { parseApkgBuffer } = await import('../services/apkgImport');
    const importData = await parseApkgBuffer(buffer);
    const importedDeck = await supabaseService.importDeck(importData, userId);

    await cacheService.delete(`decks:user:${userId}`);
    await cacheService.deletePattern(`decks:user:${userId}*`);

    res.status(201).json({ success: true, data: importedDeck });
  })
);

router.get(
  '/:deckId/export',
  authMiddleware,
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
    const importedDeck = await supabaseService.importDeck(importData, userId);

    await cacheService.delete(`decks:user:${userId}`);
    await cacheService.deletePattern(`decks:user:${userId}*`);

    res.status(201).json({ success: true, data: importedDeck });
  })
);

export default router;
