/**
 * Academic identity — courses + enrolments (Phase 1 · A).
 *
 * One `courses` row per (institution, normalised code), shared by every
 * student; `user_courses` is the student's archive spine (one row per course
 * per academic year; archiving a semester flips status, nothing moves).
 * Shapes are pinned by docs/phase1-academic-identity-contract.md §2/§3 —
 * web and mobile are built against them, so keep the wire names stable.
 */
import type { SupabaseService } from './supabase';
import { PublicError } from '../utils/safeError';
import { logger } from '../utils/logger';
import {
  COURSE_TITLE_MAX_LENGTH,
  COURSE_TITLE_MIN_LENGTH,
  currentAcademicYear,
  isValidAcademicYear,
  isValidCourseCode,
  isValidCourseSemester,
  isValidStudyLevel,
  normalizeCourseCode,
} from '@lantern/shared/academic';

export const MAX_USER_COURSES_PER_YEAR = 40;
export const DEFAULT_COURSE_SEARCH_LIMIT = 20;
export const MAX_COURSE_SEARCH_LIMIT = 50;

const COURSE_COLUMNS =
  'id, institution_id, code, title, faculty, level, semester, is_canonical';
const USER_COURSE_COLUMNS = `user_id, course_id, academic_year, semester, status, exam_date, courses(${COURSE_COLUMNS})`;

/** Wire shape of a course (contract §3 `Course`). */
export interface CourseRecord {
  id: string;
  institutionId: string | null;
  code: string;
  title: string;
  faculty: string | null;
  level: number | null;
  semester: 1 | 2 | null;
  isCanonical: boolean;
}

/** Wire shape of an enrolment (contract §3 `UserCourse`). */
export interface UserCourseRecord {
  course: CourseRecord;
  academicYear: string;
  semester: 1 | 2 | null;
  status: 'active' | 'archived';
  examDate: string | null;
}

export interface InstitutionSummary {
  id: string;
  name: string;
  slug: string;
}

export interface CreateCourseInput {
  institutionId?: string | null;
  code: string;
  title?: string;
  faculty?: string | null;
  level?: number | null;
  semester?: 1 | 2 | null;
}

export interface UserCoursePatch {
  examDate?: string | null;
  semester?: 1 | 2 | null;
  status?: 'active' | 'archived';
  academicYear?: string;
}

/** PostgREST/Postgres "relation does not exist" — i.e. migration not applied yet. */
export function isMissingRelationError(
  error: { code?: string; message?: string } | null | undefined
): boolean {
  if (!error) return false;
  return (
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    /does not exist|could not find the table/i.test(error.message || '')
  );
}

/**
 * Postgres/PostgREST "column does not exist": 42703 on a read, PGRST204 on a
 * write (the schema cache never saw the column). Same meaning as
 * isMissingRelationError — the migration that adds it is not applied yet.
 */
export function isMissingColumnError(
  error: { code?: string; message?: string } | null | undefined
): boolean {
  if (!error) return false;
  return (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    /column .* does not exist|could not find the .* column/i.test(error.message || '')
  );
}

/**
 * `topic_id` (course_topics, 20260826120000) missing = that migration is not
 * applied. Every topic read/write then degrades to "no topics" instead of
 * failing the note/deck/test/listing it rode in on.
 */
