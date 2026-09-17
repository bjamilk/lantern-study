/**
 * "Browse by course" — the read side of the course anchor (Gap 3).
 *
 * Every NEW question bank / study pack is filed under a course, so the course
 * is the durable entry point into the marketplace: a bank published in March is
 * still what a stranger finds in November. This service answers two questions
 * and nothing else:
 *
 *   1. Which courses have at least one ACTIVE listing, and how many? (counts
 *      are computed from the listing rows themselves — never padded, never
 *      cached from a different question.)
 *   2. What is filed under one course?
 *
 * It reads only; it never writes a course. Course creation goes through
 * academicCourses.findOrCreateCourse, which dedupes on (institution, normalised
 * code) and is race-safe — there must not be a second creation path.
 *
 * The rows returned carry NO image data on the course list: the browse list is
 * text-only by construction so low-data students never pay for thumbnails to
 * read a list of course codes. Images ride only on the per-course listing rows,
 * where the client decides whether to render them.
 */
import type { DataLayer } from './data';
import { logger } from '../utils/logger';
import type { MarketplaceCourseSummary } from '@lantern/shared/marketplace';

/** Statuses that count as "on sale right now". Mirrors the browse grid. */
const BROWSABLE_STATUSES = ['active'] as const;

/**
 * Ceiling on the anchored-listing rows scanned to build the course index.
 * The aggregate has no SQL GROUP BY available through PostgREST, so it is
 * grouped in memory; this bounds that work and is far above the live corpus.
 * `truncated` is reported so the client can say so rather than imply the index
 * is complete.
 */
export const COURSE_INDEX_SCAN_LIMIT = 5000;
export const DEFAULT_COURSE_INDEX_LIMIT = 60;
export const MAX_COURSE_INDEX_LIMIT = 200;
export const DEFAULT_COURSE_LISTINGS_LIMIT = 24;
export const MAX_COURSE_LISTINGS_LIMIT = 50;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCourseId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

/** PostgREST/Postgres "relation does not exist" — migration not applied yet. */
function isMissingRelationError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    /does not exist|could not find the table/i.test(error.message || '')
  );
}

/** Card shape for a listing filed under a course. Named columns only. */
export interface CourseListingCard {
  id: string;
  title: string;
  description: string | null;
  price: number | null;
  category: string;
  listingKind: string | null;
  status: string;
  createdAt: string | null;
  campusId: string | null;
  campusName: string | null;
  sellerId: string | null;
  sellerName: string | null;
  /** First image only, and only so the client can offer "Show images". */
  imageUrl: string | null;
  questionCount: number | null;
}

export interface CourseListingsPage {
  course: {
    id: string;
    code: string;
    title: string;
    institutionId: string | null;
    institutionName: string | null;
  };
  listings: CourseListingCard[];
  total: number;
}

const LISTING_CARD_COLUMNS = `
  id, title, description, price, category, listing_kind, status, created_at,
  campus_id, user_id, images, category_specific_fields,
  seller:profiles!user_id ( id, name ),
  campus:marketplace_campuses!campus_id ( id, name )
`;

function firstImage(images: unknown): string | null {
  if (!Array.isArray(images) || images.length === 0) return null;
  const first = images[0];
  return typeof first === 'string' && first ? first : null;
}

