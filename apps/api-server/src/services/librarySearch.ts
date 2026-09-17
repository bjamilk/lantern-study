/**
 * Library archive (Phase 1 · B) — the course tree overview and the
 * cross-artefact search behind "My Lantern Library".
 *
 * Shapes are pinned by docs/phase1-library-archive-contract.md §1 — web and
 * mobile are built against them, so keep the wire names stable:
 *
 *   GET /library/overview → { years: [{ academicYear, courses: [{ course,
 *     enrolment, counts: { notes, decks, tests, bundles, purchasedPacks },
 *     topics?: [{ topic, counts }], untopiced? }] }],
 *     unfiled: { notes, decks, tests, bundles } }
 *   GET /library/search  → [{ type, id, title, snippet, courseId, topicId?, deckId?, updatedAt }]
 *
 * Query strategy (PostgREST through supabase-js; there is no raw SQL client in
 * this server):
 *   - overview: ONE service call = the caller's enrolments + one owner-scoped
 *     `course_id, topic_id` projection per artefact table (paged in 1000-row
 *     chunks only when a user has more rows than PostgREST returns at once),
 *     aggregated in TS. Purchased packs (`offline_bundles.bundle_id` =
 *     'qbank-<listingId>') are filed under the listing's `course_id` with one
 *     extra lookup — never N+1 per course. The topics seen are resolved with
 *     one more chunked lookup, so the third level costs one query, not one per
 *     course.
 *   - search: one ILIKE query per REQUESTED type (notes + their attachments,
 *     decks, flashcards, bundles), owner-scoped (own rows + notes/decks the
 *     caller collaborates on), then ranked in TS: exact prefix on the title
 *     beats contains, which beats a match in secondary text; ties by recency.
 *     Flashcards stay grouped under their deck.
 */
import type { DataLayer } from './data';
import { PublicError } from '../utils/safeError';
import { logger } from '../utils/logger';
import {
  AcademicCoursesService,
  applyCourseFilter,
  isMissingColumnError,
  isMissingRelationError,
  isUuid,
  parseCourseFilter,
  type CourseFilter,
  type CourseRecord,
  type UserCourseRecord,
} from './academicCourses';
import type { CourseTopic } from '@lantern/shared/types';
import { compareCourseTopics } from '@lantern/shared/learning';

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
/** Topic ids are batched the same way. */
const TOPIC_LOOKUP_CHUNK = 200;
/**
 * The course_topics migration is applied by hand, so a running server outlives
 * "topic_id does not exist". Remember that for a few minutes instead of
 * re-probing (and re-warning) on every request, but re-probe eventually so the
 * archive grows its third level without a redeploy.
 */
const TOPIC_COLUMN_RECHECK_MS = 5 * 60 * 1000;

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

/** Wire shape of a topic — the shared `CourseTopic`, under this module's `…Record` naming. */
export type CourseTopicRecord = CourseTopic;

/** The third level of the archive: year → course → topic (Phase 1 · A). */
export interface LibraryTopicNode {
  topic: CourseTopicRecord;
  /** offline_bundles has no topic_id, so `bundles`/`purchasedPacks` are always 0 here. */
  counts: LibraryCourseCounts;
}

