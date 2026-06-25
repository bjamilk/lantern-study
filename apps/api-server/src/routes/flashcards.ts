import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { handleValidationErrors, validatePagination, validateFlashcardCreate } from '../middleware/validation';
import { requireAuthUserId } from '../utils/requestAuth';
import { SupabaseService } from '../services/supabase';
import { CacheService } from '../services/cache';
import { logger } from '../utils/logger';
import { uploadBurstRateLimit } from '../middleware/rateLimit';
import { clientErrorMessage } from '../utils/safeError';

const router = Router();
const DEFAULT_FLASHCARD_PAGE_SIZE = 50;
const MAX_FLASHCARD_PAGE_SIZE = 100;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const resolveResponseProfile = (profile: unknown): 'compact' | 'full' =>
  profile === 'compact' ? 'compact' : 'full';

// Initialize services (will be injected in main server)
let supabaseService: SupabaseService;
let cacheService: CacheService;

// Initialize function to be called from main server
export const initializeFlashcardRoutes = (supabase: SupabaseService, cache: CacheService) => {
  supabaseService = supabase;
  cacheService = cache;
};

// GET /api/v1/flashcards - Get flashcards (optionally filtered by deck)
router.get(
  '/',
  authMiddleware,
  validatePagination,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { page = 1, limit, deckId, responseProfile } = req.query;
    const profile = resolveResponseProfile(responseProfile);

    logger.debug('Fetching flashcards', { page, limit, deckId, userId, profile });

    const parsedPage = Math.max(1, parseInt(page as string, 10) || 1);
    const requestedLimit = parseInt((limit as string) || `${DEFAULT_FLASHCARD_PAGE_SIZE}`, 10);
    const parsedLimit = Math.min(MAX_FLASHCARD_PAGE_SIZE, Math.max(1, requestedLimit || DEFAULT_FLASHCARD_PAGE_SIZE));
    const cacheKey = `flashcards:${deckId || 'all'}:${userId}:${parsedPage}:${parsedLimit}:profile:${profile}`;
    let flashcards = await cacheService.get(cacheKey) as any[];

    if (!flashcards) {
      flashcards = await supabaseService.getFlashcards(userId, deckId as string, {
        page: parsedPage,
        limit: parsedLimit,
        responseProfile: profile,
      });

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
      responseProfile: profile,
    });
  })
);

// GET /api/v1/flashcards/:flashcardId - Get flashcard by ID
router.get(
  '/:flashcardId',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { flashcardId } = req.params;

    logger.debug('Fetching flashcard', { flashcardId, userId });

    const cacheKey = `flashcard:${flashcardId}`;
    let flashcard = await cacheService.get(cacheKey);

    if (!flashcard) {
      flashcard = await supabaseService.getFlashcardForUser(flashcardId, userId);

      if (!flashcard) {
        return res.status(404).json({
          success: false,
          error: 'Flashcard not found or access denied',
        });
      }

      // Cache for 10 minutes
      await cacheService.set(cacheKey, flashcard, 600);
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
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { flashcardId } = req.params;

    logger.debug('Fetching flashcard comments', { flashcardId, userId });

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
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { flashcardId } = req.params;
    const { comment } = req.body;

    logger.debug('Adding flashcard comment', { flashcardId, userId, comment: comment?.substring(0, 100) });

    if (!comment || !comment.trim()) {
      return res.status(400).json({ success: false, error: 'Comment text is required' });
    }

    const newComment = await supabaseService.addFlashcardComment(flashcardId, userId, comment.trim());

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
  validateFlashcardCreate,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { deckId, type, front, back, clozeText, imageUrl, occlusionData, tags } = req.body;

    logger.debug('Creating flashcard', { deckId, type, front: front?.substring(0, 50), imageUrl, userId });

    const flashcard = await supabaseService.createFlashcard({
      deckId,
      type: type || 'BASIC',
      front,
      back,
      clozeText,
      imageUrl,
      occlusionData,
      tags,
      userId,
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
  uploadBurstRateLimit,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { fileName, base64Data, contentType, folder } = req.body;

    if (!fileName || !base64Data) {
      return res.status(400).json({ success: false, error: 'fileName and base64Data are required' });
    }

    if (contentType && !ALLOWED_IMAGE_TYPES.includes(contentType)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.',
      });
    }

    try {
      const result = await supabaseService.uploadFlashcardImage({ fileName, base64Data, contentType, folder });
      res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error('Failed to upload flashcard image', { error, userId });
      res.status(500).json({ success: false, error: clientErrorMessage(error, 'Failed to upload image') });
    }
  })
);

// PUT /api/v1/flashcards/:flashcardId - Update flashcard
router.put(
  '/:flashcardId',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { flashcardId } = req.params;
    const { front, back, clozeText, imageUrl, occlusionData, srsData, tags } = req.body;

    logger.debug('Updating flashcard', { flashcardId, front: front?.substring(0, 50), imageUrl, srsData: !!srsData, userId });

    const updatedFlashcard = await supabaseService.updateFlashcard(flashcardId, {
      front,
      back,
      clozeText,
      imageUrl,
      occlusionData,
      srsData,
      tags,
    }, userId);

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
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { flashcardId } = req.params;

    logger.debug('Deleting flashcard', { flashcardId, userId });

    const deleted = await supabaseService.deleteFlashcard(flashcardId, userId);

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
