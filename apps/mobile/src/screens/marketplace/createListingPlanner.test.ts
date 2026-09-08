import { isListingTypeChosen } from './createListingPlanner';

describe('isListingTypeChosen', () => {
  it('is false on a brand-new form (nothing picked)', () => {
    expect(isListingTypeChosen({ category: null, taxonomyNodeId: '' })).toBe(false);
  });

  it('is true once the classifier commits a leaf (node + category together)', () => {
    expect(
      isListingTypeChosen({ category: 'textbook_exchange', taxonomyNodeId: 'study-materials.textbooks.course-textbook' })
    ).toBe(true);
  });

  it('is true for the "Something else" leaf (category other + its node id)', () => {
    expect(isListingTypeChosen({ category: 'other', taxonomyNodeId: 'other' })).toBe(true);
  });

  it('is false when only one half is set', () => {
    expect(isListingTypeChosen({ category: 'textbook_exchange', taxonomyNodeId: '' })).toBe(false);
    expect(isListingTypeChosen({ category: null, taxonomyNodeId: 'study-materials.textbooks.course-textbook' })).toBe(
      false
    );
  });
});
