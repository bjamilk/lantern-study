/**
 * data/marketplace.ts — the marketplace catalogue, reviews and order bookkeeping.
 *
 * ## Purpose
 *
 * Extracted verbatim from `services/supabase.ts` (monolith lane M1g, step 18),
 * the MARKETPLACE section: the largest block in that file. Catalogue reads and
 * writes, seller trust, reviews and their helpful votes, boosts, reports, and
 * the budget mirror that makes a sale show up in the seller's Budget. Money
 * MOVEMENT is not here — that is `services/marketplacePayments.ts` and
 * Paystack; this module owns catalogue, reviews and order bookkeeping.
 *
 * Per `TEAM-S1-api-structure.md` §3, P0, this module is later folded into the
 * marketplace services proper. Until then it is a plain leaf: functions over an
 * injected client, no class, no reorganisation.
 *
 * ## What it touches
 *
 * Tables: `marketplace_campuses`, `marketplace_listings`, `marketplace_orders`,
 * `marketplace_reviews`, `marketplace_review_votes`, `marketplace_reports`,
 * `marketplace_transactions`, `marketplace_question_bank_entitlements`,
 * `marketplace_inquiries`, `saved_searches`, `creator_stats`, `profiles`,
 * `budget_transactions`. Two RPCs: `marketplace_search_listings` and
 * `marketplace_category_analytics`. No storage buckets — listing images arrive
 * as stored refs and are signed through the injected storage helpers.
 *
 * ## The gotchas
 *
 * 1. WRITES ARE MASS-ASSIGNMENT GUARDED. A listing row carries server-owned
 *    fields — boost/promotion state inside `category_specific_fields`,
 *    moderation status, seller id — and clients post free-form JSON, so every
 *    create/update goes through the sanitizers at the top of this module
 *    (`assertValidListingKind`, `sanitizeListingImages`,
 *    `assertValidListingQuantity`, `stripServerOwnedListingFields` and
 *    `assertSellerListingUpdateAllowed`). A seller may only make a status
 *    transition the shared lifecycle table permits, and a moderated listing is
 *    read-only. Never write a client payload into `marketplace_listings`
 *    directly. `supabase.listingMassAssignment.test.ts` and
 *    `supabase.listingModerationLock.test.ts` are the proof.
 *
 * 2. THE RATING-COLUMN CIRCUIT BREAKER IS INSTANCE STATE AND STAYED BEHIND.
 *    The rating aggregate columns + votes table ship in migration
 *    20260828160000, applied by hand like every migration here; until it runs,
 *    any explicit reference to the columns fails with 42703, and after one such
 *    failure the service stops asking for ten minutes. That timestamp
 *    (`ratingColumnsBrokenUntil`) is a FIELD on `SupabaseService`, and
 *    `supabase.reviewSignals.test.ts` asserts it per-instance
 *    (`expect(self.ratingColumnsAvailable()).toBe(false)`), so
 *    `ratingColumnsAvailable` / `noteRatingColumnsMissing` are injected here
 *    rather than moved. Only the pure predicate `isMissingRatingColumn` lives
 *    in this module.
 *
 * 3. LISTING READS COME IN SEVERAL SHAPES ON PURPOSE.
 *    `toListingCardRecords` / `pickCompactListingFields` serve browse cards,
 *    the full record serves a detail page, and `getMarketplaceListingForViewer`
 *    is the viewer-scoped version. Seller trust is attached SEPARATELY
 *    (`attachSellerTrust`) and on BOTH browse branches: the `full` profile
 *    returns the search-RPC rows directly and never reaches the card builder,
 *    so attaching trust only there silently left trust off the default browse
 *    response once already.
 *
 * 4. REVIEWS ARE GATED BY `canUserReviewListing` — a review must be backed by a
 *    real order, a digital entitlement, or a seller-confirmed `purchased`
 *    inquiry. That gate is what stopped reviews being self-minted; the read
 *    side (`attachMarketplaceReviewSignals`) re-derives the same proof as
 *    `verifiedPurchase`, and every one of its lookups is best-effort so a
 *    missing votes table degrades ONE field instead of failing the list.
 *
 * 5. `deleteMarketplaceListingSafely` EXISTS BECAUSE THE FK CASCADES.
 *    `marketplace_orders.listing_id` is ON DELETE CASCADE, so a raw delete
 *    hard-deletes every order on the listing, receipts and payment evidence
 *    included. The application-layer guard blocks on open orders, archives when
 *    only terminal orders exist, and hard-deletes only when there are none. The
 *    DB-layer backstop (FK → ON DELETE RESTRICT) is still an unapplied
 *    migration. `supabase.listingDelete.test.ts` pins all three outcomes.
 *
 * 6. THE POSTGREST EMBED TRAP. A second FK between two tables makes a bare
 *    embed ambiguous and returns PGRST201 at RUNTIME, which is why the selects
 *    here name `profiles!user_id` / `marketplace_campuses!campus_id`. Bare
 *    embeds repo-wide are frozen by
 *    `services/postgrestEmbedDisambiguation.test.ts`, and this module's rows in
 *    that ledger moved here verbatim with the code.
 *
 * ## Why the cross-method calls go back through `deps`
 *
 * Every sibling in this module and every reach into another section goes
 * through `deps`. `supabase.listingMassAssignment.test.ts`,
 * `supabase.listingModerationLock.test.ts`, `supabase.listingDelete.test.ts`,
 * `supabase.reviews.test.ts` and `supabase.reviewSignals.test.ts` all build a
 * bare `self = { supabase, getMarketplaceListingById: …, toListingCardRecords:
 * …, … }` and drive the entry point through
 * `SupabaseService.prototype.<m>.call(self, …)`. A local sibling call would
 * step around exactly the stubs those harnesses install. The facade builds the
 * `deps` literal INLINE at each call site, as arrows that read `this.<method>`
 * at CALL time — an instance field holding the deps reads as `undefined`
 * there, and would bypass every `jest.spyOn` on the class.
 *
 * The three collaborator services the section reached through
 * `get<X>Service(this)` — marketplace orders, seller tools and learning
 * connections — are injected the same way, for the same reason and because
 * they want the `SupabaseService` instance, which this module must not import.
 * Their `await import(...)` stays in the facade, so the module specifier a test
 * mocks is unchanged.
 */
import { logger } from "../../utils/logger";
import {
  buildMarketplaceBudgetTxIds,
  buildManualSaleBudgetTxId,
  buildMarketplacePurchaseDescription,
  buildMarketplaceSaleDescription,
  MARKETPLACE_BUDGET_CATEGORIES,
  MARKETPLACE_BUDGET_TYPES,
} from "@lantern/shared/utils/server";
import {
  MARKETPLACE_DEFAULT_COUNTRY,
  MARKETPLACE_DEFAULT_CURRENCY,
  isMarketplaceListingEditable,
  isMarketplaceListingStatus,
  sellerListingTransitionError,
  isKnownTaxonomyNodeId,
  rankRelatedListings,
} from "@lantern/shared/marketplace";
import {
  isPrivateStorageBucket,
  parseStoredStorageRef,
} from "@lantern/shared/utils/storageUrl";
import { PublicError } from "../../utils/safeError";
// Value import (const array) — marketplaceOrders only type-imports supabase, so
// this introduces no runtime import cycle.
import { OPEN_ORDER_STATUSES } from "../marketplaceOrders";
import { writeWithTopicFallback } from "./academic";

import type { DataClient } from "./client";

// ============ MARKETPLACE LISTING WRITE SANITIZERS (mass-assignment guard) ============
// Known listing kinds, mirroring the DB CHECK constraint on
// marketplace_listings.listing_kind (migrations 20260818120000 +
// 20260823120000, which adds 'study_pack').
export const KNOWN_LISTING_KINDS = ["single", "bundle", "question_bank", "study_pack"];
export const MAX_LISTING_IMAGES = 24;

export function marketplaceWriteError(message: string): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = 400;
  return err;
}

/**
 * category_specific_fields is a free-form JSON blob written verbatim from the
 * client. Boost/promotion state (boosted_until, boost_level, …) lives inside it
 * but is server-owned — set only by boostMarketplaceListing after a paid boost
 * credit is consumed, and read as `is_boosted` by the search RPC. Strip any
 * boost-prefixed key a client supplies so nobody can self-mint a free,
 * indefinite boost.
 */
export function stripServerOwnedListingFields(
  raw: unknown,
): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (/^boost/i.test(key)) continue; // boosted_until, boost_level, boost_*
    out[key] = value;
  }
  return out;
}

/** Server-owned boost/promotion keys carried on an existing listing. */
export function pickServerOwnedListingFields(
  raw: unknown,
): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (/^boost/i.test(key)) out[key] = value;
  }
  return out;
}

export function sanitizeListingImages(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw marketplaceWriteError("images must be an array of image URLs");
  }
  if (raw.length > MAX_LISTING_IMAGES) {
    throw marketplaceWriteError(
      `A listing can have at most ${MAX_LISTING_IMAGES} images`,
    );
  }
  for (const img of raw) {
    if (typeof img !== "string") {
      throw marketplaceWriteError("Each image must be a string URL");
    }
  }
  return raw as string[];
}

