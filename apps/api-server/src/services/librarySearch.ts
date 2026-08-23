/**
 * Library archive (Phase 1 · B) — the course tree overview and the
 * cross-artefact search behind "My Lantern Library".
 *
 * Shapes are pinned by docs/phase1-library-archive-contract.md §1 — web and
 * mobile are built against them, so keep the wire names stable:
 *
 *   GET /library/overview → { years: [{ academicYear, courses: [{ course,
 *     enrolment, counts: { notes, decks, tests, bundles, purchasedPacks } }] }],
 *     unfiled: { notes, decks, tests, bundles } }
 *   GET /library/search  → [{ type, id, title, snippet, courseId, deckId?, updatedAt }]
 *
 * Query strategy (PostgREST through supabase-js; there is no raw SQL client in
 * this server):
 *   - overview: ONE service call = the caller's enrolments + one owner-scoped
 *     `course_id` projection per artefact table (paged in 1000-row chunks only
 *     when a user has more rows than PostgREST returns at once), aggregated in
 *     TS. Purchased packs (`offline_bundles.bundle_id` = 'qbank-<listingId>')
 *     are filed under the listing's `course_id` with one extra lookup — never
 *     N+1 per course.
 *   - search: one ILIKE query per REQUESTED type (notes + their attachments,
 *     decks, flashcards, bundles), owner-scoped (own rows + notes/decks the
 *     caller collaborates on), then ranked in TS: exact prefix on the title
 *     beats contains, which beats a match in secondary text; ties by recency.
 *     Flashcards stay grouped under their deck.
 */
import type { SupabaseService } from './supabase';
import { PublicError } from '../utils/safeError';
import { logger } from '../utils/logger';
import {
  AcademicCoursesService,
  applyCourseFilter,
  isMissingRelationError,
  isUuid,
  parseCourseFilter,
  type CourseFilter,
  type CourseRecord,
  type UserCourseRecord,
} from './academicCourses';

// ---------- Constants ----------

export const LIBRARY_SEARCH_TYPES = ['notes', 'decks', 'flashcards', 'bundles'] as const;
export type LibrarySearchType = (typeof LIBRARY_SEARCH_TYPES)[number];

export const LIBRARY_SEARCH_MIN_QUERY_LENGTH = 2;
export const LIBRARY_SEARCH_MAX_QUERY_LENGTH = 100;
export const LIBRARY_SEARCH_DEFAULT_LIMIT = 30;
export const LIBRARY_SEARCH_MAX_LIMIT = 50;

/**
 * offline_bundles rows created by a digital marketplace purchase: a question
 * bank ('qbank-<listingId>') or a study pack ('pack-<listingId>'). Both are
 * "purchased packs" in the Library overview.
 */
export const PURCHASED_PACK_BUNDLE_PREFIX = 'qbank-';
export const PURCHASED_PACK_BUNDLE_PREFIXES = ['qbank-', 'pack-'] as const;

/** PostgREST returns at most 1000 rows per request; the overview pages past that. */
const OVERVIEW_PAGE_SIZE = 1000;
/** Hard stop so a pathological account cannot turn the overview into a crawl (20k rows/table). */
const OVERVIEW_MAX_PAGES = 20;
/** Collaborator ids are inlined into an `or()` filter — keep the URL bounded. */
const SHARED_ID_CAP = 200;
/** Listing ids are batched into `in()` filters. */
const LISTING_LOOKUP_CHUNK = 200;

const SNIPPET_RADIUS = 80;
const SNIPPET_MAX_LENGTH = 200;
const TITLE_MAX_LENGTH = 160;

// ---------- Wire shapes ----------

export interface LibraryCourseCounts {
  notes: number;
  decks: number;
  tests: number;
  /** Every offline bundle filed under the course — purchased packs included. */
  bundles: number;
  /** Subset of `bundles` whose bundle_id starts with `qbank-`. */
  purchasedPacks: number;
}

export interface LibraryUnfiledCounts {
  notes: number;
  decks: number;
  tests: number;
  bundles: number;
}

