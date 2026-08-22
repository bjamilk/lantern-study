/**
 * Library archive (Phase 1 · B): the invariants web/mobile build on.
 *
 *  1. /library/search queries ONLY the requested types, escapes the LIKE
 *     metacharacters in q (so "50%" finds "50%", not everything) and strips the
 *     PostgREST or() delimiters; it is owner-scoped (own rows + collaborator
 *     rows) and ranks title-prefix > title-contains > secondary text, then
 *     recency — with flashcards kept together under their deck.
 *  2. /library/overview is one service call: a course_id projection per
 *     artefact table aggregated in TS (never N+1 per course), purchased packs
 *     filed by the listing's course, archived enrolments kept with status.
 *
 * Same PostgREST-double style as academicCourses.test.ts: canned per-table
 * results plus a log of every builder call so the exact filters are asserted.
 */
import {
  LIBRARY_SEARCH_MAX_LIMIT,
  LibrarySearchService,
  aggregateLibraryOverview,
  escapeLikePattern,
  normalizeSearchQuery,
  parseLibrarySearchTypes,
} from './librarySearch';
import { PublicError } from '../utils/safeError';

type Op = { fn: string; args: unknown[] };
type Call = { table: string; ops: Op[] };
type Result = { data: unknown; error?: unknown };
type Responder = Result | ((call: Call, index: number) => Result);

function fakeDb(tables: Record<string, Responder> = {}) {
  const calls: Call[] = [];
  const perTable = new Map<string, number>();
  const resolve = (call: Call): Result => {
    const index = perTable.get(call.table) ?? 0;
    perTable.set(call.table, index + 1);
    const configured = tables[call.table];
    if (configured === undefined) return { data: [] };
    return typeof configured === 'function' ? configured(call, index) : configured;
  };
  const from = (table: string) => {
    const call: Call = { table, ops: [] };
    calls.push(call);
    const chain: any = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'then') {
            return (onOk: (v: Result) => unknown, onErr?: (e: unknown) => unknown) =>
              Promise.resolve(resolve(call)).then(onOk, onErr);
          }
          if (prop === 'single' || prop === 'maybeSingle') return async () => resolve(call);
          return (...args: unknown[]) => {
            call.ops.push({ fn: String(prop), args });
            return chain;
          };
        },
      }
    );
    return chain;
  };
  return { from, calls };
}

const service = (db: ReturnType<typeof fakeDb>) =>
  new LibrarySearchService({ getClient: () => db } as any);

const USER = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b';
const COURSE_BIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COURSE_CHM = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const COURSE_PHY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NOTE_SHARED = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DECK_SHARED = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const LISTING_1 = '11111111-1111-4111-8111-111111111111';
const LISTING_2 = '22222222-2222-4222-8222-222222222222';

const op = (call: Call | undefined, fn: string) => call?.ops.find((o) => o.fn === fn);
const ops = (call: Call | undefined, fn: string) => call?.ops.filter((o) => o.fn === fn) ?? [];
const tablesTouched = (db: ReturnType<typeof fakeDb>) => db.calls.map((c) => c.table);
const callFor = (db: ReturnType<typeof fakeDb>, table: string) => db.calls.find((c) => c.table === table);

describe('search helpers', () => {
  it('escapes %, _ and \\ so q is matched literally', () => {
    expect(escapeLikePattern('50%_a\\b')).toBe('50\\%\\_a\\\\b');
    expect(escapeLikePattern('plain')).toBe('plain');
  });

  it("strips PostgREST or() delimiters and collapses whitespace", () => {
    expect(normalizeSearchQuery('  a,(b)"c   d ')).toBe('a b c d');
    expect(normalizeSearchQuery('mth*101')).toBe('mth 101'); // PostgREST turns * into % inside ilike
    expect(normalizeSearchQuery(undefined)).toBe('');
    expect(normalizeSearchQuery('x'.repeat(150))).toHaveLength(100);
  });

  it('parses types as a comma list (string or array), defaults to all, rejects unknown values', () => {
    expect(parseLibrarySearchTypes(undefined)).toEqual(['notes', 'decks', 'flashcards', 'bundles']);
    expect(parseLibrarySearchTypes('')).toEqual(['notes', 'decks', 'flashcards', 'bundles']);
    expect(parseLibrarySearchTypes('flashcards, notes,notes')).toEqual(['notes', 'flashcards']);
    expect(parseLibrarySearchTypes(['decks', 'bundles'])).toEqual(['decks', 'bundles']);
    expect(parseLibrarySearchTypes('notes,tests')).toBeNull();
  });
});

