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
import { Skeleton } from '../../components/ui';
import { LinearGradient } from 'expo-linear-gradient';
import {
  useMarketplaceStore,
  useAuthStore,
  ACADEMIC_CATEGORIES,
  STUDENT_LIFE_CATEGORIES,
  getCategoryInfo,
  type MarketplaceListing,
  type MarketplaceCategory,
} from '../../stores';
import { fetchMarketplaceListing, checkSavedSearchMatches } from '../../services/api';
import { Button } from '../../components/ui';
import { categoryIcon, formatPrice, isOwnListing, ListingImage } from './marketplaceHelpers';
import { getRecentlyViewedListingIds } from './marketplaceRecentlyViewed';

type NavigationProp = {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

export function MarketplaceScreen({ navigation }: { navigation: NavigationProp }) {
  const { user } = useAuthStore();
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
    sortBy,
    sortOrder,
    listingsHasMore,
    listingsPage,
    showFavoritesOnly,
    fetchListings,
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
    setSortBy,
    setSortOrder,
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

  const categories = activeTab === 'academic' ? ACADEMIC_CATEGORIES : STUDENT_LIFE_CATEGORIES;
  const activeCategoryLabel = selectedCategory
    ? getCategoryInfo(selectedCategory).name
    : 'All categories';

  const academicCategoryIds = useMemo(() => ACADEMIC_CATEGORIES.map(c => c.id), []);
  const studentLifeCategoryIds = useMemo(() => STUDENT_LIFE_CATEGORIES.map(c => c.id), []);

  const loadRecent = useCallback(async () => {
    const ids = await getRecentlyViewedListingIds();
    const loaded: MarketplaceListing[] = [];
    for (const id of ids.slice(0, 6)) {
      try {
        const l = await fetchMarketplaceListing(id);
        loaded.push({
          id: l.id,
          user_id: l.user_id,
          seller_id: l.user_id,
          category: l.category,
          title: l.title,
          description: l.description,
          price: l.price,
          location: l.location,
          images: l.images || [],
          status: l.status,
          views_count: l.views_count,
          favorites_count: l.favorites_count,
          created_at: l.created_at,
          updated_at: l.updated_at,
        });
      } catch {
        // skip missing
      }
    }
    setRecentListings(loaded);
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
  }, [searchQuery, minPrice, maxPrice, locationFilter, sortBy, sortOrder, fetchListings]);

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
      return true;
    },
    [activeTab, selectedCategory, academicCategoryIds, studentLifeCategoryIds]
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

  const handleSaveSearch = async () => {
    try {
      await createSavedSearch(
        {
          search: searchQuery,
          category: selectedCategory,
          minPrice,
          maxPrice,
          location: locationFilter,
          sortBy,
          sortOrder,
          activeTab,
        },
        searchQuery.trim() || activeCategoryLabel
      );
      Alert.alert('Saved', 'Search saved.');
    } catch {
      Alert.alert('Error', 'Could not save search.');
    }
  };

  const applySavedSearch = (filters: Record<string, unknown>) => {
    if (typeof filters.search === 'string') setSearchQuery(filters.search);
    if (typeof filters.category === 'string') setSelectedCategory(filters.category as MarketplaceCategory);
    if (typeof filters.minPrice === 'string') setMinPrice(filters.minPrice);
    if (typeof filters.maxPrice === 'string') setMaxPrice(filters.maxPrice);
    if (typeof filters.location === 'string') setLocationFilter(filters.location);
    if (typeof filters.sortBy === 'string') setSortBy(filters.sortBy);
    if (filters.sortOrder === 'asc' || filters.sortOrder === 'desc') setSortOrder(filters.sortOrder);
    if (filters.activeTab === 'academic' || filters.activeTab === 'student-life') setActiveTab(filters.activeTab);
    setShowSavedSearches(false);
    void fetchListings({ page: 1 });
  };

  const renderListing = ({ item }: { item: MarketplaceListing }) => {
    const category = getCategoryInfo(item.category);
    const favorited = favorites.has(item.id);
    const own = isOwnListing(item, user?.id);

    return (
      <Pressable
        onPress={() => navigation.navigate('ListingDetail', { listingId: item.id })}
        className={`flex-1 m-1.5 rounded-2xl overflow-hidden border ${
          own
            ? 'bg-indigo-50/80 dark:bg-indigo-950/30 border-indigo-300 dark:border-indigo-700'
            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
        }`}
      >
        <View className="aspect-[4/3] relative">
          <ListingImage uri={item.images?.[0]} className="w-full h-full" icon={categoryIcon(category.icon)} />
          <Pressable
            onPress={() => {
              if (user?.id) void toggleFavorite(item.id, user.id);
            }}
            className="absolute top-2 right-2 p-1.5 rounded-lg bg-white/90 dark:bg-slate-800/90"
          >
            <Ionicons name={favorited ? 'heart' : 'heart-outline'} size={16} color={favorited ? '#ef4444' : '#94a3b8'} />
          </Pressable>
          {own ? (
            <View className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-indigo-600/90">
              <Text className="text-[10px] font-semibold text-white">Yours</Text>
            </View>
          ) : null}
        </View>
        <View className="p-2.5">
          <Text className="text-sm font-semibold text-slate-800 dark:text-slate-100" numberOfLines={2}>
            {item.title}
          </Text>
          {item.is_on_sale && item.effective_price != null ? (
            <View className="mt-1">
              <Text className="text-xs text-slate-400 line-through">{formatPrice(item.price)}</Text>
              <Text className="text-base font-bold text-red-600 dark:text-red-400">
                {formatPrice(item.effective_price)}
              </Text>
            </View>
          ) : (
            <Text className="text-base font-bold text-indigo-600 dark:text-indigo-400 mt-1">
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
          <Text className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-2 px-1">
            Recently viewed
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {recentListings.map(item => (
              <Pressable
                key={item.id}
                onPress={() => navigation.navigate('ListingDetail', { listingId: item.id })}
                className="w-28 mr-2 rounded-xl overflow-hidden bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              >
                <ListingImage uri={item.images?.[0]} className="w-full h-20" />
                <Text numberOfLines={2} className="text-[10px] p-1.5 text-slate-700 dark:text-slate-200">
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
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-900" edges={['top']}>
      <LinearGradient colors={['#4f46e5', '#6366f1', '#7c3aed']} className="px-4 pt-2 pb-4">
        <View className="flex-row items-start justify-between pb-2">
          <View className="flex-1 pr-3">
            <Text className="text-2xl font-bold text-white">Marketplace</Text>
            <Text className="text-sm text-indigo-100 mt-0.5">Buy & sell on campus</Text>
          </View>
          <View className="flex-row flex-wrap gap-2 justify-end max-w-[160px]">
            <Pressable onPress={() => navigation.navigate('Orders')} className="p-2 rounded-xl bg-white/15">
              <Ionicons name="receipt-outline" size={20} color="#fff" />
            </Pressable>
            <Pressable onPress={() => navigation.navigate('Offers')} className="p-2 rounded-xl bg-white/15">
              <Ionicons name="pricetag-outline" size={20} color="#fff" />
            </Pressable>
            <Pressable onPress={() => navigation.navigate('Favorites')} className="p-2 rounded-xl bg-white/15">
              <Ionicons name="heart-outline" size={20} color="#fff" />
            </Pressable>
            <Pressable onPress={() => navigation.navigate('MyListings')} className="p-2 rounded-xl bg-white/15">
              <Ionicons name="storefront-outline" size={20} color="#fff" />
            </Pressable>
            <Pressable onPress={() => navigation.navigate('Inquiries')} className="p-2 rounded-xl bg-white/15">
              <Ionicons name="chatbubbles-outline" size={20} color="#fff" />
            </Pressable>
            <Pressable onPress={() => navigation.navigate('CreateListing')} className="p-2 rounded-xl bg-white">
              <Ionicons name="add" size={20} color="#4f46e5" />
            </Pressable>
          </View>
        </View>

        <View className="flex-row items-center bg-white dark:bg-slate-800 rounded-xl px-3 py-2">
          <Ionicons name="search" size={18} color="#94a3b8" />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search listings…"
            placeholderTextColor="#94a3b8"
            className="flex-1 ml-2 text-sm text-slate-900 dark:text-slate-100"
          />
          <Pressable onPress={() => setShowFilters(v => !v)} className="p-1">
            <Ionicons name="options-outline" size={18} color="#64748b" />
          </Pressable>
        </View>
      </LinearGradient>

      <View className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
        <View className="flex-row px-4 items-center">
          {(['academic', 'student-life'] as const).map(tab => (
            <Pressable
              key={tab}
              onPress={() => {
                setActiveTab(tab);
                setShowCategories(false);
              }}
              className={`flex-1 py-3 items-center border-b-2 ${
                activeTab === tab ? 'border-indigo-600' : 'border-transparent'
              }`}
            >
              <Text className={`text-sm font-medium ${activeTab === tab ? 'text-indigo-600' : 'text-slate-500'}`}>
                {tab === 'academic' ? 'Academic' : 'Student Life'}
              </Text>
            </Pressable>
          ))}
          <Pressable
            onPress={() => setShowFavoritesOnly(!showFavoritesOnly)}
            className={`px-2 py-1 rounded-lg ${showFavoritesOnly ? 'bg-red-100' : 'bg-slate-100 dark:bg-slate-700'}`}
          >
            <Ionicons name="heart" size={16} color={showFavoritesOnly ? '#ef4444' : '#64748b'} />
          </Pressable>
        </View>

        <View className="flex-row px-3 pb-2 gap-2 flex-wrap">
          <Pressable
            onPress={() => setShowCategories(v => !v)}
            className="flex-row items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-700"
          >
            <Text className="text-[11px] font-medium text-slate-600 dark:text-slate-300">{activeCategoryLabel}</Text>
            <Ionicons name={showCategories ? 'chevron-up' : 'chevron-down'} size={14} color="#64748b" />
          </Pressable>
          <Pressable
            onPress={() => setShowSavedSearches(v => !v)}
            className="flex-row items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-700"
          >
            <Ionicons name="bookmark-outline" size={14} color="#64748b" />
            <Text className="text-[11px] text-slate-600 dark:text-slate-300">Saved</Text>
            {savedSearchNewMatches > 0 ? (
              <View className="ml-0.5 px-1.5 py-0.5 rounded-full bg-indigo-600">
                <Text className="text-[9px] font-bold text-white">{savedSearchNewMatches}</Text>
              </View>
            ) : null}
          </Pressable>
          <Pressable onPress={handleSaveSearch} className="px-2 py-1 rounded-lg bg-indigo-100 dark:bg-indigo-900/40">
            <Text className="text-[11px] font-medium text-indigo-700 dark:text-indigo-300">Save search</Text>
          </Pressable>
        </View>

        {showFilters ? (
          <View className="px-3 pb-3 gap-2">
            <View className="flex-row gap-2">
              <TextInput
                value={minPrice}
                onChangeText={setMinPrice}
                placeholder="Min ₦"
                keyboardType="numeric"
                className="flex-1 p-2 rounded-lg border border-slate-200 dark:border-slate-600 text-sm text-slate-900 dark:text-slate-100"
              />
              <TextInput
                value={maxPrice}
                onChangeText={setMaxPrice}
                placeholder="Max ₦"
                keyboardType="numeric"
                className="flex-1 p-2 rounded-lg border border-slate-200 dark:border-slate-600 text-sm text-slate-900 dark:text-slate-100"
              />
            </View>
            <TextInput
              value={locationFilter}
              onChangeText={setLocationFilter}
              placeholder="Location filter"
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-600 text-sm text-slate-900 dark:text-slate-100"
            />
            <View className="flex-row gap-2">
              <Pressable
                onPress={() => {
                  setSortBy('created_at');
                  setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
                }}
                className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700"
              >
                <Text className="text-xs text-slate-600 dark:text-slate-300">
                  Date {sortOrder === 'desc' ? '↓' : '↑'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setSortBy(sortBy === 'price' ? 'created_at' : 'price')}
                className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700"
              >
                <Text className="text-xs text-slate-600 dark:text-slate-300">
                  Sort: {sortBy === 'price' ? 'Price' : 'Newest'}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {showCategories ? (
          <View className="px-3 pb-3 flex-row flex-wrap gap-2">
            <Pressable
              onPress={() => setSelectedCategory(null)}
              className={`px-3 py-1.5 rounded-full border ${!selectedCategory ? 'bg-indigo-600 border-indigo-600' : 'border-slate-200 dark:border-slate-600'}`}
            >
              <Text className={`text-xs font-medium ${!selectedCategory ? 'text-white' : 'text-slate-600'}`}>All</Text>
            </Pressable>
            {categories.map(cat => (
              <Pressable
                key={cat.id}
                onPress={() => setSelectedCategory(cat.id as MarketplaceCategory)}
                className={`px-3 py-1.5 rounded-full border ${
                  selectedCategory === cat.id ? 'bg-indigo-600 border-indigo-600' : 'border-slate-200 dark:border-slate-600'
                }`}
              >
                <Text className={`text-xs font-medium ${selectedCategory === cat.id ? 'text-white' : 'text-slate-600'}`}>
                  {cat.name}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {showSavedSearches && savedSearches.length > 0 ? (
          <View className="px-3 pb-3">
            {savedSearches.map(s => (
              <View key={s.id} className="flex-row items-center justify-between py-2 border-b border-slate-100 dark:border-slate-700">
                <Pressable className="flex-1" onPress={() => applySavedSearch(s.filters)}>
                  <Text className="text-sm text-slate-800 dark:text-slate-100">{s.name}</Text>
                </Pressable>
                <Pressable onPress={() => void deleteSavedSearch(s.id)}>
                  <Ionicons name="trash-outline" size={16} color="#94a3b8" />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      {isLoading && !displayListings.length ? (
        <View className="flex-1 flex-row flex-wrap p-2">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <View key={i} className="w-1/2 p-1">
              <View className="rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
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
          contentContainerStyle={{ padding: 8, paddingBottom: 24 }}
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
              <Text className="text-lg font-semibold text-slate-800 dark:text-slate-200 mt-4">No listings found</Text>
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