export interface LibraryCourseNode {
  course: CourseRecord;
  enrolment: UserCourseRecord;
  counts: LibraryCourseCounts;
}

export interface LibraryYearNode {
  academicYear: string;
  courses: LibraryCourseNode[];
}

export interface LibraryOverviewRecord {
  years: LibraryYearNode[];
  unfiled: LibraryUnfiledCounts;
}

export type LibrarySearchResultType = 'note' | 'deck' | 'flashcard' | 'bundle';

export type LibrarySearchMatchField =
  | 'title'
  | 'summary'
  | 'body'
  | 'attachment'
  | 'name'
  | 'description'
  | 'front'
  | 'back'
  | 'displayName'
  | 'groupName';

export interface LibrarySearchResultRecord {
  type: LibrarySearchResultType;
  /** notes/decks/flashcards: row id; bundles: the client-facing `bundle_id`. */
  id: string;
  title: string;
  snippet: string;
  courseId: string | null;
  /** Flashcards only — the deck they belong to (results are grouped by it). */
  deckId?: string;
  /** Flashcards only — the deck's name, so clients can render group headers. */
  deckTitle?: string;
  /** Which field matched, when it could be determined. */
  matchedIn?: LibrarySearchMatchField;
  updatedAt: string;
}

export interface LibrarySearchOptions {
  q: string;
  /** A course id, or the literal 'null' for unfiled items. */
  courseId?: string | null;
  types?: LibrarySearchType[];
  limit?: number;
}

// ---------- Pure helpers (exported for tests) ----------

/** Escape the LIKE metacharacters so `q` is matched literally. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

/**
 * Collapse whitespace and drop the characters PostgREST's `or()` filter
 * grammar reserves (`,` `(` `)` and `"`) plus `*`, which PostgREST rewrites
 * to `%` inside like/ilike patterns (it can never be matched literally), so the
 * query can be inlined safely.
 */
export function normalizeSearchQuery(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[,()"*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LIBRARY_SEARCH_MAX_QUERY_LENGTH)
    .trim();
}

/**
 * `types=notes,decks` (string or array) → the deduped list, in canonical order.
 * Returns every type when empty/omitted and null when a value is unknown.
 */
export function parseLibrarySearchTypes(raw: unknown): LibrarySearchType[] | null {
  const parts = (Array.isArray(raw) ? raw : [raw])
    .flatMap((value) => String(value ?? '').split(','))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) return [...LIBRARY_SEARCH_TYPES];
  const set = new Set<string>(parts);
  for (const part of set) {
    if (!(LIBRARY_SEARCH_TYPES as readonly string[]).includes(part)) return null;
  }
  return LIBRARY_SEARCH_TYPES.filter((type) => set.has(type));
}

export const isPurchasedPackBundleId = (bundleId: unknown): bundleId is string =>
  typeof bundleId === 'string' &&
  PURCHASED_PACK_BUNDLE_PREFIXES.some((prefix) => bundleId.startsWith(prefix));

export const listingIdFromBundleId = (bundleId: string): string | null => {
  const prefix = PURCHASED_PACK_BUNDLE_PREFIXES.find((p) => bundleId.startsWith(p));
  if (!prefix) return null;
  const listingId = bundleId.slice(prefix.length);
  return isUuid(listingId) ? listingId : null;
};

const cleanText = (value: unknown): string =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

const clip = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;

const includesFold = (haystack: unknown, needle: string): boolean =>
  cleanText(haystack).toLowerCase().includes(needle.toLowerCase());

/** A window of text around the first (case-insensitive) occurrence of `q`. */
export function buildSnippet(text: unknown, q: string): string {
  const clean = cleanText(text);
  if (!clean) return '';
  const index = clean.toLowerCase().indexOf(q.toLowerCase());
  if (index < 0) return clip(clean, SNIPPET_MAX_LENGTH);
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(clean.length, index + q.length + SNIPPET_RADIUS);
  return `${start > 0 ? '…' : ''}${clean.slice(start, end).trim()}${end < clean.length ? '…' : ''}`;
}

