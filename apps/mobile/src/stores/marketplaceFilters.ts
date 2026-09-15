/**
 * Saved-search filter serialisation for marketplace browse: the wire format a
 * saved search is stored in, and how to read one back into browse state.
 *
 * Main exports: `normalizeSavedMarketplaceFilters` (wire → state, with
 * forward-migration of pre-department taxonomy nodes and tabs),
 * `buildSavedMarketplaceFilters` (state → wire),
 * `buildMarketplaceGeographyQuery`, and `MarketplaceBrowseFilterState`.
 *
 * Touches: the shared marketplace taxonomy (@lantern/shared/marketplace).
 * Pure — no store, API or native access.
 *
 * Gotchas: the wire format is shared with the web app
 * (marketplaceSearchFilters.ts) and both sides treat an omitted `sortBy` as
 * `created_at` and an omitted `sortOrder` as `desc`; changing either default
 * here silently reinterprets searches saved on web. `activeTab` is derived
 * from the saved taxonomy node first, so a node that moved department
 * restores under its new tab rather than the stale saved one.
 */
import {
  MARKETPLACE_DEPARTMENTS,
  browseListingCategories,
  getTaxonomyNode,
  resolveTaxonomyNodeId,
  type MarketplaceDepartment,
} from '@lantern/shared/marketplace';

/** Keep in step with DEFAULT_MARKETPLACE_TAB in marketplaceStore. */
const DEFAULT_MARKETPLACE_DEPARTMENT: MarketplaceBrowseTab = 'all';


function isMarketplaceBrowseTab(value: unknown): value is MarketplaceBrowseTab {
  return (
    value === 'all' ||
    (typeof value === 'string' &&
      (MARKETPLACE_DEPARTMENTS as readonly string[]).includes(value))
  );
}

/** Which department browses this coarse listing category. */
function departmentForListingCategory(category: string): MarketplaceDepartment | undefined {
  return MARKETPLACE_DEPARTMENTS.find((department) =>
    browseListingCategories(department).some((row) => row.id === category),
  );
}

/** Saved searches remember which browse tab they were made in. */
export type MarketplaceBrowseTab = 'all' | MarketplaceDepartment;

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
  /** The Shop-by-department node the search was drilled into, if any. */
  taxonomyNodeId: string | null;
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
  // A saved search made before the nine-department tree stores a legacy node
  // id; resolve it forward rather than dropping the buyer back to the top.
  const taxonomyNodeId =
    resolveTaxonomyNodeId(stringValue(filters.taxonomyNodeId ?? filters.taxonomy_node_id)) ?? null;
  const savedNodeDepartment = taxonomyNodeId
    ? getTaxonomyNode(taxonomyNodeId)?.department
    : undefined;
  const savedTab = filters.activeTab;
  // A saved search from before the department tree stored 'academic' or
  // 'student-life'; neither exists now, so fall back to the department that
  // actually browses the saved category, and only then to the first one.
  // The node owns the department: a node that migrated across departments would
  // otherwise restore under the stale tab it was saved in.
  const activeTab: MarketplaceBrowseTab =
    savedNodeDepartment ||
    (isMarketplaceBrowseTab(savedTab)
      ? savedTab
      : (selectedCategory && departmentForListingCategory(selectedCategory)) ||
        DEFAULT_MARKETPLACE_DEPARTMENT);

  return {
    searchQuery: stringValue(filters.search ?? filters.query),
    selectedCategory,
    activeTab,
    taxonomyNodeId,
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
  if (state.taxonomyNodeId) filters.taxonomyNodeId = state.taxonomyNodeId;
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
