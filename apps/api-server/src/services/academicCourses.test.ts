/**
 * Academic courses (Phase 1 · A): the two invariants web/mobile build on.
 *
 *  1. POST /courses is find-or-create on the NORMALISED code — "bio201",
 *     "BIO  201" and "BIO 201" are one row per institution, and an existing
 *     row is returned untouched (its title wins).
 *  2. PUT /users/me/courses has SET semantics for one academic year — listed
 *     ids are upserted active, rows for that year not in the list are deleted
 *     (not archived), and nothing outside that year is touched.
 *
 * Same PostgREST-double style as marketplaceQuestionBanks.test.ts: canned
 * per-table results plus a log of every call so the exact writes are asserted.
 */
import { AcademicCoursesService, MAX_USER_COURSES_PER_YEAR } from './academicCourses';
import { PublicError } from '../utils/safeError';
import { currentAcademicYear } from '@lantern/shared/academic';

type Result = { data: unknown; error?: unknown };
type Call = {
  table: string;
  op: 'select' | 'insert' | 'upsert' | 'update' | 'delete';
  select?: string;
  payload?: unknown;
  options?: unknown;
  filters: unknown[][];
};
type Responder = Result | Result[] | ((call: Call, index: number) => Result);

function makeDb(tables: Record<string, Responder>) {
  const calls: Call[] = [];
  const perTable = new Map<string, number>();
  const queues = new Map<string, Result[]>();

  const resolve = (call: Call): Result => {
    const index = perTable.get(call.table) ?? 0;
    perTable.set(call.table, index + 1);
    const configured = tables[call.table];
    if (configured === undefined) return { data: null, error: null };
    if (typeof configured === 'function') return configured(call, index);
    if (!Array.isArray(configured)) return configured;
    if (!queues.has(call.table)) queues.set(call.table, [...configured]);
    const queue = queues.get(call.table)!;
    return queue.length > 1 ? queue.shift()! : queue[0];
  };

  const from = (table: string) => {
    const call: Call = { table, op: 'select', filters: [] };
    calls.push(call);
    const api: any = {};
    for (const m of ['eq', 'is', 'in', 'not', 'ilike', 'or', 'order', 'limit', 'gte', 'lte']) {
      api[m] = (...args: unknown[]) => {
        call.filters.push([m, ...args]);
        return api;
      };
    }
    api.select = (cols?: string) => {
      call.select = cols;
      return api;
    };
    api.insert = (payload: unknown) => {
      call.op = 'insert';
      call.payload = payload;
      return api;
    };
    api.upsert = (payload: unknown, options?: unknown) => {
      call.op = 'upsert';
      call.payload = payload;
      call.options = options;
      return api;
    };
    api.update = (payload: unknown) => {
      call.op = 'update';
      call.payload = payload;
      return api;
    };
    api.delete = () => {
      call.op = 'delete';
      return api;
    };
    api.single = async () => resolve(call);
    api.maybeSingle = async () => resolve(call);
    api.then = (onFulfilled: (v: Result) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(resolve(call)).then(onFulfilled, onRejected);
    return api;
  };

  return { from, calls };
}

const service = (db: ReturnType<typeof makeDb>) =>
  new AcademicCoursesService({ getClient: () => db } as any);

const UNILAG = '11111111-1111-4111-8111-111111111111';
const OTHER_LAGOS = '22222222-2222-4222-8222-222222222222';
const COURSE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COURSE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const COURSE_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const USER = 'user-1';

const courseRow = (id: string, code: string, extra: Record<string, unknown> = {}) => ({
  id,
  institution_id: UNILAG,
  code,
  title: `${code} title`,
  faculty: null,
  level: 200,
  semester: 1,
  is_canonical: false,
  ...extra,
});

const filterOf = (call: Call, name: string) => call.filters.find((f) => f[0] === name);

describe('AcademicCoursesService.findOrCreateCourse — normalised find-or-create', () => {
  it('normalises the code ("bio201" → "BIO 201") and creates when no row matches', async () => {
    const db = makeDb({
      marketplace_campuses: { data: { id: UNILAG, name: 'University of Lagos', slug: 'unilag', kind: 'university' } },
      courses: (call) =>
        call.op === 'insert'
          ? { data: courseRow('new-1', 'BIO 201', { title: 'Genetics', created_by: USER }) }
          : { data: null },
    });

    const result = await service(db).findOrCreateCourse(USER, {
      institutionId: UNILAG,
      code: '  bio201 ',
      title: '  Genetics  ',
      level: 200,
      semester: 1,
    });

    expect(result.created).toBe(true);
    expect(result.course).toMatchObject({ id: 'new-1', code: 'BIO 201', institutionId: UNILAG, isCanonical: false });

    const lookup = db.calls.find((c) => c.table === 'courses' && c.op === 'select');
    expect(filterOf(lookup!, 'ilike')).toEqual(['ilike', 'code', 'BIO 201']);
    expect(filterOf(lookup!, 'eq')).toEqual(['eq', 'institution_id', UNILAG]);

    const insert = db.calls.find((c) => c.table === 'courses' && c.op === 'insert');
    expect(insert?.payload).toEqual({
      institution_id: UNILAG,
      code: 'BIO 201',
      title: 'Genetics',
      faculty: null,
      level: 200,
      semester: 1,
      created_by: USER,
    });
  });

  it.each(['BIO 201', 'bio 201', 'BIO201', ' bio   201 '])(
    'returns the existing row for %j without writing (title ignored)',
    async (typed) => {
      const existing = courseRow(COURSE_A, 'BIO 201', { title: 'Genetics (catalogue)', is_canonical: true });
      const db = makeDb({
        marketplace_campuses: { data: { id: UNILAG, name: 'UNILAG', slug: 'unilag', kind: 'university' } },
        courses: { data: existing },
      });

      const result = await service(db).findOrCreateCourse(USER, {
        institutionId: UNILAG,
        code: typed,
        title: 'A different title the client typed',
      });

      expect(result.created).toBe(false);
      expect(result.course).toMatchObject({ id: COURSE_A, code: 'BIO 201', title: 'Genetics (catalogue)', isCanonical: true });
      expect(db.calls.filter((c) => c.table === 'courses' && c.op !== 'select')).toHaveLength(0);
    }
  );

  it('scopes institution-less courses to institution_id IS NULL', async () => {
    const db = makeDb({
      courses: (call) => (call.op === 'insert' ? { data: courseRow('new-2', 'GNS 101', { institution_id: null }) } : { data: null }),
    });
    const result = await service(db).findOrCreateCourse(USER, { code: 'gns101', title: 'Use of English' });
    expect(result.created).toBe(true);
    expect(result.course.institutionId).toBeNull();
    const lookup = db.calls.find((c) => c.table === 'courses' && c.op === 'select');
    expect(filterOf(lookup!, 'is')).toEqual(['is', 'institution_id', null]);
    expect(db.calls.some((c) => c.table === 'marketplace_campuses')).toBe(false);
  });

  it('requires a title only when the row has to be created', async () => {
    const db = makeDb({ courses: { data: null } });
    await expect(service(db).findOrCreateCourse(USER, { code: 'BIO 201' })).rejects.toBeInstanceOf(PublicError);
    await expect(service(db).findOrCreateCourse(USER, { code: 'BIO 201', title: 'X' })).rejects.toThrow(/title/i);
    expect(db.calls.filter((c) => c.op === 'insert')).toHaveLength(0);
  });

  it('rejects junk codes and "Other" sentinel institutions with PublicError (400)', async () => {
    const db = makeDb({
      marketplace_campuses: { data: { id: OTHER_LAGOS, name: 'Other — Lagos', slug: 'other-lagos', kind: 'other' } },
    });
    await expect(service(db).findOrCreateCourse(USER, { code: '!!', title: 'Nope' })).rejects.toBeInstanceOf(PublicError);
    await expect(
      service(db).findOrCreateCourse(USER, { institutionId: OTHER_LAGOS, code: 'BIO 201', title: 'Genetics' })
    ).rejects.toThrow(/not a school/);
    expect(db.calls.filter((c) => c.table === 'courses')).toHaveLength(0);
  });

  it('survives losing the insert race: unique violation → returns the row the other student created', async () => {
    const raced = courseRow(COURSE_B, 'BIO 201');
    let selects = 0;
    const db = makeDb({
      marketplace_campuses: { data: { id: UNILAG, name: 'UNILAG', slug: 'unilag', kind: 'university' } },
      courses: (call) => {
        if (call.op === 'insert') return { data: null, error: { code: '23505', message: 'duplicate key' } };
        selects += 1;
        return selects === 1 ? { data: null } : { data: raced };
      },
    });
    const result = await service(db).findOrCreateCourse(USER, { institutionId: UNILAG, code: 'bio201', title: 'Genetics' });
    expect(result).toEqual({ created: false, course: expect.objectContaining({ id: COURSE_B }) });
  });
});

describe('AcademicCoursesService.setUserCourses — set semantics per academic year', () => {
  const enrolmentRow = (courseId: string, year: string, status = 'active') => ({
    user_id: USER,
    course_id: courseId,
    academic_year: year,
    semester: null,
    status,
    exam_date: null,
    courses: courseRow(courseId, `CODE ${courseId.slice(0, 1).toUpperCase()}`),
  });

  it('upserts listed ids as active for the year and deletes that year\'s rows not in the list', async () => {
    const year = '2026/2027';
    const db = makeDb({
      courses: { data: [{ id: COURSE_A }, { id: COURSE_B }] },
      user_courses: (call) =>
        call.op === 'select'
          ? { data: [enrolmentRow(COURSE_B, year), enrolmentRow(COURSE_A, year)] }
          : { data: null },
    });

    const result = await service(db).setUserCourses(USER, {
      courseIds: [COURSE_A, COURSE_B, COURSE_A],
      academicYear: year,
    });

    const upsert = db.calls.find((c) => c.table === 'user_courses' && c.op === 'upsert');
    expect(upsert?.payload).toEqual([
      { user_id: USER, course_id: COURSE_A, academic_year: year, status: 'active' },
      { user_id: USER, course_id: COURSE_B, academic_year: year, status: 'active' },
    ]);
    expect(upsert?.options).toEqual({ onConflict: 'user_id,course_id,academic_year' });

    const del = db.calls.find((c) => c.table === 'user_courses' && c.op === 'delete');
    expect(del?.filters).toEqual([
      ['eq', 'user_id', USER],
      ['eq', 'academic_year', year],
      ['not', 'course_id', 'in', `(${COURSE_A},${COURSE_B})`],
    ]);
    // No archiving, no status updates: rows not listed are gone, not hidden.
    expect(db.calls.filter((c) => c.table === 'user_courses' && c.op === 'update')).toHaveLength(0);

    // Returns the year's enrolments, sorted by code, with the contract shape.
    expect(result.map((r) => r.course.id)).toEqual([COURSE_A, COURSE_B]);
    expect(result[0]).toEqual({
      course: expect.objectContaining({ id: COURSE_A, code: 'CODE A' }),
      academicYear: year,
      semester: null,
      status: 'active',
      examDate: null,
    });
    const list = db.calls.filter((c) => c.table === 'user_courses' && c.op === 'select').pop();
    expect(list?.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'user_id', USER],
        ['eq', 'academic_year', year],
      ])
    );
  });

  it('an empty list clears the year (no upsert, delete everything for that year only)', async () => {
    const db = makeDb({ user_courses: { data: [] } });
    const result = await service(db).setUserCourses(USER, { courseIds: [], academicYear: '2025/2026' });
    expect(result).toEqual([]);
    expect(db.calls.filter((c) => c.op === 'upsert')).toHaveLength(0);
    const del = db.calls.find((c) => c.table === 'user_courses' && c.op === 'delete');
    expect(del?.filters).toEqual([
      ['eq', 'user_id', USER],
      ['eq', 'academic_year', '2025/2026'],
    ]);
    expect(db.calls.some((c) => c.table === 'courses')).toBe(false);
  });

  it('defaults academicYear to the current Nigerian session', async () => {
    const db = makeDb({ courses: { data: [{ id: COURSE_C }] }, user_courses: { data: [] } });
    await service(db).setUserCourses(USER, { courseIds: [COURSE_C] });
    const upsert = db.calls.find((c) => c.op === 'upsert');
    expect((upsert?.payload as Array<{ academic_year: string }>)[0].academic_year).toBe(currentAcademicYear());
  });

  it('refuses malformed ids, unknown courses, too many courses and bad years before writing', async () => {
    const db = makeDb({ courses: { data: [{ id: COURSE_A }] }, user_courses: { data: [] } });
    const svc = service(db);
    await expect(svc.setUserCourses(USER, { courseIds: ['nope'] })).rejects.toBeInstanceOf(PublicError);
    await expect(svc.setUserCourses(USER, { courseIds: [COURSE_A, COURSE_B] })).rejects.toThrow(/no longer exist/);
    await expect(
      svc.setUserCourses(USER, {
        courseIds: Array.from({ length: MAX_USER_COURSES_PER_YEAR + 1 }, (_, i) =>
          `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
        ),
      })
    ).rejects.toThrow(/at most 40/);
    await expect(svc.setUserCourses(USER, { courseIds: [COURSE_A], academicYear: '2026-2027' })).rejects.toThrow(
      /2026\/2027/
    );
    expect(db.calls.filter((c) => c.table === 'user_courses' && c.op !== 'select')).toHaveLength(0);
  });
});

describe('AcademicCoursesService.archiveSemester', () => {
  it('flips only that year\'s active rows to archived and reports the count', async () => {
    const db = makeDb({ user_courses: { data: [{ course_id: COURSE_A }, { course_id: COURSE_B }] } });
    await expect(service(db).archiveSemester(USER, '2025/2026')).resolves.toEqual({ archived: 2 });
    const update = db.calls.find((c) => c.table === 'user_courses' && c.op === 'update');
    expect(update?.payload).toEqual({ status: 'archived' });
    expect(update?.filters).toEqual([
      ['eq', 'user_id', USER],
      ['eq', 'academic_year', '2025/2026'],
      ['eq', 'status', 'active'],
    ]);
  });
});

describe('AcademicCoursesService.findOrCreateSchool', () => {
  it('creates a primary school when none matches', async () => {
    const db = makeDb({
      marketplace_campuses: (call) => {
        if (call.op === 'insert') {
          expect(call.payload).toMatchObject({
            name: 'St Marys Primary',
            kind: 'primary',
            city: '—',
            country_code: 'NG',
          });
          return {
            data: {
              id: '33333333-3333-4333-8333-333333333333',
              name: 'St Marys Primary',
              slug: 'st-marys-primary',
              kind: 'primary',
              active: true,
            },
          };
        }
        return { data: [] };
      },
    });
    const result = await service(db).findOrCreateSchool(USER, { name: 'St Marys Primary', kind: 'primary' });
    expect(result.created).toBe(true);
    expect(result.school).toMatchObject({ name: 'St Marys Primary', kind: 'primary' });
  });

  it('returns an existing school of the same kind and name', async () => {
    const existing = {
      id: UNILAG,
      name: 'Kings College',
      slug: 'kings-college',
      kind: 'secondary',
      active: true,
    };
    const db = makeDb({
      marketplace_campuses: { data: [existing] },
    });
    const result = await service(db).findOrCreateSchool(USER, { name: 'Kings College', kind: 'secondary' });
    expect(result.created).toBe(false);
    expect(result.school.id).toBe(UNILAG);
    expect(db.calls.some((c) => c.op === 'insert')).toBe(false);
  });
});
