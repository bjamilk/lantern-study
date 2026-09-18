/**
 * Study set routes — the folders, sets, plans and covers behind the Study tab.
 *
 * Purpose
 * - A study set is the unit a student organises around: it owns a title, an
 *   optional course and folder, a tile (hue + glyph), a cover image, an exam
 *   date, a study plan and its topic statuses. This router is thin — the work
 *   lives in `services/studySets.ts` and the cover half in
 *   `services/data/coverImages.ts`.
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
 * - Four migrations here are applied by hand and the API runs on both sides of
 *   each: reads degrade past a missing tile column so a student still sees
 *   their sets, while a write that CHOSE a tile answers 503 rather than
 *   reporting success over a row that never changed. The practice-folder
 *   routes follow the same split — the list answers `supported: false` with a
 *   200 and every write answers 503 with `PRACTICE_FOLDER_MIGRATION`.
 * - The syllabus routes (20260918150000) follow it too, with one addition that
 *   matters: `POST /:setId/syllabus` is the only route in this API that spends
 *   an AI use BEFORE it stores anything, so its migration check is a
 *   MIDDLEWARE ordered above `aiRateLimitForFeature` rather than a check
 *   inside the handler. A student must not be one dropped refund away from
 *   paying for a 503.
 */
/**
 * /api/v1/users/me/study-sets — personal study sets on the Study tab.
 */
import { Router, type Response } from 'express';
import { SET_TILE_GLYPHS, SET_TILE_HUES } from '@lantern/shared/study/setPresentation';
import { body, param } from 'express-validator';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware, requirePermission } from '../middleware/auth';
import {
  aiRateLimitForFeature,
  applyGlobalUsageHeaders,
  refundFeatureAiCredit,
} from '../middleware/aiRateLimit';
import { handleValidationErrors } from '../middleware/validation';
import { requireAuthUserId } from '../utils/requestAuth';
import { PublicError, clientErrorMessage } from '../utils/safeError';
import { AuthenticatedRequest } from '../types';
import {
  COVER_IMAGE_MIGRATION,
  CoverColumnMissingError,
  CoverStorageUnavailableError,
} from '../services/data/coverImages';
import {
  PRACTICE_FOLDER_MIGRATION,
  PRACTICE_FOLDER_TITLE_MAX,
  PracticeFolderSchemaMissingError,
} from '../services/data/practiceFolders';
import type { DataLayer } from '../services/data';
import {
  SET_TILE_MIGRATION,
  STUDY_SET_SYLLABUS_MIGRATION,
  SetTileColumnMissingError,
  StudySetSyllabusMissingError,
  getStudySetsService,
} from '../services/studySets';
import { getStudySetPreAssessmentService } from '../services/studySetPreAssessment';
import {
  SyllabusGenerationFailedError,
  getStudySetSyllabusService,
} from '../services/studySetSyllabus';
import { SYLLABUS_UNSUPPORTED_MESSAGE } from '@lantern/shared/study/syllabusSummary';
import { hasPracticeFolders, hasStudySetSyllabus } from '../services/schemaCapabilities';
import { logger } from '../utils/logger';
import { uploadBurstRateLimit } from '../middleware/rateLimit';

const router = Router();
let dataLayer: DataLayer;


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

/**
 * A syllabus write that reached a database without 20260918150000.
 *
 * 503 with the filename rather than a 500 or a cheerful 200: the fix is a
 * hand-applied migration, not a client retry, and the operator reading the log
 * needs the name of the file to apply.
 */
