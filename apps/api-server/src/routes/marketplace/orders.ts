/**
 * Orders: the lifecycle after a listing is bought.
 *
 * Buy-now and the legacy `/transactions` creation path, reading your orders as
 * buyer or seller, amending the shared meeting details, and driving status
 * transitions (confirm, ship, confirm_received, dispute) through the single
 * `action` field on PATCH /orders/:id. Disputes have no routes of their own —
 * they are a status on the order, and the reason/category the buyer types here
 * is what the admin console later reads.
 *
 * Authorisation on every route in this group is the party-to-the-order test:
 * `getOrderById(id, userId)` throws unless the caller is the buyer or the
 * seller. PATCH /orders/:id additionally splits by role for the fields that
 * belong to one side, and (F7b) carries `idempotencyMiddleware` like its money
 * siblings so a retried action is replayed rather than re-applied.
 */
import { Router } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { authMiddleware } from '../../middleware/auth';
import { clientErrorMessage, PublicError } from '../../utils/safeError';
import { getMarketplaceOrdersService, invalidateSellerAnalyticsCache } from '../../services/marketplaceOrders';
import { invalidateListingCaches } from '../../utils/marketplaceCache';
import { normalizeIdempotencyKey, withIdempotency } from '../../services/idempotency';
import { idempotencyMiddleware, type IdempotentRequest } from '../../middleware/idempotency';
import { FULFILLMENT_MODES, cacheService, dataLayer, requestContentHash } from './context';
import { respondMarketplaceClientError, respondMarketplaceError } from './errors';
import { mustWrite } from '../../services/data/writeResult';
const router = Router();

/**
 * One operation name for PATCH /orders/:id, shared by the middleware (which
 * owns the client-supplied-header case) and the handler (which owns the
 * version-aware fallback key). They must agree: the replay store is keyed
 * (user_id, operation, key).
 */