export function assertValidListingKind(kind: unknown): void {
  if (kind === undefined || kind === null) return;
  if (typeof kind !== "string" || !KNOWN_LISTING_KINDS.includes(kind)) {
    throw marketplaceWriteError("Invalid listing kind");
  }
}

export function assertValidBundleItems(items: unknown): void {
  if (items === undefined || items === null) return;
  if (!Array.isArray(items)) {
    throw marketplaceWriteError("bundle_items must be an array");
  }
}

export function assertValidListingQuantity(quantity: unknown): void {
  if (quantity === undefined || quantity === null) return; // null = single/unlimited
  const n = Number(quantity);
  if (!Number.isInteger(n) || n < 0) {
    throw marketplaceWriteError("Quantity must be a whole number of 0 or more");
  }
}

/**
 * 4xx error whose message is written for the seller and safe to return
 * verbatim in production (see clientErrorMessage / the global error handler,
 * which both honour statusCode on operational errors).
 */
export function listingStateError(message: string, statusCode: 400 | 403): Error {
  return Object.assign(new PublicError(message), { statusCode });
}

/**
 * Guard for seller-initiated listing edits: moderated listings are read-only,
 * and any requested status change must be a transition the shared lifecycle
 * table (packages/shared/src/marketplace/lifecycle.ts) allows a seller to make.
 * Module-level (not a method) so tests can drive the prototype with a stub.
 */
export async function assertSellerListingUpdateAllowed(
  service: { getMarketplaceListingById(id: string): Promise<any> },
  listingId: string,
  nextStatus: unknown,
): Promise<void> {
  const current = await service.getMarketplaceListingById(listingId);
  const currentStatus = current?.status;
  // Unknown row or legacy status: fall through to the update, which returns
  // null / fails exactly as it did before this guard existed.
  if (!isMarketplaceListingStatus(currentStatus)) return;
  if (!isMarketplaceListingEditable(currentStatus)) {
    throw listingStateError(
      currentStatus === "removed_by_admin"
        ? "This listing was removed by Lantern moderation and can no longer be edited."
        : "This listing is suspended by Lantern moderation and cannot be edited until it is restored.",
      403,
    );
  }
  if (nextStatus === undefined || nextStatus === null) return;
  if (!isMarketplaceListingStatus(nextStatus)) {
    throw listingStateError("Unknown listing status", 400);
  }
  const refusal = sellerListingTransitionError(currentStatus, nextStatus);
  if (refusal) throw listingStateError(refusal, 403);
}

/**
 * Everything a moved body used to reach through `this`.
 *
 * Build this literal INLINE at each delegating call site, with arrows that
 * read `this.<method>` at CALL time. Hoisting it to an instance field compiles
 * and passes the surface freeze, but breaks every suite that invokes these
 * methods on a bare `{ supabase }` stand-in that never ran a constructor, and
 * bypasses every `jest.spyOn` on the class.
 */
export type MarketplaceDeps = {
  /** Siblings in this module — dispatched dynamically, see the banner. */
  attachListingKinds: (rows: any[]) => Promise<any[]>;
  attachMarketplaceReviewSignals: (
    listingId: string,
    reviews: any[],
    viewerId?: string,
  ) => Promise<any[]>;
  attachSellerTrust: (rows: any[]) => Promise<any[]>;
  canUserReviewListing: (
    listingId: string,
    userId: string,
  ) => Promise<{ eligible: boolean; reason?: string }>;
  deleteMarketplaceListing: (listingId: string) => Promise<boolean>;
  fetchSellerTrust: (
    sellerIds: string[],
  ) => Promise<Map<string, { trust_level: string; verification_level: number }>>;
  getMarketplaceListingById: (
    listingId: string,
    options?: { requireActive?: boolean },
  ) => Promise<any | null>;
  getRelatedMarketplaceListingsInner: (
    listing: {
      id: string;
      category?: string;
      campus_id?: string | null;
      course_id?: string | null;
      price?: number | null;
      category_specific_fields?: Record<string, unknown> | null;
    },
    limit?: number,
  ) => Promise<any[]>;
  isMissingRatingColumn: (error: any) => boolean;
  logMarketplaceBudgetTransactions: (params: {
    listingId: string;
    listingTitle: string;
    amount: number;
    sellerId: string;
    buyerId?: string;
    marketplaceTransactionId?: string;
    source: "buy_now" | "offer_accept" | "manual_sold";
  }) => Promise<boolean>;
  maybeLogManualSoldBudget: (
    listingId: string,
    sellerId: string,
  ) => Promise<boolean>;
  pickCompactListingFields: (listing: any) => any;
  toListingCardRecords: (listings: any[]) => Promise<any[]>;

  /**
   * The rating-column circuit breaker, which is INSTANCE state on
   * `SupabaseService` and stayed there — see gotcha 2 in the banner.
   */
  noteRatingColumnsMissing: () => void;
  ratingColumnsAvailable: () => boolean;

  /** Still in the monolith, or in a section another lane owns. */
  getClient: () => any;
  getResponseProfile: (profile?: string) => "compact" | "full";
  isPlatformAdmin: (userId: string) => Promise<boolean>;
  normalizeListingRecord: (listing: any) => any;
  normalizeListingRecordAsync: (listing: any) => Promise<any>;
  normalizeStorageUrl: (url: string) => string;
  resolveArtefactTopic: (input: {
    topicId?: unknown;
    courseId?: unknown;
    currentCourseId?: string | null;
  }) => Promise<string | null | undefined>;
  signSimilarListingCards: (listings: any[]) => Promise<any[]>;
  signStorageDisplayUrls: (
    refs: Array<{ bucket: string; path: string; index: number }>,
    options?: { expiresInSeconds?: number; variant?: "thumb" | "original" },
  ) => Promise<Map<number, string>>;

  /**
   * Collaborator services the section reached through `get<X>Service(this)`.
   * Injected because they want the `SupabaseService` instance, which this
   * module must not import; their `await import(...)` stays in the facade.
   */
  consumeBoostCredit: (sellerId: string) => Promise<number>;
  createOrderFromBuyNow: (
    listingId: string,
    buyerId: string,
    couponCode?: string,
    quantity?: number,
  ) => Promise<Record<string, unknown>>;
  createOrderFromOfferAccept: (
    offerId: string,
    actorId?: string,
  ) => Promise<Record<string, any>>;
  recordLearningConnection: (input: {
    actorId: string;
    beneficiaryId: string;
    kind: string;
    objectType?: string | null;
    objectId?: string | null;
    courseId?: string | null;
  }) => Promise<void>;
};

export async function getMarketplaceCampuses(
  db: DataClient,
  countryCode = "NG",
): Promise<any[]> {
  const { data, error } = await db
    .from("marketplace_campuses")
    .select("id, name, city, state, country_code, slug, geopolitical_zone, kind")
    .eq("active", true)
    .eq("country_code", countryCode)
    .order("name", { ascending: true });
  if (error) throw error;
  return data || [];
}


export async function getMarketplaceCampusById(
  db: DataClient,
  campusId: string,
): Promise<any | null> {
  const { data, error } = await db
    .from("marketplace_campuses")
    .select(
      "id, name, city, state, country_code, slug, active, geopolitical_zone",
    )
    .eq("id", campusId)
    .maybeSingle();
  if (error) throw error;
  return data;
}


/**
 * Compact card payloads: keep only the first image per listing (cards render one),
 * signing private-bucket URLs in a single batched createSignedUrls call per bucket
 * instead of one storage round-trip per image. Prefers the 320px grid thumbnail
 * (<path>.thumb.webp, generated at upload) and falls back to the original for
 * listings created before thumbnails existed.
 */
export async function toListingCardRecords(
  deps: Pick<
    MarketplaceDeps,
    | "attachSellerTrust"
    | "normalizeListingRecord"
    | "normalizeStorageUrl"
    | "signStorageDisplayUrls"
  >,
  listings: any[],
): Promise<any[]> {
  const entries = listings.map((listing) => {
    const images = Array.isArray(listing.images) ? listing.images : [];
    const first =
      images.length > 0 ? deps.normalizeStorageUrl(images[0]) : null;
    let parsed: { bucket: string; path: string } | null = null;
    if (first && !first.startsWith("data:")) {
      const candidate = parseStoredStorageRef(first);
      if (candidate && isPrivateStorageBucket(candidate.bucket))
        parsed = candidate;
    }
    return { first, parsed, imageCount: images.length };
  });

  const refs = entries
    .map((entry, index) =>
      entry.parsed
        ? {
            bucket: entry.parsed.bucket,
            path: entry.parsed.path,
            index,
          }
        : null,
    )
    .filter(Boolean) as Array<{ bucket: string; path: string; index: number }>;

  const signedByIndex = await deps.signStorageDisplayUrls(refs, {
    expiresInSeconds: 60 * 60 * 24,
    variant: "thumb",
  });

  const cards = listings.map((listing, index) => {
    const entry = entries[index];
    const cardImage = entry
      ? (signedByIndex.get(index) ?? entry.first)
      : null;
    return {
      ...deps.normalizeListingRecord(listing),
      images: cardImage ? [cardImage] : [],
      image_count: entry?.imageCount ?? 0,
    };
  });

  // Phase 3 N: trust on the SELLER EMBED, not only on the creator profile.
  return deps.attachSellerTrust(cards);
}


