import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { handleValidationErrors, validatePagination } from '../middleware/validation';
import { SupabaseService } from '../services/supabase';
import { CacheService } from '../services/cache';
import { logger } from '../utils/logger';

const router = Router();

// Initialize services (will be injected in main server)
let supabaseService: SupabaseService;
let cacheService: CacheService;

// Initialize function to be called from main server
export const initializeMarketplaceRoutes = (supabase: SupabaseService, cache: CacheService) => {
  supabaseService = supabase;
  cacheService = cache;
};

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
      search,
      minPrice,
      maxPrice,
      location,
      sortBy = 'created_at',
      sortOrder = 'desc'
    } = req.query;

    logger.debug('Fetching marketplace listings', { page, limit, category, search });

    const cacheKey = `marketplace:listings:${page}:${limit}:${category || ''}:${search || ''}:${minPrice || ''}:${maxPrice || ''}:${location || ''}:${sortBy}:${sortOrder}`;
    let listings = await cacheService.get(cacheKey);

    if (!listings) {
      listings = await supabaseService.getMarketplaceListings({
        page: parseInt(page),
        limit: parseInt(limit),
        category,
        search,
        minPrice: minPrice ? parseFloat(minPrice) : undefined,
        maxPrice: maxPrice ? parseFloat(maxPrice) : undefined,
        location,
        sortBy,
        sortOrder: sortOrder === 'asc' ? 'asc' : 'desc'
      });

      // Cache for 5 minutes
      await cacheService.set(cacheKey, listings, 300);
    }

    res.json({
      success: true,
      data: listings,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: (listings as any[]).length, // In production, get total count separately for efficiency
      },
    });
  })
);

// GET /api/v1/marketplace/listings/:id - Get listing by ID
router.get(
  '/listings/:id',
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { id } = req.params;

    logger.debug('Fetching marketplace listing', { id });

    const cacheKey = `marketplace:listing:${id}`;
    let listing = await cacheService.get(cacheKey);

    if (!listing) {
      listing = await supabaseService.getMarketplaceListingById(id);

      if (!listing) {
        return res.status(404).json({
          success: false,
          error: 'Listing not found',
        });
      }

      // Track view count (fire and forget)
      supabaseService.incrementListingViews(id);

      // Cache for 10 minutes
      await cacheService.set(cacheKey, listing, 600);
    }

    res.json({
      success: true,
      data: listing,
    });
  })
);

// POST /api/v1/marketplace/listings - Create listing
router.post(
  '/listings',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
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

    logger.debug('Creating marketplace listing', { userId, category: listingData.category, title: listingData.title });

    try {
      const listing = await supabaseService.createMarketplaceListing(listingData, userId);

      // Track custom category usage
      if (listingData.category?.startsWith('custom:')) {
        const categoryName = listingData.category.replace('custom:', '');
        await supabaseService.createCustomCategory(categoryName, userId).catch(() => {});
        await supabaseService.incrementCategoryUsage(categoryName).catch(() => {});
        cacheService.deletePattern('marketplace:custom_categories');
      }

      // Invalidate caches
      await cacheService.deletePattern('marketplace:listings:*');

      res.status(201).json({
        success: true,
        data: listing,
      });
    } catch (error: any) {
      logger.error('Failed to create marketplace listing:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to create listing',
      });
    }
  })
);

