import {
  computeMarketplaceCheckoutFees,
  isDigitalListingKind,
  isMarketplacePaystackCheckoutEnabled,
  nairaToKobo,
  resolveMarketplaceFees,
  resolveMarketplaceServiceFeeBps,
} from '@lantern/shared/marketplace';
import type { SupabaseService } from './supabase';
import { logger } from '../utils/logger';
import {
  createPaystackReference,
  createPaystackTransferRecipient,
  getPaystackPublicKey,
  initializePaystackTransaction,
  initiatePaystackTransfer,
  isPaystackConfigured,
  refundPaystackTransaction,
  resolvePaystackAccount,
  verifyPaystackSignature,
  verifyPaystackTransaction,
} from './paystack';
import {
  MarketplaceOrdersService,
  invalidateSellerAnalyticsCache,
  resolveEffectivePrice,
} from './marketplaceOrders';
import { createHash } from 'crypto';

export function marketplacePaystackEnabled(): boolean {
  return isMarketplacePaystackCheckoutEnabled(process.env.MARKETPLACE_PAYSTACK_CHECKOUT) && isPaystackConfigured();
}

function callbackBaseUrl(): string {
  const front = (process.env.FRONTEND_URL || 'https://lanternstudy.com').replace(/\/$/, '');
  return front;
}

function allowlistedCallback(orderId: string): string {
  return `${callbackBaseUrl()}/marketplace/orders/${orderId}?payment=return`;
}

function allowlistedCheckoutCallback(checkoutId: string): string {
  return `${callbackBaseUrl()}/marketplace/orders?payment=return&checkout=${checkoutId}`;
}

export class MarketplacePaymentsService {
  private orders: MarketplaceOrdersService;

  constructor(private readonly supabaseService: SupabaseService) {
    this.orders = new MarketplaceOrdersService(supabaseService);
  }

  private get db() {
    return this.supabaseService.getClient();
  }

