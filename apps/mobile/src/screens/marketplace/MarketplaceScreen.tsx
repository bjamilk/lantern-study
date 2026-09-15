/**
 * `MarketplaceHome` route: Shop home — the search chrome, department row and
 * tabs, the taxonomy breadcrumb, the filters and alerts panels, the home rails
 * (continue shopping, on sale, your campus, your courses, shops) and the
 * listing grid.
 *
 * Exports: MarketplaceScreen.
 * Touches: nearly all of useMarketplaceStore (listings, filters, saved
 * searches, favorites, shops, fetchListings/fetchShops/fetchShopSummary);
 * fetchMarketplaceListings, fetchMarketplaceListing, fetchMarketplaceCampuses
 * and checkSavedSearchMatches in ../../services/api; useShopBadges;
 * useSettingsStore for the saved campus; the recently-viewed and
 * recent-searches AsyncStorage helpers; productAnalytics (lazily imported);
 * marketplaceSearchChrome for the derived header state; useChrome for the
 * scroll-away chrome.
 *
 * Gotchas: the debounced refetch effect must list EVERY store filter in its
 * deps — the setters only mark the list loading, so a filter missing from that
 * list leaves the grid on skeletons permanently. `searchExpanded` is derived
 * every render (searchOpen || a non-empty store query), never stored, so the
 * box cannot unmount under the finger; the hardware-back handler that
 * collapses it is focus-scoped because BackHandler listeners are global and
 * LIFO and this screen stays mounted under ListingDetail and Cart.
 * fetchListings blanks `listings` when a page-1 request starts, so a failed
 * load would otherwise read as "No listings found" — lastGoodListings plus
 * resolveListState is what keeps a failure from making a claim about the
 * market, and `failed` deliberately outranks `empty`. The grid is also
 * filtered client-side on top of the server query, and a custom: category
 * matches every department rather than none.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Keyboard,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { appAlert } from '../../components/ui/appDialog';
import { Screen } from '../../components/layout';
import { KeyboardSafePanel } from './components/KeyboardSafePanel';
import { Skeleton, Button, Badge } from '../../components/ui';
import {
  MARKETPLACE_DEPARTMENTS,
  marketplaceTabLabel,
  MARKETPLACE_TABS,
  categoriesForTab,
  useMarketplaceStore,
  useAuthStore,
  useSettingsStore,
  ACADEMIC_CATEGORIES,
  STUDENT_LIFE_CATEGORIES,
  getCategoryInfo,
  mapRemoteListing,
  type MarketplaceListing,
  type MarketplaceCategory,
  type RemoteListing,
} from '../../stores';
import {
  fetchMarketplaceCampuses,
  fetchMarketplaceListing,
  fetchMarketplaceListings,
  checkSavedSearchMatches,
} from '../../services/api';
import { categoryIcon, formatPrice, isOwnListing, ListingImage } from './marketplaceHelpers';
import { getRecentlyViewedListingIds } from './marketplaceRecentlyViewed';
import {
  addRecentMarketplaceSearch,
  clearRecentMarketplaceSearches,
  getRecentMarketplaceSearches,
} from './marketplaceRecentSearches';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { CampusPicker, type MarketplaceCampusOption } from './CampusPicker';
import { buildSavedMarketplaceFilters } from '../../stores/marketplaceFilters';
import { ShopQuickActions } from './components/ShopQuickActions';
import { useShopBadges } from '../../hooks/useShopBadges';
import { useFocusEffect } from '@react-navigation/native';
import { resolveListState, shouldShowTrustChip, trustLabel } from '@lantern/shared/network';
import { RequestError } from '../../components/RequestError';
import {
  CONDITION_ATTRIBUTE,
  COURSE_ANCHOR_COPY,
  SHOP_HOME_COPY,
  getTaxonomyPath,
  listingTypeLabel,
  suggestMarketplaceSearch,
} from '@lantern/shared/marketplace';
import { ShopDepartmentRow } from './components/ShopDepartmentRow';
import { useChrome } from '../../components/layout/ChromeContext';
import { brand, useTheme } from '../../theme';
import { getFontScaleValue } from '../../theme/installFontScale';
import {
  alertsLabel,
  countActiveFilters,
  filtersLabel,
  isSearchExpanded,
  showsBandCartAndYou,
} from './marketplaceSearchChrome';
import { AppIcon } from '../../components/ui/AppIcon';

/** Byte-identical to the inline Cart/You so parity with ShopHeaderActions holds. */
const ICON_BTN = 'h-9 w-9 items-center justify-center rounded-lg bg-lantern-background-secondary';
/**
 * The collapsed row has no search field, so Alerts, Cart, You and Sell share
 * its width instead of huddling at the right edge with a gap beside a lone
 * icon. Same height and tone as ICON_BTN; only the width rule differs.
 */
const STRETCH_BTN =
  'h-9 flex-1 flex-row items-center justify-center gap-1.5 rounded-lg bg-lantern-background-secondary';
/**
 * Below this width (at font scale 1) four icon+label pairs do not fit their
 * equal shares of the row. The label Text keeps Yoga's default flexShrink 0,
 * so an overlong pair does not ellipsise: justify-center spills it past both
 * edges of its pill into the neighbouring buttons. Icons render through the
 * patched Text too, so the pair grows with the whole font scale (app setting
 * x OS Dynamic Type); the gate divides the width by that scale so large text
 * degrades to the icon-only row a narrow device gets.
 */
const HEADER_LABELS_MIN_WIDTH = 380;

type ShopPanel = 'filters' | 'alerts';