/** 0 = title starts with q, 1 = title contains q, 2 = matched in secondary text, 3 = unknown. */
export function rankMatch(q: string, title: unknown, secondaries: unknown[]): number {
  const needle = q.toLowerCase();
  const primary = cleanText(title).toLowerCase();
  if (primary.startsWith(needle)) return 0;
  if (primary.includes(needle)) return 1;
  if (secondaries.some((value) => includesFold(value, needle))) return 2;
  return 3;
}

const toTime = (value: unknown): number => {
  const time = new Date(String(value ?? '')).getTime();
  return Number.isFinite(time) ? time : 0;
};

const toIso = (value: unknown): string => {
  const time = toTime(value);
  return time ? new Date(time).toISOString() : new Date(0).toISOString();
};

type CountMap = Map<string | null, number>;

const bump = (map: CountMap, key: string | null) => map.set(key, (map.get(key) ?? 0) + 1);
const countOf = (map: CountMap, key: string | null) => map.get(key) ?? 0;

export interface OverviewFixture {
  enrolments: UserCourseRecord[];
  notes: Array<{ course_id?: string | null }>;
  decks: Array<{ course_id?: string | null }>;
  tests: Array<{ course_id?: string | null }>;
  bundles: Array<{ course_id?: string | null; bundle_id?: string | null }>;
  /** listing id → listing course_id, for purchased packs. */
  listingCourses?: Map<string, string | null>;
}

/** Fold the projected rows into the overview tree (pure; unit-tested on fixtures). */
export function aggregateLibraryOverview(input: OverviewFixture): LibraryOverviewRecord {
  const courseKey = (row: { course_id?: string | null }): string | null =>
    row.course_id ? String(row.course_id) : null;

  const notesBy: CountMap = new Map();
  const decksBy: CountMap = new Map();
  const testsBy: CountMap = new Map();
  const bundlesBy: CountMap = new Map();
  const packsBy: CountMap = new Map();

  for (const row of input.notes) bump(notesBy, courseKey(row));
  for (const row of input.decks) bump(decksBy, courseKey(row));
  for (const row of input.tests) bump(testsBy, courseKey(row));
  for (const row of input.bundles) {
    let key = courseKey(row);
    const isPack = isPurchasedPackBundleId(row.bundle_id);
    if (isPack) {
      // Purchased packs are filed by the listing's course (contract §1); the
      // row's own course_id is the fallback when the listing has none.
      const listingId = listingIdFromBundleId(row.bundle_id as string);
      const listingCourse = listingId ? input.listingCourses?.get(listingId) : undefined;
      key = listingCourse ? String(listingCourse) : key;
    }
    bump(bundlesBy, key);
    if (isPack) bump(packsBy, key);
  }

  const byYear = new Map<string, LibraryCourseNode[]>();
  for (const enrolment of input.enrolments) {
    const courseId = enrolment.course.id;
    const node: LibraryCourseNode = {
      course: enrolment.course,
      enrolment,
      counts: {
        notes: countOf(notesBy, courseId),
        decks: countOf(decksBy, courseId),
        tests: countOf(testsBy, courseId),
        bundles: countOf(bundlesBy, courseId),
        purchasedPacks: countOf(packsBy, courseId),
      },
    };
    const list = byYear.get(enrolment.academicYear) ?? [];
    list.push(node);
    byYear.set(enrolment.academicYear, list);
  }

  const years: LibraryYearNode[] = Array.from(byYear.entries())
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([academicYear, courses]) => ({
      academicYear,
      courses: courses.sort((a, b) => {
        if (a.enrolment.status !== b.enrolment.status) return a.enrolment.status === 'active' ? -1 : 1;
        return a.course.code.localeCompare(b.course.code);
      }),
    }));

  return {
    years,
    unfiled: {
      notes: countOf(notesBy, null),
      decks: countOf(decksBy, null),
      tests: countOf(testsBy, null),
      bundles: countOf(bundlesBy, null),
    },
  };
}

