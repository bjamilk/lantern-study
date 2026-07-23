import { describe, expect, it } from 'vitest';
import {
  buildMarketplaceSavedSearchFilters,
  restoreMarketplaceSavedSearchFilters,
} from './marketplaceSearchFilters';

const baseState = {
  searchTerm: '',
  selectedCategory: '',
  minPrice: '',
  maxPrice: '',
  locationFilter: '',
  campusIdFilter: '',
  sortBy: 'created_at',
  sortOrder: 'desc' as const,
};

describe('marketplace saved-search campus filters', () => {
  it('does not persist a campus for nationwide browsing', () => {
    expect(buildMarketplaceSavedSearchFilters(baseState)).toEqual({});
  });

  it('persists an explicitly selected campus_id', () => {
    expect(
      buildMarketplaceSavedSearchFilters({
        ...baseState,
        searchTerm: 'calculator',
        campusIdFilter: 'campus-123',
      })
    ).toEqual({
      search: 'calculator',
      campus_id: 'campus-123',
    });
  });

  it('restores an explicit campus and clears it when absent', () => {
    expect(
      restoreMarketplaceSavedSearchFilters({ campus_id: 'campus-123' }).campusIdFilter
    ).toBe('campus-123');
    expect(restoreMarketplaceSavedSearchFilters({}).campusIdFilter).toBe('');
  });
});
