import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useToastStore } from '../stores/toastStore';
import {
  fetchMarketplaceListings, fetchMyFavorites, addToFavorites, removeFromFavorites,
  getRecentlyViewed, removeRecentlyViewed, fetchMarketplaceListing,
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
import { FeatureHero, Tabs, TabList, Tab } from './ui';
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
}

const MarketplaceScreen: React.FC<MarketplaceScreenProps> = ({
  onNavigate,
  guestMode = false,
  onSignInRequired,
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
  const [campusFilterInitialized, setCampusFilterInitialized] = useState(false);
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
    title: 'Explore Marketplace — Campus deals | Lantern Study',
    description:
      'Browse Nigerian campus marketplace listings for textbooks, notes, accommodation, and student essentials. On-campus pickup; sign in to buy or sell.',
    canonicalUrl: 'https://lanternstudy.com/marketplace',
    ogType: 'website',
  });

  useEffect(() => {
    void fetchMarketplaceCampuses('NG')
      .then((rows) => setCampuses(rows))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (guestMode || campusFilterInitialized) return;
    if (userCampusId) {
      setCampusIdFilter(userCampusId);
    }
    setCampusFilterInitialized(true);
  }, [guestMode, userCampusId, campusFilterInitialized]);

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
  }, [activeTab, searchTerm, selectedCategory, sortBy, sortOrder, minPrice, maxPrice, locationFilter, campusIdFilter, guestMode]);

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
      const ids = getRecentlyViewed().filter(id => !missingRecentlyViewed.has(id));
      if (ids.length === 0) return;

      const missingIds: string[] = [];
      const listingPromises = ids.slice(0, 10).map(async (id) => {
        const listing = await fetchMarketplaceListing(id).catch(() => null);
        if (!listing) missingIds.push(id);
        return listing;
      });

      const results = await Promise.all(listingPromises);
      const validListings = results.filter((l): l is MarketplaceListing => l !== null && l.status === 'active');
      setRecentlyViewed(validListings);

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
      let totalMatches = 0;
      for (const search of data) {
        try {
          const result = await checkSavedSearchMatches(search.id);
          totalMatches += result.count || 0;
        } catch {
          // ignore per-search errors
        }
      }
      setSavedSearchNewMatches(totalMatches);
    } catch (error) {
      console.error('Error loading saved searches:', error);
    }
  };

  const handleSaveCurrentSearch = async () => {
    const filters: Record<string, any> = {};
    if (searchTerm) filters.search = searchTerm;
    if (selectedCategory) filters.category = selectedCategory;
    if (minPrice) filters.minPrice = parseFloat(minPrice);
    if (maxPrice) filters.maxPrice = parseFloat(maxPrice);
    if (locationFilter) filters.location = locationFilter;
    if (sortBy !== 'created_at') filters.sortBy = sortBy;
    if (sortOrder !== 'desc') filters.sortOrder = sortOrder;

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
    const f = search.filters;
    if (f.search) setSearchTerm(f.search);
    else setSearchTerm('');
    if (f.category) setSelectedCategory(f.category);
    else setSelectedCategory('');
    if (f.minPrice) setMinPrice(f.minPrice.toString());
    else setMinPrice('');
    if (f.maxPrice) setMaxPrice(f.maxPrice.toString());
    else setMaxPrice('');
    if (f.location) setLocationFilter(f.location);
    else setLocationFilter('');
    if (f.sortBy) setSortBy(f.sortBy);
    else setSortBy('created_at');
    if (f.sortOrder) setSortOrder(f.sortOrder);
    else setSortOrder('desc');
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

      const { data, pagination } = await fetchMarketplaceListingsPage(filters);
      if (requestId !== undefined && requestId !== listingsRequestId.current) return;
      setTotalListingsCount(pagination?.total || 0);
      
      // Filter by tab if no specific category is selected
      const academicCategoryIds = ['textbook_exchange', 'pq_bank', 'lecture_notes', 'project_thesis', 'data_collection', 'equipment_rental'];
      const studentLifeCategoryIds = ['accommodation', 'travel_transport', 'personal_goods', 'aso_ebi', 'campus_services', 'events_social'];
      
      let filteredData = data || [];
      if (!selectedCategory && data) {
        const relevantCategories = activeTab === 'academic' ? academicCategoryIds : studentLifeCategoryIds;
        filteredData = data.filter((listing: MarketplaceListing) => 
          relevantCategories.includes(listing.category) || listing.category.startsWith('custom:')
        );
      }
      
      if (reset) {
        setListings(filteredData);
      } else {
        setListings(prev => [...prev, ...filteredData]);
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

  const currentCategories = activeTab === 'academic' ? academicCategories : studentLifeCategories;
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

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 w-full max-w-full overflow-hidden bg-lantern-background">
      <div className="shrink-0 px-3 sm:px-4 md:px-6 pt-2">
        <MarketplaceComplianceBanner />
      </div>
      <div className="shrink-0 px-3 sm:px-4 md:px-6 pt-2 pb-2">
        <FeatureHero
          title="Explore"
          subtitle="Discover academic resources and student essentials on campus"
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
                aria-label={activeTab === 'academic' ? 'Search textbooks and notes' : 'Search campus essentials'}
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
                <span className="ml-1 w-4 h-4 bg-white text-lantern-primary text-[10px] items-center justify-center rounded-full hidden sm:flex">
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
        <div className="shrink-0 max-w-full bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-3 sm:px-4 md:px-6 py-1.5 sm:py-3">
          <button
            type="button"
            onClick={() => setShowPulse(v => !v)}
            className="md:hidden w-full flex items-center justify-between gap-2 py-1 text-left"
            aria-expanded={showPulse}
          >
            <span className="text-[11px] sm:text-xs text-slate-600 dark:text-slate-400 truncate">
              {totalListingsCount.toLocaleString()} listings · Marketplace pulse
            </span>
            <ChevronDownIcon className={`w-4 h-4 shrink-0 text-slate-400 transition-transform ${showPulse ? 'rotate-180' : ''}`} />
          </button>
          <div className={`${showPulse ? 'block' : 'hidden'} md:block mt-2 md:mt-0`}>
            <div className="hidden md:flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 mb-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Marketplace Pulse</p>
                <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300">
                  {totalListingsCount.toLocaleString()} listings match your filters
                </p>
              </div>
              <div className="hidden lg:flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 shrink-0">
                <ClockIcon className="w-4 h-4" />
                Updated from live category analytics
              </div>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-3 lg:grid-cols-6 gap-1.5 sm:gap-2">
              {topCategories.map((item) => (
                <div key={item.category} className="min-w-0 rounded-md sm:rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1.5 sm:px-3 sm:py-2 bg-slate-50 dark:bg-slate-900/50">
                  <p className="text-[10px] sm:text-xs font-semibold text-slate-700 dark:text-slate-300 truncate">
                    {getCategoryName(item.category)}
                  </p>
                  <p className="text-xs sm:text-sm font-bold text-indigo-600 dark:text-indigo-400">{item.total}</p>
                  <p className="text-[9px] sm:text-[11px] text-slate-500 dark:text-slate-400 truncate">{item.active} active</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tabs + collapsible categories */}
      <div className="shrink-0 max-w-full bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
      <div className="sticky top-0 z-20 bg-white dark:bg-slate-800 shadow-sm md:shadow-none px-3 sm:px-4 md:px-6 max-w-full">
        <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-700/60">
          <Tabs
            value={activeTab}
            onValueChange={(value) => {
              setActiveTab(value as 'academic' | 'student-life');
              setShowCategoryPanel(false);
            }}
            aria-label="Marketplace categories"
            className="flex-1 min-w-0"
          >
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
          </Tabs>
          {/* Mobile category toggle — collapsed by default */}
          <button
            type="button"
            onClick={() => setShowCategoryPanel(v => !v)}
            aria-expanded={showCategoryPanel}
            className="md:hidden shrink-0 flex items-center gap-1 max-w-[42%] px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-700 text-[10px] font-medium text-slate-600 dark:text-slate-300"
          >
            <span className="truncate">{activeCategoryLabel}</span>
            <ChevronDownIcon className={`w-3.5 h-3.5 shrink-0 transition-transform ${showCategoryPanel ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {/* Category chips — hidden on mobile until expanded; always visible md+ */}
      <div className={`px-3 sm:px-4 md:px-6 md:py-2 ${showCategoryPanel ? 'py-1' : 'py-0'}`}>
        <div className={`gap-1.5 lg:gap-2 lg:overflow-x-auto lg:pb-1 lg:scrollbar-none lg:snap-x lg:snap-mandatory touch-pan-x ${showCategoryPanel ? 'grid grid-cols-3 sm:grid-cols-4' : 'hidden'} md:flex md:items-stretch`}>
          <button
            onClick={() => selectCategory('')}
            className={categoryChipClass(selectedCategory === '')}
          >
            All
          </button>
          {currentCategories.map(category => {
            const IconComponent = category.icon;
            const isSelected = selectedCategory === category.id;
            return (
              <button
                key={category.id}
                onClick={() => selectCategory(category.id)}
                className={categoryChipClass(isSelected)}
              >
                <IconComponent className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
                <span className="text-center lg:text-left leading-tight truncate">{category.name}</span>
              </button>
            );
          })}
        </div>
      </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 min-w-0 max-w-full p-2 sm:p-4 md:p-6 pb-20 md:pb-6 overflow-y-auto overflow-x-hidden overscroll-contain box-border">

        {/* Saved Searches */}
        {savedSearches.length > 0 && (
          <div className="mb-5">
            <button
              onClick={() => setShowSavedSearches(!showSavedSearches)}
              className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-1.5 hover:text-indigo-600 transition-colors"
            >
              <BookmarkIcon className="w-4 h-4" />
              Saved Searches ({savedSearches.length})
              {savedSearchNewMatches > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-indigo-600 text-white text-[10px]">
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
                    className="inline-flex items-center gap-2 bg-white dark:bg-slate-800 px-3 py-1.5 rounded-lg ring-1 ring-slate-200/60 dark:ring-slate-700/60 text-sm group"
                  >
                    <button
                      onClick={() => handleApplySavedSearch(search)}
                      className="text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 font-medium truncate max-w-[200px]"
                    >
                      {search.name}
                    </button>
                    <button
                      onClick={() => handleDeleteSavedSearch(search.id)}
                      className="text-slate-400 hover:text-red-500 sm:opacity-0 sm:group-hover:opacity-100 transition-all p-1 -m-1 touch-manipulation"
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

        {/* Recently Viewed */}
        {recentlyViewed.length > 0 && !searchTerm && !selectedCategory && !minPrice && !maxPrice && !locationFilter && (
          <div className="mb-4">
            <h3 className="text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-1.5">
              <ClockIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              Recently Viewed
            </h3>
            <div className="max-w-full overflow-x-auto scrollbar-none">
            <div className="flex gap-3 pb-2 w-max pr-2">
              {recentlyViewed.map(item => (
                <button
                  key={item.id}
                  onClick={() => handleListingClick(item)}
                  className="flex-shrink-0 w-28 sm:w-36 md:w-40 bg-white dark:bg-slate-800 rounded-lg sm:rounded-xl overflow-hidden ring-1 ring-slate-200/60 dark:ring-slate-700/60 hover:ring-indigo-300/60 transition-all text-left group"
                >
                  <div className="aspect-[4/3] bg-slate-100 dark:bg-slate-700 overflow-hidden">
                    {item.images && item.images.length > 0 ? (
                      <img src={item.images[0]} alt={item.title} className="w-full h-full max-w-full object-cover group-hover:scale-105 transition-transform duration-300" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ShoppingBagIcon className="w-6 h-6 text-slate-300 dark:text-slate-600" />
                      </div>
                    )}
                  </div>
                  <div className="p-2">
                    <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 line-clamp-1 group-hover:text-indigo-600 transition-colors">{item.title}</p>
                    <p className="text-sm font-bold text-indigo-600 dark:text-indigo-400">{item.price ? `₦${item.price.toLocaleString()}` : 'Free'}</p>
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
              <div key={i} className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="h-40 animate-pulse bg-slate-200 dark:bg-slate-700" />
                <div className="p-3 space-y-2">
                  <div className="h-4 w-2/3 animate-pulse bg-slate-200 dark:bg-slate-700 rounded" />
                  <div className="h-3 w-1/3 animate-pulse bg-slate-200 dark:bg-slate-700 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : listings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-20 h-20 bg-slate-100 dark:bg-slate-800 rounded-2xl flex items-center justify-center mb-5">
              <ShoppingBagIcon className="w-10 h-10 text-slate-300 dark:text-slate-600" />
            </div>
            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-2">
              No listings found
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 max-w-sm">
              {searchTerm || selectedCategory
                ? "Try adjusting your search or filters to find what you're looking for."
                : "Be the first to create a listing in this category!"
              }
            </p>
            <button
              onClick={handleCreateListing}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold flex items-center transition-colors duration-150 text-sm shadow-sm"
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

        {/* Load More Button */}
        {!loading && listings.length > 0 && hasMore && (
          <div className="flex justify-center mt-6">
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="px-6 py-2.5 bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 rounded-xl font-semibold ring-1 ring-slate-200 dark:ring-slate-700 hover:bg-indigo-50 dark:hover:bg-slate-700 transition-colors duration-150 text-sm shadow-sm flex items-center gap-2"
            >
              {loadingMore ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-indigo-200 border-t-indigo-600"></div>
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

        {/* End of results */}
        {!loading && listings.length > 0 && !hasMore && (
          <p className="text-center text-xs text-slate-400 dark:text-slate-500 mt-6">
            You've reached the end of the listings
          </p>
        )}
      </div>
    </div>
  );
};

export default MarketplaceScreen;