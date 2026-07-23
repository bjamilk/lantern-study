import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useToastStore } from '../stores/toastStore';
import {
  fetchMyFavorites, addToFavorites, removeFromFavorites,
  getRecentlyViewed, removeRecentlyViewed, fetchMarketplaceListingsByIds,
  fetchSavedSearches, saveSearch, deleteSavedSearch, checkSavedSearchMatches,
  fetchMarketplaceListingsPage, fetchMarketplaceCategoryAnalytics, fetchMarketplaceCampuses
} from '../services/supabase';
import { RateLimitError } from '@lantern/shared';
import { normalizeUserSettings } from '@lantern/shared/settings';
import type { MarketplaceCampus } from '@lantern/shared';
import { useAuthStore } from '../stores/authStore';
import { MarketplaceListing, SavedSearch } from '../types';
import { usePageSeo } from '../hooks/usePageSeo';
import MarketplaceComplianceBanner from './marketplace/MarketplaceComplianceBanner';
import { ListingCard } from './marketplace/ListingCard';
import { MarketplaceFilterPanel } from './marketplace/MarketplaceFilterPanel';
import {
  buildMarketplaceSavedSearchFilters,
  restoreMarketplaceSavedSearchFilters,
  type MarketplaceSavedSearchFilters,
} from './marketplace/marketplaceSearchFilters';
import { FeatureHero, Tabs, TabList, Tab, TabPanel } from './ui';
import { featureAccents } from '@lantern/shared/design';
import {
  MagnifyingGlassIcon,
  PlusIcon,
  ClockIcon,
  AcademicCapIcon,
  BriefcaseIcon,
  ShoppingBagIcon,
  HomeIcon,
  TruckIcon,
  TicketIcon,
  SparklesIcon,
  ClipboardDocumentListIcon,
  ChatBubbleLeftEllipsisIcon,
  FunnelIcon,
  ChevronDownIcon,
  BookmarkIcon,
  TrashIcon
} from '@heroicons/react/24/outline';

interface MarketplaceScreenProps {
  onNavigate: (screen: string, params?: any) => void;
  guestMode?: boolean;
  onSignInRequired?: () => void;
  /** Bump after create/edit so the browse grid reloads without a manual refresh. */
  refreshKey?: number;
}

