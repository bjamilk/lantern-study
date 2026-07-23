export interface MarketplaceSearchFilterState {
  searchTerm: string;
  selectedCategory: string;
  minPrice: string;
  maxPrice: string;
  locationFilter: string;
  campusIdFilter: string;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

export interface MarketplaceSavedSearchFilters {
  search?: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  location?: string;
  campus_id?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

const optionalPrice = (value: string): number | undefined => {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const buildMarketplaceSavedSearchFilters = (
  state: MarketplaceSearchFilterState
): MarketplaceSavedSearchFilters => {
  const filters: MarketplaceSavedSearchFilters = {};
  const minPrice = optionalPrice(state.minPrice);
  const maxPrice = optionalPrice(state.maxPrice);

  if (state.searchTerm.trim()) filters.search = state.searchTerm.trim();
  if (state.selectedCategory) filters.category = state.selectedCategory;
  if (minPrice !== undefined) filters.minPrice = minPrice;
  if (maxPrice !== undefined) filters.maxPrice = maxPrice;
  if (state.locationFilter.trim()) filters.location = state.locationFilter.trim();
  // Campus is persisted only when the user explicitly selected a browse filter.
  if (state.campusIdFilter) filters.campus_id = state.campusIdFilter;
  if (state.sortBy !== 'created_at') filters.sortBy = state.sortBy;
  if (state.sortOrder !== 'desc') filters.sortOrder = state.sortOrder;

  return filters;
};

export const restoreMarketplaceSavedSearchFilters = (
  filters: MarketplaceSavedSearchFilters
): MarketplaceSearchFilterState => ({
  searchTerm: filters.search || '',
  selectedCategory: filters.category || '',
  minPrice: filters.minPrice != null ? String(filters.minPrice) : '',
  maxPrice: filters.maxPrice != null ? String(filters.maxPrice) : '',
  locationFilter: filters.location || '',
  campusIdFilter: filters.campus_id || '',
  sortBy: filters.sortBy || 'created_at',
  sortOrder: filters.sortOrder || 'desc',
});
