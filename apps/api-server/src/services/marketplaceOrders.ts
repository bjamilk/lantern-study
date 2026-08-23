import type { SupabaseService } from './supabase';
import { cacheService } from './cache';
import { logger } from '../utils/logger';
import { isDigitalListingKind } from '@lantern/shared/marketplace';
// PublicError messages survive production error masking (clientErrorMessage);
// every throw in this service is written for the end user.
import { PublicError } from '../utils/safeError';

export async function invalidateSellerAnalyticsCache(sellerId: string): Promise<void> {
  if (!sellerId) return;
  await cacheService.delete(`marketplace:analytics:seller:${sellerId}`);
}

// Orders in these statuses are still live (money may have moved, pickup pending,
// or a dispute is open). Terminal statuses are 'completed' and 'cancelled'.
// Exported so the listing-delete guard reuses the same source of truth instead
// of drifting its own copy.
export const OPEN_ORDER_STATUSES = [
  'awaiting_payment',
  'pending_payment',
  'paid',
  'ready_for_pickup',
  'buyer_confirmed',
  'disputed',
];

/** Dispute taxonomy (Phase 3 · N) — mirrors the marketplace_orders CHECK. */
export const DISPUTE_CATEGORIES = [
  'not_received',
  'not_as_described',
  'damaged',
  'wrong_item',
  'seller_unresponsive',
  'unauthorised',
  'other',
] as const;
export type DisputeCategory = (typeof DISPUTE_CATEGORIES)[number];
export const DISPUTE_REASON_MAX = 1000;

export function resolveEffectivePrice(listing: {
  price?: number | null;
  sale_price?: number | null;
  sale_ends_at?: string | null;
}): number {
  const base = Number(listing.price) || 0;
  const salePrice = listing.sale_price != null ? Number(listing.sale_price) : null;
  if (
    salePrice != null &&
    listing.sale_ends_at &&
    new Date(listing.sale_ends_at) > new Date()
  ) {
    return salePrice;
  }
  return base;
}

export type MarketplaceOrderRow = Record<string, any>;
export type SellerAnalyticsRow = Record<string, any>;
export type SellerBuyerContactRow = Record<string, any>;

