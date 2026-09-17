/**
 * Seller-side surfaces: the dashboard (my listings, summary, stats, status
 * flips), the public and owner views of a seller profile and shop, seller
 * analytics, coupons, and the Tier 2 seller tools (preferences, fulfilment
 * hints, campaigns, bundles, onboarding).
 *
 * SEC-08: `GET /sellers/:userId/profile` gives public viewers reputation-safe
 * aggregates only; the owner gets the private metrics.
 */
import { Router } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { authMiddleware } from '../../middleware/auth';
import { handleValidationErrors, validateUserId } from '../../middleware/validation';
import { logger } from '../../utils/logger';
import { clientErrorMessage } from '../../utils/safeError';
import { getMarketplaceOrdersService, invalidateSellerAnalyticsCache } from '../../services/marketplaceOrders';
import { invalidateListingCaches } from '../../utils/marketplaceCache';
import { CacheKeys, CacheTTL } from '../../services/cachePolicy';
import { idempotencyMiddleware, type IdempotentRequest } from '../../middleware/idempotency';
import { MARKETPLACE_DEFAULT_CURRENCY } from '@lantern/shared/marketplace';
import { MarketplaceCampusMetadataError, cacheService, dataLayer, resolveRequiredMarketplaceCampus } from './context';
import { respondMarketplaceClientError } from './errors';
const router = Router();
// ============================================================
// SELLER COUPONS
// ============================================================


// ============================================================
// TIER 2: SELLER TOOLS (campaigns, bundles, preferences)
// ============================================================


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

    const listings = await dataLayer.marketplace.getListingsBySeller(userId, status as string | undefined);

    res.json({
      success: true,
      data: listings,
    });
  })
);

// GET /api/v1/marketplace/summary - Every Shop badge and the seller's payout
// balances in one round-trip. Replaces the eight reads the client used to make.
router.get(
  '/summary',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const { computeShopSummary } = await import('../../services/marketplaceSummary');
    const data = await computeShopSummary(
      dataLayer.getClient(),
      userId,
      (id) => dataLayer.readState.getAllDMUnreadCounts(id),
    );
    res.json({ success: true, data });
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

    const stats = await dataLayer.marketplace.getSellerStats(userId);

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
      const listing = await dataLayer.marketplace.updateListingStatus(id, status, userId);

      // Invalidate caches
      await invalidateListingCaches(cacheService, id);
      await cacheService.deletePattern('marketplace:listings:*');
      await invalidateSellerAnalyticsCache(userId);

      res.json({
        success: true,
        data: listing,
      });
    } catch (error: any) {
      // Lifecycle refusals carry their own 4xx (403 moderation/held, 400 unknown).
      const statusCode = typeof error?.statusCode === 'number' ? error.statusCode : 403;
      res.status(statusCode).json({
        success: false,
        error: clientErrorMessage(error),
      });
    }
  })
);

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

    const { getMarketplaceSellerToolsService } = await import('../../services/marketplaceSellerTools');
    const sellerTools = getMarketplaceSellerToolsService(dataLayer);
    const cacheKey = CacheKeys.sellerProfile(userId, profileScope);
    const cached = await cacheService.get<any>(cacheKey);
    if (cached) {
      return res.json({
        success: true,
        data: await sellerTools.signSellerProfileMedia(cached),
      });
    }

    // Get profile
    const { data: profile, error: profileErr } = await dataLayer.getClient()
      .from('profiles')
      .select('id, name, avatar_url, created_at')
      .eq('id', userId)
      .single();

    if (profileErr || !profile) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Get all listings
    const { data: allListings } = await dataLayer.getClient()
      .from('marketplace_listings')
      .select('id, title, price, images, category, location, status, views_count, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    const listings = allListings || [];
    const activeListings = listings.filter((l) => l.status === 'active');
    const reservedListings = listings.filter((l) => l.status === 'reserved');
    const soldCount = listings.filter((l) => l.status === 'sold').length;
    // Shop shelf: active + reserved (reserved shown as sale-in-progress, not buyable).
    const shopShelfListings = [...reservedListings, ...activeListings];
    const visibleListings = isOwner ? listings : shopShelfListings;

    // Reviews only on listings the viewer is allowed to know about
    const reviewListingIds = isOwner
      ? listings.map((l) => l.id)
      : activeListings.map((l) => l.id);
    let allReviews: any[] = [];
    if (reviewListingIds.length > 0) {
      const { data: reviews } = await dataLayer.getClient()
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

    const prefs = await sellerTools.getPreferences(userId);
    const shop = sellerTools.toShopPublic(prefs, profile.name || 'Shop');

    let stats: Record<string, number | boolean>;
    if (isOwner) {
      let totalFavorites = 0;
      let totalInquiries = 0;
      const ownerListingIds = listings.map((l) => l.id);
      if (ownerListingIds.length > 0) {
        const [{ count: favCount }, { count: inquiryCount }] = await Promise.all([
          dataLayer.getClient()
            .from('marketplace_favorites')
            .select('id', { count: 'exact', head: true })
            .in('listing_id', ownerListingIds),
          dataLayer.getClient()
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
        reservedListings: reservedListings.length,
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
        activeListings: activeListings.length + reservedListings.length,
        avgRating: roundedAvg,
        totalReviews: allReviews.length,
        isVerified,
      };
    }

    const responseData = {
      user: profile,
      shop,
      stats,
      badges,
      recentListings: shopShelfListings.slice(0, 8),
      recentReviews: reviewsWithTitle,
    };

    await cacheService.set(cacheKey, responseData, CacheTTL.sellerProfile);

    res.json({
      success: true,
      data: await sellerTools.signSellerProfileMedia(responseData),
    });
  })
);

// PATCH /api/v1/marketplace/sellers/me/shop - Update own light shop branding
router.patch(
  '/sellers/me/shop',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = req.user.id;
    const { shopName, bio, coverImageUrl } = req.body || {};
    const { getMarketplaceSellerToolsService } = await import('../../services/marketplaceSellerTools');
    try {
      const shop = await getMarketplaceSellerToolsService(dataLayer).updateShop(userId, {
        shopName,
        bio,
        coverImageUrl,
      });
      await cacheService.delete(CacheKeys.sellerProfile(userId, 'public'));
      await cacheService.delete(CacheKeys.sellerProfile(userId, 'owner'));
      res.json({ success: true, data: shop });
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : 'Failed to update shop';
      if (/required|characters or fewer|valid marketplace photo/i.test(msg)) {
        return res.status(400).json({ success: false, error: msg });
      }
      throw err;
    }
  })
);

