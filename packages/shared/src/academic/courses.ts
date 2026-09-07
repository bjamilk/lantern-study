/**
 * Academic identity helpers shared by the API, web and mobile.
 *
 * Course codes are the join key of the whole academic archive (one `courses`
 * row per institution + code), so every writer must normalise the same way:
 * trim → collapse whitespace → uppercase → a single space between the
 * alphabetic prefix and the digits ("bio201" → "BIO 201").
 *
 * Academic years follow the Nigerian calendar: a session starts in September,
 * so September onwards belongs to "YYYY/YYYY+1" and January–August to
 * "YYYY-1/YYYY".
 */

export const COURSE_CODE_MAX_LENGTH = 20;
export const COURSE_CODE_MIN_LENGTH = 2;
export const COURSE_TITLE_MAX_LENGTH = 200;
export const COURSE_TITLE_MIN_LENGTH = 2;

/** Letters, digits, spaces and the separators real catalogues use (BIO 201, GNS-101, CHM 101.2, ENG 201/1). */
const COURSE_CODE_ALLOWED_RE = /^[A-Z0-9][A-Z0-9 ./-]*$/;

/**
 * Normalise a user-typed course code so equal codes collide on one row.
 * Non-string / empty input returns "".
 */
export function normalizeCourseCode(raw: unknown): string {
  if (raw == null) return "";
  const collapsed = String(raw).trim().replace(/\s+/g, " ").toUpperCase();
  if (!collapsed) return "";
  // Insert one space between the alphabetic prefix and the first digit when
  // missing ("BIO201" → "BIO 201"). Already-spaced codes are left alone.
  return collapsed.replace(/^([A-Z]+)(\d)/, "$1 $2");
}

/** True when a (normalised) code is something we are willing to store. */
export function isValidCourseCode(code: string): boolean {
  if (typeof code !== "string") return false;
  if (code.length < COURSE_CODE_MIN_LENGTH || code.length > COURSE_CODE_MAX_LENGTH) {
    return false;
  }
  return COURSE_CODE_ALLOWED_RE.test(code);
}

/**
 * Short code from a subject title so primary/secondary lecturers can create
 * "Mathematics" without a university-style "BIO 201". Single words keep a
 * sliced uppercase form (MATHEMATICS → MATHEMATICS); multi-word titles use
 * initials (Primary 5 Science → P5S).
 */
export function suggestCourseCodeFromTitle(raw: unknown): string {
  const cleaned = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ');
  if (!cleaned) return '';
  const words = cleaned.split(' ').filter(Boolean);
  const first = words[0] ?? '';
  if (words.length === 1) return normalizeCourseCode(first.slice(0, COURSE_CODE_MAX_LENGTH));
  const initials = words.map((word) => word[0] ?? '').join('').slice(0, COURSE_CODE_MAX_LENGTH);
  // Initials such as P5S must not pass through normalizeCourseCode — that helper
  // inserts a space before digits for catalogue codes (BIO201 → BIO 201).
  if (isValidCourseCode(initials)) return initials;
  return normalizeCourseCode(first.slice(0, COURSE_CODE_MAX_LENGTH));
}

export const ACADEMIC_YEAR_RE = /^(\d{4})\/(\d{4})$/;
export const ACADEMIC_YEAR_MIN = 1990;
export const ACADEMIC_YEAR_MAX = 2100;

/** "2026/2027" for Sept 2026 – Aug 2027 (Nigerian session calendar). */
export function currentAcademicYear(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1; // 1-12
  return month >= 9 ? `${year}/${year + 1}` : `${year - 1}/${year}`;
}

/** "YYYY/YYYY+1" with a sane start year. */
export function isValidAcademicYear(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ACADEMIC_YEAR_RE.exec(value);
  if (!match) return false;
  const start = Number(match[1]);
  const end = Number(match[2]);
  return end === start + 1 && start >= ACADEMIC_YEAR_MIN && start <= ACADEMIC_YEAR_MAX;
}

export const STUDY_LEVELS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
export type StudyLevel = (typeof STUDY_LEVELS)[number];

export function isValidStudyLevel(value: unknown): value is StudyLevel {
  return typeof value === "number" && (STUDY_LEVELS as readonly number[]).includes(value);
}

/** "100 level" — the way Nigerian students say it. */
export function studyLevelLabel(level: number | null | undefined): string {
  if (level == null || !Number.isFinite(level)) return "";
  return `${level} level`;
}

export const COURSE_SEMESTERS = [1, 2] as const;
export type CourseSemester = (typeof COURSE_SEMESTERS)[number];

export function isValidCourseSemester(value: unknown): value is CourseSemester {
  return value === 1 || value === 2;
}

/** "First semester" / "Second semester". */
export function semesterLabel(semester: number | null | undefined): string {
  if (semester === 1) return "First semester";
  if (semester === 2) return "Second semester";
  return "";
}

/**
 * Options for the profile's semester select. One source for web + mobile so the
 * two platforms cannot drift on wording or values.
 */
export function semesterOptions(): Array<{ value: CourseSemester; label: string }> {
  return COURSE_SEMESTERS.map((value) => ({ value, label: semesterLabel(value) }));
}