describe('LibrarySearchService.search — query shape', () => {
  it('queries only the requested types and applies the escaped ILIKE pattern', async () => {
    const db = fakeDb();
    await service(db).search(USER, { q: '50%_a\\b', types: ['notes'] });

    const touched = tablesTouched(db);
    expect(touched).toEqual(expect.arrayContaining(['note_collaborators', 'notes', 'note_attachments']));
    for (const table of ['decks', 'deck_collaborators', 'flashcards', 'offline_bundles']) {
      expect(touched).not.toContain(table);
    }

    const pattern = '%50\\%\\_a\\\\b%';
    const notes = callFor(db, 'notes');
    const textFilter = ops(notes, 'or').find((o) => String(o.args[0]).includes('ilike'));
    expect(textFilter?.args[0]).toBe(
      `title.ilike.${pattern},summary.ilike.${pattern},body.ilike.${pattern}`
    );
    // Owner-scoped: no collaborator rows → a plain eq on user_id, no or().
    expect(op(notes, 'eq')?.args).toEqual(['user_id', USER]);
    expect(op(notes, 'limit')?.args).toEqual([30]);

    const attachments = callFor(db, 'note_attachments');
    expect(op(attachments, 'ilike')?.args).toEqual(['extracted_text', pattern]);
    expect(op(attachments, 'eq')?.args).toEqual(['notes.user_id', USER]);
    expect(String(op(attachments, 'select')?.args[0])).toContain('notes!inner(');
  });

  it('decks + flashcards share one collaborator lookup; bundles are owner-only', async () => {
    const db = fakeDb({ deck_collaborators: { data: [{ deck_id: DECK_SHARED }] } });
    await service(db).search(USER, { q: 'mendel', types: ['decks', 'flashcards', 'bundles'] });

    const touched = tablesTouched(db);
    expect(touched.filter((t) => t === 'deck_collaborators')).toHaveLength(1);
    expect(touched).not.toContain('notes');
    expect(touched).not.toContain('note_collaborators');
    expect(touched).not.toContain('note_attachments');

    const decks = callFor(db, 'decks');
    const deckScope = ops(decks, 'or').find((o) => String(o.args[0]).startsWith('user_id.eq.'));
    expect(deckScope?.args[0]).toBe(`user_id.eq.${USER},id.in.(${DECK_SHARED})`);
    const deckText = ops(decks, 'or').find((o) => String(o.args[0]).includes('ilike'));
    expect(deckText?.args[0]).toBe('name.ilike.%mendel%,description.ilike.%mendel%');

    const flashcards = callFor(db, 'flashcards');
    const cardScope = ops(flashcards, 'or').find((o) => String(o.args[0]).startsWith('user_id.eq.'));
    expect(cardScope?.args).toEqual([`user_id.eq.${USER},id.in.(${DECK_SHARED})`, { referencedTable: 'decks' }]);
    const cardText = ops(flashcards, 'or').find((o) => String(o.args[0]).includes('ilike'));
    expect(cardText?.args[0]).toBe('front.ilike.%mendel%,back.ilike.%mendel%');

    const bundles = callFor(db, 'offline_bundles');
    expect(op(bundles, 'eq')?.args).toEqual(['user_id', USER]);
    expect(op(bundles, 'or')?.args[0]).toBe('display_name.ilike.%mendel%,group_name.ilike.%mendel%');
  });

  it('includes notes the caller collaborates on via the embedded owner scope', async () => {
    const db = fakeDb({ note_collaborators: { data: [{ note_id: NOTE_SHARED }, { note_id: 'not-a-uuid' }] } });
    await service(db).search(USER, { q: 'osmosis', types: ['notes'] });

    const notes = callFor(db, 'notes');
    const scope = ops(notes, 'or').find((o) => String(o.args[0]).startsWith('user_id.eq.'));
    expect(scope?.args).toEqual([`user_id.eq.${USER},id.in.(${NOTE_SHARED})`]);

    const attachments = callFor(db, 'note_attachments');
    const attachmentScope = ops(attachments, 'or').find((o) => String(o.args[0]).startsWith('user_id.eq.'));
    expect(attachmentScope?.args).toEqual([`user_id.eq.${USER},id.in.(${NOTE_SHARED})`, { referencedTable: 'notes' }]);
  });

  it('sanitises or() delimiters out of q before building the filter', async () => {
    const db = fakeDb();
    await service(db).search(USER, { q: 'a,(b)"c', types: ['decks'] });
    const decks = callFor(db, 'decks');
    const text = ops(decks, 'or').find((o) => String(o.args[0]).includes('ilike'));
    expect(text?.args[0]).toBe('name.ilike.%a b c%,description.ilike.%a b c%');
  });

  it('applies the course filter per table (uuid → eq, "null" → is null; embedded for flashcards/attachments)', async () => {
    const db = fakeDb();
    await service(db).search(USER, { q: 'cell', courseId: COURSE_BIO });
    expect(op(callFor(db, 'notes'), 'eq')?.args).toEqual(['user_id', USER]);
    expect(ops(callFor(db, 'notes'), 'eq').map((o) => o.args)).toContainEqual(['course_id', COURSE_BIO]);
    expect(ops(callFor(db, 'note_attachments'), 'eq').map((o) => o.args)).toContainEqual(['notes.course_id', COURSE_BIO]);
    expect(ops(callFor(db, 'decks'), 'eq').map((o) => o.args)).toContainEqual(['course_id', COURSE_BIO]);
    expect(ops(callFor(db, 'flashcards'), 'eq').map((o) => o.args)).toContainEqual(['decks.course_id', COURSE_BIO]);
    expect(ops(callFor(db, 'offline_bundles'), 'eq').map((o) => o.args)).toContainEqual(['course_id', COURSE_BIO]);

    const unfiled = fakeDb();
    await service(unfiled).search(USER, { q: 'cell', courseId: 'null', types: ['notes', 'flashcards'] });
    expect(op(callFor(unfiled, 'notes'), 'is')?.args).toEqual(['course_id', null]);
    expect(op(callFor(unfiled, 'flashcards'), 'is')?.args).toEqual(['decks.course_id', null]);
  });

  it('rejects q under 2 characters (after sanitising) and a malformed courseId', async () => {
    const db = fakeDb();
    await expect(service(db).search(USER, { q: 'a' })).rejects.toBeInstanceOf(PublicError);
    await expect(service(db).search(USER, { q: ' ,, ' })).rejects.toBeInstanceOf(PublicError);
    await expect(service(db).search(USER, { q: 'ok', courseId: 'nope' })).rejects.toBeInstanceOf(PublicError);
    expect(db.calls).toHaveLength(0);
  });

  it('caps limit at 50 per query and on the merged result', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({
      id: `n${i}`,
      title: `Genetics ${i}`,
      body: '',
      course_id: null,
      updated_at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
    }));
    const db = fakeDb({ notes: { data: rows } });
    const results = await service(db).search(USER, { q: 'genetics', types: ['notes'], limit: 500 });
    expect(op(callFor(db, 'notes'), 'limit')?.args).toEqual([LIBRARY_SEARCH_MAX_LIMIT]);
    expect(results).toHaveLength(LIBRARY_SEARCH_MAX_LIMIT);
  });
});

