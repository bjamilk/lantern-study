import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth';
import { uploadBurstRateLimit } from '../middleware/rateLimit';
import { handleValidationErrors, validatePagination, validateListingId, validateMarketplaceListingWrite, validateMarketplaceListingUpdate, validateUserId } from '../middleware/validation';
import { requireAuthUserId } from '../utils/requestAuth';
import { SupabaseService } from '../services/supabase';
import { CacheService } from '../services/cache';
import { logger } from '../utils/logger';
import { clientErrorMessage } from '../utils/safeError';
import { getMarketplaceOrdersService, invalidateSellerAnalyticsCache } from '../services/marketplaceOrders';
import { invalidateListingCaches } from '../utils/marketplaceCache';
import { CacheKeys, CacheTTL } from '../services/cachePolicy';
import { normalizeIdempotencyKey, withIdempotency } from '../services/idempotency';
import { idempotencyMiddleware, type IdempotentRequest } from '../middleware/idempotency';
import { isLivePlatformAdmin } from '../utils/platformAdminAuth';

const router = Router();
const resolveResponseProfile = (profile: unknown): 'compact' | 'full' =>
  profile === 'compact' ? 'compact' : 'full';

// Initialize services (will be injected in main server)
let supabaseService: SupabaseService;
let cacheService: CacheService;

// Initialize function to be called from main server
export const initializeMarketplaceRoutes = (supabase: SupabaseService, cache: CacheService) => {
  supabaseService = supabase;
  cacheService = cache;
};

// GET /api/v1/marketplace/campuses - List campuses for location pickers
router.get(
  '/campuses',
  asyncHandler(async (req: any, res: any) => {
    const country = (req.query.country as string) || 'NG';
    const cacheKey = `marketplace:campuses:${country}`;
    let campuses = await cacheService.get(cacheKey);
    if (!campuses) {
      campuses = await supabaseService.getMarketplaceCampuses(country);
      await cacheService.set(cacheKey, campuses, 3600);
    }
    res.json({ success: true, data: campuses });
  })
);

// GET /api/v1/marketplace/listings - Get listings with search/filters
router.get(
  '/listings',
  validatePagination,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const {
      page = 1,
      limit = 20,
      category,
      categories,
      includeCustom,
      search,
      minPrice,
      maxPrice,
      location,
      campus_id: campusId,
      country_code: countryCode,
      sortBy = 'created_at',
      sortOrder = 'desc',
      responseProfile,
    } = req.query;
    const profile = resolveResponseProfile(responseProfile);
    const categoryList = typeof categories === 'string' && categories.trim()
      ? categories.split(',').map((c: string) => c.trim()).filter(Boolean).slice(0, 20)
      : undefined;
    const includeCustomCategories = includeCustom === '1' || includeCustom === 'true';

    logger.debug('Fetching marketplace listings', { page, limit, category, search, profile, campusId, countryCode });

    const cacheKey = `marketplace:listings:v2:${page}:${limit}:${category || ''}:${categoryList ? categoryList.join('|') : ''}:${includeCustomCategories ? 1 : 0}:${search || ''}:${minPrice || ''}:${maxPrice || ''}:${location || ''}:${campusId || ''}:${countryCode || ''}:${sortBy}:${sortOrder}:profile:${profile}`;
    let result = await cacheService.get<{ data: any[]; total: number }>(cacheKey);

    if (!result) {
      result = await supabaseService.getMarketplaceListings({
        page: parseInt(page),
        limit: parseInt(limit),
        category,
        categories: categoryList,
        includeCustomCategories,
        search,
        minPrice: minPrice ? parseFloat(minPrice) : undefined,
        maxPrice: maxPrice ? parseFloat(maxPrice) : undefined,
        location,
        campusId: campusId as string | undefined,
        countryCode: (countryCode as string) || undefined,
        sortBy,
        sortOrder: sortOrder === 'asc' ? 'asc' : 'desc',
        responseProfile: profile,
      });

      // Cache for 5 minutes
      await cacheService.set(cacheKey, result, 300);
    }

    res.json({
      success: true,
      data: result.data,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: result.total,
      },
      responseProfile: profile,
    });
  })
);

// GET /api/v1/marketplace/listings/batch?ids=a,b,c - Batch fetch active listings
// (recently-viewed rail). Registered before /listings/:id so "batch" is not
// treated as a listing id.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
router.get(
  '/listings/batch',
  asyncHandler(async (req: any, res: any) => {
    const raw = typeof req.query.ids === 'string' ? req.query.ids : '';
    const ids = [...new Set(raw.split(',').map((id: string) => id.trim()).filter((id: string) => UUID_RE.test(id)))].slice(0, 20) as string[];

    if (ids.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const cacheKey = `marketplace:listings:batch:${[...ids].sort().join(',')}`;
    let listings = await cacheService.get<any[]>(cacheKey);
    if (!listings) {
      listings = await supabaseService.getMarketplaceListingsByIds(ids);
      await cacheService.set(cacheKey, listings, 300);
    }

    res.json({ success: true, data: listings });
  })
);

// GET /api/v1/marketplace/analytics/categories - Category listing counts
router.get(
  '/analytics/categories',
  asyncHandler(async (_req: any, res: any) => {
    const cacheKey = 'marketplace:analytics:categories';
    const cached = await cacheService.get<Array<{ category: string; total: number; active: number; sold: number }>>(cacheKey);
    if (cached) {
      return res.json({ success: true, data: cached });
    }

    const analytics = await supabaseService.getMarketplaceCategoryAnalytics();
    await cacheService.set(cacheKey, analytics, 120);
    res.json({ success: true, data: analytics });
  })
);

// GET /api/v1/marketplace/listings/:id - Get listing by ID
router.get(
  '/listings/:id',
  optionalAuthMiddleware,
  validateListingId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { id } = req.params;
    const viewerId = req.user?.id as string | undefined;

    logger.debug('Fetching marketplace listing', { id, viewerId: viewerId || null });

    // Do not serve non-active listings from a shared public cache key.
    const cacheKey = viewerId ? null : `marketplace:listing:public:${id}`;
    let listing = cacheKey ? await cacheService.get<any>(cacheKey) : null;

    if (listing && listing.status !== 'active') {
      listing = null;
    }

    if (!listing) {
      listing = await supabaseService.getMarketplaceListingForViewer(id, viewerId);

      if (!listing) {
        return res.status(404).json({
          success: false,
          error: 'Listing not found',
        });
      }

      if (cacheKey && listing.status === 'active') {
        await cacheService.set(cacheKey, listing, 600);
      }
    }

    await supabaseService.incrementListingViews(id);
    listing = { ...listing, views_count: (listing.views_count || 0) + 1 };
    if (cacheKey && listing.status === 'active') {
      await cacheService.set(cacheKey, listing, 600);
    }

    res.json({
      success: true,
      data: listing,
    });
  })
);

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/jpg'];

