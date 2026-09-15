/**
 * Marketplace types — the shapes the three layers agree on.
 *
 * `RemoteListing` and friends describe what the API sends (snake_case rows);
 * `MarketplaceListing`, `MarketplaceOffer`, `MarketplaceReview`, `ShopSummary`
 * and the rest describe what screens read. `mapping.ts` is the only place that
 * turns one into the other.
 *
 * Types only — no runtime code, so importing this can never pull in the API
 * client, AsyncStorage or zustand.
 */
import type { MarketplaceListingStatus } from '@lantern/shared/marketplace';
import type { ListingAppealStatus, ListingRightsStatus } from '@lantern/shared/types';
import type { MarketplaceDepartment } from '@lantern/shared/marketplace';

export type MarketplaceListingCampus = {
  id: string;
  name: string;
  city: string;
  state: string;
  slug?: string;
  country_code?: string;
};

export type RemoteListing = {
  id: string;
  user_id: string;
  category: string;
  title: string;
  description?: string;
  price?: number;
  rating_avg?: number | string | null;
  rating_count?: number | null;
  sale_price?: number;
  sale_ends_at?: string;
  promo_label?: string;
  effective_price?: number;
  is_on_sale?: boolean;
  quantity?: number | null;
  listing_kind?: 'single' | 'bundle' | 'question_bank' | 'study_pack';
  bundle_items?: Array<{ listing_id?: string; title: string; price?: number }>;
  location?: string;
  campus_id?: string | null;
  country_code?: string;
  currency?: string;
  campus?: MarketplaceListingCampus;
  images?: string[];
  status?: string;
  seller?: { id: string; name: string; avatar_url?: string };
  profiles?: { id: string; name: string; avatar_url?: string };
  views_count?: number;
  favorites_count?: number;
  /** Academic archive: listing rows are served snake_case (`course_id`). */
  course_id?: string | null;
  courseId?: string | null;
  topic_id?: string | null;
  topicId?: string | null;
  category_specific_fields?: Record<string, unknown> | null;
  // Rights / takedown / appeal state (Phase 1 · E) — owner + admin views only.
  rights_status?: ListingRightsStatus;
  takedown_reason?: string | null;
  takedown_at?: string | null;
  appeal_status?: ListingAppealStatus;
  appeal_note?: string | null;
  appealed_at?: string | null;
  appeal_decided_at?: string | null;
  created_at: string;
  updated_at: string;
};