interface RankedResult {
  result: LibrarySearchResultRecord;
  rank: number;
  time: number;
}

/**
 * Rank, then recency — with flashcards kept contiguous under their deck: a
 * deck's cards are positioned by the group's best (rank, time) and ordered
 * within the group by their own.
 */
export function orderSearchResults(items: RankedResult[], limit: number): LibrarySearchResultRecord[] {
  const groups = new Map<string, { rank: number; time: number }>();
  const groupOf = (item: RankedResult): string =>
    item.result.type === 'flashcard' && item.result.deckId ? item.result.deckId : '';
  for (const item of items) {
    const group = groupOf(item);
    if (!group) continue;
    const current = groups.get(group);
    groups.set(group, {
      rank: current ? Math.min(current.rank, item.rank) : item.rank,
      time: current ? Math.max(current.time, item.time) : item.time,
    });
  }
  const keyOf = (item: RankedResult) => groups.get(groupOf(item)) ?? { rank: item.rank, time: item.time };

  return [...items]
    .sort((a, b) => {
      const ka = keyOf(a);
      const kb = keyOf(b);
      if (ka.rank !== kb.rank) return ka.rank - kb.rank;
      if (ka.time !== kb.time) return kb.time - ka.time;
      const ga = groupOf(a);
      const gb = groupOf(b);
      if (ga !== gb) return ga < gb ? -1 : 1;
      if (a.rank !== b.rank) return a.rank - b.rank;
      return b.time - a.time;
    })
    .slice(0, limit)
    .map((item) => item.result);
}

/** Postgres "column does not exist" (42703) — e.g. course_id before the migration is applied. */
const isMissingColumnError = (error: { code?: string; message?: string } | null | undefined): boolean =>
  Boolean(error && (error.code === '42703' || /column .* does not exist/i.test(error.message || '')));

const unique = (values: unknown[]): string[] => Array.from(new Set(values.filter(isUuid)));

/**
 * `removed_by_admin_at` (moderation takedown; notes since 20260822140000,
 * decks since 20260608100000) missing = migration not applied. The moderation
 * filter is then retried without, so the archive still works pre-migration.
 */
const isMissingModerationColumn = (error: { code?: string; message?: string } | null | undefined): boolean =>
  isMissingColumnError(error) && /removed_by_admin_at/i.test(error?.message || '');

// ---------- Service ----------

export class LibrarySearchService {
  private readonly courses: AcademicCoursesService;

  constructor(
    private supabaseService: SupabaseService,
    courses?: AcademicCoursesService
  ) {
    this.courses = courses ?? new AcademicCoursesService(supabaseService);
  }

  private get db() {
    return this.supabaseService.getClient();
  }

  // ----- Overview -----

  async getOverview(userId: string): Promise<LibraryOverviewRecord> {
    const [enrolments, notes, decks, tests, bundles] = await Promise.all([
      this.courses.listUserCourses(userId, { status: 'all' }),
      // Notes/decks moderation removed are gone for everyone but admins.
      this.fetchOwnedRows('notes', 'course_id', userId, undefined, { excludeRemoved: true }),
      this.fetchOwnedRows('decks', 'course_id', userId, undefined, { excludeRemoved: true }),
      // Abandoned sessions are trash, not archive material.
      this.fetchOwnedRows('test_sessions', 'course_id', userId, (query) => query.neq('status', 'abandoned')),
      this.fetchOwnedRows('offline_bundles', 'course_id, bundle_id', userId),
    ]);
    const listingCourses = await this.resolveListingCourses(bundles);
    return aggregateLibraryOverview({ enrolments, notes, decks, tests, bundles, listingCourses });
  }

