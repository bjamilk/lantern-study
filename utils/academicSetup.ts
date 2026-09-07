/**
 * Pure helpers behind the "Set up your profile" step, the Academic settings
 * section and the course pickers (Phase 1 A/F). Kept free of React/DOM so
 * apps/web/src/academicSetup.test.ts can exercise them directly.
 */
import {
  STUDY_LEVELS,
  normalizeCourseCode,
  isValidCourseCode,
  studyLevelLabel,
  type Course,
  type UserCourse,
} from '@lantern/shared';
import { isTertiarySchoolKind } from '@lantern/shared/academic';

/** localStorage flag set by "Skip for now" on the profile-setup step. */
export const ACADEMIC_SETUP_DISMISSED_KEY = 'lantern_academic_setup_dismissed';
/** sessionStorage flag for the dashboard "Finish setting up your profile" banner. */
export const ACADEMIC_BANNER_DISMISSED_KEY = 'lantern_academic_banner_dismissed';

export interface InstitutionOption {
  id: string;
  name: string;
  city: string;
  state?: string;
  slug?: string;
  country_code?: string;
  kind?: string;
}

/** "Other (city in Nigeria)" & friends — never a valid `profiles.institution_id`. */
export function isSentinelCampus(campus: { slug?: string | null; name?: string } | null | undefined): boolean {
  if (!campus) return false;
  const slug = (campus.slug || '').toLowerCase();
  if (slug === 'other-city-nigeria' || slug.startsWith('other-')) return true;
  return (campus.name || '').trim().toLowerCase() === 'other (city in nigeria)';
}

export function filterInstitutions<T extends { slug?: string | null; name?: string; kind?: string | null }>(
  campuses: T[]
): T[] {
  return (Array.isArray(campuses) ? campuses : []).filter((c) => {
    if (isSentinelCampus(c)) return false;
    // When kind is present, student pickers stay tertiary-only.
    if (c.kind && !isTertiarySchoolKind(c.kind)) return false;
    return true;
  });
}

/** Levels offered in the setup / settings selects (100–700 per the contract). */
export const PROFILE_STUDY_LEVELS: readonly number[] = STUDY_LEVELS.filter((level) => level <= 700);

export function studyLevelOptions(): Array<{ value: number; label: string }> {
  return PROFILE_STUDY_LEVELS.map((level) => ({ value: level, label: studyLevelLabel(level) }));
}

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export interface ProfileSetupInput {
  /** Already-saved username (read-only in the step) or the typed one. */
  username: string;
  institutionId: string | null;
  studyLevel: number | null;
  /** `false` when the availability probe said the name is taken. */
  usernameAvailable?: boolean | null;
}

export interface ProfileSetupErrors {
  username?: string;
  institutionId?: string;
  studyLevel?: string;
}

/** Field-level validation for the profile setup step. Empty object = valid. */
export function validateProfileSetup(input: ProfileSetupInput): ProfileSetupErrors {
  const errors: ProfileSetupErrors = {};
  const username = (input.username || '').toLowerCase().trim();
  if (!username) {
    errors.username = 'Please choose a username.';
  } else if (!USERNAME_RE.test(username)) {
    errors.username = 'Username must be 3-20 characters, using only lowercase letters, numbers, and underscores.';
  } else if (input.usernameAvailable === false) {
    errors.username = 'This username is already taken. Please choose another.';
  }
  // Institution is OPTIONAL: a student from an unlisted school (or outside
  // Nigeria) must be able to finish setup. The picker's "My institution isn't
  // listed" option saves institutionId null and continues (programme stays as
  // free text). Only the username is truly required here.
  if (input.studyLevel == null || !PROFILE_STUDY_LEVELS.includes(input.studyLevel)) {
    errors.studyLevel = 'Pick your current level.';
  }
  return errors;
}

export function isProfileSetupValid(input: ProfileSetupInput): boolean {
  return Object.keys(validateProfileSetup(input)).length === 0;
}

