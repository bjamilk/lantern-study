/**
 * Marketplace money path: Paystack charge sessions, settlement, seller payouts
 * and refunds. Every naira that moves through Lantern moves through this file.
 *
 * Exports
 * - `MarketplacePaymentsService` / `getMarketplacePaymentsService(supabase)` —
 *   the process-wide singleton. Called by `routes/marketplace/*` (buy-now,
 *   cart checkout, verify, confirm-received, refund), `routes/admin.ts` (force
 *   payout, dispute resolution) and `routes/paystackWebhook.ts`.
 * - `marketplacePaystackEnabled()` — the env kill switch; routes fall back to
 *   the manual meetup flow when it is false.
 * - `orderPayoutReference(orderId)` — the deterministic transfer reference.
 *
 * What it touches
 * - Supabase tables: `marketplace_payments`, `marketplace_orders`,
 *   `marketplace_checkouts`, `marketplace_cart_items`, `marketplace_listings`,
 *   `marketplace_seller_payout_profiles`, `paystack_webhook_events`.
 * - Paystack REST: transaction initialize/verify, transfer recipient, transfer,
 *   refund (all via `./paystack`).
 * - Redis, indirectly: `invalidateSellerAnalyticsCache` busts the seller
 *   analytics key after every settlement.
 * - Sentry, via `recordSettlementMismatch` and the digital-delivery catch.
 *
 * SETTLEMENT STATE MACHINE
 *
 * `marketplace_payments.status`
 *   initialized -> paid -> payout_pending -> paid_out
 *                       \-> refunding -> refunded
 *                       \-> failed
 * `marketplace_orders.status`
 *   awaiting_payment | pending_payment -> paid -> ready_for_pickup | shipped
 *                                             -> completed | cancelled
 * `marketplace_orders.payout_status` (unified checkout only)
 *   pending -> paying (claimed by exactly one caller) -> paid_out; `skipped`
 *   for orders that never pay out (and for one whose buyer has been refunded).
 *
 * MONEY OUT AND MONEY BACK ARE MUTUALLY EXCLUSIVE (G3 · H2/H3/H4)
 * `payout_status` is one row's single claim slot and both directions compete
 * for it: the payout CAS takes `pending -> paying`, the refund CAS takes
 * `pending -> refund_hold`, and neither can start from the other's state. The
 * payment row carries the same rule for single-order checkouts — `paid ->
 * refunding` is the refund claim, `paid -> payout_pending` (plus a
 * `claim:<reference>` marker in `payout_transfer_code`) is the payout claim —
 * so a buyer's refund and a seller's transfer can never both be in flight for
 * the same money, and two refunds cannot both reach Paystack.
 *
 * `payout_attempt` (orders and payments) counts the transfers Paystack has
 * BURNT: it is incremented only by `transfer.failed` / `transfer.reversed`, and
 * `orderPayoutReference(orderId, attempt)` folds it into the transfer
 * reference, so a reversed payout can be retried (H1) while a duplicate of the
 * same attempt is still refused by Paystack.
 *
 * Requires migration `20260915140000_marketplace_payout_attempt_and_refund_claim.sql`.
 *
 * Two shapes of checkout share the machine:
 * - Buy-now / offer-accept: ONE payment row with `order_id` set and
 *   `checkout_id` NULL. Payout state lives on the payment row itself
 *   (`paid` -> `payout_pending` + `payout_transfer_code` -> `paid_out`).
 * - Cart checkout: ONE payment row with `checkout_id` set, covering MANY
 *   `marketplace_orders` that share that `checkout_id` — potentially several
 *   sellers. Each order is paid out separately, so the per-order
 *   `payout_status` is the truthful answer to "has this seller been paid?";
 *   the payment row only reaches `paid_out` once every sibling order has.
 *
 * WEBHOOK CONTRACT (`handleWebhook`, mounted at `routes/paystackWebhook.ts`)
 * Handled events: `charge.success`, `transfer.success`, `transfer.failed`,
 * `transfer.reversed`. Anything else is claimed, stamped and ignored.
 * Dedupe is TWO-PHASE: the `paystack_webhook_events` claim row is inserted with
 * `processed_at` NULL and stamped only after processing returns. Stamping on
 * insert (the old behaviour) meant a crash mid-processing turned every Paystack
 * retry into a silent "duplicate" no-op, stranding a paid order forever. A
 * claim with `processed_at` still NULL is a dead previous attempt and is
 * re-processed; only a stamped row is a true duplicate. Requires migration
 * `20260915110000_paystack_webhook_two_phase.sql`. Every branch of
 * `processWebhookEvent` must therefore stay safe to re-run.
 *
 * IDEMPOTENCY
 * Webhook dedupe is DB-backed on the `paystack_webhook_events.event_key` UNIQUE
 * index, not an in-memory set, so it holds across the multiple Render replicas
 * that serve the webhook. Request-level idempotency for checkout creation lives
 * in `services/idempotency.ts` on `api_idempotency_keys`, same reasoning.
 *
 * DELIBERATE DEFENCES — do not weaken any of these
 * - No client-supplied amount exists anywhere on the charge path. Every kobo
 *   figure is derived server-side from the listing price and the fee resolver.
 * - Amount AND currency are verified against the stored payment row on both the
 *   webhook and the verify path before anything is marked paid.
 * - A mismatch calls `recordSettlementMismatch`, which alerts Sentry and stamps
 *   the row for reconciliation instead of swallowing captured funds.
 * - Retired payment rows (superseded, failed, refunded) cannot be settled by a
 *   late `charge.success` from a Paystack page left open in a stale tab.
 * - `paystack_mode` is stamped at initialize and re-checked at settlement, so a
 *   test-key server can never settle a live charge or vice versa.
 * - `seller_id` is always derived from the listing, never from the request.
 * - The payout account is read from `marketplace_seller_payout_profiles` by the
 *   seller's own id; no request field selects a destination account.
 * - `assertSellerCanReceivePayout` gates every checkout-creation path, so money
 *   is never captured for a seller who cannot be paid.
 * - Entitlements for digital goods are granted only from server-side
 *   settlement, never from a client-reported success.
 * - Stock is protected by SELECT ... FOR UPDATE inside the SECURITY DEFINER RPC
 *   `marketplace_create_buy_now_order`, which is revoked from PUBLIC.
 * - Fee maths is integer kobo throughout, with the platform cut clamped by
 *   `Math.min` in `@lantern/shared/marketplace` so a seller payout can never go
 *   negative.
 *
 * Gotcha: the service is a module-level singleton bound to the first HOST
 * passed in, so tests must construct the class directly rather than
 * re-calling the factory.
 */
/**
 * FLIPPED (monolith lane M3, Phase B): takes `MarketplaceServiceHost` — the
 * shared, narrow host of the money cluster — instead of the whole
 * `SupabaseService`. See `services/marketplaceServiceHost.ts` for why the six
 * money services share one type and how the last facade-side callers adapt.
 */
