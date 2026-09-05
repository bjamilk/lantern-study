/**
 * "Browse by course" reads (Gap 3).
 *
 * What this pins:
 *   - the course index counts REAL rows: a course with one bank says one, and
 *     a course with no active listing never appears at all (no fake zeros, no
 *     padded totals);
 *   - only ACTIVE listings count, and only anchored ones are scanned;
 *   - a listing published BEFORE the course rule (course_id = null) is never
 *     counted and never breaks the index — the rule gates publishing, not
 *     reading;
 *   - the course page returns the listings filed under one course, and returns
 *     an honest empty page (not a 500) for a course nobody has published to;
 *   - a pre-migration schema degrades to "nothing is anchored yet" rather than
 *     500-ing the whole browse surface.
 */
import { MarketplaceCoursesService, isCourseId } from './marketplaceCourses';

jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const BIO = '11111111-1111-4111-8111-111111111111';
const CHM = '22222222-2222-4222-8222-222222222222';
const CAMPUS = '33333333-3333-4333-8333-333333333333';

type Result = { data: unknown; error?: unknown; count?: number };

interface Recorded {
  table: string;
  columns: string;
  eq: Array<[string, unknown]>;
  in: Array<[string, unknown]>;
  not: Array<[string, string, unknown]>;
}

/**
 * PostgREST double. Every builder is thenable, so `await query` resolves to the
 * canned result for that table; `maybeSingle()` resolves the same row.
 * Everything the query touched is recorded so a widened select or a dropped
 * status filter fails loudly instead of silently returning more.
 */
function makeDb(tables: Record<string, Result>) {
  const calls: Recorded[] = [];
  const from = (table: string) => {
    const record: Recorded = { table, columns: '', eq: [], in: [], not: [] };
    calls.push(record);
    const result = tables[table] ?? { data: [], error: null };
    const builder: any = {};
    builder.select = (columns: string) => {
      record.columns = columns;
      return builder;
    };
    builder.eq = (column: string, value: unknown) => {
      record.eq.push([column, value]);
      return builder;
    };
    builder.in = (column: string, value: unknown) => {
      record.in.push([column, value]);
      return builder;
    };
    builder.not = (column: string, op: string, value: unknown) => {
      record.not.push([column, op, value]);
      return builder;
    };
    builder.limit = () => builder;
    builder.order = () => builder;
    builder.range = () => builder;
    builder.maybeSingle = async () => ({
      data: Array.isArray(result.data) ? (result.data[0] ?? null) : result.data,
      error: result.error ?? null,
    });
    builder.then = (onFulfilled: any, onRejected: any) =>
      Promise.resolve({
        data: result.data,
        error: result.error ?? null,
        count: result.count,
      }).then(onFulfilled, onRejected);
    return builder;
  };
  return { db: { from }, calls };
}

function service(tables: Record<string, Result>) {
  const { db, calls } = makeDb(tables);
  return {
    svc: new MarketplaceCoursesService({ getClient: () => db } as any),
    calls,
  };
}

describe('isCourseId', () => {
  it('accepts a uuid and refuses anything else without coercing it', () => {
    expect(isCourseId(BIO)).toBe(true);
    expect(isCourseId('bio-201')).toBe(false);
    expect(isCourseId(null)).toBe(false);
    expect(isCourseId(42)).toBe(false);
  });
});

