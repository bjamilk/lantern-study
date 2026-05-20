import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { handleValidationErrors, validatePagination } from '../middleware/validation';
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
  authMiddleware,
  validatePagination,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { page = 1, limit = 20 } = req.query;
    const authUserId = req.user.id;

    logger.debug('Fetching decks', { page, limit, userId: authUserId });

    const cacheKey = `decks:${authUserId}:${page}:${limit}`;
    let decks = await cacheService.get(cacheKey) as any[];

    if (!decks) {
      decks = await supabaseService.getDecks(authUserId);

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
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { deckId } = req.params;
    const authUserId = req.user.id;

    logger.debug('Fetching deck', { deckId, userId: authUserId });

    const cacheKey = `deck:${deckId}`;
    let deck = await cacheService.get(cacheKey) as any;

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

    // Access check: must be owner or public
    if (deck.user_id !== authUserId && !deck.is_public) {
      return res.status(403).json({
        success: false,
        error: 'Access denied: private deck',
      });
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
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { name, description } = req.body;
    const authUserId = req.user.id;

    logger.debug('Creating deck', { name, description, userId: authUserId });

    const deck = await supabaseService.createDeck({
      name,
      description,
    }, authUserId);

    // Invalidate user's decks cache
    await cacheService.deletePattern(`decks:${authUserId}*`);

    res.status(201).json({
      success: true,
      data: deck,
    });
  })
);

// PUT /api/v1/decks/:deckId - Update deck
router.put(
  '/:deckId',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { deckId } = req.params;
    const { name, description } = req.body;
    const authUserId = req.user.id;

    logger.debug('Updating deck', { deckId, name, description, userId: authUserId });

    // Check ownership first
    const deck = await supabaseService.getDeck(deckId);
    if (!deck) {
      return res.status(404).json({
        success: false,
        error: 'Deck not found',
      });
    }

    if (deck.user_id !== authUserId) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: You do not own this deck',
      });
    }

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
    await cacheService.deletePattern(`decks:${authUserId}*`);

    res.json({
      success: true,
      data: updatedDeck,
    });
  })
);

// DELETE /api/v1/decks/:deckId - Delete deck
router.delete(
  '/:deckId',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { deckId } = req.params;
    const authUserId = req.user.id;

    logger.debug('Deleting deck', { deckId, userId: authUserId });

    // Check ownership first
    const deck = await supabaseService.getDeck(deckId);
    if (!deck) {
      return res.status(404).json({
        success: false,
        error: 'Deck not found',
      });
    }

    if (deck.user_id !== authUserId) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: You do not own this deck',
      });
    }

    const deleted = await supabaseService.deleteDeck(deckId);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Deck not found',
      });
    }

    // Invalidate caches
    await cacheService.delete(`deck:${deckId}`);
    await cacheService.deletePattern(`decks:${authUserId}*`);

    res.json({
      success: true,
      message: 'Deck deleted successfully',
    });
  })
);

// POST /api/v1/decks/:deckId/reset - Reset deck statistics
router.post(
  '/:deckId/reset',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { deckId } = req.params;
    const authUserId = req.user.id;

    logger.debug('Resetting deck statistics', { deckId, userId: authUserId });

    // Check ownership first
    const deck = await supabaseService.getDeck(deckId);
    if (!deck) {
      return res.status(404).json({
        success: false,
        error: 'Deck not found',
      });
    }

    if (deck.user_id !== authUserId) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: You do not own this deck',
      });
    }

    const result = await supabaseService.resetDeckStatistics(deckId);

    // Invalidate caches
    await cacheService.delete(`deck:${deckId}`);
    await cacheService.deletePattern(`flashcards:deck:${deckId}:*`);
    await cacheService.deletePattern(`decks:${authUserId}*`);

    res.json({
      success: true,
      data: result,
    });
  })
);

// GET /api/v1/decks/:deckId/export - Export deck
router.get(
  '/:deckId/export',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { deckId } = req.params;
    const authUserId = req.user.id;

    logger.debug('Exporting deck', { deckId, userId: authUserId });

    // Check access first
    const deck = await supabaseService.getDeck(deckId);
    if (!deck) {
      return res.status(404).json({
        success: false,
        error: 'Deck not found',
      });
    }

    if (deck.user_id !== authUserId && !deck.is_public) {
      return res.status(403).json({
        success: false,
        error: 'Access denied: private deck',
      });
    }

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
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { importData } = req.body;
    const authUserId = req.user.id;

    if (!importData || !importData.deck || !importData.deck.name) {
      return res.status(400).json({
        success: false,
        error: 'Invalid import data. Expected { deck: { name: string, ... }, flashcards: [...] }',
      });
    }

    logger.debug('Importing deck', { userId: authUserId });

    const importedDeck = await supabaseService.importDeck(importData, authUserId);

    // Invalidate user's decks cache
    await cacheService.deletePattern(`decks:${authUserId}*`);

    res.status(201).json({
      success: true,
      data: importedDeck,
    });
  })
);

export default router;
export { router };