import {
  computeMarketplaceCheckoutFees,
  isDigitalListingKind,
  isMarketplacePaystackCheckoutEnabled,
  nairaToKobo,
  resolveMarketplaceFees,
  resolveMarketplaceServiceFeeBps,
} from '@lantern/shared/marketplace';
import type { MarketplaceServiceHost } from './marketplaceServiceHost';
import { PublicError } from '../utils/safeError';
import { logger } from '../utils/logger';
import {
  createPaystackReference,
  createPaystackTransferRecipient,
  getPaystackPublicKey,
  initializePaystackTransaction,
  initiatePaystackTransfer,
  isPaystackConfigured,
  paystackMode,
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
import { bestEffortWrite, mustWrite, reconcileLaterWrite } from './data/writeResult';
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

/**
 * The payout transfer reference for one ATTEMPT at paying out an order.
 * Paystack refuses a duplicate transfer reference, so this is the last line of
 * defence against paying a seller twice for one order even if two processes get
 * past the database claim.
 *
 * FIXED (G3 · H1): the reference used to be a pure hash of the order id, which
 * made that last line of defence permanent. `transfer.failed` /
 * `transfer.reversed` reset `payout_status` to `pending` "so it can be retried",
 * but every retry sent Paystack the identical reference, Paystack rejected it as
 * a duplicate, the claim was released, and the seller was never paid for that
 * order — a dead end with no manual way out.
 *
 * The attempt number breaks the tie and nothing else: the reference is still
 * deterministic per (order, attempt), so a retry of the SAME attempt — the
 * double-transfer case — still collides at Paystack. Attempt 0 keeps the
 * original spelling, so a payout in flight across this deploy still matches its
 * stored reference. The counter lives on the order / payment row and is
 * incremented only when Paystack has definitively burnt a reference (a
 * `transfer.failed` or `transfer.reversed` event); a transfer call that throws
 * locally keeps the same attempt, because the request may still have reached
 * Paystack and the duplicate-reference refusal is what protects the seller.
 */
export function orderPayoutReference(orderId: string, attempt: number = 0): string {
  const base = createHash('sha256').update(`payout:${orderId}`).digest('hex').slice(0, 32);
  const n = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  return n === 0 ? `ls_po_${base}` : `ls_po_${base}_a${n}`;
}

/** How many past attempts a reference scan will consider. Bounded on purpose. */
const MAX_PAYOUT_ATTEMPT_SCAN = 25;

/**
 * What a payout-settling write should do when it fails (#108).
 *
 * `finalizeOrderPayout` and `markPaymentPaidOut` each have two callers whose
 * needs are opposite, and this is how the call site says which it is:
 *
 * - `'throw'` — a `transfer.success` WEBHOOK. Paystack retries a non-2xx, and
 *   both writes are compare-and-sets that match nothing once they have
 *   succeeded, so re-delivery is a no-op and failing is the way to get the row
 *   settled eventually.
 * - `'reconcile'` — the INLINE call made immediately after a transfer that came
 *   back `success`. The money has already moved, and this call is downstream of
 *   a buyer's confirm-received: throwing would answer them 500 for a payout
 *   that worked. Report and carry on; the `transfer.success` webhook arrives
 *   later and settles the row with `'throw'`, which is the real repair path.
 *
 * Founder decision, 2026-09-17; see `docs/write-errors-plan.md`.
 */
type PayoutWriteFailureMode = 'throw' | 'reconcile';

export class MarketplacePaymentsService {
  private orders: MarketplaceOrdersService;

  constructor(private readonly host: MarketplaceServiceHost) {
    this.orders = new MarketplaceOrdersService(host);
  }

  private get db() {
    return this.host.getClient();
  }

  // --- Seller payout profiles ------------------------------------------------
  // The destination bank account for every transfer. Always keyed by the
  // seller's own user id: no request field names an account, and no caller
  // passes a recipient code in. `assertSellerCanReceivePayout` is the gate
  // every checkout-creation path calls before money is captured, so Lantern
  // never holds funds for a seller it cannot pay.

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
      throw new PublicError('Valid bank account number and bank code are required');
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
      throw new PublicError(
        'Seller has not set up a payout bank account. They must add bank details before checkout.'
      );
    }
  }

  // --- Charge creation -------------------------------------------------------
  // Three entry points open a Paystack session: buy-now, unified cart checkout,
  // and attaching a charge to an existing order (offer-accept / resume). All
  // three follow the same shape: resolve the fee split server-side from the
  // listing, insert a `marketplace_payments` row stamped with the current
  // Paystack mode, point the order(s) at it, then initialize the transaction.
  // No amount on any of these paths comes from the client — the request only
  // ever names a listing, a quantity and an optional coupon.

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
      throw new PublicError('Paystack marketplace checkout is not enabled');
    }

    const listing = await this.host.marketplace.getMarketplaceListingById(input.listingId);
    if (!listing) throw new PublicError('Listing not found');
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
        // Which Paystack key this session was opened against; settlement
        // refuses a row whose mode differs from the running server's.
        paystack_mode: paystackMode(),
        metadata: {
          listingId: input.listingId,
          quantity: order.quantity || 1,
          source: 'buy_now',
        },
      })
      .select('*')
      .single();
    if (payErr || !payment) throw payErr || new Error('Failed to create payment');

    // MUST SUCCEED (#108): this is the link the whole settlement path walks. A
    // buyer sent to Paystack for an order that does not carry `payment_id` and
    // is not `awaiting_payment` produces a charge whose webhook settles a
    // payment nobody's order points at. Nothing external has happened yet, so
    // stopping here costs only the request. The payment row already inserted is
    // deliberately left at `initialized` — see docs/write-errors-plan.md.
    mustWrite(
      await this.db
        .from('marketplace_orders')
        .update({ payment_id: payment.id, status: 'awaiting_payment' })
        .eq('id', order.id),
      { table: 'marketplace_orders', op: 'update', orderId: order.id, paymentId: payment.id },
    );

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

    // BEST EFFORT (#108): the Paystack session is already live and the response
    // below carries its URL, so throwing here would strand a real charge the
    // buyer never sees. Only RESUME degrades without the stored access code —
    // createCheckoutForExistingOrder mints a fresh session instead of reusing
    // this one — so the failure is reported and the checkout goes ahead.
    bestEffortWrite(
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
        .eq('id', payment.id),
      { table: 'marketplace_payments', op: 'update', paymentId: payment.id, orderId: order.id },
    );

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
      throw new PublicError('Paystack marketplace checkout is not enabled');
    }
    const first = input.orders[0];
    if (!first) throw new PublicError('Checkout has no orders');
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
        // Which Paystack key this session was opened against; settlement
        // refuses a row whose mode differs from the running server's.
        paystack_mode: paystackMode(),
        metadata: {
          checkoutId: input.checkoutId,
          orderIds: input.orders.map((order) => order.id),
          source: 'unified_checkout',
        },
      })
      .select('*')
      .single();
    if (payErr || !payment) throw payErr || new Error('Failed to create checkout payment');

    // BEST EFFORT (#108): `checkouts.payment_id` is a display mirror. Every
    // money decision walks the other way — `payments.checkout_id` finds the
    // orders — so a missed mirror costs the checkout page a field, not a
    // settlement. (The issue frames this as must-succeed; it is not.)
    bestEffortWrite(
      await this.db
        .from('marketplace_checkouts')
        .update({ payment_id: payment.id, updated_at: new Date().toISOString() })
        .eq('id', input.checkoutId),
      {
        table: 'marketplace_checkouts',
        op: 'update',
        checkoutId: input.checkoutId,
        paymentId: payment.id,
      },
    );

    // MUST SUCCEED (#108): the link `fulfillOrdersForPayment` walks. Unlinked
    // orders left in the cart's pre-payment state are never advanced by the
    // webhook, so the buyer pays and nothing moves. Nothing external has
    // happened yet, and `createFromCart` already cancels these orders and marks
    // the checkout `failed` when this throws.
    mustWrite(
      await this.db
        .from('marketplace_orders')
        .update({ payment_id: payment.id, status: 'awaiting_payment' })
        .in(
          'id',
          input.orders.map((order) => order.id),
        ),
      {
        table: 'marketplace_orders',
        op: 'update',
        checkoutId: input.checkoutId,
        paymentId: payment.id,
        orderCount: input.orders.length,
      },
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

    // BEST EFFORT (#108): the session is live and the URL is in the response
    // below, so throwing would strand a real charge the buyer never sees. Only
    // resume degrades without the stored code.
    bestEffortWrite(
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
        .eq('id', payment.id),
      {
        table: 'marketplace_payments',
        op: 'update',
        paymentId: payment.id,
        checkoutId: input.checkoutId,
      },
    );

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
    const listing = await this.host.marketplace.getMarketplaceListingById(input.listingId);
    if (!listing) throw new PublicError('Listing not found');
    if (listing.user_id === input.buyerId) throw new PublicError('Cannot buy your own listing');

    const quantity = Math.max(1, Math.floor(Number(input.quantity) || 1));
    const unitPrice = resolveEffectivePrice(listing);
    let unitAmount = unitPrice;
    let couponId: string | null = null;
    let unitDiscount = 0;

    if (input.couponCode) {
      const { getMarketplaceCouponsService } = await import('./marketplaceCoupons');
      const validated = await getMarketplaceCouponsService(this.host).validateForListing(
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
    // Invariant break, not a client mistake: the RPC returned no order id.
    // A bare Error so it reaches the global handler as a 500 and lands in 5xx
    // alerting, instead of being reported to the buyer as their fault.
    if (!orderId) throw new Error('Failed to create marketplace order');

    // BEST EFFORT (#108): the RPC creates the order as `pending_payment`, and
    // every reader on the payment path accepts both spellings — the resume
    // guard, `fulfillOrdersForPayment`, the cart link. Throwing here would
    // strand the stock the RPC has already held under SELECT ... FOR UPDATE, so
    // the charge goes ahead on the status the RPC gave it and the miss is
    // reported.
    bestEffortWrite(
      await this.db.from('marketplace_orders').update({ status: 'awaiting_payment' }).eq('id', orderId),
      { table: 'marketplace_orders', op: 'update', orderId, from: 'pending_payment' },
    );

    const order = await this.orders.getOrderById(orderId, input.buyerId);
    // Same: the row was just created by the RPC above, so its absence is a
    // server fault. Bare Error → 500.
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
      throw new PublicError('Paystack marketplace checkout is not enabled');
    }
    const order = await this.orders.getOrderById(input.orderId, input.buyerId);
    if (!order) throw new PublicError('Order not found');
    if (order.buyer_id !== input.buyerId) throw new PublicError('Unauthorized');
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
        // MUST SUCCEED (#108): this is the invariant the comment above states.
        // If the stale row is not retired and we insert a replacement anyway,
        // the order has TWO live sessions and the old one's `charge.success`
        // can still settle it on the old split — the exact outcome retiring it
        // first exists to prevent. Nothing external has happened yet.
        mustWrite(
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
            .eq('status', 'initialized'),
          {
            table: 'marketplace_payments',
            op: 'update',
            paymentId: existing.id,
            orderId: order.id,
            reason: 'supersede_stale_session',
          },
        );
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
        // Which Paystack key this session was opened against; settlement
        // refuses a row whose mode differs from the running server's.
        paystack_mode: paystackMode(),
        metadata: {
          source: 'offer_accept',
          listingId: order.listing_id,
          ...(supersededPaymentId ? { supersedes: supersededPaymentId } : {}),
        },
      })
      .select('*')
      .single();
    if (payErr || !payment) throw payErr || new Error('Failed to create payment');

    // MUST SUCCEED (#108): same link, same reason as the buy-now path — an
    // order that does not carry `payment_id` is one the webhook cannot settle.
    // Nothing external has happened yet.
    mustWrite(
      await this.db
        .from('marketplace_orders')
        .update({ payment_id: payment.id, status: 'awaiting_payment' })
        .eq('id', order.id),
      { table: 'marketplace_orders', op: 'update', orderId: order.id, paymentId: payment.id },
    );

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

    // BEST EFFORT (#108): as the other two charge paths — the session is live
    // and the URL is already in the response.
    bestEffortWrite(
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
        .eq('id', payment.id),
      { table: 'marketplace_payments', op: 'update', paymentId: payment.id, orderId: order.id },
    );

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
      throw new PublicError('Paystack marketplace checkout is not enabled');
    }
    const order = await this.orders.getOrderById(orderId, buyerId);
    if (!order) throw new PublicError('Order not found');
    if (order.buyer_id !== buyerId) throw new PublicError('Unauthorized');
    if (!['awaiting_payment', 'pending_payment'].includes(order.status)) {
      throw new PublicError('Order is not awaiting payment');
    }

    if (order.payment_id) {
      const { data: existing } = await this.db
        .from('marketplace_payments')
        .select('status')
        .eq('id', order.payment_id)
        .maybeSingle();
      if (existing?.status === 'paid' || existing?.status === 'paid_out' || existing?.status === 'payout_pending') {
        throw new PublicError('Order is already paid');
      }
    }

    // Resuming the open session, or retiring a stale one and replacing it, is
    // decided in exactly one place: createCheckoutForExistingOrder.
    return this.createCheckoutForExistingOrder({ orderId, buyerId, buyerEmail });
  }

  // --- Settlement ------------------------------------------------------------
  // Two ways a payment becomes `paid`: the buyer's browser returning to
  // `verifyPaymentByReference` (a server-to-server Paystack verify, never a
  // client assertion), and `charge.success` on the webhook. Both converge on
  // `markPaymentPaid`, and both check amount, currency, Paystack mode and that
  // the row is still open before they do.

  async verifyPaymentByReference(reference: string, actorId: string) {
    const { data: payment, error } = await this.db
      .from('marketplace_payments')
      .select('*')
      .eq('paystack_reference', reference)
      .maybeSingle();
    if (error) throw error;
    if (!payment) throw new PublicError('Payment not found');
    if (payment.buyer_id !== actorId && payment.seller_id !== actorId) {
      throw new PublicError('Unauthorized');
    }
    this.assertPaystackModeMatches(payment);

    if (payment.status === 'paid' || payment.status === 'paid_out' || payment.status === 'payout_pending') {
      const order = payment.order_id
        ? await this.orders.getOrderById(payment.order_id, actorId)
        : null;
      return { payment, order, alreadySettled: true };
    }

    const verified = await verifyPaystackTransaction(reference);
    if (verified.status !== 'success') {
      throw new PublicError(`Payment not successful (${verified.status})`);
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
      throw new PublicError(retiredRow ? 'Payment session is no longer open' : 'Payment amount mismatch');
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

  // The single settlement funnel, reached from both verify and the webhook.
  // The status flip and the order-side fulfilment are deliberately separate
  // steps. The flip is a compare-and-set on `status = 'initialized'`, so only
  // one caller performs it; fulfilment then runs on EVERY call, including one
  // that lost the race or found the payment already `paid`. It used to return
  // early on an already-paid payment while the multi-order fulfilment loop ran
  // after the flip, so a failure partway through a cart left the remaining
  // orders unfulfilled with no way back in — every retry hit the early exit.
  // `fulfillOrdersForPayment` selects each order by its own unfulfilled status,
  // which is what makes re-running it a no-op rather than a duplicate.
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
    this.assertPaystackModeMatches(payment);

    const alreadySettled = ['paid', 'payout_pending', 'paid_out'].includes(payment.status);
    let settled: Record<string, any> = payment;

    if (!alreadySettled) {
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
      if (updated) {
        settled = updated;
      } else {
        // Raced with another settler. The status flip is theirs; the order-side
        // work below is still ours to resume — it filters on order state, so
        // running it twice is a no-op rather than a duplicate.
        const { data: again } = await this.db
          .from('marketplace_payments')
          .select('*')
          .eq('id', paymentId)
          .single();
        settled = again || payment;
        if (!['paid', 'payout_pending', 'paid_out'].includes(String(settled.status))) return;
      }

      if (payment.checkout_id) {
        // BEST EFFORT (#108): a display mirror. `getCheckout` returns it to the
        // checkout page; no money decision reads it, and the orders below are
        // the authoritative record.
        bestEffortWrite(
          await this.db
            .from('marketplace_checkouts')
            .update({ status: 'paid', updated_at: now })
            .eq('id', payment.checkout_id),
          {
            table: 'marketplace_checkouts',
            op: 'update',
            checkoutId: payment.checkout_id,
            paymentId,
          },
        );
      }
    }

    // Fulfilment is a separate, resumable step. It used to run only on the
    // attempt that flipped the status, so a throw partway through a multi-order
    // checkout left the remaining orders unfulfilled with no way back in — the
    // retry saw 'paid' and returned immediately.
    await this.fulfillOrdersForPayment(settled, now);

    await invalidateSellerAnalyticsCache(payment.seller_id);
  }

  /**
   * Bring every order behind a settled payment up to date. Safe to re-run: each
   * order is selected by its own unfulfilled status, so an order already paid
   * and notified is skipped and one left behind by a crashed attempt is picked
   * up on the next webhook retry.
   */
  private async fulfillOrdersForPayment(
    payment: Record<string, any>,
    now: string
  ): Promise<void> {
    const checkoutId = payment.checkout_id as string | undefined;
    let rows: Array<{ id: string; listing_id: string; buyer_id: string; seller_id: string; status: string }> = [];

    if (checkoutId) {
      const { data: checkoutOrders } = await this.db
        .from('marketplace_orders')
        .select('id, listing_id, buyer_id, seller_id, status')
        .eq('checkout_id', checkoutId);
      rows = (checkoutOrders || []) as typeof rows;
      if (rows.length > 0) {
        // BEST EFFORT (#108): a cart row left behind is an annoyance the buyer
        // can clear themselves. Failing settlement over it would be worse than
        // the bug.
        bestEffortWrite(
          await this.db
            .from('marketplace_cart_items')
            .delete()
            .eq('buyer_id', payment.buyer_id)
            .in(
              'listing_id',
              rows.map((row) => row.listing_id),
            ),
          {
            table: 'marketplace_cart_items',
            op: 'delete',
            checkoutId,
            paymentId: payment.id,
            orderCount: rows.length,
          },
        );
      }
    } else if (payment.order_id) {
      const { data: single } = await this.db
        .from('marketplace_orders')
        .select('id, listing_id, buyer_id, seller_id, status')
        .eq('id', payment.order_id)
        .maybeSingle();
      if (single) rows = [single as (typeof rows)[number]];
    }

    for (const order of rows) {
      const awaiting = ['awaiting_payment', 'pending_payment'].includes(String(order.status));
      // Terminal orders need nothing; re-running would re-notify or re-pay.
      if (!awaiting && !['paid'].includes(String(order.status))) continue;

      if (awaiting) {
        // MUST SUCCEED (#108), and on the webhook path that means answering a
        // non-2xx so Paystack delivers again. This is the authoritative record
        // that the buyer's money bought this order; everything downstream —
        // payout, refund eligibility, the buyer's own order list — reads it.
        // Re-running is safe by construction: `processed_at` is stamped only
        // after processing returns, so an unfinished claim is re-processed, and
        // the `.in(status, …)` filter below makes a second run a no-op rather
        // than a duplicate.
        mustWrite(
          await this.db
            .from('marketplace_orders')
            .update({ status: 'paid', payment_id: payment.id })
            .eq('id', order.id)
            .in('status', ['awaiting_payment', 'pending_payment']),
          {
            table: 'marketplace_orders',
            op: 'update',
            orderId: order.id,
            paymentId: payment.id,
            ...(checkoutId ? { checkoutId } : {}),
          },
        );
        await this.orders.stampOrderPaidAt(order.id, now);
      }

      // Digital products (question banks, study packs) fulfill instantly:
      // deliver, complete, pay out. Everything else keeps the meetup flow.
      const digital = await this.fulfillDigitalOrderAfterPayment(order.id, payment);
      if (!digital && awaiting) {
        await this.orders.notifyOrderParty(order.seller_id, {
          type: 'marketplace_order_update',
          message: 'Payment received via Paystack. Mark the order ready when the item is prepared.',
          link: `marketplace:order:${order.id}`,
          data: { orderId: order.id, paid: true, ...(checkoutId ? { checkoutId } : {}) },
        });
        await this.orders.notifyOrderParty(order.buyer_id, {
          type: 'marketplace_order_update',
          message: checkoutId
            ? 'Payment confirmed. Arrange campus pickup or watch for shipping.'
            : 'Payment confirmed. Arrange campus pickup with the seller.',
          link: `marketplace:order:${order.id}`,
          data: { orderId: order.id, paid: true, ...(checkoutId ? { checkoutId } : {}) },
        });
      }
    }
  }

  /**
   * A payment row initialised against one Paystack key must never be settled
   * against the other. Without this a test-mode charge could settle a live
   * order (free goods) or a live charge could be "settled" by test webhooks.
   */
  private assertPaystackModeMatches(payment: Record<string, any>): void {
    const rowMode = payment.paystack_mode ? String(payment.paystack_mode) : null;
    if (!rowMode) return; // legacy rows predate the stamp
    const current = paystackMode();
    if (rowMode !== current) {
      const err = new Error(
        `Paystack mode mismatch: payment was created in ${rowMode} mode, server is in ${current} mode`
      );
      logger.error('Refusing to settle a payment from a different Paystack mode', {
        paymentId: payment.id,
        rowMode,
        serverMode: current,
      });
      throw err;
    }
  }

  // --- Digital fulfilment ----------------------------------------------------
  // The JSDoc below predates the current control flow: delivery failure no
  // longer falls through to completion and payout. It used to — the error was
  // logged, swallowed, escrow released and the seller paid, leaving the buyer
  // charged with no entitlement and their only remedy throwing "cannot
  // auto-refund after seller payout". Now a delivery failure reports to Sentry
  // and returns immediately, so the payment stays `paid` (refundable), the
  // order stays open, and the next settlement attempt retries delivery.
  // Completion and payout are still isolated from each other below: a missed
  // payout leaves a visible `paid` payment recoverable via forcePayoutForOrder.
  //
  // Entitlements are granted here and only here — from server-side settlement,
  // never from a client reporting a successful checkout.

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
        await getMarketplaceStudyPacksService(this.host).grantEntitlement(
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
        await getMarketplaceQuestionBanksService(this.host).grantEntitlement(
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
      // The buyer has nothing. Completing the order and paying the seller now
      // would put the money beyond auto-refund for goods that were never
      // delivered, so stop here: the payment stays 'paid' (refundable), the
      // order stays open, and the next settle attempt retries delivery.
      try {
        const { captureException } = await import('../utils/sentry');
        captureException(
          err instanceof Error ? err : new Error('Digital delivery failed after payment'),
          {
            scope: 'marketplace_digital_delivery',
            orderId,
            listingId: order.listing_id,
            buyerId: order.buyer_id,
            sellerId: order.seller_id,
            kind,
            paymentId: payment?.id,
          }
        );
      } catch {
        // alerting must never mask the delivery failure
      }
      return true;
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

  // --- Seller payout ---------------------------------------------------------
  // Two branches, one per checkout shape, and BOTH now claim before money moves.
  //
  // Unified checkout (`payment.checkout_id` set): a compare-and-set on
  // `marketplace_orders.payout_status` pending -> paying. Exactly one caller
  // wins; the losers return 'in_flight' or 'already_paid_out'. This branch used
  // to guard on a plain read of `payout_status` and write `paid_out` only AFTER
  // the transfer, so a buyer's confirm_received racing an admin force-payout
  // both passed the read and both transferred — and because the reference was
  // freshly random, Paystack's own reference idempotency did not catch it
  // either. The platform paid the seller twice out of its own balance, which is
  // not refund-recoverable. Fixed by the CAS plus `orderPayoutReference`.
  //
  // Single order (`checkout_id` NULL): the same claim expressed on the payment
  // row, paid -> payout_pending, plus an `in_flight` short-circuit when a
  // transfer code is already recorded.
  //
  // `orderPayoutReference(orderId)` is deterministic on purpose: Paystack
  // rejects a duplicate transfer reference, so it is the last line of defence
  // if a process somehow gets past the database claim.

  /**
   * Initiate seller transfer for a paid payment. Idempotent when already paid_out.
   * Returns true if a transfer was initiated or already completed; false if no Paystack payment.
   */
  private async transferSellerPayout(
    orderId: string,
    sellerId: string,
    payment: Record<string, any>
  ): Promise<'legacy' | 'already_paid_out' | 'transferred' | 'in_flight'> {
    // 'refunding' is the refund claim (H2): the buyer's money is on its way
    // back, so the seller's must not go out. Same class of refusal as a payment
    // already refunded or failed.
    if (
      payment.status === 'refunded' ||
      payment.status === 'refunding' ||
      payment.status === 'failed'
    ) {
      throw new PublicError('Payment cannot be paid out in its current state');
    }
    if (payment.status === 'paid_out' && !payment.checkout_id) return 'already_paid_out';
    if (payment.status !== 'paid' && payment.status !== 'payout_pending' && payment.status !== 'paid_out') {
      throw new PublicError('Order payment is not settled yet');
    }

    if (payment.checkout_id) {
      // CAS claim: exactly one caller may move a per-order payout out of
      // 'pending'. Without it a buyer's confirm_received racing an admin force
      // (or two webhook retries) both read 'pending', both transfer, and the
      // seller is paid twice for one order.
      const { data: claimed, error: claimErr } = await this.db
        .from('marketplace_orders')
        .update({ payout_status: 'paying' })
        .eq('id', orderId)
        .eq('payout_status', 'pending')
        // `*` rather than a column list: naming `payout_attempt` here would
        // fail the whole claim on a database whose (hand-applied) migration is
        // not in yet, and that would stop every cart payout.
        .select('*')
        .maybeSingle();
      if (claimErr) throw claimErr;
      if (!claimed) {
        const { data: current } = await this.db
          .from('marketplace_orders')
          .select('payout_status')
          .eq('id', orderId)
          .maybeSingle();
        if (current?.payout_status === 'paid_out') return 'already_paid_out';
        if (current?.payout_status === 'paying') return 'in_flight';
        // FIXED (G3 · H3): the refund path takes the SAME claim on this row and
        // holds it as 'refund_hold'. Payout and refund are now mutually
        // exclusive states on one row, so the buyer's money going back and the
        // seller's money going out can never both be in flight. Loudly refused
        // rather than silently reported as already paid out.
        if (current?.payout_status === 'refund_hold') {
          throw new PublicError('A refund is in progress for this order; payout is blocked');
        }
        // 'skipped' (or a missing order): nothing to pay out.
        return 'already_paid_out';
      }
      const orderRow = claimed as {
        seller_payout_kobo?: number | null;
        amount?: number | null;
        shipping_amount?: number | null;
        payout_attempt?: number | null;
      };
      // The attempt this payout is: bumped only by a failed/reversed transfer.
      const payoutAttempt = Math.max(0, Math.floor(Number(orderRow?.payout_attempt ?? 0)) || 0);
      const { data: profile } = await this.db
        .from('marketplace_seller_payout_profiles')
        .select('paystack_recipient_code, status')
        .eq('user_id', sellerId)
        .maybeSingle();
      if (!profile?.paystack_recipient_code || profile.status !== 'active') {
        await this.releaseOrderPayoutClaim(orderId, 'Seller payout profile is missing or inactive');
        throw new PublicError('Seller payout profile is missing or inactive');
      }
      const amountKobo = Number(
        orderRow?.seller_payout_kobo ??
          nairaToKobo(Number(orderRow?.amount || 0) + Number(orderRow?.shipping_amount || 0)),
      );
      // FIXED (H4c · a): the reference is deterministic, so it is known BEFORE
      // the transfer — write it while the money is still ours and CHECK the
      // write. supabase-js returns errors instead of throwing, so an unchecked
      // stamp (the H4b shape) silently did nothing when the column was absent,
      // which is exactly the state right after a deploy whose migration has not
      // been hand-applied yet: the order would sit at 'paying' with no
      // reference and no code, findable by no webhook, with the seller's money
      // already gone. Failing here costs nothing — nothing has moved yet.
      const payoutReference = orderPayoutReference(orderId, payoutAttempt);
      const { error: refErr } = await this.db
        .from('marketplace_orders')
        // `payout_attempt` is written back only when it is non-zero, and it can
        // only BE non-zero if the column exists (a webhook wrote it). On a
        // deploy whose migration is not hand-applied yet this is byte-for-byte
        // the old single-column write, so an unmigrated database degrades to
        // today's behaviour instead of failing every payout closed.
        .update(
          payoutAttempt > 0
            ? { payout_reference: payoutReference, payout_attempt: payoutAttempt }
            : { payout_reference: payoutReference },
        )
        .eq('id', orderId);
      if (refErr) {
        await this.releaseOrderPayoutClaim(
          orderId,
          `Could not record the payout reference: ${refErr.message || String(refErr)}`
        );
        throw refErr;
      }
      let transfer: Awaited<ReturnType<typeof initiatePaystackTransfer>>;
      try {
        // Deterministic reference: Paystack rejects a duplicate transfer
        // reference, so even a retry that somehow slips past the CAS cannot
        // move money a second time for this order.
        transfer = await initiatePaystackTransfer({
          amountKobo,
          recipientCode: profile.paystack_recipient_code,
          reference: payoutReference,
          reason: `Lantern marketplace order ${orderId}`,
        });
      } catch (err) {
        await this.releaseOrderPayoutClaim(
          orderId,
          err instanceof Error ? err.message : String(err)
        );
        throw err;
      }
      // FIXED (H4b · 1): the transfer result is no longer discarded. The code
      // and reference are stamped on the order row BEFORE it settles — exactly
      // as the single-order branch does on the payment row — so a later
      // transfer.failed / transfer.reversed webhook can find this order and put
      // it back when the money comes back, instead of leaving it 'paid_out'.
      //
      // FIXED (H4c · b): the money has ALREADY moved by this point, so a failed
      // stamp must never be thrown or retried — that would risk a second
      // transfer. Record it loudly and carry on: the reference written before
      // the transfer, plus the `paying` reference scan in
      // findOrderByPayoutTransfer, is what recovers this order by webhook.
      const { error: stampErr } = await this.db
        .from('marketplace_orders')
        .update({
          payout_transfer_code: transfer.transferCode,
          payout_reference: transfer.reference || payoutReference,
          payout_failed_reason: null,
        })
        .eq('id', orderId);
      if (stampErr) {
        logger.error('Payout transfer code could not be stamped on the order', {
          orderId,
          transferCode: transfer.transferCode,
          reference: transfer.reference || payoutReference,
          error: stampErr.message || String(stampErr),
        });
      }
      // Paystack usually answers 'pending' and confirms by webhook. Settling
      // only on a confirmed success is what makes the reversal path meaningful:
      // an order left at 'paying' is finished by the transfer.success handler,
      // which matches the code stamped above.
      if (transfer.status === 'success') {
        // Inline, straight after a transfer that worked: this must not 500 a
        // buyer's confirm-received (#108). The `transfer.success` webhook
        // settles it properly, and does throw.
        await this.finalizeOrderPayout(orderId, payment.checkout_id, payment.id, 'reconcile');
      }
      return 'transferred';
    }

    const { data: profile } = await this.db
      .from('marketplace_seller_payout_profiles')
      .select('paystack_recipient_code, status')
      .eq('user_id', sellerId)
      .maybeSingle();
    if (!profile?.paystack_recipient_code || profile.status !== 'active') {
      throw new PublicError('Seller payout profile is missing or inactive');
    }

    // FIXED (G3 · H11): ONE compare-and-set covers both entry states.
    //
    // The old code only CASed the `paid` -> `payout_pending` flip. A payment
    // that was ALREADY `payout_pending` with no transfer code — the window
    // between the flip and the stamp, or a previous attempt that died there —
    // walked straight past the claim, so a second caller transferred again,
    // Paystack rejected the duplicate reference, and that second caller's
    // rollback then wiped the FIRST caller's in-flight transfer code. The real
    // transfer settled later, `transfer.success` matched nothing, and the
    // payment sat at `paid` and refundable while the seller already had the
    // money.
    //
    // The claim is now `payout_transfer_code IS NULL` -> `claim:<reference>`,
    // conditional on the status being payable. Exactly one caller can take it;
    // the losers see a non-null code and read as `in_flight`. The marker is
    // never a real Paystack transfer code, so no webhook can match it, and it
    // is what every subsequent write in this branch filters on — a duplicate
    // attempt therefore cannot clobber the live one's tracking columns.
    let working = payment;
    const attempt = Math.max(0, Math.floor(Number(working.payout_attempt ?? 0)) || 0);
    const transferRef = orderPayoutReference(orderId, attempt);
    const claimMarker = `claim:${transferRef}`;
    const { data: locked, error: lockErr } = await this.db
      .from('marketplace_payments')
      .update({
        status: 'payout_pending',
        payout_transfer_code: claimMarker,
        updated_at: new Date().toISOString(),
      })
      .eq('id', working.id)
      .in('status', ['paid', 'payout_pending'])
      .is('payout_transfer_code', null)
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
      // refunded / refunding / failed / initialized: not ours to pay out.
      throw new PublicError('Payment cannot be paid out in its current state');
    }
    working = locked;

    try {
      const transfer = await initiatePaystackTransfer({
        // The seller is paid the item minus any platform commission. Legacy
        // rows (pre-split) fall back to the full item amount.
        amountKobo: Number(working.seller_payout_kobo ?? working.item_amount_kobo),
        recipientCode: profile.paystack_recipient_code,
        reference: transferRef,
        reason: `Lantern marketplace order ${orderId}`,
      });

      // MONEY ALREADY MOVED (#108): the transfer returned, so throwing here
      // would be a lie and a retry could send it twice. The cart branch's twin
      // of this write has been checked and logged since H4c; this one was
      // missed. Reported with the stable fingerprint instead, and the claim
      // marker is deliberately left in place so a later `transfer.success` can
      // still be reconciled by reference.
      reconcileLaterWrite(
        await this.db
          .from('marketplace_payments')
          .update({
            payout_transfer_code: transfer.transferCode,
            updated_at: new Date().toISOString(),
            metadata: {
              ...(working.metadata || {}),
              payoutReference: transfer.reference || transferRef,
            },
          })
          .eq('id', working.id)
          // Only the holder of this claim may stamp the real code (H11).
          .eq('payout_transfer_code', claimMarker),
        {
          table: 'marketplace_payments',
          op: 'update',
          paymentId: working.id,
          orderId,
          transferCode: transfer.transferCode,
          reference: transfer.reference || transferRef,
        },
      );

      if (transfer.status === 'success') {
        await this.markPaymentPaidOut(working.id, 'reconcile');
      }
    } catch (err) {
      // MONEY MAY ALREADY HAVE MOVED (#108): the transfer call threw, which
      // usually means it never reached Paystack — but a timeout after the
      // request landed looks identical from here. If this rollback fails, the
      // payment is wedged at `payout_pending` behind a claim marker no webhook
      // can match: the seller is never paid, and the buyer's refund is refused
      // with "Payout in progress". Reported, never thrown: the original
      // transfer error below is the one the caller needs.
      reconcileLaterWrite(
        await this.db
          .from('marketplace_payments')
          .update({
            status: 'paid',
            // The transfer never took: clear the in-flight code so the next
            // attempt is not mistaken for one already running (see finding 3).
            payout_transfer_code: null,
            payout_failed_reason: err instanceof Error ? err.message : String(err),
            updated_at: new Date().toISOString(),
          })
          .eq('id', working.id)
          .eq('status', 'payout_pending')
          // Conditional on THIS attempt's claim (H11): a rollback must never
          // release a transfer another caller has already stamped as live.
          .eq('payout_transfer_code', claimMarker),
        {
          table: 'marketplace_payments',
          op: 'update',
          paymentId: working.id,
          orderId,
          reason: 'payout_rollback',
        },
      );
      throw err;
    }

    return 'transferred';
  }

  /**
   * Give back a per-order payout claim after a failed attempt, leaving a
   * reason behind so a stuck payout is diagnosable rather than invisible.
   */
  private async releaseOrderPayoutClaim(orderId: string, reason: string): Promise<void> {
    // BEST EFFORT at ERROR level (#108). The `try/catch` this used to rely on
    // was dead code — a failed supabase-js write resolves — so the log it
    // promised never appeared.
    //
    // It must not throw: the caller is already on its way out with the error
    // that caused the release, and that is the one that matters. But it must be
    // LOUD, because the claim is a single slot with no expiry: an order left at
    // `paying` can never be claimed again (the CAS only moves `pending →
    // paying`), no transfer webhook is coming because no transfer was made, and
    // nothing sweeps it. The seller is simply never paid until a human or the
    // reconciliation job (#113) intervenes. No money is at risk — this runs
    // only where nothing moved.
    bestEffortWrite(
      await this.db
        .from('marketplace_orders')
        .update({ payout_status: 'pending', payout_failed_reason: reason.slice(0, 500) })
        .eq('id', orderId)
        .eq('payout_status', 'paying'),
      { table: 'marketplace_orders', op: 'update', orderId, reason: 'release_payout_claim' },
      'error',
    );
  }

  /**
   * Settle one unified-checkout order's payout and, when it was the last one
   * outstanding, the parent payment row.
   *
   * Extracted for H4b so the exact same roll-up runs whether the transfer came
   * back 'success' inline or was confirmed later by a transfer.success webhook.
   */
  private async finalizeOrderPayout(
    orderId: string,
    checkoutId: string | null,
    paymentId: string | null,
    mode: PayoutWriteFailureMode = 'throw'
  ): Promise<void> {
    // Guarded (M8, and load-bearing for H3): an order a reversal put back to
    // 'pending', or one a refund marked 'skipped', must not be re-settled as
    // paid_out by a late or replayed transfer.success.
    //
    // (#108) The CAS above is also what makes `'throw'` safe on the webhook
    // path: once this has succeeded it matches nothing, so a re-delivered
    // event cannot double-settle.
    const settleOrder = await this.db
      .from('marketplace_orders')
      .update({ payout_status: 'paid_out', payout_failed_reason: null })
      .eq('id', orderId)
      .in('payout_status', ['paying', 'pending']);
    const orderContext = {
      table: 'marketplace_orders' as const,
      op: 'update' as const,
      orderId,
      ...(checkoutId ? { checkoutId } : {}),
      ...(paymentId ? { paymentId } : {}),
    };
    if (mode === 'throw') mustWrite(settleOrder, orderContext);
    else reconcileLaterWrite(settleOrder, orderContext);
    if (!checkoutId) return;
    const { data: siblings } = await this.db
      .from('marketplace_orders')
      .select('id, status, payout_status')
      .eq('checkout_id', checkoutId);
    const remaining = (siblings || []).filter(
      (row: { status: string; payout_status: string }) =>
        !['cancelled', 'completed'].includes(row.status) || row.payout_status !== 'paid_out',
    );
    const unfinished = (siblings || []).filter(
      (row: { status: string; payout_status: string }) =>
        row.status !== 'cancelled' && row.payout_status !== 'paid_out',
    );
    if (paymentId && (unfinished.length === 0 || remaining.length === 0)) {
      // The roll-up inherits its caller's mode: a webhook wants the retry, an
      // inline call after a successful transfer must not 500 the buyer.
      await this.markPaymentPaidOut(paymentId, mode);
    }
  }

  /**
   * Find the unified-checkout order a transfer webhook is about. Two exact
   * matches, never an interpolated `.or()` string: the transfer_code and the
   * reference both come from Paystack's payload and a comma or a dot-operator
   * inside one would rewrite a PostgREST `or` filter.
   */
  private async findOrderByPayoutTransfer(
    transferCode: string,
    reference: string
  ): Promise<{ id: string; checkout_id: string | null; payment_id: string | null } | null> {
    // Deliberately NOT selecting `payout_attempt`: a select naming a column the
    // database does not have yet (migration not hand-applied) fails the whole
    // query, and this is the lookup every transfer webhook depends on. The
    // attempt is read separately, where its absence costs nothing.
    const columns = 'id, checkout_id, payment_id';
    if (transferCode) {
      const { data } = await this.db
        .from('marketplace_orders')
        .select(columns)
        .eq('payout_transfer_code', transferCode)
        .maybeSingle();
      if (data) return data as { id: string; checkout_id: string | null; payment_id: string | null };
    }
    if (reference) {
      const { data } = await this.db
        .from('marketplace_orders')
        .select(columns)
        .eq('payout_reference', reference)
        .maybeSingle();
      if (data) return data as { id: string; checkout_id: string | null; payment_id: string | null };
    }
    // FIXED (H4c · 2): last-resort recovery for an order whose code/reference
    // never made it onto the row — the stamp failed, or the columns do not
    // exist yet because the migration has not been hand-applied. The payout
    // reference is derived from the order id, so the id can be recovered from
    // the reference alone. Bounded scan over orders still claimed as 'paying':
    // that set is only ever the payouts currently in flight.
    if (reference) {
      const { data: inFlight } = await this.db
        .from('marketplace_orders')
        .select(columns)
        .eq('payout_status', 'paying')
        .limit(500);
      // The reference is derived from (order id, attempt), and the attempt of
      // the row is not readable here on an unmigrated database, so every
      // attempt up to a small bound is tried. Bounded twice over: the candidate
      // set is only the payouts currently in flight, and the attempt range is
      // fixed (H1).
      const match = ((inFlight || []) as Array<{ id: string }>).find((row) => {
        if (!row?.id) return false;
        for (let attempt = 0; attempt <= MAX_PAYOUT_ATTEMPT_SCAN; attempt++) {
          if (orderPayoutReference(row.id, attempt) === reference) return true;
        }
        return false;
      });
      if (match) {
        logger.warn('Recovered a payout order by reference scan; its transfer stamp is missing', {
          orderId: match.id,
          reference,
        });
        return match as { id: string; checkout_id: string | null; payment_id: string | null };
      }
    }
    return null;
  }

  /**
   * After buyer confirms receipt: transfer seller_payout_kobo (item minus the
   * platform commission) to the seller; Lantern keeps platform_fee_kobo.
   */
  async payoutOnConfirmReceived(orderId: string, buyerId: string) {
    const order = await this.orders.getOrderById(orderId, buyerId);
    if (!order) throw new PublicError('Order not found');
    if (order.buyer_id !== buyerId) throw new PublicError('Only the buyer can confirm receipt');

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
    if (!order) throw new PublicError('Order not found');
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

  async markPaymentPaidOut(
    paymentId: string,
    mode: PayoutWriteFailureMode = 'throw'
  ): Promise<void> {
    const now = new Date().toISOString();
    // (#108) Same two callers, same reasoning as `finalizeOrderPayout`. The
    // `.in(status, …)` filter is what makes a re-delivered webhook a no-op, and
    // therefore what makes `'throw'` safe.
    const settle = await this.db
      .from('marketplace_payments')
      .update({
        status: 'paid_out',
        payout_at: now,
        updated_at: now,
      })
      .eq('id', paymentId)
      .in('status', ['payout_pending', 'paid']);
    const context = { table: 'marketplace_payments' as const, op: 'update' as const, paymentId };
    if (mode === 'throw') mustWrite(settle, context);
    else reconcileLaterWrite(settle, context);
  }

  // --- Refunds ---------------------------------------------------------------
  // A refund is only auto-issued while Lantern still holds the money. The
  // payment row's own `paid_out` blocks the single-order case; for unified
  // checkout the per-order `payout_status` is checked as well, because the
  // payment row legitimately stays `paid` while a sibling order is open. That
  // second check is what stops a cart holding a digital item and a physical one
  // from refunding the digital order whose seller already has the money.
  // A cart refund is for this order's share only, not the whole charge.

  async refundPaymentForOrder(orderId: string, actorId: string, isAdmin = false) {
    const order = await this.orders.getOrderById(orderId, actorId);
    if (!order) throw new PublicError('Order not found');
    if (!isAdmin && order.buyer_id !== actorId && order.seller_id !== actorId) {
      throw new PublicError('Unauthorized');
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
    if (payment.status === 'refunding') {
      // Someone else holds the refund claim (H2).
      throw new PublicError('A refund for this payment is already in progress');
    }
    if (payment.status === 'paid_out') {
      throw new PublicError('Cannot auto-refund after seller payout; contact support');
    }
    // FIXED (G3 · H4): a single-order payment at 'payout_pending' is refused
    // UNCONDITIONALLY, not only when a transfer code has already been stamped.
    // The old guard left the claim-to-stamp window open — roughly the duration
    // of the Paystack transfer call — and a refund landing inside it paid the
    // buyer back while the transfer went on to succeed. Nothing is lost by
    // refusing: transfer.success makes it paid_out (refund correctly refuses
    // for good), transfer.failed / .reversed puts it back to 'paid' (refund
    // then correctly proceeds).
    if (payment.status === 'payout_pending') {
      throw new PublicError('Payout in progress — retry after it settles');
    }
    if (payment.status !== 'paid' && payment.status !== 'initialized') {
      throw new PublicError('Payment cannot be refunded');
    }

    if (payment.status === 'initialized') {
      // Nothing was ever captured: no Paystack call, no claim to take.
      //
      // MUST SUCCEED (#108): precisely because nothing external has happened,
      // stopping costs nothing — and leaving the row `initialized` lets a late
      // charge.success against its reference settle an order the buyer has
      // just cancelled.
      mustWrite(
        await this.db
          .from('marketplace_payments')
          .update({ status: 'failed', updated_at: new Date().toISOString() })
          .eq('id', payment.id)
          .eq('status', 'initialized'),
        {
          table: 'marketplace_payments',
          op: 'update',
          paymentId: payment.id,
          orderId,
          reason: 'void_uncharged_payment',
        },
      );
      return;
    }

    // FIXED (G3 · H3): unified checkout pays each order out separately, so the
    // payment row stays 'paid' while a sibling order is open and the per-order
    // `payout_status` is the only truthful answer to "has this seller already
    // been paid?". Reading it was a read-then-act race: the refund read
    // 'pending', the payout job then CASed pending -> paying and transferred,
    // and the refund paid the buyer anyway — money out twice. The refund now
    // takes the SAME claim on the SAME row, in a state the payout CAS cannot
    // enter: 'refund_hold'. Payout blocks refund, refund blocks payout.
    let orderHeld = false;
    if (payment.checkout_id) {
      const { data: held, error: holdErr } = await this.db
        .from('marketplace_orders')
        .update({ payout_status: 'refund_hold' })
        .eq('id', orderId)
        .eq('payout_status', 'pending')
        .select('id')
        .maybeSingle();
      if (holdErr) throw holdErr;
      if (held) {
        orderHeld = true;
      } else {
        const { data: current } = await this.db
          .from('marketplace_orders')
          .select('payout_status')
          .eq('id', orderId)
          .maybeSingle();
        const status = (current as { payout_status?: string } | null)?.payout_status;
        if (status === 'paid_out' || status === 'paying') {
          throw new PublicError('Cannot auto-refund after seller payout; contact support');
        }
        if (status === 'refund_hold') {
          throw new PublicError('A refund for this order is already in progress');
        }
        // 'skipped' — this order never pays out, so there is nothing to hold.
      }
    }

    // FIXED (G3 · H2): claim the payment before calling Paystack. Both a
    // double-tapped cancel and a buyer-cancel racing an admin-refund used to
    // read 'paid', both POST /refund, and the buyer was refunded twice —
    // `services/paystack.ts` sends no idempotency key of its own, so Paystack
    // does not catch it either. Exactly one caller flips paid -> refunding.
    //
    // For a cart this claim is deliberately coarse: it is one row covering
    // several orders, so two SIBLING refunds running at the same instant
    // serialise — the loser is refused and succeeds on a retry, because the
    // winner releases the row back to 'paid' while any sibling is still open.
    // Refusing a concurrent sibling is the safe direction; the alternative is a
    // partial-refund race on one charge.
    const { data: claimedPayment, error: claimErr } = await this.db
      .from('marketplace_payments')
      .update({ status: 'refunding', updated_at: new Date().toISOString() })
      .eq('id', payment.id)
      .eq('status', 'paid')
      .select('id')
      .maybeSingle();
    if (claimErr) {
      await this.releaseRefundHold(orderId, orderHeld);
      throw claimErr;
    }
    if (!claimedPayment) {
      await this.releaseRefundHold(orderId, orderHeld);
      throw new PublicError('A refund for this payment is already in progress');
    }

    const txRef = payment.paystack_transaction_id || payment.paystack_reference;
    const orderShareKobo = nairaToKobo(
      Number(order.amount || 0) + Number((order as { shipping_amount?: number }).shipping_amount || 0),
    );
    const amountKobo = payment.checkout_id ? orderShareKobo : Number(payment.total_charged_kobo);
    let refund: Awaited<ReturnType<typeof refundPaystackTransaction>>;
    try {
      refund = await refundPaystackTransaction({
        transactionIdOrReference: txRef,
        amountKobo,
      });
    } catch (err) {
      // Nothing moved: give both claims back so a corrected retry can run.
      //
      // (#108) Unless it did — a Paystack call that throws on a timeout may
      // still have been accepted. Either way a failed release wedges the row at
      // `refunding`, which refuses every later refund and blocks the payout, so
      // this is reported and never thrown: the caller needs the refund error.
      reconcileLaterWrite(
        await this.db
          .from('marketplace_payments')
          .update({ status: 'paid', updated_at: new Date().toISOString() })
          .eq('id', payment.id)
          .eq('status', 'refunding'),
        {
          table: 'marketplace_payments',
          op: 'update',
          paymentId: payment.id,
          orderId,
          reason: 'refund_rollback',
        },
      );
      await this.releaseRefundHold(orderId, orderHeld);
      throw err;
    }

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
      // MONEY ALREADY MOVED (#108): Paystack has paid the buyer back. Throwing
      // would tell them their refund failed when it did not, and the retry is
      // refused anyway because this claim is still held. Reported with the
      // stable fingerprint; the row is left at `refunding` for reconciliation
      // (#113).
      reconcileLaterWrite(
        await this.db
          .from('marketplace_payments')
          .update({
            status: 'refunded',
            refund_reference: String(refund.id),
            updated_at: new Date().toISOString(),
          })
          .eq('id', payment.id)
          .eq('status', 'refunding'),
        {
          table: 'marketplace_payments',
          op: 'update',
          paymentId: payment.id,
          orderId,
          refundReference: String(refund.id),
          amountKobo,
        },
      );
    } else {
      // A sibling order is still open, so the charge as a whole is not
      // refunded: release the claim back to 'paid', exactly where the
      // pre-claim code left the row. `refund_reference` is deliberately not
      // written — it names ONE refund, and a cart can produce several.
      //
      // MONEY ALREADY MOVED (#108): this order's share is back with the buyer.
      // A failed release wedges the whole cart's payment at `refunding`, which
      // blocks every sibling refund and the payout — loud, but not the buyer's
      // problem to be told about.
      reconcileLaterWrite(
        await this.db
          .from('marketplace_payments')
          .update({ status: 'paid', updated_at: new Date().toISOString() })
          .eq('id', payment.id)
          .eq('status', 'refunding'),
        {
          table: 'marketplace_payments',
          op: 'update',
          paymentId: payment.id,
          orderId,
          checkoutId: payment.checkout_id,
          reason: 'release_claim_sibling_open',
        },
      );
    }

    if (orderHeld) {
      // The buyer has their money back, so this order must never pay out.
      // 'skipped' is the payout machine's terminal "not payable" state, and it
      // is what stops a late transfer.success from settling it (finalizeOrderPayout).
      //
      // MONEY ALREADY MOVED (#108). A failure here leaves the order at
      // `refund_hold`, which still BLOCKS the payout — the safe direction — but
      // never releases, so it needs a human eventually rather than a throw now.
      reconcileLaterWrite(
        await this.db
          .from('marketplace_orders')
          .update({ payout_status: 'skipped', payout_failed_reason: 'refunded' })
          .eq('id', orderId)
          .eq('payout_status', 'refund_hold'),
        {
          table: 'marketplace_orders',
          op: 'update',
          orderId,
          paymentId: payment.id,
          reason: 'refunded_order_not_payable',
        },
      );
    }
  }

  /**
   * The order's payout attempt counter, or 0 when it cannot be read — the
   * column is added by a hand-applied migration, and a webhook must still
   * un-settle a reversed payout on a database that has not had it yet.
   */
  private async readOrderPayoutAttempt(orderId: string): Promise<number> {
    try {
      const { data } = await this.db
        .from('marketplace_orders')
        .select('*')
        .eq('id', orderId)
        .maybeSingle();
      const raw = Number((data as any)?.payout_attempt ?? 0);
      return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
    } catch {
      return 0;
    }
  }

  /** Give a refund hold back to the payout machine when the refund did not happen. */
  private async releaseRefundHold(orderId: string, held: boolean): Promise<void> {
    if (!held) return;
    // BEST EFFORT at ERROR level (#108), same dead-`catch` story as
    // `releaseOrderPayoutClaim`, and a worse stuck state: an order left at
    // `refund_hold` refuses the payout AND every later refund ("A refund for
    // this order is already in progress"), with no expiry and nothing to
    // release it. Never thrown, because the caller is carrying the refund error
    // that caused this release.
    bestEffortWrite(
      await this.db
        .from('marketplace_orders')
        .update({ payout_status: 'pending' })
        .eq('id', orderId)
        .eq('payout_status', 'refund_hold'),
      { table: 'marketplace_orders', op: 'update', orderId, reason: 'release_refund_hold' },
      'error',
    );
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
    // BEST EFFORT at ERROR level (#108). Best-effort because a failed stamp must
    // never break the webhook — but at error level, because together with the
    // Sentry event above this row IS the only trace that money was captured
    // without settling an order, and it is the durable half. The `try/catch`
    // that used to guard it was dead code.
    bestEffortWrite(
      await this.db
        .from('marketplace_payments')
        .update({
          metadata: {
            ...(payment.metadata || {}),
            settlement_mismatch: { ...details, at: new Date().toISOString() },
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', payment.id),
      {
        table: 'marketplace_payments',
        op: 'update',
        paymentId: payment.id,
        orderId: payment.order_id,
        source: details.source,
      },
      'error',
    );
  }

  // --- Paystack webhook ------------------------------------------------------
  // Signature first (HMAC SHA512 over the RAW body — the route must not have
  // parsed it), then the two-phase dedupe claim, then the side effects, then
  // the `processed_at` stamp. Handled events: charge.success, transfer.success,
  // transfer.failed, transfer.reversed.
  //
  // Dedupe is DB-backed on the `paystack_webhook_events.event_key` UNIQUE
  // index, so it is replica-safe on Render; an in-memory set would let a second
  // instance re-run the same event. `event_key` is `<event>:<data.id>`, falling
  // back to the reference / transfer code, and finally to a hash of the raw
  // body.

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

    // Two-phase dedupe. The claim row is written with processed_at NULL and is
    // only stamped once processing succeeds. Stamping on insert (the old
    // behaviour) meant a throw mid-processing turned every Paystack retry into
    // a silent "duplicate" no-op — a paid order that never settles.
    const { error: dedupeErr } = await this.db.from('paystack_webhook_events').insert({
      event_key: eventKey,
      event_type: eventType,
      payload_hash: createHash('sha256').update(String(rawBody)).digest('hex'),
      processed_at: null,
    });
    if (dedupeErr) {
      if (String(dedupeErr.code) === '23505' || /duplicate/i.test(dedupeErr.message || '')) {
        const { data: existing } = await this.db
          .from('paystack_webhook_events')
          .select('event_key, processed_at')
          .eq('event_key', eventKey)
          .maybeSingle();
        // Only a completed event is a true duplicate. An unfinished claim is a
        // previous attempt that died; re-process it.
        if (existing?.processed_at) {
          return { ok: true, duplicate: true };
        }
      } else {
        throw dedupeErr;
      }
    }

    await this.processWebhookEvent(eventType, data, rawBody);

    // BEST EFFORT (#108), and deliberately so despite living on the webhook
    // path. An unstamped claim makes the NEXT Paystack retry re-process the
    // event, which every branch of `processWebhookEvent` is built to survive,
    // so the failure direction is safe. The cost is repeated work until the
    // retries stop, not a wrong state — and answering non-2xx here would
    // guarantee that repeat instead of merely risking it.
    bestEffortWrite(
      await this.db
        .from('paystack_webhook_events')
        .update({ processed_at: new Date().toISOString() })
        .eq('event_key', eventKey),
      { table: 'paystack_webhook_events', op: 'update', eventKey, eventType },
    );

    return { ok: true, duplicate: false, eventType };
  }

  /**
   * The side-effecting half of the webhook, split out so the dedupe row can be
   * stamped only after it returns. Every path here must be safe to re-run.
   */
  private async processWebhookEvent(
    eventType: string,
    data: Record<string, any>,
    rawBody: string | Buffer
  ): Promise<void> {
    void rawBody;
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
      // Two exact-match lookups. A PostgREST .or() string interpolated from
      // webhook-controlled fields is a filter-injection hole: a transfer_code
      // containing a comma or a dot-operator rewrites the query.
      let row: Record<string, any> | null = null;
      if (transferCode) {
        const { data: byCode } = await this.db
          .from('marketplace_payments')
          .select('*')
          .eq('payout_transfer_code', transferCode)
          .maybeSingle();
        row = byCode || null;
      }
      // FIXED (H4b · 2): the fallback used to match against `paystack_reference`,
      // which holds the CHARGE reference — a transfer reference never equals it,
      // so a transfer.success carrying no transfer_code found nothing and the
      // payment was never marked paid_out. The payout reference is the one
      // written alongside the transfer code, in `metadata.payoutReference`; match
      // that JSON field directly (a typed PostgREST `eq`, not an `.or()` string
      // built from webhook-controlled text).
      if (!row && reference) {
        const { data: byPayoutRef } = await this.db
          .from('marketplace_payments')
          .select('*')
          .eq('metadata->>payoutReference', reference)
          .maybeSingle();
        row = byPayoutRef || null;
      }
      if (row) {
        await this.markPaymentPaidOut(row.id);
      } else {
        // A unified-checkout payout settles on the ORDER row, not the payment:
        // the code/reference stamped by the cart branch above is what matches.
        const order = await this.findOrderByPayoutTransfer(transferCode, reference);
        if (order) {
          await this.finalizeOrderPayout(order.id, order.checkout_id, order.payment_id);
        }
      }
    } else if (eventType === 'transfer.failed' || eventType === 'transfer.reversed') {
      const transferCode = String(data.transfer_code || '');
      const reference = String(data.reference || '');
      // FIXED (H4b · 1): a cart payout records its transfer on the ORDER row, so
      // a reversal has to unwind there too. Without this an order that had
      // already reached 'paid_out' stayed 'paid_out' after Paystack sent the
      // money back — the seller reads as paid for cash that is no longer theirs.
      // Both 'paying' and 'paid_out' go back to 'pending' so the payout can be
      // retried once the cause is fixed.
      if (transferCode || reference) {
        const order = await this.findOrderByPayoutTransfer(transferCode, reference);
        if (order) {
          // FIXED (G3 · H1): Paystack has burnt this attempt's reference, so the
          // retry this reset exists to allow must use a NEW one. The attempt
          // counter is bumped here and nowhere else, under the same CAS that
          // un-settles the row, so a replayed webhook cannot bump it twice.
          const nextAttempt = (await this.readOrderPayoutAttempt(order.id)) + 1;
          const { error: unwindErr } = await this.db
            .from('marketplace_orders')
            .update({
              payout_status: 'pending',
              payout_transfer_code: null,
              payout_reference: null,
              payout_attempt: nextAttempt,
              payout_failed_reason: `paystack_${eventType}`,
              updated_at: new Date().toISOString(),
            })
            .eq('id', order.id)
            .in('payout_status', ['paying', 'paid_out']);
          if (unwindErr) {
            // Most likely the `payout_attempt` column is not there yet (its
            // migration is hand-applied). The un-settle matters more than the
            // counter, so retry without it rather than leave returned money
            // reading as paid.
            logger.error('Payout unwind with attempt bump failed; retrying without it', {
              orderId: order.id,
              error: unwindErr.message || String(unwindErr),
            });
            await this.db
              .from('marketplace_orders')
              .update({
                payout_status: 'pending',
                payout_transfer_code: null,
                payout_reference: null,
                payout_failed_reason: `paystack_${eventType}`,
                updated_at: new Date().toISOString(),
              })
              .eq('id', order.id)
              .in('payout_status', ['paying', 'paid_out']);
          }
        }
      }
      if (transferCode) {
        // Clearing payout_transfer_code matters as much as the status: the
        // payout path treats 'payout_pending' + a transfer code as a transfer
        // still in flight, so leaving the dead code behind wedges the payment
        // at 'in_flight' forever and the seller is never paid.
        //
        // FIXED (G3 · H10): 'paid_out' is unwound too. An inline
        // `transfer.status === 'success'` marks the payment paid_out before any
        // webhook arrives, so a reversal guarded on 'payout_pending' alone
        // matched nothing: the seller read as paid for money Paystack had taken
        // back, and the buyer's refund was then refused as "after seller
        // payout". `payout_at` is cleared with it — a paid_out timestamp left
        // behind is the same lie in a different column.
        const reset = {
          status: 'paid',
          payout_transfer_code: null,
          payout_at: null,
          payout_failed_reason: `paystack_${eventType}`,
          updated_at: new Date().toISOString(),
        };
        // The payment row needs the same attempt bump as the order row (H1),
        // or its retry reuses the reference Paystack has just burnt.
        const { data: payRow } = await this.db
          .from('marketplace_payments')
          .select('*')
          .eq('payout_transfer_code', transferCode)
          .maybeSingle();
        const nextAttempt =
          Math.max(0, Math.floor(Number((payRow as any)?.payout_attempt ?? 0)) || 0) + 1;
        const { error: resetErr } = await this.db
          .from('marketplace_payments')
          .update({ ...reset, payout_attempt: nextAttempt })
          .eq('payout_transfer_code', transferCode)
          .in('status', ['payout_pending', 'paid_out']);
        if (resetErr) {
          logger.error('Payment payout reset with attempt bump failed; retrying without it', {
            transferCode,
            error: resetErr.message || String(resetErr),
          });
          await this.db
            .from('marketplace_payments')
            .update(reset)
            .eq('payout_transfer_code', transferCode)
            .in('status', ['payout_pending', 'paid_out']);
        }
      }
    }
  }
}

let paymentsSingleton: MarketplacePaymentsService | null = null;

export function getMarketplacePaymentsService(host: MarketplaceServiceHost): MarketplacePaymentsService {
  if (!paymentsSingleton) {
    paymentsSingleton = new MarketplacePaymentsService(host);
  }
  return paymentsSingleton;
}
