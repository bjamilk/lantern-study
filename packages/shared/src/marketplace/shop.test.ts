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
      category_specific_fields: { taxonomyNodeId: 'study-materials.textbooks.solutions-manual' },
    });
    expect(resolved.node?.id).toBe('study-materials.textbooks.solutions-manual');
    expect(listingTypeLabel({ category: 'textbook_exchange' })).toMatch(/textbook/i);
  });

  it('falls back to the default leaf for a category', () => {
    const resolved = resolveListingTaxonomy({ category: 'pq_bank' });
    expect(resolved.node?.id).toBe('study-materials.past-questions.printed-past-questions');
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
        taxonomyNodeId: 'study-materials.textbooks.course-textbook',
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
    const filter = browseFilterForNode('study-materials.textbooks.solutions-manual');
    expect(filter?.category).toBe('textbook_exchange');
    expect(filter?.taxonomyNodeId).toBe('study-materials.textbooks.solutions-manual');
    expect(filter?.includeUnclassified).toBe(false);
  });

  it('keeps unfiled listings out of a leaf that is one of many in its category', () => {
    // 'electronics' holds phones, laptops and power banks alike, so a listing
    // known only to be `electronics` must not surface under Smartphones.
    const filter = browseFilterForNode('electronics.phones-tablets.smartphones');
    expect(filter?.category).toBe('electronics');
    expect(filter?.includeUnclassified).toBe(false);
  });

  it('lets a node that owns its whole category absorb unfiled listings', () => {
    // Every textbook_exchange leaf lives under this group, so a listing known
    // only to be a textbook has nowhere narrower it could belong.
    const filter = browseFilterForNode('study-materials.textbooks');
    expect(filter?.categories).toEqual(['textbook_exchange']);
    expect(filter?.includeUnclassified).toBe(true);
    expect(filter?.taxonomyNodeIds).toBeUndefined();
  });

  it('filters a partial group by its descendant leaves, not by category', () => {
    // Phones and laptops are both stored as `electronics`; without the leaf
    // list, opening Phones & Tablets would show every laptop too.
    const filter = browseFilterForNode('electronics.phones-tablets');
    expect(filter?.categories).toEqual(['electronics']);
    expect(filter?.includeUnclassified).toBe(false);
    expect(filter?.taxonomyNodeIds).toContain('electronics.phones-tablets.smartphones');
    expect(filter?.taxonomyNodeIds).not.toContain('electronics.computers-laptops.laptops');
  });

  it('maps a group to descendant listing categories', () => {
    const filter = browseFilterForNode('study-materials.textbooks');
    expect(filter?.categories).toContain('textbook_exchange');
    expect(listingCategoriesUnderNode('housing.rooms-rentals')).toContain('accommodation');
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
      taxonomyNodeId: 'study-materials.notes-handouts.lecture-notes',
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
      category_specific_fields: { taxonomyNodeId: 'fashion-beauty.occasion-wear.aso-ebi' },
    });
    expect(crumbs.map((node) => node.label).join(' › ')).toMatch(/Aso ebi/i);
  });
});
