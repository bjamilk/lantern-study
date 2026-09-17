/**
 * Offers: buyer-initiated price negotiation on a listing.
 *
 * Create, accept, decline, counter, withdraw. Unlike the order routes these
 * handlers do check role explicitly — only the buyer may withdraw, only the
 * listing owner may accept or decline — and `expiredPendingOfferDate` /
 * `offerExpiryConflict` terminalise a pending offer whose `expires_at` has
 * passed before any action is allowed. An accepted offer materialises an order,
 * which `attachOrdersToOffers` then joins back onto the offer list.
 */
import { Router } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { authMiddleware } from '../../middleware/auth';
import { logger } from '../../utils/logger';
import { clientErrorMessage } from '../../utils/safeError';
import { invalidateSellerAnalyticsCache } from '../../services/marketplaceOrders';
import { normalizeIdempotencyKey, withIdempotency } from '../../services/idempotency';
import { idempotencyMiddleware, type IdempotentRequest } from '../../middleware/idempotency';
import { isDigitalListingKind } from '@lantern/shared/marketplace';
import { dataLayer } from './context';
import { respondMarketplaceError } from './errors';
const router = Router();

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
    const { error } = await dataLayer.getClient()
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
      const { data, error } = await dataLayer.getClient()
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

// ============================================================
// OFFERS
//
// Buyer-initiated price negotiation on a listing: create, accept, decline,
// counter, withdraw. Unlike the order routes these handlers do check role
// explicitly — only the buyer may withdraw, only the listing owner may accept or
// decline — and `expiredPendingOfferDate` / `offerExpiryConflict` above
// terminalise a pending offer whose `expires_at` has passed before any action is
// allowed. An accepted offer materialises an order, which
// `attachOrdersToOffers` then joins back onto the offer list.
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

    const listing = await dataLayer.marketplace.getMarketplaceListingById(listingId);
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
      const { data, error } = await dataLayer.getClient()
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
          const { data: existing, error: existingError } = await dataLayer.getClient()
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
              const retry = await dataLayer.getClient()
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
        await dataLayer.notifications.createNotification(listing.user_id, {
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

    const { data, error } = await dataLayer.getClient()
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
    const { data: offer, error: fetchErr } = await dataLayer.getClient()
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
      const { data: rpcRows, error: counterRpcErr } = await dataLayer.getClient().rpc(
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

      const { data: counterOffer, error: counterFetchErr } = await dataLayer.getClient()
        .from('marketplace_offers')
        .select('*')
        .eq('id', counterOfferId)
        .single();
      if (counterFetchErr || !counterOffer) throw counterFetchErr || new Error('Counter offer not found');
      updatedOffer = counterOffer;

      const notifyUserId = actorIsBuyer ? offer.seller_id : offer.buyer_id;
      const counterLabel = actorRole === 'buyer' ? 'Buyer' : 'Seller';
      try {
        await dataLayer.notifications.createNotification(notifyUserId, {
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
          dataLayer.getClient(),
          userId,
          'marketplace_offer_accept',
          idempotencyKey,
          async () => {
            const finalized = await dataLayer.marketplace.finalizeOfferAcceptSale(id, userId);
            const { data: acceptedOffer, error: acceptedErr } = await dataLayer.getClient()
              .from('marketplace_offers')
              .select('*')
              .eq('id', id)
              .maybeSingle();
            if (acceptedErr) throw acceptedErr;
            // R5a: the row was just written by `accept`, so its absence is an
            // internal invariant break, not the caller's mistake. Left a bare
            // Error deliberately: the removed heuristic reported it as a 400,
            // and it must reach the 500 path and 5xx alerting instead.
            if (!acceptedOffer) throw new Error('Offer not found after accept');

            let checkout: Record<string, unknown> | null = null;
            const { marketplacePaystackEnabled, getMarketplacePaymentsService } = await import(
              '../../services/marketplacePayments'
            );
            if (marketplacePaystackEnabled() && finalized.orderId) {
              try {
                const buyerId = String(acceptedOffer.buyer_id);
                const email =
                  (await dataLayer.getClient().auth.admin.getUserById(buyerId)).data.user
                    ?.email || '';
                if (email) {
                  checkout = (await getMarketplacePaymentsService(
                    dataLayer
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
        // FIXED (G3 · H9): this catch turned EVERY failure into a 500, including
        // the two idempotency 409s a double-tapped accept produces. A fabricated
        // 5xx tells the client "server fault, keep the key and retry later" when
        // the truth is "the same accept is already running" or "mint a new key"
        // — and it polluted the 5xx error budget with a buyer's double tap.
        // Real client errors (409s included) now answer with their own status,
        // code and retryable hint; only genuine internal faults reach the 500.
        // The two idempotency refusals carry their own 409; a bare PublicError
        // from the accept path is a plain 400.
        if (respondMarketplaceError(res, finalizeErr, 400)) return;
        logger.error('Failed to finalize offer accept sale', finalizeErr);
        return res.status(500).json({
          success: false,
          error: clientErrorMessage(finalizeErr, 'Failed to create order from accepted offer'),
        });
      }
    } else {
      // decline or withdraw — conditional update prevents double-action races
      const nextStatus = action === 'decline' ? 'declined' : 'withdrawn';
      const { data, error: updateErr } = await dataLayer.getClient()
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
        await dataLayer.notifications.createNotification(notifyUserId, {
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
    const listing = await dataLayer.marketplace.getMarketplaceListingById(id);
    if (!listing || listing.user_id !== userId) {
      return res.status(403).json({ success: false, error: 'Only the listing owner can view offers' });
    }

    const { data, error } = await dataLayer.getClient()
      .from('marketplace_offers')
      .select('*, buyer:profiles!marketplace_offers_buyer_id_fkey(id, name, avatar_url)')
      .eq('listing_id', id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({ success: true, data: await attachOrdersToOffers(data, userId) });
  })
);

router.get(
  '/listings/:id/offers-history',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const listing = await dataLayer.marketplace.getMarketplaceListingById(req.params.id);
    if (!listing || listing.user_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Only the listing owner can view offer history' });
    }
    const { data, error } = await dataLayer.getClient()
      .from('marketplace_offers')
      .select('*, buyer:profiles!marketplace_offers_buyer_id_fkey(id, name, avatar_url)')
      .eq('listing_id', req.params.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, data: await attachOrdersToOffers(data, req.user.id) });
  })
);

export default router;
