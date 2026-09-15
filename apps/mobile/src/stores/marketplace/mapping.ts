/**
 * Marketplace mapping layer — pure functions only.
 *
 * Everything here turns an API row into the shape screens read, decides a
 * badge from a row, or derives the browse catalog from the shared taxonomy.
 * No API calls, no AsyncStorage, no store access: given the same input these
 * functions always return the same output, which is what makes them table
 * testable (marketplaceMapping.test.ts).
 *
 * Main exports: `mapRemoteListing` (the ONE listing mapper), the row mappers
 * for offers / reviews / inquiries / shops / seller profile / saved searches,
 * `mergeShopSummary`, the badge predicates (`orderNeedsSeller`,
 * `orderAwaitsBuyerPayment`, `offerAwaitsUser`, `BUYER_ACTION_ORDER_STATUSES`,
 * `sumUnread`) and the browse catalog (`CATEGORIES_BY_DEPARTMENT`,
 * `categoriesForTab`, `marketplaceTabLabel`, `buildBrowseScopeQuery`).
 *
 * Gotcha: rows the server sends only to an owner (rights, takedown, appeal)
 * are simply absent on a browse row — absent means "not told", never "clean".
 */
import {
  MARKETPLACE_DEPARTMENTS,
  browseListingCategories,
  isMarketplaceListingStatus,
  browseFilterForNode,
} from '@lantern/shared/marketplace';
import type { MarketplaceDepartment } from '@lantern/shared/marketplace';
import { canRespondToOffer } from '@lantern/shared/utils';
// Type-only: mapper inputs stay exactly the row types the API client returns,
// without this layer depending on the API client at runtime.
import type * as api from '../../services/api';
import { mapMarketplaceListingGeography } from '../marketplaceListingMapping';
import type {
  BrowseCategoryRow,
  MarketplaceCategory,
  MarketplaceInquiry,
  MarketplaceListing,
  MarketplaceOffer,
  MarketplaceOfferOrder,
  MarketplaceReview,
  MarketplaceShopCard,
  MarketplaceTab,
  RemoteListing,
  SavedSearch,
  SellerProfile,
  ShopSummary,
} from './types';

// ---------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------

function mapSellerFromRemote(l: RemoteListing): MarketplaceListing['seller'] {
  const profile = l.seller ?? l.profiles;
  return profile
    ? {
        id: profile.id,
        name: profile.name,
        avatarUrl: profile.avatar_url,
      }
    : undefined;
}

/**
 * The ONE listing mapper: a snake_case API row → the camelCase-ish shape every
 * screen reads. Fields the server sends only to the owner (rights, takedown,
 * appeal) are simply absent on a browse row, and absent must not be read as
 * "clean" — only as "not told".
 */
