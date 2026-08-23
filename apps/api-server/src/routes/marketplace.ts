import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth';
import { uploadBurstRateLimit } from '../middleware/rateLimit';
import { handleValidationErrors, validatePagination, validateListingId, validateMarketplaceListingWrite, validateMarketplaceListingUpdate, validateUserId } from '../middleware/validation';
import { requireAuthUserId } from '../utils/requestAuth';
import { COURSE_FILTER_INVALID_MESSAGE, parseCourseFilter } from '../services/academicCourses';
import { SupabaseService } from '../services/supabase';
import { CacheService } from '../services/cache';
import { logger } from '../utils/logger';
import { clientErrorMessage } from '../utils/safeError';
import { getMarketplaceOrdersService, invalidateSellerAnalyticsCache } from '../services/marketplaceOrders';
import { getMarketplaceCartService } from '../services/marketplaceCart';
import { getMarketplaceQuestionBanksService } from '../services/marketplaceQuestionBanks';
import { getMarketplaceStudyPacksService } from '../services/marketplaceStudyPacks';
import {
  assertListingAttestation,
  getModerationService,
  listingRightsFields,
  LISTING_MODERATION_FIELDS,
  runListingContentFilter,
  stripListingModerationFields,
} from '../services/moderation';
import { isAcademicListing } from '@lantern/shared/moderation';
import { surfaceFromRequest } from '../services/learningEvents';
import { PublicError } from '../utils/safeError';
import { invalidateListingCaches } from '../utils/marketplaceCache';
import { CacheKeys, CacheTTL } from '../services/cachePolicy';
import { normalizeIdempotencyKey, withIdempotency } from '../services/idempotency';
import { idempotencyMiddleware, type IdempotentRequest } from '../middleware/idempotency';
import { isLivePlatformAdmin } from '../utils/platformAdminAuth';
import {
  MARKETPLACE_DEFAULT_COUNTRY,
  MARKETPLACE_DEFAULT_CURRENCY,
  OTHER_CITY_CAMPUS_SLUG,
  isDigitalListingKind,
  isMarketplaceListingModerated,
  marketplaceListingModerationNotice,
} from '@lantern/shared/marketplace';

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

class MarketplaceCampusMetadataError extends Error {}

async function resolveRequiredMarketplaceCampus(
  rawCampusId: unknown,
  rawLocation: unknown
): Promise<{ campusId: string; countryCode: string }> {
  const campusId = typeof rawCampusId === 'string' ? rawCampusId.trim() : '';
  if (!campusId) {
    throw new MarketplaceCampusMetadataError(
      'Campus or city metadata is required for marketplace listings'
    );
  }

  const campus = await supabaseService.getMarketplaceCampusById(campusId);
  if (!campus || !campus.active || campus.country_code !== MARKETPLACE_DEFAULT_COUNTRY) {
    throw new MarketplaceCampusMetadataError('Invalid or inactive Nigerian campus or city');
  }

  if (
    campus.slug === OTHER_CITY_CAMPUS_SLUG &&
    (typeof rawLocation !== 'string' || !rawLocation.trim())
  ) {
    throw new MarketplaceCampusMetadataError(
      'Enter the Nigerian city or pickup/delivery area for the Other city option'
    );
  }

  return {
    campusId,
    countryCode: MARKETPLACE_DEFAULT_COUNTRY,
  };
}

/**
 * Marketplace services throw user-facing validation/state errors mostly as plain
 * `new Error(...)` (not PublicError), so the global errorHandler collapses them
 * into a generic 500 "Something went wrong" toast and real conditions ("Not
 * enough stock", "Coupon has expired", "Seller has not set up a payout bank
 * account") never reach the buyer. Recognise the client-facing ones and surface
 * the real message as a 4xx; anything else (PostgrestError/DB errors, unexpected
 * TypeErrors, 5xx ApiErrors) is left to escape so we never leak internals.
 *
 * Returns true when it sent a response (caller should `return`); false when the
 * error is internal and should be rethrown to the global handler.
 */
