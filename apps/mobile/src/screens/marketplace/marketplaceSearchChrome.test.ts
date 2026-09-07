import {
  alertsLabel,
  countActiveFilters,
  filtersLabel,
  isSearchExpanded,
  showsBandCartAndYou,
} from './marketplaceSearchChrome';

describe('isSearchExpanded', () => {
  it('is collapsed only when closed and the query is empty', () => {
    expect(isSearchExpanded(false, '')).toBe(false);
  });

  it('is expanded when the buyer opened the box', () => {
    expect(isSearchExpanded(true, '')).toBe(true);
  });

  it('is expanded when the store still holds a query', () => {
    expect(isSearchExpanded(false, 'laptop')).toBe(true);
  });

  it('treats a whitespace-only query as something to show and clear', () => {
    expect(isSearchExpanded(false, '   ')).toBe(true);
  });
});

describe('alertsLabel', () => {
  it('reads plain Alerts with nothing new', () => {
    expect(alertsLabel(0)).toBe('Alerts');
  });

  it('singularises one match', () => {
    expect(alertsLabel(1)).toBe('Alerts, 1 new match');
  });

  it('pluralises several matches', () => {
    expect(alertsLabel(5)).toBe('Alerts, 5 new matches');
  });
});

describe('filtersLabel', () => {
  it('reads plain Filters with none active', () => {
    expect(filtersLabel(0)).toBe('Filters');
  });

  it('announces the active count', () => {
    expect(filtersLabel(3)).toBe('Filters, 3 active');
  });
});

describe('countActiveFilters', () => {
  const baseline = {
    minPrice: '',
    maxPrice: '',
    locationFilter: '',
    campusIdFilter: '',
    conditionFilter: '',
    minRating: null,
    sortBy: 'trending',
    sortOrder: 'desc',
    selectedCategory: null,
  };

  it('counts nothing at the defaults', () => {
    expect(countActiveFilters(baseline)).toBe(0);
  });

  it('counts a selected category now that its chip is gone', () => {
    expect(countActiveFilters({ ...baseline, selectedCategory: 'textbooks' })).toBe(1);
  });

  it('counts a non-default sort field', () => {
    expect(countActiveFilters({ ...baseline, sortBy: 'created_at' })).toBe(1);
  });

  it('counts a non-default sort order even on the default field', () => {
    expect(countActiveFilters({ ...baseline, sortOrder: 'asc' })).toBe(1);
  });

  it('counts every filter when all are set', () => {
    expect(
      countActiveFilters({
        minPrice: '100',
        maxPrice: '5000',
        locationFilter: 'Yaba',
        campusIdFilter: 'unilag',
        conditionFilter: 'used',
        minRating: 4,
        sortBy: 'price',
        sortOrder: 'asc',
        selectedCategory: 'textbooks',
      }),
    ).toBe(8);
  });
});

describe('showsBandCartAndYou', () => {
  it('leaves Cart and You to the contextual row while the box is collapsed', () => {
    // The build-166 duplication: the row is Browse · Cart · You and the band
    // drew its own pair a thumb away from it.
    expect(showsBandCartAndYou(false)).toBe(false);
  });

  it('draws them while the search box is expanded, where the row stands down', () => {
    // The row hides under the keyboard by design (contextualBarLayout.ts), and
    // an expanded box means a keyboard — so a buyer mid-search keeps a route
    // to the cart and the You hub without wiping the query.
    expect(showsBandCartAndYou(true)).toBe(true);
  });
});
