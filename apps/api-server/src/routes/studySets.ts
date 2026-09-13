/**
 * /api/v1/users/me/study-sets — personal study sets on the Study tab.
 */
import { Router, type Response } from 'express';
import { body, param } from 'express-validator';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { handleValidationErrors } from '../middleware/validation';
import { requireAuthUserId } from '../utils/requestAuth';
import { PublicError, clientErrorMessage } from '../utils/safeError';
import { AuthenticatedRequest } from '../types';
import {
  COVER_IMAGE_MIGRATION,
  CoverColumnMissingError,
  CoverStorageUnavailableError,
  SupabaseService,
} from '../services/supabase';
import { getStudySetsService } from '../services/studySets';
import { logger } from '../utils/logger';
import { uploadBurstRateLimit } from '../middleware/rateLimit';

const router = Router();
let supabaseService: SupabaseService;

export const initializeStudySetRoutes = (supabase: SupabaseService) => {
  supabaseService = supabase;
};

const handlePublicError = (err: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }): boolean => {
  if (err instanceof PublicError) {
    res.status(400).json({ success: false, error: err.message });
    return true;
  }
  return false;
};

export const validateStudySetCreate = [
  body('title').isString().isLength({ min: 1, max: 80 }).withMessage('title must be 1-80 characters'),
  body('description').optional({ values: 'null' }).isString().isLength({ max: 280 }),
  body('courseId').optional({ values: 'null' }).isUUID().withMessage('courseId must be a valid UUID'),
  body('folderId').optional({ values: 'null' }).isUUID().withMessage('folderId must be a valid UUID'),
];

export const validateStudySetPatch = [
  param('setId').isUUID().withMessage('setId must be a valid UUID'),
  body('title').optional().isString().isLength({ min: 1, max: 80 }).withMessage('title must be 1-80 characters'),
  body('description').optional({ values: 'null' }).isString().isLength({ max: 280 }),
  body('courseId').optional({ values: 'null' }).isUUID().withMessage('courseId must be a valid UUID'),
  body('folderId').optional({ values: 'null' }).isUUID().withMessage('folderId must be a valid UUID'),
  body('visibility').optional().isIn(['private', 'public']),
  body('mode').optional().isIn(['cram', 'standard', 'comprehensive']),
  body('coverPath').optional({ values: 'null' }).isString(),
  body('examDate')
    .optional({ values: 'null' })
    .matches(/^\d{4}-\d{2}-\d{2}$/)
    .withMessage('examDate must be YYYY-MM-DD or null'),
];

export const validateStudySetId = [param('setId').isUUID().withMessage('setId must be a valid UUID')];

router.get(
  '/',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const data = await getStudySetsService(supabaseService).list(userId);
    res.json({ success: true, data });
  })
);

router.get(
  '/resume',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const data = await getStudySetsService(supabaseService).resume(userId);
    res.json({ success: true, data });
  })
);

router.get(
  '/folders',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const data = await getStudySetsService(supabaseService).listFolders(userId);
    res.json({ success: true, data });
  })
);

router.post(
  '/folders',
  authMiddleware,
  body('title').isString().isLength({ min: 1, max: 80 }),
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await getStudySetsService(supabaseService).createFolder(userId, req.body || {});
      res.status(201).json({ success: true, data });
    } catch (err) {
      if (handlePublicError(err, res)) return;
      throw err;
    }
  })
);

router.delete(
  '/folders/:folderId',
  authMiddleware,
  param('folderId').isUUID(),
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      await getStudySetsService(supabaseService).removeFolder(userId, String(req.params.folderId));
      res.json({ success: true });
    } catch (err) {
      if (handlePublicError(err, res)) return;
      throw err;
    }
  })
);

router.post(
  '/',
  authMiddleware,
  validateStudySetCreate,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await getStudySetsService(supabaseService).create(userId, req.body || {});
      res.status(201).json({ success: true, data });
    } catch (err) {
      if (handlePublicError(err, res)) return;
      throw err;
    }
  })
);