export function respondMarketplaceClientError(res: any, err: unknown): boolean {
  const isPublic = err instanceof PublicError;
  const status = (err as any)?.statusCode;
  const isInternalStatus = typeof status === 'number' && status >= 500;
  // A vanilla `new Error(...)` keeps name 'Error' and has no `.code`. DB errors
  // (PostgrestError) carry a distinct name and a `.code`; bug-induced errors are
  // TypeError/RangeError/etc. Neither is surfaced.
  const isPlainValidation =
    err instanceof Error &&
    err.name === 'Error' &&
    !(err as any).code &&
    !isInternalStatus;

  if (!isPublic && !isPlainValidation) return false;

  const httpStatus =
    typeof status === 'number' && status >= 400 && status < 500 ? status : 400;
  res.status(httpStatus).json({ success: false, error: (err as Error).message });
  return true;
}

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
      condition,
      sortBy = 'trending',
      sortOrder = 'desc',
      responseProfile,
    } = req.query;
    const profile = resolveResponseProfile(responseProfile);
    const categoryList = typeof categories === 'string' && categories.trim()
      ? categories.split(',').map((c: string) => c.trim()).filter(Boolean).slice(0, 20)
      : undefined;
    const includeCustomCategories = includeCustom === '1' || includeCustom === 'true';

    logger.debug('Fetching marketplace listings', { page, limit, category, search, profile, campusId, countryCode });

    const cacheKey = `marketplace:listings:v2:${page}:${limit}:${category || ''}:${categoryList ? categoryList.join('|') : ''}:${includeCustomCategories ? 1 : 0}:${search || ''}:${minPrice || ''}:${maxPrice || ''}:${location || ''}:${campusId || ''}:${countryCode || ''}:${condition || ''}:${sortBy}:${sortOrder}:profile:${profile}`;
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
        condition: (condition as string) || undefined,
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

    const counted = await supabaseService.incrementListingViews(id, viewerId);
    if (counted) {
      listing = { ...listing, views_count: (listing.views_count || 0) + 1 };
    }

    // Rights / takedown / appeal columns are for the owner and platform admins
    // only; everyone else gets the listing without them.
    const viewerIsOwner = Boolean(viewerId) && listing.user_id === viewerId;
    const viewerIsAdmin = !viewerIsOwner && viewerId ? await isLivePlatformAdmin(viewerId) : false;
    if (!viewerIsOwner && !viewerIsAdmin) {
      listing = stripListingModerationFields(listing);
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
    const rawType = typeof contentType === 'string' ? contentType.toLowerCase() : '';
    const normalizedType = rawType === 'image/jpg' ? 'image/jpeg' : rawType;
    // Reject HEIC early with a clear message. Other declared types are optional —
    // uploadMarketplaceImage sniffs magic bytes (camera apps often send octet-stream).
    const fileNameLower = typeof fileName === 'string' ? fileName.toLowerCase() : '';
    if (
      normalizedType.includes('heic') ||
      normalizedType.includes('heif') ||
      fileNameLower.endsWith('.heic') ||
      fileNameLower.endsWith('.heif')
    ) {
      return res.status(400).json({
        success: false,
        error:
          'HEIC photos are not supported. Please convert or export the image as JPEG or PNG, then try again.',
      });
    }
    if (normalizedType && !ALLOWED_IMAGE_TYPES.includes(normalizedType) && !normalizedType.includes('octet-stream')) {
      return res.status(400).json({
        success: false,
        error: 'Only JPEG, PNG, GIF, and WebP are allowed.',
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
        contentType: normalizedType || 'image/jpeg',
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

    let campusMetadata: { campusId: string; countryCode: string };
    try {
      campusMetadata = await resolveRequiredMarketplaceCampus(
        listingData.campus_id ?? listingData.campusId,
        listingData.location
      );
    } catch (error) {
      if (!(error instanceof MarketplaceCampusMetadataError)) throw error;
      return res.status(400).json({
        success: false,
        error: error.message,
      });
    }

    listingData.campus_id = campusMetadata.campusId;
    listingData.country_code = campusMetadata.countryCode;
    listingData.currency = MARKETPLACE_DEFAULT_CURRENCY;

    // Rights attestation (academic categories / digital kinds must attest) and
    // the content filter (block tier → 400; flag tier → stored + auto report).
    // rights_* columns are server-set: strip anything the client sent first.
    for (const key of LISTING_MODERATION_FIELDS) delete listingData[key];
    let contentFlags: ReturnType<typeof runListingContentFilter> = [];
    try {
      const attested = assertListingAttestation({
        listingKind: listingData.listing_kind ?? listingData.listingKind ?? 'single',
        category: listingData.category,
        attestation: listingData.attestation,
      });
      Object.assign(listingData, listingRightsFields(attested));
      contentFlags = runListingContentFilter({ title: listingData.title, description: listingData.description });
    } catch (error: any) {
      if (error instanceof PublicError) {
        const statusCode = (error as { statusCode?: unknown }).statusCode;
        return res.status(statusCode === 403 ? 403 : 400).json({ success: false, error: error.message });
      }
      throw error;
    }
    delete listingData.attestation;

    logger.debug('Creating marketplace listing', { userId, category: listingData.category, title: listingData.title });

    try {
      const listing = await req.runIdempotent!(async () => {
        const created = await supabaseService.createMarketplaceListing(listingData, userId);

        if (contentFlags.length > 0 && (created as { id?: string })?.id) {
          await getModerationService(supabaseService).recordListingFlags(
            (created as { id: string }).id,
            userId,
            contentFlags,
          );
        }

        if (listingData.category?.startsWith('custom:')) {
          const categoryName = listingData.category.replace('custom:', '');
          await supabaseService.createCustomCategory(categoryName, userId).catch(() => {});
          await supabaseService.incrementCategoryUsage(categoryName).catch(() => {});
          cacheService.deletePattern('marketplace:custom_categories');
        }

        try {
          const { getMarketplaceSellerToolsService } = await import('../services/marketplaceSellerTools');
          await getMarketplaceSellerToolsService(supabaseService).ensureSellerShop(userId);
        } catch (e) {
          logger.warn('Failed to ensure seller shop on listing create', e);
        }

        await cacheService.deletePattern('marketplace:listings:*');
        return { listing: created as Record<string, unknown> };
      });

      const createdListing = listing.listing as { id?: string; title?: string };
      try {
        await supabaseService.createNotification(userId, {
          type: 'marketplace_order_update',
          message: `Your listing "${createdListing.title || listingData.title}" is now live.`,
          link: createdListing.id ? `marketplace:listing:${createdListing.id}` : undefined,
          data: { listingId: createdListing.id },
        });
      } catch (e) {
        logger.warn('Failed to send listing published notification', e);
      }

      res.status(201).json({
        success: true,
        data: listing.listing,
      });
    } catch (error: any) {
      const { isMarketplacePricingError } = await import('../utils/marketplacePricing');
      if (isMarketplacePricingError(error)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      const constraint = String(error?.message || error?.details || '');
      if (
        error?.code === '23514' ||
        /marketplace_listings_sale_price_check/i.test(constraint)
      ) {
        return res.status(400).json({
          success: false,
          error: 'Sale price must be lower than the regular price (or leave sale price blank).',
        });
      }
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
    const updates = req.body || {};
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

    const campusWasProvided =
      Object.prototype.hasOwnProperty.call(updates, 'campus_id') ||
      Object.prototype.hasOwnProperty.call(updates, 'campusId');
    const locationWasProvided = Object.prototype.hasOwnProperty.call(updates, 'location');
    if (campusWasProvided || locationWasProvided) {
      try {
        const campusMetadata = await resolveRequiredMarketplaceCampus(
          campusWasProvided
            ? updates.campus_id ?? updates.campusId
            : listing.campus_id ?? listing.campus?.id,
          locationWasProvided ? updates.location : listing.location
        );
        updates.campus_id = campusMetadata.campusId;
        updates.country_code = campusMetadata.countryCode;
        updates.currency = MARKETPLACE_DEFAULT_CURRENCY;
      } catch (error) {
        if (!(error instanceof MarketplaceCampusMetadataError)) throw error;
        return res.status(400).json({ success: false, error: error.message });
      }
    } else {
      // Country and currency are fixed catalog properties, not user-controlled
      // transaction-access settings.
      delete updates.country_code;
      delete updates.countryCode;
      delete updates.currency;
    }

    // Academic course reference. Written through a dedicated setter (not the
    // generic assign() in updateMarketplaceListing) so the listing-lifecycle
    // guard path stays untouched; uuid-validated by validateMarketplaceListingUpdate.
    const courseWasProvided = Object.prototype.hasOwnProperty.call(updates, 'courseId');
    const nextCourseId: string | null = courseWasProvided
      ? typeof updates.courseId === 'string' && updates.courseId
        ? updates.courseId
        : null
      : null;
    delete updates.courseId;
    delete updates.course_id;

    // Rights attestation + content filter (Phase 1 · E). rights_* columns are
    // server-set (never assignable through updateMarketplaceListing); an edit
    // that lands an unattested listing in an academic category must attest,
    // and re-sending attestation refreshes the timestamp. Title/description
    // changes run the content filter: block → 400, flags → stored + auto report.
    for (const key of LISTING_MODERATION_FIELDS) delete updates[key];
    const attestationSent = updates.attestation === true;
    delete updates.attestation;
    const nextCategory =
      typeof updates.category === 'string' && updates.category ? updates.category : listing.category;
    const alreadyAttested = listing.rights_status === 'attested' || listing.rights_status === 'cleared';
    let contentFlags: ReturnType<typeof runListingContentFilter> = [];
    try {
      if (!liveAdmin && !alreadyAttested) {
        assertListingAttestation({
          listingKind: listing.listing_kind ?? 'single',
          category: nextCategory,
          attestation: attestationSent,
        });
      }
      if (updates.title !== undefined || updates.description !== undefined) {
        contentFlags = runListingContentFilter({
          title: updates.title !== undefined ? updates.title : listing.title,
          description: updates.description !== undefined ? updates.description : listing.description,
        });
      }
    } catch (error: any) {
      if (error instanceof PublicError) {
        const statusCode = (error as { statusCode?: unknown }).statusCode;
        return res.status(statusCode === 403 ? 403 : 400).json({ success: false, error: error.message });
      }
      throw error;
    }

    let updatedListing = await supabaseService.updateMarketplaceListing(id, updates, {
      actorIsAdmin: liveAdmin,
    });

    if (
      updatedListing &&
      attestationSent &&
      (!alreadyAttested || isAcademicListing({ listingKind: listing.listing_kind, category: nextCategory }))
    ) {
      await getModerationService(supabaseService).markListingAttested(id);
      updatedListing = { ...updatedListing, ...listingRightsFields(true) };
    }
    if (updatedListing && contentFlags.length > 0) {
      await getModerationService(supabaseService).recordListingFlags(id, listing.user_id, contentFlags);
    }

    if (courseWasProvided && updatedListing) {
      const { getAcademicCoursesService } = await import('../services/academicCourses');
      await getAcademicCoursesService(supabaseService).setListingCourse(id, nextCourseId);
      updatedListing = { ...updatedListing, course_id: nextCourseId };
    }

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

    // A listing moderation took down is read-only for its seller: deleting it
    // would cascade the report trail away and let the seller relist a copy.
    if (!liveAdmin && isMarketplaceListingModerated(listing.status)) {
      return res.status(403).json({
        success: false,
        error: `${marketplaceListingModerationNotice(listing.status)} It cannot be deleted by the seller.`,
      });
    }

    // marketplace_orders cascade-deletes on listing delete, so a raw delete would
    // destroy paid/completed orders and their receipts. Delete only when safe,
    // archive when terminal orders exist, and refuse while orders are still open.
    let outcome: 'deleted' | 'archived';
    try {
      ({ outcome } = await supabaseService.deleteMarketplaceListingSafely(id));
    } catch (err: any) {
      if (err?.statusCode === 409) {
        return res.status(409).json({ success: false, error: err.message });
      }
      throw err;
    }

    // Invalidate caches
    await invalidateListingCaches(cacheService, id);
    await cacheService.deletePattern('marketplace:listings:*');

    res.json({
      success: true,
      message:
        outcome === 'archived'
          ? 'Listing archived (it has past orders, so its records are kept)'
          : 'Listing deleted successfully',
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

// POST /api/v1/marketplace/listings/:id/buy-now - Instant purchase (Paystack when enabled)
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

    const quantityRaw = req.body?.quantity;
    const quantity =
      quantityRaw == null || quantityRaw === ''
        ? 1
        : Math.max(1, Math.floor(Number(quantityRaw)));
    if (!Number.isFinite(quantity) || quantity < 1) {
      return res.status(400).json({ success: false, error: 'Invalid quantity' });
    }

    const idempotencyKey =
      normalizeIdempotencyKey(req.headers['idempotency-key']) ||
      `${buyerId}:buy_now:${id}:q${quantity}:${Math.floor(Date.now() / 300_000)}`;

    const { marketplacePaystackEnabled, getMarketplacePaymentsService } = await import(
      '../services/marketplacePayments'
    );

    try {
      const result = await withIdempotency(
        supabaseService.getClient(),
        buyerId,
        'marketplace_buy_now',
        idempotencyKey,
        async () => {
          if (marketplacePaystackEnabled()) {
            const email =
              (typeof req.user?.email === 'string' && req.user.email) ||
              (await supabaseService.getClient().auth.admin.getUserById(buyerId)).data.user
                ?.email ||
              '';
            if (!email) {
              throw new Error('A verified email is required for Paystack checkout');
            }
            return getMarketplacePaymentsService(supabaseService).createBuyNowCheckoutSession({
              listingId: id,
              buyerId,
              buyerEmail: email,
              couponCode: req.body?.couponCode,
              quantity,
            });
          }
          return supabaseService.buyMarketplaceListingNow(
            id,
            buyerId,
            req.body?.couponCode,
            quantity
          );
        }
      );

      await invalidateListingCaches(cacheService, id);
      await cacheService.deletePattern('marketplace:listings:*');
      const sellerId =
        (result as any)?.order?.seller_id || (result as any)?.seller_id || '';
      await invalidateSellerAnalyticsCache(String(sellerId));

      res.json({ success: true, data: result });
    } catch (err) {
      // Surface real conditions (out of stock, no payout profile, invalid coupon)
      // instead of the global handler's generic 500.
      if (respondMarketplaceClientError(res, err)) return;
      throw err;
    }
  })
);

// ============================================================
// QUESTION BANKS (digital study bundles)
// ============================================================

// POST /api/v1/marketplace/question-banks/publish - Publish a bank as a listing
router.post(
  '/question-banks/publish',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    try {
      const result = await getMarketplaceQuestionBanksService(supabaseService).publishQuestionBank(
        userId,
        {
          title: req.body?.title,
          description: req.body?.description,
          price: req.body?.price,
          campusId: req.body?.campusId ?? req.body?.campus_id,
          location: req.body?.location,
          groupId: req.body?.groupId ?? req.body?.group_id ?? null,
          courseId: req.body?.courseId ?? req.body?.course_id ?? null,
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
        supabaseService
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
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const result = await getMarketplaceQuestionBanksService(supabaseService).restoreEntitlements(
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
        supabaseService
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
      const data = await getMarketplaceQuestionBanksService(supabaseService).recordScore(
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
    const data = await getMarketplaceQuestionBanksService(supabaseService).getLeaderboard(
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
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const data = await getMarketplaceQuestionBanksService(supabaseService).listMyQuestionBanks(
      userId
    );
    res.json({ success: true, data });
  })
);

// GET /api/v1/marketplace/question-banks/updates - Owned banks with a newer version
router.get(
  '/question-banks/updates',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const data = await getMarketplaceQuestionBanksService(supabaseService).listAvailableUpdates(
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
        supabaseService
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

// ============================================================
// STUDY PACKS (digital study products: guide + summaries + flashcards + questions)
// ============================================================

// POST /api/v1/marketplace/study-packs/publish - Publish a pack as a listing
router.post(
  '/study-packs/publish',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    try {
      const result = await getMarketplaceStudyPacksService(supabaseService).publishStudyPack(userId, {
        title: req.body?.title,
        description: req.body?.description,
        price: req.body?.price,
        campusId: req.body?.campusId ?? req.body?.campus_id,
        location: req.body?.location,
        courseId: req.body?.courseId ?? req.body?.course_id ?? null,
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
      const result = await getMarketplaceStudyPacksService(supabaseService).downloadStudyPack(
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
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const result = await getMarketplaceStudyPacksService(supabaseService).restoreEntitlements(userId);
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
      const data = await getMarketplaceStudyPacksService(supabaseService).getStudyPackPreview(
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
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const data = await getMarketplaceStudyPacksService(supabaseService).listMyStudyPacks(userId);
    res.json({ success: true, data });
  })
);

// GET /api/v1/marketplace/study-packs/updates - Owned packs with a newer version
router.get(
  '/study-packs/updates',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const data = await getMarketplaceStudyPacksService(supabaseService).listAvailableUpdates(userId);
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
      const result = await getMarketplaceStudyPacksService(supabaseService).updateStudyPackContent(
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
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const data = await getMarketplaceStudyPacksService(supabaseService).listPurchases(userId);
    res.json({ success: true, data });
  })
);

// GET /api/v1/marketplace/cart - Buyer cart lines
router.get(
  '/cart',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const buyerId = req.user?.id;
    if (!buyerId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const items = await getMarketplaceCartService(supabaseService).listCart(buyerId);
    res.json({ success: true, data: items });
  })
);

// POST /api/v1/marketplace/cart - Add / merge cart line
router.post(
  '/cart',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const buyerId = req.user?.id;
    if (!buyerId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const listingId = typeof req.body?.listingId === 'string' ? req.body.listingId.trim() : '';
    if (!listingId) {
      return res.status(400).json({ success: false, error: 'listingId is required' });
    }
    try {
      const item = await getMarketplaceCartService(supabaseService).addToCart(
        buyerId,
        listingId,
        req.body?.quantity
      );
      res.json({ success: true, data: item });
    } catch (err) {
      if (respondMarketplaceClientError(res, err)) return;
      throw err;
    }
  })
);

// PATCH /api/v1/marketplace/cart/:listingId - Update line quantity
router.patch(
  '/cart/:listingId',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const buyerId = req.user?.id;
    if (!buyerId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const listingId = req.params.listingId;
    try {
      const item = await getMarketplaceCartService(supabaseService).updateCartItem(
        buyerId,
        listingId,
        req.body?.quantity
      );
      res.json({ success: true, data: item });
    } catch (err) {
      if (respondMarketplaceClientError(res, err)) return;
      throw err;
    }
  })
);

// DELETE /api/v1/marketplace/cart/:listingId - Remove one line
router.delete(
  '/cart/:listingId',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const buyerId = req.user?.id;
    if (!buyerId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    await getMarketplaceCartService(supabaseService).removeCartItem(buyerId, req.params.listingId);
    res.json({ success: true, data: { removed: true } });
  })
);

// DELETE /api/v1/marketplace/cart - Clear cart
router.delete(
  '/cart',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const buyerId = req.user?.id;
    if (!buyerId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    await getMarketplaceCartService(supabaseService).clearCart(buyerId);
    res.json({ success: true, data: { cleared: true } });
  })
);

// POST /api/v1/marketplace/cart/checkout - One order per cart line (Paystack sessions when enabled)
router.post(
  '/cart/checkout',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const buyerId = req.user?.id;
    if (!buyerId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const idempotencyKey =
      normalizeIdempotencyKey(req.headers['idempotency-key']) ||
      `${buyerId}:cart_checkout:${Math.floor(Date.now() / 300_000)}`;

    const { marketplacePaystackEnabled, getMarketplacePaymentsService } = await import(
      '../services/marketplacePayments'
    );

    try {
    const result = await withIdempotency(
      supabaseService.getClient(),
      buyerId,
      'marketplace_cart_checkout',
      idempotencyKey,
      async () => {
        if (!marketplacePaystackEnabled()) {
          return getMarketplaceCartService(supabaseService).checkout(buyerId);
        }

        const email =
          (typeof req.user?.email === 'string' && req.user.email) ||
          (await supabaseService.getClient().auth.admin.getUserById(buyerId)).data.user?.email ||
          '';
        if (!email) {
          throw new Error('A verified email is required for Paystack checkout');
        }

        const cart = await getMarketplaceCartService(supabaseService).listCart(buyerId);
        if (cart.length === 0) throw new Error('Cart is empty');

        const payments = getMarketplacePaymentsService(supabaseService);
        const sessions: unknown[] = [];
        const failures: Array<{ listingId: string; error: string }> = [];
        const succeededListingIds: string[] = [];

        for (const item of cart) {
          try {
            const session = await payments.createBuyNowCheckoutSession({
              listingId: item.listing_id,
              buyerId,
              buyerEmail: email,
              quantity: item.quantity,
            });
            sessions.push(session);
            succeededListingIds.push(item.listing_id);
          } catch (err: any) {
            failures.push({
              listingId: item.listing_id,
              error: err?.message || 'Checkout failed',
            });
          }
        }

        if (succeededListingIds.length > 0) {
          await supabaseService
            .getClient()
            .from('marketplace_cart_items')
            .delete()
            .eq('buyer_id', buyerId)
            .in('listing_id', succeededListingIds);
        }

        if (sessions.length === 0) {
          throw new Error(failures[0]?.error || 'Checkout failed for all items');
        }

        return {
          sessions,
          failures,
          // Convenience: first Paystack URL for single-item carts
          authorizationUrl: (sessions[0] as { authorizationUrl?: string })?.authorizationUrl,
          orders: sessions.map((s: any) => s.order).filter(Boolean),
        };
      }
    );

    for (const order of (result as any).orders || []) {
      if (order?.listing_id) {
        await invalidateListingCaches(cacheService, String(order.listing_id));
        await invalidateSellerAnalyticsCache(String(order.seller_id || ''));
      }
    }
    await cacheService.deletePattern('marketplace:listings:*');

    res.json({ success: true, data: result });
    } catch (err) {
      if (respondMarketplaceClientError(res, err)) return;
      throw err;
    }
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

    try {
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
    } catch (err) {
      if (respondMarketplaceClientError(res, err)) return;
      throw err;
    }
  })
);

// POST /api/v1/marketplace/listings/:id/reports - Report listing
router.post(
  '/listings/:id/reports',
  authMiddleware,
  validateListingId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { id } = req.params;
    const { reason, details } = req.body || {};
    const userId = req.user?.id;

    logger.debug('Reporting listing', { id, userId, reason });

    // Writes the generic content_reports table (target_type 'listing'). Old
    // clients send the legacy reason set (scam/spam/inappropriate/other plus
    // mobile's wrong_category/prohibited_item); reasons the listing target does
    // not know are folded into 'other' with the label kept in details, exactly
    // as utils/marketplaceReportReason.ts did for marketplace_reports.
    const { isReasonAllowedForTarget } = await import('@lantern/shared/moderation');
    let nextReason = typeof reason === 'string' && reason ? reason : 'other';
    let nextDetails: string | undefined = typeof details === 'string' ? details : undefined;
    if (!isReasonAllowedForTarget('listing', nextReason)) {
      const { normalizeMarketplaceReportReason } = await import('../utils/marketplaceReportReason');
      const folded = normalizeMarketplaceReportReason(nextReason, nextDetails);
      nextReason = folded.reason;
      nextDetails = folded.details;
    }

    try {
      const report = await getModerationService(supabaseService).createReport({
        reporterId: userId,
        targetType: 'listing',
        targetId: id,
        reason: nextReason,
        details: nextDetails,
      });
      res.status(201).json({ success: true, data: report });
    } catch (error: any) {
      if (error instanceof PublicError) {
        const statusCode = (error as { statusCode?: unknown }).statusCode;
        return res
          .status(typeof statusCode === 'number' ? statusCode : 400)
          .json({ success: false, error: error.message });
      }
      throw error;
    }
  })
);

// POST /api/v1/marketplace/listings/:id/appeal - Seller appeals a moderation takedown (one shot)
router.post(
  '/listings/:id/appeal',
  authMiddleware,
  validateListingId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const result = await getModerationService(supabaseService).appealListing(
        req.params.id,
        userId,
        req.body?.note
      );
      await invalidateListingCaches(cacheService, req.params.id);
      res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      if (error instanceof PublicError) {
        const statusCode = (error as { statusCode?: unknown }).statusCode;
        return res
          .status(typeof statusCode === 'number' ? statusCode : 400)
          .json({ success: false, error: error.message });
      }
      throw error;
    }
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
    const { status, courseId } = req.query;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const courseFilter = parseCourseFilter(courseId);
    if (courseFilter.kind === 'invalid') {
      return res.status(400).json({ success: false, error: COURSE_FILTER_INVALID_MESSAGE });
    }

    logger.debug('Fetching seller listings', { userId, status, courseId });

    const listings = await supabaseService.getListingsBySeller(userId, status as string | undefined, {
      courseFilter,
    });

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
      // Lifecycle refusals carry their own 4xx (403 moderation/held, 400 unknown).
      const statusCode = typeof error?.statusCode === 'number' ? error.statusCode : 403;
      res.status(statusCode).json({
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

    // createInquiry ensures the dm_threads row exists (FK), then inserts the inquiry.
    const inquiry = await supabaseService.createInquiry(
      finalListingId,
      buyerId,
      listing.user_id,
      threadId,
      message
    );

    // Deliver the buyer message into the DM thread (thread already ensured above).
    await supabaseService.sendDirectMessage(buyerId, listing.user_id, dmMessage, {
      bypassPrivacy: true,
    });

    // Get buyer name for notification
    const buyerProfile = await supabaseService.fetchUserProfile(buyerId);

    // Create notification for seller (best-effort — inquiry + DM already succeeded)
    try {
      await supabaseService.createInquiryNotification(
        listing.user_id,
        buyerProfile?.name || 'Someone',
        listing.title,
        inquiry.id
      );
    } catch (notifyErr) {
      logger.warn('Inquiry created but seller notification failed', {
        inquiryId: inquiry.id,
        error: notifyErr instanceof Error ? notifyErr.message : String(notifyErr),
      });
    }

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

const OFFER_EXPIRY_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Stable date label for expiry messages, in WAT (UTC+1, Nigeria has no DST).
 * Shifting by the fixed offset before reading UTC parts keeps it ICU-free
 * while naming the same calendar day the buyer saw in the client.
 */
function formatOfferExpiry(when: Date): string {
  const wat = new Date(when.getTime() + 60 * 60 * 1000);
  return `${wat.getUTCDate()} ${OFFER_EXPIRY_MONTHS[wat.getUTCMonth()]} ${wat.getUTCFullYear()}`;
}

/**
 * A still-'pending' offer whose expires_at has passed, or null. Anything that is
 * not pending is already terminal and is handled by the existing status check.
 */
export function expiredPendingOfferDate(
  offer: { status?: unknown; expires_at?: unknown } | null | undefined,
  now: number = Date.now()
): Date | null {
  if (!offer || offer.status !== 'pending') return null;
  const raw = offer.expires_at;
  if (typeof raw !== 'string' && !(raw instanceof Date)) return null;
  const when = raw instanceof Date ? raw : new Date(raw);
  const ms = when.getTime();
  if (!Number.isFinite(ms) || ms > now) return null;
  return when;
}

/**
 * marketplace_offers.expires_at has always been written (48h default, and set
 * explicitly on create/counter) and both clients promise the offer expires — but
 * nothing enforced it server-side, so a dead offer stayed 'pending' forever and
 * could still be accepted at its stale price via a direct API call or a client
 * with stale state.
 *
 * Only accept/counter are refused: they would move money/state at a price the
 * seller is no longer bound to. decline/withdraw are deliberately allowed
 * through — they are terminal and harmless, a user tidying up a dead offer
 * should not get an error that looks like a bug, and 'declined'/'withdrawn'
 * records what actually happened better than 'expired' would.
 */
export function offerExpiryConflict(
  offer: { status?: unknown; expires_at?: unknown } | null | undefined,
  action: string,
  now: number = Date.now()
): { status: number; error: string } | null {
  const expiredAt = expiredPendingOfferDate(offer, now);
  if (!expiredAt) return null;
  if (action !== 'accept' && action !== 'counter') return null;
  const verb = action === 'accept' ? 'accepted' : 'countered';
  return {
    status: 409,
    error: `This offer expired on ${formatOfferExpiry(expiredAt)} and can no longer be ${verb}.`,
  };
}

/**
 * Lazy expire: flip a dead 'pending' row to 'expired' so lists stop showing it
 * as live (there is no background sweep). 'expired' is permitted by the status
 * CHECK constraint in 20260307000000_marketplace_offers_saved_searches.sql, and
 * the web inquiries screen already renders an 'expired' badge. Best-effort only
 * — the caller's response must not depend on this write.
 */
async function markOfferExpired(offerId: string): Promise<void> {
  try {
    const { error } = await supabaseService.getClient()
      .from('marketplace_offers')
      .update({ status: 'expired' })
      .eq('id', offerId)
      .eq('status', 'pending');
    if (error) throw error;
  } catch (e) {
    logger.warn('Failed to lazily expire marketplace offer', e);
  }
}

export type OfferOrderSummary = { id: string; status: string; paymentId: string | null };

/**
 * Every offer handed to a client carries `order`: the marketplace_orders row
 * created when the offer was accepted, or null. Without it an accepted offer is
 * a dead end — the buyer has an order to pay for and no way to reach it.
 *
 * Non-null only when the requester is a party to that order (never leak someone
 * else's order). Read-only: nothing here touches payment or order state. One
 * batched lookup for the whole page — at most one order exists per offer
 * (unique index idx_marketplace_orders_unique_offer_id).
 */
export async function attachOrdersToOffers<T extends Record<string, any>>(
  offers: T[] | null | undefined,
  requesterId: string
): Promise<(T & { order: OfferOrderSummary | null })[]> {
  const list = Array.isArray(offers) ? offers : [];
  if (list.length === 0) return [];

  const offerIds = Array.from(
    new Set(list.map((offer) => offer?.id).filter((id): id is string => typeof id === 'string' && !!id))
  );

  const byOfferId = new Map<string, OfferOrderSummary>();
  if (offerIds.length > 0) {
    try {
      const { data, error } = await supabaseService.getClient()
        .from('marketplace_orders')
        .select('id, status, payment_id, offer_id, buyer_id, seller_id')
        .in('offer_id', offerIds);
      if (error) throw error;
      for (const row of (data || []) as Record<string, any>[]) {
        if (!row?.offer_id) continue;
        if (row.buyer_id !== requesterId && row.seller_id !== requesterId) continue;
        byOfferId.set(String(row.offer_id), {
          id: String(row.id),
          status: String(row.status),
          paymentId: row.payment_id ? String(row.payment_id) : null,
        });
      }
    } catch (e) {
      // The order is an affordance hint, not the payload — a failed lookup must
      // not take the offers list down with it.
      logger.warn('Failed to resolve orders for offers', e);
    }
  }

  return list.map((offer) => ({
    ...offer,
    order: (offer?.id ? byOfferId.get(String(offer.id)) : undefined) ?? null,
  }));
}

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
    // Digital products (question banks, study packs) are fixed-price; the
    // offer-accept order path is meetup-shaped (reserves the listing), so offers
    // are not supported.
    if (isDigitalListingKind(listing.listing_kind)) {
      return res.status(400).json({
        success: false,
        error: 'Digital products are fixed-price — use Buy Now or the free download',
      });
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
          proposed_by: 'buyer',
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
            // A dead (expired) pending offer holds the one-pending-per-buyer
            // slot: the web client hides its action buttons so accept/counter
            // never fires the lazy expire, and the buyer would be permanently
            // blocked from re-offering. Expire it and let them insert fresh.
            if (expiredPendingOfferDate(existing) !== null) {
              await markOfferExpired(String(existing.id));
              const retry = await supabaseService.getClient()
                .from('marketplace_offers')
                .insert({
                  listing_id: listingId,
                  buyer_id: userId,
                  seller_id: listing.user_id,
                  amount,
                  message: message || null,
                  status: 'pending',
                  proposed_by: 'buyer',
                  expires_at: expiresAt,
                })
                .select('*')
                .single();
              if (retry.error) throw retry.error;
              return { data: retry.data as Record<string, unknown>, existing: false, status: 201 };
            }
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

    res.json({ success: true, data: await attachOrdersToOffers(data, userId) });
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

    const proposedBy: 'buyer' | 'seller' =
      offer.proposed_by === 'seller' || offer.proposed_by === 'buyer'
        ? offer.proposed_by
        : offer.parent_offer_id
          ? 'seller'
          : 'buyer';
    const responderId = proposedBy === 'seller' ? offer.buyer_id : offer.seller_id;
    const actorIsBuyer = offer.buyer_id === userId;
    const actorRole: 'buyer' | 'seller' = actorIsBuyer ? 'buyer' : 'seller';

    // Authorization: only the non-proposing party may accept/decline/counter.
    // Buyer may withdraw only their own pending proposal.
    if (action === 'withdraw') {
      if (!actorIsBuyer) {
        return res.status(403).json({ success: false, error: 'Only the buyer can withdraw an offer' });
      }
      if (proposedBy !== 'buyer') {
        return res.status(403).json({
          success: false,
          error: 'Withdraw your own offer, or accept/decline/counter the seller\'s counter-offer',
        });
      }
    }
    if (['accept', 'decline', 'counter'].includes(action) && userId !== responderId) {
      return res.status(403).json({
        success: false,
        error: 'Only the other party can accept, decline, or counter this offer',
      });
    }
    if (offer.status !== 'pending') {
      return res.status(400).json({ success: false, error: `Cannot ${action} an offer with status "${offer.status}"` });
    }

    // Still 'pending' in the DB, but the 48h clock ran out.
    const expiryConflict = offerExpiryConflict(offer, action);
    if (expiryConflict) {
      // Lazy expire only on the refused actions: decline/withdraw fall through
      // and write their own terminal status below, which is the cleaner record
      // of what actually happened (and flipping to 'expired' first would make
      // their conditional `status = 'pending'` update fail with a 409).
      await markOfferExpired(id);
      return res.status(expiryConflict.status).json({ success: false, error: expiryConflict.error });
    }

    let updatedOffer;

    if (action === 'counter') {
      if (!counterAmount || counterAmount <= 0) {
        return res.status(400).json({ success: false, error: 'counterAmount is required for counter offers' });
      }

      // Atomic parent→countered + child insert (single RPC transaction).
      const { data: rpcRows, error: counterRpcErr } = await supabaseService.getClient().rpc(
        'marketplace_counter_offer',
        {
          p_offer_id: id,
          p_actor_id: userId,
          p_counter_amount: counterAmount,
        }
      );

      if (counterRpcErr) {
        const msg = String(counterRpcErr.message || '');
        if (/no longer pending/i.test(msg)) {
          return res.status(409).json({
            success: false,
            error: 'Cannot counter an offer that is no longer pending',
          });
        }
        if (/only the other party can counter/i.test(msg)) {
          return res.status(403).json({
            success: false,
            error: 'Only the other party can counter this offer',
          });
        }
        throw counterRpcErr;
      }

      const rpcRow = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
      const counterOfferId = rpcRow?.counter_offer_id as string | undefined;
      if (!counterOfferId) {
        return res.status(500).json({ success: false, error: 'Failed to create counter offer' });
      }

      const { data: counterOffer, error: counterFetchErr } = await supabaseService
        .getClient()
        .from('marketplace_offers')
        .select('*')
        .eq('id', counterOfferId)
        .single();
      if (counterFetchErr || !counterOffer) throw counterFetchErr || new Error('Counter offer not found');
      updatedOffer = counterOffer;

      const notifyUserId = actorIsBuyer ? offer.seller_id : offer.buyer_id;
      const counterLabel = actorRole === 'buyer' ? 'Buyer' : 'Seller';
      try {
        await supabaseService.createNotification(notifyUserId, {
          type: 'marketplace_order_update',
          message: `${counterLabel} countered with ₦${Number(counterAmount).toLocaleString()} on "${offer.listing?.title || 'listing'}"`,
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

            let checkout: Record<string, unknown> | null = null;
            const { marketplacePaystackEnabled, getMarketplacePaymentsService } = await import(
              '../services/marketplacePayments'
            );
            if (marketplacePaystackEnabled() && finalized.orderId) {
              try {
                const buyerId = String(acceptedOffer.buyer_id);
                const email =
                  (await supabaseService.getClient().auth.admin.getUserById(buyerId)).data.user
                    ?.email || '';
                if (email) {
                  checkout = (await getMarketplacePaymentsService(
                    supabaseService
                  ).createCheckoutForExistingOrder({
                    orderId: finalized.orderId,
                    buyerId,
                    buyerEmail: email,
                  })) as unknown as Record<string, unknown>;
                }
              } catch (checkoutErr) {
                // Order already created — do not fail accept; buyer can resume checkout later.
                logger.warn('Paystack checkout after offer accept failed', checkoutErr);
                checkout = {
                  error:
                    checkoutErr instanceof Error
                      ? checkoutErr.message
                      : 'Checkout unavailable; open the order to pay',
                };
              }
            }

            return {
              offer: acceptedOffer,
              orderId: finalized.orderId,
              checkout,
            };
          }
        );

        updatedOffer = result.offer;
        await invalidateSellerAnalyticsCache(offer.seller_id);
        // Buyer/seller notifications are sent inside createOrderFromOfferAccept.
        const checkout = (result as { checkout?: Record<string, unknown> | null }).checkout;
        const [acceptedWithOrder] = await attachOrdersToOffers([updatedOffer], userId);
        return res.json({
          success: true,
          data: {
            ...acceptedWithOrder,
            orderId: (result as { orderId?: string }).orderId,
            checkout,
            authorizationUrl:
              typeof checkout?.authorizationUrl === 'string' ? checkout.authorizationUrl : undefined,
            payment: checkout?.payment,
            accessCode: checkout?.accessCode,
            publicKey: checkout?.publicKey,
          },
        });
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

      const notifyUserId = actorIsBuyer ? offer.seller_id : offer.buyer_id;
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

    const [respondedWithOrder] = await attachOrdersToOffers([updatedOffer], userId);
    res.json({ success: true, data: respondedWithOrder });
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

    res.json({ success: true, data: await attachOrdersToOffers(data, userId) });
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

    const result = await supabaseService.getSavedSearchMatches(userId, id, { peek });
    if (!result) {
      return res.status(404).json({ success: false, error: 'Saved search not found' });
    }

    res.json({ success: true, data: result });
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

    const similarCacheKey = `marketplace:similar:v2:${id}`;
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

    const result = await supabaseService.signSimilarListingCards(data || []);
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

    const counted = await supabaseService.incrementListingViews(id, viewerId);
    if (counted) {
      listing = { ...listing, views_count: (listing.views_count || 0) + 1 };
    }

    // --- 2. Similar listings (cached 5 min, shared across all users) ---
    const similarCacheKey = `marketplace:similar:v2:${id}`;
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
      similarListings = await supabaseService.signSimilarListingCards(data || []);
      await cacheService.set(similarCacheKey, similarListings, 300);
    }

    // --- 3. isFavorited (session user only — never trust query userId) ---
    let isFavorited = false;
    if (viewerId) {
      isFavorited = await supabaseService.isListingFavorited(viewerId, id);
    }

    // --- 4. Reviews with reviewer display names ---
    const reviews = await supabaseService.getMarketplaceReviews(id);
    listing = { ...listing, reviews };

    // --- 5. canReview (verified purchase; drives the Write Review button) ---
    let canReview = false;
    if (viewerId) {
      try {
        canReview = (await supabaseService.canUserReviewListing(id, viewerId)).eligible;
      } catch {
        canReview = false; // never block the listing over an eligibility lookup
      }
    }

    // --- 6. Question-bank meta (digital listings): count/version + ownership ---
    let questionBank: { questionCount: number; version: number; owned: boolean } | null = null;
    if (listing.listing_kind === 'question_bank') {
      try {
        const { data: bank } = await supabaseService.getClient()
          .from('marketplace_question_banks')
          .select('question_count, version')
          .eq('listing_id', id)
          .maybeSingle();
        if (bank) {
          let owned = false;
          if (viewerId) {
            const { data: entitlement } = await supabaseService.getClient()
              .from('marketplace_question_bank_entitlements')
              .select('id')
              .eq('listing_id', id)
              .eq('user_id', viewerId)
              .maybeSingle();
            owned = !!entitlement;
          }
          questionBank = {
            questionCount: bank.question_count,
            version: bank.version,
            owned,
          };
        }
      } catch {
        questionBank = null; // meta is decorative; never block the listing
      }
    }

    // --- 6b. Study-pack meta (digital listings): counts/version + ownership ---
    let studyPack: { counts: unknown; version: number; owned: boolean } | null = null;
    if (listing.listing_kind === 'study_pack') {
      try {
        const { data: pack } = await supabaseService.getClient()
          .from('marketplace_study_packs')
          .select('counts, version')
          .eq('listing_id', id)
          .maybeSingle();
        if (pack) {
          let owned = false;
          if (viewerId) {
            const { data: entitlement } = await supabaseService.getClient()
              .from('marketplace_question_bank_entitlements')
              .select('id')
              .eq('listing_id', id)
              .eq('user_id', viewerId)
              .maybeSingle();
            owned = !!entitlement;
          }
          studyPack = { counts: pack.counts, version: pack.version, owned };
        }
      } catch {
        studyPack = null; // meta is decorative; never block the listing
      }
    }

    // Rights / takedown / appeal columns are owner/admin-only; strip for everyone
    // else (the public cache above stores the raw row, so this must run on every
    // response, cache hit or miss).
    const fullViewerIsOwner = Boolean(viewerId) && listing.user_id === viewerId;
    const fullViewerIsAdmin =
      !fullViewerIsOwner && viewerId ? await isLivePlatformAdmin(viewerId) : false;
    const responseListing =
      fullViewerIsOwner || fullViewerIsAdmin ? listing : stripListingModerationFields(listing);

    res.json({
      success: true,
      data: { listing: responseListing, isFavorited, similarListings, canReview, questionBank, studyPack },
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

    const { getMarketplaceSellerToolsService } = await import('../services/marketplaceSellerTools');
    const sellerTools = getMarketplaceSellerToolsService(supabaseService);
    const prefs = await sellerTools.getPreferences(userId);
    const shop = sellerTools.toShopPublic(prefs, profile.name || 'Shop');

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
      data: responseData,
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
    const { getMarketplaceSellerToolsService } = await import('../services/marketplaceSellerTools');
    try {
      const shop = await getMarketplaceSellerToolsService(supabaseService).updateShop(userId, {
        shopName,
        bio,
        coverImageUrl,
      });
      await cacheService.delete(CacheKeys.sellerProfile(userId, 'public'));
      await cacheService.delete(CacheKeys.sellerProfile(userId, 'owner'));
      res.json({ success: true, data: shop });
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : 'Failed to update shop';
      if (/required|characters or fewer/i.test(msg)) {
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
    const { getMarketplaceSellerToolsService } = await import('../services/marketplaceSellerTools');
    const result = await getMarketplaceSellerToolsService(supabaseService).listShops({
      campusId: typeof req.query.campus === 'string' ? req.query.campus : null,
      q: typeof req.query.q === 'string' ? req.query.q : null,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 24,
    });
    res.json({ success: true, data: result.shops, meta: { total: result.total, page: result.page, limit: result.limit } });
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
      const { marketplacePaystackEnabled } = await import('../services/marketplacePayments');
      if (marketplacePaystackEnabled()) {
        return res.status(409).json({
          success: false,
          error:
            'Offline payment links are disabled while Paystack checkout is enabled. Buyers pay in-app.',
        });
      }
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

// ---- Paystack marketplace payments ----

router.get(
  '/payments/config',
  authMiddleware,
  asyncHandler(async (_req: any, res: any) => {
    const { marketplacePaystackEnabled } = await import('../services/marketplacePayments');
    const { getPaystackPublicKey } = await import('../services/paystack');
    const {
      resolveMarketplaceServiceFeeBps,
      resolveMarketplaceDigitalBuyerFeeBps,
      resolveMarketplaceCreatorFeeBps,
    } = await import('@lantern/shared/marketplace');
    res.json({
      success: true,
      data: {
        paystackEnabled: marketplacePaystackEnabled(),
        publicKey: marketplacePaystackEnabled() ? getPaystackPublicKey() : null,
        serviceFeeBps: resolveMarketplaceServiceFeeBps(process.env.MARKETPLACE_SERVICE_FEE_BPS),
        // Digital fee model (Phase 2 · I): buyer surcharge on digital (default 0)
        // and the creator commission taken from the payout (default 1500 = 15%).
        digitalBuyerFeeBps: resolveMarketplaceDigitalBuyerFeeBps(process.env.MARKETPLACE_DIGITAL_BUYER_FEE_BPS),
        creatorFeeBps: resolveMarketplaceCreatorFeeBps(process.env.MARKETPLACE_CREATOR_FEE_BPS),
      },
    });
  })
);

// GET /api/v1/marketplace/seller/payments - the seller's earnings ledger (Phase 2 · I)
router.get(
  '/seller/payments',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const { getMarketplacePaymentsService } = await import('../services/marketplacePayments');
    const page = req.query?.page ? Number(req.query.page) : 1;
    const data = await getMarketplacePaymentsService(supabaseService).getSellerPayments(
      userId,
      Number.isFinite(page) && page > 0 ? page : 1
    );
    res.json({ success: true, data });
  })
);

router.post(
  '/payments/:reference/verify',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const { getMarketplacePaymentsService } = await import('../services/marketplacePayments');
    try {
      const result = await getMarketplacePaymentsService(supabaseService).verifyPaymentByReference(
        req.params.reference,
        req.user.id
      );
      res.json({ success: true, data: result });
    } catch (err: any) {
      res.status(400).json({ success: false, error: clientErrorMessage(err) });
    }
  })
);

// Resume / start Paystack checkout for an unpaid order (buyer only)
router.post(
  '/orders/:id/checkout',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = req.user.id;
    const { getMarketplacePaymentsService, marketplacePaystackEnabled } = await import(
      '../services/marketplacePayments'
    );
    if (!marketplacePaystackEnabled()) {
      return res.status(400).json({ success: false, error: 'Paystack checkout is not enabled' });
    }
    try {
      const email =
        (typeof req.user?.email === 'string' && req.user.email) ||
        (await supabaseService.getClient().auth.admin.getUserById(userId)).data.user?.email ||
        '';
      if (!email) {
        return res.status(400).json({
          success: false,
          error: 'A verified email is required for Paystack checkout',
        });
      }
      const session = await getMarketplacePaymentsService(supabaseService).getCheckoutSessionForOrder(
        req.params.id,
        userId,
        email
      );
      res.json({ success: true, data: session });
    } catch (err: any) {
      res.status(400).json({ success: false, error: clientErrorMessage(err) });
    }
  })
);

router.get(
  '/seller/payout-profile',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const { getMarketplacePaymentsService } = await import('../services/marketplacePayments');
    const profile = await getMarketplacePaymentsService(supabaseService).getSellerPayoutProfile(
      req.user.id
    );
    res.json({ success: true, data: profile });
  })
);

router.post(
  '/seller/payout-profile',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const { getMarketplacePaymentsService } = await import('../services/marketplacePayments');
    try {
      const profile = await getMarketplacePaymentsService(supabaseService).upsertSellerPayoutProfile(
        req.user.id,
        {
          accountNumber: req.body?.accountNumber,
          bankCode: req.body?.bankCode,
        }
      );
      res.json({ success: true, data: profile });
    } catch (err: any) {
      res.status(400).json({ success: false, error: clientErrorMessage(err) });
    }
  })
);

router.get(
  '/seller/banks',
  authMiddleware,
  asyncHandler(async (_req: any, res: any) => {
    const { listPaystackBanks, isPaystackConfigured } = await import('../services/paystack');
    if (!isPaystackConfigured()) {
      return res.json({ success: true, data: [] });
    }
    try {
      const banks = await listPaystackBanks();
      res.json({ success: true, data: banks });
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
    try {
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
    const listing = await supabaseService.getMarketplaceListingById(listingId);
    if (!listing) {
      return res.status(404).json({ success: false, error: 'Listing not found' });
    }
    const { getMarketplaceCouponsService } = await import('../services/marketplaceCoupons');
    try {
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
    } catch (err) {
      // "Invalid coupon code", "Coupon has expired", etc. are user conditions.
      if (respondMarketplaceClientError(res, err)) return;
      throw err;
    }
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
    try {
      const result = await getMarketplaceSellerToolsService(supabaseService).sendCampaign(
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
    const { getMarketplaceSellerToolsService } = await import('../services/marketplaceSellerTools');
    try {
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
    res.json({ success: true, data: await attachOrdersToOffers(data, req.user.id) });
  })
);

export default router;