import {
  buildMarketplaceGeographyQuery,
  buildSavedMarketplaceFilters,
  normalizeSavedMarketplaceFilters,
} from './marketplaceFilters';

describe('mobile marketplace saved filters', () => {
  it('saves an explicitly selected campus without inventing one for All Nigeria', () => {
    const base = {
      searchQuery: '',
      selectedCategory: null,
      activeTab: 'study-materials' as const,
      minPrice: '',
      maxPrice: '',
      locationFilter: '',
      campusIdFilter: '',
      sortBy: 'created_at',
      sortOrder: 'desc' as const,
      taxonomyNodeId: null,
    };

    expect(buildSavedMarketplaceFilters(base)).not.toHaveProperty('campus_id');
    expect(
      buildSavedMarketplaceFilters({
        ...base,
        campusIdFilter: 'campus-123',
      })
    ).toMatchObject({ campus_id: 'campus-123' });
  });

  it('applies campus and price values from saved searches', () => {
    expect(
      normalizeSavedMarketplaceFilters({
        campus_id: 'campus-123',
        minPrice: 1000,
        max_price: '5000',
        category: 'personal_goods',
      })
    ).toMatchObject({
      campusIdFilter: 'campus-123',
      minPrice: '1000',
      maxPrice: '5000',
      selectedCategory: 'personal_goods',
      activeTab: 'housing',
    });
  });

  it('resets omitted saved-search fields to nationwide defaults', () => {
    expect(normalizeSavedMarketplaceFilters({})).toEqual({
      searchQuery: '',
      selectedCategory: null,
      // An empty saved search opens on the default department.
      activeTab: 'electronics',
      minPrice: '',
      maxPrice: '',
      locationFilter: '',
      campusIdFilter: '',
      sortBy: 'created_at',
      sortOrder: 'desc',
      taxonomyNodeId: null,
    });
  });

  it('round-trips a drilled-in department node and lets it own the tab', () => {
    const saved = buildSavedMarketplaceFilters({
      searchQuery: '',
      selectedCategory: null,
      // Deliberately mismatched: the saved tab is stale, the node is the truth.
      activeTab: 'housing' as const,
      minPrice: '',
      maxPrice: '',
      locationFilter: '',
      campusIdFilter: '',
      sortBy: 'created_at',
      sortOrder: 'desc' as const,
      taxonomyNodeId: 'study-materials.textbooks.solutions-manual',
    });
    expect(saved).toMatchObject({
      taxonomyNodeId: 'study-materials.textbooks.solutions-manual',
    });
    expect(normalizeSavedMarketplaceFilters(saved)).toMatchObject({
      taxonomyNodeId: 'study-materials.textbooks.solutions-manual',
      activeTab: 'study-materials',
    });
  });

  it('drops a node id that no longer exists instead of filtering to nothing', () => {
    expect(
      normalizeSavedMarketplaceFilters({ taxonomyNodeId: 'not.a.real.node' }).taxonomyNodeId
    ).toBeNull();
  });

  it('resolves a legacy node id forward into the new tree', () => {
    const restored = normalizeSavedMarketplaceFilters({
      taxonomyNodeId: 'campus.goods.electronics',
    });
    expect(restored.taxonomyNodeId).toBe('electronics');
    expect(restored.activeTab).toBe('electronics');
  });

  it('accepts legacy camel-case campus filters', () => {
    expect(
      normalizeSavedMarketplaceFilters({ campusId: 'legacy-campus' }).campusIdFilter
    ).toBe('legacy-campus');
  });

  it('queries all Nigeria unless a campus filter was explicitly selected', () => {
    expect(buildMarketplaceGeographyQuery('')).toEqual({ country_code: 'NG' });
    expect(buildMarketplaceGeographyQuery('campus-123')).toEqual({
      country_code: 'NG',
      campus_id: 'campus-123',
    });
  });
});
