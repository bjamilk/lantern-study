/**
 * Public-surface lock for the marketplace store (lane R5b).
 *
 * The store was split into `stores/marketplace/{transport,mapping,state}.ts`
 * behind the `stores/marketplaceStore.ts` shim. That refactor is only safe if
 * nothing the screens read moved or changed shape, so this test pins the two
 * things a consumer can observe: the exact set of state keys, and the arity of
 * every action. A key that disappears (or an action that grows/loses a
 * parameter) fails here rather than at a screen.
 *
 * It also pins the module's named exports and the AsyncStorage key names,
 * because sign-out cleanup and the per-user cache are addressed by string.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
    multiRemove: jest.fn(async () => undefined),
  },
}));

// jest's moduleNameMapper maps `@lantern/shared/<subpath>` but not the bare
// package (see the shared-imports/jest note): mock it virtually rather than
// widen the mapper for one test.
jest.mock(
  '@lantern/shared',
  () => ({ RateLimitError: class RateLimitError extends Error {} }),
  { virtual: true },
);

jest.mock('../services/api', () => ({}));
jest.mock('../services/syncService', () => ({ syncService: { queueOperation: jest.fn() } }));
jest.mock('../services/marketplacePurchaseIntent', () => ({
  withPurchaseIntent: jest.fn(),
}));
jest.mock('./budgetStore', () => ({ useBudgetStore: { getState: () => ({ fetchTransactions: jest.fn() }) } }));
jest.mock('./authStore', () => ({ useAuthStore: { getState: () => ({ user: null }) } }));

import * as marketplaceStoreModule from './marketplaceStore';
import {
  useMarketplaceStore,
  getMarketplaceStorageKeysForUser,
  LEGACY_MARKETPLACE_STORAGE_KEYS,
} from './marketplaceStore';

/** Baseline captured from the pre-split store (HEAD e2fa40f4 + lane tree). */
const STATE_KEYS = [
  'activeTab',
  'addReview',
  'addToCart',
  'appealListing',
  'applySavedSearch',
  'boostListing',
  'buyNowListing',
  'buyerOffers',
  'campusIdFilter',
  'checkMarketplaceAccess',
  'clearError',
  'conditionFilter',
  'createListing',
  'createMarketplaceOffer',
  'createSavedSearch',
  'currentListing',
  'deleteListing',
  'deleteSavedSearch',
  'error',
  'favoriteListings',
  'favorites',
  'fetchInquiries',
  'fetchListing',
  'fetchListingOffers',
  'fetchListingReviews',
  'fetchListings',
  'fetchMyListings',
  'fetchOffers',
  'fetchSavedSearches',
  'fetchSellerProfile',
  'fetchSellerStats',
  'fetchServerFavorites',
  'fetchShopSummary',
  'fetchShops',
  'fetchSimilar',
  'inquiries',
  'invalidateShopSummary',
  'isLoading',
  'listings',
  'listingsHasMore',
  'listingsPage',
  'loadFromStorage',
  'locationFilter',
  'marketplaceAccess',
  'marketplaceAccessChecking',
  'marketplaceAccessUnavailable',
  'maxPrice',
  'minPrice',
  'minRating',
  'myListings',
  'offers',
  'reportListing',
  'reset',
  'resetFilters',
  'respondToOffer',
  'reviews',
  'saveToStorage',
  'savedSearches',
  'searchQuery',
  'selectedCategory',
  'sellerOffers',
  'sellerProfile',
  'sellerStats',
  'sendInquiry',
  'setActiveTab',
  'setCampusIdFilter',
  'setCartCount',
  'setConditionFilter',
  'setLocationFilter',
  'setMaxPrice',
  'setMinPrice',
  'setMinRating',
  'setSearchQuery',
  'setSelectedCategory',
  'setShowFavoritesOnly',
  'setSortBy',
  'setSortOrder',
  'setTaxonomyNode',
  'shopSummary',
  'shopSummaryLoadedAt',
  'shopSummaryLoading',
  'shops',
  'shopsLoading',
  'showFavoritesOnly',
  'similarListings',
  'sortBy',
  'sortOrder',
  'taxonomyNodeId',
  'toggleFavorite',
  'toggleReviewHelpful',
  'updateInquiryStatus',
  'updateListing',
  'updateMyShop',
];