describe('listCoursesWithListings', () => {
  it('counts the real rows and breaks them down by kind', async () => {
    const { svc } = service({
      marketplace_listings: {
        data: [
          { course_id: BIO, listing_kind: 'question_bank' },
          { course_id: BIO, listing_kind: 'question_bank' },
          { course_id: BIO, listing_kind: 'study_pack' },
          { course_id: CHM, listing_kind: 'study_pack' },
        ],
        error: null,
      },
      courses: {
        data: [
          { id: BIO, code: 'BIO 201', title: 'Introductory Biology', institution_id: CAMPUS },
          { id: CHM, code: 'CHM 101', title: 'General Chemistry', institution_id: null },
        ],
        error: null,
      },
      marketplace_campuses: {
        data: [{ id: CAMPUS, name: 'University of Ibadan' }],
        error: null,
      },
    });

    const { courses, truncated } = await svc.listCoursesWithListings();

    expect(truncated).toBe(false);
    expect(courses).toEqual([
      {
        courseId: BIO,
        code: 'BIO 201',
        title: 'Introductory Biology',
        institutionId: CAMPUS,
        institutionName: 'University of Ibadan',
        listingCount: 3,
        questionBankCount: 2,
        studyPackCount: 1,
      },
      {
        courseId: CHM,
        code: 'CHM 101',
        title: 'General Chemistry',
        institutionId: null,
        institutionName: null,
        listingCount: 1,
        questionBankCount: 0,
        studyPackCount: 1,
      },
    ]);
  });

  it('scans only ACTIVE, course-anchored listings', async () => {
    const { svc, calls } = service({
      marketplace_listings: { data: [{ course_id: BIO, listing_kind: 'question_bank' }], error: null },
      courses: { data: [{ id: BIO, code: 'BIO 201', title: 'Bio', institution_id: null }], error: null },
    });
    await svc.listCoursesWithListings();

    const scan = calls.find((c) => c.table === 'marketplace_listings')!;
    expect(scan.columns).toBe('course_id, listing_kind');
    expect(scan.in).toEqual([['status', ['active']]]);
    expect(scan.not).toEqual([['course_id', 'is', null]]);
  });

  it('returns an honest empty index when nothing is anchored yet', async () => {
    const { svc, calls } = service({ marketplace_listings: { data: [], error: null } });
    await expect(svc.listCoursesWithListings()).resolves.toEqual({ courses: [], truncated: false });
    // No course lookup at all — there was nothing to look up.
    expect(calls.some((c) => c.table === 'courses')).toBe(false);
  });

  it('ignores listings published before the course rule (course_id null)', async () => {
    const { svc } = service({
      marketplace_listings: {
        data: [
          { course_id: null, listing_kind: 'question_bank' },
          { course_id: BIO, listing_kind: 'question_bank' },
        ],
        error: null,
      },
      courses: { data: [{ id: BIO, code: 'BIO 201', title: 'Bio', institution_id: null }], error: null },
    });
    const { courses } = await svc.listCoursesWithListings();
    expect(courses).toHaveLength(1);
    expect(courses[0].listingCount).toBe(1);
  });

  it('drops a tallied course whose row is gone rather than inventing a code', async () => {
    const { svc } = service({
      marketplace_listings: {
        data: [
          { course_id: BIO, listing_kind: 'question_bank' },
          { course_id: CHM, listing_kind: 'question_bank' },
        ],
        error: null,
      },
      // CHM's course row was deleted; only BIO comes back.
      courses: { data: [{ id: BIO, code: 'BIO 201', title: 'Bio', institution_id: null }], error: null },
    });
    const { courses } = await svc.listCoursesWithListings();
    expect(courses.map((c) => c.courseId)).toEqual([BIO]);
  });

  it('scopes to an institution when asked', async () => {
    const { svc, calls } = service({
      marketplace_listings: { data: [{ course_id: BIO, listing_kind: 'study_pack' }], error: null },
      courses: { data: [{ id: BIO, code: 'BIO 201', title: 'Bio', institution_id: CAMPUS }], error: null },
      marketplace_campuses: { data: [{ id: CAMPUS, name: 'UI' }], error: null },
    });
    await svc.listCoursesWithListings({ institutionId: CAMPUS });
    const courseQuery = calls.find((c) => c.table === 'courses')!;
    expect(courseQuery.eq).toContainEqual(['institution_id', CAMPUS]);
  });

  it('degrades to empty (not a 500) on a pre-migration schema', async () => {
    const { svc } = service({
      marketplace_listings: {
        data: null,
        error: { code: '42703', message: 'column marketplace_listings.course_id does not exist' },
      },
    });
    await expect(svc.listCoursesWithListings()).resolves.toEqual({ courses: [], truncated: false });
  });

  it('lets a real database failure escape rather than reporting a false empty', async () => {
    const { svc } = service({
      marketplace_listings: { data: null, error: { code: '57014', message: 'statement timeout' } },
    });
    await expect(svc.listCoursesWithListings()).rejects.toMatchObject({ code: '57014' });
  });
});

