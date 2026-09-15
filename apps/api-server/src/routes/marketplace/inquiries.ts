/**
 * Buyer/seller inquiries on a listing, and the DM thread each one opens.
 */
import { Router } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { authMiddleware } from '../../middleware/auth';
import { logger } from '../../utils/logger';
import { clientErrorMessage } from '../../utils/safeError';
import { supabaseService } from './context';
const router = Router();
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
        inquiry.id,
        { threadId, buyerId },
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

export default router;
