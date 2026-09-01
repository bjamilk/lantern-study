import { classifyListing, searchTaxonomy } from './classify';
import {
  MARKETPLACE_DEPARTMENTS,
  browseListingCategories,
  defaultLeafForListingCategory,
  getTaxonomyLeaves,
  getTaxonomyPath,
  isAllowedListingCategory,
  knownListingCategories,
  taxonomyForest,
  taxonomyPathLabel,
} from './taxonomy';

describe('campus listing taxonomy', () => {
  it('covers every historical listing category as at least one leaf', () => {
    const ids = new Set(knownListingCategories());
    for (const expected of [
      'textbook_exchange',
      'pq_bank',
      'study_pack',
      'lecture_notes',
      'project_thesis',
      'data_collection',
      'equipment_rental',
      'accommodation',
      'travel_transport',
      'personal_goods',
      'aso_ebi',
      'campus_services',
      'events_social',
    ]) {
      expect(ids.has(expected)).toBe(true);
    }
  });

  it('keeps browse chips unique per listing category, in every department', () => {
    // One chip per listing category per department: a duplicate would render
    // the same filter twice in browse.
    for (const department of MARKETPLACE_DEPARTMENTS) {
      const rows = browseListingCategories(department);
      expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    }
    const study = browseListingCategories('study-materials');
    expect(study.find((row) => row.id === 'textbook_exchange')?.name).toBe(
      'Textbooks & Course Books',
    );
    const fashion = browseListingCategories('fashion-beauty');
    expect(fashion.find((row) => row.id === 'aso_ebi')?.name).toBe('Aso Ebi & Occasion Wear');
  });

  it('builds a breadcrumb for a leaf', () => {
    expect(taxonomyPathLabel('study-materials.past-questions.printed-past-questions')).toMatch(/Past questions/i);
    // Department -> category -> leaf, so the crumb names all three levels.
    expect(getTaxonomyPath('fashion-beauty.occasion-wear.aso-ebi').map((n) => n.label)).toEqual([
      'Fashion, Hair & Beauty',
      'Aso Ebi & Occasion Wear',
      'Aso ebi',
    ]);
  });

  it('accepts known and custom categories, refuses junk', () => {
    expect(isAllowedListingCategory('pq_bank')).toBe(true);
    expect(isAllowedListingCategory('custom:Tutoring')).toBe(true);
    expect(isAllowedListingCategory('other')).toBe(false);
    expect(isAllowedListingCategory('')).toBe(false);
    expect(isAllowedListingCategory('not-a-real-type')).toBe(false);
  });

  it('picks a listing-form leaf for a category (not the digital publish flow)', () => {
    const pq = defaultLeafForListingCategory('pq_bank');
    expect(pq?.id).toBe('study-materials.past-questions.printed-past-questions');
    expect(pq?.publishFlow).toBe('listing');
  });

  it('exposes a forest with grouped children', () => {
    // The tree is department -> category -> leaf, so a department's own branch
    // has categories as children and each of those has selectable leaves.
    const branches = taxonomyForest('study-materials');
    const department = branches.find((b) => b.node.id === 'study-materials');
    expect(department).toBeTruthy();
    expect(department!.children.length).toBeGreaterThan(0);
    const textbooks = department!.children.find((c) => c.node.id === 'study-materials.textbooks');
    expect(textbooks?.children.length).toBeGreaterThan(0);
    expect(textbooks?.children.every((leaf) => !!leaf.node.listingCategory)).toBe(true);
  });

  it('does not leak group nodes as selectable leaves', () => {
    for (const leaf of getTaxonomyLeaves()) {
      expect(leaf.listingCategory).toBeTruthy();
    }
  });
});

describe('classifyListing', () => {
  it('ranks printed past questions above housing for a PQ title', () => {
    const hits = classifyListing({ title: 'BIO 201 past questions 2018-2023 PDF' });
    expect(hits[0]?.node.listingCategory).toBe('pq_bank');
    expect(hits[0]?.node.id).toBe('study-materials.past-questions.printed-past-questions');
  });

  it('detects textbooks from edition language', () => {
    const hits = classifyListing({ title: 'Organic Chemistry 7th edition McGraw Hill' });
    expect(hits[0]?.node.listingCategory).toBe('textbook_exchange');
  });

  it('detects aso ebi even with lace-only wording', () => {
    const hits = classifyListing({ title: 'Aso ebi lace for convocation, 4 yards' });
    expect(hits[0]?.node.listingCategory).toBe('aso_ebi');
    expect(hits[0]?.node.id).toBe('fashion-beauty.occasion-wear.aso-ebi');
  });

  it('detects a flat from bedroom language', () => {
    const hits = classifyListing({ title: '2 bedroom flat 10 mins from UNILAG' });
    expect(hits[0]?.node.listingCategory).toBe('accommodation');
  });

  it('routes takeable banks to the digital publish flow', () => {
    const hits = classifyListing({ title: 'GST 101 question bank, 200 MCQs, timed test' });
    expect(hits[0]?.node.publishFlow).toBe('question_bank');
  });

  it('routes study packs to the digital publish flow', () => {
    const hits = classifyListing({ title: 'BIO 201 complete study pack' });
    expect(hits[0]?.node.publishFlow).toBe('study_pack');
  });

  it('prefers tutoring over notes when the title is a tutor ad', () => {
    const hits = classifyListing({ title: 'Need a tutor for MTH 101 crash class' });
    expect(hits[0]?.node.id).toBe('services.academic-services.tutoring-lessons');
  });

  it('returns nothing for an empty title', () => {
    expect(classifyListing({ title: '' })).toEqual([]);
  });
});

describe('searchTaxonomy', () => {
  it('finds leaves by synonym', () => {
    const hits = searchTaxonomy('microscope');
    expect(hits.some((h) => h.node.listingCategory === 'equipment_rental')).toBe(true);
  });

  it('finds aso ebi from gele', () => {
    const hits = searchTaxonomy('gele');
    expect(hits[0]?.node.listingCategory).toBe('aso_ebi');
  });

  it('can scope search to a department', () => {
    const hits = searchTaxonomy('hostel', { department: 'housing' });
    expect(
      hits.every(
        (h) =>
          h.node.department === 'housing' ||
          h.node.id === 'campus-essentials.everything-else.other-items',
      ),
    ).toBe(true);
  });
});
