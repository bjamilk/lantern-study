/**
 * Discovery surfaces: favorites, saved searches and alerts, the public taxonomy,
 * the classifier, custom categories and similar listings.
 *
 * `GET /saved-searches/:id/matches` is dual-purpose: `?peek=1` counts without
 * advancing `last_checked_at`, so polling for the badge does not consume the
 * cursor that services/marketplaceAlerts.ts uses to decide what to notify about.
 */
import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { authMiddleware } from '../../middleware/auth';
import { handleValidationErrors, validateListingId } from '../../middleware/validation';
import { logger } from '../../utils/logger';
import { classifyListing, serializeClassifySuggestion, publicTaxonomyPayload } from '@lantern/shared/marketplace';
import { cacheService, dataLayer } from './context';
const router = Router();
// ============================================================
// SAVED SEARCHES ENDPOINTS
// ============================================================

// ============================================================
// SAVED SEARCHES AND ALERTS
//
// A buyer's stored filter set plus the match counter behind the Explore badge.
// `GET /saved-searches/:id/matches` is dual-purpose: `?peek=1` counts without
// advancing `last_checked_at`, so polling for the badge does not consume the
// cursor that services/marketplaceAlerts.ts uses to decide what to notify about.
// ============================================================


// ============================================================
// CUSTOM CATEGORIES ENDPOINTS
// ============================================================


// ============================================================
// SIMILAR LISTINGS ENDPOINT
// ============================================================


// GET /api/v1/marketplace/favorites - Get user's favorites
router.get(
  '/favorites',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = req.user?.id;

    logger.debug('Fetching user favorites', { userId });

    const favorites = await dataLayer.marketplace.getUserFavorites(userId);

    res.json({
      success: true,
      data: favorites,
    });
  })
);

// POST /api/v1/marketplace/favorites - Add to favorites
router.post(
  '/favorites',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = req.user?.id;
    const { listingId } = req.body;

    if (!listingId) {
      return res.status(400).json({
        success: false,
        error: 'listingId is required',
      });
    }

    logger.debug('Adding to favorites', { userId, listingId });

    const result = await dataLayer.marketplace.addFavorite(userId, listingId);

    try {
      const { notifySellerFavoriteMilestone } = await import('../../services/marketplaceFavoriteMilestones');
      await notifySellerFavoriteMilestone(dataLayer, listingId);
    } catch (e) {
      logger.warn('Favorite milestone notification failed', e);
    }

    res.status(201).json({
      success: true,
      data: result,
    });
  })
);

// DELETE /api/v1/marketplace/favorites/:listingId - Remove from favorites
router.delete(
  '/favorites/:listingId',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = req.user?.id;
    const { listingId } = req.params;

    logger.debug('Removing from favorites', { userId, listingId });

    await dataLayer.marketplace.removeFavorite(userId, listingId);

    res.json({
      success: true,
      message: 'Removed from favorites',
    });
  })
);

// GET /api/v1/marketplace/favorites/:listingId/check - Check if favorited
router.get(
  '/favorites/:listingId/check',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = req.user?.id;
    const { listingId } = req.params;

    const isFavorited = await dataLayer.marketplace.isListingFavorited(userId, listingId);

    res.json({
      success: true,
      data: { isFavorited },
    });
  })
);

// POST /api/v1/marketplace/saved-searches - Save a search
router.post(
  '/saved-searches',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = req.user.id;
    const { filters, name } = req.body;

    if (!filters || typeof filters !== 'object') {
      return res.status(400).json({ success: false, error: 'filters object is required' });
    }

    // Auto-generate name from filters if not provided
    const searchName = name || (() => {
      const parts: string[] = [];
      if (filters.search) parts.push(`"${filters.search}"`);
      if (filters.category) parts.push(filters.category.replace(/_/g, ' '));
      if (filters.minPrice || filters.maxPrice) {
        parts.push(`₦${filters.minPrice || 0}-${filters.maxPrice || '∞'}`);
      }
      if (filters.location) parts.push(`in ${filters.location}`);
      return parts.length > 0 ? parts.join(', ') : 'All listings';
    })();

    const { data, error } = await dataLayer.marketplace.createSavedSearch(
      userId,
      searchName,
      filters
    );

    if (error) throw error;

    res.status(201).json({ success: true, data });
  })
);

// GET /api/v1/marketplace/saved-searches - List saved searches
router.get(
  '/saved-searches',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = req.user.id;

    const { data, error } = await dataLayer.marketplace.listSavedSearches(userId);

    if (error) throw error;

    res.json({ success: true, data: data || [] });
  })
);

// DELETE /api/v1/marketplace/saved-searches/:id - Delete a saved search
router.delete(
  '/saved-searches/:id',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = req.user.id;
    const { id } = req.params;

    const { error } = await dataLayer.marketplace.deleteSavedSearch(userId, id);

    if (error) throw error;

    res.json({ success: true });
  })
);

