/**
 * Flashcard deck routes — CRUD, collaborators, covers, import and export.
 *
 * Purpose
 * - Owns the deck as an object: listing and paging a student's decks, creating
 *   one (optionally with its cards in a single atomic call), editing it,
 *   sharing it with collaborators, giving it a cover, and moving it in and out
 *   of the product via CSV, Anki `.apkg` and the native JSON format. The cards
 *   themselves belong to `routes/flashcards.ts`.
 *
 * Exports
 * - Default router and `initializeDeckRoutes(supabase, cache)`, called from
 *   `server.ts` at boot to inject the Supabase and cache services.
 *
 * Mount path
 * - `/api/v1/decks`.
 *
 * Auth mode
 * - `authMiddleware` on every route; no public or optional-auth surface, no
 *   admin gate.
 *
 * Rate-limit tier
 * - `authenticatedRateLimit` from `authMiddleware` throughout, plus
 *   `uploadBurstRateLimit` on `POST /:deckId/cover` and `POST /import/apkg`.
 *
 * Ownership predicate
 * - `requireDeckAccess('deckId', <level>)` from `middleware/authorizeResource`,
 *   with three levels: `read` for reads and exports, `edit` for updates,
 *   collaborator changes and stat resets, `owner` for delete and cover writes.
 *   Routes without a `:deckId` (list, create, imports) scope by the token's
 *   user id instead, and the service layer re-checks with
 *   `verifyDeckAccess(userId, deckId, level)` on the write itself — the
 *   middleware is not the only gate, because the service-role client bypasses
 *   RLS.
 *
 * Error-mapping convention
 * - 404 `'Deck not found or access denied'` is the single answer for both an
 *   unknown deck and one the caller may not touch, so neither reveals the
 *   other. `PublicError` (a rejected course or topic) maps to 400 via
 *   `respondPublicError`. `DeckWithCardsError` is a 500 carrying `rolledBack`.
 *   `'Access denied'` thrown from the collaborator service becomes a 403.
 *
 * Caching
 * - The list is cached in Redis for 300 s under
 *   `decks:<userId>:scope:<owned|owned_collab>:<page>:<limit>:profile:<p>:course:<c>:topic:<t>:v2`.
 *   Every mutation invalidates three key shapes — `decks:user:<id>`,
 *   `decks:user:<id>*` and `decks:<id>*` — because the legacy `decks:user:`
 *   patterns do not match the key the list actually writes.
 *
 * What it touches
 * - Supabase tables `decks`, `flashcards` and `deck_collaborators` (plus the
 *   `create_deck_with_cards` RPC), the `cover-images` storage bucket, Redis
 *   through `CacheService` and the idempotency middleware, the BullMQ path via
 *   `runSyncOrEnqueue` for `.apkg` import, and the activity feed.
 */
import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { handleValidationErrors, validatePagination, validateDeckId, validateDeckCreate, validateDeckWithCardsTarget, validateDeckUpdate } from '../middleware/validation';
import { requireAuthUserId } from '../utils/requestAuth';
import { runSyncOrEnqueue } from '../queue/enqueue';
import { sendAsyncJobAccepted } from '../queue/respondAsync';
import { requireDeckAccess } from '../middleware/authorizeResource';
import { uploadBurstRateLimit } from '../middleware/rateLimit';
import { idempotencyMiddleware, type IdempotentRequest } from '../middleware/idempotency';
import { DeckWithCardsError, validateDeckCards } from '../services/deckWithCards';
import { SupabaseService } from '../services/supabase';
import { CacheService } from '../services/cache';
import { logger } from '../utils/logger';
import {
  COURSE_FILTER_INVALID_MESSAGE,
  TOPIC_FILTER_INVALID_MESSAGE,
  courseFilterKey,
  parseCourseFilter,
  parseTopicFilter,
} from '../services/academicCourses';
import { clientErrorMessage, PublicError } from '../utils/safeError';
import {
  COVER_IMAGE_MIGRATION,
  CoverColumnMissingError,
  CoverStorageUnavailableError,
} from '../services/supabase';

const router = Router();
const DEFAULT_DECK_PAGE_SIZE = 20;
const MAX_DECK_PAGE_SIZE = 50;
const resolveResponseProfile = (profile: unknown): 'compact' | 'full' =>
  profile === 'compact' ? 'compact' : 'full';

