import { deriveStudyProductTitle } from './studyProductTitle';

describe('deriveStudyProductTitle', () => {
  it('drops the library deck "From: " prefix', () => {
    expect(deriveStudyProductTitle('From: SDOH')).toBe('SDOH');
  });

  // The reported listing: a pack seeded from a deck named after an upload.
  it('turns a filename-derived deck name into a human title', () => {
    expect(deriveStudyProductTitle('From: N448_Gas_Exchange_Study_Guide')).toBe(
      'N448 Gas Exchange Study Guide'
    );
  });

  it('strips a leading epoch/id prefix and underscores', () => {
    expect(deriveStudyProductTitle('1782589411975-Gestational_Diabetes_PPT')).toBe(
      'Gestational Diabetes PPT'
    );
  });

  it('drops a leading stray separator left by a name that began with "-"', () => {
    expect(deriveStudyProductTitle('-Gestational_Diabetes_PPT')).toBe('Gestational Diabetes PPT');
  });

  it('drops a trailing file extension', () => {
    expect(deriveStudyProductTitle('Cell Biology Notes.pdf')).toBe('Cell Biology Notes');
    expect(deriveStudyProductTitle('From: lecture_slides.PPTX')).toBe('lecture slides');
  });

  it('leaves an already-clean title untouched', () => {
    expect(deriveStudyProductTitle('Cell Biology — Complete Study Pack')).toBe(
      'Cell Biology — Complete Study Pack'
    );
  });

  it('keeps a hyphen inside a word', () => {
    expect(deriveStudyProductTitle('Anti-inflammatory drugs')).toBe('Anti-inflammatory drugs');
  });

  it('collapses runs of whitespace', () => {
    expect(deriveStudyProductTitle('  Renal   Physiology  ')).toBe('Renal Physiology');
  });

  it('returns empty for nothing usable, so the caller starts the field blank', () => {
    expect(deriveStudyProductTitle('From: ')).toBe('');
    expect(deriveStudyProductTitle('   ')).toBe('');
    expect(deriveStudyProductTitle(undefined)).toBe('');
    expect(deriveStudyProductTitle(null)).toBe('');
  });
});