// GET /api/v1/marketplace/shops - Browse active seller shops
router.get(
  '/shops',
  asyncHandler(async (req: any, res: any) => {
    const { getMarketplaceSellerToolsService } = await import('../../services/marketplaceSellerTools');
    const result = await getMarketplaceSellerToolsService(dataLayer).listShops({
      campusId: typeof req.query.campus === 'string' ? req.query.campus : null,
      q: typeof req.query.q === 'string' ? req.query.q : null,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 24,
    });
    res.json({ success: true, data: result.shops, meta: { total: result.total, page: result.page, limit: result.limit } });
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
    const analytics = await getMarketplaceOrdersService(dataLayer).getSellerAnalytics(
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
    const buyers = await getMarketplaceOrdersService(dataLayer).getSellerBuyersWithSegments(
      req.user.id,
      segment
    );
    res.json({ success: true, data: buyers });
  })
);

router.get(
  '/coupons',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const { getMarketplaceCouponsService } = await import('../../services/marketplaceCoupons');
    const coupons = await getMarketplaceCouponsService(dataLayer).listForSeller(req.user.id);
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
    const { getMarketplaceCouponsService } = await import('../../services/marketplaceCoupons');
    try {
      const result = await req.runIdempotent!(async () => {
        const coupon = await getMarketplaceCouponsService(dataLayer).createCoupon(req.user!.id!, {
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
    } catch (err) {
      if (respondMarketplaceClientError(res, err)) return;
      throw err;
    }
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
    const listing = await dataLayer.marketplace.getMarketplaceListingById(listingId);
    if (!listing) {
      return res.status(404).json({ success: false, error: 'Listing not found' });
    }
    const { getMarketplaceCouponsService } = await import('../../services/marketplaceCoupons');
    try {
      const result = await getMarketplaceCouponsService(dataLayer).validateForListing(
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
    } catch (err) {
      // "Invalid coupon code", "Coupon has expired", etc. are user conditions.
      if (respondMarketplaceClientError(res, err)) return;
      throw err;
    }
  })
);

router.get(
  '/seller/preferences',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const { getMarketplaceSellerToolsService } = await import('../../services/marketplaceSellerTools');
    const prefs = await getMarketplaceSellerToolsService(dataLayer).getPreferences(req.user.id);
    res.json({ success: true, data: prefs });
  })
);

router.put(
  '/seller/preferences',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const { getMarketplaceSellerToolsService } = await import('../../services/marketplaceSellerTools');
    const prefs = await getMarketplaceSellerToolsService(dataLayer).updatePreferences(
      req.user.id,
      {
        hallDropoffEnabled: req.body?.hallDropoffEnabled,
        hallDropoffMinAmount: req.body?.hallDropoffMinAmount,
        shippingEnabled: req.body?.shippingEnabled,
        shippingFeeNaira: req.body?.shippingFeeNaira,
        shippingFreeOverNaira: req.body?.shippingFreeOverNaira,
        shipsFromCampusId: req.body?.shipsFromCampusId,
        shipsFromCity: req.body?.shipsFromCity,
        requirePaymentConfirmation: req.body?.requirePaymentConfirmation,
        favoriteAlertThreshold: req.body?.favoriteAlertThreshold,
      }
    );
    res.json({ success: true, data: prefs });
  })
);

