/**
 * Marketplace listings and browse.
 *
 * Reference data (/campuses), the browse and search surfaces, listing CRUD, the
 * listing cover-image upload, the browse-by-course entry points, the full
 * listing detail view, and the listing-scoped moderation entry points (boost,
 * report, appeal). Browse and search are readable signed-out; every write runs
 * `authMiddleware` plus the rights attestation and content filter in
 * services/moderation.ts before insert, and every write invalidates the
 * `marketplace:listings:*` cache keys.
 *
 * Registration order inside this file is load-bearing: `GET /listings/batch` is
 * registered before `GET /listings/:id`, which would otherwise swallow it.
 */
import { Router } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { authMiddleware, optionalAuthMiddleware } from '../../middleware/auth';
import { uploadBurstRateLimit } from '../../middleware/rateLimit';
import { handleValidationErrors, validatePagination, validateListingId, validateMarketplaceListingWrite, validateMarketplaceListingUpdate } from '../../middleware/validation';
import { requireAuthUserId } from '../../utils/requestAuth';
import { logger } from '../../utils/logger';
import { clientErrorMessage } from '../../utils/safeError';
import {
  assertListingAttestation,
  getModerationService,
  listingRightsFields,
  LISTING_MODERATION_FIELDS,
  runListingContentFilter,
  stripListingModerationFields,
} from '../../services/moderation';
import { isAcademicListing } from '@lantern/shared/moderation';
import { PublicError } from '../../utils/safeError';
import { invalidateListingCaches } from '../../utils/marketplaceCache';
import { normalizeIdempotencyKey, withIdempotency } from '../../services/idempotency';
import { idempotencyMiddleware, type IdempotentRequest } from '../../middleware/idempotency';
import { isLivePlatformAdmin } from '../../utils/platformAdminAuth';
import { MARKETPLACE_DEFAULT_CURRENCY, isMarketplaceListingModerated, marketplaceListingModerationNotice, isAllowedListingCategory, computeMarketplaceReviewSummary } from '@lantern/shared/marketplace';
import { supabaseService, cacheService, requestContentHash, MarketplaceCampusMetadataError, resolveRequiredMarketplaceCampus } from './context';
import { respondMarketplaceClientError } from './errors';
const router = Router();
// ============================================================
// LISTINGS AND BROWSE
//
// Reference data (/campuses), the browse and search surfaces, listing CRUD and
// the listing cover-image upload. Reads are open to every viewer; listing writes
// run `authMiddleware`, the rights attestation and the content filter in
// services/moderation.ts before insert, and every write invalidates the
// `marketplace:listings:*` cache keys.
// ============================================================


// ============================================================
// BROWSE BY COURSE (Gap 3)
//
// The course is the durable entry point into the digital marketplace: a bank
// published in March is still what a stranger finds in November. Both routes
// sit INSIDE the /api/v1/marketplace mount and are readable by every viewer,
// exactly like every other listing read.
//
// Cached hard (600s, plus a public Cache-Control) the way routes/campuses.ts
// caches its counts: the numbers move slowly and every browse hits them.
// Publishing already calls `cacheService.deletePattern('marketplace:listings:*')`,
// which is why both keys live under that prefix — a new bank must not leave a
// stale zero on its course.
// ============================================================


// ============================================================
// BOOSTS, REPORTS AND APPEALS
//
// Paid listing promotion plus the two moderation entry points sellers and
// buyers use: reporting a listing, and the seller's one-shot appeal against a
// takedown. The boost charge shares the content-hashed fallback idempotency key
// described above, keyed on listing id and duration.
// ============================================================


const resolveResponseProfile = (profile: unknown): 'compact' | 'full' =>
  profile === 'compact' ? 'compact' : 'full';


