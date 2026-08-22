import { describe, expect, it } from 'vitest';
import {
  buildStarterDeckPrompt,
  createCourseOffer,
  filterInstitutions,
  isSentinelCampus,
  mergeCourseOptions,
  needsAcademicSetup,
  planAddCourse,
  shouldOpenAcademicSetup,
  studyLevelOptions,
  validateProfileSetup,
} from '../../../utils/academicSetup';
import type { Course, UserCourse } from '../../../types';

const course = (id: string, code: string, title = code): Course => ({
  id,
  institutionId: 'inst-1',
  code,
  title,
  isCanonical: false,
});

const enrolment = (
  c: Course,
  status: 'active' | 'archived' = 'active',
  academicYear = '2026/2027'
): UserCourse => ({
  course: c,
  academicYear,
  status,
});

describe('institution filtering', () => {
  it('drops the "Other …" sentinel campuses', () => {
    expect(isSentinelCampus({ slug: 'other-city-nigeria', name: 'Other (city in Nigeria)' })).toBe(true);
    expect(isSentinelCampus({ slug: 'other-lagos', name: 'Other' })).toBe(true);
    expect(isSentinelCampus({ slug: 'unilag', name: 'University of Lagos' })).toBe(false);
    expect(isSentinelCampus({ name: 'Other (city in Nigeria)' })).toBe(true);
    expect(
      filterInstitutions([
        { id: '1', name: 'University of Lagos', slug: 'unilag' },
        { id: '2', name: 'Other (city in Nigeria)', slug: 'other-city-nigeria' },
      ]).map((c) => c.id),
    ).toEqual(['1']);
  });
});

describe('validateProfileSetup', () => {
  it('requires username and a 100-700 level, but not institution', () => {
    const errors = validateProfileSetup({ username: '', institutionId: null, studyLevel: null });
    expect(Object.keys(errors).sort()).toEqual(['studyLevel', 'username']);
  });

  it('accepts a saved profile with no institution (unlisted / non-Nigerian school)', () => {
    // The activation dead-end fix: institution is optional so students from an
    // unlisted school can finish setup by choosing "My institution isn't listed".
    expect(validateProfileSetup({ username: 'jane_doe', institutionId: null, studyLevel: 100 })).toEqual({});
  });

  it('rejects malformed or taken usernames', () => {
    expect(validateProfileSetup({ username: 'ab', institutionId: 'i', studyLevel: 100 }).username).toMatch(/3-20/);
    expect(
      validateProfileSetup({ username: 'jane_doe', institutionId: 'i', studyLevel: 100, usernameAvailable: false })
        .username,
    ).toMatch(/already taken/);
  });

  it('rejects levels outside the offered range', () => {
    expect(validateProfileSetup({ username: 'jane_doe', institutionId: 'i', studyLevel: 800 }).studyLevel).toBeTruthy();
    expect(validateProfileSetup({ username: 'jane_doe', institutionId: 'i', studyLevel: 300 })).toEqual({});
    expect(studyLevelOptions().map((o) => o.value)).toEqual([100, 200, 300, 400, 500, 600, 700]);
    expect(studyLevelOptions()[0]?.label).toBe('100 level');
  });
});

describe('setup triggers', () => {
  it('opens for a missing username regardless of dismissal', () => {
    expect(shouldOpenAcademicSetup({ username: '', institutionId: null }, true)).toBe(true);
  });

  it('opens for a known-missing institution until dismissed', () => {
    expect(shouldOpenAcademicSetup({ username: 'jane', institutionId: null }, false)).toBe(true);
    expect(shouldOpenAcademicSetup({ username: 'jane', institutionId: null }, true)).toBe(false);
    expect(shouldOpenAcademicSetup({ username: 'jane', institutionId: 'inst-1' }, false)).toBe(false);
  });

  it('never nags while the academic fields are unknown (profile not loaded yet)', () => {
    expect(shouldOpenAcademicSetup({ username: 'jane' }, false)).toBe(false);
    expect(needsAcademicSetup({ institutionId: undefined })).toBe(false);
    expect(needsAcademicSetup({ institutionId: null })).toBe(true);
    expect(needsAcademicSetup(null)).toBe(false);
  });
});