export interface LibraryCourseNode {
  course: CourseRecord;
  enrolment: UserCourseRecord;
  /** The TOTAL for the course — `topics` partitions it and `untopiced` is the remainder. */
  counts: LibraryCourseCounts;
  /**
   * The course's topics that hold at least one artefact, by position then
   * title. Omitted entirely — never [] — when there are none or while the
   * course_topics migration is unapplied, so "no topics" and "topics not
   * available yet" look identical to a client: render the flat course.
   */
  topics?: LibraryTopicNode[];
  /** Artefacts under the course but under no topic. Present exactly with `topics`. */
  untopiced?: LibraryCourseCounts;
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
  /** Topic within `courseId`. Absent — not null — while the course_topics migration is unapplied. */
  topicId?: string | null;
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
  /**
   * A topic id, or the literal 'null' for items under no topic. Same grammar as
   * `courseId`, and legal on its own — a topic already implies its course.
   */
  topicId?: string | null;
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

/**
 * `undefined` when topic_id was not projected (migration unapplied — the field
 * is then omitted from the wire row), `null` when it was projected and empty.
 */
const topicIdOf = (row: Record<string, any> | null | undefined): string | null | undefined => {
  if (!row || row.topic_id === undefined) return undefined;
  return row.topic_id ? String(row.topic_id) : null;
};

type CountMap = Map<string | null, number>;

const bump = (map: CountMap, key: string | null) => map.set(key, (map.get(key) ?? 0) + 1);
const countOf = (map: CountMap, key: string | null) => map.get(key) ?? 0;

/** One artefact table counted three ways: by course, by topic, and the no-topic remainder per course. */
interface ArtefactTally {
  byCourse: CountMap;
  byTopic: CountMap;
  untopiced: CountMap;
}

/**
 * Count rows by course and, when the topic lookup is available, split each
 * course's total into its topics plus a remainder. A topic id that did not
 * resolve — or that belongs to a *different* course than the row — counts as
 * untopiced rather than being dropped, so the split always adds back up to the
 * course total.
 */
function tallyByCourseAndTopic(
  rows: Array<{ course_id?: string | null; topic_id?: string | null }>,
  topics: Map<string, CourseTopicRecord> | undefined
): ArtefactTally {
  const tally: ArtefactTally = { byCourse: new Map(), byTopic: new Map(), untopiced: new Map() };
  for (const row of rows) {
    const courseId = row.course_id ? String(row.course_id) : null;
    bump(tally.byCourse, courseId);
    if (!topics || !courseId) continue;
    const topic = row.topic_id ? topics.get(String(row.topic_id)) : undefined;
    if (topic && topic.courseId === courseId) bump(tally.byTopic, topic.id);
    else bump(tally.untopiced, courseId);
  }
  return tally;
}

export interface OverviewFixture {
  enrolments: UserCourseRecord[];
  notes: Array<{ course_id?: string | null; topic_id?: string | null }>;
  decks: Array<{ course_id?: string | null; topic_id?: string | null }>;
  tests: Array<{ course_id?: string | null; topic_id?: string | null }>;
  bundles: Array<{ course_id?: string | null; bundle_id?: string | null }>;
  /** listing id → listing course_id, for purchased packs. */
  listingCourses?: Map<string, string | null>;
  /**
   * topic id → topic, for exactly the topic ids seen above. Omitted while the
   * course_topics migration is unapplied — which is what keeps `topics` and
   * `untopiced` off every course node.
   */
  topics?: Map<string, CourseTopicRecord>;
}

/** Fold the projected rows into the overview tree (pure; unit-tested on fixtures). */
export function aggregateLibraryOverview(input: OverviewFixture): LibraryOverviewRecord {
  const courseKey = (row: { course_id?: string | null }): string | null =>
    row.course_id ? String(row.course_id) : null;

  const notes = tallyByCourseAndTopic(input.notes, input.topics);
  const decks = tallyByCourseAndTopic(input.decks, input.topics);
  const tests = tallyByCourseAndTopic(input.tests, input.topics);
  const notesBy = notes.byCourse;
  const decksBy = decks.byCourse;
  const testsBy = tests.byCourse;
  const bundlesBy: CountMap = new Map();
  const packsBy: CountMap = new Map();

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

  // Only topics something is actually filed under reach the tree — an empty
  // outline level would be noise the client has to filter out again.
  const topicsByCourse = new Map<string, CourseTopicRecord[]>();
  for (const topic of input.topics ? Array.from(input.topics.values()) : []) {
    const filed =
      countOf(notes.byTopic, topic.id) + countOf(decks.byTopic, topic.id) + countOf(tests.byTopic, topic.id);
    if (filed === 0) continue;
    const list = topicsByCourse.get(topic.courseId) ?? [];
    list.push(topic);
    topicsByCourse.set(topic.courseId, list);
  }
  for (const list of topicsByCourse.values()) {
    // THE shared outline order (position → title → id), so the tree the server
    // sends already agrees with how both clients re-sort it — no reorder flash.
    list.sort((a, b) => compareCourseTopics(a, b));
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
    const courseTopics = topicsByCourse.get(courseId);
    if (courseTopics) {
      node.topics = courseTopics.map((topic) => ({
        topic,
        counts: {
          notes: countOf(notes.byTopic, topic.id),
          decks: countOf(decks.byTopic, topic.id),
          tests: countOf(tests.byTopic, topic.id),
          // Bundles carry no topic_id, so they stay whole on the course node.
          bundles: 0,
          purchasedPacks: 0,
        },
      }));
      node.untopiced = {
        notes: countOf(notes.untopiced, courseId),
        decks: countOf(decks.untopiced, courseId),
        tests: countOf(tests.untopiced, courseId),
        bundles: countOf(bundlesBy, courseId),
        purchasedPacks: countOf(packsBy, courseId),
      };
    }
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

const unique = (values: unknown[]): string[] => Array.from(new Set(values.filter(isUuid)));

/**
 * `removed_by_admin_at` (moderation takedown; notes since 20260822140000,
 * decks since 20260608100000) missing = migration not applied. The moderation
 * filter is then retried without, so the archive still works pre-migration.
 */
const isMissingModerationColumn = (error: { code?: string; message?: string } | null | undefined): boolean =>
  isMissingColumnError(error) && /removed_by_admin_at/i.test(error?.message || '');

/** The parsed ?courseId/?topicId filters one search runs under. */
interface SearchScope {
  course: CourseFilter;
  topic: CourseFilter;
  /** Project (and filter on) topic_id — false while the course_topics migration is unapplied. */
  withTopic: boolean;
  /** ONE topic was named, so a table without topic_id must match nothing rather than everything. */
  topicFiltered: boolean;
}

/** A scope narrowed to the columns a single attempt will actually touch. */
type SearchAttempt = SearchScope & { excludeRemoved: boolean };

// ---------- Service ----------

export class LibrarySearchService {
  private readonly courses: AcademicCoursesService;
  /** When we last found `topic_id` missing; null = never, or due for a re-probe. */
  private topicColumnMissingSince: number | null = null;

  constructor(
    private data: DataLayer,
    courses?: AcademicCoursesService
  ) {
    // TRANSITIONAL (M2d): `AcademicCoursesService` still takes the `SupabaseService` facade whole.
    this.courses = courses ?? new AcademicCoursesService(data.legacyService);
  }

  private get db() {
    return this.data.getClient();
  }

  /** True while we still believe the course_topics migration is unapplied. */
  private get skipTopicProjection(): boolean {
    return (
      this.topicColumnMissingSince !== null &&
      Date.now() - this.topicColumnMissingSince < TOPIC_COLUMN_RECHECK_MS
    );
  }

  private noteTopicColumnMissing(label: string): void {
    // Warn on the discovery, not on every request that inherits it.
    if (this.topicColumnMissingSince === null) {
      logger.warn(`library: topic_id unavailable on ${label} — course_topics migration not applied; topics omitted`);
    }
    this.topicColumnMissingSince = Date.now();
  }

  private noteTopicColumnPresent(): void {
    this.topicColumnMissingSince = null;
  }

  // ----- Overview -----

  async getOverview(userId: string): Promise<LibraryOverviewRecord> {
    const withTopic = !this.skipTopicProjection;
    const [enrolments, notes, decks, tests, bundles] = await Promise.all([
      this.courses.listUserCourses(userId, { status: 'all' }),
      // Notes/decks moderation removed are gone for everyone but admins.
      this.fetchOwnedRows('notes', 'course_id', userId, undefined, { excludeRemoved: true, withTopic }),
      this.fetchOwnedRows('decks', 'course_id', userId, undefined, { excludeRemoved: true, withTopic }),
      // Abandoned sessions are trash, not archive material.
      this.fetchOwnedRows('test_sessions', 'course_id', userId, (query) => query.neq('status', 'abandoned'), {
        withTopic,
      }),
      this.fetchOwnedRows('offline_bundles', 'course_id, bundle_id', userId),
    ]);
    const [listingCourses, topics] = await Promise.all([
      this.resolveListingCourses(bundles),
      this.resolveTopics([notes, decks, tests]),
    ]);
    return aggregateLibraryOverview({ enrolments, notes, decks, tests, bundles, listingCourses, topics });
  }

  /**
   * Owner-scoped projection of `columns`, paged past PostgREST's 1000-row cap.
   * `excludeRemoved` adds `removed_by_admin_at IS NULL` and `withTopic` adds the
   * `topic_id` column — each retried without when it does not exist yet, so an
   * unapplied migration costs a level of detail and never the rows themselves.
   */
  private async fetchOwnedRows(
    table: string,
    columns: string,
    userId: string,
    refine?: (query: any) => any,
    options: { excludeRemoved?: boolean; withTopic?: boolean } = {}
  ): Promise<Record<string, any>[]> {
    const rows: Record<string, any>[] = [];
    let excludeRemoved = Boolean(options.excludeRemoved);
    let withTopic = Boolean(options.withTopic);
    for (let page = 0; page < OVERVIEW_MAX_PAGES; page++) {
      let query = this.db
        .from(table)
        .select(withTopic ? `${columns}, topic_id` : columns)
        .eq('user_id', userId);
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
        // Dropping topic_id must come before the generic bail-out: returning
        // early here would report zero notes/decks/tests for every course.
        if (withTopic && isMissingColumnError(error)) {
          this.noteTopicColumnMissing(table);
          withTopic = false;
          page -= 1; // retry this page without the topic split
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
    if (withTopic) this.noteTopicColumnPresent();
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

  /**
   * Titles and positions for exactly the topic ids the artefact rows referenced
   * (one lookup, chunked) — never a scan per course. `undefined` means there is
   * no topic dimension at all: nothing referenced a topic, or course_topics does
   * not exist yet, and the overview then carries no `topics` anywhere.
   */
  private async resolveTopics(
    rowSets: Array<Array<{ topic_id?: string | null }>>
  ): Promise<Map<string, CourseTopicRecord> | undefined> {
    const topicIds = unique(rowSets.flat().map((row) => row.topic_id));
    if (topicIds.length === 0) return undefined;
    const map = new Map<string, CourseTopicRecord>();
    for (let i = 0; i < topicIds.length; i += TOPIC_LOOKUP_CHUNK) {
      const chunk = topicIds.slice(i, i + TOPIC_LOOKUP_CHUNK);
      const { data, error } = await this.db
        .from('course_topics')
        .select('id, course_id, title, position')
        .in('id', chunk);
      if (error) {
        if (isMissingRelationError(error) || isMissingColumnError(error)) {
          logger.warn(`library overview: topic lookup unavailable (${error.message || error.code})`);
          return undefined;
        }
        throw error;
      }
      for (const row of (data || []) as Record<string, any>[]) {
        if (!row.id || !row.course_id) continue; // a topic without its course cannot be placed
        map.set(String(row.id), {
          id: String(row.id),
          courseId: String(row.course_id),
          title: String(row.title ?? ''),
          position: Number(row.position ?? 0),
        });
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
    const topicFilter = this.toTopicFilter(options.topicId);
    const scope: SearchScope = {
      course: this.toCourseFilter(options.courseId),
      topic: topicFilter,
      topicFiltered: topicFilter.kind === 'course',
      // A named topic is probed even when we believe topic_id is missing:
      // silently dropping that filter would look like it had been ignored.
      withTopic: topicFilter.kind === 'course' || !this.skipTopicProjection,
    };
    const pattern = `%${escapeLikePattern(q)}%`;

    const wantsDecks = types.includes('decks');
    const wantsFlashcards = types.includes('flashcards');
    const sharedDeckIds =
      wantsDecks || wantsFlashcards ? await this.collaboratorIds('deck_collaborators', 'deck_id', userId) : [];

    const batches = await Promise.all([
      types.includes('notes') ? this.searchNotes(userId, q, pattern, scope, limit) : Promise.resolve([]),
      wantsDecks ? this.searchDecks(userId, q, pattern, scope, limit, sharedDeckIds) : Promise.resolve([]),
      wantsFlashcards
        ? this.searchFlashcards(userId, q, pattern, scope, limit, sharedDeckIds)
        : Promise.resolve([]),
      // offline_bundles has no topic_id, so a bundle can never sit under a
      // topic: naming one excludes them, "no topic" keeps them all.
      types.includes('bundles') && !scope.topicFiltered
        ? this.searchBundles(userId, q, pattern, scope, limit)
        : Promise.resolve([]),
    ]);

    return orderSearchResults(batches.flat(), limit);
  }

  /** Shared parser (academicCourses.parseCourseFilter); invalid → PublicError (400). */
  private toCourseFilter(raw: string | null | undefined): CourseFilter {
    const filter = parseCourseFilter(raw);
    if (filter.kind === 'invalid') throw new PublicError('courseId must be a course id or null');
    return filter;
  }

  /** Same grammar as courseId — a topic id, 'null' for items under no topic, or absent. */
  private toTopicFilter(raw: string | null | undefined): CourseFilter {
    const filter = parseCourseFilter(raw);
    if (filter.kind === 'invalid') throw new PublicError('topicId must be a topic id or null');
    return filter;
  }

  private applyCourseFilter(query: any, column: string, filter: CourseFilter): any {
    return applyCourseFilter(query, column, filter);
  }

  /** Course filter always; topic filter only on an attempt that projects topic_id. */
  private applyScope(query: any, attempt: SearchAttempt, courseColumn: string, topicColumn: string): any {
    const scoped = applyCourseFilter(query, courseColumn, attempt.course);
    return attempt.withTopic ? applyCourseFilter(scoped, topicColumn, attempt.topic) : scoped;
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
   * Run a query whose builder opts into the two columns a DB may not have yet:
   * `removed_by_admin_at` (moderation removed never surface in search) and
   * `topic_id`. Either missing retries without it, so an unapplied migration
   * costs a filter, not the results. The exception is a named topic: nothing
   * can sit under a topic in a table that has no topics, so that returns empty
   * rather than quietly widening the search back out.
   */
  private async runDegrading(
    label: string,
    scope: SearchScope,
    build: (attempt: SearchAttempt) => any
  ): Promise<Record<string, any>[]> {
    const attempt: SearchAttempt = { ...scope, excludeRemoved: true };
    // One retry per droppable column, then the generic bail-out below.
    for (let tries = 0; tries < 3; tries++) {
      const { data, error } = await build(attempt);
      if (!error) {
        if (attempt.withTopic) this.noteTopicColumnPresent();
        return (data || []) as Record<string, any>[];
      }
      // Moderation first: its message is the specific case of a missing column.
      if (attempt.excludeRemoved && isMissingModerationColumn(error)) {
        logger.warn(`library search: ${label} has no removed_by_admin_at column — moderation filter skipped`);
        attempt.excludeRemoved = false;
        continue;
      }
      if (attempt.withTopic && isMissingColumnError(error)) {
        this.noteTopicColumnMissing(label);
        if (attempt.topicFiltered) return [];
        attempt.withTopic = false;
        continue;
      }
      if (isMissingRelationError(error) || isMissingColumnError(error)) {
        logger.warn(`library search: ${label} unavailable (${error.message || error.code})`);
        return [];
      }
      throw error;
    }
    return [];
  }

  private async searchNotes(
    userId: string,
    q: string,
    pattern: string,
    scope: SearchScope,
    limit: number
  ): Promise<RankedResult[]> {
    const sharedNoteIds = await this.collaboratorIds('note_collaborators', 'note_id', userId);

    const buildNotesQuery = (attempt: SearchAttempt) => {
      const topicColumn = attempt.withTopic ? ', topic_id' : '';
      let notesQuery = this.db
        .from('notes')
        .select(`id, title, summary, body, course_id${topicColumn}, updated_at`);
      notesQuery = this.applyOwnerScope(notesQuery, userId, 'user_id', 'id', sharedNoteIds);
      notesQuery = notesQuery.or(`title.ilike.${pattern},summary.ilike.${pattern},body.ilike.${pattern}`);
      notesQuery = this.applyScope(notesQuery, attempt, 'course_id', 'topic_id');
      if (attempt.excludeRemoved) notesQuery = notesQuery.is('removed_by_admin_at', null);
      return notesQuery.order('updated_at', { ascending: false }).limit(limit);
    };

    // Imported notes keep their content in attachments' extracted_text, not the body.
    const buildAttachmentsQuery = (attempt: SearchAttempt) => {
      const topicColumn = attempt.withTopic ? ', topic_id' : '';
      let attachmentsQuery = this.db
        .from('note_attachments')
        .select(
          `note_id, file_name, extracted_text, notes!inner(id, title, course_id${topicColumn}, updated_at)`
        )
        .ilike('extracted_text', pattern);
      attachmentsQuery = this.applyOwnerScope(attachmentsQuery, userId, 'user_id', 'id', sharedNoteIds, 'notes');
      attachmentsQuery = this.applyScope(attachmentsQuery, attempt, 'notes.course_id', 'notes.topic_id');
      if (attempt.excludeRemoved) attachmentsQuery = attachmentsQuery.is('notes.removed_by_admin_at', null);
      return attachmentsQuery.limit(limit);
    };

    const [noteRows, attachmentRows] = await Promise.all([
      this.runDegrading('notes', scope, buildNotesQuery),
      this.runDegrading('note_attachments', scope, buildAttachmentsQuery),
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
          topicId: topicIdOf(row),
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
          topicId: topicIdOf(note),
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
    scope: SearchScope,
    limit: number,
    sharedDeckIds: string[]
  ): Promise<RankedResult[]> {
    const rows = await this.runDegrading('decks', scope, (attempt) => {
      const topicColumn = attempt.withTopic ? ', topic_id' : '';
      let query = this.db.from('decks').select(`id, name, description, course_id${topicColumn}, created_at`);
      query = this.applyOwnerScope(query, userId, 'user_id', 'id', sharedDeckIds);
      query = query.or(`name.ilike.${pattern},description.ilike.${pattern}`);
      query = this.applyScope(query, attempt, 'course_id', 'topic_id');
      if (attempt.excludeRemoved) query = query.is('removed_by_admin_at', null);
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
        topicId: topicIdOf(row),
        matchedIn: includesFold(row.name, q) ? ('name' as const) : ('description' as const),
        updatedAt: toIso(row.created_at),
      },
    }));
  }

  private async searchFlashcards(
    userId: string,
    q: string,
    pattern: string,
    scope: SearchScope,
    limit: number,
    sharedDeckIds: string[]
  ): Promise<RankedResult[]> {
    // A card inherits its course and its topic from the deck it lives in.
    const rows = await this.runDegrading('flashcards', scope, (attempt) => {
      const topicColumn = attempt.withTopic ? ', topic_id' : '';
      let query = this.db
        .from('flashcards')
        .select(`id, front, back, deck_id, created_at, decks!inner(id, name, user_id, course_id${topicColumn})`)
        .or(`front.ilike.${pattern},back.ilike.${pattern}`);
      query = this.applyOwnerScope(query, userId, 'user_id', 'id', sharedDeckIds, 'decks');
      query = this.applyScope(query, attempt, 'decks.course_id', 'decks.topic_id');
      if (attempt.excludeRemoved) query = query.is('decks.removed_by_admin_at', null);
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
          topicId: topicIdOf(deck),
          deckId,
          deckTitle: cleanText(deck?.name) || undefined,
          matchedIn: frontMatched ? 'front' : 'back',
          updatedAt: toIso(row.created_at),
        },
      });
    }
    return results;
  }

  /** Bundles carry no topic_id — the caller already excludes them when a topic is named. */
  private async searchBundles(
    userId: string,
    q: string,
    pattern: string,
    scope: SearchScope,
    limit: number
  ): Promise<RankedResult[]> {
    let query = this.db
      .from('offline_bundles')
      .select('id, bundle_id, display_name, group_name, course_id, updated_at')
      .eq('user_id', userId)
      .or(`display_name.ilike.${pattern},group_name.ilike.${pattern}`);
    query = this.applyCourseFilter(query, 'course_id', scope.course);
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

export function getLibrarySearchService(data: DataLayer): LibrarySearchService {
  if (!service) service = new LibrarySearchService(data);
  return service;
}
