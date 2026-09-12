import { isStudyAreaSection, STUDY_AREA_SECTIONS } from './studyArea';

describe('study area sections', () => {
  it('keeps Study and Library as the two peer sections', () => {
    expect(STUDY_AREA_SECTIONS.map((section) => section.id)).toEqual(['study', 'library']);
  });

  it('accepts only those two ids', () => {
    expect(isStudyAreaSection('study')).toBe(true);
    expect(isStudyAreaSection('library')).toBe(true);
    expect(isStudyAreaSection('flashcards')).toBe(false);
    expect(isStudyAreaSection('')).toBe(false);
  });
});