const MarketplaceScreen: React.FC<MarketplaceScreenProps> = ({
  onNavigate,
  guestMode = false,
  onSignInRequired,
  refreshKey = 0,
}) => {
  const { currentUser } = useAuthStore();
  const [activeTab, setActiveTab] = useState<'academic' | 'student-life'>('academic');
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [sortBy, setSortBy] = useState<string>('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [minPrice, setMinPrice] = useState<string>('');
  const [maxPrice, setMaxPrice] = useState<string>('');
  const [locationFilter, setLocationFilter] = useState<string>('');
  const [campusIdFilter, setCampusIdFilter] = useState<string>('');
  const [campuses, setCampuses] = useState<MarketplaceCampus[]>([]);
  const ITEMS_PER_PAGE = 20;
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const listingsRequestId = useRef(0);
  const [recentlyViewed, setRecentlyViewed] = useState<MarketplaceListing[]>([]);
  const [missingRecentlyViewed, setMissingRecentlyViewed] = useState<Set<string>>(new Set());
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [showSavedSearches, setShowSavedSearches] = useState(false);
  const [savingSearch, setSavingSearch] = useState(false);
  const [totalListingsCount, setTotalListingsCount] = useState(0);
  const [topCategories, setTopCategories] = useState<Array<{ category: string; total: number; active: number; sold: number }>>([]);
  const [showCategoryPanel, setShowCategoryPanel] = useState(false);
  const [showPulse, setShowPulse] = useState(false);
  const [savedSearchNewMatches, setSavedSearchNewMatches] = useState(0);
  const [rateLimitMessage, setRateLimitMessage] = useState<string | null>(null);
  const [primaryListingsLoaded, setPrimaryListingsLoaded] = useState(false);

  const academicCategories = [
    { id: 'textbook_exchange', name: 'Textbooks', icon: AcademicCapIcon },
    { id: 'pq_bank', name: 'Past Questions', icon: SparklesIcon },
    { id: 'lecture_notes', name: 'Lecture Notes', icon: BriefcaseIcon },
    { id: 'project_thesis', name: 'Projects & Thesis', icon: BriefcaseIcon },
    { id: 'data_collection', name: 'Data Collection', icon: HomeIcon },
    { id: 'equipment_rental', name: 'Lab Equipment', icon: ShoppingBagIcon }
  ];

  const studentLifeCategories = [
    { id: 'accommodation', name: 'Accommodation', icon: HomeIcon },
    { id: 'travel_transport', name: 'Transportation', icon: TruckIcon },
    { id: 'personal_goods', name: 'Personal Goods', icon: SparklesIcon },
    { id: 'aso_ebi', name: 'Fashion', icon: ShoppingBagIcon },
    { id: 'campus_services', name: 'Campus Services', icon: BriefcaseIcon },
    { id: 'events_social', name: 'Events & Social', icon: TicketIcon }
  ];

  const userCampusId = useMemo(() => {
    if (!currentUser?.settings) return null;
    return normalizeUserSettings(currentUser.settings).marketplace?.campus_id || null;
  }, [currentUser?.settings]);

  usePageSeo({
    title: 'Explore Marketplace — Buy and sell across Nigeria | Lantern Study',
    description:
      'Browse marketplace listings across Nigeria for textbooks, notes, accommodation, and student essentials. Arrange pickup or delivery directly with sellers.',
    canonicalUrl: 'https://lanternstudy.com/marketplace',
    ogType: 'website',
  });

  useEffect(() => {
    void fetchMarketplaceCampuses('NG')
      .then((rows) => setCampuses(rows))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const requestId = ++listingsRequestId.current;
    setPage(1);
    setListings([]);
    setHasMore(true);
    setPrimaryListingsLoaded(false);
    setRateLimitMessage(null);
    loadListings(1, true, requestId);
    if (!guestMode) {
      loadFavorites();
    }
  }, [activeTab, searchTerm, selectedCategory, sortBy, sortOrder, minPrice, maxPrice, locationFilter, campusIdFilter, guestMode, refreshKey]);

  useEffect(() => {
    if (!guestMode) {
      loadSavedSearches();
    }
    loadCategoryAnalytics();
  }, [guestMode]);

  useEffect(() => {
    if (guestMode || !primaryListingsLoaded) return;
    void loadRecentlyViewed();
  }, [primaryListingsLoaded, guestMode]);

  const loadCategoryAnalytics = async () => {
    try {
      const analytics = await fetchMarketplaceCategoryAnalytics();
      setTopCategories(analytics.slice(0, 6));
    } catch (error) {
      if (error instanceof RateLimitError) {
        const retrySec = Math.ceil(error.retryAfterMs / 1000);
        setRateLimitMessage(`Marketplace is busy. Category stats will refresh in about ${retrySec}s.`);
        return;
      }
      console.error('Error loading category analytics:', error);
    }
  };

  const loadRecentlyViewed = async () => {
    try {
      const ids = getRecentlyViewed().filter(id => !missingRecentlyViewed.has(id)).slice(0, 10);
      if (ids.length === 0) return;

      // One batch request instead of a detail fetch per listing.
      const results: MarketplaceListing[] = await fetchMarketplaceListingsByIds(ids);
      const foundIds = new Set(results.map((l) => l.id));
      const missingIds = ids.filter((id) => !foundIds.has(id));

      setRecentlyViewed(results.filter((l) => l.status === 'active'));

      if (missingIds.length > 0) {
        setMissingRecentlyViewed((prev) => new Set([...prev, ...missingIds]));
        removeRecentlyViewed(missingIds);
      }
    } catch (error) {
      console.error('Error loading recently viewed:', error);
    }
  };

  const loadSavedSearches = async () => {
    try {
      const data = await fetchSavedSearches();
      setSavedSearches(data);
      const counts = await Promise.all(
        data.map((search) =>
          checkSavedSearchMatches(search.id)
            .then((result) => result.count || 0)
            .catch(() => 0)
        )
      );
      setSavedSearchNewMatches(counts.reduce((sum, count) => sum + count, 0));
    } catch (error) {
      console.error('Error loading saved searches:', error);
    }
  };

  const handleSaveCurrentSearch = async () => {
    const filters = buildMarketplaceSavedSearchFilters({
      searchTerm,
      selectedCategory,
      minPrice,
      maxPrice,
      locationFilter,
      campusIdFilter,
      sortBy,
      sortOrder,
    });

    if (Object.keys(filters).length === 0) {
      useToastStore.getState().showToast('Set some search criteria or filters first.', 'info');
      return;
    }

    setSavingSearch(true);
    try {
      await saveSearch(filters);
      await loadSavedSearches();
      useToastStore.getState().showToast('Search saved! You\'ll be notified when new matching listings appear.', 'success');
    } catch (error) {
      console.error('Error saving search:', error);
      useToastStore.getState().showToast('Failed to save search', 'error');
    } finally {
      setSavingSearch(false);
    }
  };

  const handleDeleteSavedSearch = async (id: string) => {
    try {
      await deleteSavedSearch(id);
      setSavedSearches(prev => prev.filter(s => s.id !== id));
    } catch (error) {
      console.error('Error deleting saved search:', error);
    }
  };

  const handleApplySavedSearch = (search: SavedSearch) => {
    const restored = restoreMarketplaceSavedSearchFilters(
      search.filters as MarketplaceSavedSearchFilters
    );
    setSearchTerm(restored.searchTerm);
    setSelectedCategory(restored.selectedCategory);
    setMinPrice(restored.minPrice);
    setMaxPrice(restored.maxPrice);
    setLocationFilter(restored.locationFilter);
    setCampusIdFilter(restored.campusIdFilter);
    setSortBy(restored.sortBy);
    setSortOrder(restored.sortOrder);
    setShowSavedSearches(false);
  };

  const loadFavorites = async () => {
    try {
      const favoritesData = await fetchMyFavorites();
      const favoriteIds = new Set(favoritesData.map((f: any) => f.listing_id));
      setFavorites(favoriteIds);
    } catch (error) {
      console.error('Error loading favorites:', error);
    }
  };

  const loadListings = async (pageNum: number = 1, reset: boolean = false, requestId?: number) => {
    if (reset) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }
    
    const timeoutId = setTimeout(() => {
      setLoading(false);
      setLoadingMore(false);
    }, 5000);
    
    try {
      const filters: any = {
        page: pageNum,
        limit: ITEMS_PER_PAGE,
        sortBy,
        sortOrder,
      };

      if (searchTerm) filters.search = searchTerm;
      if (selectedCategory) filters.category = selectedCategory;
      if (minPrice) filters.minPrice = parseFloat(minPrice);
      if (maxPrice) filters.maxPrice = parseFloat(maxPrice);
      if (locationFilter) filters.location = locationFilter;
      if (campusIdFilter) filters.campus_id = campusIdFilter;
      filters.country_code = 'NG';
      filters.responseProfile = 'compact';

      // Tab filtering happens server-side so pages come back full.
      if (!selectedCategory) {
        filters.categories = (activeTab === 'academic' ? academicCategories : studentLifeCategories).map(c => c.id);
        filters.includeCustom = true;
      }

      const { data, pagination } = await fetchMarketplaceListingsPage(filters);
      if (requestId !== undefined && requestId !== listingsRequestId.current) return;
      setTotalListingsCount(pagination?.total || 0);

      const filteredData = data || [];
      
      if (reset) {
        setListings(filteredData);
      } else {
        setListings(prev => [...prev, ...filteredData]);
      }

      if (reset && searchTerm.trim()) {
        void import('../services/productAnalytics').then(({ trackMarketplaceSearch }) => {
          trackMarketplaceSearch({
            query: searchTerm,
            resultCount: pagination?.total ?? filteredData.length,
            category: selectedCategory || undefined,
            // Saved campus is analytics context only; the explicit filter alone affects visibility.
            campus: userCampusId || undefined,
          });
        });
      }
      if (reset && filteredData.length > 0) {
        void import('../services/productAnalytics').then(({ trackListingImpression }) => {
          filteredData.slice(0, 20).forEach((listing, index) => {
            trackListingImpression(listing.id, index, searchTerm ? 'search' : 'browse');
          });
        });
      }
      
      setHasMore((pageNum * ITEMS_PER_PAGE) < (pagination?.total || 0));
      setPage(pageNum);
      setRateLimitMessage(null);
      if (reset) setPrimaryListingsLoaded(true);
    } catch (error) {
      if (error instanceof RateLimitError) {
        const retrySec = Math.ceil(error.retryAfterMs / 1000);
        setRateLimitMessage(
          `You're browsing too quickly. Listings will be available again in about ${retrySec} seconds.`
        );
        if (reset) setPrimaryListingsLoaded(true);
      } else {
        console.error('Error loading listings:', error);
        if (reset) setListings([]);
        if (reset) setPrimaryListingsLoaded(true);
      }
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const handleLoadMore = () => {
    if (!loadingMore && hasMore) {
      loadListings(page + 1, false, listingsRequestId.current);
    }
  };

  const handleSearchChange = (value: string) => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setSearchTerm(value);
    }, 300);
  };

  const clearFilters = () => {
    setMinPrice('');
    setMaxPrice('');
    setLocationFilter('');
    setCampusIdFilter('');
    setSortBy('created_at');
    setSortOrder('desc');
    setShowFilters(false);
  };

  const activeFilterCount =
    [minPrice, maxPrice, locationFilter, campusIdFilter].filter(Boolean).length +
    (sortBy !== 'created_at' ? 1 : 0);

  const handleCreateListing = () => {
    onNavigate('CreateMarketplaceListing', { category: activeTab });
  };

  const handleListingClick = (listing: MarketplaceListing) => {
    const isOwnListing = listing.user_id === currentUser?.id || listing.seller_id === currentUser?.id;
    if (isOwnListing) {
      onNavigate('MyListings');
    } else {
      onNavigate('MarketplaceListingDetail', { listingId: listing.id });
    }
  };

  const toggleFavorite = async (listingId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const isFavorited = favorites.has(listingId);
    
    // Optimistic update
    setFavorites(prev => {
      const newFavorites = new Set(prev);
      if (isFavorited) {
        newFavorites.delete(listingId);
      } else {
        newFavorites.add(listingId);
      }
      return newFavorites;
    });

    try {
      if (isFavorited) {
        await removeFromFavorites(listingId);
      } else {
        await addToFavorites(listingId);
      }
    } catch (error) {
      console.error('Error toggling favorite:', error);
      // Revert on error
      setFavorites(prev => {
        const newFavorites = new Set(prev);
        if (isFavorited) {
          newFavorites.add(listingId);
        } else {
          newFavorites.delete(listingId);
        }
        return newFavorites;
      });
    }
  };

  const allCategories = [...academicCategories, ...studentLifeCategories];

  const getCategoryIcon = (categoryId: string) => {
    const category = allCategories.find(cat => cat.id === categoryId);
    return category ? category.icon : SparklesIcon;
  };

  const getCategoryName = (categoryId: string) => {
    if (categoryId.startsWith('custom:')) return categoryId.replace('custom:', '');
    const category = allCategories.find(cat => cat.id === categoryId);
    return category ? category.name : categoryId;
  };

  const selectCategory = (categoryId: string) => {
    setSelectedCategory(categoryId);
    setShowCategoryPanel(false);
  };

  const categoryChipClass = (isSelected: boolean) =>
    `lg:snap-start lg:flex-shrink-0 lg:min-w-[max-content] min-h-[30px] sm:min-h-[34px] px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-lg text-[11px] sm:text-xs font-medium transition-colors duration-150 flex items-center justify-center lg:justify-start gap-1 touch-manipulation ${
      isSelected
        ? 'bg-lantern-primary text-white shadow-sm'
        : 'bg-lantern-background-secondary text-lantern-text-secondary hover:bg-lantern-border/50'
    }`;

  const activeCategoryLabel = selectedCategory ? getCategoryName(selectedCategory) : 'All categories';

  const renderCategoryChips = (categories: typeof academicCategories) => (
    <div className={`px-3 sm:px-4 md:px-6 md:py-2 ${showCategoryPanel ? 'py-1' : 'py-0'}`}>
      <div
        role="radiogroup"
        aria-label="Marketplace category"
        className={`gap-1.5 lg:gap-2 lg:overflow-x-auto lg:pb-1 lg:scrollbar-none lg:snap-x lg:snap-mandatory touch-pan-x ${showCategoryPanel ? 'grid grid-cols-3 sm:grid-cols-4' : 'hidden'} md:flex md:items-stretch`}
      >
        <button
          type="button"
          role="radio"
          aria-checked={selectedCategory === ''}
          onClick={() => selectCategory('')}
          className={categoryChipClass(selectedCategory === '')}
        >
          All
        </button>
        {categories.map(category => {
          const IconComponent = category.icon;
          const isSelected = selectedCategory === category.id;
          return (
            <button
              key={category.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => selectCategory(category.id)}
              className={categoryChipClass(isSelected)}
            >
              <IconComponent className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" aria-hidden="true" />
              <span className="text-center lg:text-left leading-tight truncate">{category.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const marketplaceListingsBody = (
    <>
      {savedSearches.length > 0 && (
        <div className="mb-5">
          <button
            type="button"
            onClick={() => setShowSavedSearches(!showSavedSearches)}
            className="text-sm font-semibold text-lantern-text mb-2 flex items-center gap-1.5 hover:text-lantern-primary transition-colors"
          >
            <BookmarkIcon className="w-4 h-4" />
            Saved Searches ({savedSearches.length})
            {savedSearchNewMatches > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-lantern-primary text-white text-[10px]">
                {savedSearchNewMatches} new
              </span>
            )}
            <ChevronDownIcon className={`w-3.5 h-3.5 transition-transform ${showSavedSearches ? 'rotate-180' : ''}`} />
          </button>
          {showSavedSearches && (
            <div className="flex flex-wrap gap-2">
              {savedSearches.map(search => (
                <div
                  key={search.id}
                  className="inline-flex items-center gap-2 bg-lantern-surface px-3 py-1.5 rounded-lg ring-1 ring-lantern-border text-sm group"
                >
                  <button
                    type="button"
                    onClick={() => handleApplySavedSearch(search)}
                    className="text-lantern-text hover:text-lantern-primary font-medium truncate max-w-[200px]"
                  >
                    {search.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteSavedSearch(search.id)}
                    className="text-lantern-text-tertiary hover:text-lantern-error sm:opacity-0 sm:group-hover:opacity-100 transition-all p-1 -m-1 touch-manipulation"
                    aria-label="Delete saved search"
                  >
                    <TrashIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {recentlyViewed.length > 0 && !searchTerm && !selectedCategory && !minPrice && !maxPrice && !locationFilter && !campusIdFilter && (
        <div className="mb-4">
          <h3 className="text-xs sm:text-sm font-semibold text-lantern-text mb-2 flex items-center gap-1.5">
            <ClockIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            Recently Viewed
          </h3>
          <div className="max-w-full overflow-x-auto scrollbar-none">
            <div className="flex gap-3 pb-2 w-max pr-2">
              {recentlyViewed.map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleListingClick(item)}
                  className="flex-shrink-0 w-28 sm:w-36 md:w-40 bg-lantern-surface rounded-lg sm:rounded-xl overflow-hidden ring-1 ring-lantern-border hover:ring-lantern-primary/30 transition-all text-left group"
                >
                  <div className="aspect-[4/3] bg-lantern-background-secondary overflow-hidden">
                    {item.images && item.images.length > 0 ? (
                      <img src={item.images[0]} alt={item.title} className="w-full h-full max-w-full object-cover group-hover:scale-105 transition-transform duration-300" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ShoppingBagIcon className="w-6 h-6 text-lantern-text-tertiary" />
                      </div>
                    )}
                  </div>
                  <div className="p-2">
                    <p className="text-xs font-semibold text-lantern-text line-clamp-1 group-hover:text-lantern-primary transition-colors">{item.title}</p>
                    <p className="text-sm font-bold text-lantern-primary">{item.price ? `₦${item.price.toLocaleString()}` : 'Free'}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {rateLimitMessage && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          {rateLimitMessage}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 w-full py-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="rounded-xl border border-lantern-border overflow-hidden">
              <div className="h-40 animate-pulse bg-lantern-background-secondary" />
              <div className="p-3 space-y-2">
                <div className="h-4 w-2/3 animate-pulse bg-lantern-background-secondary rounded" />
                <div className="h-3 w-1/3 animate-pulse bg-lantern-background-secondary rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : listings.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-20 h-20 bg-lantern-background-secondary rounded-2xl flex items-center justify-center mb-5">
            <ShoppingBagIcon className="w-10 h-10 text-lantern-text-tertiary" />
          </div>
          <h3 className="text-lg font-semibold text-lantern-text mb-2">
            No listings found
          </h3>
          <p className="text-sm text-lantern-text-secondary mb-6 max-w-sm">
            {searchTerm || selectedCategory
              ? "Try adjusting your search or filters to find what you're looking for."
              : "Be the first to create a listing in this category!"
            }
          </p>
          <button
            type="button"
            onClick={handleCreateListing}
            className="px-5 py-2.5 bg-lantern-primary hover:bg-lantern-primary-dark text-white rounded-xl font-semibold flex items-center transition-colors duration-150 text-sm shadow-sm"
          >
            <PlusIcon className="w-4 h-4 mr-2" />
            Create First Listing
          </button>
        </div>
      ) : (
        <div className="grid w-full max-w-full grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-4 md:gap-5">
          {listings.map(listing => {
            const IconComponent = getCategoryIcon(listing.category);
            return (
              <ListingCard
                key={listing.id}
                listing={listing}
                isFavorite={favorites.has(listing.id)}
                isOwner={listing.user_id === currentUser?.id || listing.seller_id === currentUser?.id}
                categoryName={getCategoryName(listing.category)}
                CategoryIcon={IconComponent}
                onPress={() => handleListingClick(listing)}
                onToggleFavorite={e => toggleFavorite(listing.id, e)}
              />
            );
          })}
        </div>
      )}

      {!loading && listings.length > 0 && hasMore && (
        <div className="flex justify-center mt-6">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="px-6 py-2.5 bg-lantern-surface text-lantern-primary rounded-xl font-semibold ring-1 ring-lantern-border hover:bg-lantern-primary-background transition-colors duration-150 text-sm shadow-sm flex items-center gap-2"
          >
            {loadingMore ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-lantern-primary/30 border-t-lantern-primary"></div>
                Loading...
              </>
            ) : (
              <>
                <ChevronDownIcon className="w-4 h-4" />
                Load More
              </>
            )}
          </button>
        </div>
      )}

      {!loading && listings.length > 0 && !hasMore && (
        <p className="text-center text-xs text-lantern-text-tertiary mt-6">
          You've reached the end of the listings
        </p>
      )}
    </>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 w-full max-w-full overflow-hidden bg-lantern-background">
      <div className="shrink-0 px-3 sm:px-4 md:px-6 pt-2">
        <MarketplaceComplianceBanner />
      </div>
      <div className="shrink-0 px-3 sm:px-4 md:px-6 pt-2 pb-2">
        <FeatureHero
          title="Explore"
          subtitle="Discover academic resources and student essentials across Nigeria"
          accentColor={featureAccents.marketplace}
          icon={<ShoppingBagIcon className="w-6 h-6" style={{ color: featureAccents.marketplace }} />}
          actions={
            guestMode ? (
              <button
                type="button"
                onClick={() => onSignInRequired?.()}
                className="h-9 px-4 bg-lantern-primary text-white hover:bg-lantern-primary-dark rounded-lantern font-semibold text-sm transition-colors"
              >
                Sign in to buy or sell
              </button>
            ) : (
              <>
                <button
                  onClick={() => onNavigate('MarketplaceOrders')}
                  aria-label="Orders"
                  className="h-9 px-3 bg-lantern-surface border border-lantern-border text-lantern-text rounded-lantern font-medium text-xs sm:text-sm hover:border-lantern-primary/30 transition-colors"
                >
                  Orders
                </button>
                <button
                  onClick={() => onNavigate('MyListings')}
                  aria-label="My listings"
                  className="h-9 px-3 bg-lantern-surface border border-lantern-border text-lantern-text rounded-lantern font-medium text-xs sm:text-sm hover:border-lantern-primary/30 transition-colors"
                >
                  Listings
                </button>
                <button
                  onClick={() => onNavigate('MarketplaceInquiries')}
                  aria-label="Inquiries"
                  className="h-9 px-3 bg-lantern-surface border border-lantern-border text-lantern-text rounded-lantern font-medium text-xs sm:text-sm hover:border-lantern-primary/30 transition-colors"
                >
                  Inquiries
                </button>
                <button
                  onClick={handleCreateListing}
                  aria-label="Create listing"
                  className="h-9 px-3 bg-lantern-primary text-white hover:bg-lantern-primary-dark rounded-lantern font-semibold text-xs sm:text-sm transition-colors"
                >
                  <PlusIcon className="w-4 h-4 inline mr-1" />
                  Sell
                </button>
              </>
            )
          }
        >
          <div className="flex gap-1.5 sm:gap-2 min-w-0 max-w-full">
            <div className="flex-1 min-w-0 w-full relative">
              <MagnifyingGlassIcon className="absolute left-2.5 sm:left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-lantern-text-tertiary pointer-events-none" />
              <input
                type="text"
                aria-label={activeTab === 'academic' ? 'Search textbooks and notes' : 'Search student essentials'}
                placeholder={activeTab === 'academic' ? 'Search textbooks, notes…' : 'Search essentials…'}
                defaultValue={searchTerm}
                onChange={e => handleSearchChange(e.target.value)}
                className="w-full min-w-0 max-w-full box-border pl-8 sm:pl-10 pr-3 py-2 sm:py-2.5 rounded-lantern bg-lantern-surface border border-lantern-border text-lantern-text placeholder-lantern-text-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary text-sm shadow-lantern"
              />
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              aria-label="Toggle filters"
              aria-expanded={showFilters}
              className={`shrink-0 h-9 min-w-[36px] px-3 rounded-lantern flex items-center justify-center gap-1 font-medium text-xs border transition-colors duration-150 ${
                showFilters || activeFilterCount > 0
                  ? 'bg-lantern-primary text-white border-lantern-primary'
                  : 'bg-lantern-surface text-lantern-text-secondary border-lantern-border hover:border-lantern-primary/30'
              }`}
            >
              <FunnelIcon className="w-4 h-4" />
              <span className="hidden sm:inline">Filters</span>
              {activeFilterCount > 0 && (
                <span className="ml-1 w-4 h-4 bg-lantern-surface text-lantern-primary text-[10px] items-center justify-center rounded-full hidden sm:flex">
                  {activeFilterCount}
                </span>
              )}
            </button>
            <button
              onClick={handleSaveCurrentSearch}
              disabled={savingSearch}
              aria-label="Save current search"
              className="shrink-0 h-9 min-w-[36px] px-3 rounded-lantern flex items-center justify-center border border-lantern-border bg-lantern-surface text-lantern-text-secondary hover:border-lantern-primary/30 disabled:opacity-50 transition-colors"
              title="Save current search"
            >
              <BookmarkIcon className="w-4 h-4" />
            </button>
          </div>

          {showFilters && (
            <div className="mt-3">
              <MarketplaceFilterPanel
                minPrice={minPrice}
                maxPrice={maxPrice}
                campusIdFilter={campusIdFilter}
                locationFilter={locationFilter}
                sortBy={sortBy}
                sortOrder={sortOrder}
                campuses={campuses}
                activeFilterCount={activeFilterCount}
                onMinPriceChange={setMinPrice}
                onMaxPriceChange={setMaxPrice}
                onCampusChange={setCampusIdFilter}
                onLocationChange={setLocationFilter}
                onSortChange={(field, order) => {
                  setSortBy(field);
                  setSortOrder(order);
                }}
                onClearFilters={clearFilters}
                variant="hero"
              />
            </div>
          )}
        </FeatureHero>
      </div>

      {/* Marketplace Intelligence — collapsed on mobile */}
      {topCategories.length > 0 && (
        <div className="shrink-0 max-w-full bg-lantern-surface border-b border-lantern-border px-3 sm:px-4 md:px-6 py-1.5 sm:py-3">
          <button
            type="button"
            onClick={() => setShowPulse(v => !v)}
            className="md:hidden w-full flex items-center justify-between gap-2 py-1 text-left"
            aria-expanded={showPulse}
          >
            <span className="text-[11px] sm:text-xs text-lantern-text-secondary truncate">
              {totalListingsCount.toLocaleString()} listings · Marketplace pulse
            </span>
            <ChevronDownIcon className={`w-4 h-4 shrink-0 text-lantern-text-tertiary transition-transform ${showPulse ? 'rotate-180' : ''}`} />
          </button>
          <div className={`${showPulse ? 'block' : 'hidden'} md:block mt-2 md:mt-0`}>
            <div className="hidden md:flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 mb-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-lantern-text-tertiary">Marketplace Pulse</p>
                <p className="text-xs sm:text-sm text-lantern-text-secondary">
                  {totalListingsCount.toLocaleString()} listings match your filters
                </p>
              </div>
              <div className="hidden lg:flex items-center gap-2 text-xs text-lantern-text-tertiary shrink-0">
                <ClockIcon className="w-4 h-4" />
                Updated from live category analytics
              </div>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-3 lg:grid-cols-6 gap-1.5 sm:gap-2">
              {topCategories.map((item) => (
                <div key={item.category} className="min-w-0 rounded-md sm:rounded-lg border border-lantern-border px-2 py-1.5 sm:px-3 sm:py-2 bg-lantern-background-secondary">
                  <p className="text-[10px] sm:text-xs font-semibold text-lantern-text truncate">
                    {getCategoryName(item.category)}
                  </p>
                  <p className="text-xs sm:text-sm font-bold text-lantern-primary">{item.total}</p>
                  <p className="text-[9px] sm:text-[11px] text-lantern-text-tertiary truncate">{item.active} active</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          setActiveTab(value as 'academic' | 'student-life');
          setSelectedCategory('');
          setShowCategoryPanel(false);
        }}
        aria-label="Marketplace categories"
        className="flex-1 flex flex-col min-h-0 min-w-0 max-w-full"
      >
        <div className="shrink-0 max-w-full bg-lantern-surface border-b border-lantern-border">
          <div className="sticky top-0 z-20 bg-lantern-surface shadow-sm md:shadow-none px-3 sm:px-4 md:px-6 max-w-full">
            <div className="flex items-center gap-2 border-b border-lantern-border/60">
              <TabList className="!border-0 flex-1 min-w-0">
                <Tab
                  value="academic"
                  index={0}
                  icon={<AcademicCapIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
                  className="flex-1 sm:flex-initial !rounded-none !px-2 sm:!px-5 !py-2 sm:!py-2.5 !text-xs sm:!text-sm border-b-2 border-transparent"
                >
                  Academic
                </Tab>
                <Tab
                  value="student-life"
                  index={1}
                  icon={<BriefcaseIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
                  className="flex-1 sm:flex-initial !rounded-none !px-2 sm:!px-5 !py-2 sm:!py-2.5 !text-xs sm:!text-sm border-b-2 border-transparent"
                >
                  Student Life
                </Tab>
              </TabList>
              <button
                type="button"
                onClick={() => setShowCategoryPanel(v => !v)}
                aria-expanded={showCategoryPanel}
                className="md:hidden shrink-0 flex items-center gap-1 max-w-[42%] px-2 py-1 rounded-md bg-lantern-background-secondary text-[10px] font-medium text-lantern-text-secondary"
              >
                <span className="truncate">{activeCategoryLabel}</span>
                <ChevronDownIcon className={`w-3.5 h-3.5 shrink-0 transition-transform ${showCategoryPanel ? 'rotate-180' : ''}`} />
              </button>
            </div>
          </div>
        </div>

        <TabPanel value="academic" className="flex-1 flex flex-col min-h-0 min-w-0">
          {renderCategoryChips(academicCategories)}
          <div className="flex-1 min-h-0 min-w-0 max-w-full p-2 sm:p-4 md:p-6 pb-20 md:pb-6 overflow-y-auto overflow-x-hidden overscroll-contain box-border">
            {marketplaceListingsBody}
          </div>
        </TabPanel>

        <TabPanel value="student-life" className="flex-1 flex flex-col min-h-0 min-w-0">
          {renderCategoryChips(studentLifeCategories)}
          <div className="flex-1 min-h-0 min-w-0 max-w-full p-2 sm:p-4 md:p-6 pb-20 md:pb-6 overflow-y-auto overflow-x-hidden overscroll-contain box-border">
            {marketplaceListingsBody}
          </div>
        </TabPanel>
      </Tabs>
    </div>
  );
};

export default MarketplaceScreen;