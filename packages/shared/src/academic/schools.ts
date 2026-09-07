/**
 * Instructor school affiliation (docs/phase-teach-portal-contract.md).
 *
 * Lecturers are not limited to the seeded Nigerian university catalogue.
 * Primary, secondary, college, polytechnic and university all qualify; the
 * lecturer types the school name when it is not already listed.
 */

export const SCHOOL_KINDS = [
  'primary',
  'secondary',
  'college',
  'polytechnic',
  'university',
] as const;
export type SchoolKind = (typeof SCHOOL_KINDS)[number];

/** Student academic pickers stay on tertiary catalogue rows. */
export const TERTIARY_SCHOOL_KINDS = ['university', 'polytechnic', 'college'] as const;
export type TertiarySchoolKind = (typeof TERTIARY_SCHOOL_KINDS)[number];

export const SCHOOL_NAME_MIN_LENGTH = 2;
export const SCHOOL_NAME_MAX_LENGTH = 120;
export const SCHOOL_CITY_MAX_LENGTH = 80;

export const TEACH_SIGNUP_PATH = '/signup/teach';
export const TEACH_LOGIN_PATH = '/login?next=/teach';
export const TEACH_SIGNUP_INTENT_KEY = 'lantern_teach_signup';

export function isSchoolKind(value: unknown): value is SchoolKind {
  return typeof value === 'string' && (SCHOOL_KINDS as readonly string[]).includes(value);
}

export function isTertiarySchoolKind(value: unknown): value is TertiarySchoolKind {
  return typeof value === 'string' && (TERTIARY_SCHOOL_KINDS as readonly string[]).includes(value);
}

export function schoolKindLabel(kind: SchoolKind | null | undefined): string {
  switch (kind) {
    case 'primary':
      return 'Primary school';
    case 'secondary':
      return 'Secondary / high school';
    case 'college':
      return 'College';
    case 'polytechnic':
      return 'Polytechnic';
    case 'university':
      return 'University';
    default:
      return '';
  }
}

export function schoolKindOptions(): Array<{ value: SchoolKind; label: string }> {
  return SCHOOL_KINDS.map((value) => ({ value, label: schoolKindLabel(value) }));
}

export function normalizeSchoolName(raw: unknown): string {
  if (raw == null) return '';
  return String(raw).trim().replace(/\s+/g, ' ').slice(0, SCHOOL_NAME_MAX_LENGTH);
}

export function isValidSchoolName(name: string): boolean {
  const n = normalizeSchoolName(name);
  return n.length >= SCHOOL_NAME_MIN_LENGTH && n.length <= SCHOOL_NAME_MAX_LENGTH;
}

/** URL-safe slug; collisions are resolved by the API with a numeric suffix. */
export function slugifySchoolName(name: string): string {
  const slug = normalizeSchoolName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'school';
}

export function isTeachSignupPath(pathname: string): boolean {
  const path = pathname.replace(/\/$/, '') || '/';
  return path === TEACH_SIGNUP_PATH;
}