/** `<action>/<Function.length>` — a changed arity is a changed call contract. */
const ACTION_ARITIES = [
  'addReview/3',
  'addToCart/2',
  'appealListing/2',
  'applySavedSearch/1',
  'boostListing/2',
  'buyNowListing/4',
  'checkMarketplaceAccess/0',
  'clearError/0',
  'createListing/2',
  'createMarketplaceOffer/3',
  'createSavedSearch/2',
  'deleteListing/2',
  'deleteSavedSearch/1',
  'fetchInquiries/1',
  'fetchListing/1',
  'fetchListingOffers/1',
  'fetchListingReviews/1',
  'fetchListings/1',
  'fetchMyListings/1',
  'fetchOffers/1',
  'fetchSavedSearches/0',
  'fetchSellerProfile/1',
  'fetchSellerStats/0',
  'fetchServerFavorites/0',
  'fetchShopSummary/1',
  'fetchShops/1',
  'fetchSimilar/1',
  'invalidateShopSummary/0',
  'loadFromStorage/0',
  'reportListing/3',
  'reset/0',
  'resetFilters/0',
  'respondToOffer/5',
  'saveToStorage/0',
  'sendInquiry/2',
  'setActiveTab/1',
  'setCampusIdFilter/1',
  'setCartCount/1',
  'setConditionFilter/1',
  'setLocationFilter/1',
  'setMaxPrice/1',
  'setMinPrice/1',
  'setMinRating/1',
  'setSearchQuery/1',
  'setSelectedCategory/1',
  'setShowFavoritesOnly/1',
  'setSortBy/1',
  'setSortOrder/1',
  'setTaxonomyNode/1',
  'toggleFavorite/2',
  'toggleReviewHelpful/2',
  'updateInquiryStatus/2',
  'updateListing/3',
  'updateMyShop/1',
];

/** Named runtime exports of the module every screen imports. */
const MODULE_EXPORTS = [
  'ACADEMIC_CATEGORIES',
  'ALL_BROWSE_CATEGORIES',
  'BUYER_ACTION_ORDER_STATUSES',
  'CATEGORIES_BY_DEPARTMENT',
  'DEFAULT_MARKETPLACE_TAB',
  'EMPTY_SHOP_SUMMARY',
  'LEGACY_MARKETPLACE_STORAGE_KEYS',
  'MARKETPLACE_DEPARTMENTS',
  'MARKETPLACE_TABS',
  'STUDENT_LIFE_CATEGORIES',
  'categoriesForTab',
  'getCategoryInfo',
  'getMarketplaceStorageKeysForUser',
  'mapRemoteListing',
  'marketplaceTabLabel',
  'offerAwaitsUser',
  'orderAwaitsBuyerPayment',
  'orderNeedsSeller',
  'sumUnread',
  'useMarketplaceStore',
];

describe('marketplace store public surface', () => {
  const state = useMarketplaceStore.getState();

  it('exposes exactly these state keys', () => {
    expect(Object.keys(state).sort()).toEqual(STATE_KEYS);
  });

  it('exposes exactly these action arities', () => {
    const arities = Object.entries(state)
      .filter(([, value]) => typeof value === 'function')
      .map(([name, value]) => `${name}/${(value as (...args: unknown[]) => unknown).length}`)
      .sort();
    expect(arities).toEqual(ACTION_ARITIES);
  });

  it('exposes exactly these module exports', () => {
    expect(Object.keys(marketplaceStoreModule).sort()).toEqual(MODULE_EXPORTS);
  });

  it('keeps the AsyncStorage keys byte-identical', () => {
    expect(getMarketplaceStorageKeysForUser('u1')).toEqual([
      'lantern_marketplace_listings_u1',
      'lantern_my_listings_u1',
      'lantern_marketplace_favorites_u1',
    ]);
    expect(getMarketplaceStorageKeysForUser(null)).toEqual([
      'lantern_marketplace_listings_anonymous',
      'lantern_my_listings_anonymous',
      'lantern_marketplace_favorites_anonymous',
    ]);
    expect([...LEGACY_MARKETPLACE_STORAGE_KEYS]).toEqual([
      'lantern_marketplace_listings',
      'lantern_my_listings',
      'lantern_marketplace_favorites',
    ]);
  });
});