const handleSyllabusError = (
  err: unknown,
  res: { status: (code: number) => { json: (body: unknown) => void } }
): boolean => {
  if (err instanceof StudySetSyllabusMissingError) {
    res.status(503).json({
      success: false,
      error: err.message,
      migration: STUDY_SET_SYLLABUS_MIGRATION,
    });
    return true;
  }
  return handlePublicError(err, res);
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
      await dataLayer.uploads.assertCoverColumn('study-set');
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

/**
 * "See what you already know" — the per-unit pre-assessment.
 *
 * WHAT IT COSTS AND WHY IT SAYS SO. One `generate_questions` AI credit, the
 * same as any other generation and against the same daily cap, because that is
 * exactly what it is: one call to the question generator. It is charged by the
 * middleware BEFORE this handler runs, so a RESUME — which does no AI work,
 * and is the common case, since `Continue` on a half-finished diagnostic must
 * reopen it rather than build a second — refunds the credit before answering.
 * The pattern is `POST /notes/:noteId/quiz`'s, deliberately: two ways of
 * refunding a reserved credit is how one of them goes stale.
 *
 * Idempotent: an unfinished diagnostic is returned as it stands, and a finished
 * one is only rebuilt when the client asks for a `retake`, which is the card's
 * own verb once it is finished.
 */
router.post(
  '/:setId/units/:unitId/pre-assessment',
  authMiddleware,
  requirePermission('ai'),
  aiRateLimitForFeature('generate_questions'),
  param('setId').isUUID(),
  param('unitId').isUUID(),
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await getStudySetPreAssessmentService(dataLayer).start(
        userId,
        String(req.params.setId),
        String(req.params.unitId),
        { retake: req.body?.retake === true }
      );
      // No AI work happened — give the reserved feature + global credits back.
      if (data.action === 'resumed') {
        await refundFeatureAiCredit(userId, 'generate_questions');
      }
      await applyGlobalUsageHeaders(res, userId);
      res.status(data.action === 'created' ? 201 : 200).json({ success: true, data });
    } catch (err) {
      // A refusal BEFORE the generator ran (a unit with no topics, a set that
      // is not the caller's) also did no AI work. Refunding here is what keeps
      // a student from paying for a 400.
      if (err instanceof PublicError) {
        await refundFeatureAiCredit(userId, 'generate_questions').catch(() => undefined);
      }
      if (handlePublicError(err, res)) return;
      throw err;
    }
  })
);

// ---------- Syllabus ("Sync with your class") -------------------------------
// 20260918150000 is hand-applied. The READ answers 200 with `supported: false`
// so a set room renders without the card rather than erroring; the WRITE
// answers 503 naming the file. See services/studySetSyllabus.ts for the credit
// rule — this is the only route in the app that spends an AI use before it
// stores anything, which is why the gate below sits ABOVE the meter.

/** `supported`, the linked note and the stored schedule. Charges nothing. */
router.get(
  '/:setId/syllabus',
  authMiddleware,
  validateStudySetId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await getStudySetsService(dataLayer).getSyllabus(
        userId,
        String(req.params.setId)
      );
      res.json({ success: true, data });
    } catch (err) {
      if (handleSyllabusError(err, res)) return;
      throw err;
    }
  })
);

/**
 * Refuse an unapplied migration BEFORE the AI meter runs.
 *
 * Written as its own middleware rather than a check at the top of the handler
 * because `aiRateLimitForFeature` charges on the way IN. A capability check
 * inside the handler would run after the credit was taken, and the refund path
 * for "the migration is not applied" would then depend on a catch block — a
 * student would be one dropped refund away from paying for a 503. Ordering the
 * gate first makes the charge impossible instead of recoverable.
 */
const requireSyllabusSchema = asyncHandler(
  async (req: AuthenticatedRequest, res: Response, next: (err?: unknown) => void) => {
    if (await hasStudySetSyllabus(dataLayer.getClient())) {
      next();
      return;
    }
    res.status(503).json({
      success: false,
      error: SYLLABUS_UNSUPPORTED_MESSAGE,
      migration: STUDY_SET_SYLLABUS_MIGRATION,
    });
  }
);

/**
 * Upload a syllabus: file in, schedule out. ONE AI use.
 *
 * base64 in the JSON body, not multipart — the shape every other document
 * upload in this API takes (`upload-pdf`, `extract-document-text`), so the
 * clients reuse their existing encode path and the body-size limits already
 * configured in server.ts apply unchanged.
 */
