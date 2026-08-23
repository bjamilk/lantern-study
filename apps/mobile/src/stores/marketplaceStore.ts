/**
 * Marketplace Store
 * Manages marketplace listings and favorites with local-first pattern
 */
import { create } from 'zustand';
import { isMarketplaceListingStatus } from '@lantern/shared/marketplace';
import type { MarketplaceListingStatus } from '@lantern/shared/marketplace';
import type { ListingAppealStatus, ListingRightsStatus } from '@lantern/shared/types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RateLimitError } from '@lantern/shared';
import * as api from '../services/api';
import { syncService } from '../services/syncService';
import { useBudgetStore } from './budgetStore';
import { useAuthStore } from './authStore';
import {
  buildMarketplaceGeographyQuery,
  normalizeSavedMarketplaceFilters,
} from './marketplaceFilters';
import { mapMarketplaceListingGeography } from './marketplaceListingMapping';

// Demo mode flag
const DEMO_MODE = false;

let listingsRequestSeq = 0;
let listingFetchSeq = 0;

/** REL-01: queue only network / 5xx / 408 / 429 — permanent 4xx must not ghost-sync. */
function isRetryableMarketplaceError(error: { status?: number; message?: string } | null | undefined): boolean {
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
    // Academic archive: map the raw column onto the camelCase field every
    // screen reads; the raw JSONB keeps courseCode for older listings.
    courseId: l.course_id ?? l.courseId ?? null,
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

function getCurrentUserId(): string | null {
  return useAuthStore.getState().user?.id ?? null;
}

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
  /** Academic archive: marketplace_listings.course_id (mapped from the raw column). */
  courseId?: string | null;
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

type MarketplaceListingCreateInput = Omit<
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

/** Reads the offer's linked order off a raw API row, tolerating older builds that omit it. */
function mapOfferOrder(raw: unknown): MarketplaceOfferOrder | null {
  if (!raw || typeof raw !== 'object') return null;
  const order = raw as { id?: unknown; status?: unknown; paymentId?: unknown };
  if (typeof order.id !== 'string' || typeof order.status !== 'string') return null;
  return {
    id: order.id,
    status: order.status,
    paymentId: typeof order.paymentId === 'string' ? order.paymentId : null,
  };
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

const refreshMarketplaceBudget = async (userId: string) => {
  if (DEMO_MODE || !userId) return;
  try {
    await useBudgetStore.getState().fetchTransactions(userId);
  } catch (error) {
    console.warn('Failed to refresh budget after marketplace action:', error);
  }
};

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

export type MarketplaceTab = 'academic' | 'student-life' | 'shops';

export const ACADEMIC_CATEGORIES: { id: MarketplaceCategory; name: string; icon: string }[] = [
  { id: 'textbook_exchange', name: 'Textbooks', icon: 'book' },
  { id: 'pq_bank', name: 'Past Questions', icon: 'sparkles' },
  { id: 'study_pack', name: 'Study Packs', icon: 'albums' },
  { id: 'lecture_notes', name: 'Lecture Notes', icon: 'document-text' },
  { id: 'project_thesis', name: 'Projects & Thesis', icon: 'briefcase' },
  { id: 'data_collection', name: 'Data Collection', icon: 'chart-bar' },
  { id: 'equipment_rental', name: 'Lab Equipment', icon: 'beaker' },
];

export const STUDENT_LIFE_CATEGORIES: { id: MarketplaceCategory; name: string; icon: string }[] = [
  { id: 'accommodation', name: 'Accommodation', icon: 'home' },
  { id: 'travel_transport', name: 'Transportation', icon: 'car' },
  { id: 'personal_goods', name: 'Personal Goods', icon: 'gift' },
  { id: 'aso_ebi', name: 'Fashion', icon: 'shirt-outline' },
  { id: 'campus_services', name: 'Campus Services', icon: 'people' },
  { id: 'events_social', name: 'Events & Social', icon: 'ticket' },
];

// Mock data for demo mode
const DEMO_LISTINGS: MarketplaceListing[] = [
  {
    id: 'listing-1',
    user_id: 'seller-1',
    seller_id: 'seller-1',
    seller: { id: 'seller-1', name: 'John Doe', avatarUrl: undefined },
    category: 'textbook_exchange',
    title: 'Organic Chemistry Textbook (7th Edition)',
    description: 'Barely used, excellent condition. Great for CHM 201/202. Includes solutions manual.',
    price: 15000,
    location: 'University of Lagos',
    images: ['https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=400'],
    status: 'active',
    views_count: 45,
    favorites_count: 12,
    created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'listing-2',
    user_id: 'seller-2',
    seller_id: 'seller-2',
    seller: { id: 'seller-2', name: 'Jane Smith', avatarUrl: undefined },
    category: 'pq_bank',
    title: '300 Level Engineering Past Questions (2018-2023)',
    description: 'Complete past questions and answers for all 300 level engineering courses. PDF format.',
    price: 5000,
    location: 'Federal University of Technology',
    images: ['https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=400'],
    status: 'active',
    views_count: 128,
    favorites_count: 34,
    created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'listing-3',
    user_id: 'seller-3',
    seller_id: 'seller-3',
    seller: { id: 'seller-3', name: 'Mike Johnson', avatarUrl: undefined },
    category: 'accommodation',
    title: 'Self-Contain Apartment Near Campus',
    description: 'Spacious self-contain with 24/7 power supply, water, and good security. 5 mins walk to campus.',
    price: 250000,
    location: 'Akoka, Lagos',
    images: ['https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=400'],
    status: 'active',
    views_count: 89,
    favorites_count: 23,
    created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'listing-4',
    user_id: 'seller-4',
    seller_id: 'seller-4',
    seller: { id: 'seller-4', name: 'Sarah Williams', avatarUrl: undefined },
    category: 'lecture_notes',
    title: 'Complete Medical School Notes (200-500 Level)',
    description: 'Well-organized notes covering all major topics. Includes diagrams and mnemonics.',
    price: 8000,
    location: 'College of Medicine, LUTH',
    images: ['https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=400'],
    status: 'active',
    views_count: 156,
    favorites_count: 67,
    created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'listing-5',
    user_id: 'seller-5',
    seller_id: 'seller-5',
    seller: { id: 'seller-5', name: 'David Brown', avatarUrl: undefined },
    category: 'personal_goods',
    title: 'HP Laptop - Core i5, 8GB RAM, 256GB SSD',
    description: 'Student laptop in great condition. Perfect for programming and office work. Battery lasts 5+ hours.',
    price: 180000,
    location: 'Ibadan',
    images: ['https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=400'],
    status: 'active',
    views_count: 234,
    favorites_count: 45,
    created_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'listing-6',
    user_id: 'seller-6',
    seller_id: 'seller-6',
    seller: { id: 'seller-6', name: 'Emily Davis', avatarUrl: undefined },
    category: 'events_social',
    title: 'Dinner Party Tickets - Faculty Week',
    description: 'VIP tickets for the annual Faculty Dinner & Awards Night. Includes free meal and drinks.',
    price: 7500,
    location: 'Main Auditorium',
    images: ['https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=400'],
    status: 'active',
    views_count: 67,
    favorites_count: 18,
    created_at: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const DEMO_MY_LISTINGS: MarketplaceListing[] = [
  {
    id: 'my-listing-1',
    user_id: 'demo-user',
    seller_id: 'demo-user',
    seller: { id: 'demo-user', name: 'Demo User', avatarUrl: undefined },
    category: 'textbook_exchange',
    title: 'Calculus Early Transcendentals (8th Ed)',
    description: 'Selling my calculus textbook. Some highlighting but in good condition overall.',
    price: 12000,
    location: 'Campus Library',
    images: [],
    status: 'active',
    views_count: 23,
    favorites_count: 5,
    created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const DEMO_INQUIRIES: MarketplaceInquiry[] = [
  {
    id: 'inquiry-1',
    listing_id: 'my-listing-1',
    sender_id: 'buyer-1',
    sender: { id: 'buyer-1', name: 'Alice Cooper', avatarUrl: undefined },
    listing: DEMO_MY_LISTINGS[0],
    message: 'Hi, is this textbook still available? Can you do ₦10,000?',
    created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'inquiry-2',
    listing_id: 'my-listing-1',
    sender_id: 'buyer-2',
    sender: { id: 'buyer-2', name: 'Bob Wilson', avatarUrl: undefined },
    listing: DEMO_MY_LISTINGS[0],
    message: 'Can I pick it up tomorrow at the library?',
    created_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
  },
];

interface MarketplaceState {
  listings: MarketplaceListing[];
  myListings: MarketplaceListing[];
  currentListing: MarketplaceListing | null;
  reviews: MarketplaceReview[];
  similarListings: MarketplaceListing[];
  buyerOffers: MarketplaceOffer[];
  sellerOffers: MarketplaceOffer[];
  favoriteListings: MarketplaceListing[];
  sellerStats: SellerProfile | null;
  favorites: Set<string>;
  inquiries: MarketplaceInquiry[];
  offers: MarketplaceOffer[];
  savedSearches: SavedSearch[];
  sellerProfile: SellerProfile | null;
  shops: MarketplaceShopCard[];
  shopsLoading: boolean;
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
  selectedCategory: MarketplaceCategory | null;
  activeTab: MarketplaceTab;
  minPrice: string;
  maxPrice: string;
  locationFilter: string;
  campusIdFilter: string;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  listingsPage: number;
  listingsHasMore: boolean;
  showFavoritesOnly: boolean;
  
  // Actions
  fetchListings: (filters?: {
    category?: string;
    search?: string;
    page?: number;
    append?: boolean;
  }) => Promise<void>;
  fetchMyListings: (userId: string) => Promise<void>;
  fetchListing: (listingId: string) => Promise<void>;
  fetchListingReviews: (listingId: string) => Promise<void>;
  addReview: (listingId: string, rating: number, comment?: string) => Promise<void>;
  reportListing: (listingId: string, reason: string, details?: string) => Promise<void>;
  fetchSimilar: (listingId: string) => Promise<void>;
  fetchOffers: (role: 'buyer' | 'seller') => Promise<void>;
  fetchServerFavorites: () => Promise<void>;
  fetchInquiries: (userId: string, role?: 'seller' | 'buyer') => Promise<void>;
  updateInquiryStatus: (inquiryId: string, status: 'open' | 'negotiating' | 'closed' | 'purchased') => Promise<void>;
  fetchListingOffers: (listingId: string) => Promise<void>;
  createMarketplaceOffer: (listingId: string, amount: number, message?: string) => Promise<MarketplaceOffer>;
  respondToOffer: (
    offerId: string,
    action: 'accept' | 'decline' | 'counter' | 'withdraw',
    userId: string,
    counterAmount?: number,
    message?: string
  ) => Promise<{
    authorizationUrl?: string;
    orderId?: string;
    checkout?: { authorizationUrl?: string } | null;
  } | void>;
  buyNowListing: (
    listingId: string,
    userId: string,
    couponCode?: string,
    quantity?: number
  ) => Promise<{ order: import('@lantern/shared/types').MarketplaceOrder } | void>;
  addToCart: (listingId: string, quantity?: number) => Promise<void>;
  boostListing: (listingId: string, userId: string) => Promise<void>;
  fetchSavedSearches: () => Promise<void>;
  createSavedSearch: (filters: Record<string, unknown>, name?: string) => Promise<SavedSearch>;
  deleteSavedSearch: (id: string) => Promise<void>;
  fetchSellerProfile: (sellerId: string) => Promise<void>;
  updateMyShop: (data: {
    shopName?: string;
    bio?: string | null;
    coverImageUrl?: string | null;
  }) => Promise<void>;
  fetchShops: (params?: { campus?: string; q?: string }) => Promise<void>;
  fetchSellerStats: () => Promise<void>;
  createListing: (listing: MarketplaceListingCreateInput, userId: string) => Promise<{ listing: MarketplaceListing; queued: boolean }>;
  updateListing: (listingId: string, updates: MarketplaceListingUpdate, userId: string) => Promise<void>;
  /** Seller appeal of a moderation takedown (one shot; the API answers 409 if already appealed). */
  appealListing: (listingId: string, note: string) => Promise<void>;
  deleteListing: (listingId: string, userId: string) => Promise<void>;
  toggleFavorite: (listingId: string, userId: string) => Promise<void>;
  setSearchQuery: (query: string) => void;
  setSelectedCategory: (category: MarketplaceCategory | null) => void;
  setActiveTab: (tab: MarketplaceTab) => void;
  setMinPrice: (value: string) => void;
  setMaxPrice: (value: string) => void;
  setLocationFilter: (value: string) => void;
  setCampusIdFilter: (value: string) => void;
  setSortBy: (value: string) => void;
  setSortOrder: (value: 'asc' | 'desc') => void;
  applySavedSearch: (filters: Record<string, unknown>) => void;
  resetFilters: () => void;
  setShowFavoritesOnly: (value: boolean) => void;
  sendInquiry: (listingId: string, message: string) => Promise<{ threadId?: string; sellerId?: string }>;
  clearError: () => void;
  reset: () => Promise<void>;
  loadFromStorage: () => Promise<void>;
  saveToStorage: () => Promise<void>;
}

export const useMarketplaceStore = create<MarketplaceState>((set, get) => ({
  listings: [],
  myListings: [],
  currentListing: null,
  reviews: [],
  similarListings: [],
  buyerOffers: [],
  sellerOffers: [],
  favoriteListings: [],
  sellerStats: null,
  favorites: new Set(),
  inquiries: [],
  offers: [],
  savedSearches: [],
  sellerProfile: null,
  shops: [],
  shopsLoading: false,
  isLoading: false,
  error: null,
  searchQuery: '',
  selectedCategory: null,
  activeTab: 'academic',
  minPrice: '',
  maxPrice: '',
  locationFilter: '',
  campusIdFilter: '',
  sortBy: 'trending',
  sortOrder: 'desc',
  listingsPage: 1,
  listingsHasMore: true,
  showFavoritesOnly: false,
  
  // Load cached data from AsyncStorage (scoped to current user)
  loadFromStorage: async () => {
    try {
      const userId = getCurrentUserId();
      const [listingsJson, myListingsJson, favoritesJson] = await Promise.all([
        AsyncStorage.getItem(listingsStorageKey(userId)),
        AsyncStorage.getItem(myListingsStorageKey(userId)),
        AsyncStorage.getItem(favoritesStorageKey(userId)),
      ]);

      const parsedMyListings = myListingsJson
        ? (JSON.parse(myListingsJson) as MarketplaceListing[])
        : [];

      set({
        listings: listingsJson ? JSON.parse(listingsJson) : [],
        myListings: userId ? parsedMyListings.filter((l) => l.user_id === userId) : [],
        favorites: favoritesJson ? new Set(JSON.parse(favoritesJson)) : new Set(),
      });
    } catch (error) {
      console.error('Failed to load marketplace from storage:', error);
    }
  },

  // Save current state to AsyncStorage (scoped to current user)
  saveToStorage: async () => {
    try {
      const userId = getCurrentUserId();
      const { listings, myListings, favorites } = get();
      await Promise.all([
        AsyncStorage.setItem(listingsStorageKey(userId), JSON.stringify(listings)),
        AsyncStorage.setItem(
          myListingsStorageKey(userId),
          JSON.stringify(userId ? myListings.filter((l) => l.user_id === userId) : [])
        ),
        AsyncStorage.setItem(favoritesStorageKey(userId), JSON.stringify([...favorites])),
      ]);
    } catch (error) {
      console.error('Failed to save marketplace to storage:', error);
    }
  },

  reset: async () => {
    const userId = getCurrentUserId();
    const keysToRemove = [
      ...LEGACY_MARKETPLACE_STORAGE_KEYS,
      ...getMarketplaceStorageKeysForUser(userId),
      ...getMarketplaceStorageKeysForUser('anonymous'),
    ];

    set({
      listings: [],
      myListings: [],
      currentListing: null,
      reviews: [],
      similarListings: [],
      buyerOffers: [],
      sellerOffers: [],
      favoriteListings: [],
      sellerStats: null,
      favorites: new Set(),
      inquiries: [],
      offers: [],
      savedSearches: [],
      sellerProfile: null,
      shops: [],
      shopsLoading: false,
      isLoading: false,
      error: null,
      searchQuery: '',
      selectedCategory: null,
      activeTab: 'academic',
      minPrice: '',
      maxPrice: '',
      locationFilter: '',
      campusIdFilter: '',
      sortBy: 'trending',
      sortOrder: 'desc',
      listingsPage: 1,
      listingsHasMore: true,
      showFavoritesOnly: false,
    });

    await AsyncStorage.multiRemove([...new Set(keysToRemove)]).catch(() => {});
  },
  
  fetchListings: async (filters) => {
    if (get().activeTab === 'shops') {
      set({ isLoading: false });
      return;
    }
    const requestId = ++listingsRequestSeq;
    try {
      const page = filters?.page ?? 1;
      const append = filters?.append ?? false;
      if (page === 1 && !append) {
        set({ isLoading: true, error: null, listings: [], listingsPage: 1, listingsHasMore: true });
      } else {
        set({ isLoading: true, error: null });
      }

      if (DEMO_MODE) {
        await new Promise(resolve => setTimeout(resolve, 500));
        let filtered = [...DEMO_LISTINGS];
        const { activeTab, selectedCategory, searchQuery, campusIdFilter } = get();
        const academicCategories = ACADEMIC_CATEGORIES.map(c => c.id);
        const studentLifeCategories = STUDENT_LIFE_CATEGORIES.map(c => c.id);
        filtered = filtered.filter(listing => {
          if (activeTab === 'academic') {
            return academicCategories.includes(listing.category as MarketplaceCategory);
          }
          return studentLifeCategories.includes(listing.category as MarketplaceCategory);
        });
        if (selectedCategory || filters?.category) {
          const cat = selectedCategory || filters?.category;
          filtered = filtered.filter(l => l.category === cat);
        }
        const query = searchQuery || filters?.search || '';
        if (query) {
          const lowerQuery = query.toLowerCase();
          filtered = filtered.filter(l =>
            l.title.toLowerCase().includes(lowerQuery) ||
            l.description?.toLowerCase().includes(lowerQuery)
          );
        }
        if (campusIdFilter) {
          filtered = filtered.filter(l => l.campus_id === campusIdFilter);
        }
        set({ listings: filtered, listingsPage: 1, listingsHasMore: false, isLoading: false });
        return;
      }

      const {
        activeTab,
        selectedCategory,
        searchQuery,
        minPrice,
        maxPrice,
        locationFilter,
        campusIdFilter,
        sortBy,
        sortOrder,
      } = get();

      const categoryFilter = selectedCategory || filters?.category;
      const tabCategoryIds = (activeTab === 'academic' ? ACADEMIC_CATEGORIES : STUDENT_LIFE_CATEGORIES).map(c => c.id);

      const raw = await api.fetchMarketplaceListings({
        page,
        limit: 20,
        category: categoryFilter,
        // Tab filtering happens server-side so pages come back full.
        ...(categoryFilter ? {} : { categories: tabCategoryIds, includeCustom: true }),
        search: searchQuery || filters?.search,
        minPrice: minPrice ? Number(minPrice) : undefined,
        maxPrice: maxPrice ? Number(maxPrice) : undefined,
        location: locationFilter || undefined,
        ...buildMarketplaceGeographyQuery(campusIdFilter),
        sortBy,
        sortOrder,
        responseProfile: 'compact',
      }) as
        | RemoteListing[]
        | {
            data: RemoteListing[];
            pagination?: { page: number; limit: number; total: number };
          };

      const apiListings = unwrapListings(raw);
      const pagination =
        raw && typeof raw === 'object' && 'pagination' in raw
          ? (raw as { pagination?: { page: number; limit: number; total: number } }).pagination
          : undefined;

      const filtered = apiListings.map(mapRemoteListing);

      const total = pagination?.total ?? filtered.length;
      const limit = pagination?.limit ?? 20;
      const hasMore = page * limit < total;

      if (requestId !== listingsRequestSeq) return;

      set(state => ({
        listings: append ? [...state.listings, ...filtered] : filtered,
        listingsPage: page,
        listingsHasMore: hasMore,
        isLoading: false,
      }));
      await get().saveToStorage();
    } catch (error: unknown) {
      if (requestId !== listingsRequestSeq) return;
      console.error('Failed to fetch listings:', error);
      if (error instanceof RateLimitError) {
        const retrySec = Math.ceil(error.retryAfterMs / 1000);
        set({
          error: `Browsing too quickly. Try again in about ${retrySec} seconds.`,
          isLoading: false,
        });
        return;
      }
      const message = error instanceof Error ? error.message : 'Failed to load listings';
      set({ error: message, isLoading: false });
    }
  },
  
  fetchMyListings: async (userId: string) => {
    try {
      set({ isLoading: true, error: null, myListings: [] });

      if (DEMO_MODE) {
        await new Promise(resolve => setTimeout(resolve, 300));
        set({ myListings: DEMO_MY_LISTINGS, isLoading: false });
        return;
      }

      await get().loadFromStorage();

      try {
        const apiListings = await api.fetchMyListings();
        const myListings = apiListings
          .map((l) => mapRemoteListing(l as RemoteListing))
          .filter((l) => l.user_id === userId);
        set({ myListings, isLoading: false });
        await get().saveToStorage();
      } catch (apiError) {
        console.warn('Failed to fetch my listings from API, using user-scoped cache:', apiError);
        const cached = get().myListings.filter((l) => l.user_id === userId);
        set({ myListings: cached, isLoading: false });
      }
    } catch (error: any) {
      console.error('Failed to fetch my listings:', error);
      set({ error: error.message, isLoading: false, myListings: [] });
    }
  },
  
  fetchListing: async (listingId: string) => {
    const requestId = ++listingFetchSeq;
    try {
      set({ isLoading: true, error: null });
      
      if (DEMO_MODE) {
        await new Promise(resolve => setTimeout(resolve, 300));
        if (requestId !== listingFetchSeq) return;
        const allListings = [...DEMO_LISTINGS, ...DEMO_MY_LISTINGS];
        const listing = allListings.find(l => l.id === listingId) || null;
        set({ currentListing: listing, isLoading: false });
        return;
      }
      
      const l = await api.fetchMarketplaceListing(listingId);
      if (requestId !== listingFetchSeq) return;
      const currentListing = mapRemoteListing(l as RemoteListing);
      set({ currentListing, isLoading: false });
    } catch (error: any) {
      if (requestId !== listingFetchSeq) return;
      console.error('Failed to fetch listing:', error);
      set({ error: error.message, isLoading: false });
    }
  },
  
  fetchInquiries: async (userId: string, role: 'seller' | 'buyer' = 'seller') => {
    try {
      set({ isLoading: true, error: null });
      
      if (DEMO_MODE) {
        await new Promise(resolve => setTimeout(resolve, 300));
        set({ inquiries: DEMO_INQUIRIES, isLoading: false });
        return;
      }
      
      const rows = await api.fetchMyInquiries(role);
      set({
        inquiries: rows.map(inq => ({
          id: inq.id,
          listing_id: inq.listing_id,
          sender_id: role === 'seller' ? inq.buyer_id : inq.seller_id,
          message: inq.initial_message,
          created_at: inq.created_at,
        })),
        isLoading: false,
      });
    } catch (error: any) {
      console.error('Failed to fetch inquiries:', error);
      set({ error: error.message, isLoading: false });
    }
  },
  
  createListing: async (listingInput, userId) => {
    // The attestation is a request flag, not a listing field: keep it off the
    // optimistic row and the offline queue payload's local copy.
    const { attestation, ...listingData } = listingInput;
    // Create temp ID for optimistic update
    const tempId = `temp_listing_${Date.now()}`;
    const tempListing: MarketplaceListing = {
      ...listingData,
      id: tempId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      views_count: 0,
      favorites_count: 0,
    };
    
    // Optimistic update
    set(state => ({
      myListings: [tempListing, ...state.myListings],
      listings: [tempListing, ...state.listings],
    }));
    await get().saveToStorage();
    
    if (DEMO_MODE) {
      return { listing: tempListing, queued: false };
    }
    
    try {
      const created = await api.createMarketplaceListing({
        category: listingData.category,
        title: listingData.title,
        description: listingData.description,
        price: listingData.price,
        quantity: listingData.quantity ?? undefined,
        location: listingData.location,
        campus_id: listingData.campus_id,
        images: listingData.images,
        sale_price: listingData.sale_price,
        sale_ends_at: listingData.sale_ends_at,
        promo_label: listingData.promo_label,
        ...(listingData.courseId !== undefined ? { courseId: listingData.courseId } : {}),
        ...(listingData.category_specific_fields
          ? { categorySpecificFields: listingData.category_specific_fields }
          : {}),
        ...(attestation ? { attestation: true } : {}),
      });
      
      const createdListing = created as unknown as RemoteListing;
      const newListing: MarketplaceListing = mapRemoteListing({
        ...listingData,
        ...createdListing,
        campus_id: createdListing.campus_id ?? listingData.campus_id,
        country_code: createdListing.country_code ?? listingData.country_code ?? 'NG',
        currency: createdListing.currency ?? listingData.currency ?? 'NGN',
        status: created.status,
      });
      
      // Replace temp with real listing
      set(state => ({
        myListings: state.myListings.map(l => l.id === tempId ? newListing : l),
        listings: state.listings.map(l => l.id === tempId ? newListing : l),
      }));
      await get().saveToStorage();
      
      return { listing: newListing, queued: false };
    } catch (error: any) {
      console.error('Failed to create listing on server:', error);
      if (isRetryableMarketplaceError(error)) {
        // Offline / transient: queue for later sync and keep the optimistic listing.
        await syncService.queueOperation('listing', tempId, 'create', listingInput, userId);
        return { listing: tempListing, queued: true };
      }
      // Server rejected the listing — roll back the optimistic insert and
      // surface the real error instead of pretending it was published.
      set(state => ({
        myListings: state.myListings.filter(l => l.id !== tempId),
        listings: state.listings.filter(l => l.id !== tempId),
      }));
      await get().saveToStorage();
      throw error;
    }
  },
  
  updateListing: async (listingId: string, updates: MarketplaceListingUpdate, userId: string) => {
    const previousMy = get().myListings.find((l) => l.id === listingId);
    const previousBrowse = get().listings.find((l) => l.id === listingId);
    const previousCurrent =
      get().currentListing?.id === listingId ? get().currentListing : null;

    // The server payload keeps explicit nulls (they clear a discount), but the
    // in-memory MarketplaceListing type expects number|string|undefined, so
    // coerce null -> undefined for the optimistic local copy only.
    const { attestation, ...listingUpdates } = updates;
    const optimistic: Partial<MarketplaceListing> = {
      ...listingUpdates,
      sale_price: updates.sale_price ?? undefined,
      sale_ends_at: updates.sale_ends_at ?? undefined,
      promo_label: updates.promo_label ?? undefined,
    };

    // Optimistic update
    set(state => ({
      myListings: state.myListings.map(l =>
        l.id === listingId ? { ...l, ...optimistic, updated_at: new Date().toISOString() } : l
      ),
      listings: state.listings.map(l =>
        l.id === listingId ? { ...l, ...optimistic, updated_at: new Date().toISOString() } : l
      ),
      currentListing: state.currentListing?.id === listingId
        ? { ...state.currentListing, ...optimistic, updated_at: new Date().toISOString() }
        : state.currentListing,
    }));
    await get().saveToStorage();
    
    if (DEMO_MODE) return;
    
    try {
      const { category_specific_fields: categoryFields, ...serverUpdates } = listingUpdates;
      await api.updateMarketplaceListing(listingId, {
        ...serverUpdates,
        campus_id: updates.campus_id ?? undefined,
        // Server merges client keys with its own (server-owned keys preserved).
        ...(categoryFields ? { categorySpecificFields: categoryFields } : {}),
        ...(attestation ? { attestation: true } : {}),
      });
      if (updates.status === 'sold') {
        await refreshMarketplaceBudget(userId);
      }
    } catch (error: any) {
      console.error('Failed to update listing on server:', error);
      // REL-01: queue only transient failures; roll back permanent 4xx.
      if (isRetryableMarketplaceError(error)) {
        await syncService.queueOperation('listing', listingId, 'update', updates, userId);
        return;
      }
      set((state) => ({
        myListings: previousMy
          ? state.myListings.map((l) => (l.id === listingId ? previousMy : l))
          : state.myListings,
        listings: previousBrowse
          ? state.listings.map((l) => (l.id === listingId ? previousBrowse : l))
          : state.listings,
        currentListing:
          previousCurrent && state.currentListing?.id === listingId
            ? previousCurrent
            : state.currentListing,
        error: error?.message || 'Failed to update listing',
      }));
      await get().saveToStorage();
      throw error;
    }
  },
  
  appealListing: async (listingId: string, note: string) => {
    const result = await api.appealListingTakedown(listingId, note);
    const patch: Partial<MarketplaceListing> = {
      appeal_status: result.appeal_status ?? 'requested',
      appeal_note: note,
      appealed_at: result.appealed_at ?? new Date().toISOString(),
    };
    set((state) => ({
      myListings: state.myListings.map((l) => (l.id === listingId ? { ...l, ...patch } : l)),
      currentListing:
        state.currentListing?.id === listingId
          ? { ...state.currentListing, ...patch }
          : state.currentListing,
    }));
    await get().saveToStorage();
  },

  deleteListing: async (listingId: string, userId: string) => {
    const previousMy = get().myListings.find((l) => l.id === listingId);
    const previousBrowse = get().listings.find((l) => l.id === listingId);
    const previousCurrent =
      get().currentListing?.id === listingId ? get().currentListing : null;

    // Optimistic delete
    set(state => ({
      myListings: state.myListings.filter(l => l.id !== listingId),
      listings: state.listings.filter(l => l.id !== listingId),
      currentListing: state.currentListing?.id === listingId ? null : state.currentListing,
    }));
    await get().saveToStorage();
    
    if (DEMO_MODE) return;
    
    try {
      await api.deleteMarketplaceListing(listingId);
    } catch (error: any) {
      console.error('Failed to delete listing on server:', error);
      // REL-01: queue only transient failures; restore listing on permanent 4xx.
      if (isRetryableMarketplaceError(error)) {
        await syncService.queueOperation('listing', listingId, 'delete', {}, userId);
        return;
      }
      set((state) => ({
        myListings: previousMy
          ? [previousMy, ...state.myListings.filter((l) => l.id !== listingId)]
          : state.myListings,
        listings: previousBrowse
          ? [previousBrowse, ...state.listings.filter((l) => l.id !== listingId)]
          : state.listings,
        currentListing: previousCurrent || state.currentListing,
        error: error?.message || 'Failed to delete listing',
      }));
      await get().saveToStorage();
      throw error;
    }
  },
  
  toggleFavorite: async (listingId: string, userId: string) => {
    const { favorites } = get();
    const newFavorites = new Set(favorites);
    const isFavorited = newFavorites.has(listingId);
    
    if (isFavorited) {
      newFavorites.delete(listingId);
      void import('../screens/marketplace/marketplaceFavoritePrices').then(m =>
        m.forgetFavoritePrice(listingId)
      );
    } else {
      newFavorites.add(listingId);
      // Remember the price at favorite time so Saved Listings can flag drops.
      const listing =
        get().listings.find(l => l.id === listingId) ||
        get().favoriteListings.find(l => l.id === listingId) ||
        get().currentListing;
      const seenPrice = listing?.id === listingId ? listing?.effective_price ?? listing?.price : undefined;
      void import('../screens/marketplace/marketplaceFavoritePrices').then(m =>
        m.snapshotFavoritePrice(listingId, seenPrice)
      );
    }
    
    // Optimistic update
    set({ favorites: newFavorites });
    await get().saveToStorage();
    
    // Sync with API
    if (!DEMO_MODE) {
      try {
        if (isFavorited) {
          await api.removeFromFavorites(listingId);
        } else {
          await api.addToFavorites(listingId);
        }
      } catch (error) {
        // Revert on error
        console.error('Failed to toggle favorite:', error);
        if (isFavorited) {
          newFavorites.add(listingId);
        } else {
          newFavorites.delete(listingId);
        }
        set({ favorites: newFavorites });
        await get().saveToStorage();
      }
    }
  },
  
  setSearchQuery: (query: string) => {
    set({ searchQuery: query });
  },
  
  setSelectedCategory: (category: MarketplaceCategory | null) => {
    listingsRequestSeq += 1;
    set({
      selectedCategory: category,
      listings: [],
      listingsPage: 1,
      listingsHasMore: true,
      isLoading: true,
    });
  },
  
  setActiveTab: (tab: MarketplaceTab) => {
    listingsRequestSeq += 1;
    set({
      activeTab: tab,
      selectedCategory: null,
      listings: tab === 'shops' ? get().listings : [],
      listingsPage: 1,
      listingsHasMore: true,
      isLoading: tab !== 'shops',
    });
    if (tab === 'shops') {
      void get().fetchShops({
        campus: get().campusIdFilter || undefined,
        q: get().searchQuery || undefined,
      });
    }
  },
  
  sendInquiry: async (listingId: string, message: string) => {
    try {
      set({ isLoading: true, error: null });

      if (DEMO_MODE) {
        await new Promise(resolve => setTimeout(resolve, 300));
        set({ isLoading: false });
        return {};
      }

      // API shape: { inquiry, threadId } (existing inquiries may flatten to the inquiry row).
      const result = (await api.createInquiry(listingId, message)) as {
        inquiry?: { dm_thread_id?: string; seller_id?: string };
        threadId?: string;
        dm_thread_id?: string;
        seller_id?: string;
      };
      const inquiry = result.inquiry ?? result;
      set({ isLoading: false });
      return {
        threadId: result.threadId || inquiry.dm_thread_id,
        sellerId: inquiry.seller_id,
      };
    } catch (error: any) {
      console.error('Failed to send inquiry:', error);
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  fetchListingReviews: async (listingId: string) => {
    try {
      if (DEMO_MODE) {
        set({ reviews: [] });
        return;
      }
      const rows = await api.fetchListingReviews(listingId);
      set({
        reviews: rows.map(r => ({
          id: r.id,
          listing_id: r.listing_id,
          reviewer_id: r.reviewer_id,
          reviewer: r.reviewer
            ? { id: r.reviewer.id, name: r.reviewer.name, avatarUrl: r.reviewer.avatar_url }
            : undefined,
          rating: r.rating,
          comment: r.comment,
          created_at: r.created_at,
        })),
      });
    } catch (error: any) {
      console.error('Failed to fetch listing reviews:', error);
    }
  },

  addReview: async (listingId: string, rating: number, comment?: string) => {
    await api.addMarketplaceReview(listingId, { rating, comment });
    await get().fetchListingReviews(listingId);
  },

  reportListing: async (listingId: string, reason: string, details?: string) => {
    await api.reportMarketplaceListing(listingId, { reason, details });
  },

  fetchSimilar: async (listingId: string) => {
    try {
      if (DEMO_MODE) {
        set({ similarListings: [] });
        return;
      }
      const rows = await api.fetchSimilarListings(listingId);
      set({ similarListings: rows.map(r => mapRemoteListing(r as RemoteListing)) });
    } catch (error: any) {
      console.error('Failed to fetch similar listings:', error);
      set({ similarListings: [] });
    }
  },

  fetchOffers: async (role: 'buyer' | 'seller') => {
    try {
      set({ isLoading: true, error: null });
      if (DEMO_MODE) {
        set({ buyerOffers: [], sellerOffers: [], isLoading: false });
        return;
      }
      const rows = await api.fetchMarketplaceOffers(role);
      const mapped: MarketplaceOffer[] = rows.map(o => ({
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
        order: mapOfferOrder((o as { order?: unknown }).order),
      }));
      if (role === 'buyer') {
        set({ buyerOffers: mapped, isLoading: false });
      } else {
        set({ sellerOffers: mapped, isLoading: false });
      }
    } catch (error: any) {
      console.error('Failed to fetch offers:', error);
      set({ error: error.message, isLoading: false });
    }
  },

  fetchServerFavorites: async () => {
    try {
      if (DEMO_MODE) return;
      const rows = await api.fetchMyFavorites();
      const favoriteIds = new Set<string>();
      const favoriteListings: MarketplaceListing[] = [];
      for (const fav of rows as Array<{ listing?: RemoteListing; listing_id?: string }>) {
        const listing = fav.listing;
        const listingId = listing?.id || fav.listing_id;
        if (listingId) favoriteIds.add(listingId);
        if (listing) favoriteListings.push(mapRemoteListing(listing));
      }
      set({ favorites: favoriteIds, favoriteListings });
      await get().saveToStorage();
    } catch (error: any) {
      console.error('Failed to fetch server favorites:', error);
    }
  },

  updateInquiryStatus: async (inquiryId, status) => {
    await api.updateInquiryStatus(inquiryId, status);
  },

  fetchSellerStats: async () => {
    try {
      const stats = await api.fetchSellerStats();
      if (!stats) return;
      set({
        sellerStats: {
          id: 'me',
          name: 'My stats',
          total_listings: stats.totalListings,
          active_listings: stats.activeListings,
          sold_listings: stats.soldListings,
          completed_orders: stats.completedOrders,
          total_views: stats.totalViews,
          total_inquiries: stats.totalInquiries,
          total_favorites: stats.totalFavorites,
        },
      });
    } catch (error: any) {
      console.error('Failed to fetch seller stats:', error);
    }
  },

  setMinPrice: (value: string) => set({ minPrice: value }),
  setMaxPrice: (value: string) => set({ maxPrice: value }),
  setLocationFilter: (value: string) => set({ locationFilter: value }),
  setCampusIdFilter: (value: string) => {
    listingsRequestSeq += 1;
    set({
      campusIdFilter: value,
      listings: [],
      listingsPage: 1,
      listingsHasMore: true,
      isLoading: true,
      error: null,
    });
  },
  setSortBy: (value: string) => set({ sortBy: value }),
  setSortOrder: (value: 'asc' | 'desc') => set({ sortOrder: value }),
  applySavedSearch: (filters: Record<string, unknown>) => {
    listingsRequestSeq += 1;
    const normalized = normalizeSavedMarketplaceFilters(filters);
    set({
      ...normalized,
      selectedCategory: normalized.selectedCategory as MarketplaceCategory | null,
      listings: [],
      listingsPage: 1,
      listingsHasMore: true,
      showFavoritesOnly: false,
      isLoading: true,
      error: null,
    });
  },
  resetFilters: () => {
    listingsRequestSeq += 1;
    set({
      minPrice: '',
      maxPrice: '',
      locationFilter: '',
      campusIdFilter: '',
      sortBy: 'trending',
      sortOrder: 'desc',
      listings: [],
      listingsPage: 1,
      listingsHasMore: true,
      isLoading: true,
      error: null,
    });
  },
  setShowFavoritesOnly: (value: boolean) => set({ showFavoritesOnly: value }),

  fetchListingOffers: async (listingId: string) => {
    try {
      set({ isLoading: true, error: null });

      if (DEMO_MODE) {
        await new Promise(resolve => setTimeout(resolve, 200));
        set({ offers: [], isLoading: false });
        return;
      }

      const apiOffers = await api.fetchListingOffers(listingId);
      // seller_id, proposed_by and parent_offer_id are what canRespondToOffer /
      // canWithdrawOffer / getOfferProposedBy key off. Dropping them made every
      // offer look buyer-proposed with no responder, so no action button rendered.
      const offers: MarketplaceOffer[] = apiOffers.map((o: any) => ({
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
      }));
      set({ offers, isLoading: false });
    } catch (error: any) {
      console.error('Failed to fetch listing offers:', error);
      set({ error: error.message, isLoading: false });
    }
  },

  createMarketplaceOffer: async (listingId: string, amount: number, message?: string) => {
    try {
      set({ isLoading: true, error: null });

      if (DEMO_MODE) {
        const demoOffer: MarketplaceOffer = {
          id: `offer-${Date.now()}`,
          listing_id: listingId,
          buyer_id: 'demo-user',
          amount,
          message,
          status: 'pending',
          created_at: new Date().toISOString(),
        };
        set(state => ({ offers: [demoOffer, ...state.offers], isLoading: false }));
        return demoOffer;
      }

      const created = await api.createMarketplaceOffer(listingId, amount, message);
      const offer: MarketplaceOffer = {
        id: created.id,
        listing_id: created.listing_id,
        buyer_id: created.buyer_id,
        seller_id: created.seller_id,
        amount: created.amount,
        message: created.message,
        status: created.status as MarketplaceOffer['status'],
        created_at: created.created_at,
      };
      set(state => ({ offers: [offer, ...state.offers], isLoading: false }));
      return offer;
    } catch (error: any) {
      console.error('Failed to create offer:', error);
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  respondToOffer: async (offerId, action, userId, counterAmount, message) => {
    try {
      set({ isLoading: true, error: null });
      const existingOffer =
        get().sellerOffers.find(o => o.id === offerId) ||
        get().buyerOffers.find(o => o.id === offerId) ||
        get().offers.find(o => o.id === offerId);

      if (DEMO_MODE) {
        set(state => ({
          offers: state.offers.map(o =>
            o.id === offerId
              ? { ...o, status: action === 'accept' ? 'accepted' : action === 'decline' ? 'declined' : o.status }
              : o
          ),
          isLoading: false,
        }));
        if (action === 'accept' && existingOffer) {
          await refreshMarketplaceBudget(userId);
        }
        return;
      }

      const updated = await api.respondToOffer(offerId, action, counterAmount, message);
      set(state => ({
        offers: state.offers.map(o =>
          o.id === offerId
            ? { ...o, status: updated.status as MarketplaceOffer['status'], amount: updated.amount, updated_at: updated.updated_at }
            : o
        ),
        sellerOffers: state.sellerOffers.map(o =>
          o.id === offerId
            ? { ...o, status: updated.status as MarketplaceOffer['status'], amount: updated.amount, updated_at: updated.updated_at }
            : o
        ),
        buyerOffers: state.buyerOffers.map(o =>
          o.id === offerId
            ? { ...o, status: updated.status as MarketplaceOffer['status'], amount: updated.amount, updated_at: updated.updated_at }
            : o
        ),
        isLoading: false,
      }));

      if (action === 'accept') {
        await refreshMarketplaceBudget(userId);
      }
      return updated;
    } catch (error: any) {
      console.error('Failed to respond to offer:', error);
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  buyNowListing: async (
    listingId: string,
    userId: string,
    couponCode?: string,
    quantity?: number
  ) => {
    try {
      set({ isLoading: true, error: null });

      if (DEMO_MODE) {
        const listing = get().currentListing;
        if (listing) {
          await get().updateListing(listingId, { status: 'sold' }, userId);
        }
        await refreshMarketplaceBudget(userId);
        set({ isLoading: false });
        return;
      }

      const result = await api.buyNowListing(listingId, couponCode, undefined, quantity);
      await get().fetchMyListings(userId);
      set({ isLoading: false });
      return result;
    } catch (error: any) {
      console.error('Failed to buy listing:', error);
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  addToCart: async (listingId: string, quantity?: number) => {
    try {
      set({ error: null });
      if (DEMO_MODE) return;
      await api.addToMarketplaceCart(listingId, quantity);
    } catch (error: any) {
      console.error('Failed to add to cart:', error);
      set({ error: error.message });
      throw error;
    }
  },

  boostListing: async (listingId: string, userId: string) => {
    try {
      set({ isLoading: true, error: null });

      if (DEMO_MODE) {
        set({ isLoading: false });
        return;
      }

      await api.boostListing(listingId);
      await get().fetchListing(listingId);
      set({ isLoading: false });
    } catch (error: any) {
      console.error('Failed to boost listing:', error);
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  fetchSavedSearches: async () => {
    try {
      set({ isLoading: true, error: null });

      if (DEMO_MODE) {
        set({ savedSearches: [], isLoading: false });
        return;
      }

      const apiSearches = await api.fetchSavedSearches();
      const savedSearches: SavedSearch[] = apiSearches.map(s => ({
        id: s.id,
        user_id: s.user_id,
        name: s.name,
        filters: s.filters,
        created_at: s.created_at,
      }));
      set({ savedSearches, isLoading: false });
    } catch (error: any) {
      console.error('Failed to fetch saved searches:', error);
      set({ error: error.message, isLoading: false });
    }
  },

  createSavedSearch: async (filters, name) => {
    try {
      set({ isLoading: true, error: null });

      if (DEMO_MODE) {
        const demo: SavedSearch = {
          id: `search-${Date.now()}`,
          user_id: 'demo-user',
          name: name || 'Saved search',
          filters,
          created_at: new Date().toISOString(),
        };
        set(state => ({ savedSearches: [demo, ...state.savedSearches], isLoading: false }));
        return demo;
      }

      const created = await api.createSavedSearch({ filters, name });
      const saved: SavedSearch = {
        id: created.id,
        user_id: created.user_id,
        name: created.name,
        filters: created.filters,
        created_at: created.created_at,
      };
      set(state => ({ savedSearches: [saved, ...state.savedSearches], isLoading: false }));
      return saved;
    } catch (error: any) {
      console.error('Failed to create saved search:', error);
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  deleteSavedSearch: async (id: string) => {
    try {
      set({ isLoading: true, error: null });

      if (!DEMO_MODE) {
        await api.deleteSavedSearch(id);
      }

      set(state => ({
        savedSearches: state.savedSearches.filter(s => s.id !== id),
        isLoading: false,
      }));
    } catch (error: any) {
      console.error('Failed to delete saved search:', error);
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  fetchSellerProfile: async (sellerId: string) => {
    try {
      set({ isLoading: true, error: null });

      if (DEMO_MODE) {
        set({
          sellerProfile: {
            id: sellerId,
            name: 'Demo Seller',
            total_listings: 5,
            active_listings: 3,
            sold_listings: 2,
            average_rating: 4.5,
            review_count: 12,
          },
          isLoading: false,
        });
        return;
      }

      const data = await api.fetchSellerProfile(sellerId);
      set({
        sellerProfile: {
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
        },
        isLoading: false,
      });
    } catch (error: any) {
      console.error('Failed to fetch seller profile:', error);
      set({ error: error.message, isLoading: false });
    }
  },

  updateMyShop: async (data) => {
    const updated = await api.updateMyShop(data);
    const current = get().sellerProfile;
    if (!current) return;
    set({
      sellerProfile: {
        ...current,
        shopName: updated.shopName,
        shopBio: updated.bio,
        coverImageUrl: updated.coverImageUrl,
      },
    });
  },

  fetchShops: async (params) => {
    try {
      set({ shopsLoading: true, error: null });
      if (DEMO_MODE) {
        set({ shops: [], shopsLoading: false });
        return;
      }
      const rows = await api.fetchMarketplaceShops(params);
      const shops: MarketplaceShopCard[] = (Array.isArray(rows) ? rows : []).map((s: any) => ({
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
      }));
      set({ shops, shopsLoading: false });
    } catch (error: any) {
      console.error('Failed to fetch shops:', error);
      set({ shops: [], shopsLoading: false, error: error.message });
    }
  },
  
  clearError: () => set({ error: null }),
}));

// Helper to get category info
export const getCategoryInfo = (categoryId: string) => {
  const allCategories = [...ACADEMIC_CATEGORIES, ...STUDENT_LIFE_CATEGORIES];
  return allCategories.find(c => c.id === categoryId) || { id: categoryId, name: categoryId, icon: 'help-circle' };
};
