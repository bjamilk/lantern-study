/**
 * Marketplace store — public surface.
 *
 * Three layers live behind this file and nothing outside the folder should
 * import them directly:
 *
 * - `transport.ts` — I/O only: services/api, services/syncService and the
 *   per-user AsyncStorage cache. No state, no mapping.
 * - `mapping.ts`   — pure functions: API row → model, badge predicates, and the
 *   browse catalog derived from the shared taxonomy.
 * - `state.ts`     — the zustand store: UI state, optimism, request sequencing;
 *   it composes the two layers above.
 * - `types.ts`     — the shapes all three agree on.
 *
 * The export list below is the contract every screen imports (through the
 * `stores/marketplaceStore.ts` shim). It is pinned by
 * `stores/marketplaceStore.surface.test.ts`: adding to it is fine, changing or
 * removing an entry is a breaking change to the marketplace screens.
 */
export { useMarketplaceStore } from './state';
export {
  mapRemoteListing,
  getCategoryInfo,
  ACADEMIC_CATEGORIES,
  STUDENT_LIFE_CATEGORIES,
  CATEGORIES_BY_DEPARTMENT,
  ALL_BROWSE_CATEGORIES,
  categoriesForTab,
  MARKETPLACE_TABS,
  MARKETPLACE_DEPARTMENTS,
  DEFAULT_MARKETPLACE_TAB,
  marketplaceTabLabel,
  EMPTY_SHOP_SUMMARY,
  BUYER_ACTION_ORDER_STATUSES,
  orderNeedsSeller,
  orderAwaitsBuyerPayment,
  offerAwaitsUser,
  sumUnread,
} from './mapping';
export {
  getMarketplaceStorageKeysForUser,
  LEGACY_MARKETPLACE_STORAGE_KEYS,
} from './transport';
export type { MarketplaceDepartment } from './mapping';
export type {
  BrowseCategoryRow,
  MarketplaceCategory,
  MarketplaceInquiry,
  MarketplaceListing,
  MarketplaceListingCampus,
  MarketplaceListingCreateInput,
  MarketplaceListingUpdate,
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
