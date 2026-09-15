/**
 * Marketplace transport layer — I/O only.
 *
 * Every call the marketplace store makes to the outside world goes through
 * here: the API client (services/api), the offline queue (services/syncService)
 * and the per-user AsyncStorage cache. Functions take their arguments and
 * return what the server said; none of them read or write store state, and
 * none of them map rows (that is mapping.ts).
 *
 * Main exports: the `fetch*` / `create*` / `update*` / `delete*` wrappers, the
 * AsyncStorage cache helpers, the storage-key builders
 * (`getMarketplaceStorageKeysForUser`, `LEGACY_MARKETPLACE_STORAGE_KEYS`) and
 * `isRetryableMarketplaceError`.
 *
 * Gotchas:
 * - Storage keys are matched by STRING elsewhere (sign-out cleanup reads
 *   `getMarketplaceStorageKeysForUser`); never rename one.
 * - Only transient failures (network / 408 / 429 / 5xx) may be queued —
 *   `isRetryableMarketplaceError` is the one definition of that, and a
 *   permanent 4xx must roll the optimistic change back instead.
 * - The money-moving calls (`buyNowListing`, `createMarketplaceOffer`,
 *   `respondToOffer`, `boostListing`) are already the KEYED wrappers in
 *   services/api: passing `undefined` for the idempotency key means "let the
 *   purchase intent own the key", not "mint a random one".
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as api from '../../services/api';
import { withPurchaseIntent } from '../../services/marketplacePurchaseIntent';
import { syncService } from '../../services/syncService';
import type { MarketplaceListing, RemoteListing } from './types';

/** REL-01: queue only network / 5xx / 408 / 429 — permanent 4xx must not ghost-sync. */
export function isRetryableMarketplaceError(error: { status?: number; message?: string } | null | undefined): boolean {
  const status = error?.status;
  if (typeof status === 'number') {
    if (status === 408 || status === 429 || status >= 500) return true;
    if (status >= 400 && status < 500) return false;
  }
  const message = String(error?.message || '');
  return /network request failed|network error|timed out|failed to fetch/i.test(message);
}

function unwrapListings<T>(raw: T[] | { data: T[] }): T[] {
  return Array.isArray(raw) ? raw : raw.data;
}

// ---------------------------------------------------------------------------
// AsyncStorage cache (per user; the key strings are load-bearing)
// ---------------------------------------------------------------------------

// Legacy device-global keys (pre user-scoping)
const LEGACY_LISTINGS_STORAGE_KEY = 'lantern_marketplace_listings';
const LEGACY_MY_LISTINGS_STORAGE_KEY = 'lantern_my_listings';
const LEGACY_FAVORITES_STORAGE_KEY = 'lantern_marketplace_favorites';

export const LEGACY_MARKETPLACE_STORAGE_KEYS = [
  LEGACY_LISTINGS_STORAGE_KEY,
  LEGACY_MY_LISTINGS_STORAGE_KEY,
  LEGACY_FAVORITES_STORAGE_KEY,
] as const;

function listingsStorageKey(userId?: string | null): string {
  return `lantern_marketplace_listings_${userId ?? 'anonymous'}`;
}

function myListingsStorageKey(userId?: string | null): string {
  return `lantern_my_listings_${userId ?? 'anonymous'}`;
}

function favoritesStorageKey(userId?: string | null): string {
  return `lantern_marketplace_favorites_${userId ?? 'anonymous'}`;
}

export function getMarketplaceStorageKeysForUser(userId?: string | null): string[] {
  return [
    listingsStorageKey(userId),
    myListingsStorageKey(userId),
    favoritesStorageKey(userId),
  ];
}

/** The three cached blobs for this user, still as raw JSON (the store parses). */
export async function readMarketplaceCache(userId?: string | null): Promise<{
  listingsJson: string | null;
  myListingsJson: string | null;
  favoritesJson: string | null;
}> {
  const [listingsJson, myListingsJson, favoritesJson] = await Promise.all([
    AsyncStorage.getItem(listingsStorageKey(userId)),
    AsyncStorage.getItem(myListingsStorageKey(userId)),
    AsyncStorage.getItem(favoritesStorageKey(userId)),
  ]);
  return { listingsJson, myListingsJson, favoritesJson };
}