const ORDER_ACTION_OPERATION = 'marketplace_order_action';
// POST /api/v1/marketplace/listings/:id/buy-now - Instant purchase (Paystack when enabled)
router.post(
  '/listings/:id/buy-now',
  authMiddleware,
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

    // Fallback key when the client sends no Idempotency-Key. It must be derived
    // from the REQUEST CONTENT: a bare time bucket collides across different
    // requests in the same window, handing the second buyer the first one's
    // cached checkout (wrong listing, wrong amount). The bucket is kept only so
    // a deliberate repeat purchase later is still possible.
    const idempotencyKey =
      normalizeIdempotencyKey(req.headers['idempotency-key']) ||
      `${buyerId}:buy_now:${requestContentHash({
        listingId: String(id),
        quantity,
        couponCode: typeof req.body?.couponCode === 'string' ? req.body.couponCode : null,
      })}:${Math.floor(Date.now() / 300_000)}`;

    const { marketplacePaystackEnabled, getMarketplacePaymentsService } = await import(
      '../../services/marketplacePayments'
    );

    try {
      const result = await withIdempotency(
        dataLayer.getClient(),
        buyerId,
        'marketplace_buy_now',
        idempotencyKey,
        async () => {
          if (marketplacePaystackEnabled()) {
            const email =
              (typeof req.user?.email === 'string' && req.user.email) ||
              (await dataLayer.users.getAuthUserEmail(buyerId)) ||
              '';
            if (!email) {
              // R5a: explicit PublicError — this is the buyer's problem to fix.
              throw new PublicError('A verified email is required for Paystack checkout');
            }
            return getMarketplacePaymentsService(dataLayer).createBuyNowCheckoutSession({
              listingId: id,
              buyerId,
              buyerEmail: email,
              couponCode: req.body?.couponCode,
              quantity,
            });
          }
          return dataLayer.marketplace.buyMarketplaceListingNow(
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

// POST /api/v1/marketplace/transactions - Legacy; use orders flow instead
router.post(
  '/transactions',
  authMiddleware,
  asyncHandler(async (_req: any, res: any) => {
    res.status(400).json({
      success: false,
      error: 'Use POST /listings/:id/buy-now or the orders API instead.',
    });
  })
);

router.get(
  '/orders',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = req.user.id;
    const role = req.query.role === 'seller' ? 'seller' : 'buyer';
    const orders = await getMarketplaceOrdersService(dataLayer).getOrdersForUser(
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
    const order = await getMarketplaceOrdersService(dataLayer).getOrderForInquiry(
      req.params.inquiryId,
      req.user.id
    );
    res.json({ success: true, data: order });
  })
);

// FIXED (F7b): the catch-all pattern on the order and payment routes. This
// handler and the seven below it used to end in a bare
// `catch (err) { res.status(400|403)…clientErrorMessage(err) }`, which swallowed
// EVERY failure into a client error — a Postgres outage, a PostgREST embed error
// (PGRST201), a TypeError in a service or a failed Paystack verify were all
// reported to the buyer as their own mistake, and because the response was a 4xx
// none of them reached 5xx alerting. The worst case was the money path: a buyer
// whose `POST /payments/:reference/verify` 500s was shown a plain 400 and told to
// try again on a charge that may already have succeeded.
//
// All eight now go through `respondMarketplaceError(res, err, <that route's old
// status>)`, which surfaces real client errors unchanged and returns false for
// anything internal so the handler rethrows and asyncHandler hands it to the
// global errorHandler. The sites: GET /orders/:id (403), PATCH /orders/:id,
// POST /orders/:id/payment-link, POST /payments/:reference/verify,
// POST /orders/:id/checkout, POST /seller/payout-profile, GET /seller/banks,
// POST /orders/:id/payment-proof (400 each).
router.get(
  '/orders/:id',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    try {
      const order = await getMarketplaceOrdersService(dataLayer).getOrderById(
        req.params.id,
        req.user.id
      );
      if (!order) {
        return res.status(404).json({ success: false, error: 'Order not found' });
      }
      res.json({ success: true, data: order });
    } catch (err: any) {
      if (!respondMarketplaceError(res, err, 403)) throw err;
    }
  })
);

// PATCH /api/v1/marketplace/orders/:id — the single status-transition endpoint.
// `action` selects the transition (confirm, ship, confirm_received, dispute, …)
// and is interpreted by `marketplaceOrders.updateOrderStatus`; the optional
// meetingLocation / sellerNote / fulfillmentMode fields are written here first,
// under the role split below.
//
// FIXED (R5a, F7b deferral b): this route carried no `idempotencyMiddleware`,
// unlike its money-path siblings. The `confirm_received` action releases the
// seller payout, and two concurrent confirms are exactly the window the
// double-payout race in services/marketplacePayments.ts needs.
//
// It now uses the same H4 wiring as POST /orders/:id/payment-link and
// POST /orders/:id/checkout: the client's `Idempotency-Key` header wins, and
// the fallback is derived from the REQUEST CONTENT (order id, action and every
// field this handler writes) plus a 5-minute bucket — never the bucket alone,
// which would let two different actions on the same order inside one window
// share a key and serve the second the first one's response.
//
// FIXED (G3 · H0b): content + bucket is still not enough, because an order's
// fields are RE-SETTABLE. Buyer sets the meeting point to "Library", the seller
// changes it to "Gate 3", the buyer re-sets "Library" two minutes later: same
// body, same bucket, same key — the DB write was skipped and the buyer was told
// it worked. The key material now includes the order's own `updated_at` (its
// monotonic version), so the same body after ANY state change is a new key and
// a genuine re-set always executes, while a true double-submit — same body,
// same version — still replays. That value is only known after the order is
// read, so the fallback key is derived HERE rather than in the middleware
// (`fallbackKey` is synchronous and runs before any DB read); the middleware
// still owns the client-supplied-header case.
//
// A replayed response is marked `idempotentReplay: true` with
// `code: 'IDEMPOTENT_REPLAY'`, so a client can tell "your request was applied
// just now" from "this is the answer to a request you already made".
//
// Only the mutation is wrapped. The validation refusals above it (missing
// action, wrong role, bad fulfillmentMode, unknown order) run before the claim,
// so a rejected request never burns a key and a corrected retry is not replayed
// the rejection.
//
// FIXED (F7b): see the catch-all comment above GET /orders/:id — the `catch` at
// the end of this handler no longer reports a server fault as a 400.
router.patch(
  '/orders/:id',
  authMiddleware,
  idempotencyMiddleware({
    operation: ORDER_ACTION_OPERATION,
    // No synchronous fallback: the honest key needs the order's current
    // version, which is a DB read away (H0b). The handler derives it.
    fallbackKey: () => null,
  }),
  asyncHandler(async (req: any, res: any) => {
    const { action, meetingLocation, sellerNote, fulfillmentMode } = req.body;
    if (!action) {
      return res.status(400).json({ success: false, error: 'action is required' });
    }

    try {
      const ordersService = getMarketplaceOrdersService(dataLayer);
      const existingOrder = await ordersService.getOrderById(req.params.id, req.user.id);
      if (!existingOrder) {
        return res.status(404).json({ success: false, error: 'Order not found or access denied' });
      }

      // Field-level authorisation. Membership of the order is not enough: the
      // seller's note and the fulfilment mode are the seller's to set, and a
      // buyer who could rewrite them could change where and how they collect
      // after the fact. The meeting location stays shared — both parties
      // negotiate it.
      const isSeller = existingOrder.seller_id === req.user.id;
      const isBuyer = existingOrder.buyer_id === req.user.id;

      if ((sellerNote != null || fulfillmentMode != null) && !isSeller) {
        return res.status(403).json({
          success: false,
          error: 'Only the seller can set the seller note or fulfillment mode',
        });
      }
      if (fulfillmentMode != null && !FULFILLMENT_MODES.includes(fulfillmentMode)) {
        return res.status(400).json({
          success: false,
          error: `fulfillmentMode must be one of: ${FULFILLMENT_MODES.join(', ')}`,
        });
      }
      if (meetingLocation != null && !isSeller && !isBuyer) {
        return res.status(403).json({ success: false, error: 'Not a party to this order' });
      }

      const fieldUpdates = {
        ...(meetingLocation ? { meeting_location: meetingLocation } : {}),
        ...(isSeller && sellerNote ? { seller_note: sellerNote } : {}),
        ...(isSeller && fulfillmentMode ? { fulfillment_mode: fulfillmentMode } : {}),
      };
      // H0b: the order's own version goes into the key material. `updated_at`
      // moves on every write to the row; `status` is the coarse fallback for a
      // row that somehow carries no timestamp, so a state transition still
      // produces a new key.
      const body = (req.body || {}) as Record<string, unknown>;
      const derivedKey = `${req.user.id}:order_action:${requestContentHash({
        orderId: String(req.params.id),
        version:
          (existingOrder as { updated_at?: string | null }).updated_at ||
          existingOrder.status ||
          null,
        action: typeof body.action === 'string' ? body.action : null,
        meetingLocation: typeof body.meetingLocation === 'string' ? body.meetingLocation : null,
        sellerNote: typeof body.sellerNote === 'string' ? body.sellerNote : null,
        fulfillmentMode: typeof body.fulfillmentMode === 'string' ? body.fulfillmentMode : null,
        disputeReason: typeof body.disputeReason === 'string' ? body.disputeReason : null,
        disputeCategory: typeof body.disputeCategory === 'string' ? body.disputeCategory : null,
        trackingNumber: typeof body.trackingNumber === 'string' ? body.trackingNumber : null,
        trackingUrl: typeof body.trackingUrl === 'string' ? body.trackingUrl : null,
      })}:${Math.floor(Date.now() / 300_000)}`;
      const headerKey = normalizeIdempotencyKey(req.headers['idempotency-key']);

      // `ran` is how a replay is recognised: the handler body only runs for the
      // caller that holds the claim, so a response that comes back without it
      // having run is a recorded one.
      let ran = false;
      const claim = async <T extends Record<string, unknown>>(work: () => Promise<T>) =>
        headerKey
          ? // The client chose the key: the middleware already resolved it, and
            // its store client is the same Supabase client `supabaseService`
            // hands out (server.ts:211).
            (req as IdempotentRequest).runIdempotent!(work)
          : withIdempotency(
              dataLayer.getClient(),
              req.user.id,
              ORDER_ACTION_OPERATION,
              derivedKey,
              work
            );
      const replayed = await claim(async () => {
        ran = true;
        if (Object.keys(fieldUpdates).length > 0) {
          // Two exact filters instead of an interpolated .or() string; the call
          // stays INSIDE the idempotency claim, so a replay re-runs neither this
          // nor the status transition below.
          //
          // FIXED (#108): the returned `{error}` used to be discarded, so a
          // seller who set a meeting point and a note was told it saved when
          // neither did — and the order moved state anyway, leaving the buyer
          // an order that advanced with no collection details on it.
          //
          // MUST SUCCEED. Nothing external has happened: the status transition
          // below has not run, so failing here leaves the order exactly as it
          // was rather than half-applied. The throw marks this idempotency key
          // failed for its 10-minute window (services/idempotency.ts), which is
          // the designed answer to a handler that failed — the client retries
          // with a new key, and nothing was applied to be replayed.
          mustWrite(
            await dataLayer.marketplace.updateOrderFieldsAsParty(
              req.params.id,
              req.user.id,
              isSeller,
              fieldUpdates
            ),
            {
              table: 'marketplace_orders',
              op: 'update',
              orderId: req.params.id,
              fields: Object.keys(fieldUpdates).sort().join(','),
            }
          );
        }
        const order = await ordersService.updateOrderStatus(
          req.params.id,
          req.user.id,
          action,
          // Phase 3 N — the dispute UI's reason. Ignored for every other action.
          {
            disputeReason: typeof req.body?.disputeReason === 'string' ? req.body.disputeReason : undefined,
            disputeCategory:
              typeof req.body?.disputeCategory === 'string' ? req.body.disputeCategory : undefined,
            trackingNumber: typeof req.body?.trackingNumber === 'string' ? req.body.trackingNumber : undefined,
            trackingUrl: typeof req.body?.trackingUrl === 'string' ? req.body.trackingUrl : undefined,
          }
        );
        await invalidateSellerAnalyticsCache(order.seller_id);
        return { success: true, data: order };
      });
      res.json(
        ran ? replayed : { ...replayed, idempotentReplay: true, code: 'IDEMPOTENT_REPLAY' }
      );
    } catch (err: any) {
      if (!respondMarketplaceError(res, err, 400)) throw err;
    }
  })
);

// FIXED (F7b): catch-all 400 — see the comment above GET /orders/:id.
router.post(
  '/orders/:id/payment-link',
  authMiddleware,
  idempotencyMiddleware({ operation: 'marketplace_payment_link' }),
  asyncHandler(async (req: IdempotentRequest, res: any) => {
    try {
      const { marketplacePaystackEnabled } = await import('../../services/marketplacePayments');
      if (marketplacePaystackEnabled()) {
        return res.status(409).json({
          success: false,
          error:
            'Offline payment links are disabled while Paystack checkout is enabled. Buyers pay in-app.',
        });
      }
      const result = await req.runIdempotent!(async () => {
        const data = await getMarketplaceOrdersService(dataLayer).createPaymentLinkOrder(
          req.params.id,
          req.user!.id!
        );
        return { data: data as unknown as Record<string, unknown> };
      });
      res.json({ success: true, data: result.data });
    } catch (err: any) {
      if (!respondMarketplaceError(res, err, 400)) throw err;
    }
  })
);

// FIXED (F7b): catch-all 400 — see the comment above GET /orders/:id.
// `proofUrl` is also passed straight through to the service with no type or URL
// check (the `(req: any, res: any)` gap noted in the file header).
router.post(
  '/orders/:id/payment-proof',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const { proofUrl } = req.body || {};
    try {
      const order = await getMarketplaceOrdersService(dataLayer).submitPaymentProof(
        req.params.id,
        req.user.id,
        proofUrl
      );
      res.json({ success: true, data: order });
    } catch (err: any) {
      if (!respondMarketplaceError(res, err, 400)) throw err;
    }
  })
);

export default router;