  async getSellerPayoutProfile(userId: string) {
    const { data, error } = await this.db
      .from('marketplace_seller_payout_profiles')
      .select('user_id, bank_code, account_number_last4, account_name, status, verified_at, created_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async upsertSellerPayoutProfile(
    userId: string,
    input: { accountNumber: string; bankCode: string }
  ) {
    const accountNumber = String(input.accountNumber || '').replace(/\D/g, '');
    const bankCode = String(input.bankCode || '').trim();
    if (accountNumber.length < 8 || !bankCode) {
      throw new Error('Valid bank account number and bank code are required');
    }

    const resolved = await resolvePaystackAccount({ accountNumber, bankCode });
    const recipient = await createPaystackTransferRecipient({
      accountNumber,
      bankCode,
      accountName: resolved.accountName,
    });

    const now = new Date().toISOString();
    const { data, error } = await this.db
      .from('marketplace_seller_payout_profiles')
      .upsert(
        {
          user_id: userId,
          paystack_recipient_code: recipient.recipientCode,
          bank_code: recipient.bankCode,
          account_number_last4: recipient.accountNumberLast4,
          account_name: recipient.accountName,
          status: 'active',
          verified_at: now,
          updated_at: now,
        },
        { onConflict: 'user_id' }
      )
      .select('user_id, bank_code, account_number_last4, account_name, status, verified_at, created_at')
      .single();
    if (error) throw error;
    return data;
  }

  async assertSellerCanReceivePayout(sellerId: string): Promise<void> {
    const profile = await this.getSellerPayoutProfile(sellerId);
    if (!profile || profile.status !== 'active') {
      throw new Error(
        'Seller has not set up a payout bank account. They must add bank details before checkout.'
      );
    }
  }

  /**
   * Buy-now with Paystack: create order in awaiting_payment, initialize charge.
   */
  async createBuyNowCheckoutSession(input: {
    listingId: string;
    buyerId: string;
    buyerEmail: string;
    couponCode?: string;
    quantity?: number;
  }) {
    if (!marketplacePaystackEnabled()) {
      throw new Error('Paystack marketplace checkout is not enabled');
    }

    const listing = await this.supabaseService.getMarketplaceListingById(input.listingId);
    if (!listing) throw new Error('Listing not found');
    await this.assertSellerCanReceivePayout(listing.user_id);

    // Create order with awaiting_payment via existing buy-now path after forcing status.
    // We temporarily set seller pref path by creating order then patching status + payment.
    const order = await this.createAwaitingPaymentBuyNowOrder(input);

    const itemAmountKobo = nairaToKobo(Number(order.amount));
    // Fee split by listing kind: the buyer pays the list price either way; the
    // platform's cut comes out of the payout — 15% digital, 5% hand-over.
    const resolved = resolveMarketplaceFees({
      listingKind: listing.listing_kind,
      itemAmountKobo,
      env: process.env,
    });
    const fees = {
      itemAmountKobo: resolved.itemAmountKobo,
      serviceFeeKobo: resolved.buyerFeeKobo,
      totalChargeKobo: resolved.totalChargedKobo,
    };
    const reference = createPaystackReference('ls_buy');

    const { data: payment, error: payErr } = await this.db
      .from('marketplace_payments')
      .insert({
        order_id: order.id,
        buyer_id: input.buyerId,
        seller_id: order.seller_id,
        item_amount_kobo: fees.itemAmountKobo,
        service_fee_kobo: fees.serviceFeeKobo,
        total_charged_kobo: fees.totalChargeKobo,
        platform_fee_kobo: resolved.platformFeeKobo,
        seller_payout_kobo: resolved.sellerPayoutKobo,
        currency: 'NGN',
        paystack_reference: reference,
        status: 'initialized',
        metadata: {
          listingId: input.listingId,
          quantity: order.quantity || 1,
          source: 'buy_now',
        },
      })
      .select('*')
      .single();
    if (payErr || !payment) throw payErr || new Error('Failed to create payment');

    await this.db
      .from('marketplace_orders')
      .update({ payment_id: payment.id, status: 'awaiting_payment' })
      .eq('id', order.id);

    const init = await initializePaystackTransaction({
      email: input.buyerEmail,
      amountKobo: fees.totalChargeKobo,
      reference,
      callbackUrl: allowlistedCallback(order.id),
      metadata: {
        orderId: order.id,
        paymentId: payment.id,
        buyerId: input.buyerId,
        sellerId: order.seller_id,
      },
    });

    await this.db
      .from('marketplace_payments')
      .update({
        paystack_access_code: init.accessCode,
        updated_at: new Date().toISOString(),
        metadata: {
          listingId: input.listingId,
          quantity: order.quantity || 1,
          source: 'buy_now',
          authorizationUrl: init.authorizationUrl,
        },
      })
      .eq('id', payment.id);

    const refreshed = await this.orders.getOrderById(order.id, input.buyerId);

    return {
      order: refreshed || order,
      payment: {
        id: payment.id,
        reference: init.reference,
        status: 'initialized',
        itemAmountKobo: fees.itemAmountKobo,
        serviceFeeKobo: fees.serviceFeeKobo,
        totalChargeKobo: fees.totalChargeKobo,
        currency: 'NGN',
      },
      authorizationUrl: init.authorizationUrl,
      accessCode: init.accessCode,
      publicKey: getPaystackPublicKey(),
    };
  }

  async createAwaitingPaymentOrderForCheckout(input: {
    listingId: string;
    buyerId: string;
    quantity?: number;
  }) {
    return this.createAwaitingPaymentBuyNowOrder(input);
  }

  async createCheckoutCharge(input: {
    checkoutId: string;
    buyerId: string;
    buyerEmail: string;
    orders: Array<{ id: string; seller_id: string; listing_id: string; amount: number; quantity?: number }>;
    itemAmountKobo: number;
    shippingAmountKobo: number;
    totalChargeKobo: number;
  }) {
    if (!marketplacePaystackEnabled()) {
      throw new Error('Paystack marketplace checkout is not enabled');
    }
    const first = input.orders[0];
    if (!first) throw new Error('Checkout has no orders');
    for (const order of input.orders) {
      await this.assertSellerCanReceivePayout(order.seller_id);
    }

    const reference = createPaystackReference('ls_cart');
    const { data: payment, error: payErr } = await this.db
      .from('marketplace_payments')
      .insert({
        order_id: first.id,
        checkout_id: input.checkoutId,
        buyer_id: input.buyerId,
        seller_id: first.seller_id,
        item_amount_kobo: input.itemAmountKobo,
        shipping_amount_kobo: input.shippingAmountKobo,
        service_fee_kobo: 0,
        total_charged_kobo: input.totalChargeKobo,
        platform_fee_kobo: 0,
        seller_payout_kobo: 0,
        currency: 'NGN',
        paystack_reference: reference,
        status: 'initialized',
        metadata: {
          checkoutId: input.checkoutId,
          orderIds: input.orders.map((order) => order.id),
          source: 'unified_checkout',
        },
      })
      .select('*')
      .single();
    if (payErr || !payment) throw payErr || new Error('Failed to create checkout payment');

    await this.db
      .from('marketplace_checkouts')
      .update({ payment_id: payment.id, updated_at: new Date().toISOString() })
      .eq('id', input.checkoutId);

    await this.db
      .from('marketplace_orders')
      .update({ payment_id: payment.id, status: 'awaiting_payment' })
      .in(
        'id',
        input.orders.map((order) => order.id),
      );

    const init = await initializePaystackTransaction({
      email: input.buyerEmail,
      amountKobo: input.totalChargeKobo,
      reference,
      callbackUrl: allowlistedCheckoutCallback(input.checkoutId),
      metadata: {
        checkoutId: input.checkoutId,
        paymentId: payment.id,
        buyerId: input.buyerId,
      },
    });

    await this.db
      .from('marketplace_payments')
      .update({
        paystack_access_code: init.accessCode,
        updated_at: new Date().toISOString(),
        metadata: {
          checkoutId: input.checkoutId,
          orderIds: input.orders.map((order) => order.id),
          source: 'unified_checkout',
          authorizationUrl: init.authorizationUrl,
        },
      })
      .eq('id', payment.id);

    return {
      paymentId: payment.id,
      reference: init.reference,
      authorizationUrl: init.authorizationUrl,
    };
  }

  private async createAwaitingPaymentBuyNowOrder(input: {
    listingId: string;
    buyerId: string;
    couponCode?: string;
    quantity?: number;
  }) {
    // Use RPC with initial status awaiting_payment if supported; fallback pending_payment then patch.
    const listing = await this.supabaseService.getMarketplaceListingById(input.listingId);
    if (!listing) throw new Error('Listing not found');
    if (listing.user_id === input.buyerId) throw new Error('Cannot buy your own listing');

    const quantity = Math.max(1, Math.floor(Number(input.quantity) || 1));
    const unitPrice = resolveEffectivePrice(listing);
    let unitAmount = unitPrice;
    let couponId: string | null = null;
    let unitDiscount = 0;

    if (input.couponCode) {
      const { getMarketplaceCouponsService } = await import('./marketplaceCoupons');
      const validated = await getMarketplaceCouponsService(this.supabaseService).validateForListing(
        input.couponCode,
        listing,
        input.buyerId
      );
      unitAmount = validated.finalAmount;
      couponId = validated.coupon.id;
      unitDiscount = validated.discountAmount;
    }

    const amount = Math.round(unitAmount * quantity * 100) / 100;
    const discountAmount = Math.round(unitDiscount * quantity * 100) / 100;

    const { data: rpcRows, error: rpcError } = await this.db.rpc('marketplace_create_buy_now_order', {
      p_listing_id: input.listingId,
      p_buyer_id: input.buyerId,
      p_amount: amount,
      p_inquiry_id: null,
      p_initial_status: 'pending_payment',
      p_coupon_id: couponId,
      p_discount_amount: discountAmount,
      p_quantity: quantity,
    });

    if (rpcError) throw rpcError;
    const rpcRow = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
    const orderId = rpcRow?.order_id as string | undefined;
    if (!orderId) throw new Error('Failed to create marketplace order');

    await this.db
      .from('marketplace_orders')
      .update({ status: 'awaiting_payment' })
      .eq('id', orderId);

    const order = await this.orders.getOrderById(orderId, input.buyerId);
    if (!order) throw new Error('Order not found after creation');
    return order;
  }

  /**
   * Attach Paystack checkout to an existing order (e.g. offer-accept).
   */
  async createCheckoutForExistingOrder(input: {
    orderId: string;
    buyerId: string;
    buyerEmail: string;
  }) {
    if (!marketplacePaystackEnabled()) {
      throw new Error('Paystack marketplace checkout is not enabled');
    }
    const order = await this.orders.getOrderById(input.orderId, input.buyerId);
    if (!order) throw new Error('Order not found');
    if (order.buyer_id !== input.buyerId) throw new Error('Unauthorized');
    await this.assertSellerCanReceivePayout(order.seller_id);

    const itemAmountKobo = nairaToKobo(Number(order.amount));

    // This path serves offer-accept AND the resume-checkout fall-through from
    // getCheckoutSessionForOrder, which carries orders of ANY kind — so the fee
    // model must be resolved from the listing, never assumed physical. It is
    // resolved before the resume decision because a session is only worth
    // resuming if its stored split is what we would write today.
    const { data: kindRow } = await this.db
      .from('marketplace_listings')
      .select('listing_kind')
      .eq('id', order.listing_id)
      .maybeSingle();
    const resolved = resolveMarketplaceFees({
      listingKind: (kindRow as { listing_kind?: string } | null)?.listing_kind,
      itemAmountKobo,
      env: process.env,
    });

    let supersededPaymentId: string | null = null;
    if (order.payment_id) {
      const { data: existing } = await this.db
        .from('marketplace_payments')
        .select('*')
        .eq('id', order.payment_id)
        .maybeSingle();
      // Reuse the open Paystack session when nothing about the charge changed.
      // This block used to be empty — a comment and no code — so every retry
      // inserted a fresh 'initialized' payment row and re-pointed the order at
      // it, leaving orphans that a late charge.success could still settle.
      const existingUrl =
        (existing?.metadata as Record<string, any> | null)?.authorizationUrl ||
        (existing?.paystack_access_code
          ? `https://checkout.paystack.com/${existing.paystack_access_code}`
          : null);
      // A session initialised under an earlier fee model carries the old split
      // (buyer surcharge, full seller payout). Resuming it would charge the old
      // total and pay out the old amount, so a row is reused only when its
      // stored split is exactly what the resolver produces today. This is the
      // ONLY resume site — getCheckoutSessionForOrder defers here.
      const splitIsCurrent =
        Number(existing?.item_amount_kobo) === itemAmountKobo &&
        Number(existing?.total_charged_kobo) === resolved.totalChargedKobo &&
        Number(existing?.seller_payout_kobo ?? existing?.item_amount_kobo) === resolved.sellerPayoutKobo;
      if (
        existing?.status === 'initialized' &&
        existing.paystack_access_code &&
        existingUrl &&
        splitIsCurrent
      ) {
        const refreshedOrder = await this.orders.getOrderById(order.id, input.buyerId);
        return {
          order: refreshedOrder || order,
          payment: {
            id: existing.id,
            reference: existing.paystack_reference,
            status: 'initialized',
            itemAmountKobo: Number(existing.item_amount_kobo),
            serviceFeeKobo: Number(existing.service_fee_kobo),
            totalChargeKobo: Number(existing.total_charged_kobo),
            currency: existing.currency,
          },
          authorizationUrl: existingUrl,
          accessCode: existing.paystack_access_code,
          publicKey: getPaystackPublicKey(),
        };
      }
      if (existing?.status === 'initialized') {
        // The open session is stale (split or amount changed). Retire it BEFORE
        // a replacement exists: its Paystack page may still be open in a tab,
        // and a late charge.success for its reference must not settle the
        // order on the old split. The webhook and verify paths treat a charge
        // against a retired row as a settlement mismatch, which is loud.
        supersededPaymentId = existing.id;
        const now = new Date().toISOString();
        await this.db
          .from('marketplace_payments')
          .update({
            status: 'failed',
            metadata: {
              ...((existing.metadata as Record<string, unknown> | null) || {}),
              superseded_reason: 'split_changed',
              superseded_at: now,
            },
            updated_at: now,
          })
          .eq('id', existing.id)
          .eq('status', 'initialized');
      }
    }

    const fees = {
      itemAmountKobo: resolved.itemAmountKobo,
      serviceFeeKobo: resolved.buyerFeeKobo,
      totalChargeKobo: resolved.totalChargedKobo,
    };
    const reference = createPaystackReference('ls_off');

    const { data: payment, error: payErr } = await this.db
      .from('marketplace_payments')
      .insert({
        order_id: order.id,
        buyer_id: input.buyerId,
        seller_id: order.seller_id,
        item_amount_kobo: fees.itemAmountKobo,
        service_fee_kobo: fees.serviceFeeKobo,
        total_charged_kobo: fees.totalChargeKobo,
        platform_fee_kobo: resolved.platformFeeKobo,
        seller_payout_kobo: resolved.sellerPayoutKobo,
        currency: 'NGN',
        paystack_reference: reference,
        status: 'initialized',
        metadata: {
          source: 'offer_accept',
          listingId: order.listing_id,
          ...(supersededPaymentId ? { supersedes: supersededPaymentId } : {}),
        },
      })
      .select('*')
      .single();
    if (payErr || !payment) throw payErr || new Error('Failed to create payment');

    await this.db
      .from('marketplace_orders')
      .update({ payment_id: payment.id, status: 'awaiting_payment' })
      .eq('id', order.id);

    const init = await initializePaystackTransaction({
      email: input.buyerEmail,
      amountKobo: fees.totalChargeKobo,
      reference,
      callbackUrl: allowlistedCallback(order.id),
      metadata: {
        orderId: order.id,
        paymentId: payment.id,
        buyerId: input.buyerId,
        sellerId: order.seller_id,
      },
    });

    await this.db
      .from('marketplace_payments')
      .update({
        paystack_access_code: init.accessCode,
        updated_at: new Date().toISOString(),
        metadata: {
          source: 'offer_accept',
          listingId: order.listing_id,
          authorizationUrl: init.authorizationUrl,
        },
      })
      .eq('id', payment.id);

    const refreshed = await this.orders.getOrderById(order.id, input.buyerId);
    return {
      order: refreshed || order,
      payment: {
        id: payment.id,
        reference: init.reference,
        status: 'initialized',
        itemAmountKobo: fees.itemAmountKobo,
        serviceFeeKobo: fees.serviceFeeKobo,
        totalChargeKobo: fees.totalChargeKobo,
        currency: 'NGN',
      },
      authorizationUrl: init.authorizationUrl,
      accessCode: init.accessCode,
      publicKey: getPaystackPublicKey(),
    };
  }

  /**
   * Resume an initialized Paystack checkout for an unpaid order (buyer only).
   */
  async getCheckoutSessionForOrder(orderId: string, buyerId: string, buyerEmail: string) {
    if (!marketplacePaystackEnabled()) {
      throw new Error('Paystack marketplace checkout is not enabled');
    }
    const order = await this.orders.getOrderById(orderId, buyerId);
    if (!order) throw new Error('Order not found');
    if (order.buyer_id !== buyerId) throw new Error('Unauthorized');
    if (!['awaiting_payment', 'pending_payment'].includes(order.status)) {
      throw new Error('Order is not awaiting payment');
    }

    if (order.payment_id) {
      const { data: existing } = await this.db
        .from('marketplace_payments')
        .select('status')
        .eq('id', order.payment_id)
        .maybeSingle();
      if (existing?.status === 'paid' || existing?.status === 'paid_out' || existing?.status === 'payout_pending') {
        throw new Error('Order is already paid');
      }
    }

    // Resuming the open session, or retiring a stale one and replacing it, is
    // decided in exactly one place: createCheckoutForExistingOrder.
    return this.createCheckoutForExistingOrder({ orderId, buyerId, buyerEmail });
  }

  async verifyPaymentByReference(reference: string, actorId: string) {
    const { data: payment, error } = await this.db
      .from('marketplace_payments')
      .select('*')
      .eq('paystack_reference', reference)
      .maybeSingle();
    if (error) throw error;
    if (!payment) throw new Error('Payment not found');
    if (payment.buyer_id !== actorId && payment.seller_id !== actorId) {
      throw new Error('Unauthorized');
    }

    if (payment.status === 'paid' || payment.status === 'paid_out' || payment.status === 'payout_pending') {
      const order = payment.order_id
        ? await this.orders.getOrderById(payment.order_id, actorId)
        : null;
      return { payment, order, alreadySettled: true };
    }

    const verified = await verifyPaystackTransaction(reference);
    if (verified.status !== 'success') {
      throw new Error(`Payment not successful (${verified.status})`);
    }
    // A retired row (superseded as stale, failed, refunded) must not be settled
    // by a late success either — see the webhook path for the reasoning.
    const retiredRow = payment.status !== 'initialized';
    if (
      Number(verified.amount) !== Number(payment.total_charged_kobo) ||
      (verified.currency && verified.currency !== payment.currency) ||
      retiredRow
    ) {
      await this.recordSettlementMismatch(payment, {
        source: 'verify',
        reference,
        expectedAmount: Number(payment.total_charged_kobo),
        gotAmount: Number(verified.amount),
        expectedCurrency: payment.currency,
        gotCurrency: verified.currency,
        ...(retiredRow ? { reason: `payment_${payment.status}` } : {}),
      });
      throw new Error(retiredRow ? 'Payment session is no longer open' : 'Payment amount mismatch');
    }

    await this.markPaymentPaid(payment.id, String(verified.id), verified.paidAt || undefined);
    const order = payment.order_id
      ? await this.orders.getOrderById(payment.order_id, actorId)
      : null;
    const { data: refreshed } = await this.db
      .from('marketplace_payments')
      .select('*')
      .eq('id', payment.id)
      .single();
    return { payment: refreshed || payment, order, alreadySettled: false };
  }

  async markPaymentPaid(
    paymentId: string,
    paystackTransactionId: string,
    paidAt?: string
  ): Promise<void> {
    const now = paidAt || new Date().toISOString();
    const { data: payment, error } = await this.db
      .from('marketplace_payments')
      .select('*')
      .eq('id', paymentId)
      .single();
    if (error || !payment) throw error || new Error('Payment not found');

    if (['paid', 'payout_pending', 'paid_out'].includes(payment.status)) return;

    const { data: updated, error: updErr } = await this.db
      .from('marketplace_payments')
      .update({
        status: 'paid',
        paystack_transaction_id: String(paystackTransactionId),
        paid_at: now,
        updated_at: now,
      })
      .eq('id', paymentId)
      .eq('status', 'initialized')
      .select('*')
      .maybeSingle();
    if (updErr) throw updErr;
    if (!updated) return; // raced

    if (payment.checkout_id) {
      await this.db
        .from('marketplace_checkouts')
        .update({ status: 'paid', updated_at: now })
        .eq('id', payment.checkout_id);
      const { data: checkoutOrders } = await this.db
        .from('marketplace_orders')
        .select('id, listing_id, buyer_id, seller_id')
        .eq('checkout_id', payment.checkout_id);
      const rows = (checkoutOrders || []) as Array<{
        id: string;
        listing_id: string;
        buyer_id: string;
        seller_id: string;
      }>;
      if (rows.length > 0) {
        await this.db
          .from('marketplace_cart_items')
          .delete()
          .eq('buyer_id', payment.buyer_id)
          .in(
            'listing_id',
            rows.map((row) => row.listing_id),
          );
      }
      for (const order of rows) {
        await this.db
          .from('marketplace_orders')
          .update({ status: 'paid', payment_id: payment.id })
          .eq('id', order.id)
          .in('status', ['awaiting_payment', 'pending_payment']);
        await this.orders.stampOrderPaidAt(order.id, now);
        const digital = await this.fulfillDigitalOrderAfterPayment(order.id, updated);
        if (!digital) {
          await this.orders.notifyOrderParty(order.seller_id, {
            type: 'marketplace_order_update',
            message: 'Payment received via Paystack. Mark the order ready when the item is prepared.',
            link: `marketplace:order:${order.id}`,
            data: { orderId: order.id, paid: true, checkoutId: payment.checkout_id },
          });
          await this.orders.notifyOrderParty(order.buyer_id, {
            type: 'marketplace_order_update',
            message: 'Payment confirmed. Arrange campus pickup or watch for shipping.',
            link: `marketplace:order:${order.id}`,
            data: { orderId: order.id, paid: true, checkoutId: payment.checkout_id },
          });
        }
      }
    } else if (payment.order_id) {
      await this.db
        .from('marketplace_orders')
        .update({ status: 'paid' })
        .eq('id', payment.order_id)
        .in('status', ['awaiting_payment', 'pending_payment']);
      await this.orders.stampOrderPaidAt(payment.order_id, now);

      // Digital products (question banks, study packs) fulfill instantly:
      // deliver, complete, pay out. Everything else keeps the meetup flow.
      const digital = await this.fulfillDigitalOrderAfterPayment(payment.order_id, updated);
      if (!digital) {
        await this.orders.notifyOrderParty(payment.seller_id, {
          type: 'marketplace_order_update',
          message: 'Payment received via Paystack. Mark the order ready when the item is prepared.',
          link: `marketplace:order:${payment.order_id}`,
          data: { orderId: payment.order_id, paid: true },
        });
        await this.orders.notifyOrderParty(payment.buyer_id, {
          type: 'marketplace_order_update',
          message: 'Payment confirmed. Arrange campus pickup with the seller.',
          link: `marketplace:order:${payment.order_id}`,
          data: { orderId: payment.order_id, paid: true },
        });
      }
    }

    await invalidateSellerAnalyticsCache(payment.seller_id);
  }

  /**
   * Instant fulfillment for digital orders (question banks + study packs).
   * Returns false when the order is not digital (caller falls back to the
   * meetup flow).
   *
   * Delivery comes first and is the one step that matters to the buyer; order
   * completion and seller payout follow, each isolated so a failure in one
   * never rolls back delivery. A missed delivery self-heals via the kind's
   * restore endpoint; a missed payout stays visible as a payment stuck in
   * 'paid' and is recoverable via forcePayoutForOrder.
   */
  private async fulfillDigitalOrderAfterPayment(
    orderId: string,
    payment: Record<string, any>
  ): Promise<boolean> {
    const { data: order } = await this.db
      .from('marketplace_orders')
      .select('id, listing_id, buyer_id, seller_id')
      .eq('id', orderId)
      .maybeSingle();
    if (!order) return false;

    const { data: listing } = await this.db
      .from('marketplace_listings')
      .select('listing_kind')
      .eq('id', order.listing_id)
      .maybeSingle();
    const kind = (listing as { listing_kind?: string } | null)?.listing_kind;
    if (!isDigitalListingKind(kind)) return false;

    try {
      if (kind === 'study_pack') {
        const { getMarketplaceStudyPacksService } = await import('./marketplaceStudyPacks');
        await getMarketplaceStudyPacksService(this.supabaseService).grantEntitlement(
          order.listing_id,
          order.buyer_id,
          order.id
        );
        await this.orders.notifyOrderParty(order.buyer_id, {
          type: 'marketplace_order_update',
          message: 'Your study pack is ready — find it in your Library on any of your devices.',
          link: `marketplace:order:${orderId}`,
          data: { orderId, studyPackDelivered: true },
        });
      } else {
        const { getMarketplaceQuestionBanksService } = await import('./marketplaceQuestionBanks');
        await getMarketplaceQuestionBanksService(this.supabaseService).grantEntitlement(
          order.listing_id,
          order.buyer_id,
          order.id
        );
        await this.orders.notifyOrderParty(order.buyer_id, {
          type: 'marketplace_order_update',
          message: 'Your question bank is ready — find it in Offline Mode on any of your devices.',
          link: `marketplace:order:${orderId}`,
          data: { orderId, questionBankDelivered: true },
        });
      }
    } catch (err) {
      logger.error('Digital delivery failed after payment', {
        orderId,
        listingId: order.listing_id,
        buyerId: order.buyer_id,
        kind,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      await this.orders.releaseEscrow(orderId, order.buyer_id);
    } catch (err) {
      logger.error('Digital order completion failed', {
        orderId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      await this.transferSellerPayout(orderId, order.seller_id, payment);
    } catch (err) {
      logger.error('Digital payout failed; recover with forcePayoutForOrder', {
        orderId,
        sellerId: order.seller_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return true;
  }

  /**
   * Initiate seller transfer for a paid payment. Idempotent when already paid_out.
   * Returns true if a transfer was initiated or already completed; false if no Paystack payment.
   */
  private async transferSellerPayout(
    orderId: string,
    sellerId: string,
    payment: Record<string, any>
  ): Promise<'legacy' | 'already_paid_out' | 'transferred' | 'in_flight'> {
    if (payment.status === 'refunded' || payment.status === 'failed') {
      throw new Error('Payment cannot be paid out in its current state');
    }
    if (payment.status === 'paid_out' && !payment.checkout_id) return 'already_paid_out';
    if (payment.status !== 'paid' && payment.status !== 'payout_pending' && payment.status !== 'paid_out') {
      throw new Error('Order payment is not settled yet');
    }

    if (payment.checkout_id) {
      const { data: orderRow } = await this.db
        .from('marketplace_orders')
        .select('id, seller_payout_kobo, payout_status, amount, shipping_amount')
        .eq('id', orderId)
        .maybeSingle();
      if (orderRow?.payout_status === 'paid_out') return 'already_paid_out';
      const { data: profile } = await this.db
        .from('marketplace_seller_payout_profiles')
        .select('paystack_recipient_code, status')
        .eq('user_id', sellerId)
        .maybeSingle();
      if (!profile?.paystack_recipient_code || profile.status !== 'active') {
        throw new Error('Seller payout profile is missing or inactive');
      }
      const amountKobo = Number(
        orderRow?.seller_payout_kobo ??
          nairaToKobo(Number(orderRow?.amount || 0) + Number(orderRow?.shipping_amount || 0)),
      );
      const transferRef = createPaystackReference('ls_po');
      const transfer = await initiatePaystackTransfer({
        amountKobo,
        recipientCode: profile.paystack_recipient_code,
        reference: transferRef,
        reason: `Lantern marketplace order ${orderId}`,
      });
      await this.db
        .from('marketplace_orders')
        .update({ payout_status: 'paid_out' })
        .eq('id', orderId);
      const { data: siblings } = await this.db
        .from('marketplace_orders')
        .select('id, status, payout_status')
        .eq('checkout_id', payment.checkout_id);
      const remaining = (siblings || []).filter(
        (row: { status: string; payout_status: string }) =>
          !['cancelled', 'completed'].includes(row.status) || row.payout_status !== 'paid_out',
      );
      const unfinished = (siblings || []).filter(
        (row: { status: string; payout_status: string }) =>
          row.status !== 'cancelled' && row.payout_status !== 'paid_out',
      );
      if (unfinished.length === 0 || remaining.length === 0) {
        await this.markPaymentPaidOut(payment.id);
      }
      void transfer;
      return 'transferred';
    }

    const { data: profile } = await this.db
      .from('marketplace_seller_payout_profiles')
      .select('paystack_recipient_code, status')
      .eq('user_id', sellerId)
      .maybeSingle();
    if (!profile?.paystack_recipient_code || profile.status !== 'active') {
      throw new Error('Seller payout profile is missing or inactive');
    }

    let working = payment;
    if (working.status === 'paid') {
      const { data: locked, error: lockErr } = await this.db
        .from('marketplace_payments')
        .update({ status: 'payout_pending', updated_at: new Date().toISOString() })
        .eq('id', working.id)
        .eq('status', 'paid')
        .select('*')
        .maybeSingle();
      if (lockErr) throw lockErr;
      if (!locked) {
        const { data: again } = await this.db
          .from('marketplace_payments')
          .select('*')
          .eq('id', working.id)
          .single();
        if (again?.status === 'paid_out') return 'already_paid_out';
        if (again?.status === 'payout_pending') return 'in_flight';
        working = again || working;
      } else {
        working = locked;
      }
    }

    if (working.status === 'payout_pending' && working.payout_transfer_code) {
      return 'in_flight';
    }

    const transferRef = createPaystackReference('ls_po');
    try {
      const transfer = await initiatePaystackTransfer({
        // The seller is paid the item minus any platform commission. Legacy
        // rows (pre-split) fall back to the full item amount.
        amountKobo: Number(working.seller_payout_kobo ?? working.item_amount_kobo),
        recipientCode: profile.paystack_recipient_code,
        reference: transferRef,
        reason: `Lantern marketplace order ${orderId}`,
      });

      await this.db
        .from('marketplace_payments')
        .update({
          payout_transfer_code: transfer.transferCode,
          updated_at: new Date().toISOString(),
          metadata: {
            ...(working.metadata || {}),
            payoutReference: transfer.reference,
          },
        })
        .eq('id', working.id);

      if (transfer.status === 'success') {
        await this.markPaymentPaidOut(working.id);
      }
    } catch (err) {
      await this.db
        .from('marketplace_payments')
        .update({ status: 'paid', updated_at: new Date().toISOString() })
        .eq('id', working.id)
        .eq('status', 'payout_pending');
      throw err;
    }

    return 'transferred';
  }

  /**
   * After buyer confirms receipt: transfer seller_payout_kobo (item minus the
   * platform commission) to the seller; Lantern keeps platform_fee_kobo.
   */
  async payoutOnConfirmReceived(orderId: string, buyerId: string) {
    const order = await this.orders.getOrderById(orderId, buyerId);
    if (!order) throw new Error('Order not found');
    if (order.buyer_id !== buyerId) throw new Error('Only the buyer can confirm receipt');

    let payment: Record<string, any> | null = null;
    if (order.payment_id) {
      const { data } = await this.db
        .from('marketplace_payments')
        .select('*')
        .eq('id', order.payment_id)
        .maybeSingle();
      payment = data;
    }

    // Legacy soft-escrow orders (no Paystack payment): fall back to old release.
    if (!payment) {
      return this.orders.releaseEscrow(orderId, buyerId);
    }

    await this.transferSellerPayout(orderId, order.seller_id, payment);
    return this.orders.releaseEscrow(orderId, buyerId);
  }

  /**
   * Admin / dispute path: force seller payout when payment is settled (idempotent if already paid out).
   */
  async forcePayoutForOrder(orderId: string): Promise<void> {
    const order = await this.orders.getOrderByIdAdmin(orderId);
    if (!order) throw new Error('Order not found');
    if (!order.payment_id) return;

    const { data: payment } = await this.db
      .from('marketplace_payments')
      .select('*')
      .eq('id', order.payment_id)
      .maybeSingle();
    if (!payment) return;
    if (payment.status === 'paid_out') return;

    await this.transferSellerPayout(orderId, order.seller_id, payment);
  }

  async markPaymentPaidOut(paymentId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .from('marketplace_payments')
      .update({
        status: 'paid_out',
        payout_at: now,
        updated_at: now,
      })
      .eq('id', paymentId)
      .in('status', ['payout_pending', 'paid']);
  }

  async refundPaymentForOrder(orderId: string, actorId: string, isAdmin = false) {
    const order = await this.orders.getOrderById(orderId, actorId);
    if (!order) throw new Error('Order not found');
    if (!isAdmin && order.buyer_id !== actorId && order.seller_id !== actorId) {
      throw new Error('Unauthorized');
    }
    if (!order.payment_id) {
      // legacy
      return;
    }
    const { data: payment } = await this.db
      .from('marketplace_payments')
      .select('*')
      .eq('id', order.payment_id)
      .single();
    if (!payment) return;
    if (payment.status === 'refunded') return;
    if (payment.status === 'paid_out') {
      throw new Error('Cannot auto-refund after seller payout; contact support');
    }
    if (payment.status !== 'paid' && payment.status !== 'payout_pending' && payment.status !== 'initialized') {
      throw new Error('Payment cannot be refunded');
    }

    if (payment.status === 'paid' || payment.status === 'payout_pending') {
      const txRef = payment.paystack_transaction_id || payment.paystack_reference;
      const orderShareKobo = nairaToKobo(
        Number(order.amount || 0) + Number((order as { shipping_amount?: number }).shipping_amount || 0),
      );
      const amountKobo = payment.checkout_id ? orderShareKobo : Number(payment.total_charged_kobo);
      const refund = await refundPaystackTransaction({
        transactionIdOrReference: txRef,
        amountKobo,
      });
      const { data: siblings } = payment.checkout_id
        ? await this.db
            .from('marketplace_orders')
            .select('id, status')
            .eq('checkout_id', payment.checkout_id)
        : { data: [] };
      const othersOpen = (siblings || []).some(
        (row: { id: string; status: string }) =>
          row.id !== orderId && !['cancelled', 'completed'].includes(row.status),
      );
      if (!payment.checkout_id || !othersOpen) {
        await this.db
          .from('marketplace_payments')
          .update({
            status: 'refunded',
            refund_reference: String(refund.id),
            updated_at: new Date().toISOString(),
          })
          .eq('id', payment.id);
      }
    } else {
      await this.db
        .from('marketplace_payments')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', payment.id);
    }
  }

  /**
   * The seller's earnings ledger (Phase 2 · I): one row per payment they
   * received, with the item / platform-commission / payout split and status.
   */
  async getSellerPayments(
    sellerId: string,
    page = 1,
    pageSize = 20
  ): Promise<
    Array<{
      orderId: string;
      listingId: string | null;
      title: string;
      itemAmountKobo: number;
      platformFeeKobo: number;
      sellerPayoutKobo: number;
      status: string;
      paidAt: string | null;
      payoutAt: string | null;
    }>
  > {
    const size = Math.min(Math.max(1, Math.floor(pageSize)), 50);
    const from = Math.max(0, (Math.max(1, Math.floor(page)) - 1) * size);
    const { data: payments, error } = await this.db
      .from('marketplace_payments')
      .select(
        'order_id, item_amount_kobo, platform_fee_kobo, seller_payout_kobo, status, paid_at, payout_at, created_at'
      )
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false })
      .range(from, from + size - 1);
    if (error) throw error;
    const rows = payments || [];

    const orderIds = Array.from(new Set(rows.map((p: any) => String(p.order_id)).filter(Boolean)));
    const orderToListing = new Map<string, string>();
    const listingTitle = new Map<string, string>();
    if (orderIds.length > 0) {
      const { data: orders } = await this.db
        .from('marketplace_orders')
        .select('id, listing_id')
        .in('id', orderIds);
      for (const o of orders || []) orderToListing.set(String(o.id), String((o as any).listing_id));
      const listingIds = Array.from(new Set([...orderToListing.values()].filter(Boolean)));
      if (listingIds.length > 0) {
        const { data: listings } = await this.db
          .from('marketplace_listings')
          .select('id, title')
          .in('id', listingIds);
        for (const l of listings || []) listingTitle.set(String(l.id), String((l as any).title || 'Listing'));
      }
    }

    return rows.map((p: any) => {
      const listingId = orderToListing.get(String(p.order_id)) || null;
      return {
        orderId: String(p.order_id),
        listingId,
        title: (listingId && listingTitle.get(listingId)) || 'Listing',
        itemAmountKobo: Number(p.item_amount_kobo),
        platformFeeKobo: Number(p.platform_fee_kobo ?? 0),
        sellerPayoutKobo: Number(p.seller_payout_kobo ?? p.item_amount_kobo),
        status: String(p.status),
        paidAt: p.paid_at ?? null,
        payoutAt: p.payout_at ?? null,
      };
    });
  }

  /**
   * A settlement arrived whose amount or currency does not match what we
   * initialized. Money may have been captured without the order settling —
   * the worst silent failure a payment system can have — so this both reports
   * to Sentry and stamps the payment row's metadata for reconciliation.
   */
  private async recordSettlementMismatch(
    payment: Record<string, any>,
    details: {
      source: 'verify' | 'webhook';
      reference: string;
      expectedAmount: number;
      gotAmount: number;
      expectedCurrency?: string;
      gotCurrency?: string;
      reason?: string;
    }
  ): Promise<void> {
    logger.error('Paystack settlement mismatch', details);
    try {
      const { captureException } = await import('../utils/sentry');
      captureException(new Error('Paystack settlement mismatch — captured funds did not settle an order'), {
        ...details,
        paymentId: payment.id,
        orderId: payment.order_id,
      });
    } catch {
      // reporting must never break the webhook path
    }
    try {
      await this.db
        .from('marketplace_payments')
        .update({
          metadata: {
            ...(payment.metadata || {}),
            settlement_mismatch: { ...details, at: new Date().toISOString() },
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', payment.id);
    } catch {
      // best-effort stamp
    }
  }

  async handleWebhook(rawBody: string | Buffer, signature: string | undefined) {
    if (!verifyPaystackSignature(rawBody, signature)) {
      const err = new Error('Invalid Paystack webhook signature');
      (err as Error & { statusCode?: number }).statusCode = 401;
      throw err;
    }

    const payload = JSON.parse(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8')) as {
      event?: string;
      data?: Record<string, any>;
    };
    const eventType = payload.event || 'unknown';
    const data = payload.data || {};
    const eventKey =
      data.id != null
        ? `${eventType}:${data.id}`
        : `${eventType}:${data.reference || data.transfer_code || createHash('sha256').update(String(rawBody)).digest('hex').slice(0, 24)}`;

    const { error: dedupeErr } = await this.db.from('paystack_webhook_events').insert({
      event_key: eventKey,
      event_type: eventType,
      payload_hash: createHash('sha256').update(String(rawBody)).digest('hex'),
    });
    if (dedupeErr) {
      if (String(dedupeErr.code) === '23505' || /duplicate/i.test(dedupeErr.message || '')) {
        return { ok: true, duplicate: true };
      }
      throw dedupeErr;
    }

    if (eventType === 'charge.success') {
      const reference = String(data.reference || '');
      const { data: payment } = await this.db
        .from('marketplace_payments')
        .select('*')
        .eq('paystack_reference', reference)
        .maybeSingle();
      if (payment) {
        const amountMismatch = Number(data.amount) !== Number(payment.total_charged_kobo);
        const currencyMismatch = Boolean(data.currency && data.currency !== payment.currency);
        // A row that is neither open nor already settled (retired as stale,
        // failed, refunded) can still receive a charge.success from a Paystack
        // page the buyer kept open. markPaymentPaid would silently no-op on it,
        // so money would be captured with no trace — record it instead.
        const settled = ['paid', 'payout_pending', 'paid_out'].includes(String(payment.status));
        const retiredRow = !settled && payment.status !== 'initialized';
        if (amountMismatch || currencyMismatch || retiredRow) {
          // The event is already consumed by the dedupe row above and Paystack
          // gets a 200, so this is the ONLY trace that money was captured
          // without settling the order. Make it impossible to miss: Sentry
          // event + a mismatch stamp on the payment row for reconciliation.
          await this.recordSettlementMismatch(payment, {
            source: 'webhook',
            reference,
            expectedAmount: Number(payment.total_charged_kobo),
            gotAmount: Number(data.amount),
            expectedCurrency: payment.currency,
            gotCurrency: data.currency,
            ...(retiredRow ? { reason: `payment_${payment.status}` } : {}),
          });
        } else {
          await this.markPaymentPaid(payment.id, String(data.id || reference), data.paid_at);
        }
      }
    } else if (eventType === 'transfer.success') {
      const transferCode = String(data.transfer_code || '');
      const reference = String(data.reference || '');
      const { data: payment } = await this.db
        .from('marketplace_payments')
        .select('*')
        .or(
          transferCode
            ? `payout_transfer_code.eq.${transferCode}`
            : `paystack_reference.eq.${reference}`
        )
        .maybeSingle();
      // Prefer lookup by transfer code in metadata / column
      let row = payment;
      if (!row && transferCode) {
        const { data: byCode } = await this.db
          .from('marketplace_payments')
          .select('*')
          .eq('payout_transfer_code', transferCode)
          .maybeSingle();
        row = byCode;
      }
      if (row) await this.markPaymentPaidOut(row.id);
    } else if (eventType === 'transfer.failed' || eventType === 'transfer.reversed') {
      const transferCode = String(data.transfer_code || '');
      if (transferCode) {
        await this.db
          .from('marketplace_payments')
          .update({ status: 'paid', updated_at: new Date().toISOString() })
          .eq('payout_transfer_code', transferCode)
          .eq('status', 'payout_pending');
      }
    }

    return { ok: true, duplicate: false, eventType };
  }
}

let paymentsSingleton: MarketplacePaymentsService | null = null;

export function getMarketplacePaymentsService(supabase: SupabaseService): MarketplacePaymentsService {
  if (!paymentsSingleton) {
    paymentsSingleton = new MarketplacePaymentsService(supabase);
  }
  return paymentsSingleton;
}
