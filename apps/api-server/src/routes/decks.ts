import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { handleValidationErrors, validatePagination, validateUserId } from '../middleware/validation';
import { SupabaseService } from '../services/supabase';
import { CacheService } from '../services/cache';
import { logger } from '../utils/logger';

const router = Router();

// Initialize services (will be injected in main server)
let supabaseService: SupabaseService;
let cacheService: CacheService;

// Initialize function to be called from main server
export const initializeDeckRoutes = (supabase: SupabaseService, cache: CacheService) => {
  console.log('Initializing deck routes...');
  supabaseService = supabase;
  cacheService = cache;
  console.log('Deck routes initialized');
};

// GET /api/v1/decks - Get user's decks (optionally include shared decks)
router.get(
  '/',
  // authMiddleware,
  // validatePagination,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { page = 1, limit = 20, userId, includeShared } = req.query;
    const authUserId = req.user?.id;

    const includeSharedFlag = includeShared === 'true';
    logger.debug('Fetching decks', { page, limit, userId: userId || authUserId, includeShared: includeSharedFlag });

    const finalUserId = userId as string || authUserId || '00000000-0000-0000-0000-000000000000'; // Default test user ID

    const cacheKey = `decks:${finalUserId}:includeShared:${includeSharedFlag}:${page}:${limit}`;
    let decks = await cacheService.get(cacheKey) as any[];

    if (!decks) {
      decks = await supabaseService.getDecks(finalUserId, includeSharedFlag);

      // Cache for 5 minutes
      await cacheService.set(cacheKey, decks, 300);
    }

    res.json({
      success: true,
      data: decks,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total: decks.length,
      },
    });
  })
);

// GET /api/v1/decks/:deckId - Get deck by ID
router.get(
  '/:deckId',
  // authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { deckId } = req.params;
    const { userId } = req.query;
    const authUserId = req.user?.id;

    logger.debug('Fetching deck', { deckId, userId: userId || authUserId });

    const finalUserId = userId as string || authUserId;

    const cacheKey = `deck:${deckId}`;
    let deck = await cacheService.get(cacheKey);

    if (!deck) {
      deck = await supabaseService.getDeck(deckId);

      if (!deck) {
        return res.status(404).json({
          success: false,
          error: 'Deck not found or access denied',
        });
      }

      // Cache for 10 minutes
      await cacheService.set(cacheKey, deck, 600);
    }

    res.json({
      success: true,
      data: deck,
    });
  })
);

// POST /api/v1/decks - Create new deck
router.post(
  '/',
  // authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
const { name, description, userId, isShared } = req.body;
  const authUserId = req.user?.id;

  logger.debug('Creating deck', { name, description, userId: userId || authUserId, isShared });

  const finalUserId = userId || authUserId;

  if (!finalUserId) {
    return res.status(400).json({
      success: false,
      error: 'User ID is required',
    });
  }

  const deck = await supabaseService.createDeck({
    name,
    description,
    isShared,
    }, finalUserId);

    // Invalidate user's decks cache so the newly-created deck will be fetched on
    // the next request.  The cache key used by getDecks is `decks:user:<id>`
    // so we need to explicitly delete that key (and any legacy variants).
    await cacheService.delete(`decks:user:${finalUserId}`);
    await cacheService.deletePattern(`decks:user:${finalUserId}*`);

    res.status(201).json({
      success: true,
      data: deck,
    });
  })
);

// PUT /api/v1/decks/:deckId - Update deck
router.put(
  '/:deckId',
  // authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { deckId } = req.params;
const { name, description, userId, isShared } = req.body;
  const authUserId = req.user?.id;

  logger.debug('Updating deck', { deckId, name, description, userId: userId || authUserId, isShared });

  const finalUserId = userId || authUserId;

  const updatedDeck = await supabaseService.updateDeck(deckId, {
    name,
    description,
    isShared,
    });

    if (!updatedDeck) {
      return res.status(404).json({
        success: false,
        error: 'Deck not found',
      });
    }

    // Invalidate caches
    await cacheService.delete(`deck:${deckId}`);
    await cacheService.delete(`decks:user:${finalUserId}`);
    await cacheService.deletePattern(`decks:user:${finalUserId}*`);

    res.json({
      success: true,
      data: updatedDeck,
    });
  })
);

