/**
 * Marketplace store — the UI-state layer.
 *
 * This is the zustand store every marketplace screen reads: browse and
 * filters, listing detail, my listings, favorites, reviews, offers, inquiries,
 * cart and the Shop badge summary. It owns state, optimism and sequencing, and
 * composes the other two layers — `transport.ts` for every call out (API,
 * offline queue, AsyncStorage) and `mapping.ts` for every row→model
 * conversion. It performs no I/O and no mapping of its own.
 *
 * Writes are optimistic, with a rollback-or-queue rule that depends on whether
 * the failure was transient.
 *
 * Touches: transport (which owns AsyncStorage under PER-USER keys and
 * services/api + services/syncService), authStore for the current user id,
 * budgetStore after money moves.
 *
 * Gotchas:
 * - Only transient failures (network / 408 / 429 / 5xx) may be queued; a
 *   permanent 4xx must roll the optimistic change back, or a rejected listing
 *   sits on screen as if it were published.
 * - Browse fetches are guarded by `listingsRequestSeq` (and detail by
 *   `listingFetchSeq`); every filter setter bumps the sequence so an in-flight
 *   page for the previous filter cannot land.
 * - `marketplaceAccess: null` means "no answer", NOT a denial. The server is
 *   the enforcement point; the client may never accuse an account on a failed
 *   probe.
 * - Rating fields are null until the ratings migration is applied — hide the
 *   UI rather than render zero stars.
 */
import { create } from 'zustand';
import { getTaxonomyNode } from '@lantern/shared/marketplace';
import { RateLimitError } from '@lantern/shared';
import { useBudgetStore } from '../budgetStore';
import { useAuthStore } from '../authStore';
import {
  buildMarketplaceGeographyQuery,
  normalizeSavedMarketplaceFilters,
} from '../marketplaceFilters';
import * as transport from './transport';
import {
  ACADEMIC_CATEGORIES,
  DEFAULT_MARKETPLACE_TAB,
  EMPTY_SHOP_SUMMARY,
  STUDENT_LIFE_CATEGORIES,
  buildBrowseScopeQuery,
  categoriesForTab,
  mapCreatedOffer,
  mapInquiryRow,
  mapListingOfferRow,
  mapOfferRow,
  mapRemoteListing,
  mapReviewRow,
  mapSavedSearchRow,
  mapSellerProfile,
  mapSellerStats,
  mapShopCard,
  mergeShopSummary,
} from './mapping';
import type {
  MarketplaceCategory,
  MarketplaceInquiry,
  MarketplaceListing,
  MarketplaceListingCreateInput,
  MarketplaceListingUpdate,
  MarketplaceOffer,
  MarketplaceReview,
  MarketplaceShopCard,
  MarketplaceTab,
  RemoteListing,
  SavedSearch,
  SellerProfile,
  ShopSummary,
} from './types';

// Demo mode flag
const DEMO_MODE = false;

let listingsRequestSeq = 0;
let listingFetchSeq = 0;

function getCurrentUserId(): string | null {
  return useAuthStore.getState().user?.id ?? null;
}

const refreshMarketplaceBudget = async (userId: string) => {
  if (DEMO_MODE || !userId) return;
  try {
    await useBudgetStore.getState().fetchTransactions(userId);
  } catch (error) {
    console.warn('Failed to refresh budget after marketplace action:', error);
  }
};