/**
 * Attach `seller.trustLevel` / `seller.verificationLevel` to listing rows
 * (Phase 3 · N). One batched lookup for the whole page — creator_stats is
 * service-role only so this cannot be a PostgREST embed, and a per-row query
 * would be N+1 on every browse page.
 *
 * This lives OUTSIDE toListingCardRecords because that function only runs on
 * the `compact` response profile; the default `full` browse response returns
 * the search-RPC rows directly, and attaching trust only in the card builder
 * silently left trust off every default browse response.
 *
 * Idempotent: rows that already carry trust are returned untouched, so the
 * compact path (card builder + RPC branch) does not pay for it twice.
 */
export async function attachSellerTrust(
  deps: Pick<MarketplaceDeps, "fetchSellerTrust">,
  rows: any[],
): Promise<any[]> {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const needsTrust = rows.some(
    (row) => row?.seller && (row.seller as any).trustLevel === undefined,
  );
  if (!needsTrust) return rows;

  const trustBySeller = await deps.fetchSellerTrust(
    rows.map((row) => row?.user_id).filter(Boolean),
  );
  return rows.map((row) => {
    if (!row?.seller || (row.seller as any).trustLevel !== undefined) return row;
    const trust = trustBySeller.get(row.user_id);
    return {
      ...row,
      seller: {
        ...row.seller,
        trustLevel: trust?.trust_level ?? null,
        verificationLevel: trust?.verification_level ?? 0,
      },
    };
  });
}


/**
 * Trust level + verification for a set of sellers, batched and de-duplicated.
 * Never throws: a missing trust chip must not fail a browse page.
 */