export function isMissingTopicColumn(
  error: { code?: string; message?: string } | null | undefined
): boolean {
  return isMissingColumnError(error) && /topic_id/i.test(error?.message || '');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID_RE.test(value);

// ---------- Course filter (list endpoints) ----------

/**
 * Parsed `?courseId=` filter shared by every artefact list endpoint
 * (/decks, /notes, /tests, /offline-bundles, /library/search):
 *   absent/empty → none, the literal string "null" → unfiled (course_id IS
 *   NULL), a uuid → that course, anything else → invalid (400 — forwarding
 *   the raw string to `.eq('course_id', …)` is a 22P02 500 in Postgres).
 */
export type CourseFilter =
  | { kind: 'none' }
  | { kind: 'unfiled' }
  | { kind: 'course'; id: string }
  | { kind: 'invalid' };

export const COURSE_FILTER_INVALID_MESSAGE =
  "courseId must be a valid UUID or 'null' for unfiled items";

export function parseCourseFilter(raw: unknown): CourseFilter {
  if (raw == null) return { kind: 'none' };
  if (typeof raw !== 'string') return { kind: 'invalid' };
  const value = raw.trim();
  if (value === '') return { kind: 'none' };
  if (value === 'null') return { kind: 'unfiled' };
  if (!isUuid(value)) return { kind: 'invalid' };
  return { kind: 'course', id: value };
}

/** Apply a parsed filter to a PostgREST builder (`.is(col, null)` / `.eq(col, id)`); none/invalid leave it untouched. */
export function applyCourseFilter<Q>(query: Q, column: string, filter: CourseFilter | undefined): Q {
  if (!filter) return query;
  if (filter.kind === 'unfiled') return (query as any).is(column, null);
  if (filter.kind === 'course') return (query as any).eq(column, filter.id);
  return query;
}

/** Stable cache-key fragment: '' (none), 'null' (unfiled) or the course id. */
export function courseFilterKey(filter: CourseFilter | undefined): string {
  if (!filter) return '';
  if (filter.kind === 'course') return filter.id;
  if (filter.kind === 'unfiled') return 'null';
  return '';
}

/**
 * `?topicId=` (Phase 1 · A) has the same grammar as `?courseId=` — a uuid, the
 * literal "null", or absent — so it reuses this parser, applyCourseFilter
 * (which already takes the column) and courseFilterKey. "null" here means
 * "filed under the course but under no topic".
 */
export type TopicFilter = CourseFilter;

export const TOPIC_FILTER_INVALID_MESSAGE =
  "topicId must be a valid UUID or 'null' for items with no topic";

export function parseTopicFilter(raw: unknown): TopicFilter {
  return parseCourseFilter(raw);
}

const toSemester = (value: unknown): 1 | 2 | null =>
  value === 1 || value === '1' ? 1 : value === 2 || value === '2' ? 2 : null;

export function mapCourseRow(row: Record<string, any> | null | undefined): CourseRecord | null {
  if (!row || typeof row !== 'object' || !row.id) return null;
  return {
    id: String(row.id),
    institutionId: row.institution_id ? String(row.institution_id) : null,
    code: String(row.code ?? ''),
    title: String(row.title ?? ''),
    faculty: row.faculty ?? null,
    level: typeof row.level === 'number' ? row.level : row.level != null ? Number(row.level) : null,
    semester: toSemester(row.semester),
    isCanonical: Boolean(row.is_canonical),
  };
}

export function mapUserCourseRow(
  row: Record<string, any> | null | undefined
): UserCourseRecord | null {
  if (!row || typeof row !== 'object') return null;
  const joined = Array.isArray(row.courses) ? row.courses[0] : row.courses;
  const course = mapCourseRow(joined);
  if (!course) return null;
  return {
    course,
    academicYear: String(row.academic_year ?? ''),
    semester: toSemester(row.semester),
    status: row.status === 'archived' ? 'archived' : 'active',
    examDate: row.exam_date ? String(row.exam_date).slice(0, 10) : null,
  };
}

/** Keep only the characters a course code / title search can contain; PostgREST `or()` filters are comma/paren delimited. */
function sanitizeSearchTerm(raw: string): string {
  return raw.replace(/[^A-Za-z0-9 ./'&-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function sortUserCourses(rows: UserCourseRecord[]): UserCourseRecord[] {
  return rows.sort((a, b) => {
    if (a.academicYear !== b.academicYear) return a.academicYear < b.academicYear ? 1 : -1;
    if (a.course.isCanonical !== b.course.isCanonical) return a.course.isCanonical ? -1 : 1;
    return a.course.code.localeCompare(b.course.code);
  });
}

export class AcademicCoursesService {
  constructor(private supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  // ---------- Institutions ----------

  /**
   * Resolve a marketplace_campuses row as an institution summary, or null when
   * it does not exist. "Other — <city>" sentinels resolve to null too — they
   * are not institutions (kind = 'other'; pre-migration DBs fall back to slug),
   * and so do deactivated campuses (active = false).
   */
  async resolveInstitution(institutionId: string | null | undefined): Promise<InstitutionSummary | null> {
    if (!isUuid(institutionId)) return null;
    const row = await this.fetchInstitutionRow(institutionId);
    if (!row || row.active === false) return null;
    return this.toInstitutionSummary(row);
  }

  /** Raw campus row (id, name, slug, kind, active) or null; tolerates pre-migration schemas. */
  private async fetchInstitutionRow(institutionId: string): Promise<Record<string, any> | null> {
    const { data, error } = await this.db
      .from('marketplace_campuses')
      .select('id, name, slug, kind, active')
      .eq('id', institutionId)
      .maybeSingle();
    if (error) {
      // `kind` / `active` missing = migration not applied; retry without them
      // so profiles still render their institution.
      if (/kind|active/i.test(error.message || '')) {
        const retry = await this.db
          .from('marketplace_campuses')
          .select('id, name, slug')
          .eq('id', institutionId)
          .maybeSingle();
        if (retry.error) throw retry.error;
        return (retry.data as Record<string, any> | null) ?? null;
      }
      throw error;
    }
    return (data as Record<string, any> | null) ?? null;
  }

  private toInstitutionSummary(row: Record<string, any> | null): InstitutionSummary | null {
    if (!row) return null;
    const slug = String(row.slug ?? '');
    const kind = row.kind as string | undefined;
    const isSentinel = kind ? kind === 'other' : slug === 'other-city-nigeria' || slug.startsWith('other-');
    if (isSentinel) return null;
    return { id: String(row.id), name: String(row.name ?? ''), slug };
  }

  /** 400 unless the id is a real, active, non-sentinel institution. */
  async assertSelectableInstitution(institutionId: string): Promise<InstitutionSummary> {
    if (!isUuid(institutionId)) {
      throw new PublicError('institutionId must be a valid institution id');
    }
    const row = await this.fetchInstitutionRow(institutionId);
    if (row && row.active === false) {
      throw new PublicError('That institution is no longer available');
    }
    const institution = this.toInstitutionSummary(row);
    if (!institution) {
      throw new PublicError('Pick a university, polytechnic or college — "Other" is not an institution');
    }
    return institution;
  }

  // ---------- Courses ----------

  async searchCourses(options: {
    institutionId?: string | null;
    q?: string;
    limit?: number;
  } = {}): Promise<CourseRecord[]> {
    const limit = Math.min(
      MAX_COURSE_SEARCH_LIMIT,
      Math.max(1, Number(options.limit) || DEFAULT_COURSE_SEARCH_LIMIT)
    );
    let query = this.db
      .from('courses')
      .select(COURSE_COLUMNS)
      .order('is_canonical', { ascending: false })
      .order('code', { ascending: true })
      .limit(limit);

    if (options.institutionId) {
      query = query.eq('institution_id', options.institutionId);
    }

    const term = sanitizeSearchTerm(String(options.q ?? ''));
    if (term) {
      // Match the code as typed AND as normalised ("bio201" → "BIO 201"), plus
      // the title. ilike is index-assisted by courses_search_trgm_idx.
      const normalised = normalizeCourseCode(term);
      const patterns = new Set<string>([`%${term}%`]);
      if (normalised && normalised !== term.toUpperCase()) patterns.add(`%${normalised}%`);
      const clauses: string[] = [];
      for (const pattern of patterns) {
        clauses.push(`code.ilike.${pattern}`);
      }
      clauses.push(`title.ilike.%${term}%`);
      query = query.or(clauses.join(','));
    }

    const { data, error } = await query;
    if (error) {
      if (isMissingRelationError(error)) {
        logger.warn('courses table missing — apply 20260822130000_academic_identity_and_courses.sql');
        return [];
      }
      throw error;
    }
    return (data || [])
      .map((row: Record<string, any>) => mapCourseRow(row))
      .filter((course): course is CourseRecord => Boolean(course));
  }

  async getCourseById(courseId: string): Promise<CourseRecord | null> {
    if (!isUuid(courseId)) return null;
    const { data, error } = await this.db
      .from('courses')
      .select(COURSE_COLUMNS)
      .eq('id', courseId)
      .maybeSingle();
    if (error) {
      if (isMissingRelationError(error)) return null;
      throw error;
    }
    return mapCourseRow(data);
  }

  /** Ids that do NOT exist among the given (deduped) course ids. */
  async findMissingCourseIds(courseIds: string[]): Promise<string[]> {
    if (courseIds.length === 0) return [];
    const { data, error } = await this.db
      .from('courses')
      .select('id')
      .in('id', courseIds);
    if (error) throw error;
    const found = new Set((data || []).map((row: { id: string }) => String(row.id)));
    return courseIds.filter((id) => !found.has(id));
  }

  /**
   * Find-or-create on the normalised code. Title is required only when the
   * row has to be created; an existing row is returned untouched (and keeps
   * its own title/faculty/level).
   */
  async findOrCreateCourse(
    userId: string,
    input: CreateCourseInput
  ): Promise<{ course: CourseRecord; created: boolean }> {
    const code = normalizeCourseCode(input.code);
    if (!code) throw new PublicError('Course code is required');
    if (!isValidCourseCode(code)) {
      throw new PublicError('Course code must be 2-20 letters/digits, e.g. BIO 201');
    }

    let institutionId: string | null = null;
    if (input.institutionId != null && input.institutionId !== '') {
      institutionId = (await this.assertSelectableInstitution(String(input.institutionId))).id;
    }

    const existing = await this.findCourseByCode(institutionId, code);
    if (existing) return { course: existing, created: false };

    const title = typeof input.title === 'string' ? input.title.trim().replace(/\s+/g, ' ') : '';
    if (title.length < COURSE_TITLE_MIN_LENGTH) {
      throw new PublicError('Course title is required (at least 2 characters)');
    }
    if (title.length > COURSE_TITLE_MAX_LENGTH) {
      throw new PublicError(`Course title must be at most ${COURSE_TITLE_MAX_LENGTH} characters`);
    }
    if (input.level != null && !isValidStudyLevel(Number(input.level))) {
      throw new PublicError('level must be one of 100, 200, … 900');
    }
    if (input.semester != null && !isValidCourseSemester(Number(input.semester))) {
      throw new PublicError('semester must be 1 or 2');
    }
    const faculty =
      typeof input.faculty === 'string' && input.faculty.trim() ? input.faculty.trim().slice(0, 200) : null;

    const { data, error } = await this.db
      .from('courses')
      .insert({
        institution_id: institutionId,
        code,
        title,
        faculty,
        level: input.level != null ? Number(input.level) : null,
        semester: input.semester != null ? Number(input.semester) : null,
        created_by: userId,
      })
      .select(COURSE_COLUMNS)
      .single();

    if (error) {
      // Lost a race with another student adding the same code: return theirs.
      if (error.code === '23505') {
        const raced = await this.findCourseByCode(institutionId, code);
        if (raced) return { course: raced, created: false };
      }
      if (isMissingRelationError(error)) {
        throw new PublicError('Courses are not available yet — please try again later');
      }
      throw error;
    }
    const course = mapCourseRow(data);
    if (!course) throw new Error('Course insert returned no row');
    return { course, created: true };
  }

  private async findCourseByCode(institutionId: string | null, code: string): Promise<CourseRecord | null> {
    let query = this.db.from('courses').select(COURSE_COLUMNS).ilike('code', code).limit(1);
    query = institutionId ? query.eq('institution_id', institutionId) : query.is('institution_id', null);
    const { data, error } = await query.maybeSingle();
    if (error) {
      if (isMissingRelationError(error)) return null;
      throw error;
    }
    return mapCourseRow(data);
  }

  // ---------- Enrolments (user_courses) ----------

  resolveAcademicYear(raw: unknown): string {
    if (raw == null || raw === '') return currentAcademicYear();
    if (!isValidAcademicYear(raw)) {
      throw new PublicError('academicYear must look like 2026/2027');
    }
    return raw;
  }

  async listUserCourses(
    userId: string,
    options: { status?: 'active' | 'archived' | 'all'; academicYear?: string } = {}
  ): Promise<UserCourseRecord[]> {
    const status = options.status ?? 'active';
    let query = this.db.from('user_courses').select(USER_COURSE_COLUMNS).eq('user_id', userId);
    if (status !== 'all') query = query.eq('status', status);
    if (options.academicYear) query = query.eq('academic_year', options.academicYear);
    const { data, error } = await query;
    if (error) {
      if (isMissingRelationError(error)) return [];
      throw error;
    }
    const rows = (data || [])
      .map((row: Record<string, any>) => mapUserCourseRow(row))
      .filter((row): row is UserCourseRecord => Boolean(row));
    return sortUserCourses(rows);
  }

  /**
   * Set semantics for one academic year: every listed course becomes an
   * active enrolment (existing rows keep their semester/exam date), rows for
   * that year NOT in the list are deleted. Returns the year's enrolments.
   */
  async setUserCourses(
    userId: string,
    input: { courseIds: unknown; academicYear?: unknown }
  ): Promise<UserCourseRecord[]> {
    if (!Array.isArray(input.courseIds)) {
      throw new PublicError('courseIds must be an array of course ids');
    }
    const courseIds = Array.from(
      new Set(input.courseIds.filter((id): id is string => isUuid(id)))
    );
    if (courseIds.length !== new Set(input.courseIds).size) {
      throw new PublicError('Every courseId must be a valid course id');
    }
    if (courseIds.length > MAX_USER_COURSES_PER_YEAR) {
      throw new PublicError(`You can enrol in at most ${MAX_USER_COURSES_PER_YEAR} courses per academic year`);
    }
    const academicYear = this.resolveAcademicYear(input.academicYear);

    const missing = await this.findMissingCourseIds(courseIds);
    if (missing.length > 0) {
      throw new PublicError('One or more courses no longer exist — refresh and try again');
    }

    if (courseIds.length > 0) {
      const { error: upsertError } = await this.db.from('user_courses').upsert(
        courseIds.map((courseId) => ({
          user_id: userId,
          course_id: courseId,
          academic_year: academicYear,
          status: 'active',
        })),
        { onConflict: 'user_id,course_id,academic_year' }
      );
      if (upsertError) {
        if (isMissingRelationError(upsertError)) {
          throw new PublicError('Courses are not available yet — please try again later');
        }
        throw upsertError;
      }
    }

    let deleteQuery = this.db
      .from('user_courses')
      .delete()
      .eq('user_id', userId)
      .eq('academic_year', academicYear);
    if (courseIds.length > 0) {
      deleteQuery = deleteQuery.not('course_id', 'in', `(${courseIds.join(',')})`);
    }
    const { error: deleteError } = await deleteQuery;
    if (deleteError && !isMissingRelationError(deleteError)) throw deleteError;

    await this.syncCommunities(userId);
    return this.listUserCourses(userId, { status: 'all', academicYear });
  }

  /**
   * The row to act on for (user, course): the given year's row when a year is
   * supplied, else the most recent enrolment of that course.
   */
  private async findEnrolment(
    userId: string,
    courseId: string,
    academicYear?: string
  ): Promise<Record<string, any> | null> {
    let query = this.db
      .from('user_courses')
      .select(USER_COURSE_COLUMNS)
      .eq('user_id', userId)
      .eq('course_id', courseId);
    if (academicYear) query = query.eq('academic_year', academicYear);
    const { data, error } = await query.order('academic_year', { ascending: false }).limit(1).maybeSingle();
    if (error) {
      if (isMissingRelationError(error)) return null;
      throw error;
    }
    return data ?? null;
  }

  async updateUserCourse(
    userId: string,
    courseId: string,
    patch: UserCoursePatch
  ): Promise<UserCourseRecord | null> {
    if (!isUuid(courseId)) throw new PublicError('courseId must be a valid course id');
    const academicYear =
      patch.academicYear != null && patch.academicYear !== ''
        ? this.resolveAcademicYear(patch.academicYear)
        : undefined;

    const updates: Record<string, unknown> = {};
    if (patch.examDate !== undefined) {
      if (patch.examDate === null || patch.examDate === '') {
        updates.exam_date = null;
      } else if (typeof patch.examDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(patch.examDate)) {
        const parsed = new Date(`${patch.examDate}T00:00:00Z`);
        if (Number.isNaN(parsed.getTime())) throw new PublicError('examDate must be a valid YYYY-MM-DD date');
        updates.exam_date = patch.examDate;
      } else {
        throw new PublicError('examDate must be YYYY-MM-DD or null');
      }
    }
    if (patch.semester !== undefined) {
      if (patch.semester === null) updates.semester = null;
      else if (isValidCourseSemester(Number(patch.semester))) updates.semester = Number(patch.semester);
      else throw new PublicError('semester must be 1, 2 or null');
    }
    if (patch.status !== undefined) {
      if (patch.status !== 'active' && patch.status !== 'archived') {
        throw new PublicError("status must be 'active' or 'archived'");
      }
      updates.status = patch.status;
    }
    if (Object.keys(updates).length === 0) {
      throw new PublicError('Nothing to update — send examDate, semester or status');
    }

    const existing = await this.findEnrolment(userId, courseId, academicYear);
    if (!existing) return null;

    const { data, error } = await this.db
      .from('user_courses')
      .update(updates)
      .eq('user_id', userId)
      .eq('course_id', courseId)
      .eq('academic_year', existing.academic_year)
      .select(USER_COURSE_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    return mapUserCourseRow(data ?? { ...existing, ...updates });
  }

  /**
   * Course enrolment changes which course communities a student belongs to
   * (Phase 3 · L). Best-effort inside CommunitiesService — never let a stale
   * membership fail the enrolment write that triggered it.
   */
  private async syncCommunities(userId: string): Promise<void> {
    const { getCommunitiesService } = await import('./communities');
    await getCommunitiesService(this.supabaseService).refreshAutoMemberships(userId);
  }

  /**
   * Upsert a single active enrolment without touching the rest of the year.
   * Used when a student joins a lecturer's class (docs/phase-teach-portal-contract.md).
   */
  async ensureEnrolment(
    userId: string,
    courseId: string,
    academicYear?: unknown,
    semester?: 1 | 2 | null
  ): Promise<UserCourseRecord | null> {
    if (!isUuid(courseId)) throw new PublicError('courseId must be a valid course id');
    const year = this.resolveAcademicYear(academicYear);
    const row: Record<string, unknown> = {
      user_id: userId,
      course_id: courseId,
      academic_year: year,
      status: 'active',
    };
    if (semester === 1 || semester === 2) row.semester = semester;

    const { error } = await this.db.from('user_courses').upsert(row, {
      onConflict: 'user_id,course_id,academic_year',
    });
    if (error) {
      if (isMissingRelationError(error)) {
        throw new PublicError('Courses are not available yet — please try again later');
      }
      throw error;
    }
    await this.syncCommunities(userId);
    const mapped = mapUserCourseRow(await this.findEnrolment(userId, courseId, year));
    return mapped;
  }

  async removeUserCourse(userId: string, courseId: string, academicYear?: unknown): Promise<boolean> {
    if (!isUuid(courseId)) throw new PublicError('courseId must be a valid course id');
    const year =
      academicYear != null && academicYear !== '' ? this.resolveAcademicYear(academicYear) : undefined;
    const existing = await this.findEnrolment(userId, courseId, year);
    if (!existing) return false;
    const { error } = await this.db
      .from('user_courses')
      .delete()
      .eq('user_id', userId)
      .eq('course_id', courseId)
      .eq('academic_year', existing.academic_year);
    if (error) throw error;
    await this.syncCommunities(userId);
    return true;
  }

  /** Archive every active enrolment of an academic year; nothing moves. */
  async archiveSemester(userId: string, academicYear: unknown): Promise<{ archived: number }> {
    if (academicYear == null || academicYear === '') {
      throw new PublicError('academicYear is required, e.g. 2025/2026');
    }
    const year = this.resolveAcademicYear(academicYear);
    const { data, error } = await this.db
      .from('user_courses')
      .update({ status: 'archived' })
      .eq('user_id', userId)
      .eq('academic_year', year)
      .eq('status', 'active')
      .select('course_id');
    if (error) {
      if (isMissingRelationError(error)) return { archived: 0 };
      throw error;
    }
    await this.syncCommunities(userId);
    return { archived: Array.isArray(data) ? data.length : 0 };
  }

  // ---------- Artefact helpers ----------

  /**
   * Set/clear the course — and since Phase 1 · A the topic — on a marketplace
   * listing. Kept outside updateMarketplaceListing (owned by the
   * listing-lifecycle work) so the PUT /listings/:id route can write
   * course_id/topic_id without touching that path. `undefined` leaves a column
   * alone, so an edit that only moves the topic does not rewrite the course.
   */
  async setListingCourse(
    listingId: string,
    courseId: string | null | undefined,
    topicId?: string | null
  ): Promise<void> {
    const updates: Record<string, unknown> = {};
    if (courseId !== undefined) updates.course_id = courseId;
    if (topicId !== undefined) updates.topic_id = topicId;
    if (Object.keys(updates).length === 0) return;

    const { error } = await this.db
      .from('marketplace_listings')
      .update(updates)
      .eq('id', listingId);
    if (error) {
      // topic_id not there yet: the course still has to land, and there is no
      // topic to clear on a column that does not exist.
      if (updates.topic_id !== undefined && isMissingTopicColumn(error)) {
        delete updates.topic_id;
        if (Object.keys(updates).length === 0) return;
        const retry = await this.db
          .from('marketplace_listings')
          .update(updates)
          .eq('id', listingId);
        if (retry.error) throw retry.error;
        return;
      }
      throw error;
    }
  }
}

let service: AcademicCoursesService | null = null;

export function getAcademicCoursesService(supabaseService: SupabaseService): AcademicCoursesService {
  if (!service) service = new AcademicCoursesService(supabaseService);
  return service;
}
