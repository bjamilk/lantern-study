/**
 * Marketplace HTTP surface: the campus goods marketplace and the digital study
 * products (question banks, study packs) that share its listing, cart, order,
 * offer and payout machinery. Roughly 106 routes, split by bounded context
 * (R5a) out of a single 4.3k-line `routes/marketplace.ts`.
 *
 * Contexts, in mount order:
 *   ./listings    listings and browse, courses, upload, boost/report/appeal
 *   ./reviews     ratings and helpful votes
 *   ./digital     question banks, study packs, /purchases
 *   ./cart        cart, addresses, checkout
 *   ./orders      buy-now, /transactions, the order lifecycle
 *   ./payments    Paystack config, verify, seller payouts
 *   ./offers      price negotiation
 *   ./inquiries   buyer↔seller inquiries
 *   ./discovery   favorites, saved searches, taxonomy, classify, similar
 *   ./seller      seller dashboard, shop, coupons, seller tools
 *
 * Mount order is not load-bearing across these files: no path registered in one
 * of them is shadowed by a pattern in another (the one order-sensitive pair,
 * `GET /listings/batch` before `GET /listings/:id`, is intra-file in
 * ./listings). `marketplace.routeInventory.test.ts` asserts the whole
 * registered surface — method, path and middleware order — against a snapshot
 * recorded before the split, and separately proves no route is shadowed.
 *
 * Mount and middleware chain (server.ts):
 *
 *   app.use('/api/v1/marketplace',
 *     optionalAuthMiddleware,     // populates req.user when a credential is present
 *     marketplaceGeoMiddleware,
 *     applyPublicRateLimits,      // public read/write IP caps, per-user caps once signed in
 *     marketplaceRoutes)
 *
 * Auth mode. The mount itself is `optionalAuthMiddleware`, so reaching a handler
 * proves nothing: each route that needs a user re-runs `authMiddleware`. There
 * is no membership gate in front of this mount: the marketplace is open to every
 * viewer (2026-09-15 — the founder-only private-pilot allowlist that used to sit
 * here was removed). What protects the surface is per-route `authMiddleware`,
 * the ownership predicate below, `assertSellerCanReceivePayout` on every
 * checkout path, and the rights/moderation rules on every write.
 *
 * Rate limits. `applyPublicRateLimits` picks the tier per request:
 * `publicReadRateLimit` / `publicWriteRateLimit` for anonymous traffic on routes
 * `middleware/publicRoutes.ts` classifies as public, `authenticatedRateLimit`
 * once `req.user.id` exists, and nothing at all for routes it does not classify.
 * `POST /upload-image` adds `uploadBurstRateLimit` on top.
 *
 * Ownership predicate. Order authorisation is a "party to the order" test, not a
 * role test: `marketplaceOrders.getOrderById` reads the row by id and throws
 * PublicError('Unauthorized') unless `buyer_id === userId || seller_id === userId`.
 * It proves the caller is one of the two parties. It does NOT prove which one,
 * so any handler whose fields belong to a specific side must add its own role
 * check — PATCH /orders/:id does; the rest of the order routes treat buyer and
 * seller identically.
 *
 * Error-mapping convention lives in ./errors. As of R5a the classification is
 * explicit: `PublicError` (or an explicit 4xx `statusCode`) is client-facing,
 * everything else escapes to the global errorHandler as a 500.
 *
 * What it touches.
 *   - Supabase tables: marketplace_listings, marketplace_orders,
 *     marketplace_order_items, marketplace_offers, marketplace_inquiries,
 *     marketplace_cart_items, marketplace_addresses, marketplace_reviews,
 *     marketplace_favorites, marketplace_saved_searches, marketplace_coupons,
 *     marketplace_campuses, marketplace_custom_categories, marketplace_boosts,
 *     seller shop/preferences/payout-profile rows, and the question-bank and
 *     study-pack entitlement tables.
 *   - Storage: the `marketplace-images` bucket carries both listing covers and
 *     shop cover images (`purpose: 'shop'` selects the path prefix).
 *   - Paystack, via services/marketplacePayments.ts — checkout session creation,
 *     `POST /payments/:reference/verify`, and the seller payout profile /
 *     bank-list calls in services/paystack.ts. Webhooks are NOT here; they mount
 *     outside this prefix (routes/paystackWebhook.ts at /webhooks/paystack) and
 *     are authenticated by HMAC signature, not by session.
 *   - CacheService for listing, taxonomy, seller-profile and seller-analytics
 *     keys, invalidated through utils/marketplaceCache.ts.
 *   - services/idempotency.ts and middleware/idempotency.ts on every money path.
 *
 * Defences that must not be weakened:
 *   - No charge path accepts a client-supplied amount. Prices come from the
 *     listing row, fees from @lantern/shared/marketplace resolvers.
 *   - `seller_id` is always derived from the listing, never from the request.
 *   - `assertSellerCanReceivePayout` gates every checkout-creation path, so money
 *     is never collected for a seller who cannot be paid out.
 *
 * KNOWN ISSUE (tracked, deferred F10: planned refactor stage — R5a began the
 * per-handler typing pass and the remaining routers are the rest of that same
 * stage; retyping them mid-round would collide with the money-path work and
 * produce a diff no reviewer can read against the services it calls):
 * most handlers are still typed `(req: any, res: any)`,
 * so TypeScript checks nothing about the request. `quantity`, `amount`,
 * `counterAmount`, `discountValue`, `proofUrl` and `fulfillmentMode` reach the
 * services with only whatever ad-hoc `typeof`/`Number()` guard the handler
 * happens to write, and several routes attach `handleValidationErrors` with no
 * express-validator chain in front of it (see the marker near POST
 * /listings/:id/reviews). R5a typed the handlers it rewrote; the rest are
 * unchanged.
 */
import { Router } from 'express';
import { SupabaseService } from '../../services/supabase';
import { CacheService } from '../../services/cache';
import { initializeMarketplaceContext } from './context';

import listingsRoutes from './listings';
import reviewsRoutes from './reviews';
import digitalRoutes from './digital';
import cartRoutes from './cart';
import ordersRoutes from './orders';
import paymentsRoutes from './payments';
import offersRoutes from './offers';
import inquiriesRoutes from './inquiries';
import discoveryRoutes from './discovery';
import sellerRoutes from './seller';

const router = Router();

router.use(listingsRoutes);
router.use(reviewsRoutes);
router.use(digitalRoutes);
router.use(cartRoutes);
router.use(ordersRoutes);
router.use(paymentsRoutes);
router.use(offersRoutes);
router.use(inquiriesRoutes);
router.use(discoveryRoutes);
router.use(sellerRoutes);

// Initialize function to be called from main server.
export const initializeMarketplaceRoutes = (supabase: SupabaseService, cache: CacheService) => {
  initializeMarketplaceContext(supabase, cache);
};

export {
  respondMarketplaceClientError,
  mapMarketplaceError,
  respondMarketplaceError,
} from './errors';

export {
  expiredPendingOfferDate,
  offerExpiryConflict,
  attachOrdersToOffers,
  type OfferOrderSummary,
} from './offers';

export default router;