/** Writes exactly what it is given — the user-scoping filter is the store's call. */
export async function writeMarketplaceCache(
  userId: string | null | undefined,
  data: {
    listings: MarketplaceListing[];
    myListings: MarketplaceListing[];
    favorites: string[];
  },
): Promise<void> {
  await Promise.all([
    AsyncStorage.setItem(listingsStorageKey(userId), JSON.stringify(data.listings)),
    AsyncStorage.setItem(myListingsStorageKey(userId), JSON.stringify(data.myListings)),
    AsyncStorage.setItem(favoritesStorageKey(userId), JSON.stringify(data.favorites)),
  ]);
}

/** Sign-out / account-switch cleanup. Never throws: a failed sweep must not block sign-out. */
export async function removeMarketplaceStorageKeys(keys: string[]): Promise<void> {
  await AsyncStorage.multiRemove([...new Set(keys)]).catch(() => {});
}

// ---------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------

type ListingsQuery = Parameters<typeof api.fetchMarketplaceListings>[0];
type ListingsPagination = { page: number; limit: number; total: number } | undefined;

/** One browse page. Filtering is server-side so pages come back full. */
export async function fetchListingsPage(
  query: ListingsQuery,
): Promise<{ rows: RemoteListing[]; pagination: ListingsPagination }> {
  const raw = (await api.fetchMarketplaceListings(query)) as
    | RemoteListing[]
    | {
        data: RemoteListing[];
        pagination?: { page: number; limit: number; total: number };
      };
  const pagination =
    raw && typeof raw === 'object' && 'pagination' in raw
      ? (raw as { pagination?: { page: number; limit: number; total: number } }).pagination
      : undefined;
  return { rows: unwrapListings(raw), pagination };
}

export async function fetchMyListings(): Promise<RemoteListing[]> {
  const rows = await api.fetchMyListings();
  return rows as unknown as RemoteListing[];
}

export async function fetchListing(listingId: string): Promise<RemoteListing> {
  return (await api.fetchMarketplaceListing(listingId)) as unknown as RemoteListing;
}

export async function fetchSimilarListings(listingId: string): Promise<RemoteListing[]> {
  const rows = await api.fetchSimilarListings(listingId);
  return rows as unknown as RemoteListing[];
}

/**
 * Publish a listing under a PURCHASE INTENT key.
 *
 * FIXED (F3): the create carries an idempotency key that identifies the user's
 * INTENT rather than the call. `withPurchaseIntent` mints one key per scope,
 * reuses it on every retry of the same intent (a tap after an uncertain
 * failure, a second tap on Publish) and rotates it only once the create has
 * resolved, so `POST /marketplace/listings` (idempotencyMiddleware, operation
 * `marketplace_create_listing`) replays the first response instead of writing a
 * second listing.
 * Remaining gap (reported, syncService is another lane's file): the offline
 * replay at services/syncService.ts:604 calls `createMarketplaceListing` with
 * no key, so a queued create that ALSO landed can still duplicate — it needs to
 * pass `listing-create:<op.entityId>`.
 */
export async function createListing(
  scope: string,
  payload: Parameters<typeof api.createMarketplaceListing>[0],
) {
  return withPurchaseIntent(scope, (idempotencyKey) =>
    api.createMarketplaceListing(payload, idempotencyKey),
  );
}

export async function updateListing(
  listingId: string,
  payload: Parameters<typeof api.updateMarketplaceListing>[1],
): Promise<void> {
  await api.updateMarketplaceListing(listingId, payload);
}

export async function deleteListing(listingId: string): Promise<void> {
  await api.deleteMarketplaceListing(listingId);
}

export async function appealListingTakedown(listingId: string, note: string) {
  return api.appealListingTakedown(listingId, note);
}

export async function boostListing(listingId: string): Promise<void> {
  await api.boostListing(listingId);
}

export async function reportListing(
  listingId: string,
  input: { reason: string; details?: string },
): Promise<void> {
  await api.reportMarketplaceListing(listingId, input);
}

/**
 * Offline queue for the listing writes. Only ever called after
 * `isRetryableMarketplaceError` says the failure was transient.
 */
export async function queueListingOperation(
  entityId: string,
  operation: 'create' | 'update' | 'delete',
  payload: Record<string, any>,
  userId: string,
): Promise<void> {
  await syncService.queueOperation('listing', entityId, operation, payload, userId);
}

