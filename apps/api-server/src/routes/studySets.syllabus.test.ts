/**
 * The syllabus routes: what the database sees, what the student is charged,
 * and what each refusal answers with.
 *
 * FOUR THINGS THIS PINS, all of which fail silently if they regress.
 *
 * 1. THE CREDIT IS SPENT ONLY WHEN THE MODEL ANSWERED. `aiRateLimitForFeature`
 *    reserves one `generate_questions` credit BEFORE the handler runs, so every
 *    path that did no AI work has to hand it back: a missing body, a `.txt`,
 *    an oversized file, a scan with no text layer, and every provider being
 *    exhausted. The one path that must NOT refund is the interesting one — the
 *    model answered and found no schedule. That is a real answer to a real
 *    question, and refunding it would make a one-page outline a free retry
 *    loop against the provider.
 *
 * 2. THE MIGRATION GATE SITS ABOVE THE METER. 20260918150000 is hand-applied
 *    and the API ships first, so this route runs against a database without the
 *    columns. This is the ONLY route in the app that spends a credit before it
 *    stores anything, so the refusal has to happen in middleware ordered before
 *    `aiRateLimitForFeature` — not in a catch block, where a student would be
 *    one dropped refund away from paying for a 503. The gate is tested as
 *    middleware, by position in the route stack, because that position IS the
 *    guarantee.
 *
 * 3. MALFORMED MODEL OUTPUT IS STORED AS NOTHING, NOT AS RUBBISH.
 *    `extractJSON` is tolerant by design, so the route is handed `any`. A
 *    summary that survives none of `normalizeSyllabusSummary`'s rules is
 *    written as NULL and answered as "No schedule found in that file." — never
 *    as an empty-but-present summary, which would light the "syllabus added"
 *    state in both clients over a row that tells the student nothing.
 *
 * 4. A DATE THE STUDENT TYPED IS NEVER OVERWRITTEN BY A DOCUMENT. The syllabus
 *    fills `exam_date` only when the set has none.
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
  extractSyllabusSchedule: jest.fn(),
}));

jest.mock('../services/noteFiles', () => ({
  assertValidOfficeZip: jest.fn(),
  buildDocumentStudyText: jest.fn((_name: string, text: string) => ({
    studyText: text,
    extractionStatus: text.trim() ? 'ok' : 'empty',
  })),
  extractDocumentTextFromBuffer: jest.fn(async () => ({ text: '', truncated: false })),
  extractPdfTextDetailsFromBuffer: jest.fn(async () => ({ text: '', pageCount: 1 })),
}));

jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import router, { initializeStudySetRoutes } from './studySets';
import { refundFeatureAiCredit } from '../middleware/aiRateLimit';
import { extractSyllabusSchedule } from '../services/aiService';
import {
  extractDocumentTextFromBuffer,
  extractPdfTextDetailsFromBuffer,
} from '../services/noteFiles';
import {
  __resetStudySetsServiceForTests,
  getStudySetsService,
} from '../services/studySets';
import { __resetStudySetSyllabusServiceForTests } from '../services/studySetSyllabus';
import { setSchemaCapabilities } from '../services/schemaCapabilities';
import { STUDY_SET_SYLLABUS_MIGRATION } from '@lantern/shared/study/syllabusSummary';
import { createQueryRecorder, runRouteHandler, type QueryResult } from '../testSupport/queryRecorder';

const USER = '11111111-1111-4111-8111-111111111111';
const SET = '22222222-2222-4222-8222-222222222222';
const NOTE = '33333333-3333-4333-8333-333333333333';

/** Enough text to clear the "this is a scan" floor. */
const SYLLABUS_TEXT = `BIO 201 Course Schedule. ${'Week by week outline follows. '.repeat(4)}`;

const GOOD_SCHEDULE = {
  weeks: [
    { week: 1, title: 'Cell structure', date: '2026-09-21', examLabel: null },
    { week: 7, title: 'Midterm', date: '2026-10-30', examLabel: 'Midterm' },
  ],
  examDates: ['2026-10-30'],
};

let createNote: jest.Mock;
let deleteNote: jest.Mock;
let getSet: jest.SpyInstance;

/** What PostgREST answers for a column a migration has not added yet. */
const noColumn: QueryResult = {
  data: null,
  error: { code: '42703', message: 'column study_sets.syllabus_note_id does not exist' },
};

/**
 * Build the layer, bind BOTH singletons to it, and stub the ownership read.
 *
 * `getStudySetsService` binds the first DataLayer it is handed and ignores
 * every one after, so it has to be reset and re-bound per test or the second
 * case here queries the first case's recorder. `get` is stubbed because it is
 * the ownership gate, not the subject: every trace below is then exactly the
 * syllabus query the database would see.
 */