export async function fetchSellerTrust(
  db: DataClient,
  sellerIds: string[],
): Promise<Map<string, { trust_level: string; verification_level: number }>> {
  const out = new Map<string, { trust_level: string; verification_level: number }>();
  const unique = [...new Set(sellerIds)].filter(Boolean);
  if (unique.length === 0) return out;
  try {
    const [statsResult, profilesResult] = await Promise.all([
      db
        .from("creator_stats")
        .select("user_id, trust_level")
        .in("user_id", unique),
      db
        .from("profiles")
        .select("id, verification_level")
        .in("id", unique),
    ]);
    const verificationById = new Map(
      (profilesResult.data || []).map((row: any) => [row.id, row.verification_level ?? 0]),
    );
    for (const row of statsResult.data || []) {
      out.set((row as any).user_id, {
        trust_level: (row as any).trust_level,
        verification_level: verificationById.get((row as any).user_id) ?? 0,
      });
    }
    // A seller with no creator_stats row yet still has a verification level.
    for (const id of unique) {
      if (!out.has(id) && verificationById.has(id)) {
        out.set(id, { trust_level: "new", verification_level: verificationById.get(id) ?? 0 });
      }
    }
  } catch (err) {
    logger.warn("seller trust lookup failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return out;
}


/** Trim a normalized listing row to the fields listing cards actually render. */
export function pickCompactListingFields(
  listing: any,
): any {
  const {
    id,
    user_id,
    category,
    title,
    description,
    price,
    sale_price,
    sale_ends_at,
    promo_label,
    effective_price,
    is_on_sale,
    location,
    campus_id,
    country_code,
    images,
    image_count,
    status,
    created_at,
    views_count,
    seller,
    is_boosted,
    category_specific_fields,
    quantity,
    rating_avg,
    rating_count,
  } = listing;
  return {
    id,
    user_id,
    category,
    title,
    description,
    price,
    sale_price,
    sale_ends_at,
    promo_label,
    effective_price,
    is_on_sale,
    location,
    campus_id,
    country_code,
    images,
    image_count,
    status,
    created_at,
    views_count,
    seller,
    is_boosted,
    quantity: quantity ?? null,
    // Rating aggregate for card stars; null until the ratings migration runs.
    rating_avg: rating_avg ?? null,
    rating_count: typeof rating_count === "number" ? rating_count : null,
    // Compact cards need condition + taxonomy node without shipping the
    // whole free-form blob.
    condition:
      (category_specific_fields &&
        (category_specific_fields.condition as string | undefined)) ||
      null,
    taxonomyNodeId:
      (category_specific_fields &&
        (category_specific_fields.taxonomyNodeId as string | undefined)) ||
      null,
  };
}


/**
 * marketplace_search_listings returns a FIXED column set that omits
 * listing_kind and quantity, so browse rows could not tell a digital listing
 * (question bank / study pack) from a physical one — which let digital
 * listings slip into physical-only flows such as bundle building. Backfill
 * both in one batched query rather than re-creating the RPC signature.
 */
export async function attachListingKinds(
  db: DataClient,
  rows: any[],
): Promise<any[]> {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const needs = rows.filter((r) => r && r.listing_kind === undefined);
  if (needs.length === 0) return rows;
  const ids = Array.from(new Set(needs.map((r) => String(r.id)).filter(Boolean)));
  if (ids.length === 0) return rows;
  try {
    const { data } = await db
      .from("marketplace_listings")
      .select("id, listing_kind, quantity")
      .in("id", ids);
    const byId = new Map(
      (data || []).map((l: any) => [String(l.id), l]),
    );
    for (const row of rows) {
      const extra = byId.get(String(row.id));
      if (!extra) continue;
      if (row.listing_kind === undefined) row.listing_kind = extra.listing_kind ?? "single";
      if (row.quantity === undefined) row.quantity = extra.quantity ?? null;
    }
  } catch (err) {
    logger.warn("Could not attach listing_kind to browse rows", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return rows;
}

/**
 * The 42703 a query pays when the rating aggregate columns are not there yet
 * (migration 20260828160000, applied by hand like every migration here). Pure,
 * so it moved; the ten-minute circuit breaker it feeds is instance state on
 * `SupabaseService` and stayed — see gotcha 2 in the banner.
 */
export function isMissingRatingColumn(error: any): boolean {
  return (
    error?.code === "42703" &&
    typeof error?.message === "string" &&
    error.message.includes("rating_")
  );
}


export async function getMarketplaceListings(
  db: DataClient,
  deps: Pick<
    MarketplaceDeps,
    | "attachListingKinds"
    | "attachSellerTrust"
    | "getResponseProfile"
    | "isMissingRatingColumn"
    | "normalizeListingRecordAsync"
    | "noteRatingColumnsMissing"
    | "pickCompactListingFields"
    | "ratingColumnsAvailable"
    | "toListingCardRecords"
  >,
  options: {
    page?: number;
    limit?: number;
    category?: string;
    categories?: string[];
    includeCustomCategories?: boolean;
    search?: string;
    minPrice?: number;
    maxPrice?: number;
    location?: string;
    campusId?: string;
    countryCode?: string;
    condition?: string;
    /** Keep only listings whose rating_avg is at least this (1–5). */
    minRating?: number;
    taxonomyNodeId?: string;
    taxonomyNodeIds?: string[];
    includeUnclassified?: boolean;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    responseProfile?: "compact" | "full";
  } = {},
): Promise<{ data: any[]; total: number }> {
  const {
    page = 1,
    limit = 20,
    category,
    categories,
    includeCustomCategories = false,
    search,
    minPrice,
    maxPrice,
    location,
    campusId,
    countryCode,
    condition,
    minRating,
    taxonomyNodeId,
    taxonomyNodeIds,
    includeUnclassified = false,
    sortBy = "trending",
    sortOrder = "desc",
    responseProfile = "full",
  } = options;
  const profile = deps.getResponseProfile(responseProfile);

  const offset = (page - 1) * limit;
  const categoryList =
    categories && categories.length > 0 ? categories : undefined;

  const taxonomyFilter =
    taxonomyNodeId && isKnownTaxonomyNodeId(taxonomyNodeId)
      ? taxonomyNodeId
      : undefined;
  // Group browse: the set of leaves under the node the buyer opened. Unknown
  // ids are dropped rather than passed through, so a stale client cannot turn
  // a browse into a filter that matches nothing.
  const taxonomyFilterList =
    taxonomyNodeIds && taxonomyNodeIds.length > 0
      ? taxonomyNodeIds.filter((id) => isKnownTaxonomyNodeId(id))
      : undefined;

  // Condition and taxonomy node live inside category_specific_fields JSONB,
  // which the search RPC can't filter on — those queries use the fallback
  // path (degrading trending to created_at). Rating sort/filter also go
  // through the fallback: the pre-migration RPC would silently coerce an
  // unknown sort to trending, which is worse than an honest degradation.
  const wantsRatingQuery = sortBy === "rating" || minRating !== undefined;
  const useSearchRpc =
    !condition &&
    !taxonomyFilter &&
    !taxonomyFilterList?.length &&
    !wantsRatingQuery &&
    (Boolean(search) ||
      Boolean(category) ||
      Boolean(categoryList) ||
      minPrice !== undefined ||
      maxPrice !== undefined ||
      Boolean(location) ||
      sortBy === "trending" ||
      sortBy === "sale_first");

  if (useSearchRpc) {
    const { data: rpcRows, error: rpcError } = await db.rpc(
      "marketplace_search_listings",
      {
        p_search: search || "",
        p_page: page,
        p_limit: limit,
        p_category: category || null,
        p_min_price: minPrice ?? null,
        p_max_price: maxPrice ?? null,
        p_location: location || null,
        p_sort_by: sortBy,
        p_sort_order: sortOrder,
        p_campus_id: campusId || null,
        p_country_code: countryCode || null,
        p_categories: categoryList ?? null,
        p_include_custom: includeCustomCategories,
      },
    );

    if (!rpcError && rpcRows) {
      const rows = rpcRows as any[];
      const total =
        rows.length > 0 ? Number(rows[0].total_count) || rows.length : 0;
      const mapped = await deps.attachListingKinds(
        rows.map((row) => {
          const { total_count: _totalCount, profiles, ...rest } = row;
          return { ...rest, seller: profiles || row.seller };
        }),
      );
      if (profile === "compact") {
        const cards = await deps.toListingCardRecords(mapped);
        return {
          data: cards.map((row) => deps.pickCompactListingFields(row)),
          total,
        };
      }
      // The `full` profile returns the RPC rows directly and never reaches
      // toListingCardRecords, so trust has to be attached here too — this is
      // the DEFAULT browse response.
      return { data: await deps.attachSellerTrust(mapped), total };
    }
    if (rpcError) {
      console.warn(
        "marketplace_search_listings RPC failed, falling back to ilike query",
        rpcError.message,
      );
    }
  }

  const buildFallbackQuery = (withRatings: boolean) => {
    const selectClause =
      profile === "compact"
        ? `
      id,
      user_id,
      category,
      title,
      description,
      price,
      sale_price,
      sale_ends_at,
      promo_label,
      location,
      campus_id,
      country_code,
      images,
      created_at,
      status,
      views_count,
      quantity,
      category_specific_fields,${withRatings ? "\n        rating_avg,\n        rating_count," : ""}
      seller:profiles!user_id (
        id,
        name,
        avatar_url
      )
    `
        : `
      *,
      seller:profiles!user_id (
        id,
        name,
        avatar_url
      )
    `;

    let query = db
      .from("marketplace_listings")
      .select(selectClause, { count: "exact" })
      // Reserved stays visible (sale in progress) but purchase APIs still require active.
      .in("status", ["active", "reserved"])
      .range(offset, offset + limit - 1);

    if (countryCode) {
      query = query.eq("country_code", countryCode);
    }

    if (campusId) {
      query = query.eq("campus_id", campusId);
    }

    if (category) {
      query = query.eq("category", category);
    } else if (categoryList) {
      const inList = `category.in.(${categoryList.join(",")})`;
      query = includeCustomCategories
        ? query.or(`${inList},category.like.custom:*`)
        : query.or(inList);
    }

    if (search) {
      query = query.ilike("title", `%${search}%`);
    }

    if (minPrice !== undefined) {
      query = query.gte("price", minPrice);
    }

    if (maxPrice !== undefined) {
      query = query.lte("price", maxPrice);
    }

    if (location) {
      query = query.ilike("location", `%${location}%`);
    }

    if (condition) {
      query = query.eq("category_specific_fields->>condition", condition);
    }

    if (taxonomyFilter) {
      // Node ids contain dots; quote the eq value so PostgREST does not split
      // `academic.materials.textbooks.course` into extra filter segments.
      const quoted = `"${taxonomyFilter.replace(/"/g, "")}"`;
      query = includeUnclassified
        ? query.or(
            `category_specific_fields->>taxonomyNodeId.eq.${quoted},category_specific_fields->>taxonomyNodeId.is.null`,
          )
        : query.eq("category_specific_fields->>taxonomyNodeId", taxonomyFilter);
    } else if (taxonomyFilterList && taxonomyFilterList.length > 0) {
      // A group browse never also asks for unfiled rows: a node either owns
      // its whole listing category — in which case the category filter alone
      // already says it, and unfiled rows belong — or it owns only part of
      // one, in which case an unfiled row cannot be placed inside it. So a
      // plain IN is enough here, and the client escapes the values.
      query = query.in(
        "category_specific_fields->>taxonomyNodeId",
        taxonomyFilterList,
      );
    }

    // Pre-migration the rating columns do not exist: the filter is skipped
    // and the sort degrades to newest — the same honest degradation trending
    // already makes on this path.
    if (withRatings && minRating !== undefined) {
      query = query.gte("rating_avg", minRating);
    }

    if (sortBy === "rating" && withRatings) {
      // "Top rated" is always best-first; unrated listings sink to the end.
      query = query
        .order("rating_avg", { ascending: false, nullsFirst: false })
        .order("rating_count", { ascending: false })
        .order("created_at", { ascending: false });
    } else {
      // Fallback path: trending/sale_first require the RPC; degrade to created_at.
      const fallbackSort =
        sortBy === "trending" || sortBy === "sale_first" || sortBy === "rating"
          ? "created_at"
          : sortBy;
      const fallbackAscending =
        sortBy === "rating" ? false : sortOrder === "asc";
      query = query.order(fallbackSort, { ascending: fallbackAscending });
    }

    return query;
  };

  const attemptRatings = deps.ratingColumnsAvailable();
  let { data, error, count } = await buildFallbackQuery(attemptRatings);
  if (error && attemptRatings && deps.isMissingRatingColumn(error)) {
    deps.noteRatingColumnsMissing();
    ({ data, error, count } = await buildFallbackQuery(false));
  }
  if (error) throw error;

  const rows = data || [];
  const total = count ?? rows.length;

  if (profile === "compact") {
    const cards = await deps.toListingCardRecords(rows);
    return {
      data: cards.map((row) => deps.pickCompactListingFields(row)),
      total,
    };
  }

  const normalized = await Promise.all(
    rows.map((listing: any) => deps.normalizeListingRecordAsync(listing)),
  );
  // Phase 3 N: the FALLBACK path (condition filters, and any sort the RPC
  // cannot serve) has to attach trust too. Doing it only on the RPC branch
  // meant a shipped filter silently returned listings with no trust at all.
  return { data: await deps.attachSellerTrust(normalized), total };
}


/** Batch fetch of active listings by id (recently-viewed rail). Card-shaped payloads. */
export async function getMarketplaceListingsByIds(
  db: DataClient,
  deps: Pick<
    MarketplaceDeps,
    | "isMissingRatingColumn"
    | "noteRatingColumnsMissing"
    | "pickCompactListingFields"
    | "ratingColumnsAvailable"
    | "toListingCardRecords"
  >,
  ids: string[],
): Promise<any[]> {
  if (ids.length === 0) return [];
  const buildBatchQuery = (withRatings: boolean) =>
    db
      .from("marketplace_listings")
      .select(
        `
      id,
      user_id,
      category,
      title,
      description,
      price,
      sale_price,
      sale_ends_at,
      promo_label,
      location,
      campus_id,
      country_code,
      images,
      created_at,
      status,
      views_count,
      quantity,
      category_specific_fields,${withRatings ? "\n        rating_avg,\n        rating_count," : ""}
      seller:profiles!user_id (
        id,
        name,
        avatar_url
      )
    `,
      )
      .in("id", ids)
      .eq("status", "active");

  const attemptRatings = deps.ratingColumnsAvailable();
  let { data, error } = await buildBatchQuery(attemptRatings);
  if (error && attemptRatings && deps.isMissingRatingColumn(error)) {
    deps.noteRatingColumnsMissing();
    ({ data, error } = await buildBatchQuery(false));
  }
  if (error) throw error;

  const cards = await deps.toListingCardRecords(data || []);
  const byId = new Map(
    cards.map((row: any) => [row.id, deps.pickCompactListingFields(row)]),
  );
  // Preserve the caller's id order (most recently viewed first).
  return ids.map((id) => byId.get(id)).filter(Boolean);
}


/**
 * Related listings for a product page: same category plus same course,
 * ranked by campus / course / taxonomy / price proximity.
 */
export async function getRelatedMarketplaceListings(
  deps: Pick<
    MarketplaceDeps,
    | "getRelatedMarketplaceListingsInner"
    | "isMissingRatingColumn"
    | "noteRatingColumnsMissing"
    | "ratingColumnsAvailable"
  >,
  listing: {
    id: string;
    category?: string;
    campus_id?: string | null;
    course_id?: string | null;
    price?: number | null;
    category_specific_fields?: Record<string, unknown> | null;
  },
  limit = 6,
): Promise<any[]> {
  try {
    return await deps.getRelatedMarketplaceListingsInner(listing, limit);
  } catch (error) {
    // Pre-migration: rating columns in the select 42703 — degrade and retry.
    if (deps.ratingColumnsAvailable() && deps.isMissingRatingColumn(error)) {
      deps.noteRatingColumnsMissing();
      return deps.getRelatedMarketplaceListingsInner(listing, limit);
    }
    throw error;
  }
}


export async function getRelatedMarketplaceListingsInner(
  deps: Pick<
    MarketplaceDeps,
    "getClient" | "ratingColumnsAvailable" | "signSimilarListingCards"
  >,
  listing: {
    id: string;
    category?: string;
    campus_id?: string | null;
    course_id?: string | null;
    price?: number | null;
    category_specific_fields?: Record<string, unknown> | null;
  },
  limit = 6,
): Promise<any[]> {
  const client = deps.getClient();
  const similarSelect =
    "id, title, price, images, category, location, campus_id, category_specific_fields, created_at, status" +
    (deps.ratingColumnsAvailable() ? ", rating_avg, rating_count" : "");

  let sameCategory: any[] = [];
  if (listing.category) {
    const { data, error } = await client
      .from("marketplace_listings")
      .select(similarSelect)
      .eq("category", listing.category)
      .eq("status", "active")
      .neq("id", listing.id)
      .order("created_at", { ascending: false })
      .limit(24);
    if (error) throw error;
    sameCategory = data || [];
  }

  let sameCourse: any[] = [];
  const courseId = listing.course_id;
  if (courseId) {
    const { data, error } = await client
      .from("marketplace_listings")
      .select(similarSelect)
      .eq("course_id", courseId)
      .eq("status", "active")
      .neq("id", listing.id)
      .order("created_at", { ascending: false })
      .limit(12);
    if (!error) {
      sameCourse = data || [];
    }
  }

  let sameCampus: any[] = [];
  if (listing.campus_id) {
    const { data } = await client
      .from("marketplace_listings")
      .select(similarSelect)
      .eq("campus_id", listing.campus_id)
      .eq("status", "active")
      .neq("id", listing.id)
      .order("created_at", { ascending: false })
      .limit(12);
    sameCampus = data || [];
  }

  const byId = new Map<string, any>();
  for (const row of [...sameCategory, ...sameCourse, ...sameCampus]) {
    if (row?.id) byId.set(row.id, row);
  }
  const ranked = rankRelatedListings(
    listing,
    Array.from(byId.values()),
    limit,
  );
  return deps.signSimilarListingCards(ranked);
}


export async function getMarketplaceCategoryAnalytics(
  db: DataClient,
): Promise<
  Array<{
    category: string;
    total: number;
    active: number;
    sold: number;
  }>
> {
  const { data, error } = await db.rpc(
    "marketplace_category_analytics",
  );
  if (!error && data) {
    return (data as any[]).map((row) => ({
      category: String(row.category || "unknown"),
      total: Number(row.total) || 0,
      active: Number(row.active) || 0,
      sold: Number(row.sold) || 0,
    }));
  }
  if (error) {
    console.warn(
      "marketplace_category_analytics RPC failed, falling back to full scan",
      error.message,
    );
  }

  const { data: rows, error: scanError } = await db
    .from("marketplace_listings")
    .select("category, status");
  if (scanError) throw scanError;

  const counts = new Map<
    string,
    { total: number; active: number; sold: number }
  >();
  for (const row of rows || []) {
    const category = String(row.category || "unknown");
    const entry = counts.get(category) || { total: 0, active: 0, sold: 0 };
    entry.total += 1;
    if (row.status === "active") entry.active += 1;
    if (row.status === "sold") entry.sold += 1;
    counts.set(category, entry);
  }

  return Array.from(counts.entries())
    .map(([category, stats]) => ({ category, ...stats }))
    .sort((a, b) => b.total - a.total);
}


export async function getMarketplaceListingById(
  db: DataClient,
  deps: Pick<
    MarketplaceDeps,
    "attachSellerTrust" | "normalizeListingRecordAsync"
  >,
  listingId: string,
  options?: { requireActive?: boolean },
): Promise<any | null> {
  let query = db
    .from("marketplace_listings")
    .select(
      `
      *,
      seller:profiles!user_id (
        id,
        name,
        avatar_url
      ),
      campus:marketplace_campuses!campus_id (
        id,
        name,
        city,
        state,
        slug,
        country_code,
        geopolitical_zone
      )
    `,
    )
    .eq("id", listingId);

  if (options?.requireActive) {
    query = query.eq("status", "active");
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }

  if (!data) return null;
  // Phase 3 N: the listing DETAIL seller row is where a buyer decides whether
  // to trust the seller, so it carries the trust chip too. attachSellerTrust
  // is idempotent and batched; here the batch is one row.
  const normalized = await deps.normalizeListingRecordAsync(data);
  const [withTrust] = await deps.attachSellerTrust([normalized]);
  return withTrust ?? normalized;
}


/**
 * Public marketplace detail: active listings for anyone; owners/admins may view non-active.
 */
export async function getMarketplaceListingForViewer(
  deps: Pick<MarketplaceDeps, "getMarketplaceListingById" | "isPlatformAdmin">,
  listingId: string,
  viewerId?: string | null,
): Promise<any | null> {
  const listing = await deps.getMarketplaceListingById(listingId);
  if (!listing) return null;

  // Reserved = sale in progress: visible (read-only), but buy/offer paths still require active.
  if (listing.status === "active" || listing.status === "reserved") return listing;

  if (!viewerId) return null;

  if (listing.user_id === viewerId) return listing;

  const isAdmin = await deps.isPlatformAdmin(viewerId).catch(() => false);
  return isAdmin ? listing : null;
}


export async function createMarketplaceListing(
  db: DataClient,
  deps: Pick<MarketplaceDeps, "resolveArtefactTopic">,
  listingData: any,
  userId: string,
): Promise<any> {
  const { normalizeMarketplacePricing } =
    await import("../../utils/marketplacePricing");
  const campusId = listingData.campus_id ?? listingData.campusId;
  if (!campusId) {
    // FIXED (G3 · H0c): a bare Error here reached POST /listings as a generic
    // 500 "Something went wrong" once R5a's `isPlainValidation` heuristic was
    // removed — a seller who left the campus/city out was told the server
    // broke, and their bad input paged 5xx alerting. It is the caller's
    // problem and says so.
    throw new PublicError("Campus or city metadata is required");
  }
  const pricing = normalizeMarketplacePricing({
    price: listingData.price,
    sale_price: listingData.sale_price,
    salePrice: listingData.salePrice,
  });
  // Mass-assignment guard: validate/strip client-supplied fields that are
  // otherwise written verbatim into privileged columns.
  const listingKind =
    listingData.listing_kind || listingData.listingKind || "single";
  assertValidListingKind(listingKind);
  assertValidListingQuantity(listingData.quantity);
  assertValidBundleItems(
    listingData.bundle_items ?? listingData.bundleItems,
  );
  // Academic archive reference, plus the topic inside it — rejected (400)
  // when the topic belongs to another course, or to no course at all.
  const courseId = listingData.course_id ?? listingData.courseId ?? null;
  const topicId = await deps.resolveArtefactTopic({
    topicId:
      listingData.topic_id !== undefined
        ? listingData.topic_id
        : listingData.topicId,
    courseId,
  });
  // Transform camelCase to snake_case for database columns
  const dbData = {
    user_id: userId,
    category: listingData.category,
    title: listingData.title,
    description: listingData.description,
    price: pricing.price,
    sale_price: pricing.sale_price,
    sale_ends_at:
      pricing.sale_price != null
        ? (listingData.sale_ends_at ?? listingData.saleEndsAt ?? null)
        : null,
    promo_label: listingData.promo_label ?? listingData.promoLabel,
    location: listingData.location,
    campus_id: campusId,
    country_code: MARKETPLACE_DEFAULT_COUNTRY,
    currency: MARKETPLACE_DEFAULT_CURRENCY,
    images: sanitizeListingImages(listingData.images),
    category_specific_fields: stripServerOwnedListingFields(
      listingData.categorySpecificFields ||
        listingData.category_specific_fields ||
        {},
    ),
    listing_kind: listingKind,
    bundle_items: listingData.bundle_items || listingData.bundleItems || [],
    quantity: listingData.quantity ?? null,
    status: listingData.status || "active",
    // Academic archive reference (validated as UUID by the route).
    course_id: courseId,
    ...(topicId !== undefined ? { topic_id: topicId } : {}),
    // Rights attestation state — SERVER-SET by the route / publish service
    // (services/moderation.ts listingRightsFields); the route strips any
    // client-supplied rights_* keys before they reach here. Defaults to the
    // unattested state so a plain (non-academic) listing is honest too.
    rights_status: listingData.rights_status ?? "unattested",
    rights_attested_at: listingData.rights_attested_at ?? null,
    rights_attestation_version: listingData.rights_attestation_version ?? null,
  };

  const { data, error } = await writeWithTopicFallback(
    (row) =>
      db.from("marketplace_listings").insert(row).select().single(),
    dbData,
  );

  if (error) {
    logger.error("Failed to create marketplace listing:", error);
    throw error;
  }
  return data;
}


export async function updateMarketplaceListing(
  db: DataClient,
  deps: Pick<
    MarketplaceDeps,
    "getMarketplaceListingById" | "maybeLogManualSoldBudget"
  >,
  listingId: string,
  updates: any,
  options: { actorIsAdmin?: boolean } = {},
): Promise<any | null> {
  // Sellers cannot edit a listing moderation took down, nor move any listing
  // along a transition the shared lifecycle table forbids (e.g. relisting a
  // removed one by smuggling status into an edit). Admin callers keep full
  // control; routes/admin.ts writes with the raw client anyway.
  if (!options.actorIsAdmin) {
    await assertSellerListingUpdateAllowed(deps, listingId, updates?.status);
  }
  const dbUpdates: Record<string, unknown> = {};
  const assign = (key: string, ...sources: string[]) => {
    for (const source of sources) {
      if (updates?.[source] !== undefined) {
        dbUpdates[key] = updates[source];
        return;
      }
    }
  };

  assign("category", "category");
  assign("title", "title");
  assign("description", "description");
  assign("promo_label", "promo_label", "promoLabel");
  assign("location", "location");
  if (
    (updates?.campus_id !== undefined || updates?.campusId !== undefined) &&
    !(updates.campus_id ?? updates.campusId)
  ) {
    throw new Error("Campus or city metadata cannot be removed");
  }
  assign("campus_id", "campus_id", "campusId");
  if (
    updates?.country_code !== undefined ||
    updates?.countryCode !== undefined
  ) {
    dbUpdates.country_code = MARKETPLACE_DEFAULT_COUNTRY;
  }
  if (updates?.currency !== undefined) {
    dbUpdates.currency = MARKETPLACE_DEFAULT_CURRENCY;
  }
  if (updates?.images !== undefined) {
    dbUpdates.images = sanitizeListingImages(updates.images);
  }
  // Mass-assignment guard on category_specific_fields: strip client-supplied
  // boost/promotion keys, but preserve any existing server-owned boost state
  // so a routine edit doesn't silently wipe a paid boost.
  if (
    updates?.categorySpecificFields !== undefined ||
    updates?.category_specific_fields !== undefined
  ) {
    const clientFields = stripServerOwnedListingFields(
      updates.categorySpecificFields ?? updates.category_specific_fields,
    );
    const current = await deps.getMarketplaceListingById(listingId);
    const preserved = pickServerOwnedListingFields(
      current?.category_specific_fields ??
        current?.categorySpecificFields,
    );
    dbUpdates.category_specific_fields = { ...clientFields, ...preserved };
  }
  // listing_kind is immutable after create: allowing a client to change it
  // (e.g. flip a 'single' to 'question_bank') would orphan/misroute the
  // listing. Deliberately not assigned here.
  if (
    updates?.bundle_items !== undefined ||
    updates?.bundleItems !== undefined
  ) {
    const bundleItems = updates.bundle_items ?? updates.bundleItems;
    assertValidBundleItems(bundleItems);
    dbUpdates.bundle_items = bundleItems;
  }
  if (updates?.quantity !== undefined) {
    assertValidListingQuantity(updates.quantity);
    dbUpdates.quantity = updates.quantity;
  }
  assign("status", "status");

  const touchesPricing =
    updates?.price !== undefined ||
    updates?.sale_price !== undefined ||
    updates?.salePrice !== undefined ||
    updates?.sale_ends_at !== undefined ||
    updates?.saleEndsAt !== undefined;
  if (touchesPricing) {
    const { normalizeMarketplacePricing } =
      await import("../../utils/marketplacePricing");
    const current = await deps.getMarketplaceListingById(listingId);
    const pricing = normalizeMarketplacePricing({
      price: updates?.price !== undefined ? updates.price : current?.price,
      sale_price:
        updates?.sale_price !== undefined || updates?.salePrice !== undefined
          ? (updates.sale_price ?? updates.salePrice)
          : current?.sale_price,
    });
    dbUpdates.price = pricing.price;
    dbUpdates.sale_price = pricing.sale_price;
    if (pricing.sale_price == null) {
      dbUpdates.sale_ends_at = null;
    } else if (
      updates?.sale_ends_at !== undefined ||
      updates?.saleEndsAt !== undefined
    ) {
      dbUpdates.sale_ends_at = updates.sale_ends_at ?? updates.saleEndsAt;
    }
  }

  if (Object.keys(dbUpdates).length === 0) {
    return deps.getMarketplaceListingById(listingId);
  }

  const { data, error } = await db
    .from("marketplace_listings")
    .update(dbUpdates)
    .eq("id", listingId)
    .select()
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }

  if (updates?.status === "sold" && data?.user_id) {
    await deps.maybeLogManualSoldBudget(listingId, data.user_id);
  }

  return data;
}


export async function deleteMarketplaceListing(
  db: DataClient,
  listingId: string,
): Promise<boolean> {
  const { error } = await db
    .from("marketplace_listings")
    .delete()
    .eq("id", listingId);

  if (error) throw error;
  return true;
}


/**
 * Delete a listing without destroying order history. marketplace_orders.listing_id
 * is ON DELETE CASCADE, so a raw delete of a listing hard-deletes every order on
 * it — including paid/completed ones with their receipts and payment evidence.
 * Guard at the application layer:
 *   - any OPEN order (money moving, pickup pending, or a dispute) → block (409)
 *   - only terminal orders (completed/cancelled) → archive the listing, keeping
 *     the rows and their receipts intact
 *   - no orders at all → hard-delete
 * Defense-in-depth at the DB layer (FK → ON DELETE RESTRICT) ships as an
 * unapplied migration.
 */
export async function deleteMarketplaceListingSafely(
  db: DataClient,
  deps: Pick<MarketplaceDeps, "deleteMarketplaceListing">,
  listingId: string,
): Promise<{ outcome: "deleted" | "archived"; openOrders: number; totalOrders: number }> {
  const { data: orderRows, error } = await db
    .from("marketplace_orders")
    .select("status")
    .eq("listing_id", listingId);
  if (error) throw error;

  const rows = (orderRows || []) as Array<{ status: string }>;
  const openOrders = rows.filter((r) =>
    OPEN_ORDER_STATUSES.includes(r.status),
  ).length;

  if (openOrders > 0) {
    const err = new Error(
      `This listing has ${openOrders} active order${openOrders === 1 ? "" : "s"} in progress. Cancel or complete them before removing the listing.`,
    ) as Error & { statusCode: number };
    err.statusCode = 409;
    throw err;
  }

  if (rows.length > 0) {
    // Terminal orders exist — preserve their receipts/payment evidence by
    // archiving the listing instead of cascade-deleting.
    const { error: archiveError } = await db
      .from("marketplace_listings")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("id", listingId);
    if (archiveError) throw archiveError;
    return { outcome: "archived", openOrders: 0, totalOrders: rows.length };
  }

  await deps.deleteMarketplaceListing(listingId);
  return { outcome: "deleted", openOrders: 0, totalOrders: 0 };
}


/**
 * Count/return new listings matching a saved search since it was last checked.
 *
 * `peek` distinguishes a badge poll (Explore opening) from a "mark as seen"
 * action. The background alerts job (marketplaceAlerts) uses last_checked_at
 * as its notification cursor, so a consuming poll would advance the watermark
 * past every new listing and the job would never notify. A peek returns the
 * same count without touching last_checked_at.
 *
 * Returns null when the saved search doesn't exist or isn't owned by the user.
 */
export async function getSavedSearchMatches(
  db: DataClient,
  userId: string,
  searchId: string,
  options: { peek?: boolean } = {},
): Promise<{ count: number; listings: any[] } | null> {
  const { data: search, error: searchErr } = await db
    .from("saved_searches")
    .select("*")
    .eq("id", searchId)
    .eq("user_id", userId)
    .single();

  if (searchErr || !search) return null;

  // Fall back to created_at when the search has never been checked — mirrors
  // the alerts job, and avoids a null comparison that would return nothing.
  const since = search.last_checked_at || search.created_at;

  let query = db
    .from("marketplace_listings")
    .select("id, title, price, images, category, location, created_at")
    .eq("status", "active")
    .gt("created_at", since);

  const f = (search.filters || {}) as Record<string, any>;
  if (f.category) query = query.eq("category", f.category);
  if (f.search)
    query = query.or(
      `title.ilike.%${f.search}%,description.ilike.%${f.search}%`,
    );
  if (f.minPrice) query = query.gte("price", f.minPrice);
  if (f.maxPrice) query = query.lte("price", f.maxPrice);
  if (f.location) query = query.ilike("location", `%${f.location}%`);

  query = query.order("created_at", { ascending: false }).limit(20);

  const { data: listings, error: listErr } = await query;
  if (listErr) throw listErr;

  if (!options.peek) {
    await db
      .from("saved_searches")
      .update({ last_checked_at: new Date().toISOString() })
      .eq("id", searchId);
  }

  return { count: listings?.length || 0, listings: listings || [] };
}


/**
 * Verified-purchase check: a review requires a delivered order
 * (buyer_confirmed/completed) or an inquiry the seller marked purchased —
 * the legacy chat-deal path predating orders. Sellers cannot review
 * their own listings.
 */
export async function canUserReviewListing(
  db: DataClient,
  deps: Pick<MarketplaceDeps, "getMarketplaceListingById">,
  listingId: string,
  userId: string,
): Promise<{ eligible: boolean; reason?: string }> {
  const listing = await deps.getMarketplaceListingById(listingId);
  if (!listing) return { eligible: false, reason: "Listing not found" };
  if (listing.user_id === userId || listing.seller_id === userId) {
    return { eligible: false, reason: "You cannot review your own listing" };
  }

  const { data: orderRows, error: orderError } = await db
    .from("marketplace_orders")
    .select("id")
    .eq("listing_id", listingId)
    .eq("buyer_id", userId)
    .in("status", ["buyer_confirmed", "completed"])
    .limit(1);
  if (orderError) throw orderError;
  if (orderRows && orderRows.length > 0) return { eligible: true };

  // Phase 2 G defect the plan called out: eligibility was order-only, so
  // somebody who acquired a FREE digital product owns it, has studied it, and
  // still could not review it — no order row ever existed. An entitlement is
  // the same proof of delivery for digital goods that a completed order is
  // for physical ones.
  const { data: entitlementRows, error: entitlementError } = await db
    .from("marketplace_question_bank_entitlements")
    .select("listing_id")
    .eq("listing_id", listingId)
    .eq("user_id", userId)
    .limit(1);
  if (entitlementError) throw entitlementError;
  if (entitlementRows && entitlementRows.length > 0) return { eligible: true };

  const { data: inquiryRows, error: inquiryError } = await db
    .from("marketplace_inquiries")
    .select("id")
    .eq("listing_id", listingId)
    .eq("buyer_id", userId)
    .eq("status", "purchased")
    .limit(1);
  if (inquiryError) throw inquiryError;
  if (inquiryRows && inquiryRows.length > 0) return { eligible: true };

  return {
    eligible: false,
    reason: "Reviews are limited to buyers who completed a purchase",
  };
}


export async function addMarketplaceReview(
  db: DataClient,
  deps: Pick<
    MarketplaceDeps,
    "canUserReviewListing" | "recordLearningConnection"
  >,
  listingId: string,
  reviewerId: string,
  review: { rating: number; comment?: string },
): Promise<any> {
  const rating = Number(review.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    const err: any = new Error("Rating must be a whole number from 1 to 5");
    err.statusCode = 400;
    throw err;
  }
  if (review.comment != null && String(review.comment).length > 2000) {
    const err: any = new Error("Comment is too long (2000 characters max)");
    err.statusCode = 400;
    throw err;
  }

  const eligibility = await deps.canUserReviewListing(listingId, reviewerId);
  if (!eligibility.eligible) {
    const err: any = new Error(
      eligibility.reason || "You are not eligible to review this listing",
    );
    err.statusCode = 403;
    throw err;
  }

  const { MARKETPLACE_REVIEW_SELECT, mapMarketplaceReviewRow } =
    await import("../marketplaceReviewMapping");
  const { data, error } = await db
    .from("marketplace_reviews")
    .upsert(
      {
        listing_id: listingId,
        reviewer_id: reviewerId,
        rating,
        comment: review.comment,
      },
      { onConflict: "listing_id,reviewer_id" },
    )
    .select(MARKETPLACE_REVIEW_SELECT)
    .single();

  if (error) throw error;

  // North-star metric (Phase 3 · O): the SELLER is the actor — their product
  // is what helped the buyer, and the review is the evidence. Note this is an
  // UPSERT, so editing a review re-runs it; the weekly unique index collapses
  // same-week edits, and an edit months later is a fresh, honest signal.
  try {
    const { data: listingRow } = await db
      .from("marketplace_listings")
      .select("user_id, course_id")
      .eq("id", listingId)
      .maybeSingle();
    const sellerId = (listingRow as { user_id?: string } | null)?.user_id;
    if (sellerId) {
      await deps.recordLearningConnection({
        actorId: sellerId,
        beneficiaryId: reviewerId,
        kind: "review_left",
        // object_type must describe object_id. Every other writer pairs them
        // ('challenge'+challengeId, 'question'+messageId); `listingId` is a
        // listing id, so 'review' here would mislabel it.
        objectType: "listing",
        objectId: listingId,
        courseId: (listingRow as { course_id?: string | null } | null)?.course_id ?? null,
      });
    }
  } catch {
    /* metric is best-effort; the review already committed */
  }

  return mapMarketplaceReviewRow(data as any);
}


export async function getMarketplaceReviews(
  db: DataClient,
  deps: Pick<MarketplaceDeps, "attachMarketplaceReviewSignals">,
  listingId: string,
  viewerId?: string,
): Promise<any[]> {
  const { MARKETPLACE_REVIEW_SELECT, mapMarketplaceReviewRow } =
    await import("../marketplaceReviewMapping");
  const { data, error } = await db
    .from("marketplace_reviews")
    .select(MARKETPLACE_REVIEW_SELECT)
    .eq("listing_id", listingId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const reviews = (data || []).map((row: any) => mapMarketplaceReviewRow(row));
  return deps.attachMarketplaceReviewSignals(listingId, reviews, viewerId);
}


/**
 * Decorate mapped review rows with read-time signals:
 * - verifiedPurchase: the reviewer holds one of the same proofs the write
 *   gate (canUserReviewListing) accepts — delivered order, digital
 *   entitlement, or a seller-confirmed 'purchased' inquiry.
 * - helpfulCount / viewerMarkedHelpful from marketplace_review_votes.
 * Every lookup is best-effort: a missing votes table (migration not applied
 * yet) or a failed join must never block the review list — the fields are
 * simply absent and clients hide the corresponding UI.
 */
export async function attachMarketplaceReviewSignals(
  db: DataClient,
  listingId: string,
  reviews: any[],
  viewerId?: string,
): Promise<any[]> {
  if (reviews.length === 0) return reviews;

  const reviewIds = reviews.map((review) => review.id).filter(Boolean);
  const reviewerIds = [
    ...new Set(reviews.map((review) => review.reviewer_id).filter(Boolean)),
  ];

  let votesByReview: Map<string, number> | null = null;
  const viewerVoted = new Set<string>();
  try {
    const { data: voteRows, error: voteError } = await db
      .from("marketplace_review_votes")
      .select("review_id, voter_id")
      .in("review_id", reviewIds);
    if (voteError) throw voteError;
    votesByReview = new Map();
    for (const row of voteRows || []) {
      const reviewId = (row as any).review_id as string;
      votesByReview.set(reviewId, (votesByReview.get(reviewId) ?? 0) + 1);
      if (viewerId && (row as any).voter_id === viewerId) {
        viewerVoted.add(reviewId);
      }
    }
  } catch {
    votesByReview = null; // table missing pre-migration, or transient failure
  }

  const verifiedReviewers = new Set<string>();
  if (reviewerIds.length > 0) {
    try {
      const [orders, entitlements, inquiries] = await Promise.all([
        db
          .from("marketplace_orders")
          .select("buyer_id")
          .eq("listing_id", listingId)
          .in("buyer_id", reviewerIds)
          .in("status", ["buyer_confirmed", "completed"]),
        db
          .from("marketplace_question_bank_entitlements")
          .select("user_id")
          .eq("listing_id", listingId)
          .in("user_id", reviewerIds),
        db
          .from("marketplace_inquiries")
          .select("buyer_id")
          .eq("listing_id", listingId)
          .in("buyer_id", reviewerIds)
          .eq("status", "purchased"),
      ]);
      for (const row of orders.data || []) {
        verifiedReviewers.add((row as any).buyer_id);
      }
      for (const row of entitlements.data || []) {
        verifiedReviewers.add((row as any).user_id);
      }
      for (const row of inquiries.data || []) {
        verifiedReviewers.add((row as any).buyer_id);
      }
      return reviews.map((review) => ({
        ...review,
        verifiedPurchase: verifiedReviewers.has(review.reviewer_id),
        ...(votesByReview
          ? {
              helpfulCount: votesByReview.get(review.id) ?? 0,
              ...(viewerId
                ? { viewerMarkedHelpful: viewerVoted.has(review.id) }
                : {}),
            }
          : {}),
      }));
    } catch {
      // fall through: return reviews with vote data only (if any)
    }
  }

  if (!votesByReview) return reviews;
  return reviews.map((review) => ({
    ...review,
    helpfulCount: votesByReview!.get(review.id) ?? 0,
    ...(viewerId ? { viewerMarkedHelpful: viewerVoted.has(review.id) } : {}),
  }));
}


/**
 * Add or remove the viewer's "helpful" reaction on a review.
 * 404 unknown review, 400 self-vote, 503 while the votes table has not been
 * migrated yet (clients never show the control in that state).
 */
export async function setMarketplaceReviewVote(
  db: DataClient,
  listingId: string,
  reviewId: string,
  voterId: string,
  helpful: boolean,
): Promise<{ helpfulCount: number; viewerMarkedHelpful: boolean }> {
  const { data: review, error: reviewError } = await db
    .from("marketplace_reviews")
    .select("id, listing_id, reviewer_id")
    .eq("id", reviewId)
    .maybeSingle();
  if (reviewError) throw reviewError;
  if (!review || (review as any).listing_id !== listingId) {
    const err: any = new Error("Review not found");
    err.statusCode = 404;
    throw err;
  }
  if ((review as any).reviewer_id === voterId) {
    const err: any = new Error("You cannot mark your own review as helpful");
    err.statusCode = 400;
    throw err;
  }

  const missingTable = (error: any) =>
    error?.code === "42P01" || error?.code === "PGRST205";

  if (helpful) {
    const { error } = await db
      .from("marketplace_review_votes")
      .upsert(
        { review_id: reviewId, voter_id: voterId },
        { onConflict: "review_id,voter_id", ignoreDuplicates: true },
      );
    if (error) {
      if (missingTable(error)) {
        const err: any = new Error("Review reactions are not available yet");
        err.statusCode = 503;
        throw err;
      }
      throw error;
    }
  } else {
    const { error } = await db
      .from("marketplace_review_votes")
      .delete()
      .eq("review_id", reviewId)
      .eq("voter_id", voterId);
    if (error) {
      if (missingTable(error)) {
        const err: any = new Error("Review reactions are not available yet");
        err.statusCode = 503;
        throw err;
      }
      throw error;
    }
  }

  const { count, error: countError } = await db
    .from("marketplace_review_votes")
    .select("id", { count: "exact", head: true })
    .eq("review_id", reviewId);
  if (countError) throw countError;

  return { helpfulCount: count ?? 0, viewerMarkedHelpful: helpful };
}


export async function buyMarketplaceListingNow(
  deps: Pick<MarketplaceDeps, "createOrderFromBuyNow">,
  listingId: string,
  buyerId: string,
  couponCode?: string,
  quantity?: number,
): Promise<{ order: Record<string, unknown>; budgetLogged?: boolean }> {
  const order = await deps.createOrderFromBuyNow(
    listingId,
    buyerId,
    couponCode,
    quantity,
  );
  return { order, budgetLogged: false };
}


export async function boostMarketplaceListing(
  db: DataClient,
  deps: Pick<
    MarketplaceDeps,
    | "consumeBoostCredit"
    | "getMarketplaceListingById"
    | "normalizeListingRecord"
    | "normalizeListingRecordAsync"
  >,
  listingId: string,
  userId: string,
  durationHours: number = 72,
): Promise<any> {
  const listing = await deps.getMarketplaceListingById(listingId);
  // R5a: explicit PublicError, not a bare Error. POST /listings/:id/boost
  // answers these two through respondMarketplaceClientError, which used to
  // classify any bare `new Error` as a 400 by name check; the check is gone,
  // so the intent has to be stated here. Status is unchanged (400).
  if (!listing) throw new PublicError("Listing not found");
  if (listing.user_id !== userId)
    throw new PublicError("Unauthorized: You do not own this listing");

  const existingFields =
    listing.category_specific_fields || listing.categorySpecificFields || {};
  const boostedUntil = existingFields.boosted_until as string | undefined;
  if (boostedUntil && new Date(boostedUntil) > new Date()) {
    return deps.normalizeListingRecord(listing);
  }

  await deps.consumeBoostCredit(userId);

  const newBoostedUntil = new Date(
    Date.now() + durationHours * 60 * 60 * 1000,
  ).toISOString();
  const categorySpecificFields = {
    ...existingFields,
    boosted_until: newBoostedUntil,
    boost_level: "standard",
  };

  const { data, error } = await db
    .from("marketplace_listings")
    .update({
      category_specific_fields: categorySpecificFields,
      updated_at: new Date().toISOString(),
    })
    .eq("id", listingId)
    .select("*")
    .single();

  if (error) throw error;
  return deps.normalizeListingRecordAsync(data);
}


export async function reportMarketplaceListing(
  db: DataClient,
  listingId: string,
  reporterId: string,
  report: { reason: string; details?: string },
): Promise<any> {
  const { normalizeMarketplaceReportReason } = await import(
    "../../utils/marketplaceReportReason"
  );
  const { reason, details } = normalizeMarketplaceReportReason(
    report.reason,
    report.details,
  );

  const { data, error } = await db
    .from("marketplace_reports")
    .insert({
      listing_id: listingId,
      reporter_id: reporterId,
      reason,
      details,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}


export async function initiateMarketplaceTransaction(
  db: DataClient,
  deps: Pick<
    MarketplaceDeps,
    "getMarketplaceListingById" | "logMarketplaceBudgetTransactions"
  >,
  listingId: string,
  buyerId: string,
  amount: number,
  source: "buy_now" | "offer_accept" = "buy_now",
  options?: { skipBudgetLog?: boolean },
): Promise<any> {
  // Get listing to verify seller
  const listing = await deps.getMarketplaceListingById(listingId);
  if (!listing) throw new Error("Listing not found");

  const { data, error } = await db
    .from("marketplace_transactions")
    .insert({
      buyer_id: buyerId,
      seller_id: listing.user_id,
      listing_id: listingId,
      amount,
    })
    .select()
    .single();

  if (error) throw error;

  if (!options?.skipBudgetLog) {
    await deps.logMarketplaceBudgetTransactions({
      listingId,
      listingTitle: listing.title || "Marketplace item",
      amount,
      sellerId: listing.user_id,
      buyerId,
      marketplaceTransactionId: data.id,
      source,
    });
  }

  return data;
}


export async function logMarketplaceBudgetTransactions(
  db: DataClient,
  params: {
    listingId: string;
    listingTitle: string;
    amount: number;
    sellerId: string;
    buyerId?: string;
    marketplaceTransactionId?: string;
    source: "buy_now" | "offer_accept" | "manual_sold";
  },
): Promise<boolean> {
  const amount = Number(params.amount) || 0;
  if (amount <= 0 || !params.sellerId) return false;

  const date = new Date().toISOString().split("T")[0];
  const title = params.listingTitle || "Marketplace item";
  const rows: Record<string, unknown>[] = [];

  if (params.marketplaceTransactionId && params.buyerId) {
    const { purchaseTxId, saleTxId } = buildMarketplaceBudgetTxIds(
      params.marketplaceTransactionId,
    );
    rows.push(
      {
        id: purchaseTxId,
        user_id: params.buyerId,
        type: MARKETPLACE_BUDGET_TYPES.PURCHASE,
        amount,
        category: MARKETPLACE_BUDGET_CATEGORIES.PURCHASE,
        description: buildMarketplacePurchaseDescription(title),
        date,
      },
      {
        id: saleTxId,
        user_id: params.sellerId,
        type: MARKETPLACE_BUDGET_TYPES.SALE,
        amount,
        category: MARKETPLACE_BUDGET_CATEGORIES.SALE,
        description: buildMarketplaceSaleDescription(title),
        date,
      },
    );
  } else if (params.source === "manual_sold") {
    rows.push({
      id: buildManualSaleBudgetTxId(params.listingId),
      user_id: params.sellerId,
      type: MARKETPLACE_BUDGET_TYPES.SALE,
      amount,
      category: MARKETPLACE_BUDGET_CATEGORIES.SALE,
      description: buildMarketplaceSaleDescription(title),
      date,
    });
  }

  if (rows.length === 0) return false;

  const { error } = await db
    .from("budget_transactions")
    .upsert(rows, { onConflict: "id" });

  if (error) {
    logger.warn("Failed to log marketplace budget transactions", {
      error,
      source: params.source,
    });
    return false;
  }
  return true;
}


export async function maybeLogManualSoldBudget(
  db: DataClient,
  deps: Pick<
    MarketplaceDeps,
    "getMarketplaceListingById" | "logMarketplaceBudgetTransactions"
  >,
  listingId: string,
  sellerId: string,
): Promise<boolean> {
  const { data: existingTxn } = await db
    .from("marketplace_transactions")
    .select("id")
    .eq("listing_id", listingId)
    .limit(1)
    .maybeSingle();

  if (existingTxn) return false;

  const listing = await deps.getMarketplaceListingById(listingId);
  if (!listing) return false;

  return deps.logMarketplaceBudgetTransactions({
    listingId,
    listingTitle: listing.title || "Marketplace item",
    amount: Number(listing.price) || 0,
    sellerId,
    source: "manual_sold",
  });
}


export async function finalizeOfferAcceptSale(
  deps: Pick<MarketplaceDeps, "createOrderFromOfferAccept">,
  offerId: string,
  actorId?: string,
): Promise<{ orderId: string; budgetLogged: boolean }> {
  const order = await deps.createOrderFromOfferAccept(offerId, actorId);
  return { orderId: order.id, budgetLogged: false };
}