router.post(
  '/:setId/syllabus',
  authMiddleware,
  validateStudySetId,
  handleValidationErrors,
  uploadBurstRateLimit,
  requireSyllabusSchema,
  requirePermission('ai'),
  aiRateLimitForFeature('generate_questions'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const setId = String(req.params.setId);
    const { fileName, base64Data } = (req.body || {}) as Record<string, unknown>;
    if (!fileName || !base64Data) {
      // Refused before any AI work: give the reserved credit back.
      await refundFeatureAiCredit(userId, 'generate_questions').catch(() => undefined);
      res.status(400).json({ success: false, error: 'fileName and base64Data are required.' });
      return;
    }
    try {
      const data = await getStudySetSyllabusService(dataLayer).upload(userId, setId, {
        fileName: String(fileName),
        base64Data: String(base64Data),
      });
      await applyGlobalUsageHeaders(res, userId);
      res.status(201).json({ success: true, data });
    } catch (err) {
      // Both refund cases: a PublicError is a refusal BEFORE the model ran (bad
      // file, too big, no readable text), and SyllabusGenerationFailedError is
      // every provider exhausted — no answer came back. A model that ANSWERED
      // and found no schedule is not here: it is a 201 with `summary: null`,
      // and it is charged, because the work was done.
      if (err instanceof PublicError || err instanceof SyllabusGenerationFailedError) {
        await refundFeatureAiCredit(userId, 'generate_questions').catch(() => undefined);
      }
      if (err instanceof SyllabusGenerationFailedError) {
        res.status(503).json({ success: false, error: err.message });
        return;
      }
      if (handleSyllabusError(err, res)) return;
      throw err;
    }
  })
);

/** Undo: unlink the syllabus and delete the note it created. Charges nothing. */
router.delete(
  '/:setId/syllabus',
  authMiddleware,
  validateStudySetId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      await getStudySetSyllabusService(dataLayer).clear(userId, String(req.params.setId));
      res.json({ success: true });
    } catch (err) {
      if (handleSyllabusError(err, res)) return;
      throw err;
    }
  })
);

/**
 * Grade a finished pre-assessment onto the plan.
 *
 * Deliberately a SECOND call rather than a hook inside the tests submit path:
 * that path is shared by every test in the product and carries the coin award,
 * and threading a study-plan concern through it would put plan writes on the
 * money route. Nothing is charged here. Re-running it writes nothing new — the
 * mapping never moves a topic backwards, so the same session yields the same
 * statuses, which are already stored.
 */
router.post(
  '/:setId/units/:unitId/pre-assessment/results',
  authMiddleware,
  param('setId').isUUID(),
  param('unitId').isUUID(),
  body('testId').isUUID(),
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await getStudySetPreAssessmentService(dataLayer).applyResults(
        userId,
        String(req.params.setId),
        String(req.params.unitId),
        String(req.body?.testId)
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

// ---------------------------------------------------------------------------
// Practice folders
// ---------------------------------------------------------------------------
/**
 * Folders that hold ONE set's quizzes and tests (#130 follow-up).
 *
 * They live here rather than under `/tests` because a Practice folder is a
 * property of the SET, not of the account: `/users/me/study-sets/:setId/...`
 * puts the owner and the set in the path, so both halves of the ownership
 * predicate are required parameters of every query rather than something a
 * handler has to remember to add.
 *
 * Quizzes and tests are ONE table and the quiz/test split is derived on the
 * client, so one folder holds both doors and there is one set of routes, not
 * two.
 *
 * Migration tolerance: 20260918120000 is hand-applied. Until it lands, the
 * LIST answers `{ supported: false, folders: [] }` — a 200, because "this
 * database has no folders yet" is not an error the student can act on and the
 * hub simply draws what it drew before — while every WRITE answers 503 naming
 * the file, because reporting success over a row that never changed is worse
 * than refusing.
 */

/** A write that needs the hand-applied migration: 503, never 500. */
const handleSchemaMissing = (err: unknown, res: Response): boolean => {
  if (!(err instanceof PracticeFolderSchemaMissingError)) return false;
  res.status(503).json({ success: false, error: err.message, migration: PRACTICE_FOLDER_MIGRATION });
  return true;
};

/** Both refusals a practice-folder handler can answer, in one place. */
const handleFolderError = (err: unknown, res: Response): boolean =>
  handleSchemaMissing(err, res) || handlePublicError(err, res);

export const validatePracticeFolderCreate = [
  param('setId').isUUID().withMessage('setId must be a valid UUID'),
  body('title')
    .isString()
    .isLength({ min: 1, max: PRACTICE_FOLDER_TITLE_MAX })
    .withMessage(`title must be 1-${PRACTICE_FOLDER_TITLE_MAX} characters`),
];

export const validatePracticeFolderId = [
  param('setId').isUUID().withMessage('setId must be a valid UUID'),
  param('folderId').isUUID().withMessage('folderId must be a valid UUID'),
];

export const validatePracticeItemMove = [
  param('setId').isUUID().withMessage('setId must be a valid UUID'),
  param('testId').isUUID().withMessage('testId must be a valid UUID'),
  // `optional({ values: 'null' })` is the "send null to clear this" idiom: null
  // is how the hub unfiles an item ("Move out"), and it is the ONLY non-uuid
  // value accepted.
  body('practiceFolderId')
    .optional({ values: 'null' })
    .isUUID()
    .withMessage('practiceFolderId must be a valid UUID or null'),
];

router.get(
  '/:setId/practice-folders',
  authMiddleware,
  validateStudySetId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const setId = String(req.params.setId);
    const folders = await dataLayer.practiceFolders.listPracticeFolders(userId, setId);
    const counts = await dataLayer.practiceFolders.countPracticeFolderItems(userId, setId);
    // `supported` is a FIELD, not an inference from an empty list: "no folders
    // yet" must still offer a Create folder card, and "no column yet" must not.
    const supported = await hasPracticeFolders(dataLayer.getClient());
    res.json({
      success: true,
      data: {
        supported,
        folders: folders.map((folder) => ({ ...folder, itemCount: counts[folder.id] ?? 0 })),
      },
    });
  })
);