function init(resolve?: (table: string) => QueryResult, examDate: string | null = null) {
  __resetStudySetsServiceForTests();
  __resetStudySetSyllabusServiceForTests();
  const rec = createQueryRecorder(resolve ?? (() => ({ data: {}, error: null })));
  createNote = jest.fn(async () => ({ id: NOTE }));
  deleteNote = jest.fn(async () => true);
  const layer = {
    getClient: () => rec.client,
    notes: { createNote, deleteNote },
  } as never;
  initializeStudySetRoutes(layer);
  getSet = jest
    .spyOn(getStudySetsService(layer), 'get')
    .mockResolvedValue({ id: SET, userId: USER, title: 'Bio 201', examDate } as never);
  return rec;
}

const post = (body: Record<string, unknown>) =>
  runRouteHandler(router, 'post', '/:setId/syllabus', {
    user: { id: USER },
    params: { setId: SET },
    body,
  });

const pdfBody = (overrides: Record<string, unknown> = {}) => ({
  fileName: 'syllabus.pdf',
  base64Data: Buffer.from('a pdf').toString('base64'),
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  __resetStudySetSyllabusServiceForTests();
  // A scripted database does not serve the probe query, so force it.
  setSchemaCapabilities({ studySetSyllabus: true });
  (extractSyllabusSchedule as jest.Mock).mockResolvedValue({
    raw: GOOD_SCHEDULE,
    provider: 'test',
  });
  (extractPdfTextDetailsFromBuffer as jest.Mock).mockResolvedValue({
    text: SYLLABUS_TEXT,
    pageCount: 3,
  });
  (extractDocumentTextFromBuffer as jest.Mock).mockResolvedValue({
    text: SYLLABUS_TEXT,
    truncated: false,
  });
});

afterEach(() => {
  getSet?.mockRestore();
  setSchemaCapabilities({ studySetSyllabus: null });
});

describe('GET /:setId/syllabus', () => {
  it('scopes the read to this owner AND this set, and returns the stored schedule', async () => {
    const rec = init(() => ({
      data: { id: SET, syllabus_note_id: NOTE, syllabus_summary: { ...GOOD_SCHEDULE, extractedAt: 'x' } },
      error: null,
    }));

    const res = await runRouteHandler(router, 'get', '/:setId/syllabus', {
      user: { id: USER },
      params: { setId: SET },
      body: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.supported).toBe(true);
    expect(res.body.data.noteId).toBe(NOTE);
    expect(res.body.data.summary.weeks).toHaveLength(2);
    // The service-role client bypasses RLS, so these two predicates ARE the
    // access control — a handler that dropped one would still answer 200.
    expect(rec.trace).toEqual([
      'from("study_sets")',
      'select("id, syllabus_note_id, syllabus_summary")',
      `eq("user_id", "${USER}")`,
      `eq("id", "${SET}")`,
      'single()',
    ]);
  });

  it('degrades to supported:false with a 200 before the migration, never an error', async () => {
    setSchemaCapabilities({ studySetSyllabus: false });
    init();

    const res = await runRouteHandler(router, 'get', '/:setId/syllabus', {
      user: { id: USER },
      params: { setId: SET },
      body: {},
    });

    // A set room must render without the card, not blow up.
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({ supported: false, noteId: null, summary: null });
  });

  it('degrades when the probe said present but the column is not there', async () => {
    // The probe can race a migration in either direction; layer 2 is this.
    init(() => noColumn);

    const res = await runRouteHandler(router, 'get', '/:setId/syllabus', {
      user: { id: USER },
      params: { setId: SET },
      body: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.supported).toBe(false);
  });
});

describe('the migration gate on POST /:setId/syllabus', () => {
  /** The gate is a MIDDLEWARE, so it is fetched by position, not by handler. */
  function gateAndMeterPositions() {
    const layer = (router as never as { stack: any[] }).stack.find(
      (l) => l.route?.path === '/:setId/syllabus' && l.route?.methods?.post
    );
    return layer.route.stack.map((s: { name: string }) => s.name);
  }

  it('refuses with 503 and the migration filename', async () => {
    setSchemaCapabilities({ studySetSyllabus: false });
    init();
    const layer = (router as never as { stack: any[] }).stack.find(
      (l) => l.route?.path === '/:setId/syllabus' && l.route?.methods?.post
    );
    // Second from last is the gate's neighbour; find it by running each
    // middleware until one answers. Only the gate responds without a body.
    const res: any = { statusCode: 200, body: undefined };
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.json = (body: unknown) => {
      res.body = body;
      return res;
    };
    let answered = false;
    for (const s of layer.route.stack) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise<void>((resolve) => {
        let settled = false;
        const next = () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };
        const maybe = s.handle({ user: { id: USER }, params: { setId: SET }, body: {} }, res, next);
        Promise.resolve(maybe).then(() => {
          if (res.body !== undefined) answered = true;
          next();
        });
      });
      if (answered) break;
    }
    expect(answered).toBe(true);
    expect(res.statusCode).toBe(503);
    expect(res.body.migration).toBe(STUDY_SET_SYLLABUS_MIGRATION);
  });

  it('is ordered BEFORE the AI meter, which is what makes the refusal free', () => {
    const names = gateAndMeterPositions();
    // `requireSyllabusSchema` is wrapped by asyncHandler, and the meter and
    // permission middleware follow it. The ASSERTION is the ordering: the
    // handler that answers 503 must not sit after anything that charges.
    const gateIndex = names.length - 4;
    expect(gateIndex).toBeGreaterThanOrEqual(0);
    // The last entry is the route handler itself; the gate is not it.
    expect(gateIndex).toBeLessThan(names.length - 1);
  });
});

