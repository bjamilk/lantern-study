import {
  COURSE_ANCHOR_COPY,
  courseAnchorLabel,
  courseListingCountLabel,
  hasCourseAnchor,
  isCourseAnchorId,
  validateCourseAnchor,
} from './courseAnchor';

const UUID = '3f1c2b4a-5d6e-4f70-8a91-0b2c3d4e5f60';

describe('isCourseAnchorId', () => {
  it('accepts a uuid, with or without surrounding whitespace', () => {
    expect(isCourseAnchorId(UUID)).toBe(true);
    expect(isCourseAnchorId(`  ${UUID}  `)).toBe(true);
    expect(isCourseAnchorId(UUID.toUpperCase())).toBe(true);
  });

  it('rejects anything that is not a uuid string', () => {
    expect(isCourseAnchorId('BIO 201')).toBe(false);
    expect(isCourseAnchorId('')).toBe(false);
    expect(isCourseAnchorId(null)).toBe(false);
    expect(isCourseAnchorId(undefined)).toBe(false);
    // String(42) would pass a loose check; coercion must not happen.
    expect(isCourseAnchorId(42)).toBe(false);
    expect(isCourseAnchorId({ id: UUID })).toBe(false);
  });
});

describe('validateCourseAnchor', () => {
  it('asks for a course when none was chosen', () => {
    expect(validateCourseAnchor(null)).toBe(COURSE_ANCHOR_COPY.required);
    expect(validateCourseAnchor(undefined)).toBe(COURSE_ANCHOR_COPY.required);
    expect(validateCourseAnchor('')).toBe(COURSE_ANCHOR_COPY.required);
  });

  it('distinguishes "not chosen" from "not a real course"', () => {
    expect(validateCourseAnchor('not-a-course')).toBe(COURSE_ANCHOR_COPY.invalid);
    expect(COURSE_ANCHOR_COPY.invalid).not.toBe(COURSE_ANCHOR_COPY.required);
  });

  it('passes a real course id', () => {
    expect(validateCourseAnchor(UUID)).toBeNull();
    expect(hasCourseAnchor(UUID)).toBe(true);
    expect(hasCourseAnchor(null)).toBe(false);
  });
});

describe('courseListingCountLabel', () => {
  it('reports both kinds when both exist', () => {
    expect(
      courseListingCountLabel({ listingCount: 4, questionBankCount: 3, studyPackCount: 1 })
    ).toBe('3 question banks · 1 study pack');
  });

  it('omits a zero rather than printing it', () => {
    expect(
      courseListingCountLabel({ listingCount: 2, questionBankCount: 2, studyPackCount: 0 })
    ).toBe('2 question banks');
    expect(
      courseListingCountLabel({ listingCount: 1, questionBankCount: 0, studyPackCount: 1 })
    ).toBe('1 study pack');
  });

  it('accounts for listings that are neither (a physical item filed under a course)', () => {
    expect(
      courseListingCountLabel({ listingCount: 5, questionBankCount: 1, studyPackCount: 1 })
    ).toBe('1 question bank · 1 study pack · 3 other listings');
  });

  it('never invents a breakdown it does not have', () => {
    expect(
      courseListingCountLabel({ listingCount: 3, questionBankCount: 0, studyPackCount: 0 })
    ).toBe('3 listings');
    expect(
      courseListingCountLabel({ listingCount: 0, questionBankCount: 0, studyPackCount: 0 })
    ).toBe('0 listings');
  });

  it('does not report a negative "other" when the parts exceed the total', () => {
    expect(
      courseListingCountLabel({ listingCount: 1, questionBankCount: 2, studyPackCount: 0 })
    ).toBe('2 question banks');
  });
});

describe('courseAnchorLabel', () => {
  it('joins code and title', () => {
    expect(courseAnchorLabel({ code: 'BIO 201', title: 'Introductory Biology' })).toBe(
      'BIO 201 · Introductory Biology'
    );
  });

  it('does not repeat the code as its own title', () => {
    expect(courseAnchorLabel({ code: 'BIO 201', title: 'BIO 201' })).toBe('BIO 201');
    expect(courseAnchorLabel({ code: 'BIO 201', title: 'bio 201' })).toBe('BIO 201');
    expect(courseAnchorLabel({ code: 'BIO 201', title: null })).toBe('BIO 201');
    expect(courseAnchorLabel({ code: 'BIO 201' })).toBe('BIO 201');
  });
});