router.post(
  '/:setId/practice-folders',
  authMiddleware,
  validatePracticeFolderCreate,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await dataLayer.practiceFolders.createPracticeFolder(
        userId,
        String(req.params.setId),
        req.body || {},
      );
      res.status(201).json({ success: true, data: { ...data, itemCount: 0 } });
    } catch (err) {
      if (handleFolderError(err, res)) return;
      throw err;
    }
  })
);

router.patch(
  '/:setId/practice-folders/:folderId',
  authMiddleware,
  validatePracticeFolderId,
  body('title')
    .isString()
    .isLength({ min: 1, max: PRACTICE_FOLDER_TITLE_MAX })
    .withMessage(`title must be 1-${PRACTICE_FOLDER_TITLE_MAX} characters`),
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const setId = String(req.params.setId);
    try {
      const data = await dataLayer.practiceFolders.renamePracticeFolder(
        userId,
        setId,
        String(req.params.folderId),
        req.body || {},
      );
      // 404, not 403: a folder this account does not own, one in another set
      // and one that does not exist are the same answer, so the response
      // cannot be used to confirm that an id exists.
      if (!data) {
        res.status(404).json({ success: false, error: 'Folder not found' });
        return;
      }
      const counts = await dataLayer.practiceFolders.countPracticeFolderItems(userId, setId);
      res.json({ success: true, data: { ...data, itemCount: counts[data.id] ?? 0 } });
    } catch (err) {
      if (handleFolderError(err, res)) return;
      throw err;
    }
  })
);

router.delete(
  '/:setId/practice-folders/:folderId',
  authMiddleware,
  validatePracticeFolderId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      // The folder's quizzes and tests are KEPT: the column is
      // ON DELETE SET NULL, so they are unfiled by the same statement.
      const removed = await dataLayer.practiceFolders.deletePracticeFolder(
        userId,
        String(req.params.setId),
        String(req.params.folderId),
      );
      if (!removed) {
        res.status(404).json({ success: false, error: 'Folder not found' });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      if (handleFolderError(err, res)) return;
      throw err;
    }
  })
);

router.patch(
  '/:setId/practice-items/:testId',
  authMiddleware,
  validatePracticeItemMove,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const setId = String(req.params.setId);
    const testId = String(req.params.testId);
    const raw = (req.body || {}).practiceFolderId;
    const folderId = raw === undefined || raw === null ? null : String(raw);
    try {
      // TWO checks, and both are needed. This one proves the DESTINATION is
      // this owner's folder in THIS set — without it an owner could file their
      // own quiz into somebody else's folder, or into a folder of a set they
      // are not in. The update below proves the TEST is this owner's.
      if (folderId) {
        const belongs = await dataLayer.practiceFolders.practiceFolderBelongsToSet(
          userId,
          setId,
          folderId,
        );
        if (!belongs) {
          res.status(404).json({ success: false, error: 'Folder not found' });
          return;
        }
      }
      const moved = await dataLayer.practiceFolders.setTestPracticeFolder(userId, testId, folderId);
      if (!moved) {
        res.status(404).json({ success: false, error: 'Test not found' });
        return;
      }
      res.json({ success: true, data: { id: testId, practiceFolderId: folderId } });
    } catch (err) {
      if (handleFolderError(err, res)) return;
      throw err;
    }
  })
);

export default router;