// POST /api/v1/marketplace/upload-image — SEC-07 server-side MIME + magic-byte validation
router.post(
  '/upload-image',
  authMiddleware,
  uploadBurstRateLimit,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { fileName, base64Data, contentType, listingId } = req.body || {};
    if (!fileName || !base64Data) {
      return res.status(400).json({ success: false, error: 'fileName and base64Data are required' });
    }
    const normalizedType = contentType === 'image/jpg' ? 'image/jpeg' : contentType;
    if (!normalizedType || !ALLOWED_IMAGE_TYPES.includes(normalizedType)) {
      return res.status(400).json({
        success: false,
        error: 'contentType is required. Only JPEG, PNG, GIF, and WebP are allowed.',
      });
    }
    const estimatedBytes = Math.ceil((String(base64Data).length * 3) / 4);
    if (estimatedBytes > 10 * 1024 * 1024) {
      return res.status(400).json({ success: false, error: 'Image exceeds 10 MB limit' });
    }

    try {
      const result = await supabaseService.uploadMarketplaceImage({
        fileName,
        base64Data,
        contentType: normalizedType,
        userId,
        listingId: typeof listingId === 'string' ? listingId : undefined,
      });
      res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error('Failed to upload marketplace image', { error, userId });
      res.status(400).json({
        success: false,
        error: clientErrorMessage(error, 'Failed to upload image'),
      });
    }
  })
);

// POST /api/v1/marketplace/listings - Create listing
router.post(
  '/listings',
  authMiddleware,
  validateMarketplaceListingWrite,
  handleValidationErrors,
  idempotencyMiddleware({ operation: 'marketplace_create_listing' }),
  asyncHandler(async (req: IdempotentRequest, res: any) => {
    const listingData = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated',
      });
    }

    if (!listingData.category || !listingData.title) {
      return res.status(400).json({
        success: false,
        error: 'Category and title are required',
      });
    }

    const campusId = listingData.campus_id ?? listingData.campusId;
    if (!campusId) {
      return res.status(400).json({
        success: false,
        error: 'Campus is required for marketplace listings',
      });
    }

    const campus = await supabaseService.getMarketplaceCampusById(campusId);
    if (!campus || !campus.active) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or inactive campus',
      });
    }

    listingData.campus_id = campusId;
    listingData.country_code = campus.country_code || 'NG';
    listingData.currency = listingData.currency || 'NGN';

    logger.debug('Creating marketplace listing', { userId, category: listingData.category, title: listingData.title });

    try {
      const listing = await req.runIdempotent!(async () => {
        const created = await supabaseService.createMarketplaceListing(listingData, userId);

        if (listingData.category?.startsWith('custom:')) {
          const categoryName = listingData.category.replace('custom:', '');
          await supabaseService.createCustomCategory(categoryName, userId).catch(() => {});
          await supabaseService.incrementCategoryUsage(categoryName).catch(() => {});
          cacheService.deletePattern('marketplace:custom_categories');
        }

        await cacheService.deletePattern('marketplace:listings:*');
        return { listing: created as Record<string, unknown> };
      });

      res.status(201).json({
        success: true,
        data: listing.listing,
      });
    } catch (error: any) {
      logger.error('Failed to create marketplace listing:', error);
      res.status(500).json({
        success: false,
        error: clientErrorMessage(error, 'Failed to create listing'),
      });
    }
  })
);

// PUT /api/v1/marketplace/listings/:id - Update listing
router.put(
  '/listings/:id',
  authMiddleware,
  validateListingId,
  validateMarketplaceListingUpdate,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { id } = req.params;
    const updates = req.body;
    const userId = req.user?.id;

    logger.debug('Updating marketplace listing', { id, userId });

    const listing = await supabaseService.getMarketplaceListingById(id);
    if (!listing) {
      return res.status(404).json({
        success: false,
        error: 'Listing not found',
      });
    }

    const liveAdmin = userId ? await isLivePlatformAdmin(userId) : false;
    if (listing.user_id !== userId && !liveAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    const updatedListing = await supabaseService.updateMarketplaceListing(id, updates);

    const priceFields = ['price', 'sale_price', 'sale_ends_at'] as const;
    const priceChanged = priceFields.some((field) => field in updates);
    if (priceChanged) {
      const { notifyFavoritePriceDrop } = await import('../services/marketplaceFavoriteAlerts');
      await notifyFavoritePriceDrop(
        supabaseService,
        { ...listing, ...updatedListing, id, user_id: listing.user_id, title: updatedListing?.title || listing.title },
        listing
      );
    }

    if (updates?.status === 'active' && listing.status !== 'active') {
      const { notifyListingBackAvailable } = await import('../services/marketplaceFavoriteAlerts');
      await notifyListingBackAvailable(
        supabaseService,
        { id, user_id: listing.user_id, title: updatedListing?.title || listing.title },
        listing.status
      );
    }

    // Invalidate caches
    await invalidateListingCaches(cacheService, id);
    await cacheService.deletePattern('marketplace:listings:*');

    res.json({
      success: true,
      data: updatedListing,
    });
  })
);

// DELETE /api/v1/marketplace/listings/:id - Delete listing
router.delete(
  '/listings/:id',
  authMiddleware,
  validateListingId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { id } = req.params;
    const userId = req.user?.id;

    logger.debug('Deleting marketplace listing', { id, userId });

    const listing = await supabaseService.getMarketplaceListingById(id);
    if (!listing) {
      return res.status(404).json({
        success: false,
        error: 'Listing not found',
      });
    }

    const liveAdmin = userId ? await isLivePlatformAdmin(userId) : false;
    if (listing.user_id !== userId && !liveAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    await supabaseService.deleteMarketplaceListing(id);

    // Invalidate caches
    await invalidateListingCaches(cacheService, id);
    await cacheService.deletePattern('marketplace:listings:*');

    res.json({
      success: true,
      message: 'Listing deleted successfully',
    });
  })
);

// GET /api/v1/marketplace/listings/:id/reviews - List reviews for a listing
router.get(
  '/listings/:id/reviews',
  validateListingId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { id } = req.params;
    const reviews = await supabaseService.getMarketplaceReviews(id);
    res.json({ success: true, data: reviews });
  })
);

