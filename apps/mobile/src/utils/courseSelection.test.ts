import type { Course, UserCourse } from '@lantern/shared/types';
import {
  buildYearCourseSet,
  filterInstitutions,
  formatCourseLabel,
  isSentinelCampus,
  isValidExamDateInput,
  mergeCourseOptions,
  suggestCourseCreation,
  toggleCourseSelection,
  validateAcademicYears,
} from './courseSelection';

const course = (id: string, code: string, title = `${code} title`): Course => ({
  id,
  institutionId: 'inst-1',
  code,
  title,
  isCanonical: false,
});

const enrolment = (c: Course): UserCourse => ({
  course: c,
  academicYear: '2025/2026',
  status: 'active',
});

describe('institution filtering', () => {
  it('drops the Other sentinels but keeps real campuses', () => {
    const campuses = [
      { id: '1', name: 'University of Lagos', slug: 'unilag' },
      { id: '2', name: 'Other (city in Nigeria)', slug: 'other-city-nigeria' },
      { id: '3', name: 'Other (Ghana)', slug: 'other-ghana' },
      { id: '4', name: 'Othello Polytechnic', slug: 'othello-poly' },
    ];
    expect(filterInstitutions(campuses).map(c => c.id)).toEqual(['1', '4']);
    expect(isSentinelCampus({ slug: null, name: 'Other (city in Nigeria)' })).toBe(true);
  });
});

describe('course option merging', () => {
  const mine = [enrolment(course('a', 'BIO 201', 'Genetics')), enrolment(course('b', 'CHM 101', 'General Chemistry'))];
  const results = [course('b', 'CHM 101', 'General Chemistry'), course('c', 'BIO 301', 'Ecology')];

  it('lists my courses first, de-duplicates, and honours the query', () => {
    expect(mergeCourseOptions({ myCourses: mine, searchResults: results, query: '' }).map(c => c.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(mergeCourseOptions({ myCourses: mine, searchResults: results, query: 'bio' }).map(c => c.id)).toEqual([
      'a',
      'c',
    ]);
    // "bio201" normalises to "BIO 201" and still matches.
    expect(mergeCourseOptions({ myCourses: mine, searchResults: results, query: 'bio201' }).map(c => c.id)).toEqual([
      'a',
    ]);
  });

  it('excludes already-selected ids and respects the limit', () => {
    expect(
      mergeCourseOptions({ myCourses: mine, searchResults: results, query: '', excludeIds: ['a'], limit: 1 }).map(
        c => c.id
      )
    ).toEqual(['b']);
  });
});

describe('suggestCourseCreation', () => {
  it('offers to add a normalised code that is not already visible', () => {
    expect(suggestCourseCreation('bio 202', [course('a', 'BIO 201')])).toBe('BIO 202');
    expect(suggestCourseCreation('  phy101 ', [])).toBe('PHY 101');
  });
  it('stays quiet for prefixes, junk, or exact matches', () => {
    expect(suggestCourseCreation('bio', [])).toBeNull();
    expect(suggestCourseCreation('', [])).toBeNull();
    expect(suggestCourseCreation('BIO 201', [course('a', 'BIO 201')])).toBeNull();
    expect(suggestCourseCreation('@@@', [])).toBeNull();
  });
});

describe('selection + labels', () => {
  it('toggles a course in and out of the selection', () => {
    const a = course('a', 'BIO 201');
    const b = course('b', 'CHM 101');
    const once = toggleCourseSelection([a], b);
    expect(once.map(c => c.id)).toEqual(['a', 'b']);
    expect(toggleCourseSelection(once, a).map(c => c.id)).toEqual(['b']);
  });
  it('formats "CODE · title" and collapses empty titles', () => {
    expect(formatCourseLabel(course('a', 'BIO 201', 'Genetics'))).toBe('BIO 201 · Genetics');
    expect(formatCourseLabel(course('a', 'BIO 201', ''))).toBe('BIO 201');
    expect(formatCourseLabel(course('a', 'BIO 201', 'bio 201'))).toBe('BIO 201');
  });
});

describe('buildYearCourseSet', () => {
  const yearRow = (id: string, status: 'active' | 'archived'): Pick<UserCourse, 'course' | 'status'> => ({
    course: course(id, id.toUpperCase()),
    status,
  });

  it('adds a course and keeps existing active enrolments', () => {
    const { ids, reArchiveIds } = buildYearCourseSet([yearRow('a', 'active'), yearRow('b', 'active')], 'c');
    expect([...ids].sort()).toEqual(['a', 'b', 'c']);
    expect(reArchiveIds).toEqual([]);
  });

  it('carries archived enrolments into the PUT so they are not wiped, and flags them for re-archiving', () => {
    const { ids, reArchiveIds } = buildYearCourseSet([yearRow('a', 'active'), yearRow('old', 'archived')], 'new');
    expect([...ids].sort()).toEqual(['a', 'new', 'old']);
    expect(reArchiveIds).toEqual(['old']);
  });

  it('reactivates a previously-archived course when it is the one being added', () => {
    const { ids, reArchiveIds } = buildYearCourseSet([yearRow('a', 'active'), yearRow('x', 'archived')], 'x');
    expect([...ids].sort()).toEqual(['a', 'x']);
    expect(reArchiveIds).toEqual([]);
  });

  it('de-duplicates ids', () => {
    const { ids } = buildYearCourseSet([yearRow('a', 'active'), yearRow('a', 'active')], 'a');
    expect(ids).toEqual(['a']);
  });
});

describe('academic field validation', () => {
  it('accepts blank or real dates and rejects impossible ones', () => {
    expect(isValidExamDateInput('')).toBe(true);
    expect(isValidExamDateInput('2026-11-30')).toBe(true);
    expect(isValidExamDateInput('2026-02-30')).toBe(false);
    expect(isValidExamDateInput('30/11/2026')).toBe(false);
  });
  it('orders entry and graduation years', () => {
    expect(validateAcademicYears(null, null)).toBeNull();
    expect(validateAcademicYears(2024, 2028)).toBeNull();
    expect(validateAcademicYears(2028, 2024)).toMatch(/before entry year/);
    expect(validateAcademicYears(1800, null)).toMatch(/Entry year/);
  });
});
