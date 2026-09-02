import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  Keyboard,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
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
import { DiscoverWorkspaceBar } from '../discover/DiscoverWorkspaceBar';
import { shouldShowTrustChip, trustLabel, canAccessDiscoverHub } from '@lantern/shared/network';
import {
  CONDITION_ATTRIBUTE,
  getTaxonomyPath,
  listingTypeLabel,
  suggestMarketplaceSearch,
} from '@lantern/shared/marketplace';
import { usePlatformAdmin } from '../../hooks/usePlatformAdmin';
import { useChrome } from '../../components/layout/ChromeContext';
import { useTheme } from '../../theme';
import {
  alertsLabel,
  countActiveFilters,
  filtersLabel,
  isSearchExpanded,
} from './marketplaceSearchChrome';

/** Byte-identical to the inline Cart/You so parity with ShopHeaderActions holds. */
const ICON_BTN = 'h-9 w-9 items-center justify-center rounded-lg bg-lantern-background-secondary';

type ShopPanel = 'filters' | 'alerts';

type NavigationProp = {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

export function MarketplaceScreen({ navigation }: { navigation: NavigationProp }) {
  const tabBarClearance = useTabBarClearance(16);
  const { onScroll: chromeOnScroll } = useChrome();
  const { user } = useAuthStore();
  const isPlatformAdmin = usePlatformAdmin();
  const savedCampusId = useSettingsStore(
    state => state.settings.marketplace?.campus_id || undefined
  );
  const {
    listings,
    favorites,
    favoriteListings,
    savedSearches,
    isLoading,
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

  const displayListings = useMemo(() => {
    const base = showFavoritesOnly
      ? favoriteListings.length
        ? favoriteListings
        : listings.filter(l => favorites.has(l.id))
      : listings;
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
    favoriteListings,
    favorites,
    showFavoritesOnly,
    searchQuery,
    listingMatchesFilters,
  ]);

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
      Alert.alert('Saved', 'Search saved.');
    } catch {
      Alert.alert('Error', 'Could not save search.');
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
            <Ionicons name={favorited ? 'heart' : 'heart-outline'} size={16} color={favorited ? '#dc2626' : '#94a3b8'} />
          </Pressable>
          {own ? (
            <View className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-lantern-primary/90">
              <Text className="text-[10px] font-semibold text-white">Yours</Text>
            </View>
          ) : null}
        </View>
        <View className="p-2.5">
          <Text className="text-sm font-semibold text-lantern-text" numberOfLines={2}>
            {item.title}
          </Text>
          <Text className="text-[10px] text-lantern-text-tertiary mt-0.5" numberOfLines={1}>
            {listingTypeLabel(item, getCategoryInfo(item.category).name)}
          </Text>
          {(item.rating_count ?? 0) > 0 && item.rating_avg != null ? (
            <View
              className="mt-0.5 flex-row items-center gap-0.5"
              accessibilityLabel={`Rated ${Number(item.rating_avg).toFixed(1)} out of 5 from ${item.rating_count} reviews`}
            >
              <Ionicons name="star" size={11} color="#f59e0b" />
              <Text className="text-[11px] text-lantern-text-secondary">
                {Number(item.rating_avg).toFixed(1)} ({item.rating_count})
              </Text>
            </View>
          ) : null}
          {/* Phase 3 N — see the web card: the server attaches trust to every
              browse row and nothing rendered it. 'new' shows no chip. */}
          {shouldShowTrustChip((item.seller as { trustLevel?: string } | undefined)?.trustLevel) ? (
            <View className="mt-1 self-start rounded-full bg-lantern-primary/15 px-1.5 py-0.5">
              <Text className="text-[10px] font-semibold text-lantern-primary">
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
            <Text className="text-base font-bold text-lantern-primary mt-1">
              {formatPrice(item.price)}
            </Text>
          )}
        </View>
      </Pressable>
    );
  };

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
          <Text className="text-sm font-semibold text-lantern-text mb-2 px-1">
            Recently viewed
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {recentListings.map(item => (
              <Pressable
                key={item.id}
                onPress={() => openListing(item.id)}
                className="w-28 mr-2 rounded-xl overflow-hidden bg-lantern-surface border border-lantern-border"
              >
                <ListingImage uri={item.images?.[0]} className="w-full h-20" />
                <Text numberOfLines={2} className="text-[10px] p-1.5 text-lantern-text">
                  {item.title}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
      {dealListings.length > 0 && !showFavoritesOnly && !searchQuery.trim() ? (
        <View className="px-2 pt-3">
          <Text className="text-sm font-semibold text-lantern-text mb-2 px-1">On sale now</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {dealListings.map(item => (
              <Pressable
                key={item.id}
                onPress={() => openListing(item.id)}
                className="w-28 mr-2 rounded-xl overflow-hidden bg-lantern-surface border border-lantern-border"
              >
                <ListingImage uri={item.images?.[0]} className="w-full h-20" />
                <Text numberOfLines={2} className="text-[10px] p-1.5 text-lantern-text">
                  {item.title}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <View className="pt-1 pb-2 gap-2">
        {canAccessDiscoverHub(isPlatformAdmin) ? (
          <DiscoverWorkspaceBar
            active="marketplace"
            onSelect={(section) => {
              if (section === 'marketplace') return;
              navigation.navigate('Discover', { section });
            }}
          />
        ) : null}

        {/* 36dp row in both states so Cart never jumps. gap-2 (8px) means
            hitSlop={4} on adjacent 36px buttons yields exact 44px targets that
            touch without overlapping. */}
        <View className="px-4 flex-row items-center gap-2">
          {searchExpanded ? (
            <View className="flex-1 min-h-[36px] flex-row items-center bg-lantern-surface border border-lantern-border rounded-lantern pl-0.5 pr-1">
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
                <Ionicons name="arrow-back" size={20} color={colors.textSecondary} />
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
                placeholder="Search listings…"
                placeholderTextColor={colors.inputPlaceholder}
                accessibilityLabel="Search listings"
                className="flex-1 ml-1 py-0 text-sm text-lantern-text"
              />
              {searchQuery.length > 0 ? (
                <Pressable
                  onPress={clearSearch}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  hitSlop={4}
                  className="h-9 w-9 items-center justify-center"
                >
                  <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                </Pressable>
              ) : null}
            </View>
          ) : (
            <View className="flex-1 flex-row items-center">
              <Pressable
                onPress={openSearch}
                accessibilityRole="button"
                accessibilityLabel="Search"
                accessibilityHint="Opens the search box"
                accessibilityState={{ expanded: false }}
                hitSlop={4}
                className={ICON_BTN}
              >
                <Ionicons name="search" size={19} color={colors.textSecondary} />
              </Pressable>
            </View>
          )}
          {/* Alerts, Cart and You stay mounted in BOTH states. searchExpanded
              is pinned true for as long as a query sits in the store (results
              browsing, returning from ListingDetail/Cart), not just while
              typing, and ShopQuickActions (the other Cart/You entry) hides on
              any query. Unmounting these here would leave a buyer with an
              active search no route to alerts or the You hub except Close,
              which wipes the query. Only the Sell pill yields its width. */}
          <Pressable
            onPress={() => togglePanel('alerts')}
            accessibilityRole="button"
            accessibilityLabel={alertsLabel(savedSearchNewMatches)}
            accessibilityState={{ expanded: openPanel === 'alerts' }}
            hitSlop={4}
            className={ICON_BTN}
          >
            {/* "Alerts", not "Saved": this is saved SEARCHES and their new
                matches. The band's Saved card is saved listings, and two
                controls called Saved a thumb apart meant nobody knew which
                was which. Sits left of Cart so Cart+You remain the trailing
                pair every other Shop screen shows. */}
            <Ionicons
              name="notifications-outline"
              size={20}
              color={openPanel === 'alerts' ? '#6366f1' : colors.textSecondary}
            />
            <Badge count={savedSearchNewMatches} />
          </Pressable>
          {/* Amazon keeps the cart and your account one tap away on every
              page. These replace a favourites toggle and a "..." sheet that
              hid orders, cart, inquiries and offers behind an extra tap. */}
          <Pressable
            onPress={() => navigation.navigate('Cart')}
            accessibilityRole="button"
            accessibilityLabel={
              badges.cartCount > 0 ? `Cart, ${badges.cartCount} items` : 'Cart'
            }
            hitSlop={4}
            className={ICON_BTN}
          >
            <Ionicons name="cart-outline" size={19} color={colors.textSecondary} />
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
            className={ICON_BTN}
          >
            <Ionicons name="person-circle-outline" size={20} color={colors.textSecondary} />
            <Badge count={badges.needsYou} />
          </Pressable>
          {/* Sell is the one control that yields to the box: it is the widest
              and stays reachable through the You hub's Selling section. */}
          {searchExpanded ? null : (
            <Pressable
              onPress={() => navigation.navigate('CreateListing')}
              accessibilityRole="button"
              accessibilityLabel="Sell an item"
              hitSlop={4}
              className="h-9 flex-row items-center gap-1 px-3 rounded-lg bg-lantern-primary"
            >
              <Ionicons name="add" size={16} color="#fff" />
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
                accessibilityLabel={suggestion.label}
                className="px-3 py-2 border-b border-lantern-border last:border-b-0"
              >
                <Text className="text-sm text-lantern-text">{suggestion.label}</Text>
                {suggestion.kind === 'type' ? (
                  <Text className="text-[11px] text-lantern-text-tertiary">{suggestion.pathLabel}</Text>
                ) : null}
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      <View className="bg-lantern-surface border-b border-lantern-border">
        {searchExpanded && !searchQuery.trim() && recentSearches.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            // The keyboard is always up when this appears; RN's default 'never'
            // swallows the first chip tap.
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 8, gap: 6, alignItems: 'center' }}
          >
            <Text className="text-[11px] text-lantern-text-tertiary mr-1">Recent</Text>
            {recentSearches.map(q => (
              <Pressable
                key={q}
                onPress={() => setSearchQuery(q)}
                accessibilityRole="button"
                accessibilityLabel={`Search again for ${q}`}
                className="px-2.5 py-1 rounded-full bg-lantern-background-secondary dark:bg-lantern-surface-secondary"
              >
                <Text className="text-[11px] text-lantern-text-secondary">{q}</Text>
              </Pressable>
            ))}
            <Pressable
              onPress={() => {
                void clearRecentMarketplaceSearches();
                setRecentSearches([]);
              }}
              accessibilityRole="button"
              accessibilityLabel="Clear recent searches"
              className="px-2 py-1"
            >
              <Ionicons name="close-circle-outline" size={14} color="#94a3b8" />
            </Pressable>
          </ScrollView>
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
          <Ionicons name="menu" size={16} color="#64748b" />
          <Text className="text-xs font-semibold text-lantern-text-secondary">Departments</Text>
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
                className={`text-sm font-medium ${activeTab === tab ? 'text-lantern-primary' : 'text-lantern-text-secondary'}`}
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
                        : 'text-lantern-primary'
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
              <Ionicons name="close-circle" size={15} color="#94a3b8" />
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
                ? 'flex-row items-center gap-1 min-h-[32px] px-2.5 rounded-lg bg-lantern-primary-background dark:bg-lantern-primary-dark/40'
                : 'flex-row items-center gap-1 min-h-[32px] px-2.5 rounded-lg bg-lantern-background-secondary dark:bg-lantern-surface-secondary'
            }
          >
            <Ionicons
              name="options-outline"
              size={14}
              color={activeFilterCount > 0 || openPanel === 'filters' ? '#6366f1' : colors.textSecondary}
            />
            <Text
              className={
                activeFilterCount > 0
                  ? 'text-[11px] font-medium text-lantern-primary'
                  : 'text-[11px] font-medium text-lantern-text-secondary'
              }
            >
              Filters
            </Text>
            {activeFilterCount > 0 ? (
              <View className="ml-0.5 px-1.5 py-0.5 rounded-full bg-lantern-primary">
                <Text className="text-[9px] font-bold text-white">{activeFilterCount}</Text>
              </View>
            ) : null}
            <Ionicons
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
            className="min-h-[32px] px-2.5 justify-center rounded-lg bg-lantern-primary-background dark:bg-lantern-primary-dark/40"
          >
            <Text className="text-[11px] font-medium text-lantern-primary">Save search</Text>
          </Pressable>
        </View>
        ) : null}

        {activeTab !== 'shops' && openPanel === 'filters' ? (
          <View className="px-3 pb-3 gap-2">
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
                  <Text className="text-xs font-semibold text-lantern-primary">Reset filters</Text>
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
                  className={`min-h-[32px] justify-center px-3 py-1.5 rounded-full border ${!selectedCategory ? 'bg-lantern-primary border-lantern-primary' : 'border-lantern-border'}`}
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
                      selectedCategory === cat.id ? 'bg-lantern-primary border-lantern-primary' : 'border-lantern-border'
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
                className={`px-3 py-1.5 rounded-lg ${sortBy === 'trending' ? 'bg-lantern-primary' : 'bg-lantern-background-secondary dark:bg-lantern-surface-secondary'}`}
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
                className={`px-3 py-1.5 rounded-lg ${sortBy === 'created_at' ? 'bg-lantern-primary' : 'bg-lantern-background-secondary dark:bg-lantern-surface-secondary'}`}
              >
                <Text className={`text-xs ${sortBy === 'created_at' ? 'text-white' : 'text-lantern-text-secondary'}`}>
                  Newest {sortBy === 'created_at' && sortOrder === 'asc' ? '↑' : '↓'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setSortBy('price')}
                accessibilityRole="button"
                accessibilityState={{ selected: sortBy === 'price' }}
                className={`px-3 py-1.5 rounded-lg ${sortBy === 'price' ? 'bg-lantern-primary' : 'bg-lantern-background-secondary dark:bg-lantern-surface-secondary'}`}
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
                className={`px-3 py-1.5 rounded-lg ${sortBy === 'rating' ? 'bg-lantern-primary' : 'bg-lantern-background-secondary dark:bg-lantern-surface-secondary'}`}
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
                    className={`px-3 py-1.5 rounded-lg ${selected ? 'bg-lantern-primary' : 'bg-lantern-background-secondary dark:bg-lantern-surface-secondary'}`}
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
                    className={`px-3 py-1.5 rounded-lg ${selected ? 'bg-lantern-primary' : 'bg-lantern-background-secondary dark:bg-lantern-surface-secondary'}`}
                  >
                    <Text className={`text-xs ${selected ? 'text-white' : 'text-lantern-text-secondary'}`}>
                      {value ? `★ ${value}+` : 'Any'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
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
                    <Ionicons name="trash-outline" size={16} color="#94a3b8" />
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
            <ActivityIndicator color="#6366f1" />
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
                tintColor="#6366f1"
              />
            }
            ListEmptyComponent={
              <View className="items-center py-16 px-6">
                <Ionicons name="storefront-outline" size={48} color="#cbd5e1" />
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
                <View className="h-16 bg-indigo-600">
                  {item.coverImageUrl ? (
                    <ListingImage uri={item.coverImageUrl} className="w-full h-full" />
                  ) : null}
                </View>
                <View className="px-3 pb-3 -mt-4">
                  <View className="w-12 h-12 rounded-xl bg-lantern-background-secondary border-2 border-lantern-surface overflow-hidden items-center justify-center">
                    {item.avatarUrl ? (
                      <ListingImage uri={item.avatarUrl} className="w-full h-full" />
                    ) : (
                      <Text className="font-bold text-lantern-primary">
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
      ) : isLoading && !displayListings.length ? (
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
          ListHeaderComponent={listHeader}
          contentContainerStyle={{ padding: 8, paddingBottom: tabBarClearance }}
          columnWrapperStyle={{ justifyContent: 'space-between' }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            isLoading && displayListings.length > 0 ? (
              <ActivityIndicator className="my-4" color="#6366f1" />
            ) : null
          }
          ListEmptyComponent={
            <View className="items-center py-16 px-6">
              <Ionicons name="bag-outline" size={48} color="#cbd5e1" />
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
          }
          renderItem={renderListing}
        />
      )}
    </SafeAreaView>
  );
}