describe('listListingsForCourse', () => {
  const listingRow = {
    id: 'listing-1',
    title: 'BIO 201 Past Questions',
    description: 'Two sessions',
    price: 500,
    category: 'pq_bank',
    listing_kind: 'question_bank',
    status: 'active',
    created_at: '2026-03-01T00:00:00Z',
    campus_id: CAMPUS,
    user_id: 'seller-1',
    images: ['https://cdn/one.jpg', 'https://cdn/two.jpg'],
    category_specific_fields: { questionCount: 40, digital: true },
    seller: { id: 'seller-1', name: 'Ada' },
    campus: { id: CAMPUS, name: 'University of Ibadan' },
  };

  it('returns the course header and its listings, one image at most', async () => {
    const { svc } = service({
      courses: {
        data: [{ id: BIO, code: 'BIO 201', title: 'Introductory Biology', institution_id: CAMPUS }],
        error: null,
      },
      marketplace_listings: { data: [listingRow], error: null, count: 1 },
      marketplace_campuses: { data: [{ id: CAMPUS, name: 'University of Ibadan' }], error: null },
    });

    const page = await svc.listListingsForCourse(BIO);

    expect(page).not.toBeNull();
    expect(page!.course).toEqual({
      id: BIO,
      code: 'BIO 201',
      title: 'Introductory Biology',
      institutionId: CAMPUS,
      institutionName: 'University of Ibadan',
    });
    expect(page!.total).toBe(1);
    expect(page!.listings).toEqual([
      {
        id: 'listing-1',
        title: 'BIO 201 Past Questions',
        description: 'Two sessions',
        price: 500,
        category: 'pq_bank',
        listingKind: 'question_bank',
        status: 'active',
        createdAt: '2026-03-01T00:00:00Z',
        campusId: CAMPUS,
        campusName: 'University of Ibadan',
        sellerId: 'seller-1',
        sellerName: 'Ada',
        imageUrl: 'https://cdn/one.jpg',
        questionCount: 40,
      },
    ]);
  });

  it('filters to that course and to active listings only', async () => {
    const { svc, calls } = service({
      courses: { data: [{ id: BIO, code: 'BIO 201', title: 'Bio', institution_id: null }], error: null },
      marketplace_listings: { data: [], error: null, count: 0 },
    });
    await svc.listListingsForCourse(BIO);
    const query = calls.filter((c) => c.table === 'marketplace_listings').pop()!;
    expect(query.eq).toContainEqual(['course_id', BIO]);
    expect(query.in).toEqual([['status', ['active']]]);
    // Named columns only — never `*`, which would ship moderation and rights
    // state to every browser.
    expect(query.columns).not.toContain('*');
  });

  it('gives an honest empty page for a course nobody has published to', async () => {
    const { svc } = service({
      courses: { data: [{ id: CHM, code: 'CHM 101', title: 'Chem', institution_id: null }], error: null },
      marketplace_listings: { data: [], error: null, count: 0 },
    });
    const page = await svc.listListingsForCourse(CHM);
    expect(page!.listings).toEqual([]);
    expect(page!.total).toBe(0);
  });

  it('is a 404 (null) for an unknown course and for a malformed id, with no query for the latter', async () => {
    const { svc, calls } = service({ courses: { data: [], error: null } });
    await expect(svc.listListingsForCourse(BIO)).resolves.toBeNull();

    const before = calls.length;
    await expect(svc.listListingsForCourse('../../etc/passwd')).resolves.toBeNull();
    expect(calls).toHaveLength(before);
  });

  it('reports no image when the listing has none', async () => {
    const { svc } = service({
      courses: { data: [{ id: BIO, code: 'BIO 201', title: 'Bio', institution_id: null }], error: null },
      marketplace_listings: {
        data: [{ ...listingRow, images: [], category_specific_fields: null }],
        error: null,
        count: 1,
      },
    });
    const page = await svc.listListingsForCourse(BIO);
    expect(page!.listings[0].imageUrl).toBeNull();
    expect(page!.listings[0].questionCount).toBeNull();
  });
});
