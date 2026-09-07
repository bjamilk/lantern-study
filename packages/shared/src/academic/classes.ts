/**
 * Lecturer-first class helpers (docs/phase-teach-portal-contract.md).
 *
 * Join codes are the hall QR: short, unambiguous, and independent of Canvas /
 * Google Classroom. The alphabet drops 0/O, 1/I/L so a student can type the
 * code off a projector.
 */

export const JOIN_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const JOIN_CODE_LENGTH = 6;
export const JOIN_CODE_MIN_LENGTH = 6;
export const JOIN_CODE_MAX_LENGTH = 8;

export const CLASS_TITLE_MIN_LENGTH = 2;
export const CLASS_TITLE_MAX_LENGTH = 120;
export const MAX_CLASSES_CREATED_PER_USER = 40;
export const MAX_CLASS_MEMBERS = 500;
export const MAX_CLASS_MATERIALS = 50;
export const MAX_CLASS_ASSIGNMENTS = 100;
export const CLASS_ANALYTICS_AT_RISK_DAYS = 7;
export const CLASS_GENERATE_MIN_CHARS = 50;

export const CLASS_ROLES = ['instructor', 'ta', 'student'] as const;
type ClassRole = (typeof CLASS_ROLES)[number];

export const CLASS_MEMBER_STATUSES = ['active', 'removed'] as const;

export const CLASS_MATERIAL_KINDS = ['syllabus', 'lecture', 'reading', 'slide'] as const;

export const CLASS_ASSIGNMENT_KINDS = ['test', 'deck', 'notes', 'open'] as const;

export const CLASS_ASSIGNMENT_PROGRESS_STATUSES = ['assigned', 'completed'] as const;

export const INSTITUTION_STAFF_ROLES = ['instructor', 'department_admin', 'institution_admin'] as const;
type InstitutionStaffRole = (typeof INSTITUTION_STAFF_ROLES)[number];

export const INSTITUTION_STAFF_STATUSES = ['active', 'revoked'] as const;

const JOIN_CODE_ALLOWED_RE = new RegExp(
  `^[${JOIN_CODE_ALPHABET}]{${JOIN_CODE_MIN_LENGTH},${JOIN_CODE_MAX_LENGTH}}$`
);

/** Strip spaces and lowercase lookalikes, then uppercase. */
export function normalizeJoinCode(raw: unknown): string {
  if (raw == null) return '';
  return String(raw)
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase()
    .replace(/[O]/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/0/g, '')
    .replace(/1/g, '');
}

/**
 * Normalise for lookup: keep only alphabet characters (after mapping
 * lookalikes away from 0/1, those digits are dropped because they are not
 * in the alphabet — callers should type the projected code). For matching an
 * already-stored code, uppercase + strip space is enough.
 */
export function canonicalizeJoinCode(raw: unknown): string {
  if (raw == null) return '';
  return String(raw).trim().replace(/\s+/g, '').toUpperCase();
}

export function isValidJoinCode(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return JOIN_CODE_ALLOWED_RE.test(canonicalizeJoinCode(value));
}

export function isClassRole(value: unknown): value is ClassRole {
  return typeof value === 'string' && (CLASS_ROLES as readonly string[]).includes(value);
}

export function isStaffRole(value: unknown): value is InstitutionStaffRole {
  return typeof value === 'string' && (INSTITUTION_STAFF_ROLES as readonly string[]).includes(value);
}

export function isClassStaffRole(role: ClassRole | null | undefined): boolean {
  return role === 'instructor' || role === 'ta';
}

export function isInstitutionCatalogAdmin(role: InstitutionStaffRole | null | undefined): boolean {
  return role === 'department_admin' || role === 'institution_admin';
}

function randomAlphabetChar(random: () => number): string {
  const index = Math.floor(random() * JOIN_CODE_ALPHABET.length);
  return JOIN_CODE_ALPHABET[Math.min(index, JOIN_CODE_ALPHABET.length - 1)]!;
}

/**
 * Generate a join code. `random` defaults to `Math.random`; the API passes
 * crypto bytes so codes are not guessable from Math.random in production.
 */
export function generateJoinCode(
  length: number = JOIN_CODE_LENGTH,
  random: () => number = Math.random
): string {
  const size = Math.min(JOIN_CODE_MAX_LENGTH, Math.max(JOIN_CODE_MIN_LENGTH, length));
  let out = '';
  for (let i = 0; i < size; i += 1) out += randomAlphabetChar(random);
  return out;
}

/** `/join/ABC234` — student entry. */
export function classJoinPath(code: string): string {
  return `/join/${encodeURIComponent(canonicalizeJoinCode(code))}`;
}

export type TeachPath =
  | '/teach'
  | '/teach/new'
  | `/teach/classes/${string}`
  | `/teach/classes/${string}/roster`
  | `/teach/classes/${string}/materials`
  | `/teach/classes/${string}/assign`
  | `/teach/classes/${string}/analytics`
  | '/teach/admin';

export function teachHomePath(): '/teach' {
  return '/teach';
}

export function teachNewClassPath(): '/teach/new' {
  return '/teach/new';
}

export function teachClassPath(
  classId: string,
  tab?: 'roster' | 'materials' | 'assign' | 'analytics'
): string {
  const base = `/teach/classes/${encodeURIComponent(classId)}`;
  if (!tab || tab === 'roster') return base;
  return `${base}/${tab}`;
}

export function teachAdminPath(): '/teach/admin' {
  return '/teach/admin';
}

export function parseTeachPath(pathname: string): {
  page: 'home' | 'new' | 'class' | 'admin' | null;
  classId?: string;
  tab?: 'roster' | 'materials' | 'assign' | 'analytics';
} {
  const path = pathname.replace(/\/$/, '') || '/';
  if (path === '/teach') return { page: 'home' };
  if (path === '/teach/new') return { page: 'new' };
  if (path === '/teach/admin') return { page: 'admin' };
  const match = path.match(/^\/teach\/classes\/([^/]+)(?:\/(roster|materials|assign|analytics))?$/);
  const classIdRaw = match?.[1];
  if (!classIdRaw) return { page: null };
  const tab = (match?.[2] as 'roster' | 'materials' | 'assign' | 'analytics' | undefined) ?? 'roster';
  return { page: 'class', classId: decodeURIComponent(classIdRaw), tab };
}

export function parseJoinPath(pathname: string): string | null {
  const raw = pathname.replace(/\/$/, '').match(/^\/join\/([^/]+)$/)?.[1];
  if (!raw) return null;
  const code = canonicalizeJoinCode(decodeURIComponent(raw));
  return isValidJoinCode(code) ? code : canonicalizeJoinCode(raw);
}