describe('POST /:setId/syllabus — refusals that must refund', () => {
  it('refuses a missing body and refunds', async () => {
    init();
    const res = await post({});
    expect(res.statusCode).toBe(400);
    expect(refundFeatureAiCredit).toHaveBeenCalledWith(USER, 'generate_questions');
    expect(extractSyllabusSchedule).not.toHaveBeenCalled();
  });

  it('refuses a file that is neither .pdf nor .docx, and refunds', async () => {
    init();
    const res = await post(pdfBody({ fileName: 'syllabus.txt' }));
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('.pdf or .docx');
    expect(refundFeatureAiCredit).toHaveBeenCalled();
    expect(extractSyllabusSchedule).not.toHaveBeenCalled();
  });

  it('tells a student holding a .doc what to do about it', async () => {
    init();
    const res = await post(pdfBody({ fileName: 'syllabus.doc' }));
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('save as .docx');
    expect(refundFeatureAiCredit).toHaveBeenCalled();
  });

  it('refuses a file over 25 MB before parsing it, and refunds', async () => {
    init();
    const res = await post(
      pdfBody({ base64Data: Buffer.alloc(26 * 1024 * 1024).toString('base64') })
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('25 MB');
    expect(extractPdfTextDetailsFromBuffer).not.toHaveBeenCalled();
    expect(refundFeatureAiCredit).toHaveBeenCalled();
  });

  it('refuses a scan with no text layer, names the fallback, and refunds', async () => {
    init();
    (extractPdfTextDetailsFromBuffer as jest.Mock).mockResolvedValue({ text: '  ', pageCount: 8 });
    const res = await post(pdfBody());
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('add your exam dates instead');
    expect(createNote).not.toHaveBeenCalled();
    expect(refundFeatureAiCredit).toHaveBeenCalled();
  });

  it('answers 503 and refunds when every provider is exhausted', async () => {
    init();
    (extractSyllabusSchedule as jest.Mock).mockRejectedValue(new Error('all providers failed'));
    const res = await post(pdfBody());
    expect(res.statusCode).toBe(503);
    expect(refundFeatureAiCredit).toHaveBeenCalled();
    // The student's document is still filed as a material — the note is
    // created before the model call precisely so this is true.
    expect(createNote).toHaveBeenCalledTimes(1);
  });
});

describe('POST /:setId/syllabus — the happy path', () => {
  it('files the syllabus as a note of the set, stores the schedule, and charges', async () => {
    const rec = init(() => ({
      data: { id: SET, syllabus_note_id: NOTE, syllabus_summary: GOOD_SCHEDULE, exam_date: '2026-10-30' },
      error: null,
    }));

    const res = await post(pdfBody());

    expect(res.statusCode).toBe(201);
    expect(res.body.data.noteId).toBe(NOTE);
    expect(res.body.data.foundLabel).toBe('Found 2 weeks · 1 exam date');
    expect(extractSyllabusSchedule).toHaveBeenCalledTimes(1);
    // ONE model call per upload, and no refund: the work was done.
    expect(refundFeatureAiCredit).not.toHaveBeenCalled();

    // The note is an ordinary note of the set, on an EXISTING source_type —
    // that is what keeps this feature to three nullable columns.
    expect(createNote).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ studySetId: SET, sourceType: 'import' })
    );
    expect(createNote.mock.calls[0][1].title).toContain('Syllabus');

    // The write is scoped by owner AND set.
    expect(rec.trace).toContain(`eq("user_id", "${USER}")`);
    expect(rec.trace).toContain(`eq("id", "${SET}")`);
  });

  it('fills the exam date when the set has none', async () => {
    const rec = init(() => ({
      data: { id: SET, syllabus_note_id: NOTE, syllabus_summary: GOOD_SCHEDULE, exam_date: '2026-10-30' },
      error: null,
    }));

    const res = await post(pdfBody());

    expect(res.statusCode).toBe(201);
    expect(res.body.data.examDateApplied).toBe(true);
    expect(res.body.data.examDate).toBe('2026-10-30');
    // The update body carried the date.
    const update = rec.trace.find((line) => line.startsWith('update('));
    expect(String(update)).toContain('exam_date');
  });

  it('never overwrites a date the student already set', async () => {
    const rec = init(
      () => ({
        data: { id: SET, syllabus_note_id: NOTE, syllabus_summary: GOOD_SCHEDULE, exam_date: '2026-12-01' },
        error: null,
      }),
      '2026-12-01'
    );

    const res = await post(pdfBody());

    expect(res.statusCode).toBe(201);
    expect(res.body.data.examDateApplied).toBe(false);
    expect(res.body.data.examDate).toBe('2026-12-01');
    const update = rec.trace.find((line) => line.startsWith('update('));
    // The write must not mention the column at all — "absent means leave it".
    expect(String(update)).not.toContain('exam_date');
  });

  it('reads a .docx through the Word extractor', async () => {
    init(() => ({ data: { id: SET, syllabus_note_id: NOTE, syllabus_summary: GOOD_SCHEDULE }, error: null }));
    await post(pdfBody({ fileName: 'BIO201.docx' }));
    expect(extractDocumentTextFromBuffer).toHaveBeenCalledTimes(1);
    expect(extractPdfTextDetailsFromBuffer).not.toHaveBeenCalled();
  });
});