// POST /api/v1/marketplace/listings/:id/reviews - Add review
router.post(
  '/listings/:id/reviews',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { id } = req.params;
    const { rating, comment } = req.body;
    const userId = req.user?.id;

    logger.debug('Adding review to listing', { id, userId, rating });

    const review = await supabaseService.addMarketplaceReview(id, userId, { rating, comment });

    // Invalidate caches
    await invalidateListingCaches(cacheService, id);
    await cacheService.deletePattern('marketplace:listings:*');

    res.status(201).json({
      success: true,
      data: review,
    });
  })
);

// POST /api/v1/marketplace/listings/:id/buy-now - Instant purchase
router.post(
  '/listings/:id/buy-now',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { id } = req.params;
    const buyerId = req.user?.id;

    if (!buyerId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const idempotencyKey =
      normalizeIdempotencyKey(req.headers['idempotency-key']) ||
      `${buyerId}:buy_now:${id}:${Math.floor(Date.now() / 300_000)}`;

    const result = await withIdempotency(
      supabaseService.getClient(),
      buyerId,
      'marketplace_buy_now',
      idempotencyKey,
      async () =>
        supabaseService.buyMarketplaceListingNow(id, buyerId, req.body?.couponCode)
    );

    await invalidateListingCaches(cacheService, id);
    await cacheService.deletePattern('marketplace:listings:*');
    await invalidateSellerAnalyticsCache(String(result.order?.seller_id || ''));

    res.json({ success: true, data: result });
  })
);

// POST /api/v1/marketplace/listings/:id/boost - Boost listing visibility
router.post(
  '/listings/:id/boost',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { id } = req.params;
    const userId = req.user?.id;
    const durationHours = Math.min(168, Math.max(1, Number(req.body?.durationHours) || 72));

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const idempotencyKey =
      normalizeIdempotencyKey(req.headers['idempotency-key']) ||
      `${userId}:boost:${id}:${Math.floor(Date.now() / 300_000)}`;

    const listing = await withIdempotency(
      supabaseService.getClient(),
      userId,
      'marketplace_boost',
      idempotencyKey,
      async () => supabaseService.boostMarketplaceListing(id, userId, durationHours)
    );

    await invalidateListingCaches(cacheService, id);
    await cacheService.deletePattern('marketplace:listings:*');

    res.json({ success: true, data: listing });
  })
);

// POST /api/v1/marketplace/listings/:id/reports - Report listing
router.post(
  '/listings/:id/reports',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { id } = req.params;
    const { reason, details } = req.body;
    const userId = req.user?.id;

    logger.debug('Reporting listing', { id, userId, reason });

    const report = await supabaseService.reportMarketplaceListing(id, userId, { reason, details });

    res.status(201).json({
      success: true,
      data: report,
    });
  })
);

// POST /api/v1/marketplace/transactions - Legacy; use orders flow instead
router.post(
  '/transactions',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (_req: any, res: any) => {
    res.status(400).json({
      success: false,
      error: 'Use POST /listings/:id/buy-now or the orders API instead.',
    });
  })
);

// ============ SELLER DASHBOARD ROUTES ============

// GET /api/v1/marketplace/my-listings - Get seller's own listings
router.get(
  '/my-listings',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = req.user?.id;
    const { status } = req.query;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    logger.debug('Fetching seller listings', { userId, status });

    const listings = await supabaseService.getListingsBySeller(userId, status as string | undefined);

    res.json({
      success: true,
      data: listings,
    });
  })
);

// GET /api/v1/marketplace/stats - Get seller stats
router.get(
  '/stats',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    logger.debug('Fetching seller stats', { userId });

    const stats = await supabaseService.getSellerStats(userId);

    res.json({
      success: true,
      data: stats,
    });
  })
);

// PUT /api/v1/marketplace/listings/:id/status - Update listing status
router.put(
  '/listings/:id/status',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const { id } = req.params;
    const { status } = req.body;
    const userId = req.user?.id;

    if (!['active', 'inactive', 'sold'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status. Must be active, inactive, or sold',
      });
    }

    logger.debug('Updating listing status', { id, userId, status });

    try {
      const listing = await supabaseService.updateListingStatus(id, status, userId);

      // Invalidate caches
      await invalidateListingCaches(cacheService, id);
      await cacheService.deletePattern('marketplace:listings:*');
      await invalidateSellerAnalyticsCache(userId);

      res.json({
        success: true,
        data: listing,
      });
    } catch (error: any) {
      res.status(403).json({
        success: false,
        error: clientErrorMessage(error),
      });
    }
  })
);

// ============ FAVORITES ROUTES ============

// GET /api/v1/marketplace/favorites - Get user's favorites
router.get(
  '/favorites',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = req.user?.id;

    logger.debug('Fetching user favorites', { userId });

    const favorites = await supabaseService.getUserFavorites(userId);

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

    const result = await supabaseService.addFavorite(userId, listingId);

    try {
      const { notifySellerFavoriteMilestone } = await import('../services/marketplaceFavoriteMilestones');
      await notifySellerFavoriteMilestone(supabaseService, listingId);
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

    await supabaseService.removeFavorite(userId, listingId);

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

    const isFavorited = await supabaseService.isListingFavorited(userId, listingId);

    res.json({
      success: true,
      data: { isFavorited },
    });
  })
);

// ============ INQUIRIES ROUTES ============

// GET /api/v1/marketplace/inquiries - Get user's inquiries (as seller)
router.get(
  '/inquiries',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = req.user?.id;
    const { status, role = 'seller' } = req.query;

    logger.debug('Fetching inquiries', { userId, status, role });

    let inquiries;
    if (role === 'buyer') {
      inquiries = await supabaseService.getBuyerInquiries(userId);
    } else {
      inquiries = await supabaseService.getSellerInquiries(userId, status);
    }

    res.json({
      success: true,
      data: inquiries,
    });
  })
);