router.get(
  '/:setId',
  authMiddleware,
  validateStudySetId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await getStudySetsService(supabaseService).get(userId, String(req.params.setId));
      res.json({ success: true, data });
    } catch (err) {
      if (handlePublicError(err, res)) return;
      throw err;
    }
  })
);

router.patch(
  '/:setId',
  authMiddleware,
  validateStudySetPatch,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const setId = String(req.params.setId);
    const body = (req.body || {}) as Record<string, unknown>;
    // Only CLEARING is accepted through the generic patch. A cover is SET by
    // POST /:setId/cover, which uploads the object itself — accepting an
    // arbitrary `coverPath` string here would let any owner point their set at
    // a storage object belonging to someone else.
    const { coverPath, ...patch } = body;
    try {
      const data = await getStudySetsService(supabaseService).update(userId, setId, patch);
      if (coverPath === null) {
        const { previousPath } = await supabaseService.setStudySetCoverPath(setId, userId, null);
        await supabaseService.deleteCoverObject(previousPath);
        (data as { coverPath?: string | null }).coverPath = null;
      }
      res.json({ success: true, data });
    } catch (err) {
      if (err instanceof CoverColumnMissingError) {
        res.status(503).json({ success: false, error: err.message, migration: COVER_IMAGE_MIGRATION });
        return;
      }
      if (handlePublicError(err, res)) return;
      throw err;
    }
  })
);

// ---------- Study set cover image ----------
// StudyFetch gives the picture to the SET, not to the deck or the note: it is
// the chip in every room header and the thumbnail in every switcher row. The
// stored value is the storage PATH — a signed URL would be a broken image in
// 24h — and clients re-sign through POST /api/v1/storage/signed-urls.

const ALLOWED_COVER_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
/**
 * 5 MB, not the 10 MB decks and notes take.
 *
 * This is StudyFetch's own copy for this block — "Recommended: 400x400px, max
 * 5MB" — and the number a student reads under the button has to be the number
 * the server enforces, or the limit is a lie in one direction or the other.
 */
export const MAX_STUDY_SET_COVER_BYTES = 5 * 1024 * 1024;

router.post(
  '/:setId/cover',
  authMiddleware,
  validateStudySetId,
  handleValidationErrors,
  uploadBurstRateLimit,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const setId = String(req.params.setId);
    const { base64Data, fileName, contentType } = (req.body || {}) as Record<string, string>;

    if (!base64Data || !fileName) {
      res.status(400).json({ success: false, error: 'fileName and base64Data are required' });
      return;
    }
    const normalizedType = typeof contentType === 'string' ? contentType.toLowerCase() : '';
    if (!ALLOWED_COVER_TYPES.includes(normalizedType)) {
      res.status(400).json({
        success: false,
        error: 'contentType is required. Only JPEG, PNG, GIF, and WebP are allowed.',
      });
      return;
    }
    const estimatedBytes = Math.ceil((base64Data.length * 3) / 4);
    if (estimatedBytes > MAX_STUDY_SET_COVER_BYTES) {
      res.status(400).json({ success: false, error: 'Image exceeds 5 MB limit' });
      return;
    }

    // Ownership is the write's own WHERE clause: `setStudySetCoverPath` scopes
    // by user_id and reports "not found" as a 404 below, so someone else's set
    // can never be pointed at an object this account uploaded.
    let uploaded: { path: string; url: string; thumbUrl: string | null } | undefined;
    try {
      // Throws a PublicError ("Study set not found") for a set this account
      // does not own — answered below before a byte is stored.
      await getStudySetsService(supabaseService).get(userId, setId);
      // Probe the COLUMN before storing bytes: on a database without the
      // migration this answers 503 without ever leaving an orphan object.
      await supabaseService.assertCoverColumn?.('study-set');
      uploaded = await supabaseService.uploadCoverImage({
        userId,
        kind: 'study-set',
        id: setId,
        fileName,
        base64Data,
        contentType: normalizedType,
      });
      const { previousPath } = await supabaseService.setStudySetCoverPath(
        setId,
        userId,
        uploaded.path
      );
      await supabaseService.deleteCoverObject(previousPath);
      res.status(201).json({
        success: true,
        data: { coverPath: uploaded.path, coverUrl: uploaded.url, coverThumbUrl: uploaded.thumbUrl },
      });
    } catch (error: unknown) {
      if (uploaded) await supabaseService.deleteCoverObject(uploaded.path);
      if (error instanceof CoverColumnMissingError) {
        logger.error('[cover] set cover refused: column missing', {
          kind: 'study-set', setId, userId, migration: COVER_IMAGE_MIGRATION,
        });
        res.status(503).json({ success: false, error: error.message, migration: COVER_IMAGE_MIGRATION });
        return;
      }
      if (error instanceof CoverStorageUnavailableError) {
        logger.error('[cover] set cover failed: storage', {
          kind: 'study-set', setId, userId, detail: error.detail,
        });
        res.status(503).json({ success: false, error: error.message, detail: error.detail });
        return;
      }
      if (handlePublicError(error, res)) return;
      logger.error('[cover] set cover failed', { kind: 'study-set', setId, userId, error });
      res
        .status(500)
        .json({ success: false, error: clientErrorMessage(error, 'Failed to set cover image') });
    }
  })
);

