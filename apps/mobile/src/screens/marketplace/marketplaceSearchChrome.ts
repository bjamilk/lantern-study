/**
 * Pure helpers for the Shop home header chrome. Kept out of the screen so the
 * derivations that decide whether the search box is open, and what a screen
 * reader hears for Alerts and Filters, can be unit-tested without React Native.
 *
 * No bare `@lantern/shared` import here: mobile jest does not map it.
 */

/**
 * The box is expanded when the buyer asked for it OR the store still holds a
 * query (coming back from ListingDetail, Cart, a remount). Raw length, not
 * trim: a whitespace-only query is still something the buyer typed and must
 * stay visible so they can clear it.
 */
export function isSearchExpanded(searchOpen: boolean, searchQuery: string): boolean {
  return searchOpen || searchQuery.length > 0;
}

/**
 * Whether the Shop home's quick band draws its own Cart and You.
 *
 * The contextual row below (spec v3 §7.2) is Browse · Cart · You, and it is on
 * screen on this surface, so the band's own pair was the same two doors twice
 * within a thumb's width — the duplication the build-166 pass called out. The
 * row replaces them, with one exception it cannot cover: the row stands down
 * while the soft keyboard is up (contextualBarLayout.ts), and the search box
 * being expanded is exactly when the keyboard is up. So the band keeps the pair
 * for that state and hands them back the moment the box collapses. Alerts and
 * Sell are unaffected: neither is in the row.
 */
export function showsBandCartAndYou(searchExpanded: boolean): boolean {
  return searchExpanded;
}

export function alertsLabel(n: number): string {
  return n <= 0 ? 'Alerts' : n === 1 ? 'Alerts, 1 new match' : `Alerts, ${n} new matches`;
}

export function filtersLabel(n: number): string {
  return n > 0 ? `Filters, ${n} active` : 'Filters';
}

export function countActiveFilters(f: {
  minPrice: string;
  maxPrice: string;
  locationFilter: string;
  campusIdFilter: string;
  conditionFilter: string;
  minRating: number | null;
  sortBy: string;
  sortOrder: string;
  selectedCategory: string | null;
}): number {
  return (
    [f.minPrice, f.maxPrice, f.locationFilter, f.campusIdFilter, f.conditionFilter].filter(Boolean)
      .length +
    (f.minRating != null ? 1 : 0) +
    (f.sortBy !== 'trending' || f.sortOrder !== 'desc' ? 1 : 0) +
    // The category chip is gone from the chrome; the count is its only trace.
    (f.selectedCategory ? 1 : 0)
  );
}
