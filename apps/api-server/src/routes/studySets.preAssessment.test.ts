/**
 * The per-unit pre-assessment routes.
 *
 * Three things this pins, all of which fail SILENTLY if they regress:
 *
 * 1. THE CREDIT IS SPENT EXACTLY ONCE PER GENERATION. `aiRateLimitForFeature`
 *    reserves one `generate_questions` credit before the handler runs, so every
 *    path that does no AI work — a resume, a finished check, a 400 — has to
 *    hand it back. A student pressing `Continue` twice on a half-finished
 *    diagnostic must not pay twice, and must not get a second set of questions.
 *
 * 2. THE RESUME LOOKUP IS FILTERED ON `config`, NOT on the `study_set_id`
 *    COLUMN. That column arrives with a hand-applied migration and is dropped
 *    from the insert when absent, so filtering on it would find nothing on such
 *    a database and generate a fresh (charged) diagnostic every single time.
 *
 * 3. THE OWNERSHIP PREDICATES. The API holds the service-role client and
 *    BYPASSES RLS, so `user_id` on the lookup is the access control.
 */
jest.mock('../middleware/auth', () => ({
  ...jest.requireActual('../middleware/auth'),
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../middleware/aiRateLimit', () => ({
  ...jest.requireActual('../middleware/aiRateLimit'),
  aiRateLimitForFeature: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  applyGlobalUsageHeaders: jest.fn(async () => {}),
  refundFeatureAiCredit: jest.fn(async () => {}),
}));

