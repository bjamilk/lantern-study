/**
 * Digital study products: question banks and study packs.
 *
 * Publish, download (entitlement grant), restore, preview, leaderboard/scores
 * and the seller-side content update flow for both kinds, plus the buyer's
 * `/purchases` list. Delivery and entitlement live in
 * services/marketplaceQuestionBanks.ts and services/marketplaceStudyPacks.ts.
 */
import { Router } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { authMiddleware, optionalAuthMiddleware } from '../../middleware/auth';
import { handleValidationErrors, validateListingId } from '../../middleware/validation';
import { requireAuthUserId } from '../../utils/requestAuth';
import { getMarketplaceQuestionBanksService } from '../../services/marketplaceQuestionBanks';
import { getMarketplaceStudyPacksService } from '../../services/marketplaceStudyPacks';
import { surfaceFromRequest } from '../../services/learningEvents';
import { PublicError } from '../../utils/safeError';
import { invalidateListingCaches } from '../../utils/marketplaceCache';
import { dataLayer, cacheService } from './context';
const router = Router();
// ============================================================
// QUESTION BANKS (digital study bundles)
// ============================================================


// ============================================================
// STUDY PACKS (digital study products: guide + summaries + flashcards + questions)
// ============================================================


// POST /api/v1/marketplace/question-banks/publish - Publish a bank as a listing
router.post(
  '/question-banks/publish',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    try {
      const result = await getMarketplaceQuestionBanksService(dataLayer).publishQuestionBank(
        userId,
        {
          title: req.body?.title,
          description: req.body?.description,
          price: req.body?.price,
          campusId: req.body?.campusId ?? req.body?.campus_id,
          location: req.body?.location,
          groupId: req.body?.groupId ?? req.body?.group_id ?? null,
          courseId: req.body?.courseId ?? req.body?.course_id ?? null,
          topicId: req.body?.topicId ?? req.body?.topic_id ?? null,
          content: req.body?.content,
          // Rights attestation (required) + provenance (Phase 1 · E).
          attestation: req.body?.attestation,
          aiAssisted: req.body?.aiAssisted ?? req.body?.ai_assisted,
          sourcesCited: req.body?.sourcesCited ?? req.body?.sources_cited,
        }
      );
      await cacheService.deletePattern('marketplace:listings:*');
      res.status(201).json({ success: true, data: result });
    } catch (err: any) {
      if (err instanceof PublicError) {
        return res.status(400).json({ success: false, error: err.message });
      }
      // The content filter throws a moderationError (statusCode 400) with a
      // user-safe message; surface it rather than masking it as a 500.
      if (typeof err?.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500) {
        return res.status(err.statusCode).json({ success: false, error: err.message });
      }
      throw err;
    }
  })
);

// POST /api/v1/marketplace/listings/:id/question-bank/download - Free download / owner re-download
router.post(
  '/listings/:id/question-bank/download',
  authMiddleware,
  validateListingId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    try {
      const result = await getMarketplaceQuestionBanksService(
        dataLayer
      ).downloadQuestionBank(req.params.id, userId, { surface: surfaceFromRequest(req) });
      res.json({ success: true, data: result });
    } catch (err: any) {
      if (err instanceof PublicError) {
        return res.status(400).json({ success: false, error: err.message });
      }
      throw err;
    }
  })
);

// POST /api/v1/marketplace/question-banks/restore - Re-materialize owned banks
// into offline bundles (new device / reinstall), self-healing missed fulfillments.
router.post(
  '/question-banks/restore',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const result = await getMarketplaceQuestionBanksService(dataLayer).restoreEntitlements(
      userId
    );
    res.json({ success: true, data: result });
  })
);