/**
 * Whether the setup step should open on its own: no username (existing
 * trigger) OR a known-missing institution that the user has not dismissed.
 * `institutionId === undefined` means the profile has not been loaded with the
 * academic columns yet — never nag on unknown.
 */
export function shouldOpenAcademicSetup(
  user: { username?: string | null; institutionId?: string | null } | null | undefined,
  dismissed: boolean
): boolean {
  if (!user) return false;
  if (!user.username) return true;
  return user.institutionId === null && !dismissed;
}

/** Dashboard banner: institution known to be missing (after the profile loaded). */
export function needsAcademicSetup(user: { institutionId?: string | null } | null | undefined): boolean {
  return !!user && user.institutionId === null;
}

/**
 * Per-user storage key so one account's "Skip for now" can't suppress the
 * nudge for a different account sharing the browser (and so a dismissal stays
 * scoped to the user who made it). Falls back to the legacy global key when no
 * user id is supplied.
 */
export function academicSetupDismissedKey(userId?: string | null): string {
  return userId ? `${ACADEMIC_SETUP_DISMISSED_KEY}:${userId}` : ACADEMIC_SETUP_DISMISSED_KEY;
}

export function readAcademicSetupDismissed(userId?: string | null): boolean {
  try {
    return (
      typeof localStorage !== 'undefined' &&
      localStorage.getItem(academicSetupDismissedKey(userId)) === '1'
    );
  } catch {
    return false;
  }
}

export function markAcademicSetupDismissed(userId?: string | null): void {
  try {
    if (typeof localStorage !== 'undefined')
      localStorage.setItem(academicSetupDismissedKey(userId), '1');
  } catch {
    /* storage unavailable — best-effort */
  }
}

export function clearAcademicSetupDismissed(userId?: string | null): void {
  try {
    if (typeof localStorage !== 'undefined')
      localStorage.removeItem(academicSetupDismissedKey(userId));
  } catch {
    /* ignore */
  }
}

// ---------- Starter deck (onboarding) ----------

/**
 * Seed text for the onboarding starter deck. The AI generator treats it as
 * "notes", so it reads like a brief rather than a question.
 */
export function buildStarterDeckPrompt(input: {
  programme?: string | null;
  course?: { code: string; title: string } | null;
  studyLevel?: number | null;
}): string {
  const parts: string[] = [];
  const course = input.course && input.course.code ? input.course : null;
  if (course) {
    parts.push(`Starter flashcards for ${course.code}${course.title ? ` — ${course.title}` : ''}.`);
  } else {
    parts.push('Starter flashcards for my first week of university.');
  }
  if (input.programme && input.programme.trim()) {
    parts.push(`I am studying ${input.programme.trim()}${input.studyLevel ? ` (${studyLevelLabel(input.studyLevel)})` : ''}.`);
  } else if (input.studyLevel) {
    parts.push(`I am in ${studyLevelLabel(input.studyLevel)}.`);
  }
  parts.push(
    course
      ? 'Cover the core definitions, key concepts and common exam questions a student should know for this course.'
      : 'Cover study skills, note-taking and exam preparation basics.'
  );
  return parts.join(' ');
}

// ---------- Course search / pick helpers ----------

export function courseLabel(course: Pick<Course, 'code' | 'title'> | null | undefined): string {
  if (!course) return '';
  return course.title ? `${course.code} — ${course.title}` : course.code;
}

function courseMatchesQuery(course: Pick<Course, 'code' | 'title'>, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const normalized = normalizeCourseCode(q).toLowerCase();
  return (
    course.code.toLowerCase().includes(q) ||
    course.code.toLowerCase().includes(normalized) ||
    (course.title || '').toLowerCase().includes(q)
  );
}

/**
 * Picker ordering: my active courses (matching the query) first, then the
 * catalogue search results that are not already in that list, minus ids the
 * caller wants hidden (e.g. already selected in a multi-select).
 */
