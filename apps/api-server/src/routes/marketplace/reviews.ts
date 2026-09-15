/**
 * Marketplace reviews.
 *
 * Ratings on a listing plus the helpful-vote toggle. Eligibility (a delivered
 * order for this buyer) is enforced inside `supabaseService.addMarketplaceReview`,
 * which throws with a `statusCode` of 400 or 403; the handler forwards those two
 * and rethrows anything else. The helpful-vote upsert is the route family that
 * the `onConflict`-vs-partial-unique-index trap previously broke.
 */
import { Router } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { authMiddleware } from '../../middleware/auth';
import { handleValidationErrors, validateListingId } from '../../middleware/validation';
import { logger } from '../../utils/logger';
import { invalidateListingCaches } from '../../utils/marketplaceCache';
import { computeMarketplaceReviewSummary } from '@lantern/shared/marketplace';
import { supabaseService, cacheService } from './context';
const router = Router();
// ============================================================
// REVIEWS
//
// Ratings on a listing plus the helpful-vote toggle. Eligibility (a delivered
// order for this buyer) is enforced inside `supabaseService.addMarketplaceReview`,
// which throws with a `statusCode` of 400 or 403; the handler forwards those two
// and rethrows anything else. The helpful-vote upsert is the route family that
// the `onConflict`-vs-partial-unique-index trap previously broke.
// ============================================================



// POST/DELETE /api/v1/marketplace/listings/:id/reviews/:reviewId/helpful -
// mark or unmark a review as helpful. 503s gracefully until the
// marketplace_review_votes migration is applied.
const REVIEW_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const handleReviewVote = (helpful: boolean) =>
  asyncHandler(async (req: any, res: any) => {
    const { id, reviewId } = req.params;
    if (!REVIEW_ID_RE.test(reviewId)) {
      return res.status(400).json({ success: false, error: 'Invalid review id' });
    }
    try {
      const result = await supabaseService.setMarketplaceReviewVote(
        id,
        reviewId,
        req.user.id,
        helpful,
      );
      res.json({ success: true, data: result });
    } catch (err: any) {
      const status = typeof err?.statusCode === 'number' ? err.statusCode : 0;
      if (status === 400 || status === 404 || status === 503) {
        return res.status(status).json({ success: false, error: err.message });
      }
      throw err;
    }
  });


// GET /api/v1/marketplace/listings/:id/reviews - List reviews for a listing
// (with verified-purchase + helpful-vote signals and an aggregate summary).
router.get(
  '/listings/:id/reviews',
  validateListingId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { id } = req.params;
    const reviews = await supabaseService.getMarketplaceReviews(id, req.user?.id);
    res.json({
      success: true,
      data: reviews,
      summary: computeMarketplaceReviewSummary(reviews),
    });
  })
);

router.post(
  '/listings/:id/reviews/:reviewId/helpful',
  authMiddleware,
  validateListingId,
  handleValidationErrors,
  handleReviewVote(true)
);

router.delete(
  '/listings/:id/reviews/:reviewId/helpful',
  authMiddleware,
  validateListingId,
  handleValidationErrors,
  handleReviewVote(false)
);

// POST /api/v1/marketplace/listings/:id/reviews - Add review
// FIXED (F7b): `handleValidationErrors` used to be attached here with NO
// express-validator chain in front of it — and at 13 other routes in this file,
// 78 across all of routes/. With no chain the middleware reads an empty error
// array and always calls next(), so it looked validated and was a no-op. Every
// chainless attachment has been removed, because code that reads as validated
// and is not is worse than code that reads as unvalidated;
// `routes/routeConsistency.test.ts` fails the build if one comes back.
//
// This does NOT add the missing validation: `rating` and `comment` still reach
// the service unchecked, and the field-level checks the money routes need belong
// with the service-layer work (see the `(req: any, res: any)` note at the top of
// this file). What changed is that the code no longer claims otherwise.
router.post(
  '/listings/:id/reviews',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const { id } = req.params;
    const { rating, comment } = req.body;
    const userId = req.user?.id;

    logger.debug('Adding review to listing', { id, userId, rating });

    let review;
    try {
      review = await supabaseService.addMarketplaceReview(id, userId, { rating, comment });
    } catch (err: any) {
      // Eligibility (403) and validation (400) failures are expected outcomes,
      // not server errors — keep the app's {success, error} shape.
      const status = typeof err?.statusCode === 'number' ? err.statusCode : 0;
      if (status === 400 || status === 403) {
        return res.status(status).json({ success: false, error: err.message });
      }
      throw err;
    }

    // Invalidate caches
    await invalidateListingCaches(cacheService, id);
    await cacheService.deletePattern('marketplace:listings:*');

    res.status(201).json({
      success: true,
      data: review,
    });
  })
);

export default router;
