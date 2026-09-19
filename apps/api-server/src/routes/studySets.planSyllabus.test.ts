/**
 * `GET /study-sets/:setId/plan` and the syllabus that rides on it.
 *
 * THE ONE THING THIS PINS. The `syllabus` key is ABSENT unless the set has a
 * stored schedule with at least one week in it. Absent, not empty: a client
 * that can tell "no syllabus" from "a syllabus that matched nothing" is a
 * client that can stop drawing the "Coming up in your syllabus" heading over
 * nothing, and both clients branch on exactly this.
 *
 * That makes the no-summary case the important assertion here rather than the
 * boring one — it is what guarantees that a set without a syllabus (which is
 * most of them, and all of them before 20260918150000 is hand-applied) gets
 * the payload this route answered before the field existed, byte for byte.
 *
 * The matching rules themselves are NOT tested here. They are pure and they
 * live in `@lantern/shared`'s `planSyllabus`, with their own suite; what this
 * file asserts is that the route runs them over the right rows and puts the
 * answer in the right place.
 */
jest.mock('../middleware/auth', () => ({
  ...jest.requireActual('../middleware/auth'),
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import router, { initializeStudySetRoutes } from './studySets';
import {
  __resetStudySetsServiceForTests,
  getStudySetsService,
} from '../services/studySets';
import { setSchemaCapabilities } from '../services/schemaCapabilities';
import { createQueryRecorder, runRouteHandler, type QueryResult } from '../testSupport/queryRecorder';

const USER = '11111111-1111-4111-8111-111111111111';
const SET = '22222222-2222-4222-8222-222222222222';
const UNIT_ENZ = '44444444-4444-4444-8444-444444444444';
const UNIT_GLY = '55555555-5555-4555-8555-555555555555';

const UNIT_ROWS = [
  { id: UNIT_ENZ, study_set_id: SET, title: 'Lecture 1 — Enzymes', position: 10 },
  { id: UNIT_GLY, study_set_id: SET, title: 'Glycolysis', position: 20 },
];

const TOPIC_ROWS = [
  {
    id: '66666666-6666-4666-8666-666666666666',
    study_set_id: SET,
    unit_id: UNIT_ENZ,
    title: 'Active sites',
    position: 10,
    status: 'unseen',
    source_note_ids: [],
  },
];

/** Week 2 matches a unit; week 3 matches nothing; week 4 is the midterm. */
const SUMMARY = {
  weeks: [
    { week: 2, title: 'Glycolysis', date: '2026-09-14', examLabel: null },
    { week: 3, title: 'Photosynthesis', date: '2026-09-21', examLabel: null },
    { week: 4, title: 'Midterm', date: '2026-10-10', examLabel: 'Exam 1' },
  ],
  examDates: ['2026-10-10'],
  extractedAt: '2026-09-18T00:00:00.000Z',
};

let getSet: jest.SpyInstance;

/**
 * Bind the singleton to a scripted database and stub the ownership read.
 *
 * `getStudySetsService` binds the FIRST DataLayer it is handed and ignores
 * every one after, so it has to be reset per test or the second case queries
 * the first case's recorder.
 */
function init(resolve: (table: string) => QueryResult) {
  __resetStudySetsServiceForTests();
  const rec = createQueryRecorder(resolve);
  const layer = { getClient: () => rec.client } as never;
  initializeStudySetRoutes(layer);
  getSet = jest
    .spyOn(getStudySetsService(layer), 'get')
    .mockResolvedValue({ id: SET, userId: USER, title: 'Bio 201' } as never);
  return rec;
}

const plan = () =>
  runRouteHandler(router, 'get', '/:setId/plan', {
    user: { id: USER },
    params: { setId: SET },
    body: {},
  });

/** The plan rows every case shares; only the `study_sets` answer varies. */
function withSyllabus(syllabusSummary: unknown): (table: string) => QueryResult {
  return (table) => {
    if (table === 'study_set_units') return { data: UNIT_ROWS, error: null };
    if (table === 'study_set_topics') return { data: TOPIC_ROWS, error: null };
    return {
      data: { id: SET, syllabus_note_id: null, syllabus_summary: syllabusSummary },
      error: null,
    };
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // A scripted database does not serve the capability probe, so force it.
  setSchemaCapabilities({ studySetSyllabus: true });
});

afterEach(() => {
  getSet?.mockRestore();
  setSchemaCapabilities({ studySetSyllabus: null });
});

describe('GET /:setId/plan', () => {
  it('carries syllabusOrder, comingUp and examDividers when the set has a schedule', async () => {
    init(withSyllabus(SUMMARY));

    const res = await plan();

    expect(res.statusCode).toBe(200);
    const syllabus = res.body.data.syllabus;
    // The matched unit leads; the unit no week named keeps its own place behind.
    expect(syllabus.syllabusOrder).toEqual([UNIT_GLY, UNIT_ENZ]);
    expect(syllabus.matches).toHaveLength(1);
    expect(syllabus.matches[0].unitId).toBe(UNIT_GLY);
    expect(syllabus.matches[0].weekTitle).toBe('Glycolysis');
    // Week 3 has no material behind it, so it is a LINE, not a unit.
    expect(syllabus.comingUp.map((row: { week: number }) => row.week)).toEqual([3, 4]);
    expect(syllabus.examDividers).toEqual([
      {
        id: 'exam-1',
        name: 'Exam 1',
        date: '2026-10-10',
        label: 'Exam 1 · 10 Oct',
        afterUnitId: UNIT_GLY,
      },
    ]);
    // The summary rides along so a client drawing its OWN units can recompute.
    expect(syllabus.summary.weeks).toHaveLength(3);
    // And the plan itself is untouched by any of it.
    expect(res.body.data.units).toHaveLength(2);
    expect(res.body.data.topics).toHaveLength(1);
  });

  it('omits the key entirely when the set has no syllabus summary', async () => {
    init(withSyllabus(null));

    const res = await plan();

    expect(res.statusCode).toBe(200);
    expect('syllabus' in res.body.data).toBe(false);
    expect(Object.keys(res.body.data).sort()).toEqual(['preAssessments', 'topics', 'units']);
  });

  it('omits the key when the stored summary survives normalisation with no weeks', async () => {
    // `readSyllabusSummary` re-normalises rather than trusting the column, so a
    // row written by hand or before a cap changed can reduce to nothing.
    init(withSyllabus({ weeks: [{ title: 'no week number' }], examDates: [] }));

    const res = await plan();

    expect(res.statusCode).toBe(200);
    expect('syllabus' in res.body.data).toBe(false);
  });

  it('omits the key before the migration, with the plan itself unaffected', async () => {
    setSchemaCapabilities({ studySetSyllabus: false });
    init((table) => {
      if (table === 'study_set_units') return { data: UNIT_ROWS, error: null };
      if (table === 'study_set_topics') return { data: TOPIC_ROWS, error: null };
      throw new Error('the syllabus columns must not be queried when unsupported');
    });

    const res = await plan();

    expect(res.statusCode).toBe(200);
    expect('syllabus' in res.body.data).toBe(false);
    expect(res.body.data.units).toHaveLength(2);
  });

  it('still answers the plan when the syllabus read fails outright', async () => {
    // The schedule is a garnish on this response. A set room must not go blank
    // because one column read threw.
    init((table) => {
      if (table === 'study_set_units') return { data: UNIT_ROWS, error: null };
      if (table === 'study_set_topics') return { data: TOPIC_ROWS, error: null };
      return { data: null, error: { code: '08006', message: 'connection failure' } };
    });

    const res = await plan();

    expect(res.statusCode).toBe(200);
    expect('syllabus' in res.body.data).toBe(false);
    expect(res.body.data.units).toHaveLength(2);
  });

  it('lists every week as coming up when the set has a syllabus but no plan yet', async () => {
    init((table) => {
      if (table === 'study_set_units') return { data: [], error: null };
      if (table === 'study_set_topics') return { data: [], error: null };
      return {
        data: { id: SET, syllabus_note_id: null, syllabus_summary: SUMMARY },
        error: null,
      };
    });

    const res = await plan();

    expect(res.statusCode).toBe(200);
    expect(res.body.data.syllabus.matches).toEqual([]);
    expect(res.body.data.syllabus.comingUp).toHaveLength(3);
    expect(res.body.data.syllabus.syllabusOrder).toEqual([]);
  });
});