// ---------------------------------------------------------------------------
// Favorites, reviews, inquiries
// ---------------------------------------------------------------------------

export async function fetchServerFavorites() {
  return (await api.fetchMyFavorites()) as Array<{ listing?: RemoteListing; listing_id?: string }>;
}

export async function addToFavorites(listingId: string): Promise<void> {
  await api.addToFavorites(listingId);
}

export async function removeFromFavorites(listingId: string): Promise<void> {
  await api.removeFromFavorites(listingId);
}

export async function fetchListingReviews(listingId: string) {
  return api.fetchListingReviews(listingId);
}

export async function addReview(
  listingId: string,
  input: { rating: number; comment?: string },
): Promise<void> {
  await api.addMarketplaceReview(listingId, input);
}

export async function setReviewHelpful(listingId: string, reviewId: string, helpful: boolean) {
  return api.setMarketplaceReviewHelpful(listingId, reviewId, helpful);
}

export async function fetchMyInquiries(role: 'seller' | 'buyer') {
  return api.fetchMyInquiries(role);
}

export async function updateInquiryStatus(
  inquiryId: string,
  status: 'open' | 'negotiating' | 'closed' | 'purchased',
): Promise<void> {
  await api.updateInquiryStatus(inquiryId, status);
}

/** API shape: { inquiry, threadId } (existing inquiries may flatten to the inquiry row). */
export async function createInquiry(listingId: string, message: string) {
  return (await api.createInquiry(listingId, message)) as {
    inquiry?: { dm_thread_id?: string; seller_id?: string };
    threadId?: string;
    dm_thread_id?: string;
    seller_id?: string;
  };
}

// ---------------------------------------------------------------------------
// Offers, orders, cart
// ---------------------------------------------------------------------------

export async function fetchOffers(role: 'buyer' | 'seller') {
  return api.fetchMarketplaceOffers(role);
}

export async function fetchListingOffers(listingId: string) {
  return api.fetchListingOffers(listingId);
}

export async function createOffer(listingId: string, amount: number, message?: string) {
  return api.createMarketplaceOffer(listingId, amount, message);
}

export async function respondToOffer(
  offerId: string,
  action: 'accept' | 'decline' | 'counter' | 'withdraw',
  counterAmount?: number,
  message?: string,
) {
  return api.respondToOffer(offerId, action, counterAmount, message);
}

/**
 * FIXED (F3): `api.buyNowListing` is the keyed wrapper in services/api.ts, not
 * the raw endpoint — the `undefined` third argument no longer means "mint a
 * fresh random key", it means "let the purchase intent own the key". The intent
 * is scoped to listing + quantity + coupon, so a retry after a 10s timeout
 * reuses the key the server already has instead of creating a second order and
 * a second charge.
 */
export async function buyNowListing(listingId: string, couponCode?: string, quantity?: number) {
  return api.buyNowListing(listingId, couponCode, undefined, quantity);
}

export async function addToCart(listingId: string, quantity?: number): Promise<void> {
  await api.addToMarketplaceCart(listingId, quantity);
}

export async function fetchCart() {
  return api.fetchMarketplaceCart();
}

// ---------------------------------------------------------------------------
// Saved searches, shops, seller, access, summary
// ---------------------------------------------------------------------------

export async function fetchSavedSearches() {
  return api.fetchSavedSearches();
}

export async function createSavedSearch(input: { filters: Record<string, unknown>; name?: string }) {
  return api.createSavedSearch(input);
}

export async function deleteSavedSearch(id: string): Promise<void> {
  await api.deleteSavedSearch(id);
}

export async function fetchSellerProfile(sellerId: string) {
  return api.fetchSellerProfile(sellerId);
}

export async function fetchSellerStats() {
  return api.fetchSellerStats();
}

export async function updateMyShop(data: Parameters<typeof api.updateMyShop>[0]) {
  return api.updateMyShop(data);
}

export async function fetchShops(params?: { campus?: string; q?: string }) {
  return api.fetchMarketplaceShops(params);
}

export async function fetchMarketplaceAccess() {
  return api.fetchMarketplaceAccess();
}

export async function fetchShopSummary() {
  return api.fetchShopSummary();
}
