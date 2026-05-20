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

// GET /api/v1/decks - Get user's decks
router.get(
  '/',
  // authMiddleware,
  // validatePagination,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { page = 1, limit = 20, userId } = req.query;
    const authUserId = req.user?.id;

    logger.debug('Fetching decks', { page, limit, userId: userId || authUserId });

    const finalUserId = userId as string || authUserId || '00000000-0000-0000-0000-000000000000'; // Default test user ID

    const cacheKey = `decks:${finalUserId}:${page}:${limit}`;
    let decks = await cacheService.get(cacheKey) as any[];

    if (!decks) {
      decks = await supabaseService.getDecks(finalUserId);

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
    const { name, description, userId } = req.body;
    const authUserId = req.user?.id;

    logger.debug('Creating deck', { name, description, userId: userId || authUserId });

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
    }, finalUserId);

    // Invalidate user's decks cache (GET route caches under `decks:${userId}:page:limit`)
    await cacheService.deletePattern(`decks:${finalUserId}*`);

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
    const { name, description, userId } = req.body;
    const authUserId = req.user?.id;

    logger.debug('Updating deck', { deckId, name, description, userId: userId || authUserId });

    const finalUserId = userId || authUserId;

    const updatedDeck = await supabaseService.updateDeck(deckId, {
      name,
      description,
    });

    if (!updatedDeck) {
      return res.status(404).json({
        success: false,
        error: 'Deck not found',
      });
    }

    // Invalidate caches
    await cacheService.delete(`deck:${deckId}`);
    await cacheService.deletePattern(`decks:${finalUserId}*`);

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
    await cacheService.deletePattern(`decks:${finalUserId}*`);

    res.json({
      success: true,
      message: 'Deck deleted successfully',
    });
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

    // Invalidate caches
    await cacheService.delete(`deck:${deckId}`);
    await cacheService.deletePattern(`flashcards:deck:${deckId}:*`);
    if (finalUserId) {
      await cacheService.deletePattern(`decks:${finalUserId}*`);
    }

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

    if (!importData || !importData.deck || !importData.deck.name) {
      return res.status(400).json({
        success: false,
        error: 'Invalid import data. Expected { deck: { name: string, ... }, flashcards: [...] }',
      });
    }

    logger.debug('Importing deck', { userId: userId || authUserId });

    const finalUserId = userId || authUserId;

    if (!finalUserId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required',
      });
    }

    const importedDeck = await supabaseService.importDeck(importData, finalUserId);

    // Invalidate user's decks cache — the GET route caches under `decks:${userId}:page:limit`
    await cacheService.deletePattern(`decks:${finalUserId}*`);

    res.status(201).json({
      success: true,
      data: importedDeck,
    });
  })
);

export default router;