export class MarketplaceOrdersService {
  constructor(private readonly supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  private assertListingInStock(
    listing: { quantity?: number | null; status: string },
    requestedQty = 1
  ): void {
    if (listing.status !== 'active') {
      throw new PublicError('Listing is not available for purchase');
    }
    if (listing.quantity == null) {
      if (requestedQty !== 1) {
        throw new PublicError('This listing can only be purchased as a single item');
      }
      return;
    }
    if (listing.quantity <= 0) {
      throw new PublicError('This listing is out of stock');
    }
    if (listing.quantity < requestedQty) {
      throw new PublicError('Not enough stock for the requested quantity');
    }
  }

  private async resolveInitialOrderStatus(_sellerId: string): Promise<'pending_payment' | 'paid'> {
    // Always pending_payment. This used to return 'paid' unless the seller had
    // opted into require_payment_confirmation — which meant clicking "Pay now"
    // created an order already recorded as paid with no money moving anywhere,
    // the exact bug users reported. Payment state must only ever be asserted
    // by a verified Paystack settlement (markPaymentPaid) or by the seller
    // explicitly confirming they received the money (mark_paid).
    return 'pending_payment';
  }

  /**
   * Record when an order actually became paid. Best-effort on purpose: the
   * paid_at column arrives in a hand-applied migration (20260820), and this
   * code can reach production first — a missing column must not break the
   * payment flow it documents. Timelines fall back to status when it is null.
   */
  async stampOrderPaidAt(orderId: string, when?: string): Promise<void> {
    try {
      const { error } = await this.db
        .from('marketplace_orders')
        .update({ paid_at: when || new Date().toISOString() })
        .eq('id', orderId)
        .is('paid_at', null);
      if (error) {
        // supabase-js returns errors rather than throwing, so without this log
        // a missing column silently discarded every seller confirmation's
        // timestamp — permanently, since mark_paid only fires once per order.
        logger.warn('Could not stamp marketplace_orders.paid_at — is migration 20260820120000 applied?', {
          orderId,
          error: error.message,
        });
      }
    } catch (err) {
      logger.warn('Could not stamp marketplace_orders.paid_at', {
        orderId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async submitPaymentProof(
    orderId: string,
    userId: string,
    proofUrl: string
  ): Promise<MarketplaceOrderRow> {
    const order = await this.getOrderById(orderId, userId);
    if (!order) throw new PublicError('Order not found');
    if (order.buyer_id !== userId) throw new PublicError('Only the buyer can submit payment proof');
    if (order.status !== 'pending_payment') {
      throw new PublicError('Order is not awaiting payment proof');
    }
    if (!proofUrl?.trim()) throw new PublicError('Payment proof URL is required');

    const now = new Date().toISOString();
    const { data, error } = await this.db
      .from('marketplace_orders')
      .update({
        payment_proof_url: proofUrl.trim(),
        payment_proof_submitted_at: now,
      })
      .eq('id', orderId)
      .select(this.orderSelect)
      .single();

    if (error) throw error;

    const listingTitle =
      (order.listing as { title?: string } | null)?.title || 'your listing';

    await this.notifyOrderParty(order.seller_id, {
      type: 'marketplace_order_update',
      message: `Payment proof submitted for "${listingTitle}" — review and confirm payment.`,
      link: `marketplace:order:${orderId}`,
      data: { orderId, paymentProof: true },
    });

    await this.notifyOrderParty(order.buyer_id, {
      type: 'marketplace_order_update',
      message: `Payment proof received for "${listingTitle}". The seller will confirm shortly.`,
      link: `marketplace:order:${orderId}`,
      data: { orderId, paymentProof: true },
    });

    return data as MarketplaceOrderRow;
  }

  private orderSelect = `
    *,
    listing:marketplace_listings(id, title, price, sale_price, sale_ends_at, promo_label, images, category, status, location),
    buyer:profiles!marketplace_orders_buyer_id_fkey(id, name, avatar_url),
    seller:profiles!marketplace_orders_seller_id_fkey(id, name, avatar_url),
    transaction:marketplace_transactions(id, status, amount, created_at)
  `;

  async assertNoOpenOrderForListing(listingId: string): Promise<void> {
    const listing = await this.supabaseService.getMarketplaceListingById(listingId);
    if (!listing) throw new PublicError('Listing not found');
    // Multi-qty: remaining quantity is the stock; unique (null qty) allows one open order.
    if (listing.quantity != null) {
      if (listing.status !== 'active' || listing.quantity <= 0) {
        throw new PublicError('This listing is out of stock');
      }
      return;
    }
    const { data, error } = await this.db
      .from('marketplace_orders')
      .select('id')
      .eq('listing_id', listingId)
      .in('status', OPEN_ORDER_STATUSES)
      .limit(1);

    if (error) throw error;
    if (data && data.length > 0) {
      throw new PublicError('This listing already has an open order');
    }
  }

  private isUniqueViolation(error: { code?: string; message?: string } | null | undefined): boolean {
    if (!error) return false;
    return error.code === '23505' || /duplicate key|unique constraint/i.test(error.message || '');
  }

  private async getOpenOrderForListing(listingId: string): Promise<MarketplaceOrderRow | null> {
    const { data, error } = await this.db
      .from('marketplace_orders')
      .select(this.orderSelect)
      .eq('listing_id', listingId)
      .in('status', OPEN_ORDER_STATUSES)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data as MarketplaceOrderRow) || null;
  }

  private async getOrderByOfferId(offerId: string): Promise<MarketplaceOrderRow | null> {
    const { data, error } = await this.db
      .from('marketplace_orders')
      .select(this.orderSelect)
      .eq('offer_id', offerId)
      .maybeSingle();
    if (error) throw error;
    return (data as MarketplaceOrderRow) || null;
  }

  private async insertPendingTransaction(
    listingId: string,
    buyerId: string,
    sellerId: string,
    amount: number
  ): Promise<{ id: string }> {
    const { data, error } = await this.db
      .from('marketplace_transactions')
      .insert({
        buyer_id: buyerId,
        seller_id: sellerId,
        listing_id: listingId,
        amount,
        status: 'pending',
      })
      .select('id')
      .single();

    if (error) throw error;
    return data;
  }

  private async voidOrphanPendingTransaction(txnId: string): Promise<void> {
    await this.db
      .from('marketplace_transactions')
      .delete()
      .eq('id', txnId)
      .eq('status', 'pending');
  }

  private async findInquiryForDeal(
    listingId: string,
    buyerId: string
  ): Promise<string | null> {
    const { data } = await this.db
      .from('marketplace_inquiries')
      .select('id')
      .eq('listing_id', listingId)
      .eq('buyer_id', buyerId)
      .maybeSingle();
    return data?.id ?? null;
  }

  async createOrderFromBuyNow(
    listingId: string,
    buyerId: string,
    couponCode?: string,
    quantityInput?: number
  ): Promise<MarketplaceOrderRow> {
    const quantity = Math.max(1, Math.floor(Number(quantityInput) || 1));
    const listing = await this.supabaseService.getMarketplaceListingById(listingId);
    if (!listing) throw new PublicError('Listing not found');
    if (listing.user_id === buyerId) throw new PublicError('Cannot buy your own listing');

    // This method is the non-Paystack path (manual payment + meetup). Digital
    // products (question banks, study packs) are delivered on payment
    // confirmation, which only the Paystack flow provides — free ones use the
    // download endpoint instead.
    if (isDigitalListingKind(listing.listing_kind)) {
      throw new PublicError('Digital products are delivered in-app and require in-app payment');
    }

    this.assertListingInStock(listing, quantity);

    await this.assertNoOpenOrderForListing(listingId);

    const unitPrice = resolveEffectivePrice(listing);
    let unitAmount = unitPrice;
    let couponId: string | null = null;
    let unitDiscount = 0;

    if (couponCode) {
      const { getMarketplaceCouponsService } = await import('./marketplaceCoupons');
      const validated = await getMarketplaceCouponsService(this.supabaseService).validateForListing(
        couponCode,
        listing,
        buyerId
      );
      unitAmount = validated.finalAmount;
      couponId = validated.coupon.id;
      unitDiscount = validated.discountAmount;
    }

    const amount = Math.round(unitAmount * quantity * 100) / 100;
    const discountAmount = Math.round(unitDiscount * quantity * 100) / 100;

    const inquiryId = await this.findInquiryForDeal(listingId, buyerId);
    const initialStatus = await this.resolveInitialOrderStatus(listing.user_id);

    const { data: rpcRows, error: rpcError } = await this.db.rpc('marketplace_create_buy_now_order', {
      p_listing_id: listingId,
      p_buyer_id: buyerId,
      p_amount: amount,
      p_inquiry_id: inquiryId,
      p_initial_status: initialStatus,
      p_coupon_id: couponId,
      p_discount_amount: discountAmount,
      p_quantity: quantity,
    });

    if (rpcError) {
      if (this.isUniqueViolation(rpcError)) {
        const existing = await this.getOpenOrderForListing(listingId);
        if (existing) {
          if (existing.buyer_id === buyerId) return existing;
          throw new PublicError('This listing already has an open order');
        }
      }
      throw rpcError;
    }

    const rpcRow = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
    const orderId = rpcRow?.order_id as string | undefined;
    if (!orderId) throw new PublicError('Failed to create marketplace order');

    const { data: order, error: orderError } = await this.db
      .from('marketplace_orders')
      .select(this.orderSelect)
      .eq('id', orderId)
      .single();

    if (orderError || !order) throw orderError || new Error('Order not found after creation');
    const row = order as MarketplaceOrderRow;

    // Coupon uses_count is incremented inside marketplace_create_buy_now_order (CONC-03).

    await this.notifyOrderParty(listing.user_id, {
      type: 'marketplace_purchase',
      message: `New order on "${listing.title}"${quantity > 1 ? ` ×${quantity}` : ''} for ₦${amount.toLocaleString()}${discountAmount > 0 ? ` (₦${discountAmount.toLocaleString()} coupon applied)` : ''}`,
      link: `marketplace:order:${row.id}`,
      data: { orderId: row.id, listingId, quantity },
    });

    await this.notifyOrderParty(buyerId, {
      type: 'marketplace_order_update',
      message:
        initialStatus === 'pending_payment'
          ? `Order created for "${listing.title}"${quantity > 1 ? ` ×${quantity}` : ''}. Upload payment proof after you pay the seller.`
          : `Order placed for "${listing.title}"${quantity > 1 ? ` ×${quantity}` : ''}. Arrange campus pickup with the seller.`,
      link: `marketplace:order:${row.id}`,
      data: { orderId: row.id, listingId, quantity },
    });

    await invalidateSellerAnalyticsCache(listing.user_id);
    try {
      const { invalidateListingCaches } = await import('../utils/marketplaceCache');
      await invalidateListingCaches(cacheService, listingId);
    } catch {
      // best-effort
    }
    return row;
  }

  async createOrderFromOfferAccept(offerId: string, actorId?: string): Promise<MarketplaceOrderRow> {
    const { data: offer, error } = await this.db
      .from('marketplace_offers')
      .select(
        'id, listing_id, buyer_id, seller_id, amount, counter_amount, status, listing:marketplace_listings(id, title, price, sale_price, sale_ends_at, user_id, status)'
      )
      .eq('id', offerId)
      .single();

    if (error || !offer) throw new PublicError('Offer not found');

    const listingRaw = offer.listing as any;
    if (!listingRaw || Array.isArray(listingRaw)) {
      throw new PublicError('Listing not found for offer');
    }

    const sellerId = offer.seller_id as string;
    const actor = actorId || sellerId;
    const inquiryId = await this.findInquiryForDeal(offer.listing_id, offer.buyer_id);
    const initialStatus = await this.resolveInitialOrderStatus(sellerId);

    const { data: rpcRows, error: rpcError } = await this.db.rpc(
      'marketplace_create_offer_accept_order',
      {
        p_offer_id: offerId,
        p_actor_id: actor,
        p_inquiry_id: inquiryId,
        p_initial_status: initialStatus,
      }
    );

    if (rpcError) {
      if (this.isUniqueViolation(rpcError)) {
        const byOffer = await this.getOrderByOfferId(offerId);
        if (byOffer) return byOffer;
      }
      throw rpcError;
    }

    const rpcRow = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
    const orderId = rpcRow?.order_id as string | undefined;
    if (!orderId) throw new PublicError('Failed to create order from offer');

    const { data: order, error: orderError } = await this.db
      .from('marketplace_orders')
      .select(this.orderSelect)
      .eq('id', orderId)
      .single();

    if (orderError || !order) throw orderError || new Error('Order not found after offer accept');
    const row = order as MarketplaceOrderRow;

    const amount = Number(row.amount) || Number(offer.counter_amount ?? offer.amount) || 0;
    const title = listingRaw.title || 'listing';
    const buyerAccepted = actor === offer.buyer_id;
    await this.notifyOrderParty(sellerId, {
      type: 'marketplace_purchase',
      message: buyerAccepted
        ? `Buyer accepted your counter — order for "${title}" at ₦${amount.toLocaleString()}`
        : `Offer accepted — order for "${title}" at ₦${amount.toLocaleString()}`,
      link: `marketplace:order:${row.id}`,
      data: { orderId: row.id, offerId },
    });
    await this.notifyOrderParty(offer.buyer_id, {
      type: 'marketplace_order_update',
      message: buyerAccepted
        ? initialStatus === 'pending_payment'
          ? `You accepted the counter for "${title}". Upload payment proof after paying.`
          : `You accepted the counter for "${title}". View order to arrange pickup.`
        : initialStatus === 'pending_payment'
          ? `Your offer was accepted for "${title}". Upload payment proof after paying.`
          : `Your offer was accepted for "${title}". View order to arrange pickup.`,
      link: `marketplace:order:${row.id}`,
      data: { orderId: row.id, offerId },
    });

    await invalidateSellerAnalyticsCache(sellerId);
    try {
      const { invalidateListingCaches } = await import('../utils/marketplaceCache');
      await invalidateListingCaches(cacheService, offer.listing_id as string);
    } catch {
      // best-effort
    }
    return row;
  }

  async getOrdersForUser(
    userId: string,
    role: 'buyer' | 'seller' = 'buyer'
  ): Promise<MarketplaceOrderRow[]> {
    const column = role === 'seller' ? 'seller_id' : 'buyer_id';
    const { data, error } = await this.db
      .from('marketplace_orders')
      .select(this.orderSelect)
      .eq(column, userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []) as MarketplaceOrderRow[];
  }

  async getOrderById(orderId: string, userId: string): Promise<MarketplaceOrderRow | null> {
    const { data, error } = await this.db
      .from('marketplace_orders')
      .select(this.orderSelect)
      .eq('id', orderId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;
    const row = data as MarketplaceOrderRow;
    if (row.buyer_id !== userId && row.seller_id !== userId) {
      throw new PublicError('Unauthorized');
    }
    return row;
  }

  async getOrderForInquiry(inquiryId: string, userId: string): Promise<MarketplaceOrderRow | null> {
    const { data, error } = await this.db
      .from('marketplace_orders')
      .select(this.orderSelect)
      .eq('inquiry_id', inquiryId)
      .in('status', OPEN_ORDER_STATUSES)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;
    const row = data as MarketplaceOrderRow;
    if (row.buyer_id !== userId && row.seller_id !== userId) return null;
    return row;
  }

  async updateOrderStatus(
    orderId: string,
    userId: string,
    action:
      | 'mark_paid'
      | 'mark_ready'
      | 'confirm_received'
      | 'cancel'
      | 'open_dispute',
    // Phase 3 N: `open_dispute` has existed since Phase 1 with no client able
    // to send a reason. The dispute UI now supplies one.
    options: { disputeReason?: string; disputeCategory?: string } = {}
  ): Promise<MarketplaceOrderRow> {
    const order = await this.getOrderById(orderId, userId);
    if (!order) throw new PublicError('Order not found');

    const isSeller = order.seller_id === userId;
    const isBuyer = order.buyer_id === userId;
    const now = new Date().toISOString();
    let nextStatus = order.status;
    const patch: Record<string, unknown> = {};

    switch (action) {
      case 'mark_paid': {
        const { marketplacePaystackEnabled } = await import('./marketplacePayments');
        if (marketplacePaystackEnabled() && order.payment_id) {
          throw new PublicError(
            'This order is paid via Paystack. Manual mark-paid is disabled; wait for payment confirmation.'
          );
        }
        // Seller-only: mark_paid is the receiving party attesting the money
        // arrived (cash at pickup, direct transfer). The buyer could previously
        // flip their own order to paid with one API call — the seller then got
        // a "Payment confirmed" notification for money that never moved.
        if (!isSeller) throw new PublicError('Only the seller can confirm payment was received');
        if (order.status !== 'pending_payment') throw new PublicError('Order is not awaiting payment');
        nextStatus = 'paid';
        break;
      }
      case 'mark_ready':
        if (!isSeller) throw new PublicError('Only the seller can mark ready for pickup');
        if (!['paid', 'pending_payment'].includes(order.status)) {
          throw new PublicError('Order cannot be marked ready in current status');
        }
        nextStatus = 'ready_for_pickup';
        patch.seller_confirmed_at = now;
        break;
      case 'confirm_received': {
        if (!isBuyer) throw new PublicError('Only the buyer can confirm receipt');
        if (!['ready_for_pickup', 'paid', 'buyer_confirmed'].includes(order.status)) {
          throw new PublicError('Order is not ready for buyer confirmation');
        }
        patch.buyer_confirmed_at = now;
        await this.db.from('marketplace_orders').update({ buyer_confirmed_at: now }).eq('id', orderId);
        const { getMarketplacePaymentsService, marketplacePaystackEnabled } = await import(
          './marketplacePayments'
        );
        if (marketplacePaystackEnabled() && order.payment_id) {
          return getMarketplacePaymentsService(this.supabaseService).payoutOnConfirmReceived(
            orderId,
            userId
          );
        }
        return this.releaseEscrow(orderId, userId);
      }
      case 'cancel': {
        if (!isSeller && !isBuyer) throw new PublicError('Unauthorized');
        if (['completed', 'cancelled'].includes(order.status)) {
          throw new PublicError('Order cannot be cancelled');
        }
        nextStatus = 'cancelled';
        const { getMarketplacePaymentsService, marketplacePaystackEnabled } = await import(
          './marketplacePayments'
        );
        if (marketplacePaystackEnabled() && order.payment_id) {
          await getMarketplacePaymentsService(this.supabaseService).refundPaymentForOrder(
            orderId,
            userId
          );
        }
        await this.refundEscrow(order);
        await this.restoreListingAfterCancelledOrder(order.listing_id, Number(order.quantity) || 1);
        break;
      }
      case 'open_dispute': {
        if (!isBuyer && !isSeller) throw new PublicError('Unauthorized');
        nextStatus = 'disputed';
        patch.disputed_at = now;
        patch.dispute_opened_by = userId;
        if (options.disputeCategory && DISPUTE_CATEGORIES.includes(options.disputeCategory as DisputeCategory)) {
          patch.dispute_category = options.disputeCategory;
        }
        if (typeof options.disputeReason === 'string' && options.disputeReason.trim()) {
          // The column CHECKs 1000 chars; truncate rather than 500 on a long note.
          patch.dispute_reason = options.disputeReason.trim().slice(0, DISPUTE_REASON_MAX);
        }
        if (order.transaction_id) {
          await this.db
            .from('marketplace_transactions')
            .update({ status: 'disputed' })
            .eq('id', order.transaction_id);
        }
        break;
      }
      default:
        throw new PublicError('Invalid action');
    }

    patch.status = nextStatus;
    const { data, error } = await this.db
      .from('marketplace_orders')
      .update(patch)
      .eq('id', orderId)
      .select(this.orderSelect)
      .single();

    if (error) throw error;

    // Evidence only after the transition committed: stamping before it (the
    // first version of this change) could leave paid_at on an order whose
    // status write failed — fabricated payment evidence on a pending order.
    if (action === 'mark_paid') {
      await this.stampOrderPaidAt(orderId, now);
    }

    const listingTitle =
      (order.listing as { title?: string } | null)?.title || 'your order';
    const amountStr = `₦${Number(order.amount).toLocaleString()}`;
    const otherParty = isSeller ? order.buyer_id : order.seller_id;

    const statusMessages: Record<string, { self?: string; other: string }> = {
      mark_paid: {
        other: `The seller confirmed receiving your payment for "${listingTitle}" (${amountStr}) and will prepare your item.`,
      },
      mark_ready: {
        other: `"${listingTitle}" is ready for campus pickup (${amountStr}). Tap to view meetup details.`,
      },
      confirm_received: {
        other: `Buyer confirmed receipt for "${listingTitle}".`,
      },
      cancel: {
        self: `Order for "${listingTitle}" was cancelled.`,
        other: `Order for "${listingTitle}" was cancelled.`,
      },
      open_dispute: {
        other: `A dispute was opened for "${listingTitle}". Our team may review the case.`,
      },
    };

    const copy = statusMessages[action];
    if (copy) {
      await this.notifyOrderParty(otherParty, {
        type: 'marketplace_order_update',
        message: copy.other,
        link: `marketplace:order:${orderId}`,
        data: { orderId, action, status: nextStatus },
      });
      if (copy.self && isSeller) {
        await this.notifyOrderParty(userId, {
          type: 'marketplace_order_update',
          message: copy.self,
          link: `marketplace:order:${orderId}`,
          data: { orderId, action, status: nextStatus },
        });
      }
    }

    await invalidateSellerAnalyticsCache(order.seller_id);
    return data as MarketplaceOrderRow;
  }

  async releaseEscrow(orderId: string, userId: string): Promise<MarketplaceOrderRow> {
    const order = await this.getOrderById(orderId, userId);
    if (!order) throw new PublicError('Order not found');
    if (order.buyer_id !== userId && order.seller_id !== userId) {
      throw new PublicError('Unauthorized');
    }
    if (order.status === 'completed') return order;

    return this.finalizeEscrowRelease(orderId, {
      actorId: userId,
      allowDisputed: false,
      notifyCompletion: true,
    });
  }

  /**
   * RC-01: complete order via marketplace_release_escrow (row lock + one stock decrement).
   * Budget ledger uses deterministic ids (upsert) so duplicate calls are safe.
   */
  private async finalizeEscrowRelease(
    orderId: string,
    options: {
      actorId?: string | null;
      allowDisputed: boolean;
      notifyCompletion: boolean;
      adminNote?: string;
    }
  ): Promise<MarketplaceOrderRow> {
    const { data: rpcRows, error: rpcError } = await this.db.rpc('marketplace_release_escrow', {
      p_order_id: orderId,
      p_actor_id: options.actorId ?? null,
      p_allow_disputed: options.allowDisputed,
    });

    if (rpcError) throw rpcError;

    const rpcRow = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
    if (!rpcRow?.order_id) throw new PublicError('Failed to release marketplace escrow');

    const { data, error } = await this.db
      .from('marketplace_orders')
      .select(this.orderSelect)
      .eq('id', orderId)
      .single();

    if (error || !data) throw error || new Error('Order not found after escrow release');
    const completed = data as MarketplaceOrderRow;
    const alreadyCompleted = Boolean(rpcRow.already_completed);

    const listingTitle =
      (completed.listing as { title?: string } | null)?.title || 'Marketplace item';

    if (completed.transaction_id) {
      await this.supabaseService.logMarketplaceBudgetTransactions({
        listingId: completed.listing_id,
        listingTitle,
        amount: Number(completed.amount),
        sellerId: completed.seller_id,
        buyerId: completed.buyer_id,
        marketplaceTransactionId: completed.transaction_id,
        source: completed.source === 'offer_accept' ? 'offer_accept' : 'buy_now',
      });
    }

    // The inquiry that led to this deal is settled — close the loop so sellers
    // don't have to hand-mark it. Best-effort: an inquiry-status miss must
    // never fail an escrow release. Idempotent via the status filter.
    if (completed.inquiry_id) {
      try {
        await this.db
          .from('marketplace_inquiries')
          .update({ status: 'purchased' })
          .eq('id', completed.inquiry_id)
          .neq('status', 'purchased');
      } catch (err) {
        logger.warn('Could not mark inquiry purchased after order completion', {
          orderId,
          inquiryId: completed.inquiry_id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (!alreadyCompleted && options.notifyCompletion) {
      const noteSuffix = options.adminNote?.trim() ? ` Note: ${options.adminNote.trim()}` : '';
      if (options.allowDisputed) {
        await this.notifyOrderParty(completed.seller_id, {
          type: 'marketplace_order_update',
          message: `Dispute resolved in your favor — order completed for "${listingTitle}".${noteSuffix}`,
          link: `marketplace:order:${orderId}`,
          data: { orderId, disputeResolved: true, resolution: 'release_to_seller' },
        });
        await this.notifyOrderParty(completed.buyer_id, {
          type: 'marketplace_order_update',
          message: `Dispute closed: payment released to the seller for "${listingTitle}".${noteSuffix}`,
          link: `marketplace:order:${orderId}`,
          data: { orderId, disputeResolved: true, resolution: 'release_to_seller' },
        });
      } else {
        await this.notifyOrderParty(completed.seller_id, {
          type: 'marketplace_order_update',
          message: `Order completed for "${listingTitle}" — ₦${Number(completed.amount).toLocaleString()}`,
          link: `marketplace:order:${orderId}`,
          data: { orderId, completed: true },
        });
      }

      await this.notifyOrderParty(completed.buyer_id, {
        type: 'marketplace_review_prompt',
        message: `How was your purchase of "${listingTitle}"? Leave a review for the seller.`,
        link: `marketplace:listing:${completed.listing_id}:review`,
        data: { orderId, listingId: completed.listing_id },
      });
    }

    // North-star metric (Phase 3 · O): a completed order is one student
    // getting something from another. Only on the first completion — the
    // weekly unique index would dedupe a repeat anyway, but re-running it on
    // every idempotent replay is pointless work.
    if (!alreadyCompleted) {
      const { getLearningConnectionsService } = await import('./learningConnections');
      await getLearningConnectionsService(this.supabaseService).record({
        actorId: completed.seller_id,
        beneficiaryId: completed.buyer_id,
        kind: 'order_completed',
        objectType: 'order',
        objectId: orderId,
      });
    }

    await invalidateSellerAnalyticsCache(completed.seller_id);
    return completed;
  }

  private async refundEscrow(order: MarketplaceOrderRow): Promise<void> {
    if (!order.transaction_id) return;
    await this.db
      .from('marketplace_transactions')
      .update({ status: 'refunded' })
      .eq('id', order.transaction_id);
  }

  /** Cancel/refund: return held units (multi-qty) and/or un-reserve a unique listing. */
  private async restoreListingAfterCancelledOrder(
    listingId: string,
    heldQuantity = 1
  ): Promise<void> {
    if (!listingId) return;
    const restoreQty = Math.max(1, Math.floor(Number(heldQuantity) || 1));
    const now = new Date().toISOString();
    const listing = await this.supabaseService.getMarketplaceListingById(listingId);
    if (!listing) return;

    if (listing.quantity != null) {
      // Always give the held units back, but only re-open availability from an
      // order-held state. A listing moderation took down (removed/suspended),
      // an archived one, or one the seller paused/sold meanwhile must keep its
      // status — otherwise cancelling any open order would relist it.
      const restore: Record<string, unknown> = {
        quantity: Number(listing.quantity) + restoreQty,
        updated_at: now,
      };
      if (listing.status === 'active' || listing.status === 'reserved') {
        restore.status = 'active';
      }
      await this.db.from('marketplace_listings').update(restore).eq('id', listingId);
    } else {
      await this.db
        .from('marketplace_listings')
        .update({ status: 'active', updated_at: now })
        .eq('id', listingId)
        .eq('status', 'reserved');
    }

    try {
      const { invalidateListingCaches } = await import('../utils/marketplaceCache');
      await invalidateListingCaches(cacheService, listingId);
    } catch {
      // best-effort cache bust
    }
  }

  async createPaymentLinkOrder(
    orderId: string,
    userId: string
  ): Promise<{ orderId: string; amount: number; deepLink: string }> {
    const order = await this.getOrderById(orderId, userId);
    if (!order) throw new PublicError('Order not found');
    if (order.seller_id !== userId) throw new PublicError('Only the seller can request payment');
    if (['completed', 'cancelled'].includes(order.status)) {
      throw new PublicError('Order is closed');
    }

    // Deliberately no status change here. Requesting payment used to flip a
    // pending_payment order to 'paid' as a side effect of this notification —
    // the seller asking for money marked it received, silently defeating the
    // payment-confirmation flow that same seller had opted into.

    await this.notifyOrderParty(order.buyer_id, {
      type: 'marketplace_order_update',
      message: `Payment requested: ₦${Number(order.amount).toLocaleString()} — tap to view order and confirm pickup.`,
      link: `marketplace:order:${orderId}`,
      data: { orderId, paymentRequest: true },
    });

    return {
      orderId: order.id,
      amount: Number(order.amount),
      deepLink: `marketplace:order:${orderId}`,
    };
  }

  async getSellerAnalytics(userId: string): Promise<SellerAnalyticsRow> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyIso = thirtyDaysAgo.toISOString();

    const [ordersRes, listingsRes, offersRes, inquiriesRes] = await Promise.all([
      this.db
        .from('marketplace_orders')
        .select('id, listing_id, amount, status, completed_at, created_at, source, inquiry_id')
        .eq('seller_id', userId),
      this.db
        .from('marketplace_listings')
        .select('id, title, status, views_count, price, sale_price, created_at, updated_at, quantity')
        .eq('user_id', userId),
      this.db.from('marketplace_offers').select('id, status, listing_id').eq('seller_id', userId),
      this.db
        .from('marketplace_inquiries')
        .select('id, status')
        .eq('seller_id', userId)
        .in('status', ['open', 'negotiating']),
    ]);

    const orders = ordersRes.data || [];
    const listings = listingsRes.data || [];
    const offers = offersRes.data || [];
    const openInquiries = inquiriesRes.data?.length || 0;

    const completed = orders.filter((o) => o.status === 'completed');
    const completedListingIds = new Set(completed.map((o) => o.listing_id));
    const completedSalesCount = completed.length;
    const totalRevenue = completed.reduce((s, o) => s + Number(o.amount), 0);
    const revenue30d = completed
      .filter((o) => o.completed_at && o.completed_at >= thirtyIso)
      .reduce((s, o) => s + Number(o.amount), 0);

    const totalViews = listings.reduce((s, l) => s + (l.views_count || 0), 0);
    const conversionRate =
      totalViews > 0 ? Math.round((completed.length / totalViews) * 10000) / 100 : 0;

    const acceptedOffers = offers.filter((o) => o.status === 'accepted').length;
    const offerAcceptRate =
      offers.length > 0 ? Math.round((acceptedOffers / offers.length) * 10000) / 100 : 0;

    const pendingOrders = orders.filter((o) =>
      OPEN_ORDER_STATUSES.includes(o.status)
    ).length;

    let discountsGiven = 0;
    for (const o of completed) {
      const listing = listings.find((l) => l.id === o.listing_id);
      if (listing?.sale_price != null && listing.price != null) {
        discountsGiven += Math.max(0, Number(listing.price) - Number(o.amount));
      }
    }

    const avgSalePrice =
      completed.length > 0 ? Math.round((totalRevenue / completed.length) * 100) / 100 : 0;

    let avgTimeToSellDays = 0;
    if (completed.length > 0) {
      let totalDays = 0;
      for (const o of completed) {
        const listing = listings.find((l) => l.id === o.listing_id);
        if (listing?.created_at && o.completed_at) {
          const ms =
            new Date(o.completed_at).getTime() - new Date(listing.created_at).getTime();
          totalDays += ms / (1000 * 60 * 60 * 24);
        }
      }
      avgTimeToSellDays = Math.round((totalDays / completed.length) * 10) / 10;
    }

    const listingInquiryCounts = new Map<string, number>();
    const { data: inquiryRows } = await this.db
      .from('marketplace_inquiries')
      .select('listing_id')
      .eq('seller_id', userId);
    for (const row of inquiryRows || []) {
      listingInquiryCounts.set(
        row.listing_id,
        (listingInquiryCounts.get(row.listing_id) || 0) + 1
      );
    }

    const listingOfferCounts = new Map<string, number>();
    for (const o of offers) {
      listingOfferCounts.set(o.listing_id, (listingOfferCounts.get(o.listing_id) || 0) + 1);
    }

    const listingRevenue = new Map<string, number>();
    for (const o of completed) {
      listingRevenue.set(
        o.listing_id,
        (listingRevenue.get(o.listing_id) || 0) + Number(o.amount)
      );
    }

    const topListings = listings
      .map((l) => ({
        id: l.id,
        title: l.title,
        views: l.views_count || 0,
        inquiries: listingInquiryCounts.get(l.id) || 0,
        offers: listingOfferCounts.get(l.id) || 0,
        sold: completedListingIds.has(l.id) || l.status === 'sold',
        revenue: listingRevenue.get(l.id) || 0,
      }))
      .sort((a, b) => b.revenue - a.revenue || b.views - a.views)
      .slice(0, 10);

    const salesByWeek: Array<{ weekStart: string; revenue: number; count: number }> = [];
    for (let i = 7; i >= 0; i--) {
      const weekEnd = new Date();
      weekEnd.setDate(weekEnd.getDate() - i * 7);
      const weekStart = new Date(weekEnd);
      weekStart.setDate(weekStart.getDate() - 7);
      const weekOrders = completed.filter((o) => {
        if (!o.completed_at) return false;
        const t = new Date(o.completed_at).getTime();
        return t >= weekStart.getTime() && t < weekEnd.getTime();
      });
      salesByWeek.push({
        weekStart: weekStart.toISOString().split('T')[0],
        revenue: weekOrders.reduce((s, o) => s + Number(o.amount), 0),
        count: weekOrders.length,
      });
    }

    const salesBySourceMap = new Map<string, { count: number; revenue: number }>();
    for (const o of completed) {
      const key = String(o.source || 'buy_now');
      const entry = salesBySourceMap.get(key) || { count: 0, revenue: 0 };
      entry.count += 1;
      entry.revenue += Number(o.amount);
      salesBySourceMap.set(key, entry);
    }
    const salesBySource = Array.from(salesBySourceMap.entries()).map(([source, stats]) => ({
      source,
      ...stats,
    }));

    const inquiryOrders = completed.filter((o) => o.inquiry_id).length;
    const totalInquiries = inquiryRows?.length || inquiriesRes.data?.length || 0;
    const inquiryToSaleRate =
      totalInquiries > 0 ? Math.round((inquiryOrders / totalInquiries) * 10000) / 100 : 0;

    const now = Date.now();
    const staleListings = listings
      .filter((l) => l.status === 'active')
      .map((l) => {
        const updatedAt = l.updated_at || l.created_at;
        const daysListed = updatedAt
          ? Math.floor((now - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24))
          : 0;
        return {
          id: l.id,
          title: l.title,
          daysListed,
          views: l.views_count || 0,
        };
      })
      .filter((l) => l.daysListed >= 30)
      .sort((a, b) => b.daysListed - a.daysListed)
      .slice(0, 8);

    const highViewsLowEngagement = listings
      .filter((l) => l.status === 'active')
      .map((l) => ({
        id: l.id,
        title: l.title,
        views: l.views_count || 0,
        inquiries: listingInquiryCounts.get(l.id) || 0,
        offers: listingOfferCounts.get(l.id) || 0,
      }))
      .filter((l) => l.views >= 10 && l.inquiries === 0 && l.offers === 0)
      .sort((a, b) => b.views - a.views)
      .slice(0, 8);

    const { data: favoriteRows } = listings.length
      ? await this.db
          .from('marketplace_favorites')
          .select('listing_id')
          .in('listing_id', listings.map((l) => l.id))
      : { data: [] };

    const favoriteCounts = new Map<string, number>();
    for (const row of favoriteRows || []) {
      favoriteCounts.set(
        row.listing_id,
        (favoriteCounts.get(row.listing_id) || 0) + 1
      );
    }
    const favoriteHighlights = listings
      .map((l) => ({
        id: l.id,
        title: l.title,
        favoritesCount: favoriteCounts.get(l.id) || 0,
      }))
      .filter((l) => l.favoritesCount > 0)
      .sort((a, b) => b.favoritesCount - a.favoritesCount)
      .slice(0, 5);

    const listingIds = listings.map((l) => l.id);
    let viewsByDay: Array<{ date: string; views: number; uniqueViewers: number }> = [];
    let funnel30d:
      | {
          impressions: number;
          views: number;
          inquiries: number;
          offers: number;
          sales: number;
        }
      | undefined;
    let conversionRate30d: number | null = null;

    if (listingIds.length > 0) {
      try {
        const { data: viewEvents } = await this.db
          .from('product_events')
          .select('event, props, anon_id, user_id, created_at')
          .in('event', ['listing_view', 'listing_impression'])
          .gte('created_at', thirtyIso)
          .limit(5000);

        const sellerViewEvents = (viewEvents || []).filter((ev) => {
          const lid = (ev.props as { listingId?: string } | null)?.listingId;
          return lid && listingIds.includes(lid);
        });

        const dayMap = new Map<string, { views: number; viewers: Set<string> }>();
        for (let i = 29; i >= 0; i--) {
          const d = new Date();
          d.setUTCDate(d.getUTCDate() - i);
          dayMap.set(d.toISOString().slice(0, 10), { views: 0, viewers: new Set() });
        }

        let impressions = 0;
        let views = 0;
        for (const ev of sellerViewEvents) {
          const day = String(ev.created_at || '').slice(0, 10);
          const viewerKey = ev.user_id || ev.anon_id || 'unknown';
          if (ev.event === 'listing_impression') impressions += 1;
          if (ev.event === 'listing_view') {
            views += 1;
            const bucket = dayMap.get(day);
            if (bucket) {
              bucket.views += 1;
              bucket.viewers.add(viewerKey);
            }
          }
        }

        viewsByDay = Array.from(dayMap.entries()).map(([date, v]) => ({
          date,
          views: v.views,
          uniqueViewers: v.viewers.size,
        }));

        const { data: inquiry30 } = await this.db
          .from('marketplace_inquiries')
          .select('id')
          .eq('seller_id', userId)
          .gte('created_at', thirtyIso);
        const { data: offers30 } = await this.db
          .from('marketplace_offers')
          .select('id')
          .eq('seller_id', userId)
          .gte('created_at', thirtyIso);
        const sales30 = completed.filter(
          (o) => o.completed_at && o.completed_at >= thirtyIso
        ).length;

        funnel30d = {
          impressions,
          views,
          inquiries: inquiry30?.length || 0,
          offers: offers30?.length || 0,
          sales: sales30,
        };

        if (views > 0) {
          conversionRate30d = Math.round((sales30 / views) * 10000) / 100;
        } else if (impressions === 0 && views === 0) {
          conversionRate30d = null;
        } else {
          conversionRate30d = 0;
        }
      } catch {
        // product_events may not exist yet before migration — keep null/empty
        viewsByDay = [];
        funnel30d = undefined;
        conversionRate30d = null;
      }
    }

    return {
      totalRevenue,
      revenue30d,
      avgSalePrice,
      avgTimeToSellDays,
      conversionRate,
      conversionRate30d,
      offerAcceptRate,
      pendingOrders,
      openInquiries,
      discountsGiven,
      completedSalesCount,
      topListings,
      salesByWeek,
      salesBySource,
      inquiryToSaleRate,
      staleListings,
      highViewsLowEngagement,
      favoriteHighlights,
      viewsByDay,
      funnel30d,
    };
  }

  async getSellerBuyers(userId: string): Promise<SellerBuyerContactRow[]> {
    const [ordersRes, inquiriesRes, offersRes] = await Promise.all([
      this.db
        .from('marketplace_orders')
        .select('buyer_id, amount, status, updated_at, buyer:profiles!marketplace_orders_buyer_id_fkey(id, name, avatar_url)')
        .eq('seller_id', userId),
      this.db
        .from('marketplace_inquiries')
        .select('buyer_id, status, updated_at, buyer:profiles!marketplace_inquiries_buyer_id_fkey(id, name, avatar_url)')
        .eq('seller_id', userId),
      this.db
        .from('marketplace_offers')
        .select('buyer_id, updated_at, buyer:profiles!marketplace_offers_buyer_id_fkey(id, name, avatar_url)')
        .eq('seller_id', userId),
    ]);

    const buyers = new Map<string, SellerBuyerContactRow>();

    const touch = (
      buyerId: string,
      profile: { name?: string; avatar_url?: string } | null,
      at: string,
      patch: Partial<SellerBuyerContactRow>
    ) => {
      const existing = buyers.get(buyerId) || {
        buyerId,
        name: profile?.name || 'Buyer',
        avatar_url: profile?.avatar_url,
        lastInteractionAt: at,
        completedPurchases: 0,
        totalSpent: 0,
        openInquiry: false,
        openOrder: false,
      };
      if (new Date(at) > new Date(existing.lastInteractionAt)) {
        existing.lastInteractionAt = at;
      }
      if (profile?.name) existing.name = profile.name;
      if (profile?.avatar_url) existing.avatar_url = profile.avatar_url;
      buyers.set(buyerId, { ...existing, ...patch });
    };

    for (const row of ordersRes.data || []) {
      const buyerRaw = row.buyer as { id?: string; name?: string; avatar_url?: string } | { id?: string; name?: string; avatar_url?: string }[] | null;
      const buyer = Array.isArray(buyerRaw) ? buyerRaw[0] : buyerRaw;
      touch(row.buyer_id, buyer, row.updated_at, {
        completedPurchases:
          (buyers.get(row.buyer_id)?.completedPurchases || 0) +
          (row.status === 'completed' ? 1 : 0),
        totalSpent:
          (buyers.get(row.buyer_id)?.totalSpent || 0) +
          (row.status === 'completed' ? Number(row.amount) : 0),
        openOrder:
          (buyers.get(row.buyer_id)?.openOrder || false) ||
          OPEN_ORDER_STATUSES.includes(row.status),
      });
    }

    for (const row of inquiriesRes.data || []) {
      const buyerRaw = row.buyer as { name?: string; avatar_url?: string } | { name?: string; avatar_url?: string }[] | null;
      const buyer = Array.isArray(buyerRaw) ? buyerRaw[0] : buyerRaw;
      touch(row.buyer_id, buyer, row.updated_at, {
        openInquiry:
          (buyers.get(row.buyer_id)?.openInquiry || false) ||
          ['open', 'negotiating'].includes(row.status),
      });
    }

    for (const row of offersRes.data || []) {
      const buyerRaw = row.buyer as { name?: string; avatar_url?: string } | { name?: string; avatar_url?: string }[] | null;
      const buyer = Array.isArray(buyerRaw) ? buyerRaw[0] : buyerRaw;
      touch(row.buyer_id, buyer, row.updated_at, {});
    }

    return Array.from(buyers.values()).sort(
      (a, b) => new Date(b.lastInteractionAt).getTime() - new Date(a.lastInteractionAt).getTime()
    );
  }

  computeCustomerSegments(
    buyers: SellerBuyerContactRow[]
  ): Array<SellerBuyerContactRow & { segments: string[] }> {
    if (!buyers.length) return [];

    const spenders = buyers
      .filter((b) => b.completedPurchases > 0)
      .sort((a, b) => b.totalSpent - a.totalSpent);
    const topSpenderCutoff =
      spenders.length > 0
        ? spenders[Math.max(0, Math.ceil(spenders.length * 0.1) - 1)]?.totalSpent ?? 0
        : 0;

    return buyers.map((buyer) => {
      const segments: string[] = [];
      if (buyer.completedPurchases >= 2) segments.push('repeat_buyer');
      if (buyer.completedPurchases > 0 && buyer.totalSpent >= topSpenderCutoff && topSpenderCutoff > 0) {
        segments.push('top_spender');
      }
      if (buyer.openOrder) segments.push('open_order');
      if (buyer.openInquiry) segments.push('open_inquiry');
      if (buyer.completedPurchases === 0) segments.push('lead');
      if (!segments.length) segments.push('customer');
      return { ...buyer, segments };
    });
  }

  async getSellerBuyersWithSegments(
    userId: string,
    segment?: string
  ): Promise<Array<SellerBuyerContactRow & { segments: string[] }>> {
    const buyers = await this.getSellerBuyers(userId);
    const withSegments = this.computeCustomerSegments(buyers);
    if (!segment) return withSegments;
    return withSegments.filter((b) => b.segments.includes(segment));
  }

  async notifyOrderParty(
    userId: string,
    payload: {
      type: string;
      message: string;
      link?: string;
      data?: Record<string, unknown>;
    }
  ): Promise<void> {
    try {
      await this.supabaseService.createNotification(userId, payload);
    } catch (err) {
      logger.warn('Failed to send marketplace order notification', err);
    }
  }

  private adminOrderSelect = `
    id, listing_id, buyer_id, seller_id, amount, source, status, created_at, updated_at,
    listing:marketplace_listings(id, title, status, price),
    buyer:profiles!marketplace_orders_buyer_id_fkey(id, name, avatar_url),
    seller:profiles!marketplace_orders_seller_id_fkey(id, name, avatar_url),
    transaction:marketplace_transactions(id, status, amount)
  `;

  async getOrderByIdAdmin(orderId: string): Promise<MarketplaceOrderRow | null> {
    const { data, error } = await this.db
      .from('marketplace_orders')
      .select(this.orderSelect)
      .eq('id', orderId)
      .maybeSingle();

    if (error) throw error;
    return (data as MarketplaceOrderRow) || null;
  }

  async getOrdersForAdmin(params: {
    status?: string;
    page: number;
    limit: number;
  }): Promise<{ data: MarketplaceOrderRow[]; total: number }> {
    const offset = (params.page - 1) * params.limit;
    let query = this.db
      .from('marketplace_orders')
      .select(this.adminOrderSelect, { count: 'exact' })
      .order('updated_at', { ascending: false })
      .range(offset, offset + params.limit - 1);

    if (params.status && params.status !== 'all') {
      query = query.eq('status', params.status);
    }

    const { data, error, count } = await query;
    if (error) throw error;
    return { data: (data || []) as MarketplaceOrderRow[], total: count ?? 0 };
  }

  async resolveDisputeAsAdmin(
    orderId: string,
    resolution: 'release_to_seller' | 'refund_buyer',
    adminNote?: string,
    resolvedBy?: string
  ): Promise<MarketplaceOrderRow> {
    const order = await this.getOrderByIdAdmin(orderId);
    if (!order) throw new PublicError('Order not found');
    if (order.status !== 'disputed') {
      throw new PublicError('Only disputed orders can be resolved by admin');
    }

    // Phase 3 N: record WHO the dispute went against before the status moves.
    // The trust score counts disputes LOST BY THE SELLER, not disputes merely
    // opened — without this stamp every resolution is invisible to trust and a
    // seller who wins a dispute stays punished forever.
    const outcome = resolution === 'refund_buyer' ? 'buyer' : 'seller';
    try {
      await this.db
        .from('marketplace_orders')
        .update({
          dispute_outcome: outcome,
          dispute_resolved_at: new Date().toISOString(),
          dispute_resolved_by: resolvedBy ?? null,
          dispute_resolution_note: adminNote?.trim() ? adminNote.trim().slice(0, 2000) : null,
        })
        .eq('id', orderId);
    } catch (err) {
      logger.warn('dispute outcome stamp failed', {
        orderId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const resolved =
      resolution === 'release_to_seller'
        ? await this.completeDisputeForSeller(order, adminNote)
        : await this.refundDisputeForBuyer(order, adminNote);

    // Trust reflects the outcome immediately, not at the next unrelated event.
    try {
      const { getCreatorsService } = await import('./creators');
      await getCreatorsService(this.supabaseService).refreshStats(order.seller_id);
    } catch {
      /* counters are best-effort */
    }

    return resolved;
  }

  private async completeDisputeForSeller(
    order: MarketplaceOrderRow,
    adminNote?: string
  ): Promise<MarketplaceOrderRow> {
    const { marketplacePaystackEnabled, getMarketplacePaymentsService } = await import(
      './marketplacePayments'
    );
    if (marketplacePaystackEnabled() && order.payment_id) {
      await getMarketplacePaymentsService(this.supabaseService).forcePayoutForOrder(order.id);
    }
    return this.finalizeEscrowRelease(order.id, {
      actorId: null,
      allowDisputed: true,
      notifyCompletion: true,
      adminNote,
    });
  }

  private async refundDisputeForBuyer(
    order: MarketplaceOrderRow,
    adminNote?: string
  ): Promise<MarketplaceOrderRow> {
    const orderId = order.id;
    const now = new Date().toISOString();
    const listing = await this.supabaseService.getMarketplaceListingById(order.listing_id);
    const listingTitle = listing?.title || 'Marketplace item';
    const noteSuffix = adminNote?.trim() ? ` Note: ${adminNote.trim()}` : '';

    const { marketplacePaystackEnabled, getMarketplacePaymentsService } = await import(
      './marketplacePayments'
    );
    if (marketplacePaystackEnabled() && order.payment_id) {
      await getMarketplacePaymentsService(this.supabaseService).refundPaymentForOrder(
        orderId,
        order.buyer_id,
        true
      );
    }

    await this.refundEscrow(order);

    await this.restoreListingAfterCancelledOrder(order.listing_id, Number(order.quantity) || 1);

    const { data, error } = await this.db
      .from('marketplace_orders')
      .update({
        status: 'cancelled',
        updated_at: now,
      })
      .eq('id', orderId)
      .select(this.orderSelect)
      .single();

    if (error) throw error;

    await this.notifyOrderParty(order.buyer_id, {
      type: 'marketplace_order_update',
      message: `Dispute resolved in your favor — refund issued for "${listingTitle}".${noteSuffix}`,
      link: `marketplace:order:${orderId}`,
      data: { orderId, disputeResolved: true, resolution: 'refund_buyer' },
    });

    await this.notifyOrderParty(order.seller_id, {
      type: 'marketplace_order_update',
      message: `Dispute closed: buyer refunded for "${listingTitle}". The listing is active again.${noteSuffix}`,
      link: `marketplace:order:${orderId}`,
      data: { orderId, disputeResolved: true, resolution: 'refund_buyer' },
    });

    await invalidateSellerAnalyticsCache(order.seller_id);
    return data as MarketplaceOrderRow;
  }
}

let marketplaceOrdersService: MarketplaceOrdersService | null = null;

export function getMarketplaceOrdersService(supabaseService: SupabaseService): MarketplaceOrdersService {
  if (!marketplaceOrdersService) {
    marketplaceOrdersService = new MarketplaceOrdersService(supabaseService);
  }
  return marketplaceOrdersService;
}

export function resetMarketplaceOrdersServiceForTests(): void {
  marketplaceOrdersService = null;
}