  /**
   * Owner-scoped projection of `columns`, paged past PostgREST's 1000-row cap.
   * `excludeRemoved` adds `removed_by_admin_at IS NULL` (retried without it
   * when the column does not exist yet).
   */
  private async fetchOwnedRows(
    table: string,
    columns: string,
    userId: string,
    refine?: (query: any) => any,
    options: { excludeRemoved?: boolean } = {}
  ): Promise<Record<string, any>[]> {
    const rows: Record<string, any>[] = [];
    let excludeRemoved = Boolean(options.excludeRemoved);
    for (let page = 0; page < OVERVIEW_MAX_PAGES; page++) {
      let query = this.db.from(table).select(columns).eq('user_id', userId);
      if (refine) query = refine(query);
      if (excludeRemoved) query = query.is('removed_by_admin_at', null);
      const from = page * OVERVIEW_PAGE_SIZE;
      const { data, error } = await query
        .order('id', { ascending: true })
        .range(from, from + OVERVIEW_PAGE_SIZE - 1);
      if (error) {
        if (excludeRemoved && isMissingModerationColumn(error)) {
          logger.warn(`library overview: ${table}.removed_by_admin_at missing — moderation filter skipped`);
          excludeRemoved = false;
          page -= 1; // retry this page without the filter
          continue;
        }
        if (isMissingRelationError(error) || isMissingColumnError(error)) {
          logger.warn(`library overview: ${table} projection unavailable (${error.message || error.code})`);
          return rows;
        }
        throw error;
      }
      const batch = (data || []) as Record<string, any>[];
      rows.push(...batch);
      if (batch.length < OVERVIEW_PAGE_SIZE) break;
    }
    return rows;
  }

  /** listing id → course_id for every purchased pack among the bundle rows (one lookup, chunked). */
  private async resolveListingCourses(
    bundles: Array<{ bundle_id?: string | null }>
  ): Promise<Map<string, string | null>> {
    const listingIds = unique(
      bundles
        .filter((row) => isPurchasedPackBundleId(row.bundle_id))
        .map((row) => listingIdFromBundleId(row.bundle_id as string))
    );
    const map = new Map<string, string | null>();
    for (let i = 0; i < listingIds.length; i += LISTING_LOOKUP_CHUNK) {
      const chunk = listingIds.slice(i, i + LISTING_LOOKUP_CHUNK);
      const { data, error } = await this.db.from('marketplace_listings').select('id, course_id').in('id', chunk);
      if (error) {
        if (isMissingRelationError(error) || isMissingColumnError(error)) {
          logger.warn(`library overview: listing course lookup unavailable (${error.message || error.code})`);
          return map;
        }
        throw error;
      }
      for (const row of (data || []) as Array<{ id: string; course_id?: string | null }>) {
        map.set(String(row.id), row.course_id ? String(row.course_id) : null);
      }
    }
    return map;
  }

  // ----- Search -----

  async search(userId: string, options: LibrarySearchOptions): Promise<LibrarySearchResultRecord[]> {
    const q = normalizeSearchQuery(options.q);
    if (q.length < LIBRARY_SEARCH_MIN_QUERY_LENGTH) {
      throw new PublicError(`Search needs at least ${LIBRARY_SEARCH_MIN_QUERY_LENGTH} characters`);
    }
    const types = options.types && options.types.length > 0 ? options.types : [...LIBRARY_SEARCH_TYPES];
    const limit = Math.min(
      LIBRARY_SEARCH_MAX_LIMIT,
      Math.max(1, Number(options.limit) || LIBRARY_SEARCH_DEFAULT_LIMIT)
    );
    const courseFilter = this.toCourseFilter(options.courseId);
    const pattern = `%${escapeLikePattern(q)}%`;

    const wantsDecks = types.includes('decks');
    const wantsFlashcards = types.includes('flashcards');
    const sharedDeckIds =
      wantsDecks || wantsFlashcards ? await this.collaboratorIds('deck_collaborators', 'deck_id', userId) : [];

    const batches = await Promise.all([
      types.includes('notes') ? this.searchNotes(userId, q, pattern, courseFilter, limit) : Promise.resolve([]),
      wantsDecks ? this.searchDecks(userId, q, pattern, courseFilter, limit, sharedDeckIds) : Promise.resolve([]),
      wantsFlashcards
        ? this.searchFlashcards(userId, q, pattern, courseFilter, limit, sharedDeckIds)
        : Promise.resolve([]),
      types.includes('bundles') ? this.searchBundles(userId, q, pattern, courseFilter, limit) : Promise.resolve([]),
    ]);

    return orderSearchResults(batches.flat(), limit);
  }

