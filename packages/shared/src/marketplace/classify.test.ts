import { classifyListing, searchTaxonomy } from './classify';
import {
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

  it('keeps browse chips unique per listing category', () => {
    const academic = browseListingCategories('academic');
    const campus = browseListingCategories('student-life');
    expect(new Set(academic.map((row) => row.id)).size).toBe(academic.length);
    expect(new Set(campus.map((row) => row.id)).size).toBe(campus.length);
    expect(academic.find((row) => row.id === 'textbook_exchange')?.name).toBe('Textbooks');
    expect(campus.find((row) => row.id === 'aso_ebi')?.name).toBe('Fashion');
  });

  it('builds a breadcrumb for a leaf', () => {
    expect(taxonomyPathLabel('academic.materials.assessments.printed-pq')).toMatch(/Past questions/i);
    expect(getTaxonomyPath('campus.fashion.aso-ebi').map((n) => n.label)).toContain('Aso ebi & occasion wear');
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
    expect(pq?.id).toBe('academic.materials.assessments.printed-pq');
    expect(pq?.publishFlow).toBe('listing');
  });

  it('exposes a forest with grouped children', () => {
    const academic = taxonomyForest('academic');
    expect(academic.some((b) => b.node.id === 'academic')).toBe(true);
    const materials = academic[0]?.children.find((c) => c.node.id === 'academic.materials');
    expect(materials?.children.length).toBeGreaterThan(0);
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
    expect(hits[0]?.node.id).toBe('academic.materials.assessments.printed-pq');
  });

  it('detects textbooks from edition language', () => {
    const hits = classifyListing({ title: 'Organic Chemistry 7th edition McGraw Hill' });
    expect(hits[0]?.node.listingCategory).toBe('textbook_exchange');
  });

  it('detects aso ebi even with lace-only wording', () => {
    const hits = classifyListing({ title: 'Aso ebi lace for convocation, 4 yards' });
    expect(hits[0]?.node.listingCategory).toBe('aso_ebi');
    expect(hits[0]?.node.id).toBe('campus.fashion.aso-ebi');
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
    expect(hits[0]?.node.id).toBe('campus.services.tutoring');
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

  it('can scope search to campus life', () => {
    const hits = searchTaxonomy('notes', { department: 'student-life' });
    expect(hits.every((h) => h.node.department === 'student-life' || h.node.id === 'custom.other')).toBe(
      true,
    );
  });
});
