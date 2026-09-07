/**
 * Class-scoped authz (docs/phase-teach-portal-contract.md).
 *
 * Students never receive joinCode or another student's email. Joining upserts
 * a user_courses row. A class keeps at least one lecturer. LMS connectors are
 * documented as unavailable in v1.
 */
import { ClassSectionsService, classFail } from './classSections';
import { PublicError } from '../utils/safeError';

jest.mock('./aiService', () => ({
  generateQuestionsFromNotes: jest.fn(),
  generateFlashcardsFromNotes: jest.fn(),
}));

jest.mock('./learningEvents', () => ({
  recordLearningEvent: jest.fn(async () => 1),
}));

const ensureEnrolment = jest.fn(async () => null);
const getCourseById = jest.fn();

jest.mock('./academicCourses', () => {
  const actual = jest.requireActual('./academicCourses');
  return {
    ...actual,
    getAcademicCoursesService: () => ({
      getCourseById,
      ensureEnrolment,
    }),
  };
});

type Result = { data: unknown; error?: unknown; count?: number };
type Call = {
  table: string;
  op: 'select' | 'insert' | 'upsert' | 'update' | 'delete';
  payload?: unknown;
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
    api.select = () => api;
    api.insert = (payload: unknown) => {
      call.op = 'insert';
      call.payload = payload;
      return api;
    };
    api.upsert = (payload: unknown) => {
      call.op = 'upsert';
      call.payload = payload;
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

const CLASS_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STUDENT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const COURSE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const courseEmbed = {
  id: COURSE_ID,
  institution_id: '11111111-1111-4111-8111-111111111111',
  code: 'BIO 201',
  title: 'Cell Biology',
  faculty: 'Science',
  level: 200,
  semester: 1,
  is_canonical: false,
};

const sectionRow = {
  id: CLASS_ID,
  course_id: COURSE_ID,
  institution_id: courseEmbed.institution_id,
  title: 'BIO 201 — Dr Adeyemi',
  academic_year: '2026/2027',
  semester: 1,
  join_code: 'ABC234',
  created_by: USER,
  archived_at: null,
  created_at: '2026-09-07T00:00:00.000Z',
  courses: courseEmbed,
};

const service = (db: ReturnType<typeof makeDb>) =>
  new ClassSectionsService({
    getClient: () => db,
    createNotification: jest.fn(async () => null),
  } as any);

describe('classFail', () => {
  it('is a PublicError with a statusCode', () => {
    try {
      classFail('nope', 403);
    } catch (err) {
      expect(err).toBeInstanceOf(PublicError);
      expect((err as PublicError).message).toBe('nope');
      expect((err as { statusCode: number }).statusCode).toBe(403);
    }
  });
});

describe('joinCode privacy', () => {
  it('omits joinCode for students and never includes email on the roster', async () => {
    const db = makeDb({
      class_members: (call) => {
        if (call.op === 'select' && call.filters.some((f) => f[0] === 'eq' && f[1] === 'user_id')) {
          return { data: { class_id: CLASS_ID, user_id: STUDENT, role: 'student', status: 'active' } };
        }
        return {
          data: [
            {
              class_id: CLASS_ID,
              user_id: STUDENT,
              role: 'student',
              status: 'active',
              joined_at: '2026-09-07T00:00:00.000Z',
              profiles: { id: STUDENT, name: 'Ada', username: 'ada', avatar_url: null },
            },
          ],
        };
      },
      class_sections: { data: sectionRow },
    });
    const svc = service(db);
    const detail = await svc.getById(STUDENT, CLASS_ID);
    expect(detail.joinCode).toBeUndefined();
    expect(JSON.stringify(detail)).not.toMatch(/ABC234/);

    const roster = await svc.roster(STUDENT, CLASS_ID);
    expect(roster[0]).toMatchObject({ userId: STUDENT, name: 'Ada', username: 'ada', role: 'student' });
    expect(roster[0]).not.toHaveProperty('email');
    expect(JSON.stringify(roster)).not.toMatch(/email/i);
  });

  it('includes joinCode for the lecturer', async () => {
    const db = makeDb({
      class_members: [
        { data: { class_id: CLASS_ID, user_id: USER, role: 'instructor', status: 'active' } },
        { count: 1, data: null },
      ],
      class_sections: { data: sectionRow },
    });
    const detail = await service(db).getById(USER, CLASS_ID);
    expect(detail.joinCode).toBe('ABC234');
  });
});

describe('join upserts enrolment', () => {
  beforeEach(() => {
    ensureEnrolment.mockClear();
  });

  it('calls ensureEnrolment with the class course and year', async () => {
    const db = makeDb({
      class_sections: { data: sectionRow },
      class_members: [
        { data: null },
        { count: 2, data: null },
        { data: null, error: null },
      ],
    });
    await service(db).join(STUDENT, 'ABC234');
    expect(ensureEnrolment).toHaveBeenCalledWith(STUDENT, COURSE_ID, '2026/2027', 1);
  });
});

describe('last instructor', () => {
  it('refuses to remove the only lecturer', async () => {
    const db = makeDb({
      class_members: [
        { data: { class_id: CLASS_ID, user_id: USER, role: 'instructor', status: 'active' } },
        { data: { class_id: CLASS_ID, user_id: USER, role: 'instructor', status: 'active' } },
        { data: [{ user_id: USER }] },
      ],
    });
    await expect(
      service(db).patchMember(USER, CLASS_ID, USER, { status: 'removed' })
    ).rejects.toMatchObject({ message: 'A class needs at least one lecturer' });
  });
});

describe('generateFromCorpus', () => {
  it('refuses quiz generation without published materials', async () => {
    const db = makeDb({
      class_members: { data: { class_id: CLASS_ID, user_id: USER, role: 'instructor', status: 'active' } },
      class_materials: { data: [] },
    });
    await expect(service(db).generateFromCorpus(USER, CLASS_ID, { kind: 'quiz' })).rejects.toMatchObject({
      message: expect.stringMatching(/Publish at least one lecture/),
    });
  });
});

describe('LMS connectors', () => {
  it('are unavailable in v1', () => {
    const status = service(makeDb({})).lmsConnectors();
    expect(status.available).toBe(false);
    expect(status.connectors).toEqual([]);
    expect(status.message).toMatch(/Canvas/);
  });
});

describe('classes router registration', () => {
  it('registers join/preview before /:classId so they are not captured as ids', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(join(__dirname, '../routes/classes.ts'), 'utf8') as string;
    const preview = src.indexOf("'/preview'");
    const work = src.indexOf("'/work'");
    const official = src.indexOf("'/official-materials'");
    const wildcard = src.indexOf("'/:classId'");
    expect(preview).toBeGreaterThan(-1);
    expect(work).toBeGreaterThan(-1);
    expect(official).toBeGreaterThan(-1);
    expect(wildcard).toBeGreaterThan(-1);
    expect(preview).toBeLessThan(wildcard);
    expect(work).toBeLessThan(wildcard);
    expect(official).toBeLessThan(wildcard);
  });

  it('mounts /api/v1/classes in server.ts', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const server = readFileSync(join(__dirname, '../server.ts'), 'utf8') as string;
    expect(server).toMatch(/app\.use\('\/api\/v1\/classes'/);
    expect(server).toMatch(/app\.use\('\/api\/v1', institutionStaffRoutes\)/);
  });
});
