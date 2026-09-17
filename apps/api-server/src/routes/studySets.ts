/**
 * Study set routes — the folders, sets, plans and covers behind the Study tab.
 *
 * Purpose
 * - A study set is the unit a student organises around: it owns a title, an
 *   optional course and folder, a tile (hue + glyph), a cover image, an exam
 *   date, a study plan and its topic statuses. This router is thin — the work
 *   lives in `services/studySets.ts` and the cover half in
 *   `services/supabase.ts`.
 *
 * Exports
 * - Default router, `initializeStudySetRoutes(supabase)`, the three validator
 *   chains (`validateStudySetCreate` / `Patch` / `Id`) and
 *   `MAX_STUDY_SET_COVER_BYTES`, which the clients import so the limit printed
 *   under the upload button is the limit the server enforces.
 *
 * Mount path
 * - `/api/v1/users/me/study-sets`. The `me` in the path is literal: there is no
 *   route here that reads another account's sets.
 *
 * Auth mode
 * - `authMiddleware` on every route, declared per route rather than as
 *   `router.use`. There is no public, optional-auth or admin surface.
 *
 * Rate-limit tier
 * - `authenticatedRateLimit` from `authMiddleware` for everything, plus
 *   `uploadBurstRateLimit` on `POST /:setId/cover`.
 *
 * Ownership predicate
 * - Every call is scoped by `user_id`. `requireAuthUserId(req, res)` takes the
 *   id from the verified token, and that id is the first argument to every
 *   service method and the WHERE clause of every cover write. Nothing here
 *   trusts an id from the body or the query, and RLS is not relied on: the
 *   service-role client bypasses it.
 *
 * Error-mapping convention
 * - `PublicError` from the service is a 400 (`handlePublicError`), including
 *   "Study set not found" for a set this account does not own — a 404 there
 *   would confirm the row exists.
 * - `CoverColumnMissingError` / `SetTileColumnMissingError` are 503 carrying the
 *   migration filename, because the fix is a hand-applied migration, not a
 *   client retry.
 * - `CoverStorageUnavailableError` is 503 with a `detail`; anything else is a
 *   500 through `clientErrorMessage`, which strips internals.
 *
 * What it touches
 * - Supabase tables behind `getStudySetsService` (study sets, folders, plans,
 *   topic statuses) and the `cover-images` storage bucket via
 *   `uploadCoverImage` / `deleteCoverObject`.
 *
 * Migration tolerance
 * - Two migrations here are applied by hand and the API runs on both sides of
 *   each: reads degrade past a missing tile column so a student still sees
 *   their sets, while a write that CHOSE a tile answers 503 rather than
 *   reporting success over a row that never changed.
 */
/**
 * /api/v1/users/me/study-sets — personal study sets on the Study tab.
 */
import { Router, type Response } from 'express';
import { SET_TILE_GLYPHS, SET_TILE_HUES } from '@lantern/shared/study/setPresentation';
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
} from '../services/supabase';
import type { SupabaseService } from '../services/supabase';
import type { DataLayer } from '../services/data';
import {
  SET_TILE_MIGRATION,
  SetTileColumnMissingError,
  getStudySetsService,
} from '../services/studySets';
import { logger } from '../utils/logger';
import { uploadBurstRateLimit } from '../middleware/rateLimit';

const router = Router();
let dataLayer: DataLayer;

// TRANSITIONAL (M2a): the services called below still take the `SupabaseService`
// facade whole, so a flipped route hands them `data.legacyService`. The seam
// disappears when the `services/` importers are flipped.
// `dataLayer?` because a route module can be imported before its injector
// runs (several suites drive a handler without calling it), exactly as the
// old module-level `supabaseService` read as undefined there.
const legacyService = () => dataLayer?.legacyService as SupabaseService;

export const initializeStudySetRoutes = (layer: DataLayer) => {
  dataLayer = layer;
};

const handlePublicError = (err: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }): boolean => {
  if (err instanceof PublicError) {
    res.status(400).json({ success: false, error: err.message });
    return true;
  }
  return false;
};

// ---------------------------------------------------------------------------
// Validator chains
// ---------------------------------------------------------------------------
// `optional({ values: 'null' })` is the "send null to clear this" idiom: the
// field may be absent, or explicitly null, but not an arbitrary type.

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
  // The tile pick. Unlike `coverPath` this IS accepted through the generic
  // patch: a hue is one of six words, not a pointer at a storage object, so
  // there is nothing here for an owner to aim at someone else's data. `null`
  // resets that half to the derivation.
  body('tileHue')
    .optional({ values: 'null' })
    .isIn([...SET_TILE_HUES])
    .withMessage(`tileHue must be one of ${SET_TILE_HUES.join(', ')} or null`),
  body('tileGlyph')
    .optional({ values: 'null' })
    .isIn([...SET_TILE_GLYPHS])
    .withMessage(`tileGlyph must be one of ${SET_TILE_GLYPHS.join(', ')} or null`),
  body('examDate')
    .optional({ values: 'null' })
    .matches(/^\d{4}-\d{2}-\d{2}$/)
    .withMessage('examDate must be YYYY-MM-DD or null'),
];