/**
 * The deck a with-cards save named is gone, or the caller may not edit it.
 * Kept distinct so it answers 404 like every other deck route instead of the
 * 400 a PublicError would give.
 */
class DeckTargetMissingError extends Error {
  constructor() {
    super('Deck not found or access denied');
    this.name = 'DeckTargetMissingError';
  }
}

/** A rejected topic (wrong course, no course, unusable id) is the caller's mistake — 400, not 500. */
const respondPublicError = (err: unknown, res: any): boolean => {
  if (!(err instanceof PublicError)) return false;
  res.status(400).json({ success: false, error: err.message });
  return true;
};

let supabaseService: SupabaseService;
let cacheService: CacheService;

export const initializeDeckRoutes = (supabase: SupabaseService, cache: CacheService) => {
  supabaseService = supabase;
  cacheService = cache;
};

// ---------------------------------------------------------------------------
// Deck CRUD
// ---------------------------------------------------------------------------

router.get(
  '/',
  authMiddleware,
  validatePagination,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { page = 1, limit, includeShared, responseProfile, courseId, topicId } = req.query;
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
    // ?topicId= — same grammar one level down; "null" is "in this course, under no topic".
    const topicFilter = parseTopicFilter(topicId);
    if (topicFilter.kind === 'invalid') {
      return res.status(400).json({ success: false, error: TOPIC_FILTER_INVALID_MESSAGE });
    }
    const courseKey = courseFilterKey(courseFilter);
    const topicKey = courseFilterKey(topicFilter);

    logger.debug('Fetching decks', { page: parsedPage, limit: parsedLimit, userId, includeShared: includeSharedFlag, profile, courseId: courseKey, topicId: topicKey });

    // v2 busts caches that previously listed every globally shared deck.
    const cacheKey = `decks:${userId}:scope:${includeSharedFlag ? "owned_collab" : "owned"}:${parsedPage}:${parsedLimit}:profile:${profile}:course:${courseKey}:topic:${topicKey}:v2`;
    let decks = await cacheService.get(cacheKey) as any[];

    if (!decks) {
      decks = await supabaseService.getDecks(userId, includeSharedFlag, {
        page: parsedPage,
        limit: parsedLimit,
        responseProfile: profile,
        courseFilter,
        topicFilter,
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

    const { name, description, isShared, courseId, studySetId, topicId } = req.body;
    let deck;
    try {
      deck = await supabaseService.createDeck({ name, description, isShared, courseId, studySetId, topicId }, userId);
    } catch (err) {
      if (respondPublicError(err, res)) return;
      throw err;
    }

    await cacheService.delete(`decks:user:${userId}`);
    await cacheService.deletePattern(`decks:user:${userId}*`);
    // The list above caches under `decks:<userId>:scope:...`, which the
    // `decks:user:<userId>` patterns never match — without this the deck list
    // stays stale for the full 300s TTL.
    await cacheService.deletePattern(`decks:${userId}*`);

    res.status(201).json({ success: true, data: deck });
  })
);

/**
 * POST /api/v1/decks/with-cards — create a deck and its cards atomically.
 *
 * Replaces the two-call generate flow (create deck, then push cards) that left
 * an empty "0 cards" deck behind whenever the client died in between. The
 * service either commits both (create_deck_with_cards RPC) or removes the deck
 * it just wrote, so an error here always means nothing was saved.
 *
 * Retries are safe: an `Idempotency-Key` header — or `clientKey`, or the
 * generating `source.jobId` — replays the FIRST response instead of creating a
 * second deck.
 *
 * A body carrying `deckId` targets a deck the student already has: the cards
 * are appended to it and that same deck comes back. No deck row is written on
 * that path, so the single card insert is the whole transaction.
 */
router.post(
  '/with-cards',
  authMiddleware,
  idempotencyMiddleware({
    operation: 'deck_create_with_cards',
    // A generate job is already a unique id; using it means a client that
    // never set a header still cannot double-create by retrying.
    fallbackKey: (req: any) =>
      (typeof req.body?.clientKey === 'string' && req.body.clientKey) ||
      (typeof req.body?.source?.jobId === 'string' && `job:${req.body.source.jobId}`) ||
      null,
  }),
  validateDeckCreate,
  validateDeckWithCardsTarget,
  handleValidationErrors,
  asyncHandler(async (req: IdempotentRequest & any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { name, description, isShared, courseId, studySetId, topicId, cards, source, deckId } = req.body;

    // Generation opened from inside a deck sends that deck's id: the cards go
    // there. Without this the server made a SECOND deck with the same name
    // while the client filed the cards under the original — a duplicate deck
    // and an original still missing its cards.
    const targetDeckId = typeof deckId === 'string' && deckId.trim() ? deckId.trim() : null;

    const validation = validateDeckCards(cards);
    if (!validation.ok) {
      const { code, message, index, field } = validation.rejection;
      return res.status(400).json({
        success: false,
        code,
        error: message,
        // A rejected payload never becomes valid on its own — a client queue
        // must drop it rather than retry forever.
        retryable: false,
        ...(index !== undefined ? { cardIndex: index } : {}),
        ...(field ? { field } : {}),
      });
    }

    const run = req.runIdempotent || ((handler: () => Promise<any>) => handler());

    let payload: any;
    try {
      payload = await run(async () => {
        const result = targetDeckId
          ? await supabaseService.addCardsToExistingDeck(targetDeckId, validation.cards, userId)
          : await supabaseService.createDeckWithCards(
              { name, description, isShared, courseId, studySetId, topicId },
              validation.cards,
              userId,
            );
        if (!result) {
          // Only the existing-deck path can miss: unknown deck or no edit
          // rights, answered the same way so neither reveals the other.
          throw new DeckTargetMissingError();
        }
        return {
          deck: result.deck,
          flashcards: result.flashcards,
          cardCount: result.flashcards.length,
          atomic: result.atomic,
          source: source && typeof source === 'object' ? source : undefined,
        };
      });
    } catch (err) {
      if (err instanceof DeckTargetMissingError) {
        return res.status(404).json({ success: false, error: err.message, retryable: false });
      }
      if (respondPublicError(err, res)) return;
      if (err instanceof DeckWithCardsError) {
        logger.error('Deck with cards failed', { userId, code: err.code, rolledBack: err.rolledBack });
        return res.status(500).json({
          success: false,
          code: err.code,
          error: "We couldn't save this deck. Nothing was added to your library.",
          // False only if even the cleanup delete failed; the client should
          // then refresh rather than assume the deck is absent.
          rolledBack: err.rolledBack,
        });
      }
      throw err;
    }

    res.status(201).json({ success: true, data: payload });
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
    // The destructure IS the field whitelist: whatever else the body carries is
    // never forwarded. `updateDeck` then whitelists a second time against its
    // own typed `updates` shape, so an unexpected column cannot be written even
    // if this list grows.
    const { name, description, isShared, courseId, studySetId, topicId, coverPath } = req.body;
    let updatedDeck;
    try {
      updatedDeck = await supabaseService.updateDeck(deckId, { name, description, isShared, courseId, studySetId, topicId }, userId);
      // Only CLEARING is accepted through the generic update — a cover is set by
      // POST /:deckId/cover, so no client can aim the column at an arbitrary
      // storage object it does not own.
      if (coverPath === null) {
        const { previousPath } = await supabaseService.setDeckCoverPath(deckId, userId, null);
        await supabaseService.deleteCoverObject(previousPath);
        if (updatedDeck) (updatedDeck as any).coverPath = null;
      }
    } catch (err) {
      if (err instanceof CoverColumnMissingError) {
        return res.status(503).json({ success: false, error: err.message, migration: COVER_IMAGE_MIGRATION });
      }
      if (respondPublicError(err, res)) return;
      throw err;
    }

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

// ---------- Deck cover image ----------
// The stored value is the storage PATH. Signed URLs expire after 24h, so one
// persisted here would be a broken image tomorrow; clients re-sign through
// POST /api/v1/storage/signed-urls (variant:'thumb' for grids).

const ALLOWED_COVER_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
const MAX_COVER_BYTES = 10 * 1024 * 1024;

router.post(
  '/:deckId/cover',
  authMiddleware,
  requireDeckAccess('deckId', 'owner'),
  validateDeckId,
  handleValidationErrors,
  uploadBurstRateLimit,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { deckId } = req.params;
    const { base64Data, fileName, contentType } = req.body || {};

    if (!base64Data || !fileName) {
      return res.status(400).json({ success: false, error: 'fileName and base64Data are required' });
    }
    const normalizedType = typeof contentType === 'string' ? contentType.toLowerCase() : '';
    if (!ALLOWED_COVER_TYPES.includes(normalizedType)) {
      return res.status(400).json({
        success: false,
        error: 'contentType is required. Only JPEG, PNG, GIF, and WebP are allowed.',
      });
    }
    const estimatedBytes = Math.ceil((base64Data.length * 3) / 4);
    if (estimatedBytes > MAX_COVER_BYTES) {
      return res.status(400).json({ success: false, error: 'Image exceeds 10 MB limit' });
    }

    let uploaded: { path: string; url: string; thumbUrl: string | null } | undefined;
    try {
      // Probe the COLUMN before storing bytes: on a database without the
      // migration this answers 503 without ever leaving an orphan object.
      await supabaseService.assertCoverColumn?.('deck');
      uploaded = await supabaseService.uploadCoverImage({
        userId,
        kind: 'deck',
        id: deckId,
        fileName,
        base64Data,
        contentType: normalizedType,
      });
      const { previousPath } = await supabaseService.setDeckCoverPath(deckId, userId, uploaded.path);
      await supabaseService.deleteCoverObject(previousPath);
      return res.status(201).json({
        success: true,
        data: { coverPath: uploaded.path, coverUrl: uploaded.url, coverThumbUrl: uploaded.thumbUrl },
      });
    } catch (error: any) {
      if (uploaded) await supabaseService.deleteCoverObject(uploaded.path);
      if (error instanceof CoverColumnMissingError) {
        logger.error('[cover] set cover refused: column missing', {
          kind: 'deck', deckId, userId, migration: COVER_IMAGE_MIGRATION,
        });
        return res.status(503).json({ success: false, error: error.message, migration: COVER_IMAGE_MIGRATION });
      }
      if (error instanceof CoverStorageUnavailableError) {
        logger.error('[cover] set cover failed: storage', {
          kind: 'deck', deckId, userId, detail: error.detail,
        });
        return res.status(503).json({ success: false, error: error.message, detail: error.detail });
      }
      logger.error('[cover] set cover failed', { kind: 'deck', deckId, userId, error });
      return res.status(500).json({ success: false, error: clientErrorMessage(error, 'Failed to set cover image') });
    }
  })
);

router.delete(
  '/:deckId/cover',
  authMiddleware,
  requireDeckAccess('deckId', 'owner'),
  validateDeckId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { deckId } = req.params;
    try {
      const { previousPath } = await supabaseService.setDeckCoverPath(deckId, userId, null);
      await supabaseService.deleteCoverObject(previousPath);
      return res.json({ success: true, data: { coverPath: null } });
    } catch (error: any) {
      if (error instanceof CoverColumnMissingError) {
        logger.error('[cover] clear cover refused: column missing', {
          kind: 'deck', deckId, userId, migration: COVER_IMAGE_MIGRATION,
        });
        return res.status(503).json({ success: false, error: error.message, migration: COVER_IMAGE_MIGRATION });
      }
      logger.error('[cover] clear cover failed', { kind: 'deck', deckId, userId, error });
      return res.status(500).json({ success: false, error: clientErrorMessage(error, 'Failed to clear cover image') });
    }
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

// ---------------------------------------------------------------------------
// Collaborators and stats
// ---------------------------------------------------------------------------
// Defence in depth on the add path: the route gate asks only for `edit`, but
// `supabaseService.addDeckCollaborator` re-checks `verifyDeckAccess(..., 'owner')`
// and throws `'Access denied'` — so an editor who reaches the handler still
// cannot grant a third party access to someone else's deck. The 403 below is
// that service-level refusal surfacing, not a redundant branch.

router.get(
  '/:deckId/collaborators',
  authMiddleware,
  requireDeckAccess('deckId', 'read'),
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

// ---------------------------------------------------------------------------
// Import and export — CSV, Anki .apkg, native JSON
// ---------------------------------------------------------------------------
// Exports require only `read`; imports always create a deck owned by the token's
// user, never one named in the payload. `.apkg` goes through `runSyncOrEnqueue`
// because parsing a large Anki archive can outlast a request, so this route may
// answer 202 with a job id instead of 201 with a deck.

router.get(
  '/:deckId/export/csv',
  authMiddleware,
  requireDeckAccess('deckId', 'read'),
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