router.get(
  '/sellers/:userId/fulfillment',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const { getMarketplaceSellerToolsService } = await import('../../services/marketplaceSellerTools');
    const data = await getMarketplaceSellerToolsService(dataLayer).getPublicFulfillment(
      req.params.userId,
    );
    res.json({ success: true, data });
  })
);

router.get(
  '/sellers/:userId/pickup-nudge',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const { getMarketplaceSellerToolsService } = await import('../../services/marketplaceSellerTools');
    const nudge = await getMarketplaceSellerToolsService(dataLayer).getPickupNudge(
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
    const { getMarketplaceSellerToolsService } = await import('../../services/marketplaceSellerTools');
    try {
      const result = await getMarketplaceSellerToolsService(dataLayer).sendCampaign(
        req.user.id,
        { message, segment, buyerIds }
      );
      res.json({ success: true, data: result });
    } catch (err) {
      if (respondMarketplaceClientError(res, err)) return;
      throw err;
    }
  })
);

router.post(
  '/bundles',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const {
      title,
      description,
      price,
      listingIds,
      images,
      location,
      category,
      campus_id: campusIdSnake,
      campusId: campusIdCamel,
    } = req.body || {};
    let campusMetadata: { campusId: string; countryCode: string };
    try {
      campusMetadata = await resolveRequiredMarketplaceCampus(
        campusIdSnake ?? campusIdCamel,
        location
      );
    } catch (error) {
      if (!(error instanceof MarketplaceCampusMetadataError)) throw error;
      return res.status(400).json({ success: false, error: error.message });
    }
    const { getMarketplaceSellerToolsService } = await import('../../services/marketplaceSellerTools');
    try {
      const bundle = await getMarketplaceSellerToolsService(dataLayer).createBundle(
        req.user.id,
        {
          title,
          description,
          price: Number(price),
          listingIds,
          images,
          location,
          category,
          campusId: campusMetadata.campusId,
          countryCode: campusMetadata.countryCode,
          currency: MARKETPLACE_DEFAULT_CURRENCY,
        }
      );
      await cacheService.deletePattern('marketplace:listings:*');
      res.status(201).json({ success: true, data: bundle });
    } catch (err) {
      if (respondMarketplaceClientError(res, err)) return;
      throw err;
    }
  })
);

router.get(
  '/seller/onboarding',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const { getMarketplaceSellerToolsService } = await import('../../services/marketplaceSellerTools');
    const status = await getMarketplaceSellerToolsService(dataLayer).getOnboardingStatus(
      req.user.id
    );
    res.json({ success: true, data: status });
  })
);

router.post(
  '/seller/onboarding/complete',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const { getMarketplaceSellerToolsService } = await import('../../services/marketplaceSellerTools');
    const prefs = await getMarketplaceSellerToolsService(dataLayer).completeOnboarding(
      req.user.id
    );
    res.json({ success: true, data: prefs });
  })
);

export default router;
