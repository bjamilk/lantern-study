import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useToastStore } from '../stores/toastStore';
import {
  fetchMyFavorites, addToFavorites, removeFromFavorites,
  getRecentlyViewed, removeRecentlyViewed, fetchMarketplaceListingsByIds,
  fetchSavedSearches, saveSearch, deleteSavedSearch, checkSavedSearchMatches,
  fetchMarketplaceListingsPage, fetchMarketplaceCategoryAnalytics, fetchMarketplaceCampuses,
  fetchMarketplaceShops,
} from '../services/supabase';
import { RateLimitError } from '@lantern/shared';
import { normalizeUserSettings } from '@lantern/shared/settings';
import type { MarketplaceCampus } from '@lantern/shared';
import { useAuthStore } from '../stores/authStore';
import { MarketplaceListing, MarketplaceShopCard, SavedSearch } from '../types';
import { normalizeStorageUrl } from '../utils/storageUrl';
import { usePageSeo } from '../hooks/usePageSeo';
import MarketplaceComplianceBanner from './marketplace/MarketplaceComplianceBanner';
import { ListingCard } from './marketplace/ListingCard';
import { MarketplaceFilterPanel } from './marketplace/MarketplaceFilterPanel';
import { MarketplaceWorkspaceBar } from './marketplace/MarketplaceWorkspaceBar';
import {
  buildMarketplaceSavedSearchFilters,
  restoreMarketplaceSavedSearchFilters,
  type MarketplaceSavedSearchFilters,
} from './marketplace/marketplaceSearchFilters';
import { Tabs, TabList, Tab, TabPanel } from './ui';
import {
  MagnifyingGlassIcon,
  ClockIcon,
  AcademicCapIcon,
  BriefcaseIcon,
  ShoppingBagIcon,
  HomeIcon,
  TruckIcon,
  TicketIcon,
  SparklesIcon,
  FunnelIcon,
  ChevronDownIcon,
  BookmarkIcon,
  TrashIcon,
  PlusIcon,
  BuildingStorefrontIcon,
  StarIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';

interface MarketplaceScreenProps {
  onNavigate: (screen: string, params?: any) => void;
  guestMode?: boolean;
  onSignInRequired?: () => void;
  /** Bump after create/edit so the browse grid reloads without a manual refresh. */
  refreshKey?: number;
}

const RECENT_SEARCHES_KEY = 'lantern_marketplace_recent_searches';
const MAX_RECENT_SEARCHES = 8;

/** Local-only recent queries shown as one-tap chips; mirrors mobile. */
const readRecentSearches = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) || '[]');
  } catch {
    return [];
  }
};

const writeRecentSearch = (query: string): string[] => {
  const trimmed = query.trim();
  const current = readRecentSearches();
  if (trimmed.length < 2) return current;
  const next = [
    trimmed,
    ...current.filter(q => q.toLowerCase() !== trimmed.toLowerCase()),
  ].slice(0, MAX_RECENT_SEARCHES);
  try {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  } catch {
    // non-critical
  }
  return next;
};