// POST /api/v1/marketplace/inquiries - Create inquiry (contact seller)
router.post(
  '/inquiries',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const buyerId = req.user?.id;
    const { listingId, listing_id, message } = req.body;
    
    // Accept both camelCase and snake_case
    const finalListingId = listingId || listing_id;

    logger.debug('Creating inquiry request body:', req.body);

    if (!finalListingId || !message) {
      return res.status(400).json({
        success: false,
        error: 'listingId and message are required',
      });
    }

    if (!buyerId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    logger.debug('Creating inquiry', { buyerId, listingId: finalListingId });

    // Get listing to find seller
    const listing = await supabaseService.getMarketplaceListingById(finalListingId);
    if (!listing) {
      return res.status(404).json({
        success: false,
        error: 'Listing not found',
      });
    }

    if (listing.user_id === buyerId) {
      return res.status(400).json({
        success: false,
        error: 'You cannot inquire about your own listing',
      });
    }

    // Send DM to seller with listing context
    const dmMessage = `📦 Inquiry about: "${listing.title}"\n\n${message}`;
    const sortedIds = [buyerId, listing.user_id].sort();
    const threadId = sortedIds.join('-');

    const existingInquiry = await supabaseService.getInquiryByListingAndBuyer(finalListingId, buyerId);
    if (existingInquiry) {
      return res.status(200).json({
        success: true,
        data: {
          ...existingInquiry,
          dm_thread_id: existingInquiry.dm_thread_id || threadId,
        },
        existing: true,
      });
    }

    const inquiry = await supabaseService.createInquiry(
      finalListingId,
      buyerId,
      listing.user_id,
      threadId,
      message
    );

    await supabaseService.sendDirectMessage(buyerId, listing.user_id, dmMessage, {
      bypassPrivacy: true,
    });

    // Get buyer name for notification
    const buyerProfile = await supabaseService.fetchUserProfile(buyerId);

    // Create notification for seller
    await supabaseService.createInquiryNotification(
      listing.user_id,
      buyerProfile?.name || 'Someone',
      listing.title,
      inquiry.id
    );

    res.status(201).json({
      success: true,
      data: {
        inquiry,
        threadId,
      },
    });
  })
);

// PUT /api/v1/marketplace/inquiries/:id/status - Update inquiry status
router.put(
  '/inquiries/:id/status',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const { id } = req.params;
    const { status } = req.body;
    const userId = req.user?.id;

    if (!['open', 'negotiating', 'closed', 'purchased'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status',
      });
    }

    logger.debug('Updating inquiry status', { id, userId, status });

    try {
      const inquiry = await supabaseService.updateInquiryStatus(id, status, userId);

      res.json({
        success: true,
        data: inquiry,
      });
    } catch (error: any) {
      const statusCode = error?.statusCode === 404 || error?.message === 'Inquiry not found' ? 404 : 403;
      res.status(statusCode).json({
        success: false,
        error: statusCode === 404 ? 'Inquiry not found' : clientErrorMessage(error),
      });
    }
  })
);

// GET /api/v1/marketplace/inquiries/thread/:threadId - Get inquiry by DM thread
router.get(
  '/inquiries/thread/:threadId',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const { threadId } = req.params;

    const userId = req.user?.id;
    logger.debug('Fetching inquiry by thread', { threadId, userId });

    const inquiry = await supabaseService.getInquiryByThread(threadId);
    if (!inquiry) {
      return res.json({ success: true, data: null });
    }

    const listingOwnerId = inquiry.listing?.user_id ?? inquiry.listing?.userId;
    if (
      inquiry.buyer_id !== userId
      && inquiry.seller_id !== userId
      && listingOwnerId !== userId
    ) {
      return res.status(404).json({ success: false, error: 'Inquiry not found' });
    }

    res.json({
      success: true,
      data: inquiry,
    });
  })
);

// ============================================================
// OFFERS ENDPOINTS
// ============================================================

// POST /api/v1/marketplace/offers - Create an offer
router.post(
  '/offers',
  authMiddleware,
  idempotencyMiddleware({ operation: 'marketplace_create_offer' }),
  asyncHandler(async (req: IdempotentRequest, res: any) => {
    const userId = req.user!.id!;
    const { listingId, amount, message } = req.body;

    if (!listingId || !amount || amount <= 0) {
      return res.status(400).json({ success: false, error: 'listingId and a positive amount are required' });
    }

    logger.info('Creating marketplace offer', { userId, listingId, amount });

    const listing = await supabaseService.getMarketplaceListingById(listingId);
    if (!listing) {
      return res.status(404).json({ success: false, error: 'Listing not found' });
    }
    if (listing.user_id === userId) {
      return res.status(400).json({ success: false, error: 'Cannot make an offer on your own listing' });
    }

    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    const result = await req.runIdempotent!(async () => {
      const { data, error } = await supabaseService.getClient()
        .from('marketplace_offers')
        .insert({
          listing_id: listingId,
          buyer_id: userId,
          seller_id: listing.user_id,
          amount,
          message: message || null,
          status: 'pending',
          expires_at: expiresAt,
        })
        .select('*')
        .single();

      if (error) {
        if (error.code === '23505') {
          const { data: existing, error: existingError } = await supabaseService.getClient()
            .from('marketplace_offers')
            .select('*')
            .eq('listing_id', listingId)
            .eq('buyer_id', userId)
            .eq('status', 'pending')
            .maybeSingle();
          if (existingError) throw existingError;
          if (existing) {
            return { data: existing as Record<string, unknown>, existing: true, status: 200 };
          }
        }
        throw error;
      }

      try {
        await supabaseService.createNotification(listing.user_id, {
          type: 'marketplace_order_update',
          message: `New offer of ₦${Number(amount).toLocaleString()} on "${listing.title}"`,
          link: `marketplace:offer:${data.id}`,
          data: { offerId: data.id, listingId },
        });
      } catch (e) {
        logger.warn('Failed to send offer notification', e);
      }

      return { data: data as Record<string, unknown>, existing: false, status: 201 };
    });

    res.status(Number(result.status) || 201).json({
      success: true,
      data: result.data,
      ...(result.existing ? { existing: true } : {}),
    });
  })
);

// GET /api/v1/marketplace/offers - Get user's offers (buyer or seller)
router.get(
  '/offers',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = req.user.id;
    const { role = 'buyer' } = req.query;

    const column = role === 'seller' ? 'seller_id' : 'buyer_id';

    const { data, error } = await supabaseService.getClient()
      .from('marketplace_offers')
      .select('*, listing:marketplace_listings(id, title, price, images, status, category), buyer:profiles!marketplace_offers_buyer_id_fkey(id, name, avatar_url), seller:profiles!marketplace_offers_seller_id_fkey(id, name, avatar_url)')
      .eq(column, userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({ success: true, data: data || [] });
  })
);

