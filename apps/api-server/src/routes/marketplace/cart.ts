/**
 * Cart, addresses and checkout.
 *
 * The cart is server-side (marketplace_cart_items), so checkout never trusts a
 * client-supplied basket or price: `cart/checkout` re-reads the cart, prices it
 * from the listing rows and fee resolvers, and creates one Paystack charge for
 * the whole cart. The cart is deliberately not cleared until payment confirms.
 *
 * Every route here that can move money takes an idempotency key. When the client
 * sends no `Idempotency-Key` header the fallback key is built from a hash of the
 * request content (`requestContentHash` in ./context) plus a 5-minute bucket.
 * The content hash is the load-bearing half: the bucket alone used to collide
 * across two different requests from the same buyer, which served the second one
 * the first one's cached checkout — the previous cart's authorization URL. The
 * bucket is kept only so a deliberate repeat purchase in a later window is still
 * possible.
 */
import { Router } from 'express';
import { PublicError } from '../../utils/safeError';
import { asyncHandler } from '../../middleware/errorHandler';
import { authMiddleware } from '../../middleware/auth';
import { invalidateSellerAnalyticsCache } from '../../services/marketplaceOrders';
import { getMarketplaceCartService } from '../../services/marketplaceCart';
import { invalidateListingCaches } from '../../utils/marketplaceCache';
import { normalizeIdempotencyKey, withIdempotency } from '../../services/idempotency';
import { cacheService, dataLayer, requestContentHash } from './context';
import { respondMarketplaceClientError } from './errors';
const router = Router();
// ============================================================
// CART, ADDRESSES AND CHECKOUT
//
// The cart is server-side (marketplace_cart_items), so checkout never trusts a
// client-supplied basket or price: `cart/checkout` re-reads the cart, prices it
// from the listing rows and fee resolvers, and creates one Paystack charge for
// the whole cart. The cart is deliberately not cleared until payment confirms.
//
// Every route here that can move money takes an idempotency key. When the client
// sends no `Idempotency-Key` header the fallback key is built from a hash of the
// request content (see `requestContentHash` at the top of this file) plus a
// 5-minute bucket. The content hash is the load-bearing half: the bucket alone
// used to collide across two different requests from the same buyer, which
// served the second one the first one's cached checkout — the previous cart's
// authorization URL. The bucket is kept only so a deliberate repeat purchase in
// a later window is still possible.
// ============================================================


// GET /api/v1/marketplace/cart - Buyer cart lines
router.get(
  '/cart',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const buyerId = req.user?.id;
    if (!buyerId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const items = await getMarketplaceCartService(dataLayer).listCart(buyerId);
    res.json({ success: true, data: items });
  })
);

// POST /api/v1/marketplace/cart - Add / merge cart line
router.post(
  '/cart',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const buyerId = req.user?.id;
    if (!buyerId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const listingId = typeof req.body?.listingId === 'string' ? req.body.listingId.trim() : '';
    if (!listingId) {
      return res.status(400).json({ success: false, error: 'listingId is required' });
    }
    try {
      const item = await getMarketplaceCartService(dataLayer).addToCart(
        buyerId,
        listingId,
        req.body?.quantity
      );
      res.json({ success: true, data: item });
    } catch (err) {
      if (respondMarketplaceClientError(res, err)) return;
      throw err;
    }
  })
);

// PATCH /api/v1/marketplace/cart/:listingId - Update line quantity
router.patch(
  '/cart/:listingId',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const buyerId = req.user?.id;
    if (!buyerId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const listingId = req.params.listingId;
    try {
      const item = await getMarketplaceCartService(dataLayer).updateCartItem(
        buyerId,
        listingId,
        req.body?.quantity
      );
      res.json({ success: true, data: item });
    } catch (err) {
      if (respondMarketplaceClientError(res, err)) return;
      throw err;
    }
  })
);

// DELETE /api/v1/marketplace/cart/:listingId - Remove one line
router.delete(
  '/cart/:listingId',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const buyerId = req.user?.id;
    if (!buyerId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    await getMarketplaceCartService(dataLayer).removeCartItem(buyerId, req.params.listingId);
    res.json({ success: true, data: { removed: true } });
  })
);

// DELETE /api/v1/marketplace/cart - Clear cart
router.delete(
  '/cart',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const buyerId = req.user?.id;
    if (!buyerId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    await getMarketplaceCartService(dataLayer).clearCart(buyerId);
    res.json({ success: true, data: { cleared: true } });
  })
);

router.get(
  '/addresses',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const { getMarketplaceAddressesService } = await import('../../services/marketplaceAddresses');
    const rows = await getMarketplaceAddressesService(dataLayer).list(req.user.id);
    res.json({ success: true, data: rows });
  })
);

router.post(
  '/addresses',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const { getMarketplaceAddressesService } = await import('../../services/marketplaceAddresses');
    const row = await getMarketplaceAddressesService(dataLayer).create(req.user.id, req.body || {});
    res.json({ success: true, data: row });
  })
);

router.patch(
  '/addresses/:id',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const { getMarketplaceAddressesService } = await import('../../services/marketplaceAddresses');
    const row = await getMarketplaceAddressesService(dataLayer).update(
      req.user.id,
      req.params.id,
      req.body || {},
    );
    res.json({ success: true, data: row });
  })
);