/** How long a summary stays fresh before a screen focus refetches it. */
const SHOP_SUMMARY_TTL_MS = 45_000;

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
  /**
   * The exact taxonomy node the buyer drilled into from Shop by department.
   * Narrower than `selectedCategory`: a category chip says "textbooks", a node
   * says "solutions manuals". Null means the buyer is browsing the department.
   */
  taxonomyNodeId: string | null;
  minPrice: string;
  maxPrice: string;
  locationFilter: string;
  campusIdFilter: string;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  /** Minimum average rating (1–5) or null for any. Server-enforced post-migration. */
  minRating: number | null;
  /** Item condition slug ('new', 'like-new', …) or '' for any. */
  conditionFilter: string;
  /**
   * @deprecated Nothing reads this any more.
   *
   * It carried the founder-only private-pilot verdict: true = allowed,
   * false = the server said no, null = unknown (never a denial). The allowlist
   * was removed on 2026-09-15 — the marketplace is open to every student, the
   * server always answers `enabled: true`, and no screen is gated on it. Left
   * in place only because this slice is mid-split; do NOT gate a screen on it.
   */
  marketplaceAccess: boolean | null;
  /** @deprecated The last probe failed rather than answering. Unread. */
  marketplaceAccessUnavailable: boolean;
  /**
   * The numbers Amazon keeps in front of you: what is in the cart, what needs
   * your attention as a buyer, what needs it as a seller. Powers every badge on
   * the Shop header, the quick-access band and the You hub.
   */
  shopSummary: ShopSummary;
  shopSummaryLoadedAt: number | null;
  shopSummaryLoading: boolean;
  fetchShopSummary: (options?: { force?: boolean }) => Promise<void>;
  /**
   * Mark the summary stale so the next Shop focus refetches instead of trusting
   * the TTL. Called after anything that changes what needs you: a checkout, an
   * offer response, an order action.
   */
  invalidateShopSummary: () => void;
  /** The cart screen knows the exact quantity it just loaded; let it correct the badge. */
  setCartCount: (n: number) => void;
  /** A probe is in flight; keeps the gate on a spinner instead of a verdict. */
  marketplaceAccessChecking: boolean;
  checkMarketplaceAccess: () => Promise<void>;
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
  toggleReviewHelpful: (listingId: string, reviewId: string) => Promise<void>;
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
  setTaxonomyNode: (nodeId: string | null) => void;
  setMinPrice: (value: string) => void;
  setMaxPrice: (value: string) => void;
  setLocationFilter: (value: string) => void;
  setCampusIdFilter: (value: string) => void;
  setSortBy: (value: string) => void;
  setSortOrder: (value: 'asc' | 'desc') => void;
  setMinRating: (value: number | null) => void;
  setConditionFilter: (value: string) => void;
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
  activeTab: DEFAULT_MARKETPLACE_TAB,
  taxonomyNodeId: null,
  minPrice: '',
  maxPrice: '',
  locationFilter: '',
  campusIdFilter: '',
  sortBy: 'trending',
  sortOrder: 'desc',
  minRating: null,
  conditionFilter: '',
  marketplaceAccess: null,
  marketplaceAccessUnavailable: false,
  marketplaceAccessChecking: false,
  shopSummary: EMPTY_SHOP_SUMMARY,
  shopSummaryLoadedAt: null,
  shopSummaryLoading: false,
  listingsPage: 1,
  listingsHasMore: true,
  showFavoritesOnly: false,

  // Load cached data from AsyncStorage (scoped to current user)
  // My-listings rows are filtered to the signed-in user on the way IN as well
  // as on the way out, so a cache written under one account cannot surface
  // another's listings after a switch.
  loadFromStorage: async () => {
    try {
      const userId = getCurrentUserId();
      const { listingsJson, myListingsJson, favoritesJson } =
        await transport.readMarketplaceCache(userId);

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
      await transport.writeMarketplaceCache(userId, {
        listings,
        myListings: userId ? myListings.filter((l) => l.user_id === userId) : [],
        favorites: [...favorites],
      });
    } catch (error) {
      console.error('Failed to save marketplace to storage:', error);
    }
  },

  // Sign-out / account-switch cleanup: blank the state and remove this user's
  // keys, the `anonymous` keys and the legacy device-global ones. Anything left
  // behind greets the next account with the previous one's data or verdict.
  reset: async () => {
    const userId = getCurrentUserId();
    const keysToRemove = [
      ...transport.LEGACY_MARKETPLACE_STORAGE_KEYS,
      ...transport.getMarketplaceStorageKeysForUser(userId),
      ...transport.getMarketplaceStorageKeysForUser('anonymous'),
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
      // A verdict belongs to the account that earned it: leaving it behind let
      // one account's "no" greet the next sign-in.
      marketplaceAccess: null,
      marketplaceAccessUnavailable: false,
      marketplaceAccessChecking: false,
      shopSummary: EMPTY_SHOP_SUMMARY,
      shopSummaryLoadedAt: null,
      shopSummaryLoading: false,
      shops: [],
      shopsLoading: false,
      isLoading: false,
      error: null,
      searchQuery: '',
      selectedCategory: null,
      activeTab: DEFAULT_MARKETPLACE_TAB,
  taxonomyNodeId: null,
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

    await transport.removeMarketplaceStorageKeys(keysToRemove);
  },

  // Browse fetch. The scope sent to the server is decided by
  // `buildBrowseScopeQuery` (mapping.ts). Filtering is server-side so pages come
  // back full. A stale response (its `requestId` no longer the latest) is
  // dropped, both on success and on error.
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
          if (activeTab !== 'shops') {
            const ids = categoriesForTab(activeTab).map((c) => c.id);
            return ids.includes(listing.category as MarketplaceCategory);
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
        minRating,
        taxonomyNodeId,
        conditionFilter,
      } = get();

      const categoryFilter = selectedCategory || filters?.category;
      const scopeQuery = buildBrowseScopeQuery({ activeTab, categoryFilter, taxonomyNodeId });

      const { rows: apiListings, pagination } = await transport.fetchListingsPage({
        page,
        limit: 20,
        // Scope filtering happens server-side so pages come back full.
        ...scopeQuery,
        search: searchQuery || filters?.search,
        minPrice: minPrice ? Number(minPrice) : undefined,
        maxPrice: maxPrice ? Number(maxPrice) : undefined,
        location: locationFilter || undefined,
        ...buildMarketplaceGeographyQuery(campusIdFilter),
        sortBy,
        sortOrder,
        minRating: minRating ?? undefined,
        condition: conditionFilter || undefined,
        responseProfile: 'compact',
      });

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
        const apiListings = await transport.fetchMyListings();
        const myListings = apiListings
          .map((l) => mapRemoteListing(l))
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

      const l = await transport.fetchListing(listingId);
      if (requestId !== listingFetchSeq) return;
      const currentListing = mapRemoteListing(l);
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

      const rows = await transport.fetchMyInquiries(role);
      set({
        inquiries: rows.map(inq => mapInquiryRow(inq, role)),
        isLoading: false,
      });
    } catch (error: any) {
      console.error('Failed to fetch inquiries:', error);
      set({ error: error.message, isLoading: false });
    }
  },

  // Publish a listing optimistically, then reconcile with the server row.
  //
  // Three outcomes: success replaces the temp row with the created one; a
  // transient failure queues the create and REPORTS `queued: true`, keeping
  // the temp row on screen; a permanent rejection removes the temp row and
  // rethrows, so a refused listing never looks published.
  createListing: async (listingInput, userId) => {
    // The attestation is a request flag, not a listing field: keep it off the
    // optimistic row and the offline queue payload's local copy.
    const { attestation, ...listingData } = listingInput;
    // Create temp ID for optimistic update. It is a LOCAL row id only — it
    // changes on every call, so it can never be what the server dedupes on.
    const tempId = `temp_listing_${Date.now()}`;
    // FIXED (F3): the create carries an idempotency key that identifies the
    // user's INTENT rather than the call — see `transport.createListing`, which
    // owns the `withPurchaseIntent` wrapping. The scope is derived here because
    // only the store knows what the user meant to publish.
    const createScope = `create_listing:${userId}:${listingData.category}:${listingData.title}:${
      listingData.price ?? ''
    }:${listingData.campus_id}`;
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
      const created = await transport.createListing(createScope, {
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
        ...(listingData.topicId !== undefined ? { topicId: listingData.topicId } : {}),
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
      if (transport.isRetryableMarketplaceError(error)) {
        // Offline / transient: queue for later sync and keep the optimistic listing.
        await transport.queueListingOperation(tempId, 'create', listingInput, userId);
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

  // Edit a listing. The pre-change rows are captured FIRST so a permanent
  // rejection can restore them in all three places the listing is held
  // (my listings, browse, the open detail). Explicit nulls are what clear a
  // discount on the server, so they survive into the request while the local
  // copy coerces them to undefined. `attestation` is a request flag only.
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
      await transport.updateListing(listingId, {
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
      if (transport.isRetryableMarketplaceError(error)) {
        await transport.queueListingOperation(listingId, 'update', updates, userId);
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
    const result = await transport.appealListingTakedown(listingId, note);
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

  // Optimistic delete with the same transient-vs-permanent rule: a network
  // failure queues the delete and leaves the row gone, a 4xx puts the listing
  // back where it was and rethrows.
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
      await transport.deleteListing(listingId);
    } catch (error: any) {
      console.error('Failed to delete listing on server:', error);
      // REL-01: queue only transient failures; restore listing on permanent 4xx.
      if (transport.isRetryableMarketplaceError(error)) {
        await transport.queueListingOperation(listingId, 'delete', {}, userId);
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

  // Favorite / unfavorite, optimistically, and snapshot the price seen at
  // favorite time so Saved Listings can flag a later drop. Any API failure
  // reverts the local set — there is no queue for this one.
  toggleFavorite: async (listingId: string, userId: string) => {
    const { favorites } = get();
    const newFavorites = new Set(favorites);
    const isFavorited = newFavorites.has(listingId);

    if (isFavorited) {
      newFavorites.delete(listingId);
      void import('../../screens/marketplace/marketplaceFavoritePrices').then(m =>
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
      void import('../../screens/marketplace/marketplaceFavoritePrices').then(m =>
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
          await transport.removeFromFavorites(listingId);
        } else {
          await transport.addToFavorites(listingId);
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
      // A chip and a node are two ways to say the same thing; the chip wins.
      taxonomyNodeId: null,
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
      taxonomyNodeId: null,
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

  /**
   * Drill into a node from Shop by department. The node carries its own
   * department, so selecting one also moves the department strip — otherwise the
   * strip would claim the buyer is in Electronics while the results are books.
   */
  setTaxonomyNode: (nodeId: string | null) => {
    const node = nodeId ? getTaxonomyNode(nodeId) : undefined;
    if (nodeId && !node) return;
    listingsRequestSeq += 1;
    set({
      taxonomyNodeId: node ? node.id : null,
      selectedCategory: null,
      ...(node ? { activeTab: node.department } : {}),
      listings: [],
      listingsPage: 1,
      listingsHasMore: true,
      isLoading: true,
    });
  },

  sendInquiry: async (listingId: string, message: string) => {
    try {
      set({ isLoading: true, error: null });

      if (DEMO_MODE) {
        await new Promise(resolve => setTimeout(resolve, 300));
        set({ isLoading: false });
        return {};
      }

      const result = await transport.createInquiry(listingId, message);
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
      const rows = await transport.fetchListingReviews(listingId);
      set({ reviews: rows.map(mapReviewRow) });
    } catch (error: any) {
      console.error('Failed to fetch listing reviews:', error);
    }
  },

  addReview: async (listingId: string, rating: number, comment?: string) => {
    await transport.addReview(listingId, { rating, comment });
    await get().fetchListingReviews(listingId);
  },

  toggleReviewHelpful: async (listingId: string, reviewId: string) => {
    const review = get().reviews.find(r => r.id === reviewId);
    if (!review) return;
    const result = await transport.setReviewHelpful(
      listingId,
      reviewId,
      !review.viewerMarkedHelpful,
    );
    set(state => ({
      reviews: state.reviews.map(r =>
        r.id === reviewId
          ? {
              ...r,
              helpfulCount: result.helpfulCount,
              viewerMarkedHelpful: result.viewerMarkedHelpful,
            }
          : r,
      ),
    }));
  },

  reportListing: async (listingId: string, reason: string, details?: string) => {
    await transport.reportListing(listingId, { reason, details });
  },

  fetchSimilar: async (listingId: string) => {
    try {
      if (DEMO_MODE) {
        set({ similarListings: [] });
        return;
      }
      const rows = await transport.fetchSimilarListings(listingId);
      set({ similarListings: rows.map(mapRemoteListing) });
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
      const rows = await transport.fetchOffers(role);
      const mapped: MarketplaceOffer[] = rows.map(mapOfferRow);
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
      const rows = await transport.fetchServerFavorites();
      const favoriteIds = new Set<string>();
      const favoriteListings: MarketplaceListing[] = [];
      for (const fav of rows) {
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
    await transport.updateInquiryStatus(inquiryId, status);
  },

  fetchSellerStats: async () => {
    try {
      const stats = await transport.fetchSellerStats();
      if (!stats) return;
      set({ sellerStats: mapSellerStats(stats) });
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
  setMinRating: (value: number | null) => set({ minRating: value }),
  setConditionFilter: (value: string) => {
    listingsRequestSeq += 1;
    set({
      conditionFilter: value,
      listings: [],
      listingsPage: 1,
      listingsHasMore: true,
      isLoading: true,
    });
  },
  // Pilot gate probe. It answers with one of THREE states — allowed, denied,
  // or unknown — and unknown is never rendered as a denial. Two attempts,
  // because a cold dyno or a campus network blip is not an answer; a "no" that
  // arrives while the client believes it is signed in but the server saw no
  // credential is also treated as unknown.
  checkMarketplaceAccess: async () => {
    if (get().marketplaceAccessChecking) return;
    set({ marketplaceAccessChecking: true });
    // Two attempts: a cold Render dyno or a campus network blip is not an
    // answer, and the previous single attempt turned either one into a
    // permanent "you are not on the pilot" for the rest of the session.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await transport.fetchMarketplaceAccess();
        const signedIn = Boolean(useAuthStore.getState().user?.id);
        if (
          result?.enabled !== true &&
          signedIn &&
          result?.authenticated === false
        ) {
          // We believe we are signed in but the server saw no credential, so
          // this "no" is about the request, not the account. Treat it as
          // unknown; the token usually lands a moment later.
          set({
            marketplaceAccess: null,
            marketplaceAccessUnavailable: true,
            marketplaceAccessChecking: false,
          });
          return;
        }
        set({
          marketplaceAccess: result?.enabled === true,
          marketplaceAccessUnavailable: false,
          marketplaceAccessChecking: false,
        });
        return;
      } catch {
        if (attempt === 0) {
          await new Promise(resolve => setTimeout(resolve, 1200));
          continue;
        }
        // Still no answer. The server is the enforcement point (it 403s with
        // MARKETPLACE_PRIVATE), so the honest client state is "unknown" —
        // never a denial we cannot substantiate.
        set({
          marketplaceAccess: null,
          marketplaceAccessUnavailable: true,
          marketplaceAccessChecking: false,
        });
      }
    }
  },
  // One request behind every Shop badge, TTL-cached and single-flighted.
  //
  // Two guards matter: the result is dropped if the signed-in user changed
  // while it was in flight (otherwise one account's counts land on another),
  // and a section the server could not count comes back null, in which case
  // the number already held stands rather than being zeroed (mergeShopSummary).
  fetchShopSummary: async (options) => {
    const { shopSummaryLoadedAt, shopSummaryLoading, marketplaceAccess } = get();
    if (shopSummaryLoading) return;
    // Nothing to count for an account the gate refuses; the requests would 403.
    if (marketplaceAccess === false) return;
    const fresh =
      shopSummaryLoadedAt != null && Date.now() - shopSummaryLoadedAt < SHOP_SUMMARY_TTL_MS;
    if (fresh && !options?.force) return;
    set({ shopSummaryLoading: true });
    // The account this summary is FOR. Eight reads take a while; if the user
    // signs out (or switches) meanwhile, the result must be dropped, not
    // written over the fresh account's empty counts with the old ones.
    const forUserId = useAuthStore.getState().user?.id;

    // One request. The server counts with the same status sets this store used
    // to apply to eight full-row reads.
    let data: Awaited<ReturnType<typeof transport.fetchShopSummary>> | null = null;
    try {
      data = await transport.fetchShopSummary();
    } catch {
      data = null;
    }

    if (useAuthStore.getState().user?.id !== forUserId) {
      set({ shopSummaryLoading: false });
      return;
    }
    if (!data) {
      set({ shopSummaryLoading: false });
      return;
    }
    set({
      shopSummary: mergeShopSummary(get().shopSummary, data),
      shopSummaryLoadedAt: Date.now(),
      shopSummaryLoading: false,
    });
  },
  invalidateShopSummary: () => set({ shopSummaryLoadedAt: null }),
  setCartCount: (n: number) =>
    set((s) => ({ shopSummary: { ...s.shopSummary, cartCount: Math.max(0, n) } })),

  applySavedSearch: (filters: Record<string, unknown>) => {
    listingsRequestSeq += 1;
    const normalized = normalizeSavedMarketplaceFilters(filters);
    set({
      ...normalized,
      selectedCategory: normalized.selectedCategory as MarketplaceCategory | null,
      // Saved searches predate the rating and condition filters; restoring one
      // means exactly what it meant when saved.
      minRating: null,
      conditionFilter: '',
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
      taxonomyNodeId: null,
      minPrice: '',
      maxPrice: '',
      locationFilter: '',
      campusIdFilter: '',
      sortBy: 'trending',
      sortOrder: 'desc',
      minRating: null,
      conditionFilter: '',
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

      const apiOffers = await transport.fetchListingOffers(listingId);
      const offers: MarketplaceOffer[] = apiOffers.map(mapListingOfferRow);
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

      const created = await transport.createOffer(listingId, amount, message);
      const offer: MarketplaceOffer = mapCreatedOffer(created);
      set(state => ({ offers: [offer, ...state.offers], isLoading: false }));
      return offer;
    } catch (error: any) {
      console.error('Failed to create offer:', error);
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  // Accept / decline / counter / withdraw. Server-first: state is patched from
  // the returned row across all three offer lists (`offers`, `sellerOffers`,
  // `buyerOffers`), since the same offer can be held in more than one. The
  // shop summary is invalidated whatever the action, because the ball has
  // moved into someone's court; an accept also refreshes the budget.
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

      const updated = await transport.respondToOffer(offerId, action, counterAmount, message);
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

      // Whatever happened, an offer just left or entered someone's court; the
      // next Shop focus must recount rather than trust the 45s TTL.
      get().invalidateShopSummary();
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

      const result = await transport.buyNowListing(listingId, couponCode, quantity);
      // A new order now needs the buyer (pay) or the seller (hand over).
      get().invalidateShopSummary();
      await get().fetchMyListings(userId);
      set({ isLoading: false });
      return result;
    } catch (error: any) {
      console.error('Failed to buy listing:', error);
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  // The cart lives only on the server, so this bumps the badge as a guess, then
  // reads the real total back. A failed read-back leaves the guess standing
  // and the summary marked stale for the next focus; a failed add rethrows.
  addToCart: async (listingId: string, quantity?: number) => {
    try {
      set({ error: null });
      if (DEMO_MODE) return;
      await transport.addToCart(listingId, quantity);
      // The cart is server-only (no local lines), so bump the badge here rather
      // than make the user wait a focus cycle to see it move; the stale mark
      // lets the next summary fetch replace the guess with the real sum.
      set((s) => ({
        shopSummary: {
          ...s.shopSummary,
          // Optimistic only until the server answers below; it may merge into an
          // existing line or cap the quantity, so the true count is read back.
          cartCount: s.shopSummary.cartCount + Math.max(1, quantity ?? 1),
        },
        shopSummaryLoadedAt: null,
      }));
      // The bump above was a guess: the server may have merged into an existing
      // line or capped the quantity. Read the real count back; a failure here
      // just leaves the guess until the next summary.
      try {
        const rows = await transport.fetchCart();
        get().setCartCount(rows.reduce((n, r) => n + Math.max(1, Number(r.quantity) || 1), 0));
      } catch {
        /* keep the optimistic count */
      }
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

      await transport.boostListing(listingId);
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

      const apiSearches = await transport.fetchSavedSearches();
      const savedSearches: SavedSearch[] = apiSearches.map(mapSavedSearchRow);
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

      const created = await transport.createSavedSearch({ filters, name });
      const saved: SavedSearch = mapSavedSearchRow(created);
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
        await transport.deleteSavedSearch(id);
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

      const data = await transport.fetchSellerProfile(sellerId);
      set({
        sellerProfile: mapSellerProfile(data, sellerId),
        isLoading: false,
      });
    } catch (error: any) {
      console.error('Failed to fetch seller profile:', error);
      set({ error: error.message, isLoading: false });
    }
  },

  updateMyShop: async (data) => {
    const updated = await transport.updateMyShop(data);
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
      const rows = await transport.fetchShops(params);
      const shops: MarketplaceShopCard[] = (Array.isArray(rows) ? rows : []).map(mapShopCard);
      set({ shops, shopsLoading: false });
    } catch (error: any) {
      console.error('Failed to fetch shops:', error);
      set({ shops: [], shopsLoading: false, error: error.message });
    }
  },

  clearError: () => set({ error: null }),
}));