// PUT /api/v1/marketplace/offers/:id - Respond to offer (accept/decline/counter/withdraw)
router.put(
  '/offers/:id',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = req.user.id;
    const { id } = req.params;
    const { action, counterAmount } = req.body;

    if (!['accept', 'decline', 'counter', 'withdraw'].includes(action)) {
      return res.status(400).json({ success: false, error: 'Invalid action. Must be accept, decline, counter, or withdraw' });
    }

    // Fetch the offer
    const { data: offer, error: fetchErr } = await supabaseService.getClient()
      .from('marketplace_offers')
      .select('*, listing:marketplace_listings(id, title, price)')
      .eq('id', id)
      .single();

    if (fetchErr || !offer) {
      return res.status(404).json({ success: false, error: 'Offer not found' });
    }

    if (offer.buyer_id !== userId && offer.seller_id !== userId) {
      return res.status(404).json({ success: false, error: 'Offer not found' });
    }

    // Authorization checks
    if (action === 'withdraw' && offer.buyer_id !== userId) {
      return res.status(403).json({ success: false, error: 'Only the buyer can withdraw an offer' });
    }
    if (['accept', 'decline', 'counter'].includes(action) && offer.seller_id !== userId) {
      return res.status(403).json({ success: false, error: 'Only the seller can accept, decline, or counter an offer' });
    }
    if (offer.status !== 'pending') {
      return res.status(400).json({ success: false, error: `Cannot ${action} an offer with status "${offer.status}"` });
    }

    let updatedOffer;

    if (action === 'counter') {
      if (!counterAmount || counterAmount <= 0) {
        return res.status(400).json({ success: false, error: 'counterAmount is required for counter offers' });
      }

      // Update original offer status to 'countered'
      await supabaseService.getClient()
        .from('marketplace_offers')
        .update({ status: 'countered', counter_amount: counterAmount })
        .eq('id', id);

      // Create a new counter-offer (seller → buyer)
      const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
      const { data: counterOffer, error: counterErr } = await supabaseService.getClient()
        .from('marketplace_offers')
        .insert({
          listing_id: offer.listing_id,
          buyer_id: offer.buyer_id,
          seller_id: offer.seller_id,
          amount: counterAmount,
          status: 'pending',
          parent_offer_id: id,
          expires_at: expiresAt,
          message: `Counter offer from seller`,
        })
        .select('*')
        .single();

      if (counterErr) throw counterErr;
      updatedOffer = counterOffer;

      // Notify buyer of counter
      try {
        await supabaseService.createNotification(offer.buyer_id, {
          type: 'marketplace_order_update',
          message: `Seller countered with ₦${Number(counterAmount).toLocaleString()} on "${offer.listing?.title || 'listing'}"`,
          link: `marketplace:offer:${counterOffer.id}`,
          data: { offerId: counterOffer.id },
        });
      } catch (e) {
        logger.warn('Failed to send counter notification', e);
      }
    } else if (action === 'accept') {
      // Atomic accept + order (RPC) with idempotency for retries (CONC-05).
      const idempotencyKey =
        normalizeIdempotencyKey(req.headers['idempotency-key']) ||
        `${userId}:offer_accept:${id}`;

      try {
        const result = await withIdempotency(
          supabaseService.getClient(),
          userId,
          'marketplace_offer_accept',
          idempotencyKey,
          async () => {
            const finalized = await supabaseService.finalizeOfferAcceptSale(id, userId);
            const { data: acceptedOffer, error: acceptedErr } = await supabaseService
              .getClient()
              .from('marketplace_offers')
              .select('*')
              .eq('id', id)
              .maybeSingle();
            if (acceptedErr) throw acceptedErr;
            if (!acceptedOffer) throw new Error('Offer not found after accept');
            return {
              offer: acceptedOffer,
              orderId: finalized.orderId,
            };
          }
        );

        updatedOffer = result.offer;
        await invalidateSellerAnalyticsCache(offer.seller_id);
        // Buyer/seller notifications are sent inside createOrderFromOfferAccept.
      } catch (finalizeErr) {
        logger.error('Failed to finalize offer accept sale', finalizeErr);
        return res.status(500).json({
          success: false,
          error: clientErrorMessage(finalizeErr, 'Failed to create order from accepted offer'),
        });
      }
    } else {
      // decline or withdraw — conditional update prevents double-action races
      const nextStatus = action === 'decline' ? 'declined' : 'withdrawn';
      const { data, error: updateErr } = await supabaseService.getClient()
        .from('marketplace_offers')
        .update({ status: nextStatus })
        .eq('id', id)
        .eq('status', 'pending')
        .select('*')
        .maybeSingle();

      if (updateErr) throw updateErr;
      if (!data) {
        return res.status(409).json({
          success: false,
          error: `Cannot ${action} an offer that is no longer pending`,
        });
      }
      updatedOffer = data;

      const notifyUserId = action === 'withdraw' ? offer.seller_id : offer.buyer_id;
      const actionText = action === 'decline' ? 'declined' : 'withdrawn';
      try {
        await supabaseService.createNotification(notifyUserId, {
          type: 'marketplace_order_update',
          message: `Offer of ₦${Number(offer.amount).toLocaleString()} on "${offer.listing?.title || 'listing'}" was ${actionText}`,
          link: `marketplace:offer:${id}`,
          data: { offerId: id, action },
        });
      } catch (e) {
        logger.warn('Failed to send offer response notification', e);
      }
    }

    res.json({ success: true, data: updatedOffer });
  })
);

// GET /api/v1/marketplace/listings/:id/offers - Get all offers for a listing (seller only)
router.get(
  '/listings/:id/offers',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = req.user.id;
    const { id } = req.params;

    // Verify user is the listing owner
    const listing = await supabaseService.getMarketplaceListingById(id);
    if (!listing || listing.user_id !== userId) {
      return res.status(403).json({ success: false, error: 'Only the listing owner can view offers' });
    }

    const { data, error } = await supabaseService.getClient()
      .from('marketplace_offers')
      .select('*, buyer:profiles!marketplace_offers_buyer_id_fkey(id, name, avatar_url)')
      .eq('listing_id', id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({ success: true, data: data || [] });
  })
);

// ============================================================
// SAVED SEARCHES ENDPOINTS
// ============================================================

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

    const { data, error } = await supabaseService.getClient()
      .from('saved_searches')
      .insert({
        user_id: userId,
        name: searchName,
        filters,
        notify: true,
      })
      .select('*')
      .single();

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

    const { data, error } = await supabaseService.getClient()
      .from('saved_searches')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

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

    const { error } = await supabaseService.getClient()
      .from('saved_searches')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

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

    const { data, error } = await supabaseService.getClient()
      .from('saved_searches')
      .update(patch)
      .eq('id', id)
      .eq('user_id', userId)
      .select('*')
      .single();

    if (error) throw error;
    res.json({ success: true, data });
  })
);