  /** Shared parser (academicCourses.parseCourseFilter); invalid → PublicError (400). */
  private toCourseFilter(raw: string | null | undefined): CourseFilter {
    const filter = parseCourseFilter(raw);
    if (filter.kind === 'invalid') throw new PublicError('courseId must be a course id or null');
    return filter;
  }

  private applyCourseFilter(query: any, column: string, filter: CourseFilter): any {
    return applyCourseFilter(query, column, filter);
  }

  /**
   * Own rows OR rows the caller collaborates on. `referencedTable` scopes the
   * filter to an embedded (`!inner`) parent — decks for flashcards, notes for
   * attachments. Only uuids ever reach the inlined filter string.
   */
  private applyOwnerScope(
    query: any,
    userId: string,
    ownerColumn: string,
    idColumn: string,
    sharedIds: string[],
    referencedTable?: string
  ): any {
    const ids = sharedIds.filter(isUuid);
    if (ids.length === 0 || !isUuid(userId)) {
      return referencedTable
        ? query.eq(`${referencedTable}.${ownerColumn}`, userId)
        : query.eq(ownerColumn, userId);
    }
    const filter = `${ownerColumn}.eq.${userId},${idColumn}.in.(${ids.join(',')})`;
    return referencedTable ? query.or(filter, { referencedTable }) : query.or(filter);
  }

  private async collaboratorIds(
    table: 'note_collaborators' | 'deck_collaborators',
    column: 'note_id' | 'deck_id',
    userId: string
  ): Promise<string[]> {
    const { data, error } = await this.db.from(table).select(column).eq('user_id', userId).limit(SHARED_ID_CAP);
    if (error) {
      if (isMissingRelationError(error)) return [];
      throw error;
    }
    return unique(((data || []) as Record<string, unknown>[]).map((row) => row[column]));
  }

  private async run(label: string, query: any): Promise<Record<string, any>[]> {
    const { data, error } = await query;
    if (error) {
      if (isMissingRelationError(error) || isMissingColumnError(error)) {
        logger.warn(`library search: ${label} unavailable (${error.message || error.code})`);
        return [];
      }
      throw error;
    }
    return (data || []) as Record<string, any>[];
  }

  /**
   * Run a query whose builder adds `removed_by_admin_at IS NULL` when asked
   * (notes/decks moderation removed never surface in search). A DB without the
   * column yet retries without the filter; every other error follows `run`.
   */
  private async runModerated(
    label: string,
    build: (excludeRemoved: boolean) => any
  ): Promise<Record<string, any>[]> {
    const { data, error } = await build(true);
    if (error) {
      if (isMissingModerationColumn(error)) {
        logger.warn(`library search: ${label} has no removed_by_admin_at column — moderation filter skipped`);
        return this.run(label, build(false));
      }
      if (isMissingRelationError(error) || isMissingColumnError(error)) {
        logger.warn(`library search: ${label} unavailable (${error.message || error.code})`);
        return [];
      }
      throw error;
    }
    return (data || []) as Record<string, any>[];
  }