// PUT /api/v1/marketplace/listings/:id - Update listing
router.put(
  '/listings/:id',
  authMiddleware,
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

    if (listing.user_id !== userId && !req.user?.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    const updatedListing = await supabaseService.updateMarketplaceListing(id, updates);

    // Invalidate caches
    await cacheService.delete(`marketplace:listing:${id}`);
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

    if (listing.user_id !== userId && !req.user?.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    await supabaseService.deleteMarketplaceListing(id);

    // Invalidate caches
    await cacheService.delete(`marketplace:listing:${id}`);
    await cacheService.deletePattern('marketplace:listings:*');

    res.json({
      success: true,
      message: 'Listing deleted successfully',
    });
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
    await cacheService.delete(`marketplace:listing:${id}`);
    await cacheService.deletePattern('marketplace:listings:*');

    res.status(201).json({
      success: true,
      data: review,
    });
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

// POST /api/v1/marketplace/transactions - Initiate transaction (escrow)
router.post(
  '/transactions',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { listingId, amount } = req.body;
    const buyerId = req.user?.id;

    logger.debug('Initiating marketplace transaction', { listingId, buyerId, amount });

    const transaction = await supabaseService.initiateMarketplaceTransaction(listingId, buyerId, amount);

    res.status(201).json({
      success: true,
      data: transaction,
    });
  })
);

// ============ SELLER DASHBOARD ROUTES ============

// GET /api/v1/marketplace/my-listings - Get seller's own listings
router.get(
  '/my-listings',
  asyncHandler(async (req: any, res: any) => {
    const userId = req.query.userId || req.user?.id;
    const { status } = req.query;

    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId is required' });
    }

    logger.debug('Fetching seller listings', { userId, status });

    const listings = await supabaseService.getListingsBySeller(userId, status);

    res.json({
      success: true,
      data: listings,
    });
  })
);