// GET /api/v1/marketplace/saved-searches/:id/matches - Check for new matches
router.get(
  '/saved-searches/:id/matches',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = req.user.id;
    const { id } = req.params;

    // Get the saved search
    const { data: search, error: searchErr } = await supabaseService.getClient()
      .from('saved_searches')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (searchErr || !search) {
      return res.status(404).json({ success: false, error: 'Saved search not found' });
    }

    // Build query for new listings since last_checked_at
    let query = supabaseService.getClient()
      .from('marketplace_listings')
      .select('id, title, price, images, category, location, created_at')
      .eq('status', 'active')
      .gt('created_at', search.last_checked_at);

    const f = search.filters;
    if (f.category) query = query.eq('category', f.category);
    if (f.search) query = query.or(`title.ilike.%${f.search}%,description.ilike.%${f.search}%`);
    if (f.minPrice) query = query.gte('price', f.minPrice);
    if (f.maxPrice) query = query.lte('price', f.maxPrice);
    if (f.location) query = query.ilike('location', `%${f.location}%`);

    query = query.order('created_at', { ascending: false }).limit(20);

    const { data: listings, error: listErr } = await query;
    if (listErr) throw listErr;

    // Update last_checked_at
    await supabaseService.getClient()
      .from('saved_searches')
      .update({ last_checked_at: new Date().toISOString() })
      .eq('id', id);

    res.json({
      success: true,
      data: { count: listings?.length || 0, listings: listings || [] },
    });
  })
);

// ============================================================
// CUSTOM CATEGORIES ENDPOINTS
// ============================================================

// GET /api/v1/marketplace/categories/custom - List custom categories
router.get(
  '/categories/custom',
  asyncHandler(async (req: any, res: any) => {
    const cacheKey = 'marketplace:custom_categories';
    const cached = cacheService.get(cacheKey);
    if (cached) {
      return res.json({ success: true, data: cached });
    }

    const categories = await supabaseService.getCustomCategories();
    cacheService.set(cacheKey, categories, 300); // 5 min cache
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

    const category = await supabaseService.createCustomCategory(trimmedName, userId);
    cacheService.deletePattern('marketplace:custom_categories');
    res.status(201).json({ success: true, data: category });
  })
);

// ============================================================
// SIMILAR LISTINGS ENDPOINT
// ============================================================

// GET /api/v1/marketplace/listings/:id/similar - Get similar listings
router.get(
  '/listings/:id/similar',
  validateListingId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { id } = req.params;

    const similarCacheKey = `marketplace:similar:${id}`;
    const cached = await cacheService.get<any[]>(similarCacheKey);
    if (cached) {
      return res.json({ success: true, data: cached });
    }

    // Get the source listing
    const listing = await supabaseService.getMarketplaceListingById(id);
    if (!listing) {
      return res.status(404).json({ success: false, error: 'Listing not found' });
    }

    // Query similar: same category, ±30% price, active, exclude self
    let query = supabaseService.getClient()
      .from('marketplace_listings')
      .select('id, title, price, images, category, location, created_at, status')
      .eq('category', listing.category)
      .eq('status', 'active')
      .neq('id', id);

    if (listing.price) {
      const minP = listing.price * 0.7;
      const maxP = listing.price * 1.3;
      query = query.gte('price', minP).lte('price', maxP);
    }

    query = query.order('created_at', { ascending: false }).limit(6);

    const { data, error } = await query;
    if (error) throw error;

    const result = data || [];
    await cacheService.set(similarCacheKey, result, 300); // 5 min cache
    res.json({ success: true, data: result });
  })
);

// GET /api/v1/marketplace/listings/:id/full - Batched detail page load
// Returns listing + isFavorited + similarListings in a single round trip.
router.get(
  '/listings/:id/full',
  optionalAuthMiddleware,
  validateListingId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { id } = req.params;
    const viewerId = req.user?.id as string | undefined;

    // --- 1. Listing (active for public; owner/admin may see non-active) ---
    const listingCacheKey = viewerId ? null : `marketplace:listing:public:${id}`;
    let listing = listingCacheKey ? await cacheService.get<any>(listingCacheKey) : null;
    if (!listing) {
      listing = await supabaseService.getMarketplaceListingForViewer(id, viewerId);
      if (!listing) {
        return res.status(404).json({ success: false, error: 'Listing not found' });
      }
      if (listingCacheKey && listing.status === 'active') {
        await cacheService.set(listingCacheKey, listing, 600);
      }
    }

    await supabaseService.incrementListingViews(id);
    listing = { ...listing, views_count: (listing.views_count || 0) + 1 };
    if (listingCacheKey && listing.status === 'active') {
      await cacheService.set(listingCacheKey, listing, 600);
    }

    // --- 2. Similar listings (cached 5 min, shared across all users) ---
    const similarCacheKey = `marketplace:similar:${id}`;
    let similarListings = await cacheService.get<any[]>(similarCacheKey);
    if (!similarListings) {
      let query = supabaseService.getClient()
        .from('marketplace_listings')
        .select('id, title, price, images, category, location, created_at, status')
        .eq('category', listing.category)
        .eq('status', 'active')
        .neq('id', id);

      if (listing.price) {
        query = query
          .gte('price', listing.price * 0.7)
          .lte('price', listing.price * 1.3);
      }
      query = query.order('created_at', { ascending: false }).limit(6);
      const { data } = await query;
      similarListings = data || [];
      await cacheService.set(similarCacheKey, similarListings, 300);
    }

    // --- 3. isFavorited (session user only — never trust query userId) ---
    let isFavorited = false;
    if (viewerId) {
      isFavorited = await supabaseService.isListingFavorited(viewerId, id);
    }

    res.json({
      success: true,
      data: { listing, isFavorited, similarListings },
    });
  })
);

// ============================================================
// SELLER PROFILE ENDPOINT
// ============================================================