export function mapRemoteListing(l: RemoteListing): MarketplaceListing {
  // Preserve every status the server can send (incl. moderation outcomes) so a
  // removed/suspended listing never masquerades as active in My Listings.
  const status: MarketplaceListing['status'] = isMarketplaceListingStatus(l.status)
    ? l.status
    : 'active';
  return {
    id: l.id,
    user_id: l.user_id,
    seller_id: l.user_id,
    seller: mapSellerFromRemote(l),
    category: l.category,
    title: l.title,
    description: l.description,
    price: l.price,
    sale_price: l.sale_price,
    sale_ends_at: l.sale_ends_at,
    promo_label: l.promo_label,
    effective_price: l.effective_price,
    is_on_sale: l.is_on_sale,
    quantity: l.quantity,
    listing_kind: l.listing_kind,
    bundle_items: l.bundle_items,
    location: l.location,
    ...mapMarketplaceListingGeography(l),
    images: l.images || [],
    status,
    views_count: l.views_count || 0,
    favorites_count: l.favorites_count || 0,
    // Trigger-maintained review aggregate; null until the ratings migration
    // runs (Postgres NUMERIC can arrive as a string — normalize to number).
    rating_avg: l.rating_avg != null ? Number(l.rating_avg) : null,
    rating_count: typeof l.rating_count === 'number' ? l.rating_count : null,
    // Academic archive: map the raw column onto the camelCase field every
    // screen reads; the raw JSONB keeps courseCode for older listings.
    courseId: l.course_id ?? l.courseId ?? null,
    topicId: l.topic_id ?? l.topicId ?? null,
    category_specific_fields: l.category_specific_fields ?? undefined,
    // Rights / takedown / appeal: the API only sends these to the owner, so a
    // browse row simply leaves them undefined.
    rights_status: l.rights_status,
    takedown_reason: l.takedown_reason ?? null,
    takedown_at: l.takedown_at ?? null,
    appeal_status: l.appeal_status,
    appeal_note: l.appeal_note ?? null,
    appealed_at: l.appealed_at ?? null,
    appeal_decided_at: l.appeal_decided_at ?? null,
    created_at: l.created_at,
    updated_at: l.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------

/** Reads the offer's linked order off a raw API row, tolerating older builds that omit it. */
export function mapOfferOrder(raw: unknown): MarketplaceOfferOrder | null {
  if (!raw || typeof raw !== 'object') return null;
  const order = raw as { id?: unknown; status?: unknown; paymentId?: unknown };
  if (typeof order.id !== 'string' || typeof order.status !== 'string') return null;
  return {
    id: order.id,
    status: order.status,
    paymentId: typeof order.paymentId === 'string' ? order.paymentId : null,
  };
}

type OffersRow = Awaited<ReturnType<typeof api.fetchMarketplaceOffers>>[number];

/**
 * A row from the buyer/seller offer lists. `listing`, `buyer` and `seller` are
 * kept, not dropped: without them an offer card is an amount and a date, and a
 * seller with three listings cannot tell which one it is on.
 */
export function mapOfferRow(o: OffersRow): MarketplaceOffer {
  return {
    id: o.id,
    listing_id: o.listing_id,
    buyer_id: o.buyer_id,
    seller_id: o.seller_id,
    amount: o.amount,
    message: o.message,
    status: o.status as MarketplaceOffer['status'],
    proposed_by: o.proposed_by === 'seller' || o.proposed_by === 'buyer' ? o.proposed_by : undefined,
    parent_offer_id: o.parent_offer_id ?? undefined,
    expires_at: o.expires_at,
    created_at: o.created_at,
    updated_at: o.updated_at,
    listing: o.listing
      ? { id: o.listing.id, title: o.listing.title, images: o.listing.images ?? undefined }
      : undefined,
    buyer: o.buyer
      ? { id: o.buyer.id, name: o.buyer.name, avatarUrl: o.buyer.avatar_url ?? undefined }
      : undefined,
    seller: o.seller
      ? { id: o.seller.id, name: o.seller.name, avatarUrl: o.seller.avatar_url ?? undefined }
      : undefined,
    order: mapOfferOrder((o as { order?: unknown }).order),
  };
}

/**
 * A row from one listing's offer thread. seller_id, proposed_by and
 * parent_offer_id are what canRespondToOffer / canWithdrawOffer /
 * getOfferProposedBy key off. Dropping them made every offer look
 * buyer-proposed with no responder, so no action button rendered.
 */
export function mapListingOfferRow(o: any) {
  return {
    id: o.id,
    listing_id: o.listing_id,
    buyer_id: o.buyer_id,
    seller_id: o.seller_id,
    amount: o.amount,
    status: o.status as MarketplaceOffer['status'],
    proposed_by: o.proposed_by,
    parent_offer_id: o.parent_offer_id,
    counter_amount: o.counter_amount,
    message: o.message,
    expires_at: o.expires_at,
    created_at: o.created_at,
    order: mapOfferOrder(o.order),
  };
}

type CreatedOfferRow = Awaited<ReturnType<typeof api.createMarketplaceOffer>>;

/** The just-created offer, as the create endpoint returns it. */
export function mapCreatedOffer(created: CreatedOfferRow): MarketplaceOffer {
  return {
    id: created.id,
    listing_id: created.listing_id,
    buyer_id: created.buyer_id,
    seller_id: created.seller_id,
    amount: created.amount,
    message: created.message,
    status: created.status as MarketplaceOffer['status'],
    created_at: created.created_at,
  };
}

// ---------------------------------------------------------------------------
// Reviews, inquiries, saved searches, shops, seller
// ---------------------------------------------------------------------------

type ReviewRow = Awaited<ReturnType<typeof api.fetchListingReviews>>[number];

export function mapReviewRow(r: ReviewRow): MarketplaceReview {
  return {
    id: r.id,
    listing_id: r.listing_id,
    reviewer_id: r.reviewer_id,
    reviewer: r.reviewer
      ? { id: r.reviewer.id, name: r.reviewer.name, avatarUrl: r.reviewer.avatar_url }
      : undefined,
    rating: r.rating,
    comment: r.comment,
    created_at: r.created_at,
    // Read-time signals; absent (not defaulted) pre-migration so the UI
    // knows to hide the corresponding controls.
    verifiedPurchase: r.verifiedPurchase,
    helpfulCount: r.helpfulCount,
    viewerMarkedHelpful: r.viewerMarkedHelpful,
  };
}

type InquiryRow = Awaited<ReturnType<typeof api.fetchMyInquiries>>[number];

/** The other party depends on which side asked for the list. */
export function mapInquiryRow(inq: InquiryRow, role: 'seller' | 'buyer'): MarketplaceInquiry {
  return {
    id: inq.id,
    listing_id: inq.listing_id,
    sender_id: role === 'seller' ? inq.buyer_id : inq.seller_id,
    message: inq.initial_message,
    created_at: inq.created_at,
  };
}

type SavedSearchRow = Awaited<ReturnType<typeof api.fetchSavedSearches>>[number];

export function mapSavedSearchRow(s: SavedSearchRow): SavedSearch {
  return {
    id: s.id,
    user_id: s.user_id,
    name: s.name,
    filters: s.filters,
    created_at: s.created_at,
  };
}

type SellerStatsRow = NonNullable<Awaited<ReturnType<typeof api.fetchSellerStats>>>;

/** "My stats" is this user's own row, so it carries a placeholder identity. */
export function mapSellerStats(stats: SellerStatsRow): SellerProfile {
  return {
    id: 'me',
    name: 'My stats',
    total_listings: stats.totalListings,
    active_listings: stats.activeListings,
    sold_listings: stats.soldListings,
    completed_orders: stats.completedOrders,
    total_views: stats.totalViews,
    total_inquiries: stats.totalInquiries,
    total_favorites: stats.totalFavorites,
  };
}

type SellerProfileResponse = Awaited<ReturnType<typeof api.fetchSellerProfile>>;

export function mapSellerProfile(
  data: SellerProfileResponse,
  sellerId: string,
): SellerProfile {
  return {
    id: data.user?.id || sellerId,
    name: data.user?.name || 'Seller',
    avatarUrl: data.user?.avatar_url,
    shopName: data.shop?.shopName || data.user?.name || 'Shop',
    shopBio: data.shop?.bio ?? null,
    coverImageUrl: data.shop?.coverImageUrl ?? null,
    total_listings: data.stats?.totalListings || 0,
    active_listings: data.stats?.activeListings || 0,
    sold_listings: data.stats?.soldListings || 0,
    average_rating: data.stats?.avgRating || 0,
    review_count: data.stats?.totalReviews || 0,
    is_verified: data.stats?.isVerified,
    badges: data.badges,
    memberSince: data.user?.created_at,
  };
}

export function mapShopCard(s: any): MarketplaceShopCard {
  return {
    sellerId: s.sellerId,
    shopName: s.shopName,
    bio: s.bio ?? null,
    coverImageUrl: s.coverImageUrl ?? null,
    avatarUrl: s.avatarUrl ?? null,
    activeListingCount: s.activeListingCount ?? 0,
    avgRating: s.avgRating ?? 0,
    totalReviews: s.totalReviews ?? 0,
    campusId: s.campusId ?? null,
    campusLabel: s.campusLabel ?? null,
    lastListingAt: s.lastListingAt ?? null,
  };
}

// ---------------------------------------------------------------------------
// Shop summary
// ---------------------------------------------------------------------------

export const EMPTY_SHOP_SUMMARY: ShopSummary = {
  cartCount: 0,
  buyerActionOrders: 0,
  sellerActionOrders: 0,
  pendingOffersReceived: 0,
  offersAwaitingYou: 0,
  openInquiries: 0,
  sellerInquiryThreadIds: [],
  buyerInquiryThreadIds: [],
  sellerAwaitingBuyerPayment: 0,
  activeListings: 0,
  payouts: null,
};

type ShopSummaryResponse = NonNullable<Awaited<ReturnType<typeof api.fetchShopSummary>>>;

/**
 * Fold a summary response onto what is already on screen. A section the server
 * could not count comes back null, and null means "no answer": the number we
 * already had stands rather than being zeroed (see services/marketplaceSummary.ts).
 */
export function mergeShopSummary(prev: ShopSummary, data: ShopSummaryResponse): ShopSummary {
  const keep = <T,>(next: T | null | undefined, fallback: T): T => (next == null ? fallback : next);
  return {
    cartCount: keep(data.cartCount, prev.cartCount),
    buyerActionOrders: keep(data.buyerActionOrders, prev.buyerActionOrders),
    sellerActionOrders: keep(data.sellerActionOrders, prev.sellerActionOrders),
    sellerAwaitingBuyerPayment: keep(data.sellerAwaitingBuyerPayment, prev.sellerAwaitingBuyerPayment),
    pendingOffersReceived: keep(data.offersAwaitingMe, prev.pendingOffersReceived),
    offersAwaitingYou: keep(data.offersAwaitingYou, prev.offersAwaitingYou),
    openInquiries: keep(data.openInquiries, prev.openInquiries),
    sellerInquiryThreadIds: keep(data.sellerInquiryThreadIds, prev.sellerInquiryThreadIds),
    buyerInquiryThreadIds: keep(data.buyerInquiryThreadIds, prev.buyerInquiryThreadIds),
    activeListings: keep(data.activeListings, prev.activeListings),
    payouts: keep(data.payouts, prev.payouts),
  };
}

// ---------------------------------------------------------------------------
// Badge predicates
// ---------------------------------------------------------------------------

/**
 * Orders that need the buyer: pay for it, or confirm you collected it.
 * Exported so the OrderStatusPill's "action" tone and the badge count share
 * one definition — a row marked as needing you must also be counted.
 */
export const BUYER_ACTION_ORDER_STATUSES = new Set(['pending_payment', 'awaiting_payment', 'ready_for_pickup', 'shipped']);
/**
 * Orders that need the seller. `paid` is the online-payment case: money is in,
 * item still to hand over. A cash or transfer order never reaches `paid` on its
 * own — it sits in `pending_payment` with no payment_id until the seller taps
 * "Confirm payment received", so that state is the seller's too.
 */
export function orderNeedsSeller(order: { status: string; payment_id?: string | null }): boolean {
  if (order.status === 'paid') return true;
  return order.status === 'pending_payment' && !order.payment_id;
}
/**
 * The mirror image: the buyer still has to pay online, so the seller can only
 * wait. Kept separate from orderNeedsSeller so it never lands in a red badge.
 */
export function orderAwaitsBuyerPayment(order: { status: string; payment_id?: string | null }): boolean {
  if (order.status === 'awaiting_payment') return true;
  return order.status === 'pending_payment' && !!order.payment_id;
}
/**
 * An offer that needs THIS user: pending, not past its expiry, and it is their
 * turn. Counting every pending offer badged a seller for their own counter —
 * the ball was in the buyer's court, yet the seller was told to act.
 */
export function offerAwaitsUser(
  offer: {
    status: string;
    expires_at?: string | null;
    proposed_by?: string | null;
    parent_offer_id?: string | null;
    buyer_id: string;
    seller_id: string;
  },
  userId: string | undefined,
): boolean {
  if (offer.status !== 'pending') return false;
  if (offer.expires_at) {
    const expires = Date.parse(offer.expires_at);
    if (!Number.isNaN(expires) && expires <= Date.now()) return false;
  }
  if (!userId) return true;
  return canRespondToOffer(
    offer as Parameters<typeof canRespondToOffer>[0],
    userId,
  );
}
/**
 * Unread DM messages across a set of inquiry threads. The store never imports
 * groupStore (it would be a cycle); the hook passes the unread map in. A thread
 * missing from the map counts 0 — conservative, never over-badged.
 */
/**
 * Unread DM count across the inquiry threads. A thread id is derived from the two
 * user ids alone (routes/marketplace.ts), so a buyer with two open inquiries on
 * one seller's listings shares ONE thread — summing per inquiry double-counted
 * it. Dedupe the ids first.
 */
export const sumUnread = (ids: string[], counts: Record<string, number>): number =>
  Array.from(new Set(ids)).reduce((n, id) => n + (counts[id] ?? 0), 0);

// ---------------------------------------------------------------------------
// Browse catalog (derived from the shared taxonomy)
// ---------------------------------------------------------------------------

export { MARKETPLACE_DEPARTMENTS };
export type { MarketplaceDepartment };

/**
 * Where browse opens when nothing else is chosen.
 *
 * Everything, not a department. Opening on one department shows an empty shop
 * whenever that department happens to have no stock — which on a young campus
 * market is most of them, and is what a buyer sees first. Facebook Marketplace
 * and Amazon both open on a cross-department feed for the same reason.
 */
export const DEFAULT_MARKETPLACE_TAB: MarketplaceTab = 'all';

/** Browse-strip order: All, the nine departments, then Shops (sellers). */
export const MARKETPLACE_TABS: readonly MarketplaceTab[] = [
  'all',
  ...MARKETPLACE_DEPARTMENTS,
  'shops',
];

const DEPARTMENT_LABELS: Record<MarketplaceDepartment, string> = {
  electronics: 'Electronics',
  'study-materials': 'Books & Study',
  housing: 'Housing',
  'fashion-beauty': 'Fashion & Beauty',
  'food-groceries': 'Food',
  services: 'Services',
  transport: 'Transport',
  'events-tickets': 'Events',
  'campus-essentials': 'Essentials',
};

/** Short enough for a scrolling tab; the full name lives on the browse page. */
export function marketplaceTabLabel(tab: MarketplaceTab): string {
  if (tab === 'all') return 'All';
  return tab === 'shops' ? 'Shops' : DEPARTMENT_LABELS[tab];
}

const BROWSE_ICONS: Record<string, string> = {
  textbook_exchange: 'book',
  pq_bank: 'sparkles',
  study_pack: 'albums',
  lecture_notes: 'document-text',
  project_thesis: 'briefcase',
  data_collection: 'chart-bar',
  equipment_rental: 'beaker',
  accommodation: 'home',
  travel_transport: 'car',
  personal_goods: 'gift',
  aso_ebi: 'shirt',
  campus_services: 'people',
  events_social: 'ticket',
  electronics: 'phone-portrait',
  beauty_hair: 'sparkles',
  food_drink: 'restaurant',
};

/** Browse chips per department, derived from the taxonomy — never hand-listed. */
export const CATEGORIES_BY_DEPARTMENT: Record<MarketplaceDepartment, BrowseCategoryRow[]> =
  MARKETPLACE_DEPARTMENTS.reduce(
    (acc, department) => {
      acc[department] = browseListingCategories(department).map((row) => ({
        id: row.id as MarketplaceCategory,
        name: row.name,
        icon: BROWSE_ICONS[row.id] || 'gift',
      }));
      return acc;
    },
    {} as Record<MarketplaceDepartment, BrowseCategoryRow[]>,
  );

/** Every browsable category, in department order — what the All tab spans. */
export const ALL_BROWSE_CATEGORIES: BrowseCategoryRow[] = MARKETPLACE_DEPARTMENTS.flatMap(
  (department) => CATEGORIES_BY_DEPARTMENT[department],
);

/** The categories a browse tab covers. */
export function categoriesForTab(tab: MarketplaceTab): BrowseCategoryRow[] {
  if (tab === 'shops') return [];
  if (tab === 'all') return ALL_BROWSE_CATEGORIES;
  return CATEGORIES_BY_DEPARTMENT[tab];
}

/** @deprecated Study material is one department of nine; use CATEGORIES_BY_DEPARTMENT. */
export const ACADEMIC_CATEGORIES = CATEGORIES_BY_DEPARTMENT['study-materials'];

/**
 * @deprecated The academic / student-life split is gone. This flattens the
 * other eight departments so the screens that still assume two buckets keep
 * working while they are reworked onto CATEGORIES_BY_DEPARTMENT.
 */
export const STUDENT_LIFE_CATEGORIES: BrowseCategoryRow[] = MARKETPLACE_DEPARTMENTS.filter(
  (d) => d !== 'study-materials',
).flatMap((d) => CATEGORIES_BY_DEPARTMENT[d]);

// Helper to get category info
export const getCategoryInfo = (categoryId: string) => {
  const allCategories = [...ACADEMIC_CATEGORIES, ...STUDENT_LIFE_CATEGORIES];
  return allCategories.find(c => c.id === categoryId) || { id: categoryId, name: categoryId, icon: 'help-circle' };
};

/**
 * The scope a browse request asks the server for, decided in one place, in
 * priority order: an explicit category chip, then a drilled-in taxonomy node,
 * then the department's category list — with `all` sending nothing at all,
 * because listing every known category id would also exclude custom ones.
 */
export function buildBrowseScopeQuery(input: {
  activeTab: MarketplaceTab;
  categoryFilter?: string | null;
  taxonomyNodeId: string | null;
}): Record<string, unknown> {
  const { activeTab, categoryFilter, taxonomyNodeId } = input;
  const tabCategoryIds = (
    activeTab === 'shops' ? STUDENT_LIFE_CATEGORIES : categoriesForTab(activeTab)
  ).map(c => c.id);
  // A drilled-in node is the narrowest thing the buyer asked for, so it
  // outranks the department's whole category list.
  const nodeFilter =
    !categoryFilter && taxonomyNodeId ? browseFilterForNode(taxonomyNodeId) : null;
  return nodeFilter
    ? {
        category: nodeFilter.category,
        categories: nodeFilter.categories,
        taxonomyNodeId: nodeFilter.taxonomyNodeId,
        taxonomyNodeIds: nodeFilter.taxonomyNodeIds,
        includeUnclassified: nodeFilter.includeUnclassified,
        // Custom categories carry no node id, so a leaf-filtered group
        // would exclude them anyway; only ask for them when nothing narrows.
        ...(nodeFilter.categories && !nodeFilter.taxonomyNodeIds
          ? { includeCustom: true }
          : {}),
      }
    : categoryFilter
      ? { category: categoryFilter }
      : activeTab === 'all'
        ? // All means all: sending every category id would also exclude the
          // custom ones and any category a newer client knows about.
          {}
        : { categories: tabCategoryIds, includeCustom: true };
}