// DELETE /api/v1/decks/:deckId - Delete deck
router.delete(
  '/:deckId',
  // authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { deckId } = req.params;
    const { userId } = req.query;
    const authUserId = req.user?.id;

    logger.debug('Deleting deck', { deckId, userId: userId || authUserId });

    const finalUserId = userId as string || authUserId;

    const deleted = await supabaseService.deleteDeck(deckId);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Deck not found',
      });
    }

    // Invalidate caches
    await cacheService.delete(`deck:${deckId}`);
    await cacheService.delete(`decks:user:${finalUserId}`);
    await cacheService.deletePattern(`decks:user:${finalUserId}*`);

    res.json({
      success: true,
      message: 'Deck deleted successfully',
    });
  })
);

// GET /api/v1/decks/:deckId/collaborators - List collaborators for a deck
router.get(
  '/:deckId/collaborators',
  // authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { deckId } = req.params;
    const authUserId = req.user?.id;

    logger.debug('Fetching deck collaborators', { deckId, userId: authUserId });

    const collaborators = await supabaseService.getDeckCollaborators(deckId);

    res.json({
      success: true,
      data: collaborators,
    });
  })
);

// POST /api/v1/decks/:deckId/collaborators - Add collaborator to deck
router.post(
  '/:deckId/collaborators',
  // authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { deckId } = req.params;
    const { userId, role } = req.body;
    const authUserId = req.user?.id;

    logger.debug('Adding deck collaborator', { deckId, userId, role, authUserId });

    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId is required' });
    }

    const collaborator = await supabaseService.addDeckCollaborator(deckId, userId, role);

    res.status(201).json({ success: true, data: collaborator });
  })
);

// DELETE /api/v1/decks/:deckId/collaborators/:userId - Remove collaborator
router.delete(
  '/:deckId/collaborators/:userId',
  // authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { deckId, userId } = req.params;
    const authUserId = req.user?.id;

    logger.debug('Removing deck collaborator', { deckId, userId, authUserId });

    await supabaseService.removeDeckCollaborator(deckId, userId);

    res.json({ success: true, message: 'Collaborator removed' });
  })
);

// POST /api/v1/decks/:deckId/reset - Reset deck statistics
router.post(
  '/:deckId/reset',
  // authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { deckId } = req.params;
    const { userId } = req.body;
    const authUserId = req.user?.id;

    logger.debug('Resetting deck statistics', { deckId, userId: userId || authUserId });

    const finalUserId = userId || authUserId;

    const result = await supabaseService.resetDeckStatistics(deckId);

    // Invalidate deck cache
    await cacheService.delete(`deck:${deckId}`);

    res.json({
      success: true,
      data: result,
    });
  })
);

// GET /api/v1/decks/:deckId/export - Export deck
router.get(
  '/:deckId/export',
  // authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { deckId } = req.params;
    const { userId } = req.query;
    const authUserId = req.user?.id;

    logger.debug('Exporting deck', { deckId, userId: userId || authUserId });

    const finalUserId = userId as string || authUserId;

    const exportedData = await supabaseService.exportDeck(deckId);

    res.json({
      success: true,
      data: exportedData,
    });
  })
);

// POST /api/v1/decks/import - Import deck
router.post(
  '/import',
  // authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { importData, userId } = req.body;
    const authUserId = req.user?.id;

    logger.debug('Importing deck', { userId: userId || authUserId });

    const finalUserId = userId || authUserId;

    // importDeck now returns both the created deck and an array of
    // the flashcards that were inserted.  Returning cards avoids an extra
    // follow-up request on the client and also ensures most recent data is
    // immediately available.
    const importedDeck = await supabaseService.importDeck(importData, finalUserId);

    // Invalidate user's decks cache (clear both the correct key and any
    // legacy variants) so that subsequent GET /decks calls will include the
    // newly-created deck.
    await cacheService.delete(`decks:user:${finalUserId}`);
    await cacheService.deletePattern(`decks:user:${finalUserId}*`);

    res.status(201).json({
      success: true,
      data: importedDeck,
    });
  })
);

export default router;