router.delete(
  '/:setId/cover',
  authMiddleware,
  validateStudySetId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const setId = String(req.params.setId);
    try {
      const { previousPath } = await supabaseService.setStudySetCoverPath(setId, userId, null);
      await supabaseService.deleteCoverObject(previousPath);
      res.json({ success: true, data: { coverPath: null } });
    } catch (error: unknown) {
      if (error instanceof CoverColumnMissingError) {
        logger.error('[cover] clear cover refused: column missing', {
          kind: 'study-set', setId, userId, migration: COVER_IMAGE_MIGRATION,
        });
        res.status(503).json({ success: false, error: error.message, migration: COVER_IMAGE_MIGRATION });
        return;
      }
      logger.error('[cover] clear cover failed', { kind: 'study-set', setId, userId, error });
      res
        .status(500)
        .json({ success: false, error: clientErrorMessage(error, 'Failed to clear cover image') });
    }
  })
);

router.post(
  '/:setId/touch',
  authMiddleware,
  validateStudySetId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await getStudySetsService(supabaseService).touchStudied(userId, String(req.params.setId));
      res.json({ success: true, data });
    } catch (err) {
      if (handlePublicError(err, res)) return;
      throw err;
    }
  })
);

router.get(
  '/:setId/plan',
  authMiddleware,
  validateStudySetId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await getStudySetsService(supabaseService).getPlan(userId, String(req.params.setId));
      res.json({ success: true, data });
    } catch (err) {
      if (handlePublicError(err, res)) return;
      throw err;
    }
  })
);

router.put(
  '/:setId/plan',
  authMiddleware,
  validateStudySetId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await getStudySetsService(supabaseService).replacePlan(
        userId,
        String(req.params.setId),
        req.body || {}
      );
      res.json({ success: true, data });
    } catch (err) {
      if (handlePublicError(err, res)) return;
      throw err;
    }
  })
);

router.patch(
  '/:setId/topics/:topicId',
  authMiddleware,
  param('setId').isUUID(),
  param('topicId').isUUID(),
  body('status').isIn(['unseen', 'covered', 'mastered']),
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await getStudySetsService(supabaseService).updateTopicStatus(
        userId,
        String(req.params.setId),
        String(req.params.topicId),
        req.body?.status
      );
      res.json({ success: true, data });
    } catch (err) {
      if (handlePublicError(err, res)) return;
      throw err;
    }
  })
);

router.delete(
  '/:setId',
  authMiddleware,
  validateStudySetId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      await getStudySetsService(supabaseService).remove(userId, String(req.params.setId));
      res.json({ success: true });
    } catch (err) {
      if (handlePublicError(err, res)) return;
      throw err;
    }
  })
);

export default router;
