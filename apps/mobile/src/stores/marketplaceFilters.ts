export type MarketplaceBrowseTab = 'academic' | 'student-life';

export interface MarketplaceBrowseFilterState {
  searchQuery: string;
  selectedCategory: string | null;
  activeTab: MarketplaceBrowseTab;
  minPrice: string;
  maxPrice: string;
  locationFilter: string;
  campusIdFilter: string;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

const STUDENT_LIFE_CATEGORY_IDS = new Set([
  'accommodation',
  'travel_transport',
  'personal_goods',
  'aso_ebi',
  'campus_services',
  'events_social',
]);

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

export function normalizeSavedMarketplaceFilters(
  filters: Record<string, unknown>
): MarketplaceBrowseFilterState {
  const selectedCategory = stringValue(filters.category) || null;
  const savedTab = filters.activeTab;
  const activeTab: MarketplaceBrowseTab =
    savedTab === 'academic' || savedTab === 'student-life'
      ? savedTab
      : selectedCategory && STUDENT_LIFE_CATEGORY_IDS.has(selectedCategory)
        ? 'student-life'
        : 'academic';

  return {
    searchQuery: stringValue(filters.search ?? filters.query),
    selectedCategory,
    activeTab,
    minPrice: stringValue(filters.minPrice ?? filters.min_price),
    maxPrice: stringValue(filters.maxPrice ?? filters.max_price),
    locationFilter: stringValue(filters.location),
    campusIdFilter: stringValue(filters.campus_id ?? filters.campusId),
    // Wire contract, shared with the web app (marketplaceSearchFilters.ts):
    // an omitted sortBy in a saved search means created_at. Restoring it as
    // 'trending' silently changed the meaning of searches saved on web, where
    // created_at is the omitted default.
    sortBy: stringValue(filters.sortBy ?? filters.sort_by) || 'created_at',
    sortOrder:
      filters.sortOrder === 'asc' ||
      filters.sort_order === 'asc'
        ? 'asc'
        : 'desc',
  };
}

export function buildSavedMarketplaceFilters(
  state: MarketplaceBrowseFilterState
): Record<string, unknown> {
  const filters: Record<string, unknown> = {
    activeTab: state.activeTab,
  };

  if (state.searchQuery.trim()) filters.search = state.searchQuery.trim();
  if (state.selectedCategory) filters.category = state.selectedCategory;
  if (state.minPrice.trim()) filters.minPrice = state.minPrice.trim();
  if (state.maxPrice.trim()) filters.maxPrice = state.maxPrice.trim();
  if (state.locationFilter.trim()) filters.location = state.locationFilter.trim();
  if (state.campusIdFilter) filters.campus_id = state.campusIdFilter;
  // Omit only the wire default (created_at) — matching the web builder — so a
  // trending sort survives the round trip to either platform explicitly.
  if (state.sortBy !== 'created_at') filters.sortBy = state.sortBy;
  if (state.sortOrder !== 'desc') filters.sortOrder = state.sortOrder;

  return filters;
}

export function buildMarketplaceGeographyQuery(
  explicitCampusId: string
): { country_code: 'NG'; campus_id?: string } {
  return explicitCampusId
    ? { country_code: 'NG', campus_id: explicitCampusId }
    : { country_code: 'NG' };
}
