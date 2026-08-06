import {
  computeMarketplaceCheckoutFees,
  isMarketplacePaystackCheckoutEnabled,
  nairaToKobo,
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
    const fees = computeMarketplaceCheckoutFees(
      itemAmountKobo,
      resolveMarketplaceServiceFeeBps(process.env.MARKETPLACE_SERVICE_FEE_BPS)
    );
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

    if (order.payment_id) {
      const { data: existing } = await this.db
        .from('marketplace_payments')
        .select('*')
        .eq('id', order.payment_id)
        .maybeSingle();
      if (existing?.status === 'initialized' && existing.paystack_access_code) {
        // Re-init if needed — return verify path; for simplicity create new only when missing URL
      }
    }

    const itemAmountKobo = nairaToKobo(Number(order.amount));
    const fees = computeMarketplaceCheckoutFees(
      itemAmountKobo,
      resolveMarketplaceServiceFeeBps(process.env.MARKETPLACE_SERVICE_FEE_BPS)
    );
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
        currency: 'NGN',
        paystack_reference: reference,
        status: 'initialized',
        metadata: { source: 'offer_accept', listingId: order.listing_id },
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
        .select('*')
        .eq('id', order.payment_id)
        .maybeSingle();
      if (existing?.status === 'initialized' && existing.paystack_access_code) {
        const meta = (existing.metadata || {}) as Record<string, unknown>;
        const authorizationUrl =
          (typeof meta.authorizationUrl === 'string' && meta.authorizationUrl) ||
          `https://checkout.paystack.com/${existing.paystack_access_code}`;
        return {
          order,
          payment: {
            id: existing.id,
            reference: existing.paystack_reference,
            status: existing.status,
            itemAmountKobo: Number(existing.item_amount_kobo),
            serviceFeeKobo: Number(existing.service_fee_kobo),
            totalChargeKobo: Number(existing.total_charged_kobo),
            currency: existing.currency || 'NGN',
          },
          authorizationUrl,
          accessCode: existing.paystack_access_code,
          publicKey: getPaystackPublicKey(),
        };
      }
      if (existing?.status === 'paid' || existing?.status === 'paid_out' || existing?.status === 'payout_pending') {
        throw new Error('Order is already paid');
      }
    }

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
    if (Number(verified.amount) !== Number(payment.total_charged_kobo)) {
      logger.error('Paystack amount mismatch', {
        reference,
        expected: payment.total_charged_kobo,
        got: verified.amount,
      });
      throw new Error('Payment amount mismatch');
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

    if (payment.order_id) {
      await this.db
        .from('marketplace_orders')
        .update({ status: 'paid' })
        .eq('id', payment.order_id)
        .in('status', ['awaiting_payment', 'pending_payment']);

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

    await invalidateSellerAnalyticsCache(payment.seller_id);
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
    if (payment.status === 'paid_out') return 'already_paid_out';
    if (payment.status === 'refunded' || payment.status === 'failed') {
      throw new Error('Payment cannot be paid out in its current state');
    }
    if (payment.status !== 'paid' && payment.status !== 'payout_pending') {
      throw new Error('Order payment is not settled yet');
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
        amountKobo: Number(working.item_amount_kobo),
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
   * After buyer confirms receipt: transfer item amount to seller; keep service fee.
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
      const refund = await refundPaystackTransaction({
        transactionIdOrReference: txRef,
        amountKobo: Number(payment.total_charged_kobo),
      });
      await this.db
        .from('marketplace_payments')
        .update({
          status: 'refunded',
          refund_reference: String(refund.id),
          updated_at: new Date().toISOString(),
        })
        .eq('id', payment.id);
    } else {
      await this.db
        .from('marketplace_payments')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', payment.id);
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
        if (Number(data.amount) !== Number(payment.total_charged_kobo)) {
          logger.error('Webhook amount mismatch', { reference, expected: payment.total_charged_kobo, got: data.amount });
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