export function mergeCourseOptions(
  myCourses: ReadonlyArray<UserCourse>,
  searchResults: ReadonlyArray<Course>,
  query: string,
  excludeIds: ReadonlyArray<string> = []
): Course[] {
  const excluded = new Set(excludeIds);
  const seen = new Set<string>();
  const out: Course[] = [];
  for (const uc of myCourses) {
    if (!uc || uc.status !== 'active' || !uc.course) continue;
    if (excluded.has(uc.course.id) || seen.has(uc.course.id)) continue;
    if (!courseMatchesQuery(uc.course, query)) continue;
    seen.add(uc.course.id);
    out.push(uc.course);
  }
  for (const course of searchResults) {
    if (!course || excluded.has(course.id) || seen.has(course.id)) continue;
    seen.add(course.id);
    out.push(course);
  }
  return out;
}

export interface CreateCourseOffer {
  /** Normalised code to create, e.g. "BIO 201". */
  code: string;
}

/**
 * Decide whether the picker should show an "Add ‘CODE’" row for the typed
 * query: the query must normalise to a valid code that no visible option
 * already has.
 */
export function createCourseOffer(
  query: string,
  options: ReadonlyArray<Pick<Course, 'code'>>,
  flags: { requireDigit?: boolean } = {}
): CreateCourseOffer | null {
  const code = normalizeCourseCode(query);
  if (!code || !isValidCourseCode(code)) return null;
  // Student pickers only offer "add" for catalogue-shaped codes (letters + digits).
  // Instructors may add letter-only subjects (MATH, ENGLISH) when requireDigit is false.
  if (!/[A-Z]/.test(code)) return null;
  if (flags.requireDigit !== false && !/\d/.test(code)) return null;
  const exists = options.some((o) => normalizeCourseCode(o.code) === code);
  return exists ? null : { code };
}

/** Title fallback when the user adds a code without typing a title. */
export function defaultCourseTitle(code: string): string {
  return code;
}

export function activeUserCourses(myCourses: ReadonlyArray<UserCourse>): UserCourse[] {
  return myCourses.filter((uc) => uc && uc.status === 'active' && uc.course);
}

export function findCourseById(myCourses: ReadonlyArray<UserCourse>, courseId: string | null | undefined): Course | null {
  if (!courseId) return null;
  const hit = myCourses.find((uc) => uc.course?.id === courseId);
  return hit?.course ?? null;
}

export interface AddCoursePlan {
  /**
   * The full id set to send to PUT /users/me/courses for the year. The PUT has
   * SET semantics — it upserts every listed id as ACTIVE and DELETES the year's
   * rows that are NOT listed — so this must include the year's ARCHIVED ids too,
   * otherwise adding one course silently deletes the user's archived enrolments
   * (and their exam dates) for that same academic year.
   */
  putIds: string[];
  /**
   * Previously-archived ids that the PUT will have reactivated to 'active'.
   * Re-PATCH each back to 'archived' so their status (and exam date / semester,
   * preserved by the upsert) survives the add.
   */
  reArchiveIds: string[];
}

/**
 * Plan for adding one course to an academic year without dropping that year's
 * archived enrolments. Pure so apps/web/src/academicSetup.test.ts can exercise
 * the union/re-archive logic directly.
 */
export function planAddCourse(
  myCourses: ReadonlyArray<UserCourse>,
  courseId: string,
  academicYear: string
): AddCoursePlan {
  const yearCourses = (Array.isArray(myCourses) ? myCourses : []).filter(
    (uc) => uc && uc.course && uc.academicYear === academicYear
  );
  const activeIds = yearCourses.filter((uc) => uc.status === 'active').map((uc) => uc.course.id);
  const archivedIds = yearCourses.filter((uc) => uc.status === 'archived').map((uc) => uc.course.id);
  const putIds = Array.from(new Set([...activeIds, ...archivedIds, courseId]));
  // The added course becomes active; if it happened to be archived we're
  // un-archiving it on purpose, so it must NOT be pushed back to archived.
  const reArchiveIds = Array.from(new Set(archivedIds)).filter((id) => id !== courseId);
  return { putIds, reArchiveIds };
}
