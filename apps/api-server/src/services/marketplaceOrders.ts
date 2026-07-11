import type { SupabaseService } from './supabase';
import { cacheService } from './cache';
import { logger } from '../utils/logger';

export async function invalidateSellerAnalyticsCache(sellerId: string): Promise<void> {
  if (!sellerId) return;
  await cacheService.delete(`marketplace:analytics:seller:${sellerId}`);
}

const OPEN_ORDER_STATUSES = [
  'pending_payment',
  'paid',
  'ready_for_pickup',
  'buyer_confirmed',
  'disputed',
];

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

  private assertListingInStock(listing: { quantity?: number | null; status: string }): void {
    if (listing.status !== 'active') {
      throw new Error('Listing is not available for purchase');
    }
    if (listing.quantity != null && listing.quantity <= 0) {
      throw new Error('This listing is out of stock');
    }
  }

  private async resolveInitialOrderStatus(sellerId: string): Promise<'pending_payment' | 'paid'> {
    const { data } = await this.db
      .from('marketplace_seller_preferences')
      .select('require_payment_confirmation')
      .eq('seller_id', sellerId)
      .maybeSingle();
    return data?.require_payment_confirmation ? 'pending_payment' : 'paid';
  }

  private async adjustListingStockAfterSale(listingId: string): Promise<void> {
    const listing = await this.supabaseService.getMarketplaceListingById(listingId);
    if (!listing || listing.quantity == null) {
      await this.db
        .from('marketplace_listings')
        .update({ status: 'sold', updated_at: new Date().toISOString() })
        .eq('id', listingId);
      return;
    }

    const nextQty = Math.max(0, Number(listing.quantity) - 1);
    await this.db
      .from('marketplace_listings')
      .update({
        quantity: nextQty,
        status: nextQty <= 0 ? 'sold' : 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('id', listingId);
  }

  async submitPaymentProof(
    orderId: string,
    userId: string,
    proofUrl: string
  ): Promise<MarketplaceOrderRow> {
    const order = await this.getOrderById(orderId, userId);
    if (!order) throw new Error('Order not found');
    if (order.buyer_id !== userId) throw new Error('Only the buyer can submit payment proof');
    if (order.status !== 'pending_payment') {
      throw new Error('Order is not awaiting payment proof');
    }
    if (!proofUrl?.trim()) throw new Error('Payment proof URL is required');

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
    const { data, error } = await this.db
      .from('marketplace_orders')
      .select('id')
      .eq('listing_id', listingId)
      .in('status', OPEN_ORDER_STATUSES)
      .limit(1);

    if (error) throw error;
    if (data && data.length > 0) {
      throw new Error('This listing already has an open order');
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
    couponCode?: string
  ): Promise<MarketplaceOrderRow> {
    const listing = await this.supabaseService.getMarketplaceListingById(listingId);
    if (!listing) throw new Error('Listing not found');
    if (listing.user_id === buyerId) throw new Error('Cannot buy your own listing');
    this.assertListingInStock(listing);

    await this.assertNoOpenOrderForListing(listingId);

    let amount = resolveEffectivePrice(listing);
    let couponId: string | null = null;
    let discountAmount = 0;

    if (couponCode) {
      const { getMarketplaceCouponsService } = await import('./marketplaceCoupons');
      const validated = await getMarketplaceCouponsService(this.supabaseService).validateForListing(
        couponCode,
        listing,
        buyerId
      );
      amount = validated.finalAmount;
      couponId = validated.coupon.id;
      discountAmount = validated.discountAmount;
    }

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
    });

    if (rpcError) {
      if (this.isUniqueViolation(rpcError)) {
        const existing = await this.getOpenOrderForListing(listingId);
        if (existing) {
          if (existing.buyer_id === buyerId) return existing;
          throw new Error('This listing already has an open order');
        }
      }
      throw rpcError;
    }

    const rpcRow = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
    const orderId = rpcRow?.order_id as string | undefined;
    if (!orderId) throw new Error('Failed to create marketplace order');

    const { data: order, error: orderError } = await this.db
      .from('marketplace_orders')
      .select(this.orderSelect)
      .eq('id', orderId)
      .single();

    if (orderError || !order) throw orderError || new Error('Order not found after creation');
    const row = order as MarketplaceOrderRow;

    if (couponId) {
      const { getMarketplaceCouponsService } = await import('./marketplaceCoupons');
      await getMarketplaceCouponsService(this.supabaseService).redeemCoupon(couponId);
    }

    await this.notifyOrderParty(listing.user_id, {
      type: 'marketplace_purchase',
      message: `New order on "${listing.title}" for ₦${amount.toLocaleString()}${discountAmount > 0 ? ` (₦${discountAmount.toLocaleString()} coupon applied)` : ''}`,
      link: `marketplace:order:${row.id}`,
      data: { orderId: row.id, listingId },
    });

    await this.notifyOrderParty(buyerId, {
      type: 'marketplace_order_update',
      message:
        initialStatus === 'pending_payment'
          ? `Order created for "${listing.title}". Upload payment proof after you pay the seller.`
          : `Order placed for "${listing.title}". Arrange campus pickup with the seller.`,
      link: `marketplace:order:${row.id}`,
      data: { orderId: row.id, listingId },
    });

    await invalidateSellerAnalyticsCache(listing.user_id);
    return row;
  }

  async createOrderFromOfferAccept(offerId: string): Promise<MarketplaceOrderRow> {
    const { data: offer, error } = await this.db
      .from('marketplace_offers')
      .select(
        'id, listing_id, buyer_id, seller_id, amount, counter_amount, listing:marketplace_listings(id, title, price, sale_price, sale_ends_at, user_id, status)'
      )
      .eq('id', offerId)
      .single();

    if (error || !offer) throw new Error('Offer not found');

    const listingRaw = offer.listing as any;
    if (!listingRaw || Array.isArray(listingRaw)) {
      throw new Error('Listing not found for offer');
    }
    if (listingRaw.status !== 'active' && listingRaw.status !== 'sold') {
      throw new Error('Listing is not available');
    }
    this.assertListingInStock(listingRaw);

    await this.assertNoOpenOrderForListing(offer.listing_id);

    const amount = Number(offer.counter_amount ?? offer.amount) || 0;
    const inquiryId = await this.findInquiryForDeal(offer.listing_id, offer.buyer_id);
    const txn = await this.insertPendingTransaction(
      offer.listing_id,
      offer.buyer_id,
      offer.seller_id,
      amount
    );

    const initialStatus = await this.resolveInitialOrderStatus(offer.seller_id);

    const { data: order, error: orderError } = await this.db
      .from('marketplace_orders')
      .insert({
        listing_id: offer.listing_id,
        buyer_id: offer.buyer_id,
        seller_id: offer.seller_id,
        amount,
        offer_id: offerId,
        inquiry_id: inquiryId,
        transaction_id: txn.id,
        source: 'offer_accept',
        status: initialStatus,
        fulfillment_mode: 'campus_meetup',
      })
      .select(this.orderSelect)
      .single();

    if (orderError) {
      if (this.isUniqueViolation(orderError)) {
        await this.voidOrphanPendingTransaction(txn.id);
        const byOffer = await this.getOrderByOfferId(offerId);
        if (byOffer) return byOffer;
        const open = await this.getOpenOrderForListing(offer.listing_id);
        if (open) {
          if (open.buyer_id === offer.buyer_id) return open;
          throw new Error('This listing already has an open order');
        }
      }
      throw orderError;
    }
    const row = order as MarketplaceOrderRow;

    const title = listingRaw.title || 'listing';
    await this.notifyOrderParty(offer.seller_id, {
      type: 'marketplace_purchase',
      message: `Offer accepted — order for "${title}" at ₦${amount.toLocaleString()}`,
      link: `marketplace:order:${row.id}`,
      data: { orderId: row.id, offerId },
    });
    await this.notifyOrderParty(offer.buyer_id, {
      type: 'marketplace_order_update',
      message:
        initialStatus === 'pending_payment'
          ? `Your offer was accepted for "${title}". Upload payment proof after paying.`
          : `Your offer was accepted for "${title}". View order to arrange pickup.`,
      link: `marketplace:order:${row.id}`,
      data: { orderId: row.id, offerId },
    });

    await invalidateSellerAnalyticsCache(offer.seller_id);
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
      throw new Error('Unauthorized');
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
      | 'open_dispute'
  ): Promise<MarketplaceOrderRow> {
    const order = await this.getOrderById(orderId, userId);
    if (!order) throw new Error('Order not found');

    const isSeller = order.seller_id === userId;
    const isBuyer = order.buyer_id === userId;
    const now = new Date().toISOString();
    let nextStatus = order.status;
    const patch: Record<string, unknown> = {};

    switch (action) {
      case 'mark_paid':
        if (!isSeller && !isBuyer) throw new Error('Unauthorized');
        if (order.status !== 'pending_payment') throw new Error('Order is not awaiting payment');
        nextStatus = 'paid';
        break;
      case 'mark_ready':
        if (!isSeller) throw new Error('Only the seller can mark ready for pickup');
        if (!['paid', 'pending_payment'].includes(order.status)) {
          throw new Error('Order cannot be marked ready in current status');
        }
        nextStatus = 'ready_for_pickup';
        patch.seller_confirmed_at = now;
        break;
      case 'confirm_received':
        if (!isBuyer) throw new Error('Only the buyer can confirm receipt');
        if (!['ready_for_pickup', 'paid', 'buyer_confirmed'].includes(order.status)) {
          throw new Error('Order is not ready for buyer confirmation');
        }
        patch.buyer_confirmed_at = now;
        return this.releaseEscrow(orderId, userId);
      case 'cancel':
        if (!isSeller && !isBuyer) throw new Error('Unauthorized');
        if (['completed', 'cancelled'].includes(order.status)) {
          throw new Error('Order cannot be cancelled');
        }
        nextStatus = 'cancelled';
        await this.refundEscrow(order);
        break;
      case 'open_dispute':
        if (!isBuyer && !isSeller) throw new Error('Unauthorized');
        nextStatus = 'disputed';
        if (order.transaction_id) {
          await this.db
            .from('marketplace_transactions')
            .update({ status: 'disputed' })
            .eq('id', order.transaction_id);
        }
        break;
      default:
        throw new Error('Invalid action');
    }

    patch.status = nextStatus;
    const { data, error } = await this.db
      .from('marketplace_orders')
      .update(patch)
      .eq('id', orderId)
      .select(this.orderSelect)
      .single();

    if (error) throw error;

    const listingTitle =
      (order.listing as { title?: string } | null)?.title || 'your order';
    const amountStr = `₦${Number(order.amount).toLocaleString()}`;
    const otherParty = isSeller ? order.buyer_id : order.seller_id;

    const statusMessages: Record<string, { self?: string; other: string }> = {
      mark_paid: {
        other: `Payment confirmed for "${listingTitle}" (${amountStr}). The seller will prepare your item.`,
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
    if (!order) throw new Error('Order not found');
    if (order.buyer_id !== userId && order.seller_id !== userId) {
      throw new Error('Unauthorized');
    }
    if (order.status === 'completed') return order;

    const now = new Date().toISOString();
    const listing = await this.supabaseService.getMarketplaceListingById(order.listing_id);
    const listingTitle = listing?.title || 'Marketplace item';

    if (order.transaction_id) {
      await this.db
        .from('marketplace_transactions')
        .update({ status: 'released' })
        .eq('id', order.transaction_id);

      await this.supabaseService.logMarketplaceBudgetTransactions({
        listingId: order.listing_id,
        listingTitle,
        amount: Number(order.amount),
        sellerId: order.seller_id,
        buyerId: order.buyer_id,
        marketplaceTransactionId: order.transaction_id,
        source: order.source === 'offer_accept' ? 'offer_accept' : 'buy_now',
      });
    }

    await this.adjustListingStockAfterSale(order.listing_id);

    if (order.inquiry_id) {
      await this.db
        .from('marketplace_inquiries')
        .update({ status: 'purchased', updated_at: now })
        .eq('id', order.inquiry_id);
    }

    const { data, error } = await this.db
      .from('marketplace_orders')
      .update({
        status: 'completed',
        buyer_confirmed_at: order.buyer_confirmed_at || now,
        completed_at: now,
      })
      .eq('id', orderId)
      .select(this.orderSelect)
      .single();

    if (error) throw error;

    await this.notifyOrderParty(order.seller_id, {
      type: 'marketplace_order_update',
      message: `Order completed for "${listingTitle}" — ₦${Number(order.amount).toLocaleString()}`,
      link: `marketplace:order:${orderId}`,
      data: { orderId, completed: true },
    });

    await this.notifyOrderParty(order.buyer_id, {
      type: 'marketplace_review_prompt',
      message: `How was your purchase of "${listingTitle}"? Leave a review for the seller.`,
      link: `marketplace:listing:${order.listing_id}:review`,
      data: { orderId, listingId: order.listing_id },
    });

    await invalidateSellerAnalyticsCache(order.seller_id);
    return data as MarketplaceOrderRow;
  }

  private async refundEscrow(order: MarketplaceOrderRow): Promise<void> {
    if (!order.transaction_id) return;
    await this.db
      .from('marketplace_transactions')
      .update({ status: 'refunded' })
      .eq('id', order.transaction_id);
  }

  async createPaymentLinkOrder(
    orderId: string,
    userId: string
  ): Promise<{ orderId: string; amount: number; deepLink: string }> {
    const order = await this.getOrderById(orderId, userId);
    if (!order) throw new Error('Order not found');
    if (order.seller_id !== userId) throw new Error('Only the seller can request payment');
    if (['completed', 'cancelled'].includes(order.status)) {
      throw new Error('Order is closed');
    }

    if (order.status === 'pending_payment') {
      await this.db
        .from('marketplace_orders')
        .update({ status: 'paid' })
        .eq('id', orderId);
    }

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

    return {
      totalRevenue,
      revenue30d,
      avgSalePrice,
      avgTimeToSellDays,
      conversionRate,
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

  private async notifyOrderParty(
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
    adminNote?: string
  ): Promise<MarketplaceOrderRow> {
    const order = await this.getOrderByIdAdmin(orderId);
    if (!order) throw new Error('Order not found');
    if (order.status !== 'disputed') {
      throw new Error('Only disputed orders can be resolved by admin');
    }

    if (resolution === 'release_to_seller') {
      return this.completeDisputeForSeller(order, adminNote);
    }
    return this.refundDisputeForBuyer(order, adminNote);
  }

  private async completeDisputeForSeller(
    order: MarketplaceOrderRow,
    adminNote?: string
  ): Promise<MarketplaceOrderRow> {
    const orderId = order.id;
    const now = new Date().toISOString();
    const listing = await this.supabaseService.getMarketplaceListingById(order.listing_id);
    const listingTitle = listing?.title || 'Marketplace item';
    const noteSuffix = adminNote?.trim() ? ` Note: ${adminNote.trim()}` : '';

    if (order.transaction_id) {
      await this.db
        .from('marketplace_transactions')
        .update({ status: 'released' })
        .eq('id', order.transaction_id);

      await this.supabaseService.logMarketplaceBudgetTransactions({
        listingId: order.listing_id,
        listingTitle,
        amount: Number(order.amount),
        sellerId: order.seller_id,
        buyerId: order.buyer_id,
        marketplaceTransactionId: order.transaction_id,
        source: order.source === 'offer_accept' ? 'offer_accept' : 'buy_now',
      });
    }

    await this.adjustListingStockAfterSale(order.listing_id);

    if (order.inquiry_id) {
      await this.db
        .from('marketplace_inquiries')
        .update({ status: 'purchased', updated_at: now })
        .eq('id', order.inquiry_id);
    }

    const { data, error } = await this.db
      .from('marketplace_orders')
      .update({
        status: 'completed',
        completed_at: now,
        updated_at: now,
      })
      .eq('id', orderId)
      .select(this.orderSelect)
      .single();

    if (error) throw error;

    await this.notifyOrderParty(order.seller_id, {
      type: 'marketplace_order_update',
      message: `Dispute resolved in your favor — order completed for "${listingTitle}".${noteSuffix}`,
      link: `marketplace:order:${orderId}`,
      data: { orderId, disputeResolved: true, resolution: 'release_to_seller' },
    });

    await this.notifyOrderParty(order.buyer_id, {
      type: 'marketplace_order_update',
      message: `Dispute closed: payment released to the seller for "${listingTitle}".${noteSuffix}`,
      link: `marketplace:order:${orderId}`,
      data: { orderId, disputeResolved: true, resolution: 'release_to_seller' },
    });

    await this.notifyOrderParty(order.buyer_id, {
      type: 'marketplace_review_prompt',
      message: `How was your purchase of "${listingTitle}"? Leave a review for the seller.`,
      link: `marketplace:listing:${order.listing_id}:review`,
      data: { orderId, listingId: order.listing_id },
    });

    await invalidateSellerAnalyticsCache(order.seller_id);
    return data as MarketplaceOrderRow;
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

    await this.refundEscrow(order);

    await this.db
      .from('marketplace_listings')
      .update({ status: 'active', updated_at: now })
      .eq('id', order.listing_id);

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