router.delete(
  '/addresses/:id',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const { getMarketplaceAddressesService } = await import('../../services/marketplaceAddresses');
    const row = await getMarketplaceAddressesService(dataLayer).remove(req.user.id, req.params.id);
    res.json({ success: true, data: row });
  })
);

router.get(
  '/checkouts/:id',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const { getMarketplaceCheckoutService } = await import('../../services/marketplaceCheckout');
    const checkout = await getMarketplaceCheckoutService(dataLayer).getCheckout(
      req.params.id,
      req.user.id,
    );
    if (!checkout) return res.status(404).json({ success: false, error: 'Checkout not found' });
    res.json({ success: true, data: checkout });
  })
);

// POST /api/v1/marketplace/cart/checkout — one Paystack charge; cart stays until paid
router.post(
  '/cart/checkout',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const buyerId = req.user?.id;
    if (!buyerId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    // The cart is read before the idempotency claim so the fallback key can be
    // derived from what is actually being bought. A bare time bucket means a
    // buyer who edits their cart and checks out again inside the window is
    // served the PREVIOUS checkout's response — wrong items, wrong total.
    const cart = await getMarketplaceCartService(dataLayer).listCart(buyerId);
    // FIXED (G3 · H8): the cart fingerprint is bound to the OPERATION, not only
    // to the fallback key, because the client's `Idempotency-Key` header wins
    // over the fallback and both clients scope their key as
    // `cart_checkout:<addressId>:<sellerId:mode…>` with no mention of what is in
    // the cart. A checkout that timed out client-side, an item removed, a second
    // checkout — same header key, and the buyer was served the PREVIOUS cart's
    // authorization URL and total. The replay store is keyed
    // (user_id, operation, key), so folding the fingerprint into the operation
    // makes an edited cart a different slot no matter who chose the key, and
    // still replays a true duplicate of the same cart. Price is included: a
    // seller's price change between the two attempts must not replay the old
    // total either.
    const cartFingerprint = requestContentHash({
      lines: cart
        .map(
          (item: any) =>
            `${String(item?.listing_id ?? item?.listing?.id ?? '')}x${Number(item?.quantity ?? 1)}@${String(
              item?.listing?.sale_price ?? item?.listing?.price ?? '',
            )}`,
        )
        .sort(),
    });
    const checkoutOperation = `marketplace_cart_checkout:${cartFingerprint}`;
    const idempotencyKey =
      normalizeIdempotencyKey(req.headers['idempotency-key']) ||
      `${buyerId}:cart_checkout:${requestContentHash({
        lines: cartFingerprint,
        addressId: typeof req.body?.addressId === 'string' ? req.body.addressId : null,
        groups: Array.isArray(req.body?.groups)
          ? req.body.groups
              .map((g: any) => `${String(g?.sellerId ?? '')}:${String(g?.fulfillmentMode ?? '')}`)
              .sort()
          : [],
      })}:${Math.floor(Date.now() / 300_000)}`;

    try {
    const result = await withIdempotency(
      dataLayer.getClient(),
      buyerId,
      checkoutOperation,
      idempotencyKey,
      async () => {
        const { getMarketplaceCheckoutService } = await import('../../services/marketplaceCheckout');
        // R5a: explicit PublicError. The removed name-check heuristic used to
        // surface this as a 400 by guessing; now it says so.
        if (cart.length === 0) throw new PublicError('Cart is empty');

        const email =
          (typeof req.user?.email === 'string' && req.user.email) ||
          (await dataLayer.users.getAuthUserEmail(buyerId)) || '';

        const requestedGroups = Array.isArray(req.body?.groups) ? req.body.groups : [];
        const modeBySeller = new Map<
          string,
          { sellerId: string; fulfillmentMode: string; meetingLocation?: string }
        >();
        for (const group of requestedGroups) {
          if (group?.sellerId && group?.fulfillmentMode) {
            modeBySeller.set(String(group.sellerId), {
              sellerId: String(group.sellerId),
              fulfillmentMode: String(group.fulfillmentMode),
              meetingLocation:
                typeof group.meetingLocation === 'string' ? group.meetingLocation : undefined,
            });
          }
        }
        for (const item of cart) {
          const sellerId = String(item.listing?.user_id || '');
          if (sellerId && !modeBySeller.has(sellerId)) {
            modeBySeller.set(sellerId, { sellerId, fulfillmentMode: 'campus_meetup' });
          }
        }

        const unified = await getMarketplaceCheckoutService(dataLayer).createFromCart(buyerId, {
          groups: [...modeBySeller.values()] as any,
          addressId: typeof req.body?.addressId === 'string' ? req.body.addressId : null,
          buyerEmail: email,
        });

        return {
          checkout: unified.checkout,
          orders: unified.orders,
          failures: [],
          authorizationUrl: unified.authorizationUrl,
        };
      }
    );

    for (const order of (result as any).orders || []) {
      if (order?.listing_id) {
        await invalidateListingCaches(cacheService, String(order.listing_id));
        await invalidateSellerAnalyticsCache(String(order.seller_id || ''));
      }
    }
    await cacheService.deletePattern('marketplace:listings:*');

    res.json({ success: true, data: result });
    } catch (err) {
      if (respondMarketplaceClientError(res, err)) return;
      throw err;
    }
  })
);

export default router;