type NavigationProp = {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

export function MarketplaceScreen({ navigation }: { navigation: NavigationProp }) {
  const tabBarClearance = useTabBarClearance(16);
  const { onScroll: chromeOnScroll } = useChrome();
  const { user } = useAuthStore();
  const savedCampusId = useSettingsStore(
    state => state.settings.marketplace?.campus_id || undefined
  );
  const {
    listings,
    favorites,
    favoriteListings,
    savedSearches,
    isLoading,
    error: listingsError,
    searchQuery,
    selectedCategory,
    activeTab,
    taxonomyNodeId,
    minPrice,
    maxPrice,
    locationFilter,
    campusIdFilter,
    sortBy,
    sortOrder,
    minRating,
    conditionFilter,
    listingsHasMore,
    listingsPage,
    showFavoritesOnly,
    shops,
    shopsLoading,
    fetchListings,
    fetchShops,
    fetchServerFavorites,
    fetchSavedSearches,
    createSavedSearch,
    deleteSavedSearch,
    setSearchQuery,
    setSelectedCategory,
    setActiveTab,
    setTaxonomyNode,
    setMinPrice,
    setMaxPrice,
    setLocationFilter,
    setCampusIdFilter,
    setSortBy,
    setSortOrder,
    setMinRating,
    setConditionFilter,
    applySavedSearch,
    resetFilters,
    toggleFavorite,
    loadFromStorage,
    fetchShopSummary,
  } = useMarketplaceStore();
  // One read feeds the header icons and the band; nothing on this screen sums
  // summary fields itself.
  const badges = useShopBadges();
  const { colors } = useTheme();

  // Exactly one of the Filters / Alerts panels is open at a time.
  const [openPanel, setOpenPanel] = useState<ShopPanel | null>(null);
  // "The buyer asked for the box." Whether it is actually shown is derived
  // below (searchExpanded) so a store query can never desync from the chrome.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const searchInputRef = useRef<TextInput>(null);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [recentListings, setRecentListings] = useState<MarketplaceListing[]>([]);
  const [savedSearchNewMatches, setSavedSearchNewMatches] = useState(0);
  const [campuses, setCampuses] = useState<MarketplaceCampusOption[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [dealListings, setDealListings] = useState<MarketplaceListing[]>([]);

  useEffect(() => {
    void getRecentMarketplaceSearches().then(setRecentSearches);
  }, []);

  const categories = categoriesForTab(activeTab);
  const searchSuggestions = useMemo(
    () =>
      searchFocused || searchQuery.trim().length >= 2
        ? suggestMarketplaceSearch(searchQuery, {
            // Typeahead narrows by department; All and Shops have none, so it
            // searches the whole catalog.
            department:
              activeTab === 'shops' || activeTab === 'all' ? undefined : activeTab,
            recents: recentSearches,
            limit: 6,
          })
        : [],
    [searchFocused, searchQuery, activeTab, recentSearches],
  );
  const activeCategoryLabel = selectedCategory
    ? getCategoryInfo(selectedCategory).name
    : 'All categories';
  const selectedCampus = campuses.find(campus => campus.id === campusIdFilter);
  // Derived every render, never stored: searchOpen || searchQuery.length > 0.
  const searchExpanded = isSearchExpanded(searchOpen, searchQuery);
  const { width: windowWidth } = useWindowDimensions();
  // Collapsed: the four buttons stretch across the row, with a label beside
  // each icon when the row is wide enough for four labels at the current font
  // scale. getFontScaleValue() is safe to read during render: ThemeProvider
  // remounts the whole tree whenever it changes.
  const headerButton = searchExpanded ? ICON_BTN : STRETCH_BTN;
  const showHeaderLabels =
    !searchExpanded && windowWidth / getFontScaleValue() >= HEADER_LABELS_MIN_WIDTH;
  const hasRecentSuggestions = searchSuggestions.some(item => item.kind === 'recent');
  const activeFilterCount = countActiveFilters({
    minPrice,
    maxPrice,
    locationFilter,
    campusIdFilter,
    conditionFilter,
    minRating,
    sortBy,
    sortOrder,
    selectedCategory,
  });

  const clearBlurTimer = () => {
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
  };
  const openSearch = () => setSearchOpen(true);
  // Invariant: focused ⇒ searchOpen, so a box expanded only by a store query
  // cannot unmount under the finger when the last character is deleted.
  const onSearchFocus = () => {
    clearBlurTimer();
    setSearchFocused(true);
    setSearchOpen(true);
  };
  const onSearchBlur = () => {
    clearBlurTimer();
    blurTimerRef.current = setTimeout(() => {
      blurTimerRef.current = null;
      setSearchFocused(false);
    }, 200);
  };
  const dismissSearchKeyboard = () => {
    clearBlurTimer();
    Keyboard.dismiss();
    setSearchFocused(false);
  };
  // setSearchOpen(true) BEFORE setSearchQuery('') so searchExpanded never flips
  // false mid-gesture; the box stays open, focused and empty.
  const clearSearch = () => {
    setSearchOpen(true);
    setSearchQuery('');
    searchInputRef.current?.focus();
  };
  const collapseSearch = useCallback(() => {
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    // Before the input unmounts, or Android can leave the IME up with no
    // focused input.
    Keyboard.dismiss();
    setSearchFocused(false);
    setSearchOpen(false);
    // Collapsing clears; the existing 350ms debounced effect refetches ''.
    // Read through getState so this callback is stable across keystrokes and
    // the focus-scoped BackHandler below subscribes once per expand.
    if (useMarketplaceStore.getState().searchQuery) setSearchQuery('');
  }, [setSearchQuery]);
  // Every card/row that leaves this screen goes through here: with
  // keyboardShouldPersistTaps="handled" on the lists the tap no longer
  // dismisses the keyboard, and the input stays mounted (and focused) under
  // the pushed screen, so Android would otherwise leave the IME up over it.
  const dismissKeyboardThen = (go: () => void) => {
    dismissSearchKeyboard();
    go();
  };
  const openListing = (listingId: string) =>
    dismissKeyboardThen(() => navigation.navigate('ListingDetail', { listingId }));
  const togglePanel = (panel: ShopPanel) => setOpenPanel(cur => (cur === panel ? null : panel));
  // The store's resetFilters deliberately leaves selectedCategory alone; with
  // its chip gone the category now counts as a filter, so reset it here too.
  const handleResetFilters = () => {
    resetFilters();
    if (selectedCategory) setSelectedCategory(null);
  };

  // Hardware back collapses the box. MUST be focus-scoped: BackHandler
  // listeners are global/LIFO and this screen stays mounted under
  // ListingDetail/Cart, so a plain useEffect would steal their back press
  // whenever a query is active.
  useFocusEffect(
    useCallback(() => {
      if (!searchExpanded) return undefined;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        collapseSearch();
        return true;
      });
      return () => sub.remove();
    }, [searchExpanded, collapseSearch]),
  );

  // Abandon an empty open box on leave. Reads the store via getState so the
  // cleanup has no stale closure; a box with a query is kept and re-shows.
  useFocusEffect(
    useCallback(
      () => () => {
        if (!useMarketplaceStore.getState().searchQuery) {
          setSearchOpen(false);
          setSearchFocused(false);
        }
      },
      [],
    ),
  );

  // Android can ignore autoFocus when a TextInput mounts during a native-stack
  // layout pass; focusing an already-focused input is a no-op.
  useEffect(() => {
    if (!searchOpen) return undefined;
    const id = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [searchOpen]);

  useEffect(
    () => () => {
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    },
    [],
  );

  // Breadcrumb for the drilled-in node, department first.
  const taxonomyPath = useMemo(
    () => (taxonomyNodeId ? getTaxonomyPath(taxonomyNodeId) : []),
    [taxonomyNodeId],
  );

  const departmentCategoryIds = useMemo(
    () => categoriesForTab(activeTab).map((c) => c.id),
    [activeTab],
  );

  const loadRecent = useCallback(async () => {
    const ids = await getRecentlyViewedListingIds();
    const loaded: MarketplaceListing[] = [];
    for (const id of ids.slice(0, 6)) {
      try {
        const l = await fetchMarketplaceListing(id);
        loaded.push(mapRemoteListing(l as RemoteListing));
      } catch {
        // skip missing
      }
    }
    setRecentListings(loaded);
  }, []);

  useEffect(() => {
    void fetchMarketplaceCampuses('NG')
      .then(rows => setCampuses(rows))
      .catch(() => {});
  }, []);

  const loadSavedSearchMatches = useCallback(async () => {
    if (!savedSearches.length) {
      setSavedSearchNewMatches(0);
      return;
    }
    let total = 0;
    for (const search of savedSearches) {
      try {
        const result = await checkSavedSearchMatches(search.id);
        total += result.count || 0;
      } catch {
        // ignore per-search errors
      }
    }
    setSavedSearchNewMatches(total);
  }, [savedSearches]);

  useEffect(() => {
    void (async () => {
      if (user?.id) await fetchServerFavorites();
      await fetchSavedSearches();
      await fetchListings({ page: 1 });
      await loadRecent();
      await fetchShops({ campus: savedCampusId || campusIdFilter || undefined });
    })();
  }, [activeTab, selectedCategory]);

  // The badges describe what needs you now, so they refresh whenever you come
  // back to the shop — after paying, after a seller replies, after listing.
  useFocusEffect(
    useCallback(() => {
      void fetchShopSummary();
    }, [fetchShopSummary]),
  );

  useEffect(() => {
    void loadSavedSearchMatches();
  }, [loadSavedSearchMatches]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchListings({ page: 1 });
    }, 350);
    return () => clearTimeout(timer);
    // Every filter the store can change must be listed here. The setters mark
    // the list loading and clear it; this effect is what actually refetches, so
    // a filter missing from these deps leaves the grid on skeletons for good.
    // taxonomyNodeId only appeared to work because drilling in from Shop by
    // department usually also changes the department, and that IS watched.
  }, [
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
    fetchListings,
  ]);

  useEffect(() => {
    if (activeTab === 'shops' || searchQuery.trim() || selectedCategory) {
      setDealListings([]);
      return;
    }
    let cancelled = false;
    void fetchMarketplaceListings({
      page: 1,
      limit: 8,
      sortBy: 'sale_first',
      sortOrder: 'desc',
      categories: categories.map(c => c.id),
      includeCustom: true,
      responseProfile: 'compact',
    })
      .then(raw => {
        const rows = Array.isArray(raw) ? raw : ((raw as { data?: RemoteListing[] })?.data ?? []);
        if (!cancelled) {
          setDealListings(rows.map(mapRemoteListing).filter(item => item.is_on_sale).slice(0, 8));
        }
      })
      .catch(() => {
        if (!cancelled) setDealListings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, searchQuery, selectedCategory]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadFromStorage();
    if (user?.id) await fetchServerFavorites();
    await fetchSavedSearches();
    await loadSavedSearchMatches();
    // A pull is the user asking "what is true now"; skip the 45s TTL.
    await fetchShopSummary({ force: true });
    await fetchListings({ page: 1 });
    await loadRecent();
    setRefreshing(false);
  };

  const loadMore = () => {
    if (!listingsHasMore || isLoading) return;
    void fetchListings({ page: listingsPage + 1, append: true });
  };

  const listingMatchesFilters = useCallback(
    (listing: MarketplaceListing) => {
      // A listing belongs to the open department if its coarse category is one
      // the department browses. Custom categories are department-less by
      // definition, so they surface everywhere rather than nowhere.
      const tabMatch =
        activeTab === 'shops' ||
        departmentCategoryIds.includes(listing.category as MarketplaceCategory) ||
        listing.category.startsWith('custom:');
      if (!tabMatch) return false;
      if (selectedCategory && listing.category !== selectedCategory) return false;
      if (
        campusIdFilter &&
        (listing.campus_id ?? listing.campus?.id) !== campusIdFilter
      ) {
        return false;
      }
      return true;
    },
    [
      activeTab,
      selectedCategory,
      campusIdFilter,
      departmentCategoryIds,
    ]
  );

  /**
   * The last grid we actually managed to render.
   *
   * `fetchListings` blanks `listings` the instant a page-1 request starts, so
   * by the time that request fails there is nothing left on screen to keep —
   * which is how a phone with no radio ended up showing "No listings found",
   * a claim about the marketplace that a failed request cannot support.
   * Pull-to-refresh reloads the AsyncStorage cache into the store on its way
   * past, so these are genuinely the buyer's last cached listings.
   */
  const [lastGoodListings, setLastGoodListings] = useState<MarketplaceListing[]>([]);
  useEffect(() => {
    if (listings.length > 0) setLastGoodListings(listings);
  }, [listings]);

  const displayListings = useMemo(() => {
    // Only a failed load may reach back for the cache. A successful load that
    // returned nothing is real news and must be allowed to empty the grid.
    const source = listings.length > 0 || !listingsError ? listings : lastGoodListings;
    const base = showFavoritesOnly
      ? favoriteListings.length
        ? favoriteListings
        : source.filter(l => favorites.has(l.id))
      : source;
    const filtered = base.filter(listingMatchesFilters);
    if (!searchQuery.trim()) return filtered;
    const q = searchQuery.toLowerCase();
    return filtered.filter(
      l =>
        l.title.toLowerCase().includes(q) ||
        l.description?.toLowerCase().includes(q) ||
        l.location?.toLowerCase().includes(q)
    );
  }, [
    listings,
    lastGoodListings,
    listingsError,
    favoriteListings,
    favorites,
    showFavoritesOnly,
    searchQuery,
    listingMatchesFilters,
  ]);

  /**
   * The one decision about what the grid says. `failed` outranks `empty` and
   * `noMatch` on purpose: a request that never left the device told us nothing
   * about what is for sale, so it may not answer "is there anything here?".
   */
  const listingsState = resolveListState({
    loading: isLoading,
    // The shops segment has its own loader and its own errors.
    error: activeTab === 'shops' ? null : listingsError,
    itemCount: displayListings.length,
    query: searchQuery,
  });

  const retryListings = useCallback(() => {
    void fetchListings({ page: 1 });
  }, [fetchListings]);

  useEffect(() => {
    if (!searchQuery.trim()) return;
    const timer = setTimeout(() => {
      if (displayListings.length > 0) {
        void addRecentMarketplaceSearch(searchQuery).then(() =>
          getRecentMarketplaceSearches().then(setRecentSearches)
        );
      }
      void import('../../services/productAnalytics').then(({ trackMarketplaceSearch }) => {
        trackMarketplaceSearch({
          query: searchQuery,
          resultCount: displayListings.length,
          category: selectedCategory || undefined,
          campus: savedCampusId,
        });
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery, displayListings.length, selectedCategory, savedCampusId]);

  useEffect(() => {
    if (displayListings.length === 0) return;
    void import('../../services/productAnalytics').then(({ trackListingImpression }) => {
      displayListings.slice(0, 20).forEach((listing, index) => {
        trackListingImpression(
          listing.id,
          index,
          searchQuery.trim() ? 'search' : 'browse'
        );
      });
    });
  }, [displayListings, searchQuery]);

  const handleSaveSearch = async () => {
    try {
      await createSavedSearch(
        buildSavedMarketplaceFilters({
          searchQuery,
          selectedCategory,
          // Saved searches cover the department tabs; one saved from Shops
          // round-trips to the first department.
          activeTab: activeTab === 'shops' ? MARKETPLACE_DEPARTMENTS[0] : activeTab,
          taxonomyNodeId,
          minPrice,
          maxPrice,
          locationFilter,
          campusIdFilter,
          sortBy,
          sortOrder,
        }),
        searchQuery.trim() ||
          (selectedCategory
            ? activeCategoryLabel
            : selectedCampus?.name || 'Marketplace search')
      );
      appAlert('Saved', 'Search saved.');
    } catch {
      appAlert('Error', 'Could not save search.');
    }
  };

  const renderListing = ({ item }: { item: MarketplaceListing }) => {
    const category = getCategoryInfo(item.category);
    const favorited = favorites.has(item.id);
    const own = isOwnListing(item, user?.id);

    return (
      <Pressable
        onPress={() => openListing(item.id)}
        accessibilityRole="button"
        accessibilityLabel={`View listing ${item.title}`}
        className={`flex-1 m-1.5 rounded-lantern-xl overflow-hidden border ${
          own
            ? 'bg-lantern-primary-background border-lantern-primary/30'
            : 'bg-lantern-surface border-lantern-border'
        }`}
      >
        <View className="aspect-[4/3] relative">
          <ListingImage uri={item.images?.[0]} className="w-full h-full" icon={categoryIcon(category.icon)} />
          <Pressable
            onPress={() => {
              if (user?.id) void toggleFavorite(item.id, user.id);
            }}
            accessibilityRole="button"
            accessibilityLabel={favorited ? 'Remove from favorites' : 'Add to favorites'}
            accessibilityState={{ selected: favorited }}
            className="absolute top-2 right-2 p-1.5 rounded-lg bg-lantern-surface/90 min-w-[44px] min-h-[44px] items-center justify-center"
          >
            <AppIcon name="heart" filled={favorited} size={16} color={favorited ? '#dc2626' : '#94a3b8'} />
          </Pressable>
          {own ? (
            <View className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-lantern-primary/90">
              <Text className="text-label font-semibold text-white">Yours</Text>
            </View>
          ) : null}
        </View>
        <View className="p-2.5">
          <Text className="text-sm font-semibold text-lantern-text" numberOfLines={2}>
            {item.title}
          </Text>
          <Text className="text-label text-lantern-text-tertiary mt-0.5" numberOfLines={1}>
            {listingTypeLabel(item, getCategoryInfo(item.category).name)}
          </Text>
          {(item.rating_count ?? 0) > 0 && item.rating_avg != null ? (
            <View
              className="mt-0.5 flex-row items-center gap-0.5"
              accessibilityLabel={`Rated ${Number(item.rating_avg).toFixed(1)} out of 5 from ${item.rating_count} reviews`}
            >
              <AppIcon name="star" size={11} color="#f59e0b" />
              <Text className="text-[11px] text-lantern-text-secondary">
                {Number(item.rating_avg).toFixed(1)} ({item.rating_count})
              </Text>
            </View>
          ) : null}
          {/* Phase 3 N — see the web card: the server attaches trust to every
              browse row and nothing rendered it. 'new' shows no chip. */}
          {shouldShowTrustChip((item.seller as { trustLevel?: string } | undefined)?.trustLevel) ? (
            <View className="mt-1 self-start rounded-full bg-lantern-primary/15 px-1.5 py-0.5">
              <Text className="text-label font-semibold text-lantern-primary-text">
                {trustLabel((item.seller as { trustLevel?: string } | undefined)?.trustLevel)}
              </Text>
            </View>
          ) : null}
          {item.is_on_sale && item.effective_price != null ? (
            <View className="mt-1">
              <Text className="text-xs text-lantern-text-tertiary line-through">{formatPrice(item.price)}</Text>
              <Text className="text-base font-bold text-lantern-error">
                {formatPrice(item.effective_price)}
              </Text>
            </View>
          ) : (
            <Text className="text-base font-bold text-lantern-primary-text mt-1">
              {formatPrice(item.price)}
            </Text>
          )}
        </View>
      </Pressable>
    );
  };

  const campusRail = useMemo(
    () =>
      displayListings
        .filter((item) => (item.campus_id ?? item.campus?.id) && (item.campus_id ?? item.campus?.id) === (campusIdFilter || savedCampusId))
        .slice(0, 8),
    [displayListings, campusIdFilter, savedCampusId],
  );
  const courseRail = useMemo(
    () => displayListings.filter((item) => item.courseId).slice(0, 8),
    [displayListings],
  );

  const listHeader = (
    <View>
      {!showFavoritesOnly && !searchQuery.trim() ? (
        <ShopQuickActions
          badges={badges}
          onNavigate={(screen, params) => navigation.navigate(screen, params)}
        />
      ) : null}
      {recentListings.length > 0 && !showFavoritesOnly ? (
        <View className="px-2 pt-3">
          <Text className="text-heading text-lantern-text mb-2 px-1">
            {SHOP_HOME_COPY.continueShopping}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {recentListings.map(item => (
              <Pressable
                key={item.id}
                onPress={() => openListing(item.id)}
                className="w-28 mr-2 rounded-xl overflow-hidden bg-lantern-surface border border-lantern-border"
              >
                <ListingImage uri={item.images?.[0]} className="w-full h-20" />
                <Text numberOfLines={2} className="text-label p-1.5 text-lantern-text">
                  {item.title}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
      {dealListings.length > 0 && !showFavoritesOnly && !searchQuery.trim() ? (
        <View className="px-2 pt-3">
          <Text className="text-heading text-lantern-text mb-2 px-1">{SHOP_HOME_COPY.onSale}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {dealListings.map(item => (
              <Pressable
                key={item.id}
                onPress={() => openListing(item.id)}
                className="w-28 mr-2 rounded-xl overflow-hidden bg-lantern-surface border border-lantern-border"
              >
                <ListingImage uri={item.images?.[0]} className="w-full h-20" />
                <Text numberOfLines={2} className="text-label p-1.5 text-lantern-text">
                  {item.title}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
      {campusRail.length > 0 && !showFavoritesOnly && !searchQuery.trim() ? (
        <View className="px-2 pt-3">
          <Text className="text-heading text-lantern-text mb-2 px-1">{SHOP_HOME_COPY.yourCampus}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {campusRail.map(item => (
              <Pressable
                key={item.id}
                onPress={() => openListing(item.id)}
                className="w-28 mr-2 rounded-xl overflow-hidden bg-lantern-surface border border-lantern-border"
              >
                <ListingImage uri={item.images?.[0]} className="w-full h-20" />
                <Text numberOfLines={2} className="text-label p-1.5 text-lantern-text">
                  {item.title}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
      {courseRail.length > 0 && !showFavoritesOnly && !searchQuery.trim() ? (
        <View className="px-2 pt-3">
          <Pressable onPress={() => navigation.navigate('CourseBrowse')} className="mb-2 px-1">
            <Text className="text-heading text-lantern-text">{SHOP_HOME_COPY.forYourCourses}</Text>
          </Pressable>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {courseRail.map(item => (
              <Pressable
                key={item.id}
                onPress={() => openListing(item.id)}
                className="w-28 mr-2 rounded-xl overflow-hidden bg-lantern-surface border border-lantern-border"
              >
                <ListingImage uri={item.images?.[0]} className="w-full h-20" />
                <Text numberOfLines={2} className="text-label p-1.5 text-lantern-text">
                  {item.title}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
      {shops.length > 0 && !showFavoritesOnly && !searchQuery.trim() && activeTab !== 'shops' ? (
        <View className="px-2 pt-3">
          <Pressable onPress={() => setActiveTab('shops')} className="mb-2 px-1">
            <Text className="text-heading text-lantern-text">{SHOP_HOME_COPY.shops}</Text>
          </Pressable>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {shops.slice(0, 8).map(shop => (
              <Pressable
                key={shop.sellerId}
                onPress={() => navigation.navigate('SellerProfile', { sellerId: shop.sellerId })}
                className="w-28 mr-2 rounded-xl overflow-hidden bg-lantern-surface border border-lantern-border p-2"
              >
                <Text numberOfLines={2} className="text-label text-lantern-text">
                  {shop.shopName}
                </Text>
                <Text className="text-caption text-lantern-text-secondary mt-1">
                  {shop.activeListingCount} live
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
      {!showFavoritesOnly ? (
        <Text className="text-heading text-lantern-text px-3 pt-4 pb-1">{SHOP_HOME_COPY.allListings}</Text>
      ) : null}
    </View>
  );

  return (
    <Screen bottom="none">
      <View className="pt-1 pb-2 gap-2">
        {/* No Discover section bar here. With Community switched back on it
            would put a Community | Market tab row above the Shop header for
            admins; Community has its own entry in the profile drawer and the
            Shop icon in the top bar comes straight here. */}

        {!searchExpanded && !showFavoritesOnly ? (
          <View className="px-4">
            <Text className="text-title text-lantern-text">{SHOP_HOME_COPY.title}</Text>
            <Text className="text-caption text-lantern-text-secondary mt-0.5">{SHOP_HOME_COPY.subtitle}</Text>
          </View>
        ) : null}

        {/* 36dp row in both states so Cart never jumps. gap-2 (8px) means
            hitSlop={4} on adjacent 36px buttons yields exact 44px targets that
            touch without overlapping. */}
        <View className="px-4 flex-row items-center gap-2">
          {searchExpanded ? (
            <View className="flex-1 min-h-[44px] flex-row items-center bg-lantern-surface border border-lantern-border rounded-lantern pl-0.5 pr-1">
              {/* Material SearchView leading action: the box has exactly one
                  X-shaped glyph (Clear), so Close and Clear cannot be confused. */}
              <Pressable
                onPress={collapseSearch}
                accessibilityRole="button"
                accessibilityLabel="Close search"
                accessibilityHint="Clears the search and collapses the box"
                hitSlop={4}
                className="h-9 w-9 items-center justify-center"
              >
                <AppIcon name="arrow-back" size={20} color={colors.textSecondary} />
              </Pressable>
              <TextInput
                ref={searchInputRef}
                value={searchQuery}
                onChangeText={setSearchQuery}
                onFocus={onSearchFocus}
                onBlur={onSearchBlur}
                onSubmitEditing={dismissSearchKeyboard}
                // Read only at mount: true when opened by the icon (keyboard
                // up), false when the screen remounts with a store query.
                autoFocus={searchOpen}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                placeholder={SHOP_HOME_COPY.emptySearch}
                placeholderTextColor={colors.inputPlaceholder}
                accessibilityLabel="Search listings"
                className="flex-1 ml-1 py-0 text-body text-lantern-text"
              />
              {searchQuery.length > 0 ? (
                <Pressable
                  onPress={clearSearch}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  hitSlop={4}
                  className="h-9 w-9 items-center justify-center"
                >
                  <AppIcon name="close-circle" size={18} color={colors.textSecondary} />
                </Pressable>
              ) : null}
            </View>
          ) : (
            <Pressable
              onPress={openSearch}
              accessibilityRole="button"
              accessibilityLabel="Search"
              accessibilityHint="Opens the search box"
              accessibilityState={{ expanded: false }}
              hitSlop={4}
              className={ICON_BTN}
            >
              <AppIcon name="search" size={19} color={colors.textSecondary} />
            </Pressable>
          )}
          {/* Alerts stays mounted in BOTH states; Cart and You are now the
              contextual row's (spec v3 §7.2) and appear here only while the
              search box is expanded, which is the one state the row stands
              down for — see showsBandCartAndYou. searchExpanded is pinned true
              for as long as a query sits in the store (results browsing,
              returning from ListingDetail/Cart), not just while typing, so a
              buyer with an active search still has a route to the cart and the
              You hub without pressing Close and wiping the query. Expanded,
              the buttons shrink to icons and Sell yields; collapsed, Alerts and
              Sell stretch to fill the row. */}
          <Pressable
            onPress={() => togglePanel('alerts')}
            accessibilityRole="button"
            accessibilityLabel={alertsLabel(savedSearchNewMatches)}
            accessibilityState={{ expanded: openPanel === 'alerts' }}
            hitSlop={4}
            className={headerButton}
          >
            {/* "Alerts", not "Saved": this is saved SEARCHES and their new
                matches. The band's Saved card is saved listings, and two
                controls called Saved a thumb apart meant nobody knew which
                was which. Sits left of Cart so Cart+You remain the trailing
                pair every other Shop screen shows. */}
            <AppIcon
              name="notifications"
              size={20}
              color={openPanel === 'alerts' ? brand.text : colors.textSecondary}
            />
            {showHeaderLabels ? (
              <Text numberOfLines={1} className="text-xs font-medium text-lantern-text-secondary">
                Alerts
              </Text>
            ) : null}
            <Badge count={savedSearchNewMatches} />
          </Pressable>
          {/* Amazon keeps the cart and your account one tap away on every
              page. On this surface the contextual row is that guarantee, so
              these two draw only when the row cannot. */}
          {!showsBandCartAndYou(searchExpanded) ? null : (
          <>
          <Pressable
            onPress={() => navigation.navigate('Cart')}
            accessibilityRole="button"
            accessibilityLabel={
              badges.cartCount > 0 ? `Cart, ${badges.cartCount} items` : 'Cart'
            }
            hitSlop={4}
            className={headerButton}
          >
            <AppIcon name="cart" size={19} color={colors.textSecondary} />
            {showHeaderLabels ? (
              <Text numberOfLines={1} className="text-xs font-medium text-lantern-text-secondary">
                Cart
              </Text>
            ) : null}
            <Badge count={badges.cartCount} />
          </Pressable>
          <Pressable
            onPress={() => navigation.navigate('ShopAccount')}
            accessibilityRole="button"
            accessibilityLabel={
              badges.needsYou > 0
                ? `Your orders, saved items and selling, ${badges.needsYou} need you`
                : 'Your orders, saved items and selling'
            }
            hitSlop={4}
            className={headerButton}
          >
            <AppIcon name="person-circle" size={20} color={colors.textSecondary} />
            {showHeaderLabels ? (
              <Text numberOfLines={1} className="text-xs font-medium text-lantern-text-secondary">
                You
              </Text>
            ) : null}
            <Badge count={badges.needsYou} />
          </Pressable>
          </>
          )}
          {/* Sell is the one control that yields to the box: it is the widest
              and stays reachable through the You hub's Selling section. While
              collapsed it takes an equal share of the row like the others. */}
          {searchExpanded ? null : (
            <Pressable
              onPress={() => navigation.navigate('CreateListing')}
              accessibilityRole="button"
              accessibilityLabel="Sell an item"
              hitSlop={4}
              className="h-9 flex-1 flex-row items-center justify-center gap-1 px-2 rounded-lg bg-lantern-primary-fill"
            >
              <AppIcon name="add" size={16} color="#fff" />
              <Text className="text-sm font-semibold text-white">Sell</Text>
            </Pressable>
          )}
        </View>
        {searchExpanded && searchFocused && searchSuggestions.length > 0 ? (
          <View className="mx-4 rounded-xl border border-lantern-border bg-lantern-surface overflow-hidden">
            {searchSuggestions.map(suggestion => (
              <Pressable
                key={suggestion.id}
                onPress={() => {
                  if (suggestion.kind === 'type') {
                    setActiveTab(suggestion.department);
                    setSelectedCategory(suggestion.listingCategory as MarketplaceCategory);
                  } else {
                    setSearchQuery(suggestion.query);
                  }
                  dismissSearchKeyboard();
                }}
                accessibilityRole="button"
                accessibilityLabel={
                  suggestion.kind === 'recent' ? `Search again for ${suggestion.label}` : suggestion.label
                }
                className="min-h-[44px] flex-row items-center gap-2 px-3 py-2 border-b border-lantern-border last:border-b-0"
              >
                {/* Recent searches live here, in the temporary dropdown, not in
                    a band of their own: history is only useful while the
                    buyer is deciding what to type, and the dropdown goes away
                    with the keyboard. The clock is how a buyer tells a recent
                    search from a category or a fresh "Search for" row. */}
                {suggestion.kind === 'recent' ? (
                  <AppIcon name="time" size={16} color={colors.textSecondary} />
                ) : null}
                <View className="flex-1">
                  <Text className="text-sm text-lantern-text">{suggestion.label}</Text>
                  {suggestion.kind === 'type' ? (
                    <Text className="text-[11px] text-lantern-text-tertiary">{suggestion.pathLabel}</Text>
                  ) : null}
                </View>
              </Pressable>
            ))}
            {hasRecentSuggestions ? (
              <Pressable
                onPress={() => {
                  void clearRecentMarketplaceSearches();
                  setRecentSearches([]);
                }}
                accessibilityRole="button"
                accessibilityLabel="Clear recent searches"
                // 44px floor: the dropdown is overflow-hidden and the rows are
                // stacked edge to edge, so hitSlop would be clipped below and
                // handed to the neighbouring row above.
                className="min-h-[44px] justify-center px-3 py-2"
              >
                <Text className="text-xs font-medium text-lantern-primary-text">Clear recent searches</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

      <View className="bg-lantern-surface border-b border-lantern-border">
        {!showFavoritesOnly && !searchQuery.trim() ? (
          <ShopDepartmentRow
            selected={taxonomyNodeId?.split('.')[0] || undefined}
            onSelect={(department) => {
              setTaxonomyNode(department);
              setOpenPanel(null);
            }}
          />
        ) : null}
        {/* Departments scroll horizontally, Amazon-style: nine of them cannot
            share a row of equal thirds, and squeezing them would truncate every
            label. Shops sits last because it browses sellers, not products. */}
        <View className="flex-row items-center">
        <Pressable
          onPress={() => navigation.navigate('ShopBrowse')}
          accessibilityRole="button"
          accessibilityLabel="Shop by department"
          className="flex-row items-center gap-1 ml-3 mr-1 px-2.5 py-2 rounded-lg bg-lantern-background-secondary dark:bg-lantern-surface-secondary"
        >
          <AppIcon name="menu" size={16} color="#64748b" />
          <Text className="text-xs font-semibold text-lantern-text-secondary">Departments</Text>
        </Pressable>
        {/* Departments browse SELLERS' shelves; this browses the academic
            archive — the course a bank or pack was filed under, which is how a
            student finds it months after the seller stopped promoting it. */}
        <Pressable
          onPress={() => navigation.navigate('CourseBrowse')}
          accessibilityRole="button"
          accessibilityLabel={COURSE_ANCHOR_COPY.browseTitle}
          className="flex-row items-center gap-1 mr-1 px-2.5 py-2 rounded-lg bg-lantern-background-secondary dark:bg-lantern-surface-secondary"
        >
          <AppIcon name="school" size={16} color="#64748b" />
          <Text className="text-xs font-semibold text-lantern-text-secondary">By course</Text>
        </Pressable>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 8 }}
          className="max-h-12"
        >
          {MARKETPLACE_TABS.map(tab => (
            <Pressable
              key={tab}
              onPress={() => {
                setActiveTab(tab);
                setSelectedCategory(null);
                setOpenPanel(null);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === tab }}
              className={`px-3 py-2.5 mr-1 items-center border-b-2 ${
                activeTab === tab ? 'border-lantern-primary' : 'border-transparent'
              }`}
            >
              <Text
                numberOfLines={1}
                className={`text-sm font-medium ${activeTab === tab ? 'text-lantern-primary-text' : 'text-lantern-text-secondary'}`}
              >
                {marketplaceTabLabel(tab)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        </View>

        {/* Where the buyer actually is in the tree. Each crumb widens the
            browse by one level; the last one clears back to the department. */}
        {taxonomyPath.length > 0 ? (
          <View className="px-3 pb-2 flex-row items-center flex-wrap">
            {taxonomyPath.map((crumb, index) => (
              <React.Fragment key={crumb.id}>
                {index > 0 ? (
                  <Text className="px-1 text-[11px] text-lantern-text-tertiary">›</Text>
                ) : null}
                <Pressable
                  onPress={() => setTaxonomyNode(crumb.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Browse ${crumb.label}`}
                  className="py-1"
                >
                  <Text
                    className={`text-[11px] ${
                      index === taxonomyPath.length - 1
                        ? 'font-semibold text-lantern-text'
                        : 'text-lantern-primary-text'
                    }`}
                  >
                    {crumb.label}
                  </Text>
                </Pressable>
              </React.Fragment>
            ))}
            <Pressable
              onPress={() => setTaxonomyNode(null)}
              accessibilityRole="button"
              accessibilityLabel="Clear category filter"
              hitSlop={8}
              className="ml-2 py-1"
            >
              <AppIcon name="close-circle" size={15} color="#94a3b8" />
            </Pressable>
          </View>
        ) : null}

        {activeTab !== 'shops' ? (
        <View className="flex-row px-3 pb-2 gap-2 flex-wrap">
          {/* Two complete static class strings per branch, never an
              interpolated tone fragment: NativeWind drops unknown classes
              silently. Indigo count pill, not the red Badge: a filter is a
              setting, not attention. 32px + hitSlop 6 = 44px. */}
          <Pressable
            onPress={() => togglePanel('filters')}
            accessibilityRole="button"
            accessibilityLabel={filtersLabel(activeFilterCount)}
            accessibilityState={{ expanded: openPanel === 'filters' }}
            hitSlop={6}
            className={
              openPanel === 'filters' || activeFilterCount > 0
                ? 'flex-row items-center gap-1 min-h-[32px] px-2.5 rounded-lg bg-lantern-primary-background'
                : 'flex-row items-center gap-1 min-h-[32px] px-2.5 rounded-lg bg-lantern-background-secondary dark:bg-lantern-surface-secondary'
            }
          >
            <AppIcon
              name="options"
              size={14}
              color={activeFilterCount > 0 || openPanel === 'filters' ? brand.text : colors.textSecondary}
            />
            <Text
              className={
                activeFilterCount > 0
                  ? 'text-[11px] font-medium text-lantern-primary-text'
                  : 'text-[11px] font-medium text-lantern-text-secondary'
              }
            >
              Filters
            </Text>
            {activeFilterCount > 0 ? (
              <View className="ml-0.5 px-1.5 py-0.5 rounded-full bg-lantern-primary-fill">
                <Text className="text-[11px] font-bold text-white">{activeFilterCount}</Text>
              </View>
            ) : null}
            <AppIcon
              name={openPanel === 'filters' ? 'chevron-up' : 'chevron-down'}
              size={14}
              color={colors.textSecondary}
            />
          </Pressable>
          {/* "Save search", not "Save": with Alerts gone from beside it, "Save"
              alone no longer says what it saves (the band's Saved card is
              saved listings). */}
          <Pressable
            onPress={handleSaveSearch}
            accessibilityRole="button"
            accessibilityLabel="Save this search as an alert"
            hitSlop={6}
            className="min-h-[32px] px-2.5 justify-center rounded-lg bg-lantern-primary-background"
          >
            <Text className="text-[11px] font-medium text-lantern-primary-text">Save search</Text>
          </Pressable>
        </View>
        ) : null}

        {/* The filters live in the FIXED header chrome, above the product list
            rather than inside it, so nothing here could ever be scrolled: with
            the keyboard over "Min ₦"/"Max ₦"/"Pickup or delivery area" the
            covered field was simply unreachable. KeyboardSafePanel bounds the
            panel to the room actually left above the keyboard and lets it
            scroll inside that; with the keyboard down it is unbounded and lays
            out exactly as before. */}
        {activeTab !== 'shops' && openPanel === 'filters' ? (
          <KeyboardSafePanel className="px-3 pb-3" contentClassName="gap-2">
            <View className="flex-row items-center justify-between">
              <Text accessibilityRole="header" className="text-xs font-semibold text-lantern-text">
                Filters
              </Text>
              {activeFilterCount > 0 ? (
                <Pressable
                  onPress={handleResetFilters}
                  accessibilityRole="button"
                  accessibilityLabel="Reset filters"
                  hitSlop={{ top: 6, bottom: 6 }}
                  className="min-h-[32px] px-2 justify-center"
                >
                  <Text className="text-xs font-semibold text-lantern-primary-text">Reset filters</Text>
                </Pressable>
              ) : null}
            </View>
            {/* Category first, campus second: the order the two chips they
                replace used to sit in. Selecting leaves the panel open. */}
            <View className="gap-1.5">
              <Text className="text-[11px] text-lantern-text-tertiary">Category</Text>
              {/* px literals, not rem classes: NativeWind inlines rem at 14, so
                  text-xs + py-1.5 is a 26.5px pill. min-h-[32px] + hitSlop 6
                  = 44px, and a 12px gap on both axes keeps neighbouring slops
                  from overlapping (RN hands an overlap to the later sibling,
                  i.e. the wrong row's pill). */}
              <View className="flex-row flex-wrap gap-[12px]">
                <Pressable
                  onPress={() => setSelectedCategory(null)}
                  accessibilityRole="button"
                  accessibilityLabel="All categories"
                  accessibilityState={{ selected: !selectedCategory }}
                  hitSlop={6}
                  className={`min-h-[32px] justify-center px-3 py-1.5 rounded-full border ${!selectedCategory ? 'bg-lantern-primary-fill border-lantern-primary' : 'border-lantern-border'}`}
                >
                  <Text className={`text-xs font-medium ${!selectedCategory ? 'text-white' : 'text-lantern-text-secondary'}`}>All</Text>
                </Pressable>
                {categories.map(cat => (
                  <Pressable
                    key={cat.id}
                    onPress={() => setSelectedCategory(cat.id as MarketplaceCategory)}
                    accessibilityRole="button"
                    accessibilityLabel={`Category ${cat.name}`}
                    accessibilityState={{ selected: selectedCategory === cat.id }}
                    hitSlop={6}
                    className={`min-h-[32px] justify-center px-3 py-1.5 rounded-full border ${
                      selectedCategory === cat.id ? 'bg-lantern-primary-fill border-lantern-primary' : 'border-lantern-border'
                    }`}
                  >
                    <Text className={`text-xs font-medium ${selectedCategory === cat.id ? 'text-white' : 'text-lantern-text-secondary'}`}>
                      {cat.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
            {/* This is where "All Nigeria" now lives. */}
            <View className="gap-1.5">
              <Text className="text-[11px] text-lantern-text-tertiary">Campus</Text>
              <CampusPicker
                campuses={campuses}
                value={campusIdFilter}
                onChange={setCampusIdFilter}
                emptyLabel="All Nigeria"
                allowEmpty
              />
            </View>
            <View className="flex-row gap-2">
              <TextInput
                value={minPrice}
                onChangeText={setMinPrice}
                placeholder="Min ₦"
                placeholderTextColor={colors.inputPlaceholder}
                accessibilityLabel="Minimum price"
                keyboardType="numeric"
                className="flex-1 p-2 rounded-lg border border-lantern-border text-sm text-lantern-text"
              />
              <TextInput
                value={maxPrice}
                onChangeText={setMaxPrice}
                placeholder="Max ₦"
                placeholderTextColor={colors.inputPlaceholder}
                accessibilityLabel="Maximum price"
                keyboardType="numeric"
                className="flex-1 p-2 rounded-lg border border-lantern-border text-sm text-lantern-text"
              />
            </View>
            <TextInput
              value={locationFilter}
              onChangeText={setLocationFilter}
              placeholder="Pickup or delivery area"
              placeholderTextColor={colors.inputPlaceholder}
              accessibilityLabel="Pickup or delivery area"
              className="p-2 rounded-lg border border-lantern-border text-sm text-lantern-text"
            />
            <View className="flex-row items-center gap-2 flex-wrap">
              <Text className="text-[11px] text-lantern-text-tertiary">Sort</Text>
              <Pressable
                onPress={() => {
                  setSortBy('trending');
                  setSortOrder('desc');
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: sortBy === 'trending' }}
                className={`px-3 py-1.5 rounded-lg ${sortBy === 'trending' ? 'bg-lantern-primary-fill' : 'bg-lantern-background-secondary dark:bg-lantern-surface-secondary'}`}
              >
                <Text className={`text-xs ${sortBy === 'trending' ? 'text-white' : 'text-lantern-text-secondary'}`}>
                  Trending
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setSortBy('created_at');
                  setSortOrder(sortBy === 'created_at' && sortOrder === 'desc' ? 'asc' : 'desc');
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: sortBy === 'created_at' }}
                className={`px-3 py-1.5 rounded-lg ${sortBy === 'created_at' ? 'bg-lantern-primary-fill' : 'bg-lantern-background-secondary dark:bg-lantern-surface-secondary'}`}
              >
                <Text className={`text-xs ${sortBy === 'created_at' ? 'text-white' : 'text-lantern-text-secondary'}`}>
                  Newest {sortBy === 'created_at' && sortOrder === 'asc' ? '↑' : '↓'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setSortBy('price')}
                accessibilityRole="button"
                accessibilityState={{ selected: sortBy === 'price' }}
                className={`px-3 py-1.5 rounded-lg ${sortBy === 'price' ? 'bg-lantern-primary-fill' : 'bg-lantern-background-secondary dark:bg-lantern-surface-secondary'}`}
              >
                <Text className={`text-xs ${sortBy === 'price' ? 'text-white' : 'text-lantern-text-secondary'}`}>
                  Price
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setSortBy('rating');
                  setSortOrder('desc');
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: sortBy === 'rating' }}
                className={`px-3 py-1.5 rounded-lg ${sortBy === 'rating' ? 'bg-lantern-primary-fill' : 'bg-lantern-background-secondary dark:bg-lantern-surface-secondary'}`}
              >
                <Text className={`text-xs ${sortBy === 'rating' ? 'text-white' : 'text-lantern-text-secondary'}`}>
                  Top rated
                </Text>
              </Pressable>
            </View>
            {/* Condition is the filter a second-hand campus market lives on, and
                the server has always supported it — nothing exposed it. */}
            <View className="flex-row items-center gap-2 flex-wrap">
              <Text className="text-[11px] text-lantern-text-tertiary">Condition</Text>
              {[{ value: '', label: 'Any' }, ...(CONDITION_ATTRIBUTE.options ?? [])].map(option => {
                const selected = conditionFilter === option.value;
                return (
                  <Pressable
                    key={option.value || 'any'}
                    onPress={() => setConditionFilter(option.value)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Condition ${option.label}`}
                    className={`px-3 py-1.5 rounded-lg ${selected ? 'bg-lantern-primary-fill' : 'bg-lantern-background-secondary dark:bg-lantern-surface-secondary'}`}
                  >
                    <Text className={`text-xs ${selected ? 'text-white' : 'text-lantern-text-secondary'}`}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View className="flex-row items-center gap-2 flex-wrap">
              <Text className="text-[11px] text-lantern-text-tertiary">Rating</Text>
              {([null, 4, 3, 2] as Array<number | null>).map(value => {
                const selected = minRating === value;
                return (
                  <Pressable
                    key={String(value)}
                    onPress={() => setMinRating(value)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={value ? `Rated ${value} stars and up` : 'Any rating'}
                    className={`px-3 py-1.5 rounded-lg ${selected ? 'bg-lantern-primary-fill' : 'bg-lantern-background-secondary dark:bg-lantern-surface-secondary'}`}
                  >
                    <Text className={`text-xs ${selected ? 'text-white' : 'text-lantern-text-secondary'}`}>
                      {value ? `★ ${value}+` : 'Any'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </KeyboardSafePanel>
        ) : null}

        {/* No tab gate: the header Alerts button works on Shops too, and it is
            never a silent no-op — with nothing saved it explains itself. */}
        {openPanel === 'alerts' ? (
          <View className="px-3 pb-3">
            {savedSearches.length === 0 ? (
              <Text className="text-sm text-lantern-text-secondary">
                No alerts yet. Save a search and we'll tell you when new listings match it.
              </Text>
            ) : (
              savedSearches.map(s => (
                <View key={s.id} className="flex-row items-center justify-between py-0.5 border-b border-lantern-border">
                  <Pressable
                    className="flex-1 min-h-[44px] justify-center"
                    accessibilityRole="button"
                    accessibilityLabel={`Apply saved search ${s.name}`}
                    onPress={() => {
                      applySavedSearch(s.filters);
                      setOpenPanel(null);
                    }}
                  >
                    <Text className="text-sm text-lantern-text">{s.name}</Text>
                  </Pressable>
                  {/* A real 44px box, not a glyph plus hitSlop: NativeWind
                      inlines rem at 14 (h-9 = 31.5px), and slop past the
                      row's right edge is clipped by the parent anyway. A miss
                      here would land on the flex-1 Apply Pressable. */}
                  <Pressable
                    onPress={() => void deleteSavedSearch(s.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete saved search ${s.name}`}
                    className="h-[44px] w-[44px] items-center justify-center"
                  >
                    <AppIcon name="trash" size={16} color="#94a3b8" />
                  </Pressable>
                </View>
              ))
            )}
          </View>
        ) : null}
      </View>

      {activeTab === 'shops' ? (
        shopsLoading && !shops.length ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color={brand.text} />
          </View>
        ) : (
          <FlatList
            data={shops}
            onScroll={chromeOnScroll}
            scrollEventThrottle={16}
            keyboardShouldPersistTaps="handled"
            keyExtractor={(item) => item.sellerId}
            contentContainerStyle={{ padding: 12, paddingBottom: tabBarClearance }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={async () => {
                  setRefreshing(true);
                  await fetchShops({
                    campus: campusIdFilter || undefined,
                    q: searchQuery || undefined,
                  });
                  setRefreshing(false);
                }}
                tintColor={brand.text}
              />
            }
            ListEmptyComponent={
              <View className="items-center py-16 px-6">
                <AppIcon name="storefront" size={48} color="#cbd5e1" />
                <Text className="text-lg font-semibold text-lantern-text mt-4">No shops yet</Text>
                <Text className="text-sm text-lantern-text-secondary mt-2 text-center">
                  Sellers with active listings show up here automatically.
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <Pressable
                onPress={() =>
                  dismissKeyboardThen(() =>
                    navigation.navigate('SellerProfile', { sellerId: item.sellerId }),
                  )
                }
                className="mb-3 rounded-2xl overflow-hidden border border-lantern-border bg-lantern-surface"
              >
                <View className="h-16 bg-lantern-ink">
                  {item.coverImageUrl ? (
                    <ListingImage uri={item.coverImageUrl} className="w-full h-full" />
                  ) : null}
                </View>
                <View className="px-3 pb-3 -mt-4">
                  <View className="w-12 h-12 rounded-xl bg-lantern-background-secondary border-2 border-lantern-surface overflow-hidden items-center justify-center">
                    {item.avatarUrl ? (
                      <ListingImage uri={item.avatarUrl} className="w-full h-full" />
                    ) : (
                      <Text className="font-bold text-lantern-primary-text">
                        {item.shopName.charAt(0).toUpperCase()}
                      </Text>
                    )}
                  </View>
                  <Text className="mt-2 text-sm font-bold text-lantern-text" numberOfLines={1}>
                    {item.shopName}
                  </Text>
                  {item.bio ? (
                    <Text className="text-xs text-lantern-text-secondary mt-0.5" numberOfLines={2}>
                      {item.bio}
                    </Text>
                  ) : null}
                  <Text className="text-[11px] text-lantern-text-tertiary mt-1">
                    {item.activeListingCount} active
                    {item.avgRating > 0 ? ` · ★ ${item.avgRating.toFixed(1)}` : ''}
                    {item.campusLabel ? ` · ${item.campusLabel}` : ''}
                  </Text>
                </View>
              </Pressable>
            )}
          />
        )
      ) : listingsState === 'loading' ? (
        <View className="flex-1 flex-row flex-wrap p-2">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <View key={i} className="w-1/2 p-1">
              <View className="rounded-2xl overflow-hidden border border-lantern-border bg-lantern-surface">
                <Skeleton className="h-28 w-full rounded-none" />
                <View className="p-2 gap-2">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-3 w-1/3" />
                </View>
              </View>
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          data={displayListings}
          onScroll={chromeOnScroll}
          scrollEventThrottle={16}
          // "handled", as on the Recent strip and tabs: the search keyboard is
          // up while typed results render, and RN's default "never" swallows
          // the first card tap to dismiss it.
          keyboardShouldPersistTaps="handled"
          keyExtractor={item => item.id}
          numColumns={2}
          ListHeaderComponent={
            <>
              {listHeader}
              {/* Rows are still on screen and we could not refresh them: flag
                  them, never blank them. */}
              {listingsState === 'stale' ? (
                <RequestError
                  error={listingsError}
                  variant="banner"
                  onRetry={retryListings}
                  detail="These are the listings we already had. We couldn’t check for new ones."
                />
              ) : null}
            </>
          }
          contentContainerStyle={{ padding: 8, paddingBottom: tabBarClearance }}
          columnWrapperStyle={{ justifyContent: 'space-between' }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={brand.text} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            isLoading && displayListings.length > 0 ? (
              <ActivityIndicator className="my-4" color={brand.text} />
            ) : null
          }
          ListEmptyComponent={
            listingsState === 'failed' ? (
              // Not "No listings found" — we do not know that. The Communities
              // segment already degraded this way; Shop showed a bare empty
              // state with nothing to tap.
              <View style={{ minHeight: 320 }}>
                <RequestError error={listingsError} onRetry={retryListings} />
              </View>
            ) : (
            <View className="items-center py-16 px-6">
              <AppIcon name="bag" size={48} color="#cbd5e1" />
              <Text className="text-lg font-semibold text-lantern-text mt-4">
                {taxonomyPath.length > 0
                  ? `Nothing in ${taxonomyPath[taxonomyPath.length - 1]?.label} yet`
                  : 'No listings found'}
              </Text>
              {/* A buyer who drilled three levels down and found nothing wants
                  to widen the search, not open the seller form. */}
              {taxonomyPath.length > 1 ? (
                <Button
                  className="mt-4"
                  onPress={() => setTaxonomyNode(taxonomyPath[taxonomyPath.length - 2]?.id ?? null)}
                >
                  {`Look in ${taxonomyPath[taxonomyPath.length - 2]?.label}`}
                </Button>
              ) : taxonomyPath.length === 1 ? (
                <Button className="mt-4" onPress={() => setTaxonomyNode(null)}>
                  Browse the whole department
                </Button>
              ) : (
                <Button className="mt-4" onPress={() => navigation.navigate('CreateListing')}>
                  Create Listing
                </Button>
              )}
            </View>
            )
          }
          renderItem={renderListing}
        />
      )}
    </Screen>
  );
}