export const validateStudySetId = [param('setId').isUUID().withMessage('setId must be a valid UUID')];

// ---------------------------------------------------------------------------
// Sets and folders — list, resume, create, read, patch, delete
// ---------------------------------------------------------------------------

router.get(
  '/',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const data = await getStudySetsService(dataLayer).list(userId);
    res.json({ success: true, data });
  })
);

router.get(
  '/resume',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const data = await getStudySetsService(dataLayer).resume(userId);
    res.json({ success: true, data });
  })
);

router.get(
  '/folders',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const data = await getStudySetsService(dataLayer).listFolders(userId);
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
      const data = await getStudySetsService(dataLayer).createFolder(userId, req.body || {});
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
      await getStudySetsService(dataLayer).removeFolder(userId, String(req.params.folderId));
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
      const data = await getStudySetsService(dataLayer).create(userId, req.body || {});
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
      const data = await getStudySetsService(dataLayer).get(userId, String(req.params.setId));
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
      const data = await getStudySetsService(dataLayer).update(userId, setId, patch);
      if (coverPath === null) {
        const { previousPath } = await dataLayer.uploads.setStudySetCoverPath(setId, userId, null);
        await dataLayer.uploads.deleteCoverObject(previousPath);
        (data as { coverPath?: string | null }).coverPath = null;
      }
      res.json({ success: true, data });
    } catch (err) {
      if (err instanceof CoverColumnMissingError) {
        res.status(503).json({ success: false, error: err.message, migration: COVER_IMAGE_MIGRATION });
        return;
      }
      // Never 200 for a dropped tile. The set list degrades past a missing
      // tile column so a student can still see their sets; a PATCH that CHOSE
      // a tile has to say the pick did not land, or the screen reports success
      // over a row that never changed.
      if (err instanceof SetTileColumnMissingError) {
        logger.warn('study set tile column missing', {
          setId, userId, migration: SET_TILE_MIGRATION,
        });
        res.status(503).json({ success: false, error: err.message, migration: SET_TILE_MIGRATION });
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
      await getStudySetsService(dataLayer).get(userId, setId);
      // Probe the COLUMN before storing bytes: on a database without the
      // migration this answers 503 without ever leaving an orphan object.
      await legacyService().assertCoverColumn?.('study-set');
      uploaded = await dataLayer.uploads.uploadCoverImage({
        userId,
        kind: 'study-set',
        id: setId,
        fileName,
        base64Data,
        contentType: normalizedType,
      });
      const { previousPath } = await dataLayer.uploads.setStudySetCoverPath(
        setId,
        userId,
        uploaded.path
      );
      await dataLayer.uploads.deleteCoverObject(previousPath);
      res.status(201).json({
        success: true,
        data: { coverPath: uploaded.path, coverUrl: uploaded.url, coverThumbUrl: uploaded.thumbUrl },
      });
    } catch (error: unknown) {
      if (uploaded) await dataLayer.uploads.deleteCoverObject(uploaded.path);
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
      const { previousPath } = await dataLayer.uploads.setStudySetCoverPath(setId, userId, null);
      await dataLayer.uploads.deleteCoverObject(previousPath);
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

// ---------------------------------------------------------------------------
// Study plan, topic status and recency
// ---------------------------------------------------------------------------
// `touch` records that the set was studied (it drives `GET /resume`); the plan
// routes replace the whole plan rather than patching it, and topic status moves
// through the fixed unseen -> covered -> mastered vocabulary.

router.post(
  '/:setId/touch',
  authMiddleware,
  validateStudySetId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await getStudySetsService(dataLayer).touchStudied(userId, String(req.params.setId));
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
      const data = await getStudySetsService(dataLayer).getPlan(userId, String(req.params.setId));
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
      const data = await getStudySetsService(dataLayer).replacePlan(
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
      const data = await getStudySetsService(dataLayer).updateTopicStatus(
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
      await getStudySetsService(dataLayer).remove(userId, String(req.params.setId));
      res.json({ success: true });
    } catch (err) {
      if (handlePublicError(err, res)) return;
      throw err;
    }
  })
);

export default router;
