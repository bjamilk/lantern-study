import React, { useState, useEffect, useRef } from 'react';
import {
  fetchMarketplaceListings, fetchMyFavorites, addToFavorites, removeFromFavorites,
  getRecentlyViewed, removeRecentlyViewed, fetchMarketplaceListing,
  fetchSavedSearches, saveSearch, deleteSavedSearch, checkSavedSearchMatches,
  fetchMarketplaceListingsPage, fetchMarketplaceCategoryAnalytics
} from '../services/supabase';
import { useAuthStore } from '../stores/authStore';
import { MarketplaceListing, SavedSearch } from '../types';
import {
  MagnifyingGlassIcon,
  PlusIcon,
  MapPinIcon,
  ClockIcon,
  StarIcon,
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
  XMarkIcon,
  BookmarkIcon,
  TrashIcon
} from '@heroicons/react/24/outline';
import { HeartIcon } from '@heroicons/react/24/solid';

interface MarketplaceScreenProps {
  onNavigate: (screen: string, params?: any) => void;
}

const MarketplaceScreen: React.FC<MarketplaceScreenProps> = ({ onNavigate }) => {
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
  const ITEMS_PER_PAGE = 20;
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
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

  useEffect(() => {
    setPage(1);
    setListings([]);
    setHasMore(true);
    loadListings(1, true);
    loadFavorites();
  }, [activeTab, searchTerm, selectedCategory, sortBy, sortOrder, minPrice, maxPrice, locationFilter]);

  // Load recently viewed and saved searches on mount
  useEffect(() => {
    loadRecentlyViewed();
    loadSavedSearches();
    loadCategoryAnalytics();
  }, []);

  const loadCategoryAnalytics = async () => {
    try {
      const analytics = await fetchMarketplaceCategoryAnalytics();
      setTopCategories(analytics.slice(0, 6));
    } catch (error) {
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
      alert('Set some search criteria or filters first.');
      return;
    }

    setSavingSearch(true);
    try {
      await saveSearch(filters);
      await loadSavedSearches();
      alert('Search saved! You\'ll be notified when new matching listings appear.');
    } catch (error) {
      console.error('Error saving search:', error);
      alert('Failed to save search');
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

  const loadListings = async (pageNum: number = 1, reset: boolean = false) => {
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

      const { data, pagination } = await fetchMarketplaceListingsPage(filters);
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
    } catch (error) {
      console.error('Error loading listings:', error);
      if (reset) setListings([]);
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const handleLoadMore = () => {
    if (!loadingMore && hasMore) {
      loadListings(page + 1, false);
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

  const activeFilterCount = [minPrice, maxPrice, locationFilter].filter(Boolean).length + (sortBy !== 'created_at' ? 1 : 0);

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
        ? 'bg-indigo-600 text-white shadow-sm'
        : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
    }`;

  const activeCategoryLabel = selectedCategory ? getCategoryName(selectedCategory) : 'All categories';

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 w-full max-w-full overflow-hidden bg-slate-50 dark:bg-slate-900">
      {/* Hero Header — compact on mobile */}
      <div className="shrink-0 max-w-full overflow-x-hidden box-border bg-gradient-to-r from-indigo-600 via-indigo-600 to-purple-600 px-3 sm:px-4 md:px-6 py-2 sm:py-4 md:py-8">
        <div className="flex items-center justify-between gap-2 max-w-full">
          <div className="min-w-0 flex items-center gap-2">
            <div className="hidden sm:flex w-8 h-8 md:w-10 md:h-10 shrink-0 bg-white/20 rounded-lg md:rounded-xl items-center justify-center backdrop-blur-sm">
              <ShoppingBagIcon className="w-5 h-5 md:w-6 md:h-6 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-2xl md:text-3xl font-bold text-white truncate">Marketplace</h1>
              <p className="hidden sm:block text-indigo-100 mt-0.5 text-xs sm:text-sm">
                Discover academic resources and student essentials
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-1 sm:gap-2">
            <button
              onClick={() => onNavigate('MarketplaceOrders')}
              aria-label="Orders"
              className="h-8 w-8 sm:h-9 sm:w-auto sm:px-3 sm:py-2 bg-white/15 hover:bg-white/25 backdrop-blur-sm text-white rounded-lg font-medium flex items-center justify-center transition-colors duration-150 text-xs sm:text-sm"
            >
              <ShoppingBagIcon className="w-4 h-4 sm:mr-1.5 shrink-0" />
              <span className="hidden sm:inline">Orders</span>
            </button>
            <button
              onClick={() => onNavigate('MyListings')}
              aria-label="My listings"
              className="h-8 w-8 sm:h-9 sm:w-auto sm:px-3 sm:py-2 bg-white/15 hover:bg-white/25 backdrop-blur-sm text-white rounded-lg font-medium flex items-center justify-center transition-colors duration-150 text-xs sm:text-sm"
            >
              <ClipboardDocumentListIcon className="w-4 h-4 sm:mr-1.5 shrink-0" />
              <span className="hidden sm:inline">Listings</span>
            </button>
            <button
              onClick={() => onNavigate('MarketplaceInquiries')}
              aria-label="Inquiries"
              className="h-8 w-8 sm:h-9 sm:w-auto sm:px-3 sm:py-2 bg-white/15 hover:bg-white/25 backdrop-blur-sm text-white rounded-lg font-medium flex items-center justify-center transition-colors duration-150 text-xs sm:text-sm"
            >
              <ChatBubbleLeftEllipsisIcon className="w-4 h-4 sm:mr-1.5 shrink-0" />
              <span className="hidden sm:inline">Inquiries</span>
            </button>
            <button
              onClick={handleCreateListing}
              aria-label="Create listing"
              className="h-8 w-8 sm:h-9 sm:w-auto sm:px-3 sm:py-2 bg-white text-indigo-700 hover:bg-indigo-50 rounded-lg font-semibold flex items-center justify-center transition-colors duration-150 shadow-sm text-xs sm:text-sm"
            >
              <PlusIcon className="w-4 h-4 sm:mr-1.5 shrink-0" />
              <span className="hidden sm:inline">Create</span>
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="mt-2 sm:mt-4 flex gap-1.5 sm:gap-2 min-w-0 max-w-full">
          <div className="flex-1 min-w-0 w-full relative">
            <MagnifyingGlassIcon className="absolute left-2.5 sm:left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder={activeTab === 'academic' ? 'Search textbooks, notes…' : 'Search essentials…'}
              defaultValue={searchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full min-w-0 max-w-full box-border pl-8 sm:pl-10 pr-3 py-2 sm:py-2.5 rounded-lg sm:rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50 shadow-lg text-sm"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            aria-label="Toggle filters"
            aria-expanded={showFilters}
            className={`shrink-0 h-8 w-8 sm:h-9 sm:w-auto sm:min-w-[36px] sm:px-3 rounded-lg sm:rounded-xl flex items-center justify-center gap-1 font-medium text-xs shadow-lg transition-colors duration-150 ${
              showFilters || activeFilterCount > 0
                ? 'bg-white text-indigo-700'
                : 'bg-white/15 hover:bg-white/25 backdrop-blur-sm text-white'
            }`}
          >
            <FunnelIcon className="w-4 h-4" />
            <span className="hidden sm:inline">Filters</span>
            {activeFilterCount > 0 && (
              <span className="hidden sm:flex ml-1 w-4 h-4 bg-indigo-600 text-white text-[10px] items-center justify-center rounded-full">
                {activeFilterCount}
              </span>
            )}
          </button>
          <button
            onClick={handleSaveCurrentSearch}
            disabled={savingSearch}
            aria-label="Save current search"
            className="shrink-0 h-8 w-8 sm:h-9 sm:w-auto sm:min-w-[36px] sm:px-3 rounded-lg sm:rounded-xl flex items-center justify-center text-sm shadow-lg transition-colors duration-150 bg-white/15 hover:bg-white/25 backdrop-blur-sm text-white disabled:opacity-50"
            title="Save current search"
          >
            <BookmarkIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Filter Panel */}
        {showFilters && (
          <div className="mt-2 sm:mt-3 max-w-full overflow-hidden bg-white/10 backdrop-blur-sm rounded-lg sm:rounded-xl p-2.5 sm:p-4 space-y-2 sm:space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3 min-w-0">
              {/* Price Range */}
              <div className="min-w-0">
                <label className="block text-xs font-medium text-indigo-100 mb-1">Price Range (₦)</label>
                <div className="flex gap-2 min-w-0">
                  <input
                    type="number"
                    placeholder="Min"
                    value={minPrice}
                    onChange={(e) => setMinPrice(e.target.value)}
                    className="w-full min-w-0 box-border px-3 py-2 rounded-lg bg-white/90 dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                  />
                  <input
                    type="number"
                    placeholder="Max"
                    value={maxPrice}
                    onChange={(e) => setMaxPrice(e.target.value)}
                    className="w-full min-w-0 box-border px-3 py-2 rounded-lg bg-white/90 dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                  />
                </div>
              </div>

              {/* Location */}
              <div>
                <label className="block text-xs font-medium text-indigo-100 mb-1">Location</label>
                <input
                  type="text"
                  placeholder="City or campus"
                  value={locationFilter}
                  onChange={(e) => setLocationFilter(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white/90 dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                />
              </div>

              {/* Sort */}
              <div>
                <label className="block text-xs font-medium text-indigo-100 mb-1">Sort By</label>
                <select
                  value={`${sortBy}:${sortOrder}`}
                  onChange={(e) => {
                    const [field, order] = e.target.value.split(':');
                    setSortBy(field);
                    setSortOrder(order as 'asc' | 'desc');
                  }}
                  className="w-full px-3 py-2 rounded-lg bg-white/90 dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                >
                  <option value="created_at:desc">Newest First</option>
                  <option value="created_at:asc">Oldest First</option>
                  <option value="price:asc">Price: Low to High</option>
                  <option value="price:desc">Price: High to Low</option>
                </select>
              </div>
            </div>

            {activeFilterCount > 0 && (
              <button
                onClick={clearFilters}
                className="text-xs text-indigo-100 hover:text-white flex items-center gap-1 transition-colors"
              >
                <XMarkIcon className="w-3.5 h-3.5" />
                Clear all filters
              </button>
            )}
          </div>
        )}
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
          <div className="flex flex-1 min-w-0">
          <button
            onClick={() => { setActiveTab('academic'); setShowCategoryPanel(false); }}
            className={`flex-1 sm:flex-initial px-2 sm:px-5 py-1.5 sm:py-2.5 font-medium text-[11px] sm:text-sm border-b-2 transition-colors duration-150 flex items-center justify-center sm:justify-start gap-1 sm:gap-2 ${
              activeTab === 'academic'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <AcademicCapIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            Academic
          </button>
          <button
            onClick={() => { setActiveTab('student-life'); setShowCategoryPanel(false); }}
            className={`flex-1 sm:flex-initial px-2 sm:px-5 py-1.5 sm:py-2.5 font-medium text-[11px] sm:text-sm border-b-2 transition-colors duration-150 flex items-center justify-center sm:justify-start gap-1 sm:gap-2 ${
              activeTab === 'student-life'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <BriefcaseIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            Student Life
          </button>
          </div>
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

        {loading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-indigo-200 border-t-indigo-600 mb-3"></div>
            <span className="text-sm text-slate-500 dark:text-slate-400">Loading listings...</span>
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
              const isFavorite = favorites.has(listing.id);
              const isOwner = listing.user_id === currentUser?.id || listing.seller_id === currentUser?.id;

              return (
                <div
                  key={listing.id}
                  onClick={() => handleListingClick(listing)}
                  className={`min-w-0 rounded-2xl shadow-sm ring-1 overflow-hidden hover:shadow-md active:scale-[0.99] transition-all duration-200 cursor-pointer group ${
                    isOwner
                      ? 'bg-indigo-50/60 dark:bg-indigo-950/30 ring-indigo-300 dark:ring-indigo-600/60 hover:ring-indigo-400 dark:hover:ring-indigo-500'
                      : 'bg-white dark:bg-slate-800 ring-slate-200/60 dark:ring-slate-700/60 hover:ring-indigo-300/60 dark:hover:ring-indigo-600/40'
                  }`}
                >
                  {/* Image */}
                  <div className="relative aspect-[16/10] sm:aspect-[4/3] bg-slate-100 dark:bg-slate-700/50 overflow-hidden">
                    {listing.images && listing.images.length > 0 ? (
                      <img
                        src={listing.images[0]}
                        alt={listing.title}
                        className="w-full h-full max-w-full object-cover group-hover:scale-105 transition-transform duration-300"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <IconComponent className="w-10 h-10 text-slate-300 dark:text-slate-600" />
                      </div>
                    )}

                    {/* Favorite Button */}
                    <button
                      onClick={(e) => toggleFavorite(listing.id, e)}
                      className="absolute top-2 right-2 sm:top-2.5 sm:right-2.5 p-2 sm:p-1.5 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-lg hover:bg-white dark:hover:bg-slate-700 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 touch-manipulation"
                      aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                    >
                      <HeartIcon
                        className={`w-4 h-4 ${isFavorite ? 'text-red-500 fill-current' : 'text-slate-400'}`}
                      />
                    </button>

                    {/* Category Badge */}
                    <span className="absolute top-2 left-2 sm:top-2.5 sm:left-2.5 max-w-[calc(100%-3.5rem)] px-2 py-0.5 bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm text-[10px] sm:text-xs font-medium rounded-md text-slate-700 dark:text-slate-300 flex items-center gap-1 shadow-sm">
                      <IconComponent className="w-3 h-3 shrink-0" />
                      <span className="truncate">{getCategoryName(listing.category)}</span>
                    </span>

                    {/* Your Listing Badge */}
                    {isOwner && (
                      <span className="absolute bottom-2 left-2 px-2 py-0.5 bg-indigo-600/90 backdrop-blur-sm text-[10px] font-semibold rounded-md text-white shadow-sm">
                        Your Listing
                      </span>
                    )}
                  </div>

                  {/* Content */}
                  <div className="p-2 sm:p-3">
                    <h3 className="font-semibold text-xs sm:text-sm text-slate-800 dark:text-slate-200 mb-0.5 sm:mb-1 line-clamp-2 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors duration-150">
                      {listing.title}
                    </h3>

                    <p className="text-slate-500 dark:text-slate-400 text-xs mb-2 line-clamp-1 sm:line-clamp-2 leading-relaxed">
                      {listing.description}
                    </p>

                    {/* Price */}
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-base sm:text-lg font-bold text-indigo-600 dark:text-indigo-400 truncate">
                        {(listing.is_on_sale && listing.effective_price != null) ? (
                          <>
                            <span className="line-through text-slate-400 text-xs mr-1">
                              ₦{Number(listing.price).toLocaleString()}
                            </span>
                            <span className="text-red-600 dark:text-red-400 font-bold">
                              ₦{Number(listing.effective_price).toLocaleString()}
                            </span>
                            {listing.promo_label && (
                              <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
                                {listing.promo_label}
                              </span>
                            )}
                          </>
                        ) : listing.price ? `₦${listing.price.toLocaleString()}` : 'Free'}
                      </span>
                      {(() => {
                        const avgRating = listing.reviews && listing.reviews.length > 0
                          ? listing.reviews.reduce((sum, r) => sum + r.rating, 0) / listing.reviews.length
                          : 0;
                        return avgRating > 0 ? (
                          <div className="flex items-center text-xs text-slate-400 dark:text-slate-500 shrink-0">
                            <StarIcon className="w-3.5 h-3.5 mr-0.5 text-amber-400 fill-current" />
                            <span>{avgRating.toFixed(1)}</span>
                          </div>
                        ) : null;
                      })()}
                    </div>

                    {/* Location and Time */}
                    <div className="flex items-center justify-between gap-2 text-[11px] sm:text-xs text-slate-400 dark:text-slate-500 pt-2 border-t border-slate-100 dark:border-slate-700 min-w-0">
                      <div className="flex items-center gap-1 min-w-0 flex-1">
                        <MapPinIcon className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{listing.location || 'Not specified'}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <ClockIcon className="w-3.5 h-3.5 hidden sm:block" />
                        <span className="whitespace-nowrap">{new Date(listing.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                      </div>
                    </div>
                  </div>
                </div>
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