jest.mock('../services/aiService', () => ({
  generateQuestionsFromNotes: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import router, { initializeStudySetRoutes } from './studySets';
import { refundFeatureAiCredit } from '../middleware/aiRateLimit';
import { generateQuestionsFromNotes } from '../services/aiService';
import { getStudySetsService } from '../services/studySets';
import { __resetStudySetPreAssessmentServiceForTests } from '../services/studySetPreAssessment';
import { createQueryRecorder, runRouteHandler, bindDataModule } from '../testSupport/queryRecorder';
import * as testsData from '../services/data/tests';

const USER = '11111111-1111-4111-8111-111111111111';
const SET = '22222222-2222-4222-8222-222222222222';
const UNIT = '33333333-3333-4333-8333-333333333333';
const TOPIC_A = '44444444-4444-4444-8444-444444444444';
const TOPIC_B = '55555555-5555-4555-8555-555555555555';
const TEST = '66666666-6666-4666-8666-666666666666';

const PLAN = {
  units: [{ id: UNIT, studySetId: SET, title: 'Cell biology', position: 10 }],
  topics: [
    {
      id: TOPIC_A,
      studySetId: SET,
      unitId: UNIT,
      title: 'Enzymes',
      position: 10,
      status: 'unseen' as const,
      sourceNoteIds: [],
    },
    {
      id: TOPIC_B,
      studySetId: SET,
      unitId: UNIT,
      title: 'Osmosis',
      position: 20,
      status: 'unseen' as const,
      sourceNoteIds: [],
    },
  ],
};

const GENERATED = {
  provider: 'test',
  questions: [
    { text: 'Enzymes do what?', type: 'multiple_choice', options: ['a', 'b'], correctAnswer: 'a', topic: 'Enzymes' },
    { text: 'Osmosis moves what?', type: 'true_false', options: ['True', 'False'], correctAnswer: 'True', topic: 'Osmosis' },
  ],
};

let createPersonalTest: jest.Mock;
let updateTopicStatus: jest.SpyInstance;
let getPlan: jest.SpyInstance;

function init(existing: unknown = null, session: unknown = null) {
  const rec = createQueryRecorder((table: string) =>
    table === 'test_sessions'
      ? { data: existing ? [existing] : [], error: null }
      : { data: [], error: null }
  );
  createPersonalTest = jest.fn(async () => ({ id: TEST }));
  initializeStudySetRoutes(
    {
      getClient: () => rec.client,
      tests: {
        ...bindDataModule(testsData, rec.client),
        createPersonalTest,
        getOwnedTestSession: jest.fn(async () => ({ data: session, error: null })),
      },
      notes: {
        getNote: jest.fn(async () => ({ body: 'note body' })),
        getNoteAttachments: jest.fn(async () => []),
      },
    } as any
  );
  return rec;
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetStudySetPreAssessmentServiceForTests();
  (generateQuestionsFromNotes as jest.Mock).mockResolvedValue(GENERATED);
  getPlan = jest
    .spyOn(getStudySetsService({} as never), 'getPlan')
    .mockResolvedValue(PLAN as never);
  updateTopicStatus = jest
    .spyOn(getStudySetsService({} as never), 'updateTopicStatus')
    .mockResolvedValue({} as never);
});

afterEach(() => {
  getPlan.mockRestore();
  updateTopicStatus.mockRestore();
});

describe('POST /:setId/units/:unitId/pre-assessment', () => {
  it('generates once, files the test under the set, and does NOT refund', async () => {
    init();

    const res = await runRouteHandler(router, 'post', '/:setId/units/:unitId/pre-assessment', {
      user: { id: USER },
      params: { setId: SET, unitId: UNIT },
      body: {},
    });

    expect(res.statusCode).toBe(201);
    expect(res.body.data).toMatchObject({ testId: TEST, action: 'created', questionCount: 2 });
    expect(generateQuestionsFromNotes).toHaveBeenCalledTimes(1);
    expect(refundFeatureAiCredit).not.toHaveBeenCalled();

    const payload = createPersonalTest.mock.calls[0]?.[0];
    expect(payload.studySetId).toBe(SET);
    // The link the resume query reads lives in config, never only in a column.
    expect(payload.config.preAssessment).toMatchObject({ studySetId: SET, unitId: UNIT });
    // Each question carries the plan topic it was written for, so grading
    // cannot reach a different attribution than the student was tested under.
    expect(payload.questions.map((q: any) => q.topicId)).toEqual([TOPIC_A, TOPIC_B]);
  });

  it('asks for a mixed, machine-gradable ten', async () => {
    init();
    await runRouteHandler(router, 'post', '/:setId/units/:unitId/pre-assessment', {
      user: { id: USER },
      params: { setId: SET, unitId: UNIT },
      body: {},
    });
    expect((generateQuestionsFromNotes as jest.Mock).mock.calls[0]?.[1]).toMatchObject({
      count: 10,
      difficulty: 'mixed',
      questionTypes: ['multiple_choice', 'true_false'],
    });
  });

  it('resumes an unfinished check without generating, and refunds the credit', async () => {
    init({ id: TEST, end_time: null, questions: [{}, {}, {}], config: {} });

    const res = await runRouteHandler(router, 'post', '/:setId/units/:unitId/pre-assessment', {
      user: { id: USER },
      params: { setId: SET, unitId: UNIT },
      body: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toMatchObject({ testId: TEST, action: 'resumed', questionCount: 3 });
    expect(generateQuestionsFromNotes).not.toHaveBeenCalled();
    expect(createPersonalTest).not.toHaveBeenCalled();
    expect(refundFeatureAiCredit).toHaveBeenCalledTimes(1);
    expect(refundFeatureAiCredit).toHaveBeenCalledWith(USER, 'generate_questions');
  });

  it('returns a FINISHED check rather than silently charging for a new one', async () => {
    init({ id: TEST, end_time: '2026-09-17T10:00:00Z', questions: [{}], config: {} });

    const res = await runRouteHandler(router, 'post', '/:setId/units/:unitId/pre-assessment', {
      user: { id: USER },
      params: { setId: SET, unitId: UNIT },
      body: {},
    });

    expect(res.body.data.action).toBe('resumed');
    expect(generateQuestionsFromNotes).not.toHaveBeenCalled();
    expect(refundFeatureAiCredit).toHaveBeenCalledTimes(1);
  });

  it('a retake over a finished check DOES generate', async () => {
    init({ id: TEST, end_time: '2026-09-17T10:00:00Z', questions: [{}], config: {} });

    const res = await runRouteHandler(router, 'post', '/:setId/units/:unitId/pre-assessment', {
      user: { id: USER },
      params: { setId: SET, unitId: UNIT },
      body: { retake: true },
    });

    expect(res.body.data.action).toBe('created');
    expect(generateQuestionsFromNotes).toHaveBeenCalledTimes(1);
    expect(refundFeatureAiCredit).not.toHaveBeenCalled();
  });

  it('refunds when the unit is refused before any AI work', async () => {
    init();
    getPlan.mockResolvedValue({ units: [], topics: [] } as never);

    const res = await runRouteHandler(router, 'post', '/:setId/units/:unitId/pre-assessment', {
      user: { id: USER },
      params: { setId: SET, unitId: UNIT },
      body: {},
    });

    expect(res.statusCode).toBe(400);
    expect(generateQuestionsFromNotes).not.toHaveBeenCalled();
    expect(refundFeatureAiCredit).toHaveBeenCalledTimes(1);
  });

  it('refuses a unit with no topics rather than building an empty check', async () => {
    init();
    getPlan.mockResolvedValue({ units: PLAN.units, topics: [] } as never);

    const res = await runRouteHandler(router, 'post', '/:setId/units/:unitId/pre-assessment', {
      user: { id: USER },
      params: { setId: SET, unitId: UNIT },
      body: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/no topics/i);
  });
});

describe('the resume lookup query shape', () => {
  it('reads test_sessions by owner and by the config link, newest first', async () => {
    const rec = init({ id: TEST, end_time: null, questions: [], config: {} });

    await runRouteHandler(router, 'post', '/:setId/units/:unitId/pre-assessment', {
      user: { id: USER },
      params: { setId: SET, unitId: UNIT },
      body: {},
    });

    expect(rec.trace).toEqual([
      'from("test_sessions")',
      'select("id, questions, user_answers, end_time, status, config, start_time")',
      // Without this the service-role client hands over other students' tests.
      `eq("user_id", "${USER}")`,
      // config, NOT the study_set_id column — see the file banner.
      `eq("config->preAssessment->>studySetId", "${SET}")`,
      `eq("config->preAssessment->>unitId", "${UNIT}")`,
      'order("start_time", {"ascending":false})',
      'limit(1)',
    ]);
  });
});

describe('POST /:setId/units/:unitId/pre-assessment/results', () => {
  const session = {
    id: TEST,
    config: { preAssessment: { unitId: UNIT, studySetId: SET } },
    questions: [
      { id: 'pa-1', topicId: TOPIC_A, correctAnswer: 'a' },
      { id: 'pa-2', topicId: TOPIC_A, correctAnswer: 'b' },
      { id: 'pa-3', topicId: TOPIC_B, correctAnswer: 'True' },
    ],
    user_answers: { 'pa-1': { answer: 'a' }, 'pa-2': { answer: 'a' }, 'pa-3': { answer: 'True' } },
  };

  it('writes each earned status through the plan own update path', async () => {
    init(null, session);

    const res = await runRouteHandler(
      router,
      'post',
      '/:setId/units/:unitId/pre-assessment/results',
      { user: { id: USER }, params: { setId: SET, unitId: UNIT }, body: { testId: TEST } }
    );

    expect(res.statusCode).toBe(200);
    // Enzymes 1/2 = covered; Osmosis 1/1 = mastered.
    expect(res.body.data.updates).toEqual([
      { topicId: TOPIC_A, status: 'covered' },
      { topicId: TOPIC_B, status: 'mastered' },
    ]);
    expect(updateTopicStatus).toHaveBeenCalledTimes(2);
    expect(updateTopicStatus).toHaveBeenCalledWith(USER, SET, TOPIC_A, 'covered');
  });

  it('writes nothing a second time — a topic already there is not re-written', async () => {
    init(null, session);
    getPlan.mockResolvedValue({
      units: PLAN.units,
      topics: [
        { ...PLAN.topics[0], status: 'covered' },
        { ...PLAN.topics[1], status: 'mastered' },
      ],
    } as never);

    const res = await runRouteHandler(
      router,
      'post',
      '/:setId/units/:unitId/pre-assessment/results',
      { user: { id: USER }, params: { setId: SET, unitId: UNIT }, body: { testId: TEST } }
    );

    expect(res.body.data.updates).toEqual([]);
    expect(updateTopicStatus).not.toHaveBeenCalled();
  });

  it('refuses a test that is not this unit check', async () => {
    init(null, { ...session, config: { preAssessment: { unitId: 'another-unit' } } });

    const res = await runRouteHandler(
      router,
      'post',
      '/:setId/units/:unitId/pre-assessment/results',
      { user: { id: USER }, params: { setId: SET, unitId: UNIT }, body: { testId: TEST } }
    );

    expect(res.statusCode).toBe(400);
    expect(updateTopicStatus).not.toHaveBeenCalled();
  });

  it('refuses a session the caller does not own', async () => {
    init(null, null);

    const res = await runRouteHandler(
      router,
      'post',
      '/:setId/units/:unitId/pre-assessment/results',
      { user: { id: USER }, params: { setId: SET, unitId: UNIT }, body: { testId: TEST } }
    );

    expect(res.statusCode).toBe(400);
    expect(updateTopicStatus).not.toHaveBeenCalled();
  });

  it('charges nothing', async () => {
    init(null, session);
    await runRouteHandler(router, 'post', '/:setId/units/:unitId/pre-assessment/results', {
      user: { id: USER },
      params: { setId: SET, unitId: UNIT },
      body: { testId: TEST },
    });
    expect(generateQuestionsFromNotes).not.toHaveBeenCalled();
  });
});