describe('LibrarySearchService.search — ranking, grouping, snippets', () => {
  const iso = (day: number) => new Date(Date.UTC(2026, 7, day)).toISOString();

  it('ranks title prefix > title contains > secondary text, then recency, with flashcards grouped by deck', async () => {
    const db = fakeDb({
      notes: {
        data: [
          { id: 'n1', title: 'Genetics basics', summary: null, body: 'Mendel', course_id: COURSE_BIO, updated_at: iso(1) },
          { id: 'n2', title: 'Intro to genetics', summary: '', body: '', course_id: null, updated_at: iso(5) },
          { id: 'n3', title: 'Week 3', summary: null, body: 'Lecture on genetics and heredity', course_id: null, updated_at: iso(22) },
        ],
      },
      decks: { data: [{ id: 'd1', name: 'Genetics deck', description: 'Chapter 4', course_id: COURSE_BIO, created_at: iso(10) }] },
      flashcards: {
        data: [
          { id: 'f2', front: 'Mendel', back: 'Father of genetics', deck_id: 'd2', created_at: iso(21), decks: { id: 'd2', name: 'Bio 201', user_id: USER, course_id: COURSE_BIO } },
          { id: 'f1', front: 'What is genetics?', back: 'Study of heredity', deck_id: 'd2', created_at: iso(20), decks: { id: 'd2', name: 'Bio 201', user_id: USER, course_id: COURSE_BIO } },
        ],
      },
    });

    const results = await service(db).search(USER, { q: 'genetics' });
    expect(results.map((r) => `${r.type}:${r.id}`)).toEqual([
      'deck:d1', // rank 0 (prefix), newest of the rank-0 pair
      'note:n1', // rank 0 (prefix)
      'flashcard:f1', // deck d2 group: best rank 1, latest time 21 → before note n2 (rank 1, day 5)
      'flashcard:f2', // stays with its deck although it is rank 2 on its own
      'note:n2', // rank 1 (contains)
      'note:n3', // rank 2 (body match)
    ]);

    const f1 = results.find((r) => r.id === 'f1')!;
    expect(f1).toMatchObject({ type: 'flashcard', deckId: 'd2', deckTitle: 'Bio 201', courseId: COURSE_BIO, matchedIn: 'front' });
    const n3 = results.find((r) => r.id === 'n3')!;
    expect(n3.matchedIn).toBe('body');
    expect(n3.snippet).toContain('genetics');
    expect(results.find((r) => r.id === 'd1')).toMatchObject({ courseId: COURSE_BIO, snippet: 'Chapter 4', matchedIn: 'name', updatedAt: iso(10) });
  });

  it('surfaces notes matched only through attachment text once, and never duplicates a note', async () => {
    const db = fakeDb({
      notes: { data: [{ id: 'n1', title: 'Photosynthesis', body: '', course_id: null, updated_at: iso(2) }] },
      note_attachments: {
        data: [
          { note_id: 'n9', file_name: 'lecture3.pdf', extracted_text: 'Slide 4: photosynthesis in C4 plants …', notes: { id: 'n9', title: 'Lecture 3', course_id: COURSE_BIO, updated_at: iso(3) } },
          { note_id: 'n1', file_name: 'dup.pdf', extracted_text: 'photosynthesis again', notes: { id: 'n1', title: 'Photosynthesis', course_id: null, updated_at: iso(2) } },
        ],
      },
    });
    const results = await service(db).search(USER, { q: 'photosynthesis', types: ['notes'] });
    expect(results.map((r) => r.id)).toEqual(['n1', 'n9']);
    const n9 = results.find((r) => r.id === 'n9')!;
    expect(n9).toMatchObject({ type: 'note', title: 'Lecture 3', courseId: COURSE_BIO, matchedIn: 'attachment' });
    expect(n9.snippet).toContain('photosynthesis in C4');
  });

  it('maps bundles to their client-facing bundleId and labels purchased packs', async () => {
    const db = fakeDb({
      offline_bundles: {
        data: [
          { id: 'row-1', bundle_id: `qbank-${LISTING_1}`, display_name: 'MTH 101 Past Questions', group_name: 'Store', course_id: COURSE_BIO, updated_at: iso(8) },
          { id: 'row-2', bundle_id: 'local-77', display_name: null, group_name: 'MTH 101 study group', course_id: null, updated_at: iso(6) },
        ],
      },
    });
    const results = await service(db).search(USER, { q: 'mth 101', types: ['bundles'] });
    expect(results.map((r) => r.id)).toEqual([`qbank-${LISTING_1}`, 'local-77']);
    expect(results[0]).toMatchObject({ type: 'bundle', title: 'MTH 101 Past Questions', snippet: 'Store', courseId: COURSE_BIO, matchedIn: 'displayName' });
    expect(results[1]).toMatchObject({ type: 'bundle', title: 'MTH 101 study group', courseId: null, matchedIn: 'groupName' });
  });

  it('treats a missing table/column as "no results" instead of failing the whole search', async () => {
    const db = fakeDb({
      notes: { data: null, error: { code: '42P01', message: 'relation "notes" does not exist' } },
      decks: { data: [{ id: 'd1', name: 'Cells', description: null, course_id: null, created_at: iso(1) }] },
    });
    const results = await service(db).search(USER, { q: 'cells', types: ['notes', 'decks'] });
    expect(results.map((r) => r.id)).toEqual(['d1']);
  });
});

