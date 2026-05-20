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
export const initializeFlashcardRoutes = (supabase: SupabaseService, cache: CacheService) => {
  supabaseService = supabase;
  cacheService = cache;
};

// Helper function to check if the authenticated user has access to a flashcard
const checkFlashcardAccess = async (flashcard: any, authUserId: string): Promise<boolean> => {
  if (flashcard.user_id === authUserId) return true;
  
  // If not the owner, check if the deck it belongs to is public
  if (flashcard.deck_id) {
    const deck = await supabaseService.getDeck(flashcard.deck_id);
    if (deck && (deck.is_public || deck.user_id === authUserId)) {
      return true;
    }
  }
  return false;
};

// GET /api/v1/flashcards - Get flashcards (optionally filtered by deck)
router.get(
  '/',
  authMiddleware,
  validatePagination,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { page = 1, limit, deckId } = req.query;
    const authUserId = req.user.id;

    logger.debug('Fetching flashcards', { page, limit, deckId, userId: authUserId });

    // If deckId is provided, check access to that deck first
    if (deckId) {
      const deck = await supabaseService.getDeck(deckId as string);
      if (!deck) {
        return res.status(404).json({
          success: false,
          error: 'Deck not found',
        });
      }
      if (deck.user_id !== authUserId && !deck.is_public) {
        return res.status(403).json({
          success: false,
          error: 'Access denied to this deck',
        });
      }
    }

    // Default to a generous cap when no explicit limit provided (deck detail UI isn't paginated)
    const parsedLimit = limit ? parseInt(limit as string) : 500;
    const parsedPage = parseInt(page as string) || 1;
    const cacheKey = `flashcards:${deckId || 'all'}:${authUserId}:${parsedPage}:${parsedLimit}`;
    let flashcards = await cacheService.get(cacheKey) as any[];

    if (!flashcards) {
      flashcards = await supabaseService.getFlashcards(authUserId, deckId as string, { page: parsedPage, limit: parsedLimit });

      // Cache for 5 minutes
      await cacheService.set(cacheKey, flashcards, 300);
    }

    res.json({
      success: true,
      data: flashcards,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total: flashcards.length,
      },
    });
  })
);

// GET /api/v1/flashcards/:flashcardId - Get flashcard by ID
router.get(
  '/:flashcardId',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { flashcardId } = req.params;
    const authUserId = req.user.id;

    logger.debug('Fetching flashcard', { flashcardId, userId: authUserId });

    const cacheKey = `flashcard:${flashcardId}`;
    let flashcard = await cacheService.get(cacheKey) as any;

    if (!flashcard) {
      flashcard = await supabaseService.getFlashcard(flashcardId);

      if (!flashcard) {
        return res.status(404).json({
          success: false,
          error: 'Flashcard not found',
        });
      }

      // Cache for 10 minutes
      await cacheService.set(cacheKey, flashcard, 600);
    }

    // Access check
    const hasAccess = await checkFlashcardAccess(flashcard, authUserId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this flashcard',
      });
    }

    res.json({
      success: true,
      data: flashcard,
    });
  })
);

// GET /api/v1/flashcards/:flashcardId/comments - Get comments for a flashcard
router.get(
  '/:flashcardId/comments',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { flashcardId } = req.params;
    const authUserId = req.user.id;

    logger.debug('Fetching flashcard comments', { flashcardId, userId: authUserId });

    const flashcard = await supabaseService.getFlashcard(flashcardId);
    if (!flashcard) {
      return res.status(404).json({
        success: false,
        error: 'Flashcard not found',
      });
    }

    // Access check
    const hasAccess = await checkFlashcardAccess(flashcard, authUserId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    const comments = await supabaseService.getFlashcardComments(flashcardId);

    res.json({
      success: true,
      data: comments,
    });
  })
);

// POST /api/v1/flashcards/:flashcardId/comments - Add comment to flashcard
router.post(
  '/:flashcardId/comments',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { flashcardId } = req.params;
    const { comment } = req.body;
    const authUserId = req.user.id;

    logger.debug('Adding flashcard comment', { flashcardId, userId: authUserId, comment: comment?.substring(0, 100) });

    const flashcard = await supabaseService.getFlashcard(flashcardId);
    if (!flashcard) {
      return res.status(404).json({
        success: false,
        error: 'Flashcard not found',
      });
    }

    // Access check
    const hasAccess = await checkFlashcardAccess(flashcard, authUserId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    if (!comment || !comment.trim()) {
      return res.status(400).json({ success: false, error: 'Comment text is required' });
    }

    const newComment = await supabaseService.addFlashcardComment(flashcardId, authUserId, comment.trim());

    res.status(201).json({
      success: true,
      data: newComment,
    });
  })
);