// GET /api/v1/marketplace/sellers/:userId/profile - Get seller profile
// SEC-08: Public viewers get reputation-safe aggregates only; owner gets private metrics.
router.get(
  '/sellers/:userId/profile',
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { userId } = req.params;
    const isOwner = req.user?.id === userId;
    const profileScope = isOwner ? 'owner' : 'public';

    const cacheKey = CacheKeys.sellerProfile(userId, profileScope);
    const cached = await cacheService.get<any>(cacheKey);
    if (cached) {
      return res.json({ success: true, data: cached });
    }

    // Get profile
    const { data: profile, error: profileErr } = await supabaseService.getClient()
      .from('profiles')
      .select('id, name, avatar_url, created_at')
      .eq('id', userId)
      .single();

    if (profileErr || !profile) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Get all listings
    const { data: allListings } = await supabaseService.getClient()
      .from('marketplace_listings')
      .select('id, title, price, images, category, location, status, views_count, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    const listings = allListings || [];
    const activeListings = listings.filter((l) => l.status === 'active');
    const soldCount = listings.filter((l) => l.status === 'sold').length;
    // Public: active listings only. Owner: full inventory for private dashboard stats.
    const visibleListings = isOwner ? listings : activeListings;

    // Reviews only on listings the viewer is allowed to know about
    const reviewListingIds = isOwner
      ? listings.map((l) => l.id)
      : activeListings.map((l) => l.id);
    let allReviews: any[] = [];
    if (reviewListingIds.length > 0) {
      const { data: reviews } = await supabaseService.getClient()
        .from('marketplace_reviews')
        .select('id, listing_id, reviewer_id, rating, comment, created_at, reviewer:profiles!marketplace_reviews_reviewer_id_fkey(id, name, avatar_url)')
        .in('listing_id', reviewListingIds)
        .order('created_at', { ascending: false });
      allReviews = reviews || [];
    }

    const avgRating = allReviews.length > 0
      ? allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length
      : 0;
    const roundedAvg = Math.round(avgRating * 10) / 10;

    // Add listing title to reviews for display
    const reviewsWithTitle = allReviews.slice(0, 10).map(r => ({
      ...r,
      listing_title: visibleListings.find(l => l.id === r.listing_id)?.title || 'Unknown listing',
    }));

    const isVerified = soldCount >= 5 && avgRating >= 4.5 && allReviews.length >= 3;
    const badges = [
      ...(soldCount >= 5 && avgRating >= 4.5
        ? [{ id: 'trusted_seller', label: 'Trusted seller', icon: 'shield' }]
        : []),
      ...(soldCount >= 10
        ? [{ id: 'top_seller', label: 'Top seller', icon: 'star' }]
        : []),
    ];

    let stats: Record<string, number | boolean>;
    if (isOwner) {
      let totalFavorites = 0;
      let totalInquiries = 0;
      const ownerListingIds = listings.map((l) => l.id);
      if (ownerListingIds.length > 0) {
        const [{ count: favCount }, { count: inquiryCount }] = await Promise.all([
          supabaseService.getClient()
            .from('marketplace_favorites')
            .select('id', { count: 'exact', head: true })
            .in('listing_id', ownerListingIds),
          supabaseService.getClient()
            .from('marketplace_inquiries')
            .select('id', { count: 'exact', head: true })
            .in('listing_id', ownerListingIds),
        ]);
        totalFavorites = favCount || 0;
        totalInquiries = inquiryCount || 0;
      }
      const totalViews = listings.reduce((sum, l) => sum + (l.views_count || 0), 0);
      stats = {
        totalListings: listings.length,
        activeListings: activeListings.length,
        soldListings: soldCount,
        totalViews,
        totalInquiries,
        totalFavorites,
        avgRating: roundedAvg,
        totalReviews: allReviews.length,
        isVerified,
      };
    } else {
      // Public: no inquiries, favorites, views, or sold/inventory internals
      stats = {
        activeListings: activeListings.length,
        avgRating: roundedAvg,
        totalReviews: allReviews.length,
        isVerified,
      };
    }

    const responseData = {
      user: profile,
      stats,
      badges,
      recentListings: activeListings.slice(0, 6),
      recentReviews: reviewsWithTitle,
    };

    await cacheService.set(cacheKey, responseData, CacheTTL.sellerProfile);

    res.json({
      success: true,
      data: responseData,
    });
  })
);

// ============================================================
// ORDERS ENDPOINTS
// ============================================================

router.get(
  '/orders',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = req.user.id;
    const role = req.query.role === 'seller' ? 'seller' : 'buyer';
    const orders = await getMarketplaceOrdersService(supabaseService).getOrdersForUser(
      userId,
      role
    );
    res.json({ success: true, data: orders });
  })
);

router.get(
  '/orders/inquiry/:inquiryId',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const order = await getMarketplaceOrdersService(supabaseService).getOrderForInquiry(
      req.params.inquiryId,
      req.user.id
    );
    res.json({ success: true, data: order });
  })
);

router.get(
  '/orders/:id',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    try {
      const order = await getMarketplaceOrdersService(supabaseService).getOrderById(
        req.params.id,
        req.user.id
      );
      if (!order) {
        return res.status(404).json({ success: false, error: 'Order not found' });
      }
      res.json({ success: true, data: order });
    } catch (err: any) {
      res.status(403).json({ success: false, error: clientErrorMessage(err) });
    }
  })
);

router.patch(
  '/orders/:id',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const { action, meetingLocation, sellerNote, fulfillmentMode } = req.body;
    if (!action) {
      return res.status(400).json({ success: false, error: 'action is required' });
    }

    try {
      const ordersService = getMarketplaceOrdersService(supabaseService);
      const existingOrder = await ordersService.getOrderById(req.params.id, req.user.id);
      if (!existingOrder) {
        return res.status(404).json({ success: false, error: 'Order not found or access denied' });
      }

      if (meetingLocation || sellerNote || fulfillmentMode) {
        await supabaseService.getClient()
          .from('marketplace_orders')
          .update({
            ...(meetingLocation ? { meeting_location: meetingLocation } : {}),
            ...(sellerNote ? { seller_note: sellerNote } : {}),
            ...(fulfillmentMode ? { fulfillment_mode: fulfillmentMode } : {}),
          })
          .eq('id', req.params.id)
          .or(`buyer_id.eq.${req.user.id},seller_id.eq.${req.user.id}`);
      }
      const order = await ordersService.updateOrderStatus(
        req.params.id,
        req.user.id,
        action
      );
      await invalidateSellerAnalyticsCache(order.seller_id);
      res.json({ success: true, data: order });
    } catch (err: any) {
      res.status(400).json({ success: false, error: clientErrorMessage(err) });
    }
  })
);

router.post(
  '/orders/:id/payment-link',
  authMiddleware,
  idempotencyMiddleware({ operation: 'marketplace_payment_link' }),
  asyncHandler(async (req: IdempotentRequest, res: any) => {
    try {
      const result = await req.runIdempotent!(async () => {
        const data = await getMarketplaceOrdersService(supabaseService).createPaymentLinkOrder(
          req.params.id,
          req.user!.id!
        );
        return { data: data as unknown as Record<string, unknown> };
      });
      res.json({ success: true, data: result.data });
    } catch (err: any) {
      res.status(400).json({ success: false, error: clientErrorMessage(err) });
    }
  })
);

