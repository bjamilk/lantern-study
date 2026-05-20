import React, { useState, useEffect, useRef } from 'react';
import {
  fetchMarketplaceListings, fetchMyFavorites, addToFavorites, removeFromFavorites,
  getRecentlyViewed, removeRecentlyViewed, fetchMarketplaceListing,
  fetchSavedSearches, saveSearch, deleteSavedSearch, checkSavedSearchMatches
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
  }, []);

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

      const data = await fetchMarketplaceListings(filters);
      
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
      
      setHasMore(filteredData.length >= ITEMS_PER_PAGE);
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

  return (
    <div className="flex-1 flex flex-col bg-slate-50 dark:bg-slate-900">
      {/* Hero Header */}
      <div className="bg-gradient-to-r from-indigo-600 via-indigo-600 to-purple-600 px-3 sm:px-4 md:px-6 py-4 sm:py-6 md:py-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-white flex items-center gap-2 sm:gap-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-sm">
                <ShoppingBagIcon className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
              </div>
              Marketplace
            </h1>
            <p className="text-indigo-100 mt-1 sm:mt-1.5 text-xs sm:text-sm">
              Discover academic resources and student essentials
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5 sm:gap-2 w-full sm:w-auto">
            <button
              onClick={() => onNavigate('MyListings')}
              className="px-3 sm:px-4 py-2 bg-white/15 hover:bg-white/25 backdrop-blur-sm text-white rounded-lg font-medium flex items-center transition-colors duration-150 text-xs sm:text-sm flex-1 sm:flex-initial justify-center sm:justify-start"
            >
              <ClipboardDocumentListIcon className="w-4 h-4 mr-1.5 sm:mr-2" />
              <span className="hidden xs:inline">My </span>Listings
            </button>
            <button
              onClick={() => onNavigate('MarketplaceInquiries')}
              className="px-3 sm:px-4 py-2 bg-white/15 hover:bg-white/25 backdrop-blur-sm text-white rounded-lg font-medium flex items-center transition-colors duration-150 text-xs sm:text-sm flex-1 sm:flex-initial justify-center sm:justify-start"
            >
              <ChatBubbleLeftEllipsisIcon className="w-4 h-4 mr-1.5 sm:mr-2" />
              Inquiries
            </button>
            <button
              onClick={handleCreateListing}
              className="px-3 sm:px-4 py-2 bg-white text-indigo-700 hover:bg-indigo-50 rounded-lg font-semibold flex items-center transition-colors duration-150 shadow-sm text-xs sm:text-sm flex-1 sm:flex-initial justify-center sm:justify-start"
            >
              <PlusIcon className="w-4 h-4 mr-1.5 sm:mr-2" />
              Create<span className="hidden sm:inline">&nbsp;Listing</span>
            </button>
          </div>
        </div>

        {/* Search (inside hero) */}
        <div className="mt-3 sm:mt-5 flex gap-1.5 sm:gap-2">
          <div className="flex-1 relative">
            <MagnifyingGlassIcon className="absolute left-3 sm:left-4 top-1/2 transform -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-slate-400" />
            <input
              type="text"
              placeholder={`Search ${activeTab === 'academic' ? 'academic resources' : 'student essentials'}...`}
              defaultValue={searchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full pl-9 sm:pl-11 pr-3 sm:pr-4 py-2.5 sm:py-3 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50 shadow-lg text-xs sm:text-sm"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl flex items-center gap-1 sm:gap-1.5 font-medium text-xs sm:text-sm shadow-lg transition-colors duration-150 ${
              showFilters || activeFilterCount > 0
                ? 'bg-white text-indigo-700'
                : 'bg-white/15 hover:bg-white/25 backdrop-blur-sm text-white'
            }`}
          >
            <FunnelIcon className="w-4 h-4" />
            <span className="hidden sm:inline">Filters</span>
            {activeFilterCount > 0 && (
              <span className="ml-0.5 sm:ml-1 w-4 h-4 sm:w-5 sm:h-5 bg-indigo-600 text-white text-[10px] sm:text-xs flex items-center justify-center rounded-full">
                {activeFilterCount}
              </span>
            )}
          </button>
          <button
            onClick={handleSaveCurrentSearch}
            disabled={savingSearch}
            className="px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl flex items-center gap-1.5 font-medium text-sm shadow-lg transition-colors duration-150 bg-white/15 hover:bg-white/25 backdrop-blur-sm text-white disabled:opacity-50"
            title="Save current search"
          >
            <BookmarkIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Filter Panel */}
        {showFilters && (
          <div className="mt-3 bg-white/10 backdrop-blur-sm rounded-xl p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Price Range */}
              <div>
                <label className="block text-xs font-medium text-indigo-100 mb-1">Price Range (₦)</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    placeholder="Min"
                    value={minPrice}
                    onChange={(e) => setMinPrice(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white/90 dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                  />
                  <input
                    type="number"
                    placeholder="Max"
                    value={maxPrice}
                    onChange={(e) => setMaxPrice(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white/90 dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
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

      {/* Tabs */}
      <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-3 sm:px-4 md:px-6">
        <div className="flex">
          <button
            onClick={() => setActiveTab('academic')}
            className={`flex-1 sm:flex-initial px-3 sm:px-5 py-2.5 sm:py-3 font-medium text-xs sm:text-sm border-b-2 transition-colors duration-150 flex items-center justify-center sm:justify-start gap-1.5 sm:gap-2 ${
              activeTab === 'academic'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <AcademicCapIcon className="w-4 h-4" />
            Academic
          </button>
          <button
            onClick={() => setActiveTab('student-life')}
            className={`flex-1 sm:flex-initial px-3 sm:px-5 py-2.5 sm:py-3 font-medium text-xs sm:text-sm border-b-2 transition-colors duration-150 flex items-center justify-center sm:justify-start gap-1.5 sm:gap-2 ${
              activeTab === 'student-life'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <BriefcaseIcon className="w-4 h-4" />
            Student Life
          </button>
        </div>
      </div>

      {/* Category chips */}
      <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-3 sm:px-4 md:px-6 py-2 sm:py-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          <button
            onClick={() => setSelectedCategory('')}
            className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors duration-150 ${
              selectedCategory === ''
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
            }`}
          >
            All
          </button>
          {currentCategories.map(category => {
            const IconComponent = category.icon;
            return (
              <button
                key={category.id}
                onClick={() => setSelectedCategory(category.id)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors duration-150 flex items-center gap-1.5 ${
                  selectedCategory === category.id
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                }`}
              >
                <IconComponent className="w-3.5 h-3.5" />
                {category.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-3 sm:p-4 md:p-6 overflow-y-auto">

        {/* Saved Searches */}
        {savedSearches.length > 0 && (
          <div className="mb-5">
            <button
              onClick={() => setShowSavedSearches(!showSavedSearches)}
              className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-1.5 hover:text-indigo-600 transition-colors"
            >
              <BookmarkIcon className="w-4 h-4" />
              Saved Searches ({savedSearches.length})
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
                      className="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
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
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-1.5">
              <ClockIcon className="w-4 h-4" />
              Recently Viewed
            </h3>
            <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none">
              {recentlyViewed.map(item => (
                <button
                  key={item.id}
                  onClick={() => handleListingClick(item)}
                  className="flex-shrink-0 w-40 bg-white dark:bg-slate-800 rounded-xl overflow-hidden ring-1 ring-slate-200/60 dark:ring-slate-700/60 hover:ring-indigo-300/60 transition-all text-left group"
                >
                  <div className="aspect-[4/3] bg-slate-100 dark:bg-slate-700">
                    {item.images && item.images.length > 0 ? (
                      <img src={item.images[0]} alt={item.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
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
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5 sm:gap-4 md:gap-5">
            {listings.map(listing => {
              const IconComponent = getCategoryIcon(listing.category);
              const isFavorite = favorites.has(listing.id);
              const isOwner = listing.user_id === currentUser?.id || listing.seller_id === currentUser?.id;

              return (
                <div
                  key={listing.id}
                  onClick={() => handleListingClick(listing)}
                  className={`rounded-2xl shadow-sm ring-1 overflow-hidden hover:shadow-md transition-all duration-200 cursor-pointer group ${
                    isOwner
                      ? 'bg-indigo-50/60 dark:bg-indigo-950/30 ring-indigo-300 dark:ring-indigo-600/60 hover:ring-indigo-400 dark:hover:ring-indigo-500'
                      : 'bg-white dark:bg-slate-800 ring-slate-200/60 dark:ring-slate-700/60 hover:ring-indigo-300/60 dark:hover:ring-indigo-600/40'
                  }`}
                >
                  {/* Image */}
                  <div className="relative aspect-[4/3] bg-slate-100 dark:bg-slate-700/50">
                    {listing.images && listing.images.length > 0 ? (
                      <img
                        src={listing.images[0]}
                        alt={listing.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
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
                      className="absolute top-2.5 right-2.5 p-1.5 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-lg hover:bg-white dark:hover:bg-slate-700 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                      aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                    >
                      <HeartIcon
                        className={`w-4 h-4 ${isFavorite ? 'text-red-500 fill-current' : 'text-slate-400'}`}
                      />
                    </button>

                    {/* Category Badge */}
                    <span className="absolute top-2.5 left-2.5 px-2 py-0.5 bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm text-xs font-medium rounded-md text-slate-700 dark:text-slate-300 flex items-center gap-1 shadow-sm">
                      <IconComponent className="w-3 h-3" />
                      {getCategoryName(listing.category)}
                    </span>

                    {/* Your Listing Badge */}
                    {isOwner && (
                      <span className="absolute bottom-2 left-2 px-2 py-0.5 bg-indigo-600/90 backdrop-blur-sm text-[10px] font-semibold rounded-md text-white shadow-sm">
                        Your Listing
                      </span>
                    )}
                  </div>

                  {/* Content */}
                  <div className="p-2.5 sm:p-3.5">
                    <h3 className="font-semibold text-xs sm:text-sm text-slate-800 dark:text-slate-200 mb-1 sm:mb-1.5 line-clamp-2 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors duration-150">
                      {listing.title}
                    </h3>

                    <p className="text-slate-500 dark:text-slate-400 text-[11px] sm:text-xs mb-2 sm:mb-3 line-clamp-2 leading-relaxed hidden sm:block">
                      {listing.description}
                    </p>

                    {/* Price */}
                    <div className="flex items-center justify-between mb-1.5 sm:mb-2.5">
                      <span className="text-sm sm:text-lg font-bold text-indigo-600 dark:text-indigo-400">
                        {listing.price ? `₦${listing.price.toLocaleString()}` : 'Free'}
                      </span>
                      {(() => {
                        const avgRating = listing.reviews && listing.reviews.length > 0
                          ? listing.reviews.reduce((sum, r) => sum + r.rating, 0) / listing.reviews.length
                          : 0;
                        return avgRating > 0 ? (
                          <div className="flex items-center text-xs text-slate-400 dark:text-slate-500">
                            <StarIcon className="w-3.5 h-3.5 mr-0.5 text-amber-400 fill-current" />
                            <span>{avgRating.toFixed(1)}</span>
                          </div>
                        ) : null;
                      })()}
                    </div>

                    {/* Location and Time */}
                    <div className="flex items-center justify-between text-[10px] sm:text-xs text-slate-400 dark:text-slate-500 pt-1.5 sm:pt-2.5 border-t border-slate-100 dark:border-slate-700">
                      <div className="flex items-center gap-1 truncate mr-1 sm:mr-2">
                        <MapPinIcon className="w-3 h-3 sm:w-3.5 sm:h-3.5 flex-shrink-0" />
                        <span className="truncate">{listing.location || 'Not specified'}</span>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0 hidden sm:flex">
                        <ClockIcon className="w-3.5 h-3.5" />
                        <span>{new Date(listing.created_at).toLocaleDateString()}</span>
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