router.patch(
  '/saved-searches/:id',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = req.user.id;
    const { id } = req.params;
    const { notify, name } = req.body;
    const patch: Record<string, unknown> = {};
    if (typeof notify === 'boolean') patch.notify = notify;
    if (typeof name === 'string' && name.trim()) patch.name = name.trim();
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ success: false, error: 'notify or name required' });
    }

    const { data, error } = await dataLayer.marketplace.updateSavedSearch(userId, id, patch);

    if (error) throw error;
    res.json({ success: true, data });
  })
);

// GET /api/v1/marketplace/saved-searches/:id/matches - Check for new matches
// ?peek=1 (or ?peek=true) returns the count WITHOUT advancing last_checked_at,
// so the Explore badge poll doesn't consume the alerts job's notification cursor.
// Without peek, this remains the "mark as seen" action.
router.get(
  '/saved-searches/:id/matches',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = req.user.id;
    const { id } = req.params;
    const peek = req.query.peek === '1' || req.query.peek === 'true';

    const result = await dataLayer.marketplace.getSavedSearchMatches(userId, id, { peek });
    if (!result) {
      return res.status(404).json({ success: false, error: 'Saved search not found' });
    }

    res.json({ success: true, data: result });
  })
);

// GET /api/v1/marketplace/taxonomy — campus listing type tree
router.get(
  '/taxonomy',
  asyncHandler(async (_req: any, res: any) => {
    const cacheKey = 'marketplace:taxonomy:v1';
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      return res.json({ success: true, data: cached });
    }
    const payload = publicTaxonomyPayload();
    await cacheService.set(cacheKey, payload, 3600);
    res.json({ success: true, data: payload });
  })
);

// POST /api/v1/marketplace/classify — suggest listing types from a title
router.post(
  '/classify',
  asyncHandler(async (req: any, res: any) => {
    const title = typeof req.body?.title === 'string' ? req.body.title : '';
    const description = typeof req.body?.description === 'string' ? req.body.description : '';
    const department =
      req.body?.department === 'academic' || req.body?.department === 'student-life'
        ? req.body.department
        : undefined;
    if (!title.trim()) {
      return res.status(400).json({ success: false, error: 'Title is required to classify a listing' });
    }
    const suggestions = classifyListing({ title, description, department, limit: 5 }).map(
      serializeClassifySuggestion,
    );
    res.json({ success: true, data: { suggestions } });
  })
);

// GET /api/v1/marketplace/categories/custom - List custom categories
//
// FIXED (R5a, F7b deferral a): `cacheService.get` is async and the `await` was
// missing, so `cached` was always a pending Promise — always truthy. The route
// therefore always took the cache-hit branch and answered `{success:true,
// data:{}}`: an object, not the array clients expect. Custom categories never
// reached any client, `dataLayer.categories.getCustomCategories()` was unreachable,
// and the POST sibling kept writing rows nobody could list. The `set` and the
// sibling's `deletePattern` were unawaited floating promises too.
router.get(
  '/categories/custom',
  asyncHandler(async (_req: Request, res: Response) => {
    const cacheKey = 'marketplace:custom_categories';
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      return res.json({ success: true, data: cached });
    }

    const categories = await dataLayer.categories.getCustomCategories();
    await cacheService.set(cacheKey, categories, 300); // 5 min cache
    res.json({ success: true, data: categories });
  })
);

// POST /api/v1/marketplace/categories/custom - Create a custom category
router.post(
  '/categories/custom',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = req.user.id;
    const { name } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Category name is required' });
    }

    const trimmedName = name.trim();
    if (trimmedName.length > 50) {
      return res.status(400).json({ success: false, error: 'Category name must be 50 characters or less' });
    }

    const category = await dataLayer.categories.createCustomCategory(trimmedName, userId);
    await cacheService.deletePattern('marketplace:custom_categories');
    res.status(201).json({ success: true, data: category });
  })
);

// GET /api/v1/marketplace/listings/:id/similar - Get similar listings
router.get(
  '/listings/:id/similar',
  validateListingId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { id } = req.params;

    const similarCacheKey = `marketplace:similar:v3:${id}`;
    const cached = await cacheService.get<any[]>(similarCacheKey);
    if (cached) {
      return res.json({ success: true, data: cached });
    }

    const listing = await dataLayer.marketplace.getMarketplaceListingById(id);
    if (!listing) {
      return res.status(404).json({ success: false, error: 'Listing not found' });
    }

    const result = await dataLayer.marketplace.getRelatedMarketplaceListings(listing, 6);
    await cacheService.set(similarCacheKey, result, 300);
    res.json({ success: true, data: result });
  })
);

export default router;