router.get(
  '/analytics/seller',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const cacheKey = `marketplace:analytics:seller:${req.user.id}`;
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      return res.json({ success: true, data: cached });
    }
    const analytics = await getMarketplaceOrdersService(supabaseService).getSellerAnalytics(
      req.user.id
    );
    await cacheService.set(cacheKey, analytics, 120);
    res.json({ success: true, data: analytics });
  })
);

router.get(
  '/seller/buyers',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const segment = typeof req.query.segment === 'string' ? req.query.segment : undefined;
    const buyers = await getMarketplaceOrdersService(supabaseService).getSellerBuyersWithSegments(
      req.user.id,
      segment
    );
    res.json({ success: true, data: buyers });
  })
);

// ============================================================
// SELLER COUPONS
// ============================================================

router.get(
  '/coupons',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const { getMarketplaceCouponsService } = await import('../services/marketplaceCoupons');
    const coupons = await getMarketplaceCouponsService(supabaseService).listForSeller(req.user.id);
    res.json({ success: true, data: coupons });
  })
);

router.post(
  '/coupons',
  authMiddleware,
  idempotencyMiddleware({ operation: 'marketplace_create_coupon' }),
  asyncHandler(async (req: IdempotentRequest, res: any) => {
    const { code, discountType, discountValue, listingId, maxUses, startsAt, endsAt } = req.body;
    if (!code || !discountType || discountValue == null) {
      return res.status(400).json({ success: false, error: 'code, discountType, and discountValue are required' });
    }
    const { getMarketplaceCouponsService } = await import('../services/marketplaceCoupons');
    const result = await req.runIdempotent!(async () => {
      const coupon = await getMarketplaceCouponsService(supabaseService).createCoupon(req.user!.id!, {
        code,
        discountType,
        discountValue: Number(discountValue),
        listingId,
        maxUses: maxUses != null ? Number(maxUses) : undefined,
        startsAt,
        endsAt,
      });
      return { coupon: coupon as unknown as Record<string, unknown> };
    });
    res.status(201).json({ success: true, data: result.coupon });
  })
);

router.post(
  '/coupons/validate',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const { code, listingId } = req.body;
    if (!code || !listingId) {
      return res.status(400).json({ success: false, error: 'code and listingId are required' });
    }
    const listing = await supabaseService.getMarketplaceListingById(listingId);
    if (!listing) {
      return res.status(404).json({ success: false, error: 'Listing not found' });
    }
    const { getMarketplaceCouponsService } = await import('../services/marketplaceCoupons');
    const result = await getMarketplaceCouponsService(supabaseService).validateForListing(
      code,
      listing,
      req.user.id
    );
    res.json({
      success: true,
      data: {
        code: result.coupon.code,
        discountAmount: result.discountAmount,
        finalAmount: result.finalAmount,
        baseAmount: result.baseAmount,
      },
    });
  })
);

// ============================================================
// TIER 2: SELLER TOOLS (campaigns, bundles, preferences)
// ============================================================

router.get(
  '/seller/preferences',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const { getMarketplaceSellerToolsService } = await import('../services/marketplaceSellerTools');
    const prefs = await getMarketplaceSellerToolsService(supabaseService).getPreferences(req.user.id);
    res.json({ success: true, data: prefs });
  })
);

router.put(
  '/seller/preferences',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const { getMarketplaceSellerToolsService } = await import('../services/marketplaceSellerTools');
    const prefs = await getMarketplaceSellerToolsService(supabaseService).updatePreferences(
      req.user.id,
      {
        hallDropoffEnabled: req.body?.hallDropoffEnabled,
        hallDropoffMinAmount: req.body?.hallDropoffMinAmount,
        requirePaymentConfirmation: req.body?.requirePaymentConfirmation,
        favoriteAlertThreshold: req.body?.favoriteAlertThreshold,
      }
    );
    res.json({ success: true, data: prefs });
  })
);

router.get(
  '/sellers/:userId/pickup-nudge',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const { getMarketplaceSellerToolsService } = await import('../services/marketplaceSellerTools');
    const nudge = await getMarketplaceSellerToolsService(supabaseService).getPickupNudge(
      req.params.userId,
      req.user?.id
    );
    res.json({ success: true, data: nudge });
  })
);

router.post(
  '/seller/campaigns',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const { message, segment, buyerIds } = req.body || {};
    const { getMarketplaceSellerToolsService } = await import('../services/marketplaceSellerTools');
    const result = await getMarketplaceSellerToolsService(supabaseService).sendCampaign(
      req.user.id,
      { message, segment, buyerIds }
    );
    res.json({ success: true, data: result });
  })
);

router.post(
  '/bundles',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const { title, description, price, listingIds, images, location, category } = req.body || {};
    const { getMarketplaceSellerToolsService } = await import('../services/marketplaceSellerTools');
    const bundle = await getMarketplaceSellerToolsService(supabaseService).createBundle(
      req.user.id,
      {
        title,
        description,
        price: Number(price),
        listingIds,
        images,
        location,
        category,
      }
    );
    await cacheService.deletePattern('marketplace:listings:*');
    res.status(201).json({ success: true, data: bundle });
  })
);

router.get(
  '/seller/onboarding',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const { getMarketplaceSellerToolsService } = await import('../services/marketplaceSellerTools');
    const status = await getMarketplaceSellerToolsService(supabaseService).getOnboardingStatus(
      req.user.id
    );
    res.json({ success: true, data: status });
  })
);

router.post(
  '/seller/onboarding/complete',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const { getMarketplaceSellerToolsService } = await import('../services/marketplaceSellerTools');
    const prefs = await getMarketplaceSellerToolsService(supabaseService).completeOnboarding(
      req.user.id
    );
    res.json({ success: true, data: prefs });
  })
);

router.post(
  '/orders/:id/payment-proof',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const { proofUrl } = req.body || {};
    try {
      const order = await getMarketplaceOrdersService(supabaseService).submitPaymentProof(
        req.params.id,
        req.user.id,
        proofUrl
      );
      res.json({ success: true, data: order });
    } catch (err: any) {
      res.status(400).json({ success: false, error: clientErrorMessage(err) });
    }
  })
);

router.get(
  '/listings/:id/offers-history',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const listing = await supabaseService.getMarketplaceListingById(req.params.id);
    if (!listing || listing.user_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Only the listing owner can view offer history' });
    }
    const { data, error } = await supabaseService.getClient()
      .from('marketplace_offers')
      .select('*, buyer:profiles!marketplace_offers_buyer_id_fkey(id, name, avatar_url)')
      .eq('listing_id', req.params.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  })
);

export default router;