import {
  browseFilterForNode,
  listingBreadcrumb,
  listingConditionLabel,
  listingSpecRows,
  listingTypeLabel,
  listingCategoriesUnderNode,
  rankRelatedListings,
  scoreRelatedListing,
  suggestMarketplaceSearch,
  resolveListingTaxonomy,
} from './shop';

describe('resolveListingTaxonomy', () => {
  it('prefers the stored taxonomy node over the coarse category', () => {
    const resolved = resolveListingTaxonomy({
      category: 'textbook_exchange',
      category_specific_fields: { taxonomyNodeId: 'academic.materials.textbooks.solutions' },
    });
    expect(resolved.node?.id).toBe('academic.materials.textbooks.solutions');
    expect(listingTypeLabel({ category: 'textbook_exchange' })).toMatch(/textbook/i);
  });

  it('falls back to the default leaf for a category', () => {
    const resolved = resolveListingTaxonomy({ category: 'pq_bank' });
    expect(resolved.node?.id).toBe('academic.materials.assessments.printed-pq');
  });
});

describe('listing specs and condition', () => {
  it('reads condition from compact top-level or CSF', () => {
    expect(listingConditionLabel({ condition: 'like-new' })).toBe('Like new');
    expect(
      listingConditionLabel({ category_specific_fields: { condition: 'good' } }),
    ).toBe('Good');
  });

  it('builds spec rows from taxonomy attributes', () => {
    const rows = listingSpecRows({
      category: 'textbook_exchange',
      category_specific_fields: {
        taxonomyNodeId: 'academic.materials.textbooks.course',
        condition: 'good',
        isbn: '9781234567897',
        edition: '7th',
      },
    });
    expect(rows.some((row) => row.key === 'isbn' && row.value.includes('978'))).toBe(true);
    expect(rows.some((row) => row.key === 'condition' && row.value === 'Good')).toBe(true);
  });
});

describe('browseFilterForNode', () => {
  it('maps a leaf to its listing category and node id', () => {
    const filter = browseFilterForNode('academic.materials.textbooks.solutions');
    expect(filter?.category).toBe('textbook_exchange');
    expect(filter?.taxonomyNodeId).toBe('academic.materials.textbooks.solutions');
    expect(filter?.includeUnclassified).toBe(false);
  });

  it('includes unclassified rows for the default leaf of a category', () => {
    const filter = browseFilterForNode('academic.materials.assessments.printed-pq');
    expect(filter?.category).toBe('pq_bank');
    expect(filter?.includeUnclassified).toBe(true);
  });

  it('maps a group to descendant listing categories', () => {
    const filter = browseFilterForNode('academic.materials.textbooks');
    expect(filter?.categories).toContain('textbook_exchange');
    expect(listingCategoriesUnderNode('campus.housing')).toContain('accommodation');
  });
});

describe('related listing ranking', () => {
  const source = {
    id: 'src',
    category: 'lecture_notes',
    campus_id: 'campus-1',
    course_id: 'course-bio',
    price: 2000,
    category_specific_fields: {
      taxonomyNodeId: 'academic.materials.notes.lecture',
      courseCode: 'BIO 201',
    },
  };

  it('ranks same course and campus above a random same-category listing', () => {
    const sameCourse = {
      id: 'a',
      category: 'pq_bank',
      campus_id: 'campus-1',
      course_id: 'course-bio',
      price: 1800,
    };
    const random = {
      id: 'b',
      category: 'lecture_notes',
      campus_id: 'other',
      price: 9000,
    };
    expect(scoreRelatedListing(source, sameCourse)).toBeGreaterThan(
      scoreRelatedListing(source, random),
    );
    const ranked = rankRelatedListings(source, [random, sameCourse], 2);
    expect(ranked[0]?.id).toBe('a');
  });

  it('drops the source listing from related results', () => {
    expect(rankRelatedListings(source, [source, { id: 'other', category: 'lecture_notes' }], 6)).toEqual([
      { id: 'other', category: 'lecture_notes' },
    ]);
  });
});

describe('suggestMarketplaceSearch', () => {
  it('leads with a search-for query and recents', () => {
    const hits = suggestMarketplaceSearch('bio', { recents: ['BIO 201 past questions', 'aso ebi'] });
    expect(hits[0]?.kind).toBe('query');
    expect(hits.some((hit) => hit.kind === 'recent' && hit.label.includes('BIO'))).toBe(true);
  });

  it('suggests listing types from campus language', () => {
    const hits = suggestMarketplaceSearch('past questions');
    expect(hits.some((hit) => hit.kind === 'type' && hit.kind === 'type' && 'listingCategory' in hit && hit.listingCategory === 'pq_bank')).toBe(
      true,
    );
  });

  it('suggests aso ebi from gele', () => {
    const hits = suggestMarketplaceSearch('gele');
    expect(hits.some((hit) => hit.kind === 'type' && hit.label.toLowerCase().includes('aso'))).toBe(
      true,
    );
  });

  it('returns recents when the query is empty', () => {
    const hits = suggestMarketplaceSearch('', { recents: ['hostel around unilag'] });
    expect(hits.some((hit) => hit.kind === 'recent')).toBe(true);
  });
});

describe('listingBreadcrumb', () => {
  it('walks from department to the leaf', () => {
    const crumbs = listingBreadcrumb({
      category: 'aso_ebi',
      category_specific_fields: { taxonomyNodeId: 'campus.fashion.aso-ebi' },
    });
    expect(crumbs.map((node) => node.label).join(' › ')).toMatch(/Aso ebi/i);
  });
});