// GET /api/v1/marketplace/listings/:id/question-bank/preview - Public sample
// (answers stripped server-side; safe for guests)
router.get(
  '/listings/:id/question-bank/preview',
  optionalAuthMiddleware,
  validateListingId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    try {
      const data = await getMarketplaceQuestionBanksService(
        dataLayer
      ).getQuestionBankPreview(req.params.id, req.user?.id);
      res.json({ success: true, data });
    } catch (err: any) {
      if (err instanceof PublicError) {
        return res.status(404).json({ success: false, error: err.message });
      }
      throw err;
    }
  })
);

// POST /api/v1/marketplace/listings/:id/question-bank/scores - Record an attempt
router.post(
  '/listings/:id/question-bank/scores',
  authMiddleware,
  validateListingId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    try {
      const data = await getMarketplaceQuestionBanksService(dataLayer).recordScore(
        req.params.id,
        userId,
        req.body?.correct,
        req.body?.total,
        { surface: surfaceFromRequest(req) }
      );
      res.json({ success: true, data });
    } catch (err: any) {
      if (err instanceof PublicError) {
        return res.status(400).json({ success: false, error: err.message });
      }
      throw err;
    }
  })
);

// GET /api/v1/marketplace/listings/:id/question-bank/leaderboard - Top scores
router.get(
  '/listings/:id/question-bank/leaderboard',
  optionalAuthMiddleware,
  validateListingId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const data = await getMarketplaceQuestionBanksService(dataLayer).getLeaderboard(
      req.params.id,
      req.user?.id,
      req.query?.limit ? Number(req.query.limit) : undefined
    );
    res.json({ success: true, data });
  })
);

// GET /api/v1/marketplace/question-banks/mine - Banks published by the caller
router.get(
  '/question-banks/mine',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const data = await getMarketplaceQuestionBanksService(dataLayer).listMyQuestionBanks(
      userId
    );
    res.json({ success: true, data });
  })
);

// GET /api/v1/marketplace/question-banks/updates - Owned banks with a newer version
router.get(
  '/question-banks/updates',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const data = await getMarketplaceQuestionBanksService(dataLayer).listAvailableUpdates(
      userId
    );
    res.json({ success: true, data });
  })
);

// POST /api/v1/marketplace/question-banks/:id/update-content - Seller republish (version+1)
router.post(
  '/question-banks/:id/update-content',
  authMiddleware,
  validateListingId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    try {
      const result = await getMarketplaceQuestionBanksService(
        dataLayer
      ).updateQuestionBankContent(req.params.id, userId, req.body?.content, {
        // Every republish re-requires the rights attestation (400 without it).
        attestation: req.body?.attestation,
        aiAssisted: req.body?.aiAssisted ?? req.body?.ai_assisted,
        sourcesCited: req.body?.sourcesCited ?? req.body?.sources_cited,
      });
      await invalidateListingCaches(cacheService, req.params.id);
      await cacheService.deletePattern('marketplace:listings:*');
      res.json({ success: true, data: result });
    } catch (err: any) {
      if (err instanceof PublicError) {
        return res.status(400).json({ success: false, error: err.message });
      }
      throw err;
    }
  })
);

// POST /api/v1/marketplace/study-packs/publish - Publish a pack as a listing
router.post(
  '/study-packs/publish',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    try {
      const result = await getMarketplaceStudyPacksService(dataLayer).publishStudyPack(userId, {
        title: req.body?.title,
        description: req.body?.description,
        price: req.body?.price,
        campusId: req.body?.campusId ?? req.body?.campus_id,
        location: req.body?.location,
        courseId: req.body?.courseId ?? req.body?.course_id ?? null,
        topicId: req.body?.topicId ?? req.body?.topic_id ?? null,
        content: req.body?.content,
        draftId: req.body?.draftId ?? req.body?.draft_id ?? null,
        // Rights attestation (required) + provenance (Phase 1 · E).
        attestation: req.body?.attestation,
        aiAssisted: req.body?.aiAssisted ?? req.body?.ai_assisted,
        sourcesCited: req.body?.sourcesCited ?? req.body?.sources_cited,
      });
      await cacheService.deletePattern('marketplace:listings:*');
      res.status(201).json({ success: true, data: result });
    } catch (err: any) {
      if (err instanceof PublicError) {
        return res.status(400).json({ success: false, error: err.message });
      }
      // The content filter throws a moderationError (statusCode 400) with a
      // user-safe message; surface it rather than masking it as a 500.
      if (typeof err?.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500) {
        return res.status(err.statusCode).json({ success: false, error: err.message });
      }
      throw err;
    }
  })
);