// GET /api/v1/marketplace/stats - Get seller stats
router.get(
  '/stats',
  asyncHandler(async (req: any, res: any) => {
    const userId = req.query.userId || req.user?.id;

    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId is required' });
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
      await cacheService.delete(`marketplace:listing:${id}`);
      await cacheService.deletePattern('marketplace:listings:*');

      res.json({
        success: true,
        data: listing,
      });
    } catch (error: any) {
      res.status(403).json({
        success: false,
        error: error.message,
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
        receivedBody: req.body,
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
    await supabaseService.sendDirectMessage(buyerId, listing.user_id, dmMessage);

    // Generate thread ID (same logic as sendDirectMessage)
    const sortedIds = [buyerId, listing.user_id].sort();
    const threadId = sortedIds.join('-');

    // Create inquiry record
    const inquiry = await supabaseService.createInquiry(
      finalListingId,
      buyerId,
      listing.user_id,
      threadId,
      message
    );

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
      res.status(403).json({
        success: false,
        error: error.message,
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

    logger.debug('Fetching inquiry by thread', { threadId });

    const inquiry = await supabaseService.getInquiryByThread(threadId);

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
  asyncHandler(async (req: any, res: any) => {
    const userId = req.user.id;
    const { listingId, amount, message } = req.body;

    if (!listingId || !amount || amount <= 0) {
      return res.status(400).json({ success: false, error: 'listingId and a positive amount are required' });
    }

    logger.info('Creating marketplace offer', { userId, listingId, amount });

    // Get listing to find seller
    const listing = await supabaseService.getMarketplaceListingById(listingId);
    if (!listing) {
      return res.status(404).json({ success: false, error: 'Listing not found' });
    }
    if (listing.user_id === userId) {
      return res.status(400).json({ success: false, error: 'Cannot make an offer on your own listing' });
    }

    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

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

    if (error) throw error;

    // Create notification for seller
    try {
      await supabaseService.getClient()
        .from('notifications')
        .insert({
          user_id: listing.user_id,
          message: `New offer of ₦${Number(amount).toLocaleString()} on "${listing.title}"`,
          link: `marketplace:offer:${data.id}`,
        });
    } catch (e) {
      logger.warn('Failed to send offer notification', e);
    }

    res.status(201).json({ success: true, data });
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
        await supabaseService.getClient()
          .from('notifications')
          .insert({
            user_id: offer.buyer_id,
            message: `Seller countered with ₦${Number(counterAmount).toLocaleString()} on "${offer.listing?.title || 'listing'}"`,
            link: `marketplace:offer:${counterOffer.id}`,
          });
      } catch (e) {
        logger.warn('Failed to send counter notification', e);
      }
    } else {
      // accept, decline, or withdraw
      const { data, error: updateErr } = await supabaseService.getClient()
        .from('marketplace_offers')
        .update({ status: action === 'accept' ? 'accepted' : action === 'decline' ? 'declined' : 'withdrawn' })
        .eq('id', id)
        .select('*')
        .single();

      if (updateErr) throw updateErr;
      updatedOffer = data;

      // Notify the other party
      const notifyUserId = action === 'withdraw' ? offer.seller_id : offer.buyer_id;
      const actionText = action === 'accept' ? 'accepted' : action === 'decline' ? 'declined' : 'withdrawn';
      try {
        await supabaseService.getClient()
          .from('notifications')
          .insert({
            user_id: notifyUserId,
            message: `Offer of ₦${Number(offer.amount).toLocaleString()} on "${offer.listing?.title || 'listing'}" was ${actionText}`,
            link: `marketplace:offer:${id}`,
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
  asyncHandler(async (req: any, res: any) => {
    const { id } = req.params;
    const { userId } = req.query;

    // --- 1. Listing (cached 10 min) ---
    const listingCacheKey = `marketplace:listing:${id}`;
    let listing = await cacheService.get<any>(listingCacheKey);
    if (!listing) {
      listing = await supabaseService.getMarketplaceListingById(id);
      if (!listing) {
        return res.status(404).json({ success: false, error: 'Listing not found' });
      }
      supabaseService.incrementListingViews(id);
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

    // --- 3. isFavorited (user-specific, not cached) ---
    let isFavorited = false;
    if (userId) {
      isFavorited = await supabaseService.isListingFavorited(userId as string, id);
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
router.get(
  '/sellers/:userId/profile',
  asyncHandler(async (req: any, res: any) => {
    const { userId } = req.params;

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
    const activeListings = listings.filter(l => l.status === 'active');
    const soldListings = listings.filter(l => l.status === 'sold');

    // Get all reviews across this seller's listings
    const listingIds = listings.map(l => l.id);
    let allReviews: any[] = [];
    if (listingIds.length > 0) {
      const { data: reviews } = await supabaseService.getClient()
        .from('marketplace_reviews')
        .select('id, listing_id, reviewer_id, rating, comment, created_at, reviewer:profiles!marketplace_reviews_reviewer_id_fkey(id, name, avatar_url)')
        .in('listing_id', listingIds)
        .order('created_at', { ascending: false });
      allReviews = reviews || [];
    }

    // Get favorites count
    let totalFavorites = 0;
    if (listingIds.length > 0) {
      const { count } = await supabaseService.getClient()
        .from('marketplace_favorites')
        .select('id', { count: 'exact', head: true })
        .in('listing_id', listingIds);
      totalFavorites = count || 0;
    }

    // Get inquiries count
    let totalInquiries = 0;
    if (listingIds.length > 0) {
      const { count } = await supabaseService.getClient()
        .from('marketplace_inquiries')
        .select('id', { count: 'exact', head: true })
        .in('listing_id', listingIds);
      totalInquiries = count || 0;
    }

    const totalViews = listings.reduce((sum, l) => sum + (l.views_count || 0), 0);
    const avgRating = allReviews.length > 0
      ? allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length
      : 0;

    // Add listing title to reviews for display
    const reviewsWithTitle = allReviews.slice(0, 10).map(r => ({
      ...r,
      listing_title: listings.find(l => l.id === r.listing_id)?.title || 'Unknown listing',
    }));

    res.json({
      success: true,
      data: {
        user: profile,
        stats: {
          totalListings: listings.length,
          activeListings: activeListings.length,
          soldListings: soldListings.length,
          totalViews,
          totalInquiries,
          totalFavorites,
          avgRating: Math.round(avgRating * 10) / 10,
          totalReviews: allReviews.length,
        },
        recentListings: activeListings.slice(0, 6),
        recentReviews: reviewsWithTitle,
      },
    });
  })
);

export default router;