const courseRow = (id: string, code: string) => ({
  id,
  institution_id: null,
  code,
  title: `${code} title`,
  faculty: null,
  level: 200,
  semester: 1,
  is_canonical: false,
});

const enrolmentRow = (courseId: string, code: string, academicYear: string, status: 'active' | 'archived') => ({
  user_id: USER,
  course_id: courseId,
  academic_year: academicYear,
  semester: 1,
  status,
  exam_date: null,
  courses: courseRow(courseId, code),
});

describe('aggregateLibraryOverview — pure aggregation', () => {
  it('builds years → courses → counts, files purchased packs by listing course, and counts unfiled items', () => {
    const enrolments = [
      { course: { ...courseRow(COURSE_CHM, 'CHM 101'), institutionId: null, isCanonical: false }, academicYear: '2026/2027', semester: 1 as const, status: 'archived' as const, examDate: null },
      { course: { ...courseRow(COURSE_BIO, 'BIO 201'), institutionId: null, isCanonical: false }, academicYear: '2026/2027', semester: 1 as const, status: 'active' as const, examDate: null },
      { course: { ...courseRow(COURSE_PHY, 'PHY 101'), institutionId: null, isCanonical: false }, academicYear: '2025/2026', semester: 2 as const, status: 'archived' as const, examDate: null },
    ].map((e) => ({ ...e, course: { id: e.course.id, institutionId: null, code: e.course.code, title: e.course.title, faculty: null, level: 200, semester: 1 as const, isCanonical: false } }));

    const overview = aggregateLibraryOverview({
      enrolments,
      notes: [{ course_id: COURSE_BIO }, { course_id: COURSE_BIO }, { course_id: COURSE_BIO }, { course_id: null }, { course_id: 'unknown-course' }],
      decks: [{ course_id: COURSE_BIO }],
      tests: [{ course_id: COURSE_BIO }, { course_id: COURSE_BIO }, { course_id: null }],
      bundles: [
        { course_id: COURSE_BIO, bundle_id: 'local-1' },
        { course_id: null, bundle_id: `qbank-${LISTING_1}` }, // listing → BIO
        { course_id: COURSE_CHM, bundle_id: `qbank-${LISTING_2}` }, // listing has no course → row's course
        { course_id: null, bundle_id: 'local-2' },
      ],
      listingCourses: new Map([
        [LISTING_1, COURSE_BIO],
        [LISTING_2, null],
      ]),
    });

    expect(overview.years.map((y) => y.academicYear)).toEqual(['2026/2027', '2025/2026']);
    const [current, past] = overview.years;
    expect(current.courses.map((c) => c.course.code)).toEqual(['BIO 201', 'CHM 101']); // active first
    expect(current.courses[0].enrolment.status).toBe('active');
    expect(current.courses[0].counts).toEqual({ notes: 3, decks: 1, tests: 2, bundles: 2, purchasedPacks: 1 });
    expect(current.courses[1].enrolment.status).toBe('archived');
    expect(current.courses[1].counts).toEqual({ notes: 0, decks: 0, tests: 0, bundles: 1, purchasedPacks: 1 });
    expect(past.courses[0].counts).toEqual({ notes: 0, decks: 0, tests: 0, bundles: 0, purchasedPacks: 0 });
    expect(overview.unfiled).toEqual({ notes: 1, decks: 0, tests: 1, bundles: 1 });
  });

  it('returns an empty tree for a user with no enrolments and no artefacts', () => {
    expect(aggregateLibraryOverview({ enrolments: [], notes: [], decks: [], tests: [], bundles: [] })).toEqual({
      years: [],
      unfiled: { notes: 0, decks: 0, tests: 0, bundles: 0 },
    });
  });
});