function questionCountOf(fields: unknown): number | null {
  if (!fields || typeof fields !== 'object') return null;
  const raw = (fields as Record<string, unknown>).questionCount;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function toCard(row: Record<string, any>): CourseListingCard {
  const seller = row.seller && typeof row.seller === 'object' ? row.seller : null;
  const campus = row.campus && typeof row.campus === 'object' ? row.campus : null;
  return {
    id: String(row.id),
    title: String(row.title ?? ''),
    description: typeof row.description === 'string' ? row.description : null,
    price: row.price == null ? null : Number(row.price),
    category: String(row.category ?? ''),
    listingKind: typeof row.listing_kind === 'string' ? row.listing_kind : null,
    status: String(row.status ?? ''),
    createdAt: typeof row.created_at === 'string' ? row.created_at : null,
    campusId: row.campus_id ? String(row.campus_id) : null,
    campusName: campus?.name ? String(campus.name) : null,
    sellerId: seller?.id ? String(seller.id) : null,
    sellerName: seller?.name ? String(seller.name) : null,
    imageUrl: firstImage(row.images),
    questionCount: questionCountOf(row.category_specific_fields),
  };
}

export class MarketplaceCoursesService {
  constructor(private readonly data: DataLayer) {}

  private get db() {
    return this.data.getClient();
  }

  /**
   * Courses that have at least one active listing filed under them, newest
   * corpus first by listing count. Counts are real: a course with one bank
   * says one, and a course with none never appears at all.
   */
  async listCoursesWithListings(
    options: { institutionId?: string | null; limit?: number } = {}
  ): Promise<{ courses: MarketplaceCourseSummary[]; truncated: boolean }> {
    const limit = Math.min(
      MAX_COURSE_INDEX_LIMIT,
      Math.max(1, Number(options.limit) || DEFAULT_COURSE_INDEX_LIMIT)
    );

    const { data, error } = await this.db
      .from('marketplace_listings')
      .select('course_id, listing_kind')
      .in('status', BROWSABLE_STATUSES as unknown as string[])
      .not('course_id', 'is', null)
      .limit(COURSE_INDEX_SCAN_LIMIT);

    if (error) {
      // A pre-migration schema (no course_id) must not 500 the whole browse
      // surface — it means "nothing is anchored yet", which is the truth.
      if (isMissingRelationError(error) || /course_id/i.test(error.message || '')) {
        logger.warn('Course browse unavailable on this schema', { error: error.message });
        return { courses: [], truncated: false };
      }
      throw error;
    }

    const rows = (data || []) as Array<{ course_id: string | null; listing_kind: string | null }>;
    const truncated = rows.length >= COURSE_INDEX_SCAN_LIMIT;

    const tally = new Map<
      string,
      { listingCount: number; questionBankCount: number; studyPackCount: number }
    >();
    for (const row of rows) {
      const courseId = row.course_id ? String(row.course_id) : '';
      if (!courseId) continue;
      const entry =
        tally.get(courseId) ?? { listingCount: 0, questionBankCount: 0, studyPackCount: 0 };
      entry.listingCount += 1;
      if (row.listing_kind === 'question_bank') entry.questionBankCount += 1;
      else if (row.listing_kind === 'study_pack') entry.studyPackCount += 1;
      tally.set(courseId, entry);
    }
    if (tally.size === 0) return { courses: [], truncated };

    const courseIds = [...tally.keys()];
    let courseQuery = this.db
      .from('courses')
      .select('id, code, title, institution_id')
      .in('id', courseIds);
    if (options.institutionId) {
      courseQuery = courseQuery.eq('institution_id', options.institutionId);
    }
    const { data: courseRows, error: courseError } = await courseQuery;
    if (courseError) {
      if (isMissingRelationError(courseError)) return { courses: [], truncated };
      throw courseError;
    }

    const courses = (courseRows || []) as Array<{
      id: string;
      code: string;
      title: string | null;
      institution_id: string | null;
    }>;
    const institutionNames = await this.institutionNames(
      courses.map((c) => c.institution_id).filter((id): id is string => Boolean(id))
    );

    const summaries: MarketplaceCourseSummary[] = courses.map((course) => {
      const counts = tally.get(String(course.id)) ?? {
        listingCount: 0,
        questionBankCount: 0,
        studyPackCount: 0,
      };
      return {
        courseId: String(course.id),
        code: String(course.code ?? ''),
        title: String(course.title ?? ''),
        institutionId: course.institution_id ? String(course.institution_id) : null,
        institutionName: course.institution_id
          ? institutionNames.get(String(course.institution_id)) ?? null
          : null,
        listingCount: counts.listingCount,
        questionBankCount: counts.questionBankCount,
        studyPackCount: counts.studyPackCount,
      };
    });

    summaries.sort(
      (a, b) => b.listingCount - a.listingCount || a.code.localeCompare(b.code)
    );
    return { courses: summaries.slice(0, limit), truncated };
  }

  /** Course page: the active listings filed under one course. */
  async listListingsForCourse(
    courseId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<CourseListingsPage | null> {
    if (!isCourseId(courseId)) return null;
    const limit = Math.min(
      MAX_COURSE_LISTINGS_LIMIT,
      Math.max(1, Number(options.limit) || DEFAULT_COURSE_LISTINGS_LIMIT)
    );
    const offset = Math.max(0, Number(options.offset) || 0);

    const { data: courseRow, error: courseError } = await this.db
      .from('courses')
      .select('id, code, title, institution_id')
      .eq('id', courseId)
      .maybeSingle();
    if (courseError) {
      if (isMissingRelationError(courseError)) return null;
      throw courseError;
    }
    if (!courseRow) return null;

    const { data, error, count } = await this.db
      .from('marketplace_listings')
      .select(LISTING_CARD_COLUMNS, { count: 'exact' })
      .eq('course_id', courseId)
      .in('status', BROWSABLE_STATUSES as unknown as string[])
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) {
      if (isMissingRelationError(error) || /course_id/i.test(error.message || '')) {
        // Honest empty rather than a 500: the anchor column is not there yet.
        return {
          course: this.toCourseHeader(courseRow, await this.institutionNames(
            courseRow.institution_id ? [String(courseRow.institution_id)] : []
          )),
          listings: [],
          total: 0,
        };
      }
      throw error;
    }

    const institutionNames = await this.institutionNames(
      courseRow.institution_id ? [String(courseRow.institution_id)] : []
    );
    const rows = (data || []) as Array<Record<string, any>>;
    return {
      course: this.toCourseHeader(courseRow, institutionNames),
      listings: rows.map(toCard),
      total: count ?? rows.length,
    };
  }

  private toCourseHeader(
    row: Record<string, any>,
    institutionNames: Map<string, string>
  ): CourseListingsPage['course'] {
    const institutionId = row.institution_id ? String(row.institution_id) : null;
    return {
      id: String(row.id),
      code: String(row.code ?? ''),
      title: String(row.title ?? ''),
      institutionId,
      institutionName: institutionId ? institutionNames.get(institutionId) ?? null : null,
    };
  }

  /** Institutions are marketplace_campuses rows (see academicCourses.ts). */
  private async institutionNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return new Map();
    const { data, error } = await this.db
      .from('marketplace_campuses')
      .select('id, name')
      .in('id', unique);
    if (error) {
      // A missing campus name is a blank line, not a failed page.
      logger.warn('Could not resolve institution names for course browse', {
        error: error.message,
      });
      return new Map();
    }
    const out = new Map<string, string>();
    for (const row of (data || []) as Array<{ id: string; name: string | null }>) {
      if (row.name) out.set(String(row.id), String(row.name));
    }
    return out;
  }
}

let coursesService: MarketplaceCoursesService | null = null;

export function getMarketplaceCoursesService(
  data: DataLayer
): MarketplaceCoursesService {
  if (!coursesService) coursesService = new MarketplaceCoursesService(data);
  return coursesService;
}

/** Tests only — the singleton above memoises the first service it is handed. */
export function resetMarketplaceCoursesServiceForTests(): void {
  coursesService = null;
}