describe('course picker helpers', () => {
  const bio = course('c1', 'BIO 201', 'General Biology II');
  const chm = course('c2', 'CHM 101', 'General Chemistry');
  const mth = course('c3', 'MTH 101', 'Elementary Mathematics');

  it('lists my active courses first, then search results, without duplicates', () => {
    const merged = mergeCourseOptions([enrolment(chm), enrolment(mth, 'archived')], [bio, chm], '');
    expect(merged.map((c) => c.id)).toEqual(['c2', 'c1']);
  });

  it('filters my courses by the query (normalised code or title)', () => {
    const merged = mergeCourseOptions([enrolment(chm), enrolment(bio)], [], 'bio201');
    expect(merged.map((c) => c.id)).toEqual(['c1']);
    expect(mergeCourseOptions([enrolment(chm)], [], 'chemistry').map((c) => c.id)).toEqual(['c2']);
  });

  it('hides excluded ids (already selected)', () => {
    expect(mergeCourseOptions([enrolment(chm)], [bio], '', ['c1']).map((c) => c.id)).toEqual(['c2']);
  });

  it('offers to add a normalised code that is not in the options', () => {
    expect(createCourseOffer('bio201', [chm])).toEqual({ code: 'BIO 201' });
    expect(createCourseOffer(' gst  101 ', [])).toEqual({ code: 'GST 101' });
  });

  it('does not offer a create for matches, titles, or junk', () => {
    expect(createCourseOffer('bio 201', [bio])).toBeNull();
    expect(createCourseOffer('biology', [])).toBeNull();
    expect(createCourseOffer('201', [])).toBeNull();
    expect(createCourseOffer('', [])).toBeNull();
    expect(createCourseOffer('x'.repeat(30), [])).toBeNull();
  });
});

describe('buildStarterDeckPrompt', () => {
  it('mentions the course, programme and level when known', () => {
    const prompt = buildStarterDeckPrompt({
      programme: 'Biochemistry',
      studyLevel: 200,
      course: { code: 'BIO 201', title: 'General Biology II' },
    });
    expect(prompt).toContain('BIO 201 — General Biology II');
    expect(prompt).toContain('Biochemistry (200 level)');
    expect(prompt).toMatch(/exam questions/);
  });

  it('falls back to a generic brief', () => {
    const prompt = buildStarterDeckPrompt({});
    expect(prompt).toContain('first week of university');
    expect(prompt).not.toContain('undefined');
  });
});

describe('planAddCourse (archive-safe enrolment add)', () => {
  const bio = course('c1', 'BIO 201');
  const chm = course('c2', 'CHM 101');
  const mth = course('c3', 'MTH 101');
  const phy = course('c4', 'PHY 101');
  const YEAR = '2025/2026';

  it('unions the year\'s ARCHIVED ids into the PUT set so they are not deleted', () => {
    // Student archived semester 1 (CHM, MTH) then adds a semester-2 course (PHY)
    // in the SAME academic year. Without the union the PUT would delete CHM/MTH.
    const myCourses = [
      enrolment(bio, 'active', YEAR),
      enrolment(chm, 'archived', YEAR),
      enrolment(mth, 'archived', YEAR),
    ];
    const plan = planAddCourse(myCourses, phy.id, YEAR);
    expect(plan.putIds.sort()).toEqual(['c1', 'c2', 'c3', 'c4']);
    // The reactivated archived rows are re-archived afterwards.
    expect(plan.reArchiveIds.sort()).toEqual(['c2', 'c3']);
  });

  it('does not re-archive the course being added even if it was archived', () => {
    const myCourses = [enrolment(bio, 'active', YEAR), enrolment(chm, 'archived', YEAR)];
    // Re-adding the archived CHM should reactivate it and keep it active.
    const plan = planAddCourse(myCourses, chm.id, YEAR);
    expect(plan.putIds.sort()).toEqual(['c1', 'c2']);
    expect(plan.reArchiveIds).toEqual([]);
  });

  it('only touches the target year and de-dupes an already-active course', () => {
    const myCourses = [
      enrolment(bio, 'active', YEAR),
      enrolment(chm, 'archived', YEAR),
      enrolment(mth, 'active', '2024/2025'), // different year — ignored
    ];
    // Adding BIO (already active) must not duplicate it, and the other year stays out.
    const plan = planAddCourse(myCourses, bio.id, YEAR);
    expect(plan.putIds.sort()).toEqual(['c1', 'c2']);
    expect(plan.reArchiveIds).toEqual(['c2']);
  });
});
