import {
  ACADEMIC_YEAR_RE,
  STUDY_LEVELS,
  currentAcademicYear,
  isValidAcademicYear,
  isValidCourseCode,
  isValidStudyLevel,
  normalizeCourseCode,
  studyLevelLabel,
  suggestCourseCodeFromTitle,
} from './courses';

describe('normalizeCourseCode', () => {
  it.each([
    ['bio201', 'BIO 201'],
    ['BIO201', 'BIO 201'],
    ['  bio   201 ', 'BIO 201'],
    ['Bio\t201', 'BIO 201'],
    ['BIO 201', 'BIO 201'],
    ['gns-101', 'GNS-101'],
    ['chm101.2', 'CHM 101.2'],
    ['mth 101l', 'MTH 101L'],
  ])('normalises %j to %j', (input, expected) => {
    expect(normalizeCourseCode(input)).toBe(expected);
  });

  it('returns an empty string for empty or non-string input', () => {
    expect(normalizeCourseCode('')).toBe('');
    expect(normalizeCourseCode('   ')).toBe('');
    expect(normalizeCourseCode(null)).toBe('');
    expect(normalizeCourseCode(undefined)).toBe('');
  });

  it('is idempotent', () => {
    const once = normalizeCourseCode('bio201');
    expect(normalizeCourseCode(once)).toBe(once);
  });
});

describe('isValidCourseCode', () => {
  it('accepts normalised catalogue-style codes', () => {
    for (const code of ['BIO 201', 'GNS-101', 'CHM 101.2', 'ENG 201/1', 'MTH 101L']) {
      expect(isValidCourseCode(code)).toBe(true);
    }
  });

  it('rejects too-short, too-long and junk codes', () => {
    expect(isValidCourseCode('B')).toBe(false);
    expect(isValidCourseCode('A'.repeat(21))).toBe(false);
    expect(isValidCourseCode('BIO 201!')).toBe(false);
    expect(isValidCourseCode(' BIO 201')).toBe(false);
  });
});

describe('suggestCourseCodeFromTitle', () => {
  it('keeps a single-word subject as an uppercase code', () => {
    expect(suggestCourseCodeFromTitle('Mathematics')).toBe('MATHEMATICS');
    expect(suggestCourseCodeFromTitle('english')).toBe('ENGLISH');
  });

  it('uses initials for multi-word titles', () => {
    expect(suggestCourseCodeFromTitle('Primary 5 Science')).toBe('P5S');
    expect(suggestCourseCodeFromTitle('Cell Biology')).toBe('CB');
  });

  it('returns empty for blank input', () => {
    expect(suggestCourseCodeFromTitle('')).toBe('');
    expect(suggestCourseCodeFromTitle('   ')).toBe('');
  });
});

describe('currentAcademicYear', () => {
  it('rolls into the new session in September', () => {
    expect(currentAcademicYear(new Date(2026, 8, 1))).toBe('2026/2027'); // 1 Sept 2026
    expect(currentAcademicYear(new Date(2026, 11, 31))).toBe('2026/2027');
  });

  it('stays on the previous session until August', () => {
    expect(currentAcademicYear(new Date(2026, 0, 15))).toBe('2025/2026');
    expect(currentAcademicYear(new Date(2026, 7, 31))).toBe('2025/2026'); // 31 Aug 2026
  });

  it('always produces a valid academic year', () => {
    expect(isValidAcademicYear(currentAcademicYear())).toBe(true);
  });
});

describe('isValidAcademicYear', () => {
  it('accepts consecutive YYYY/YYYY+1', () => {
    expect(isValidAcademicYear('2026/2027')).toBe(true);
    expect(ACADEMIC_YEAR_RE.test('2026/2027')).toBe(true);
  });

  it('rejects non-consecutive, malformed or out-of-range values', () => {
    for (const value of ['2026/2028', '2027/2026', '2026-2027', '26/27', '2026', '', '1989/1990', '2101/2102']) {
      expect(isValidAcademicYear(value)).toBe(false);
    }
    expect(isValidAcademicYear(null)).toBe(false);
    expect(isValidAcademicYear(2026)).toBe(false);
  });
});

describe('study levels', () => {
  it('exposes 100..900 in hundreds', () => {
    expect(STUDY_LEVELS).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900]);
  });

  it('labels levels the Nigerian way', () => {
    expect(studyLevelLabel(100)).toBe('100 level');
    expect(studyLevelLabel(null)).toBe('');
  });

  it('validates levels', () => {
    expect(isValidStudyLevel(300)).toBe(true);
    expect(isValidStudyLevel(350)).toBe(false);
    expect(isValidStudyLevel('300')).toBe(false);
  });
});