  private async searchNotes(
    userId: string,
    q: string,
    pattern: string,
    courseFilter: CourseFilter,
    limit: number
  ): Promise<RankedResult[]> {
    const sharedNoteIds = await this.collaboratorIds('note_collaborators', 'note_id', userId);

    const buildNotesQuery = (excludeRemoved: boolean) => {
      let notesQuery = this.db.from('notes').select('id, title, summary, body, course_id, updated_at');
      notesQuery = this.applyOwnerScope(notesQuery, userId, 'user_id', 'id', sharedNoteIds);
      notesQuery = notesQuery.or(`title.ilike.${pattern},summary.ilike.${pattern},body.ilike.${pattern}`);
      notesQuery = this.applyCourseFilter(notesQuery, 'course_id', courseFilter);
      if (excludeRemoved) notesQuery = notesQuery.is('removed_by_admin_at', null);
      return notesQuery.order('updated_at', { ascending: false }).limit(limit);
    };

    // Imported notes keep their content in attachments' extracted_text, not the body.
    const buildAttachmentsQuery = (excludeRemoved: boolean) => {
      let attachmentsQuery = this.db
        .from('note_attachments')
        .select('note_id, file_name, extracted_text, notes!inner(id, title, course_id, updated_at)')
        .ilike('extracted_text', pattern);
      attachmentsQuery = this.applyOwnerScope(attachmentsQuery, userId, 'user_id', 'id', sharedNoteIds, 'notes');
      attachmentsQuery = this.applyCourseFilter(attachmentsQuery, 'notes.course_id', courseFilter);
      if (excludeRemoved) attachmentsQuery = attachmentsQuery.is('notes.removed_by_admin_at', null);
      return attachmentsQuery.limit(limit);
    };

    const [noteRows, attachmentRows] = await Promise.all([
      this.runModerated('notes', buildNotesQuery),
      this.runModerated('note_attachments', buildAttachmentsQuery),
    ]);

    const byNote = new Map<string, RankedResult>();
    for (const row of noteRows) {
      const title = clip(cleanText(row.title) || 'Untitled note', TITLE_MAX_LENGTH);
      let matchedIn: LibrarySearchMatchField;
      let snippet: string;
      if (includesFold(row.title, q)) {
        matchedIn = 'title';
        snippet = buildSnippet(row.summary || row.body, q);
      } else if (includesFold(row.summary, q)) {
        matchedIn = 'summary';
        snippet = buildSnippet(row.summary, q);
      } else {
        matchedIn = 'body';
        snippet = buildSnippet(row.body, q);
      }
      byNote.set(String(row.id), {
        rank: rankMatch(q, row.title, [row.summary, row.body]),
        time: toTime(row.updated_at),
        result: {
          type: 'note',
          id: String(row.id),
          title,
          snippet,
          courseId: row.course_id ? String(row.course_id) : null,
          matchedIn,
          updatedAt: toIso(row.updated_at),
        },
      });
    }
    for (const row of attachmentRows) {
      const note = Array.isArray(row.notes) ? row.notes[0] : row.notes;
      if (!note || !note.id) continue;
      const noteId = String(note.id);
      if (byNote.has(noteId)) continue; // already matched on its own text — keep that ranking
      const title = clip(cleanText(note.title) || 'Untitled note', TITLE_MAX_LENGTH);
      byNote.set(noteId, {
        rank: rankMatch(q, note.title, [row.extracted_text]),
        time: toTime(note.updated_at),
        result: {
          type: 'note',
          id: noteId,
          title,
          snippet: buildSnippet(row.extracted_text, q),
          courseId: note.course_id ? String(note.course_id) : null,
          matchedIn: 'attachment',
          updatedAt: toIso(note.updated_at),
        },
      });
    }
    return Array.from(byNote.values());
  }

  private async searchDecks(
    userId: string,
    q: string,
    pattern: string,
    courseFilter: CourseFilter,
    limit: number,
    sharedDeckIds: string[]
  ): Promise<RankedResult[]> {
    const rows = await this.runModerated('decks', (excludeRemoved) => {
      let query = this.db.from('decks').select('id, name, description, course_id, created_at');
      query = this.applyOwnerScope(query, userId, 'user_id', 'id', sharedDeckIds);
      query = query.or(`name.ilike.${pattern},description.ilike.${pattern}`);
      query = this.applyCourseFilter(query, 'course_id', courseFilter);
      if (excludeRemoved) query = query.is('removed_by_admin_at', null);
      return query.order('created_at', { ascending: false }).limit(limit);
    });
    return rows.map((row) => ({
      rank: rankMatch(q, row.name, [row.description]),
      time: toTime(row.created_at),
      result: {
        type: 'deck' as const,
        id: String(row.id),
        title: clip(cleanText(row.name) || 'Untitled deck', TITLE_MAX_LENGTH),
        snippet: buildSnippet(row.description, q),
        courseId: row.course_id ? String(row.course_id) : null,
        matchedIn: includesFold(row.name, q) ? ('name' as const) : ('description' as const),
        updatedAt: toIso(row.created_at),
      },
    }));
  }