const MarketplaceScreen: React.FC<MarketplaceScreenProps> = ({
  onNavigate,
  guestMode = false,
  onSignInRequired,
  refreshKey = 0,
}) => {
  const { currentUser } = useAuthStore();
  const [activeTab, setActiveTab] = useState<'academic' | 'student-life' | 'shops'>('academic');
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [shops, setShops] = useState<MarketplaceShopCard[]>([]);
  const [shopsLoading, setShopsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [recentSearches, setRecentSearches] = useState<string[]>(() => readRecentSearches());
  // The search input is uncontrolled (defaultValue); bump this to re-mount it
  // when a recent-search chip fills it programmatically.
  const [searchInputKey, setSearchInputKey] = useState(0);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [sortBy, setSortBy] = useState<string>('trending');
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
  const [loadError, setLoadError] = useState<string | null>(null);
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
    title: 'Explore — Buy, sell, and find work across Nigeria | Lantern Study',
    description:
      'Browse marketplace listings and job opportunities across Nigeria — textbooks, notes, accommodation, student essentials, internships, and part-time work.',
    canonicalUrl: 'https://lanternstudy.com/marketplace',
    ogType: 'website',
  });

  useEffect(() => {
    void fetchMarketplaceCampuses('NG')
      .then((rows) => setCampuses(rows))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (activeTab === 'shops') {
      setLoading(false);
      setPrimaryListingsLoaded(true);
      return;
    }
    const requestId = ++listingsRequestId.current;
    setPage(1);
    setListings([]);
    setHasMore(true);
    setPrimaryListingsLoaded(false);
    setRateLimitMessage(null);
    setLoadError(null);
    loadListings(1, true, requestId);
    if (!guestMode) {
      loadFavorites();
    }
  }, [activeTab, searchTerm, selectedCategory, sortBy, sortOrder, minPrice, maxPrice, locationFilter, campusIdFilter, guestMode, refreshKey]);

  useEffect(() => {
    if (activeTab !== 'shops') return;
    let cancelled = false;
    setShopsLoading(true);
    void fetchMarketplaceShops({
      campus: campusIdFilter || userCampusId || undefined,
      q: searchTerm.trim() || undefined,
      page: 1,
      limit: 48,
    })
      .then((result) => {
        if (!cancelled) setShops(result.shops);
      })
      .catch(() => {
        if (!cancelled) setShops([]);
      })
      .finally(() => {
        if (!cancelled) setShopsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, searchTerm, campusIdFilter, userCampusId, refreshKey]);

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
      // Badge poll only — peek so it does NOT bump last_checked_at, which is the
      // alerts job's "since" cursor. Consuming it here would silently kill
      // saved-search notifications every time Explore mounts.
      const counts = await Promise.all(
        data.map((search) =>
          checkSavedSearchMatches(search.id, true)
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
        if (filteredData.length > 0) {
          setRecentSearches(writeRecentSearch(searchTerm));
        }
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
      setLoadError(null);
      if (reset) setPrimaryListingsLoaded(true);
    } catch (error) {
      if (requestId !== undefined && requestId !== listingsRequestId.current) return;
      if (error instanceof RateLimitError) {
        const retrySec = Math.ceil(error.retryAfterMs / 1000);
        setRateLimitMessage(
          `You're browsing too quickly. Listings will be available again in about ${retrySec} seconds.`
        );
        if (reset) setPrimaryListingsLoaded(true);
      } else {
        console.error('Error loading listings:', error);
        // Surface a distinct error state with Retry instead of a false "empty".
        // Keep any previously-loaded listings on a refresh failure rather than
        // blanking the grid.
        setLoadError(
          error instanceof Error && error.message
            ? error.message
            : 'Something went wrong while loading listings.'
        );
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

  const retryLoadListings = () => {
    const requestId = ++listingsRequestId.current;
    setRateLimitMessage(null);
    setLoadError(null);
    loadListings(1, true, requestId);
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
    setSortBy('trending');
    setSortOrder('desc');
    setShowFilters(false);
  };

  const activeFilterCount =
    [minPrice, maxPrice, locationFilter, campusIdFilter].filter(Boolean).length +
    (sortBy !== 'trending' || sortOrder !== 'desc' ? 1 : 0);

  const handleCreateListing = () => {
    onNavigate('CreateMarketplaceListing', { category: activeTab });
  };

  const handleListingClick = (listing: MarketplaceListing) => {
    // Guard on the viewer first: in guest mode currentUser?.id is undefined,
    // and a listing payload without user_id made this `undefined === undefined`
    // — every guest tap bounced to sign-in instead of the public listing page.
    const isOwnListing =
      !!currentUser?.id &&
      (listing.user_id === currentUser.id || listing.seller_id === currentUser.id);
    if (isOwnListing) {
      onNavigate('MyListings');
    } else {
      onNavigate('MarketplaceListingDetail', { listingId: listing.id });
    }
  };

  const toggleFavorite = async (listingId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    // Guests can't have favorites — their POST 401s and silently no-ops. Prompt
    // sign-in before the optimistic update instead of faking a saved heart.
    if (guestMode) {
      onSignInRequired?.();
      return;
    }
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
      useToastStore.getState().showToast('Could not update favorites. Please try again.', 'error');
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
    `shrink-0 min-w-0 md:min-w-[max-content] min-h-[44px] sm:min-h-[34px] px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-lg text-[11px] sm:text-xs font-medium transition-colors duration-150 flex items-center justify-center md:justify-start gap-1 touch-manipulation ${
      isSelected
        ? 'bg-lantern-primary text-white shadow-sm'
        : 'bg-lantern-background-secondary text-lantern-text-secondary hover:bg-lantern-border/50'
    }`;

  const activeCategoryLabel = selectedCategory ? getCategoryName(selectedCategory) : 'All categories';

  const renderCategoryChips = (categories: typeof academicCategories) => (
    <div className={`px-3 sm:px-4 md:px-6 md:py-2 min-w-0 max-w-full ${showCategoryPanel ? 'py-1' : 'py-0'}`}>
      <div
        role="radiogroup"
        aria-label="Marketplace category"
        className={`gap-1.5 md:gap-2 overflow-x-auto pb-1 scrollbar-none touch-pan-x min-w-0 max-w-full ${showCategoryPanel ? 'grid grid-cols-3 sm:grid-cols-4' : 'hidden'} md:flex md:items-stretch`}
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
              <span className="text-center md:text-left leading-tight truncate">{category.name}</span>
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

      {/* Keep the last-loaded grid visible but flag that the refresh failed. */}
      {loadError && listings.length > 0 && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-lantern-error/30 bg-lantern-error/5 px-4 py-3 text-sm text-lantern-error">
          <span className="min-w-0">Couldn't refresh listings. {loadError}</span>
          <button
            type="button"
            onClick={retryLoadListings}
            className="shrink-0 inline-flex items-center gap-1 font-semibold underline hover:no-underline"
          >
            <ArrowPathIcon className="w-3.5 h-3.5" />
            Retry
          </button>
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
      ) : listings.length === 0 && loadError ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-20 h-20 bg-lantern-error/10 rounded-2xl flex items-center justify-center mb-5">
            <ExclamationTriangleIcon className="w-10 h-10 text-lantern-error" />
          </div>
          <h3 className="text-lg font-semibold text-lantern-text mb-2">
            Couldn't load listings
          </h3>
          <p className="text-sm text-lantern-text-secondary mb-6 max-w-sm">
            {loadError}
          </p>
          <button
            type="button"
            onClick={retryLoadListings}
            className="px-5 py-2.5 bg-lantern-primary hover:bg-lantern-primary-dark text-white rounded-xl font-semibold flex items-center transition-colors duration-150 text-sm shadow-sm"
          >
            <ArrowPathIcon className="w-4 h-4 mr-2" />
            Retry
          </button>
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
                isOwner={
                  // Guard on the viewer first: in guest mode currentUser?.id is
                  // undefined, and a listing payload without user_id made this
                  // `undefined === undefined` — every card said "Your Listing".
                  !!currentUser?.id &&
                  (listing.user_id === currentUser.id || listing.seller_id === currentUser.id)
                }
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
      <div className="shrink-0 px-3 sm:px-4 md:px-6 pt-2 space-y-2">
        <MarketplaceComplianceBanner />

        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-lantern-text truncate">Explore</h1>
            <p className="text-[11px] sm:text-xs text-lantern-text-secondary truncate">
              Buy, sell, and find work across Nigeria
            </p>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Jobs is a full sibling surface, not a marketplace sub-feature —
                give it equal billing so job seekers can actually find it. */}
            <div
              role="group"
              aria-label="Explore section"
              className="inline-flex rounded-lg border border-lantern-border bg-lantern-surface p-0.5"
            >
              <span
                aria-current="page"
                className="inline-flex items-center gap-1 rounded-md bg-lantern-primary px-2.5 sm:px-3 py-1.5 text-[11px] sm:text-xs font-semibold text-white shadow-sm"
              >
                <ShoppingBagIcon className="w-3.5 h-3.5" aria-hidden />
                Goods
              </span>
              <button
                type="button"
                onClick={() => onNavigate('MarketplaceJobs')}
                className="inline-flex items-center gap-1 rounded-md px-2.5 sm:px-3 py-1.5 text-[11px] sm:text-xs font-semibold text-lantern-text-secondary hover:text-lantern-text transition-colors"
              >
                <BriefcaseIcon className="w-3.5 h-3.5" aria-hidden />
                Jobs
              </button>
            </div>
            {topCategories.length > 0 ? (
              <button
                type="button"
                onClick={() => setShowPulse(v => !v)}
                aria-expanded={showPulse}
                className="shrink-0 inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-lantern-border bg-lantern-surface text-[11px] sm:text-xs font-medium text-lantern-text-secondary hover:border-lantern-primary/30 transition-colors"
              >
                Pulse
                <ChevronDownIcon className={`w-3.5 h-3.5 transition-transform ${showPulse ? 'rotate-180' : ''}`} />
              </button>
            ) : null}
          </div>
        </div>

        <MarketplaceWorkspaceBar
          active="browse"
          onNavigate={onNavigate}
          onSell={guestMode ? undefined : handleCreateListing}
          guestMode={guestMode}
          onSignInRequired={onSignInRequired}
          primaryLabel="Sell"
          showFavorites={!guestMode}
        />

        <div className="flex gap-1.5 sm:gap-2 min-w-0 max-w-full">
          <div className="flex-1 min-w-0 w-full relative">
            <MagnifyingGlassIcon className="absolute left-2.5 sm:left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-lantern-text-tertiary pointer-events-none" />
            <input
              key={searchInputKey}
              type="text"
              aria-label={activeTab === 'academic' ? 'Search textbooks and notes' : 'Search student essentials'}
              placeholder={activeTab === 'academic' ? 'Search textbooks, notes…' : 'Search essentials…'}
              defaultValue={searchTerm}
              onChange={e => handleSearchChange(e.target.value)}
              className="w-full min-w-0 max-w-full box-border pl-8 sm:pl-10 pr-3 py-2 rounded-lantern bg-lantern-surface border border-lantern-border text-lantern-text placeholder-lantern-text-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary text-sm shadow-lantern"
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
          {!guestMode ? (
            <button
              onClick={handleSaveCurrentSearch}
              disabled={savingSearch}
              aria-label="Save current search"
              className="shrink-0 h-9 min-w-[36px] px-3 rounded-lantern flex items-center justify-center border border-lantern-border bg-lantern-surface text-lantern-text-secondary hover:border-lantern-primary/30 disabled:opacity-50 transition-colors"
              title="Save current search"
            >
              <BookmarkIcon className="w-4 h-4" />
            </button>
          ) : null}
        </div>

        {!searchTerm.trim() && recentSearches.length > 0 ? (
          <div className="flex items-center gap-1.5 mt-2 overflow-x-auto" aria-label="Recent searches">
            <span className="text-[11px] text-lantern-text-tertiary shrink-0">Recent</span>
            {recentSearches.map(q => (
              <button
                key={q}
                type="button"
                onClick={() => {
                  setSearchTerm(q);
                  setSearchInputKey(k => k + 1);
                }}
                className="shrink-0 px-2.5 py-1 rounded-full bg-lantern-background-secondary text-[11px] text-lantern-text-secondary hover:text-lantern-primary transition-colors"
              >
                {q}
              </button>
            ))}
            <button
              type="button"
              aria-label="Clear recent searches"
              onClick={() => {
                try { localStorage.removeItem(RECENT_SEARCHES_KEY); } catch { /* non-critical */ }
                setRecentSearches([]);
              }}
              className="shrink-0 px-1.5 py-1 text-[11px] text-lantern-text-tertiary hover:text-lantern-error"
            >
              ✕
            </button>
          </div>
        ) : null}

        {showFilters && (
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
        )}

        {showPulse && topCategories.length > 0 ? (
          <div className="rounded-lg border border-lantern-border bg-lantern-surface p-2.5 sm:p-3">
            <p className="text-[11px] sm:text-xs text-lantern-text-secondary mb-2">
              {totalListingsCount.toLocaleString()} listings · Marketplace pulse
            </p>
            <div className="grid grid-cols-3 sm:grid-cols-3 lg:grid-cols-6 gap-1.5 sm:gap-2">
              {topCategories.map((item) => (
                <div key={item.category} className="min-w-0 rounded-md border border-lantern-border px-2 py-1.5 bg-lantern-background-secondary">
                  <p className="text-[10px] sm:text-xs font-semibold text-lantern-text truncate">
                    {getCategoryName(item.category)}
                  </p>
                  <p className="text-xs sm:text-sm font-bold text-lantern-primary">{item.total}</p>
                  <p className="text-[9px] sm:text-[11px] text-lantern-text-tertiary truncate">{item.active} active</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          setActiveTab(value as 'academic' | 'student-life' | 'shops');
          setSelectedCategory('');
          setShowCategoryPanel(false);
        }}
        aria-label="Marketplace categories"
        className="flex-1 flex flex-col min-h-0 min-w-0 max-w-full mt-1"
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
                <Tab
                  value="shops"
                  index={2}
                  icon={<BuildingStorefrontIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
                  className="flex-1 sm:flex-initial !rounded-none !px-2 sm:!px-5 !py-2 sm:!py-2.5 !text-xs sm:!text-sm border-b-2 border-transparent"
                >
                  Shops
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
          <div
            role="region"
            aria-label="Marketplace listings"
            data-testid="marketplace-listings"
            className="flex-1 min-h-0 min-w-0 max-w-full p-2 sm:p-4 md:p-6 pb-20 md:pb-6 overflow-y-auto overflow-x-hidden overscroll-contain box-border"
          >
            {marketplaceListingsBody}
          </div>
        </TabPanel>

        <TabPanel value="student-life" className="flex-1 flex flex-col min-h-0 min-w-0">
          {renderCategoryChips(studentLifeCategories)}
          <div
            role="region"
            aria-label="Marketplace listings"
            data-testid="marketplace-listings"
            className="flex-1 min-h-0 min-w-0 max-w-full p-2 sm:p-4 md:p-6 pb-20 md:pb-6 overflow-y-auto overflow-x-hidden overscroll-contain box-border"
          >
            {marketplaceListingsBody}
          </div>
        </TabPanel>

        <TabPanel value="shops" className="flex-1 flex flex-col min-h-0 min-w-0">
          <div
            role="region"
            aria-label="Marketplace shops"
            className="flex-1 min-h-0 min-w-0 max-w-full p-2 sm:p-4 md:p-6 pb-20 md:pb-6 overflow-y-auto overflow-x-hidden overscroll-contain box-border"
          >
            {shopsLoading ? (
              <div className="flex justify-center py-16">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-lantern-primary" />
              </div>
            ) : shops.length === 0 ? (
              <div className="text-center py-16 px-4">
                <BuildingStorefrontIcon className="w-10 h-10 text-lantern-text-tertiary mx-auto mb-3" />
                <p className="text-sm font-semibold text-lantern-text">No shops yet</p>
                <p className="text-xs text-lantern-text-secondary mt-1">
                  Sellers with active listings appear here automatically.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {shops.map((shop) => {
                  const cover = shop.coverImageUrl ? normalizeStorageUrl(shop.coverImageUrl) : null;
                  const avatar = shop.avatarUrl ? normalizeStorageUrl(shop.avatarUrl) : null;
                  return (
                    <button
                      key={shop.sellerId}
                      type="button"
                      onClick={() => onNavigate('SellerProfile', { userId: shop.sellerId })}
                      className="text-left rounded-2xl border border-lantern-border bg-lantern-surface overflow-hidden hover:border-lantern-primary/40 transition-colors"
                    >
                      <div className="h-20 bg-gradient-to-br from-lantern-primary/80 to-emerald-800">
                        {cover ? <img src={cover} alt="" className="w-full h-full object-cover" /> : null}
                      </div>
                      <div className="px-3 pb-3 -mt-5">
                        <div className="w-12 h-12 rounded-xl bg-lantern-background-secondary ring-2 ring-lantern-surface overflow-hidden flex items-center justify-center text-sm font-bold text-lantern-primary">
                          {avatar ? (
                            <img src={avatar} alt="" className="w-full h-full object-cover" />
                          ) : (
                            shop.shopName.charAt(0).toUpperCase()
                          )}
                        </div>
                        <p className="mt-2 text-sm font-bold text-lantern-text truncate">{shop.shopName}</p>
                        {shop.bio ? (
                          <p className="text-xs text-lantern-text-secondary line-clamp-2 mt-0.5">{shop.bio}</p>
                        ) : null}
                        <div className="flex items-center gap-2 mt-2 text-[11px] text-lantern-text-tertiary">
                          <span>{shop.activeListingCount} active</span>
                          {shop.avgRating > 0 ? (
                            <span className="inline-flex items-center gap-0.5">
                              <StarIcon className="w-3 h-3 text-amber-400" />
                              {shop.avgRating.toFixed(1)}
                            </span>
                          ) : null}
                          {shop.campusLabel ? <span className="truncate">{shop.campusLabel}</span> : null}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </TabPanel>
      </Tabs>
    </div>
  );
};

export default MarketplaceScreen;