// POST /api/v1/flashcards - Create new flashcard
router.post(
  '/',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { deckId, type, front, back, clozeText, imageUrl, occlusionData, tags } = req.body;
    const authUserId = req.user.id;

    logger.debug('Creating flashcard', { deckId, type, front: front?.substring(0, 50), imageUrl, userId: authUserId });

    // Validate that the user owns the deck they are adding a card to
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

    const flashcard = await supabaseService.createFlashcard({
      deckId,
      type: type || 'BASIC',
      front,
      back,
      clozeText,
      imageUrl,
      occlusionData,
      tags,
      userId: authUserId,
    });

    // Invalidate deck's flashcards cache
    await cacheService.deletePattern(`flashcards:*`);

    res.status(201).json({
      success: true,
      data: flashcard,
    });
  })
);

// POST /api/v1/flashcards/upload-image - Upload an image for a flashcard
router.post(
  '/upload-image',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { fileName, base64Data, contentType, folder } = req.body;

    if (!fileName || !base64Data) {
      return res.status(400).json({ success: false, error: 'fileName and base64Data are required' });
    }

    try {
      const result = await supabaseService.uploadFlashcardImage({ fileName, base64Data, contentType, folder });
      res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error('Failed to upload flashcard image', { error });
      res.status(500).json({ success: false, error: error.message || 'Failed to upload image' });
    }
  })
);

// PUT /api/v1/flashcards/:flashcardId - Update flashcard
router.put(
  '/:flashcardId',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { flashcardId } = req.params;
    const { front, back, clozeText, imageUrl, occlusionData, srsData, tags } = req.body;
    const authUserId = req.user.id;

    logger.debug('Updating flashcard', { flashcardId, front: front?.substring(0, 50), srsData: !!srsData, userId: authUserId });

    // Validate ownership
    const flashcard = await supabaseService.getFlashcard(flashcardId);
    if (!flashcard) {
      return res.status(404).json({
        success: false,
        error: 'Flashcard not found',
      });
    }
    if (flashcard.user_id !== authUserId) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: You do not own this flashcard',
      });
    }

    const updatedFlashcard = await supabaseService.updateFlashcard(flashcardId, {
      front,
      back,
      clozeText,
      imageUrl,
      occlusionData,
      srsData,
      tags,
    });

    if (!updatedFlashcard) {
      return res.status(404).json({
        success: false,
        error: 'Flashcard not found',
      });
    }

    // Invalidate caches
    await cacheService.delete(`flashcard:${flashcardId}`);
    await cacheService.deletePattern(`flashcards:*`);

    res.json({
      success: true,
      data: updatedFlashcard,
    });
  })
);

// DELETE /api/v1/flashcards/:flashcardId - Delete flashcard
router.delete(
  '/:flashcardId',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { flashcardId } = req.params;
    const authUserId = req.user.id;

    logger.debug('Deleting flashcard', { flashcardId, userId: authUserId });

    // Validate ownership
    const flashcard = await supabaseService.getFlashcard(flashcardId);
    if (!flashcard) {
      return res.status(404).json({
        success: false,
        error: 'Flashcard not found',
      });
    }
    if (flashcard.user_id !== authUserId) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: You do not own this flashcard',
      });
    }

    const deleted = await supabaseService.deleteFlashcard(flashcardId);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Flashcard not found',
      });
    }

    // Invalidate caches
    await cacheService.delete(`flashcard:${flashcardId}`);
    await cacheService.deletePattern(`flashcards:*`);

    res.json({
      success: true,
      message: 'Flashcard deleted successfully',
    });
  })
);

// GET /api/v1/flashcards/test - Test route
router.get(
  '/test',
  (req: any, res: any) => {
    console.log('Flashcard test route called');
    res.send('Flashcards test route works');
  }
);

export default router;
export { router };