describe('LibrarySearchService.getOverview — one projection per table, aggregated in TS', () => {
  it('issues grouped course_id selects (not one count per course) and resolves pack listings in one lookup', async () => {
    const db = fakeDb({
      user_courses: {
        data: [
          enrolmentRow(COURSE_BIO, 'BIO 201', '2026/2027', 'active'),
          enrolmentRow(COURSE_CHM, 'CHM 101', '2026/2027', 'active'),
          enrolmentRow(COURSE_PHY, 'PHY 101', '2025/2026', 'archived'),
        ],
      },
      notes: { data: [{ course_id: COURSE_BIO }, { course_id: COURSE_CHM }, { course_id: null }] },
      decks: { data: [{ course_id: COURSE_BIO }] },
      test_sessions: { data: [{ course_id: COURSE_PHY }] },
      offline_bundles: {
        data: [
          { course_id: null, bundle_id: `qbank-${LISTING_1}` },
          { course_id: null, bundle_id: 'local-1' },
        ],
      },
      marketplace_listings: { data: [{ id: LISTING_1, course_id: COURSE_CHM }] },
    });

    const overview = await service(db).getOverview(USER);

    const tables = tablesTouched(db);
    expect(tables.filter((t) => t === 'notes')).toHaveLength(1);
    expect(tables.filter((t) => t === 'decks')).toHaveLength(1);
    expect(tables.filter((t) => t === 'test_sessions')).toHaveLength(1);
    expect(tables.filter((t) => t === 'offline_bundles')).toHaveLength(1);
    expect(tables.filter((t) => t === 'marketplace_listings')).toHaveLength(1);
    expect(tables.filter((t) => t === 'user_courses')).toHaveLength(1);

    const notes = callFor(db, 'notes');
    expect(op(notes, 'select')?.args).toEqual(['course_id']);
    expect(op(notes, 'eq')?.args).toEqual(['user_id', USER]);
    expect(op(notes, 'range')?.args).toEqual([0, 999]);
    expect(op(callFor(db, 'test_sessions'), 'neq')?.args).toEqual(['status', 'abandoned']);
    expect(op(callFor(db, 'offline_bundles'), 'select')?.args).toEqual(['course_id, bundle_id']);
    expect(op(callFor(db, 'marketplace_listings'), 'in')?.args).toEqual(['id', [LISTING_1]]);
    const enrolmentCall = callFor(db, 'user_courses');
    expect(ops(enrolmentCall, 'eq').map((o) => o.args)).toEqual([['user_id', USER]]); // status=all → no status filter

    expect(overview.years.map((y) => y.academicYear)).toEqual(['2026/2027', '2025/2026']);
    const byCode = Object.fromEntries(
      overview.years.flatMap((y) => y.courses.map((c) => [c.course.code, c.counts]))
    );
    expect(byCode['BIO 201']).toEqual({ notes: 1, decks: 1, tests: 0, bundles: 0, purchasedPacks: 0 });
    expect(byCode['CHM 101']).toEqual({ notes: 1, decks: 0, tests: 0, bundles: 1, purchasedPacks: 1 });
    expect(byCode['PHY 101']).toEqual({ notes: 0, decks: 0, tests: 1, bundles: 0, purchasedPacks: 0 });
    expect(overview.years[1].courses[0].enrolment.status).toBe('archived');
    expect(overview.unfiled).toEqual({ notes: 1, decks: 0, tests: 0, bundles: 1 });
  });

  it('pages past the 1000-row PostgREST cap and skips the listing lookup when there are no packs', async () => {
    const firstPage = Array.from({ length: 1000 }, () => ({ course_id: COURSE_BIO }));
    const db = fakeDb({
      user_courses: { data: [enrolmentRow(COURSE_BIO, 'BIO 201', '2026/2027', 'active')] },
      notes: (_call, index) => (index === 0 ? { data: firstPage } : { data: [{ course_id: COURSE_BIO }, { course_id: null }] }),
    });

    const overview = await service(db).getOverview(USER);
    const noteCalls = db.calls.filter((c) => c.table === 'notes');
    expect(noteCalls).toHaveLength(2);
    expect(op(noteCalls[1], 'range')?.args).toEqual([1000, 1999]);
    expect(overview.years[0].courses[0].counts.notes).toBe(1001);
    expect(overview.unfiled.notes).toBe(1);
    expect(tablesTouched(db)).not.toContain('marketplace_listings');
  });

  it('degrades to zero counts when a projection table is missing (migration not applied)', async () => {
    const db = fakeDb({
      user_courses: { data: [enrolmentRow(COURSE_BIO, 'BIO 201', '2026/2027', 'active')] },
      test_sessions: { data: null, error: { code: '42703', message: 'column test_sessions.course_id does not exist' } },
      notes: { data: [{ course_id: COURSE_BIO }] },
    });
    const overview = await service(db).getOverview(USER);
    expect(overview.years[0].courses[0].counts).toEqual({ notes: 1, decks: 0, tests: 0, bundles: 0, purchasedPacks: 0 });
  });
});