// GET /api/v1/marketplace/listings/batch?ids=a,b,c - Batch fetch active listings
// (recently-viewed rail). Registered before /listings/:id so "batch" is not
// treated as a listing id.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/jpg'];


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
      minRating,
      taxonomyNodeId,
      taxonomyNodeIds,
      includeUnclassified,
      sortBy = 'trending',
      sortOrder = 'desc',
      responseProfile,
    } = req.query;
    // Star filter: whole stars 1–5 only; anything else is ignored.
    const minRatingValue = (() => {
      const parsed = Number(minRating);
      return Number.isInteger(parsed) && parsed >= 1 && parsed <= 5 ? parsed : undefined;
    })();
    const profile = resolveResponseProfile(responseProfile);
    const categoryList = typeof categories === 'string' && categories.trim()
      ? categories.split(',').map((c: string) => c.trim()).filter(Boolean).slice(0, 20)
      : undefined;
    const includeCustomCategories = includeCustom === '1' || includeCustom === 'true';
    const taxonomyId =
      typeof taxonomyNodeId === 'string' && taxonomyNodeId.trim() ? taxonomyNodeId.trim() : undefined;
    // Group browse sends every descendant leaf. The cap matches the widest
    // group in the tree with headroom; a longer list is a malformed request.
    const taxonomyIdList =
      typeof taxonomyNodeIds === 'string' && taxonomyNodeIds.trim()
        ? taxonomyNodeIds
            .split(',')
            .map((id: string) => id.trim())
            .filter(Boolean)
            .slice(0, 40)
        : undefined;
    const includeUnclassifiedNodes =
      includeUnclassified === '1' || includeUnclassified === 'true';

    logger.debug('Fetching marketplace listings', { page, limit, category, search, profile, campusId, countryCode });

    const cacheKey = `marketplace:listings:v3:${page}:${limit}:${category || ''}:${categoryList ? categoryList.join('|') : ''}:${includeCustomCategories ? 1 : 0}:${search || ''}:${minPrice || ''}:${maxPrice || ''}:${location || ''}:${campusId || ''}:${countryCode || ''}:${condition || ''}:${minRatingValue || ''}:${taxonomyId || ''}:${taxonomyIdList ? taxonomyIdList.join('|') : ''}:${includeUnclassifiedNodes ? 1 : 0}:${sortBy}:${sortOrder}:profile:${profile}`;
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
        minRating: minRatingValue,
        taxonomyNodeId: taxonomyId,
        taxonomyNodeIds: taxonomyIdList,
        includeUnclassified: includeUnclassifiedNodes,
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

// GET /api/v1/marketplace/access - Whether the marketplace is available to the
// current viewer.
//
// The marketplace is open to everyone (2026-09-15), so this now always answers
// `enabled: true`. It is KEPT rather than deleted because every shipped mobile
// build up to 1.0.60 probes it at boot and treats a non-OK response as "could
// not check", which renders a dead wall over all 30 commerce screens. Answering
// `true` is what opens those installed builds with no update.
//
// `authenticated` is retained for the same reason: older clients read it to
// tell an anonymous answer apart from a real denial.
router.get(
  '/access',
  asyncHandler(async (req: any, res: any) => {
    res.json({
      success: true,
      data: {
        enabled: true,
        authenticated: Boolean(req.user?.id),
      },
    });
  })
);

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