export interface MarketplaceListing {
  id: string;
  user_id: string;
  seller_id?: string;
  seller?: {
    id: string;
    name: string;
    avatarUrl?: string;
  };
  category: string;
  title: string;
  description?: string;
  price?: number;
  sale_price?: number;
  sale_ends_at?: string;
  promo_label?: string;
  effective_price?: number;
  is_on_sale?: boolean;
  quantity?: number | null;
  listing_kind?: 'single' | 'bundle' | 'question_bank' | 'study_pack';
  bundle_items?: Array<{ listing_id?: string; title: string; price?: number }>;
  location?: string;
  campus_id?: string | null;
  country_code?: string;
  currency?: string;
  campus?: MarketplaceListingCampus;
  images?: string[];
  status: MarketplaceListingStatus;
  views_count?: number;
  favorites_count?: number;
  /**
   * Trigger-maintained review aggregate (20260828160000 migration). Null
   * until the migration is applied — hide rating UI when rating_count is not
   * a positive number.
   */
  rating_avg?: number | null;
  rating_count?: number | null;
  /** Academic archive: marketplace_listings.course_id (mapped from the raw column). */
  courseId?: string | null;
  /** Syllabus topic inside `courseId`; absent until 20260826120000 is applied. */
  topicId?: string | null;
  /** Free-form JSONB; `courseCode` mirrors the picked course for older clients. */
  category_specific_fields?: Record<string, unknown>;
  // Rights / takedown / appeal state (Phase 1 · E). Present for the seller's
  // own listings (my-listings + owner detail); undefined for other viewers.
  rights_status?: ListingRightsStatus;
  takedown_reason?: string | null;
  takedown_at?: string | null;
  appeal_status?: ListingAppealStatus;
  appeal_note?: string | null;
  appealed_at?: string | null;
  appeal_decided_at?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Listing update payload. sale_price / sale_ends_at / promo_label accept an
 * explicit null so a seller can clear a discount: undefined leaves the field
 * untouched on the server, null tells it to remove the value.
 */
export type MarketplaceListingUpdate = Omit<
  Partial<MarketplaceListing>,
  'sale_price' | 'sale_ends_at' | 'promo_label' | 'status'
> & {
  sale_price?: number | null;
  sale_ends_at?: string | null;
  promo_label?: string | null;
  // Sellers may only request these; reserved/archived/moderated statuses are
  // set by the order lifecycle, the delete path, and Lantern moderation.
  status?: 'active' | 'sold' | 'inactive';
  /**
   * Rights attestation (RIGHTS_ATTESTATION_TEXT). Required by the API when
   * the edit moves an unattested listing into an academic category; sent
   * through to PUT /marketplace/listings/:id, never stored on the local row.
   */
  attestation?: boolean;
};

export type MarketplaceListingCreateInput = Omit<
  MarketplaceListing,
  'id' | 'created_at' | 'updated_at' | 'views_count' | 'favorites_count' | 'campus_id'
> & {
  campus_id: string;
  /** Rights attestation — required (400) when isAcademicListing({ category }). */
  attestation?: boolean;
};

export interface MarketplaceReview {
  id: string;
  listing_id: string;
  reviewer_id: string;
  reviewer?: {
    id: string;
    name: string;
    username?: string;
    avatarUrl?: string;
    avatar_url?: string;
  };
  rating: number;
  comment?: string;
  created_at: string;
  /** Reviewer completed a purchase (order / entitlement / purchased inquiry). */
  verifiedPurchase?: boolean;
  /** "Helpful" count; absent until the review-votes migration is applied. */
  helpfulCount?: number;
  /** Whether the current viewer marked this review helpful. */
  viewerMarkedHelpful?: boolean;
}

export interface MarketplaceInquiry {
  id: string;
  listing_id: string;
  sender_id: string;
  sender?: {
    id: string;
    name: string;
    avatarUrl?: string;
  };
  listing?: MarketplaceListing;
  message: string;
  created_at: string;
}

export interface MarketplaceOffer {
  /** The listing the offer is on; the API selects it so cards can name it. */
  listing?: { id: string; title: string; images?: string[] } | null;
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id?: string;
  amount: number;
  message?: string;
  status: 'pending' | 'accepted' | 'declined' | 'countered' | 'expired' | 'withdrawn';
  proposed_by?: 'buyer' | 'seller';
  parent_offer_id?: string;
  /** When a pending offer lapses; drives client-side expiry gating. */
  expires_at?: string;
  created_at: string;
  updated_at?: string;
  buyer?: {
    id: string;
    name: string;
    avatarUrl?: string;
  };
  /** The listing's owner; a buyer's "Sent" card names who they are haggling with. */
  seller?: {
    id: string;
    name: string;
    avatarUrl?: string;
  };
  /**
   * Order created when this offer was accepted. The server only attaches it for
   * a party to that order, and older API builds omit it entirely — so callers
   * must treat it as optional, not as "no order exists".
   */
  order?: MarketplaceOfferOrder | null;
}

export interface MarketplaceOfferOrder {
  id: string;
  status: string;
  paymentId: string | null;
}

export interface SavedSearch {
  id: string;
  user_id: string;
  name: string;
  filters: Record<string, unknown>;
  created_at: string;
}

export interface SellerProfile {
  id: string;
  name: string;
  avatarUrl?: string;
  shopName?: string;
  shopBio?: string | null;
  coverImageUrl?: string | null;
  total_listings?: number;
  active_listings?: number;
  sold_listings?: number;
  completed_orders?: number;
  total_views?: number;
  total_inquiries?: number;
  total_favorites?: number;
  average_rating?: number;
  review_count?: number;
  is_verified?: boolean;
  badges?: Array<{ id: string; label: string }>;
  /** profiles.created_at — "Member since" trust signal. */
  memberSince?: string;
}

export interface MarketplaceShopCard {
  sellerId: string;
  shopName: string;
  bio: string | null;
  coverImageUrl: string | null;
  avatarUrl: string | null;
  activeListingCount: number;
  avgRating: number;
  totalReviews: number;
  campusId: string | null;
  campusLabel: string | null;
  lastListingAt: string | null;
}

/**
 * Coarse listing categories. The taxonomy is the source of truth
 * (knownListingCategories()); this union exists so screens keep their
 * autocomplete, and must gain a member whenever a new leaf introduces one.
 */
export type MarketplaceCategory =
  | 'textbook_exchange'
  | 'pq_bank'
  | 'study_pack'
  | 'lecture_notes'
  | 'project_thesis'
  | 'data_collection'
  | 'equipment_rental'
  | 'accommodation'
  | 'travel_transport'
  | 'personal_goods'
  | 'aso_ebi'
  | 'campus_services'
  | 'events_social';

/**
 * Browse tabs = the nine departments, plus Shops (sellers rather than items).
 * The old 'academic' | 'student-life' pair described the SELLER, not the
 * product, which is what buried phones, hostels and hair under "student life".
 */
export type MarketplaceTab = 'all' | MarketplaceDepartment | 'shops';

export interface BrowseCategoryRow {
  id: MarketplaceCategory;
  name: string;
  icon: string;
}

/**
 * What the Shop keeps in front of the user. Every field is a count of things
 * that exist now, not a lifetime total — a badge that never clears is noise.
 */
export interface ShopSummary {
  /** Line items in the cart (quantity summed). */
  cartCount: number;
  /** Orders where the BUYER must act: pay, or confirm pickup. */
  buyerActionOrders: number;
  /** Orders where the SELLER must act: paid and waiting to be handed over. */
  sellerActionOrders: number;
  /** Offers made to this seller where it is the SELLER's turn to answer. */
  pendingOffersReceived: number;
  /** Offers this user made where the seller countered and the BUYER must answer. */
  offersAwaitingYou: number;
  /** Buyer conversations on this seller's listings that are still open. */
  openInquiries: number;
  /**
   * DM thread ids behind this seller's open inquiries. The store does not know
   * what is unread — groupStore's dmUnreadCounts does — so the badge joins the
   * two at read time (useShopBadges) instead of counting "open" as "needs you".
   */
  sellerInquiryThreadIds: string[];
  /** DM thread ids behind inquiries this user sent as a buyer. */
  buyerInquiryThreadIds: string[];
  /**
   * Seller orders where the buyer still has to pay online. Not attention —
   * nothing the seller can do — so it is rendered grey, never as a badge.
   */
  sellerAwaitingBuyerPayment: number;
  /**
   * Seller share awaiting payout / already paid out, in kobo — the server's
   * sum over marketplace_payments. Null until the first summary lands.
   */
  payouts: {
    awaitingPayoutKobo: number;
    paidOutKobo: number;
    awaitingPayoutCount: number;
    paidOutCount: number;
  } | null;
  /** Listings currently live. */
  activeListings: number;
}
