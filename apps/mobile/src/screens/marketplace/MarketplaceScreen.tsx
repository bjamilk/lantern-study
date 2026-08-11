import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Skeleton, Button } from '../../components/ui';
import {
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
import { MarketplaceWorkspaceBar } from './components/MarketplaceWorkspaceBar';

type NavigationProp = {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

export function MarketplaceScreen({ navigation }: { navigation: NavigationProp }) {
  const tabBarClearance = useTabBarClearance(16);
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
    searchQuery,
    selectedCategory,
    activeTab,
    minPrice,
    maxPrice,
    locationFilter,
    campusIdFilter,
    sortBy,
    sortOrder,
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
    setMinPrice,
    setMaxPrice,
    setLocationFilter,
    setCampusIdFilter,
    setSortBy,
    setSortOrder,
    applySavedSearch,
    resetFilters,
    setShowFavoritesOnly,
    toggleFavorite,
    loadFromStorage,
  } = useMarketplaceStore();

  const [showCategories, setShowCategories] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showSavedSearches, setShowSavedSearches] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [recentListings, setRecentListings] = useState<MarketplaceListing[]>([]);
  const [savedSearchNewMatches, setSavedSearchNewMatches] = useState(0);
  const [campuses, setCampuses] = useState<MarketplaceCampusOption[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  useEffect(() => {
    void getRecentMarketplaceSearches().then(setRecentSearches);
  }, []);

  const categories = activeTab === 'academic' ? ACADEMIC_CATEGORIES : STUDENT_LIFE_CATEGORIES;
  const activeCategoryLabel = selectedCategory
    ? getCategoryInfo(selectedCategory).name
    : 'All categories';
  const selectedCampus = campuses.find(campus => campus.id === campusIdFilter);
  const activeFilterCount = [
    minPrice,
    maxPrice,
    locationFilter,
    campusIdFilter,
  ].filter(Boolean).length + (sortBy !== 'trending' || sortOrder !== 'desc' ? 1 : 0);

  const academicCategoryIds = useMemo(() => ACADEMIC_CATEGORIES.map(c => c.id), []);
  const studentLifeCategoryIds = useMemo(() => STUDENT_LIFE_CATEGORIES.map(c => c.id), []);

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

  useEffect(() => {
    void loadSavedSearchMatches();
  }, [loadSavedSearchMatches]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchListings({ page: 1 });
    }, 350);
    return () => clearTimeout(timer);
  }, [
    searchQuery,
    minPrice,
    maxPrice,
    locationFilter,
    campusIdFilter,
    sortBy,
    sortOrder,
    fetchListings,
  ]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadFromStorage();
    if (user?.id) await fetchServerFavorites();
    await fetchSavedSearches();
    await loadSavedSearchMatches();
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
      const tabMatch =
        activeTab === 'academic'
          ? academicCategoryIds.includes(listing.category as MarketplaceCategory) ||
            listing.category.startsWith('custom:')
          : studentLifeCategoryIds.includes(listing.category as MarketplaceCategory) ||
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
      academicCategoryIds,
      studentLifeCategoryIds,
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
          // Saved searches only cover the two browse tabs; a search saved from
          // the shops tab already round-trips to 'academic' via
          // normalizeSavedMarketplaceFilters, so coerce it explicitly.
          activeTab: activeTab === 'shops' ? 'academic' : activeTab,
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
        onPress={() => navigation.navigate('ListingDetail', { listingId: item.id })}
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
      {recentListings.length > 0 && !showFavoritesOnly ? (
        <View className="px-2 pt-3">
          <Text className="text-sm font-semibold text-lantern-text mb-2 px-1">
            Recently viewed
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {recentListings.map(item => (
              <Pressable
                key={item.id}
                onPress={() => navigation.navigate('ListingDetail', { listingId: item.id })}
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
      <View className="px-4 pt-2 pb-2 gap-2">
        <View className="flex-row items-center justify-between">
          <View className="flex-1 min-w-0 pr-2">
            <Text className="text-xl font-bold text-lantern-text">Explore</Text>
            <Text className="text-xs text-lantern-text-secondary">Buy and sell across Nigeria</Text>
          </View>
          <Pressable
            onPress={() => setShowFavoritesOnly(!showFavoritesOnly)}
            accessibilityRole="button"
            accessibilityLabel={showFavoritesOnly ? 'Show all listings' : 'Show favorites only'}
            className={`h-9 w-9 items-center justify-center rounded-lg ${
              showFavoritesOnly ? 'bg-lantern-error/10' : 'bg-lantern-background-secondary'
            }`}
          >
            <Ionicons name="heart" size={18} color={showFavoritesOnly ? '#dc2626' : '#64748b'} />
          </Pressable>
        </View>

        <MarketplaceWorkspaceBar
          active="browse"
          onNavigate={screen => navigation.navigate(screen)}
          onSell={() => navigation.navigate('CreateListing')}
          showFavorites
          primaryLabel="Sell"
        />

        <View className="flex-row items-center bg-lantern-surface border border-lantern-border rounded-lantern px-3 py-1.5">
          <Ionicons name="search" size={18} color="#94a3b8" />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search listings…"
            placeholderTextColor="#94a3b8"
            accessibilityLabel="Search listings"
            className="flex-1 ml-2 text-sm text-lantern-text"
          />
          <Pressable
            onPress={() => setShowFilters(v => !v)}
            className="p-2 min-w-[44px] min-h-[44px] items-center justify-center"
            accessibilityRole="button"
            accessibilityLabel="Marketplace filters"
          >
            <Ionicons
              name="options-outline"
              size={18}
              color={activeFilterCount > 0 ? '#6366f1' : '#64748b'}
            />
          </Pressable>
        </View>
      </View>

      <View className="bg-lantern-surface border-b border-lantern-border">
        {!searchQuery.trim() && recentSearches.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
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
        <View className="flex-row px-4 items-center">
          {(['academic', 'student-life', 'shops'] as const).map(tab => (
            <Pressable
              key={tab}
              onPress={() => {
                setActiveTab(tab);
                setShowCategories(false);
              }}
              className={`flex-1 py-2.5 items-center border-b-2 ${
                activeTab === tab ? 'border-lantern-primary' : 'border-transparent'
              }`}
            >
              <Text className={`text-sm font-medium ${activeTab === tab ? 'text-lantern-primary' : 'text-lantern-text-secondary'}`}>
                {tab === 'academic' ? 'Academic' : tab === 'student-life' ? 'Student Life' : 'Shops'}
              </Text>
            </Pressable>
          ))}
        </View>

        {activeTab !== 'shops' ? (
        <View className="flex-row px-3 pb-2 gap-2 flex-wrap">
          <Pressable
            onPress={() => setShowCategories(v => !v)}
            className="flex-row items-center gap-1 px-2 py-1 rounded-lg bg-lantern-background-secondary dark:bg-lantern-surface-secondary"
          >
            <Text className="text-[11px] font-medium text-lantern-text-secondary">{activeCategoryLabel}</Text>
            <Ionicons name={showCategories ? 'chevron-up' : 'chevron-down'} size={14} color="#64748b" />
          </Pressable>
          <Pressable
            onPress={() => setShowFilters(true)}
            className="flex-row items-center gap-1 px-2 py-1 rounded-lg bg-lantern-background-secondary dark:bg-lantern-surface-secondary"
          >
            <Ionicons name="location-outline" size={13} color="#64748b" />
            <Text numberOfLines={1} className="max-w-[120px] text-[11px] font-medium text-lantern-text-secondary">
              {selectedCampus?.name || 'All Nigeria'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setShowSavedSearches(v => !v)}
            className="flex-row items-center gap-1 px-2 py-1 rounded-lg bg-lantern-background-secondary dark:bg-lantern-surface-secondary"
          >
            <Ionicons name="bookmark-outline" size={14} color="#64748b" />
            <Text className="text-[11px] text-lantern-text-secondary">Saved</Text>
            {savedSearchNewMatches > 0 ? (
              <View className="ml-0.5 px-1.5 py-0.5 rounded-full bg-lantern-primary">
                <Text className="text-[9px] font-bold text-white">{savedSearchNewMatches}</Text>
              </View>
            ) : null}
          </Pressable>
          <Pressable onPress={handleSaveSearch} className="px-2 py-1 rounded-lg bg-lantern-primary-background dark:bg-lantern-primary-dark/40">
            <Text className="text-[11px] font-medium text-lantern-primary">Save</Text>
          </Pressable>
        </View>
        ) : null}

        {activeTab !== 'shops' && showFilters ? (
          <View className="px-3 pb-3 gap-2">
            <View className="flex-row items-center justify-between">
              <Text className="text-xs font-semibold text-lantern-text">Browse area</Text>
              {activeFilterCount > 0 ? (
                <Pressable onPress={resetFilters} className="min-h-[32px] px-2 justify-center">
                  <Text className="text-xs font-semibold text-lantern-primary">Reset filters</Text>
                </Pressable>
              ) : null}
            </View>
            <CampusPicker
              campuses={campuses}
              value={campusIdFilter}
              onChange={setCampusIdFilter}
              emptyLabel="All Nigeria"
              allowEmpty
            />
            <View className="flex-row gap-2">
              <TextInput
                value={minPrice}
                onChangeText={setMinPrice}
                placeholder="Min ₦"
                keyboardType="numeric"
                className="flex-1 p-2 rounded-lg border border-lantern-border text-sm text-lantern-text"
              />
              <TextInput
                value={maxPrice}
                onChangeText={setMaxPrice}
                placeholder="Max ₦"
                keyboardType="numeric"
                className="flex-1 p-2 rounded-lg border border-lantern-border text-sm text-lantern-text"
              />
            </View>
            <TextInput
              value={locationFilter}
              onChangeText={setLocationFilter}
              placeholder="Pickup or delivery area"
              placeholderTextColor="#94a3b8"
              className="p-2 rounded-lg border border-lantern-border text-sm text-lantern-text"
            />
            <View className="flex-row gap-2 flex-wrap">
              <Pressable
                onPress={() => {
                  setSortBy('trending');
                  setSortOrder('desc');
                }}
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
                className={`px-3 py-1.5 rounded-lg ${sortBy === 'created_at' ? 'bg-lantern-primary' : 'bg-lantern-background-secondary dark:bg-lantern-surface-secondary'}`}
              >
                <Text className={`text-xs ${sortBy === 'created_at' ? 'text-white' : 'text-lantern-text-secondary'}`}>
                  Newest {sortBy === 'created_at' && sortOrder === 'asc' ? '↑' : '↓'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setSortBy('price')}
                className={`px-3 py-1.5 rounded-lg ${sortBy === 'price' ? 'bg-lantern-primary' : 'bg-lantern-background-secondary dark:bg-lantern-surface-secondary'}`}
              >
                <Text className={`text-xs ${sortBy === 'price' ? 'text-white' : 'text-lantern-text-secondary'}`}>
                  Price
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {activeTab !== 'shops' && showCategories ? (
          <View className="px-3 pb-3 flex-row flex-wrap gap-2">
            <Pressable
              onPress={() => setSelectedCategory(null)}
              className={`px-3 py-1.5 rounded-full border ${!selectedCategory ? 'bg-lantern-primary border-lantern-primary' : 'border-lantern-border'}`}
            >
              <Text className={`text-xs font-medium ${!selectedCategory ? 'text-white' : 'text-lantern-text-secondary'}`}>All</Text>
            </Pressable>
            {categories.map(cat => (
              <Pressable
                key={cat.id}
                onPress={() => setSelectedCategory(cat.id as MarketplaceCategory)}
                className={`px-3 py-1.5 rounded-full border ${
                  selectedCategory === cat.id ? 'bg-lantern-primary border-lantern-primary' : 'border-lantern-border'
                }`}
              >
                <Text className={`text-xs font-medium ${selectedCategory === cat.id ? 'text-white' : 'text-lantern-text-secondary'}`}>
                  {cat.name}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {showSavedSearches && savedSearches.length > 0 ? (
          <View className="px-3 pb-3">
            {savedSearches.map(s => (
              <View key={s.id} className="flex-row items-center justify-between py-2 border-b border-lantern-border">
                <Pressable
                  className="flex-1"
                  onPress={() => {
                    applySavedSearch(s.filters);
                    setShowSavedSearches(false);
                  }}
                >
                  <Text className="text-sm text-lantern-text">{s.name}</Text>
                </Pressable>
                <Pressable
                  onPress={() => void deleteSavedSearch(s.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete saved search ${s.name}`}
                >
                  <Ionicons name="trash-outline" size={16} color="#94a3b8" />
                </Pressable>
              </View>
            ))}
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
                onPress={() => navigation.navigate('SellerProfile', { sellerId: item.sellerId })}
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
              <Text className="text-lg font-semibold text-lantern-text mt-4">No listings found</Text>
              <Button className="mt-4" onPress={() => navigation.navigate('CreateListing')}>
                Create Listing
              </Button>
            </View>
          }
          renderItem={renderListing}
        />
      )}
    </SafeAreaView>
  );
}