  private async searchFlashcards(
    userId: string,
    q: string,
    pattern: string,
    courseFilter: CourseFilter,
    limit: number,
    sharedDeckIds: string[]
  ): Promise<RankedResult[]> {
    const rows = await this.runModerated('flashcards', (excludeRemoved) => {
      let query = this.db
        .from('flashcards')
        .select('id, front, back, deck_id, created_at, decks!inner(id, name, user_id, course_id)')
        .or(`front.ilike.${pattern},back.ilike.${pattern}`);
      query = this.applyOwnerScope(query, userId, 'user_id', 'id', sharedDeckIds, 'decks');
      query = this.applyCourseFilter(query, 'decks.course_id', courseFilter);
      if (excludeRemoved) query = query.is('decks.removed_by_admin_at', null);
      return query.order('created_at', { ascending: false }).limit(limit);
    });
    const results: RankedResult[] = [];
    for (const row of rows) {
      const deck = Array.isArray(row.decks) ? row.decks[0] : row.decks;
      const deckId = String(row.deck_id ?? deck?.id ?? '');
      if (!deckId) continue;
      const frontMatched = includesFold(row.front, q);
      results.push({
        rank: rankMatch(q, row.front, [row.back]),
        time: toTime(row.created_at),
        result: {
          type: 'flashcard',
          id: String(row.id),
          title: clip(cleanText(row.front) || 'Flashcard', TITLE_MAX_LENGTH),
          snippet: buildSnippet(frontMatched && !cleanText(row.back) ? row.front : row.back, q),
          courseId: deck?.course_id ? String(deck.course_id) : null,
          deckId,
          deckTitle: cleanText(deck?.name) || undefined,
          matchedIn: frontMatched ? 'front' : 'back',
          updatedAt: toIso(row.created_at),
        },
      });
    }
    return results;
  }

  private async searchBundles(
    userId: string,
    q: string,
    pattern: string,
    courseFilter: CourseFilter,
    limit: number
  ): Promise<RankedResult[]> {
    let query = this.db
      .from('offline_bundles')
      .select('id, bundle_id, display_name, group_name, course_id, updated_at')
      .eq('user_id', userId)
      .or(`display_name.ilike.${pattern},group_name.ilike.${pattern}`);
    query = this.applyCourseFilter(query, 'course_id', courseFilter);
    query = query.order('updated_at', { ascending: false }).limit(limit);

    const rows = await this.run('offline_bundles', query);
    return rows.map((row) => {
      const displayName = cleanText(row.display_name);
      const groupName = cleanText(row.group_name);
      const title = displayName || groupName || 'Offline bundle';
      const isPack = isPurchasedPackBundleId(row.bundle_id);
      const snippet =
        groupName && groupName !== title ? groupName : isPack ? 'Purchased question bank' : 'Offline bundle';
      return {
        rank: rankMatch(q, title, [displayName, groupName]),
        time: toTime(row.updated_at),
        result: {
          type: 'bundle' as const,
          id: String(row.bundle_id ?? row.id),
          title: clip(title, TITLE_MAX_LENGTH),
          snippet,
          courseId: row.course_id ? String(row.course_id) : null,
          matchedIn: includesFold(displayName, q) ? ('displayName' as const) : ('groupName' as const),
          updatedAt: toIso(row.updated_at),
        },
      };
    });
  }
}

let service: LibrarySearchService | null = null;

export function getLibrarySearchService(supabaseService: SupabaseService): LibrarySearchService {
  if (!service) service = new LibrarySearchService(supabaseService);
  return service;
}