// POST /api/v1/marketplace/listings/:id/study-pack/download - Free download / owner re-download
router.post(
  '/listings/:id/study-pack/download',
  authMiddleware,
  validateListingId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    try {
      const result = await getMarketplaceStudyPacksService(dataLayer).downloadStudyPack(
        req.params.id,
        userId,
        { surface: surfaceFromRequest(req) }
      );
      res.json({ success: true, data: result });
    } catch (err: any) {
      if (err instanceof PublicError) {
        return res.status(400).json({ success: false, error: err.message });
      }
      throw err;
    }
  })
);

// POST /api/v1/marketplace/study-packs/restore - Re-materialize owned packs
// (new device / reinstall), self-healing missed fulfillments.
router.post(
  '/study-packs/restore',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const result = await getMarketplaceStudyPacksService(dataLayer).restoreEntitlements(userId);
    res.json({ success: true, data: result });
  })
);

// GET /api/v1/marketplace/listings/:id/study-pack/preview - Public sample
router.get(
  '/listings/:id/study-pack/preview',
  optionalAuthMiddleware,
  validateListingId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    try {
      const data = await getMarketplaceStudyPacksService(dataLayer).getStudyPackPreview(
        req.params.id,
        req.user?.id
      );
      res.json({ success: true, data });
    } catch (err: any) {
      if (err instanceof PublicError) {
        return res.status(404).json({ success: false, error: err.message });
      }
      throw err;
    }
  })
);

// GET /api/v1/marketplace/study-packs/mine - Packs published by the caller
router.get(
  '/study-packs/mine',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const data = await getMarketplaceStudyPacksService(dataLayer).listMyStudyPacks(userId);
    res.json({ success: true, data });
  })
);

// GET /api/v1/marketplace/study-packs/updates - Owned packs with a newer version
router.get(
  '/study-packs/updates',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const data = await getMarketplaceStudyPacksService(dataLayer).listAvailableUpdates(userId);
    res.json({ success: true, data });
  })
);

// POST /api/v1/marketplace/study-packs/:id/update-content - Seller republish (version+1)
router.post(
  '/study-packs/:id/update-content',
  authMiddleware,
  validateListingId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    try {
      const result = await getMarketplaceStudyPacksService(dataLayer).updateStudyPackContent(
        req.params.id,
        userId,
        req.body?.content,
        {
          // Every republish re-requires the rights attestation (400 without it).
          attestation: req.body?.attestation,
          aiAssisted: req.body?.aiAssisted ?? req.body?.ai_assisted,
          sourcesCited: req.body?.sourcesCited ?? req.body?.sources_cited,
        }
      );
      await invalidateListingCaches(cacheService, req.params.id);
      await cacheService.deletePattern('marketplace:listings:*');
      res.json({ success: true, data: result });
    } catch (err: any) {
      if (err instanceof PublicError) {
        const code = (err as { statusCode?: number }).statusCode;
        const status =
          typeof code === 'number' && code >= 400 && code < 500 ? code : 400;
        return res.status(status).json({ success: false, error: err.message });
      }
      throw err;
    }
  })
);

// GET /api/v1/marketplace/purchases - Unified buyer library (question banks + study packs)
router.get(
  '/purchases',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const data = await getMarketplaceStudyPacksService(dataLayer).listPurchases(userId);
    res.json({ success: true, data });
  })
);

export default router;