// GET /api/v1/marketplace/courses?institutionId&limit — courses with >=1 active listing
router.get(
  '/courses',
  asyncHandler(async (req: any, res: any) => {
    const { getMarketplaceCoursesService, isCourseId } = await import(
      '../../services/marketplaceCourses'
    );
    const institutionId =
      typeof req.query.institutionId === 'string' && isCourseId(req.query.institutionId)
        ? req.query.institutionId
        : null;
    const limitRaw = parseInt(String(req.query.limit ?? ''), 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;

    const cacheKey = `marketplace:listings:courses:${institutionId || 'all'}:${limit || 'default'}`;
    const cached = await cacheService.get<unknown>(cacheKey);
    if (cached) {
      res.set('Cache-Control', 'public, max-age=600');
      return res.json({ success: true, data: cached });
    }

    const data = await getMarketplaceCoursesService(supabaseService).listCoursesWithListings({
      institutionId,
      limit,
    });
    await cacheService.set(cacheKey, data, 600);
    res.set('Cache-Control', 'public, max-age=600');
    res.json({ success: true, data });
  })
);

// GET /api/v1/marketplace/courses/:courseId/listings?limit&offset — one course page
router.get(
  '/courses/:courseId/listings',
  asyncHandler(async (req: any, res: any) => {
    const { getMarketplaceCoursesService, isCourseId } = await import(
      '../../services/marketplaceCourses'
    );
    const courseId = String(req.params.courseId || '');
    if (!isCourseId(courseId)) {
      return res.status(404).json({ success: false, error: 'Course not found' });
    }
    const limitRaw = parseInt(String(req.query.limit ?? ''), 10);
    const offsetRaw = parseInt(String(req.query.offset ?? ''), 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;
    const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;

    const cacheKey = `marketplace:listings:course:${courseId}:${limit || 'default'}:${offset}`;
    const cached = await cacheService.get<unknown>(cacheKey);
    if (cached) {
      res.set('Cache-Control', 'public, max-age=600');
      return res.json({ success: true, data: cached });
    }

    const data = await getMarketplaceCoursesService(supabaseService).listListingsForCourse(
      courseId,
      { limit, offset }
    );
    if (!data) {
      return res.status(404).json({ success: false, error: 'Course not found' });
    }
    await cacheService.set(cacheKey, data, 600);
    res.set('Cache-Control', 'public, max-age=600');
    res.json({ success: true, data });
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

// POST /api/v1/marketplace/upload-image — SEC-07 server-side MIME + magic-byte validation
router.post(
  '/upload-image',
  authMiddleware,
  uploadBurstRateLimit,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { fileName, base64Data, contentType, listingId, purpose } = req.body || {};
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
        purpose: purpose === 'shop' ? 'shop' : undefined,
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

    if (!isAllowedListingCategory(listingData.category)) {
      return res.status(400).json({
        success: false,
        error: 'Choose a campus listing type, or a custom type as custom:Name',
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
        // courseId/topicId ride on listingData — createMarketplaceListing
        // resolves the topic against the course before the insert.
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
          const { getMarketplaceSellerToolsService } = await import('../../services/marketplaceSellerTools');
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
      if (error instanceof PublicError) {
        return res.status(400).json({ success: false, error: error.message });
      }
      const { isMarketplacePricingError } = await import('../../utils/marketplacePricing');
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

    // Topic inside that course, resolved BEFORE the write against the course
    // the listing ends up with: moving (or unfiling) the listing takes its
    // topic with it rather than leaving it under another course's syllabus.
    const topicWasProvided =
      Object.prototype.hasOwnProperty.call(updates, 'topicId') ||
      Object.prototype.hasOwnProperty.call(updates, 'topic_id');
    const rawTopicId = topicWasProvided ? (updates.topicId ?? updates.topic_id ?? null) : undefined;
    delete updates.topicId;
    delete updates.topic_id;
    let nextTopicId: string | null | undefined;
    try {
      nextTopicId = await supabaseService.resolveArtefactTopic({
        topicId: rawTopicId,
        courseId: courseWasProvided ? nextCourseId : undefined,
        currentCourseId: listing.course_id ?? null,
      });
    } catch (error) {
      if (error instanceof PublicError) {
        return res.status(400).json({ success: false, error: error.message });
      }
      throw error;
    }

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

    if ((courseWasProvided || nextTopicId !== undefined) && updatedListing) {
      const { getAcademicCoursesService } = await import('../../services/academicCourses');
      await getAcademicCoursesService(supabaseService).setListingCourse(
        id,
        courseWasProvided ? nextCourseId : undefined,
        nextTopicId
      );
      updatedListing = {
        ...updatedListing,
        ...(courseWasProvided ? { course_id: nextCourseId } : {}),
        ...(nextTopicId !== undefined ? { topic_id: nextTopicId } : {}),
      };
    }

    const priceFields = ['price', 'sale_price', 'sale_ends_at'] as const;
    const priceChanged = priceFields.some((field) => field in updates);
    if (priceChanged) {
      const { notifyFavoritePriceDrop } = await import('../../services/marketplaceFavoriteAlerts');
      await notifyFavoritePriceDrop(
        supabaseService,
        { ...listing, ...updatedListing, id, user_id: listing.user_id, title: updatedListing?.title || listing.title },
        listing
      );
    }

    if (updates?.status === 'active' && listing.status !== 'active') {
      const { notifyListingBackAvailable } = await import('../../services/marketplaceFavoriteAlerts');
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
    const similarCacheKey = `marketplace:similar:v3:${id}`;
    let similarListings = await cacheService.get<any[]>(similarCacheKey);
    if (!similarListings) {
      similarListings = await supabaseService.getRelatedMarketplaceListings(listing, 6);
      await cacheService.set(similarCacheKey, similarListings, 300);
    }

    // --- 3. isFavorited (session user only — never trust query userId) ---
    let isFavorited = false;
    if (viewerId) {
      isFavorited = await supabaseService.isListingFavorited(viewerId, id);
    }

    // --- 4. Reviews with reviewer display names + read-time signals ---
    const reviews = await supabaseService.getMarketplaceReviews(id, viewerId);
    listing = { ...listing, reviews };
    const reviewSummary = computeMarketplaceReviewSummary(reviews);

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
      data: {
        listing: responseListing,
        isFavorited,
        similarListings,
        canReview,
        reviewSummary,
        questionBank,
        studyPack,
      },
    });
  })
);

// POST /api/v1/marketplace/listings/:id/boost - Boost listing visibility
router.post(
  '/listings/:id/boost',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const { id } = req.params;
    const userId = req.user?.id;
    const durationHours = Math.min(168, Math.max(1, Number(req.body?.durationHours) || 72));

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const idempotencyKey =
      normalizeIdempotencyKey(req.headers['idempotency-key']) ||
      `${userId}:boost:${requestContentHash({ listingId: String(id), durationHours })}:${Math.floor(
        Date.now() / 300_000,
      )}`;

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
      const { normalizeMarketplaceReportReason } = await import('../../utils/marketplaceReportReason');
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

export default router;