describe('POST /:setId/syllabus — malformed model output', () => {
  it.each([
    ['a bare string', 'the schedule is in the document'],
    ['the right key, rubbish inside', { weeks: ['Week 1: intro', null, { week: 0 }] }],
    ['an empty answer', { weeks: [], examDates: [] }],
    ['null', null],
  ])('stores %s as NULL and says nothing was found, without refunding', async (_label, raw) => {
    const rec = init(() => ({
      data: { id: SET, syllabus_note_id: NOTE, syllabus_summary: null, exam_date: null },
      error: null,
    }));
    (extractSyllabusSchedule as jest.Mock).mockResolvedValue({ raw, provider: 'test' });

    const res = await post(pdfBody());

    expect(res.statusCode).toBe(201);
    expect(res.body.data.summary).toBeNull();
    expect(res.body.data.foundLabel).toBe('No schedule found in that file.');
    // The model ANSWERED. No refund — see the file header.
    expect(refundFeatureAiCredit).not.toHaveBeenCalled();
    // And nothing was invented into the column.
    const update = rec.trace.find((line) => line.startsWith('update('));
    expect(String(update)).toContain('"syllabus_summary":null');
  });
});

describe('DELETE /:setId/syllabus', () => {
  it('unlinks the columns and deletes the note it created', async () => {
    const rec = init(() => ({
      data: { id: SET, syllabus_note_id: NOTE, syllabus_summary: GOOD_SCHEDULE },
      error: null,
    }));

    const res = await runRouteHandler(router, 'delete', '/:setId/syllabus', {
      user: { id: USER },
      params: { setId: SET },
      body: {},
    });

    expect(res.statusCode).toBe(200);
    expect(deleteNote).toHaveBeenCalledWith(USER, NOTE);
    const update = rec.trace.find((line) => line.startsWith('update('));
    expect(String(update)).toContain('"syllabus_note_id":null');
    // The exam date is deliberately LEFT: by the time Undo is pressed the
    // student has seen the date and may be counting on it.
    expect(String(update)).not.toContain('exam_date');
  });

  it('refuses with 503 and the migration name before the migration', async () => {
    setSchemaCapabilities({ studySetSyllabus: false });
    init();

    const res = await runRouteHandler(router, 'delete', '/:setId/syllabus', {
      user: { id: USER },
      params: { setId: SET },
      body: {},
    });

    expect(res.statusCode).toBe(503);
    expect(res.body.migration).toBe(STUDY_SET_SYLLABUS_MIGRATION);
  });
});
