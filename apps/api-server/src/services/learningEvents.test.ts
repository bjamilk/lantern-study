/**
 * learning_events (Phase 1 · C) — contract §4:
 *   - recordLearningEvents batches (≤500/insert), coalesces nulls, never throws
 *   - reviewFlashcard emits card_reviewed with srs before/after (and nothing on a CAS 409)
 *   - test completion emits one question_answered per attempted answer and never
 *     twice for one session (both completion paths land in createTestResult)
 *   - the GDPR export includes learning_events (paged) + authored concept_links
 *   - the retention purge never touches learning_events (decision D9)
 */
jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('./cache', () => ({
  cacheService: {
    get: jest.fn(async () => null),
    set: jest.fn(async () => {}),
    delete: jest.fn(async () => {}),
    deletePattern: jest.fn(async () => {}),
    cached: async (_key: string, fn: () => Promise<unknown>) => fn(),
    invalidateUserCache: jest.fn(async () => {}),
  },
}));
jest.mock('../middleware/aiRateLimit', () => ({
  resetAIUsageForUser: jest.fn(async () => {}),
}));
jest.mock('./accountLifecycle', () => ({
  purgeScheduledAccountDeletions: jest.fn(async () => 0),
}));

import { logger } from '../utils/logger';
import {
  LEARNING_EVENTS_BATCH_CAP,
  buildQuestionAnsweredEvents,
  normalizeSurface,
  recordLearningEvent,
  recordLearningEvents,
  recordTestSessionAnswers,
  surfaceFromRequest,
  toLearningEventRow,
} from './learningEvents';
import { SupabaseService } from './supabase';
import { exportUserDataArchive } from './userDataLifecycle';
import { runDataRetentionPurge } from './dataRetention';

const USER = '11111111-1111-4111-8111-111111111111';
const DECK = '22222222-2222-4222-8222-222222222222';
const COURSE = '33333333-3333-4333-8333-333333333333';
const CARD = '44444444-4444-4444-8444-444444444444';
const SESSION = '55555555-5555-4555-8555-555555555555';
const GROUP = '66666666-6666-4666-8666-666666666666';
const LISTING = '77777777-7777-4777-8777-777777777777';

type Write = { table: string; op: string; payload: unknown };

/**
 * PostgREST double: every chain method returns the same thenable api; reads
 * resolve with the per-table canned result, writes are logged. `selectResults`
 * lets a test answer the dedupe existence check differently per call.
 */
function makeDb(opts: {
  results?: Record<string, unknown>;
  insertError?: { code?: string; message?: string } | null;
  selectQueue?: Array<{ data: unknown; error: unknown }>;
} = {}) {
  const writes: Write[] = [];
  const tables: string[] = [];
  const selectQueue = opts.selectQueue ? [...opts.selectQueue] : [];
  const from = (table: string) => {
    tables.push(table);
    let lastOp: 'read' | 'insert' = 'read';
    const api: any = {};
    const self = () => api;
    for (const m of ['select', 'eq', 'is', 'in', 'or', 'order', 'limit', 'range', 'ilike', 'lt', 'delete']) {
      api[m] = self;
    }
    api.insert = (payload: unknown) => {
      lastOp = 'insert';
      writes.push({ table, op: 'insert', payload });
      return api;
    };
    api.upsert = (payload: unknown) => {
      writes.push({ table, op: 'upsert', payload });
      return api;
    };
    const resolveRead = () => {
      if (table === 'learning_events' && selectQueue.length > 0) return selectQueue.shift();
      const data = opts.results?.[table];
      return { data: data === undefined ? null : data, error: null };
    };
    api.maybeSingle = async () => resolveRead();
    api.single = async () => resolveRead();
    api.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      if (lastOp === 'insert') {
        return Promise.resolve({ data: null, error: opts.insertError ?? null }).then(resolve, reject);
      }
      return Promise.resolve(resolveRead()).then(resolve, reject);
    };
    return api;
  };
  return { client: { from }, writes, tables };
}

const service = (db: ReturnType<typeof makeDb>) =>
  ({ getClient: () => db.client }) as unknown as Pick<SupabaseService, 'getClient'>;
const inserted = (db: ReturnType<typeof makeDb>, table = 'learning_events') =>
  db.writes.filter((w) => w.table === table && w.op === 'insert');
const rowsOf = (db: ReturnType<typeof makeDb>) =>
  inserted(db).flatMap((w) => w.payload as Array<Record<string, unknown>>);

beforeEach(() => jest.clearAllMocks());

describe('toLearningEventRow / surface', () => {
  it('coalesces sloppy ids and values to NULL and always writes every column', () => {
    const row = toLearningEventRow({
      userId: USER,
      eventType: 'question_answered',
      targetType: 'question',
      targetId: '  msg-123 ',
      groupId: 'custom-deck-1', // mobile drafts wrote non-uuids here
      courseId: '',
      listingId: undefined,
      rating: 9,
      responseMs: 12.6,
      isCorrect: 'yes' as unknown as boolean,
      count: NaN,
      srsBefore: [1, 2],
      surface: 'desktop' as never,
      occurredAt: 'not-a-date',
    });
    expect(row).toMatchObject({
      user_id: USER,
      event_type: 'question_answered',
      target_type: 'question',
      target_id: 'msg-123',
      group_id: null,
      course_id: null,
      listing_id: null,
      rating: null,
      response_ms: 13,
      is_correct: null,
      count: null,
      srs_before: null,
      srs_after: null,
      surface: 'api',
    });
    expect(Object.keys(row!)).toHaveLength(20);
    expect(Number.isFinite(Date.parse(row!.occurred_at))).toBe(true);
  });

  it('drops rows that can never be valid (no uuid user, unknown event type)', () => {
    expect(toLearningEventRow({ userId: 'me', eventType: 'card_reviewed' })).toBeNull();
    expect(toLearningEventRow({ userId: USER, eventType: 'logged_in' as never })).toBeNull();
  });

  it('reads x-lantern-surface and defaults to api', () => {
    expect(surfaceFromRequest({ header: (n: string) => (n === 'x-lantern-surface' ? 'Mobile' : undefined) } as any)).toBe('mobile');
    expect(surfaceFromRequest({ headers: { 'x-lantern-surface': 'web' } })).toBe('web');
    expect(surfaceFromRequest({ headers: {} })).toBe('api');
    expect(surfaceFromRequest(undefined)).toBe('api');
    expect(normalizeSurface('ios')).toBe('api');
  });
});

describe('recordLearningEvents', () => {
  it('batches inserts at the cap and returns the row count', async () => {
    const db = makeDb();
    const n = LEARNING_EVENTS_BATCH_CAP * 2 + 7;
    const inputs = Array.from({ length: n }, (_, i) => ({
      userId: USER,
      eventType: 'card_reviewed' as const,
      targetId: `c${i}`,
    }));
    await expect(recordLearningEvents(service(db), inputs)).resolves.toBe(n);
    const batches = inserted(db).map((w) => (w.payload as unknown[]).length);
    expect(batches).toEqual([LEARNING_EVENTS_BATCH_CAP, LEARNING_EVENTS_BATCH_CAP, 7]);
  });

  it('skips invalid rows silently and writes nothing when none remain', async () => {
    const db = makeDb();
    await expect(
      recordLearningEvents(service(db), [{ userId: 'nope', eventType: 'card_reviewed' }])
    ).resolves.toBe(0);
    expect(inserted(db)).toHaveLength(0);
  });

  it('never throws: insert errors are logged and 0 is returned', async () => {
    const db = makeDb({ insertError: { code: '23514', message: 'check violation' } });
    await expect(
      recordLearningEvent(service(db), { userId: USER, eventType: 'note_created' })
    ).resolves.toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      'learning_events: insert failed',
      expect.objectContaining({ code: '23514' })
    );
  });

  it('never throws: a missing table (migration not applied) is a single warning', async () => {
    const db = makeDb({ insertError: { code: '42P01', message: 'relation "learning_events" does not exist' } });
    await expect(
      recordLearningEvent(service(db), { userId: USER, eventType: 'note_created' })
    ).resolves.toBe(0);
    await recordLearningEvent(service(db), { userId: USER, eventType: 'note_created' });
    const missing = (logger.warn as jest.Mock).mock.calls.filter((c) =>
      String(c[0]).includes('learning_events table is missing')
    );
    expect(missing).toHaveLength(1);
  });

  it('never throws: a broken client resolves to 0', async () => {
    const broken = { getClient: () => { throw new Error('no client'); } } as any;
    await expect(
      recordLearningEvent(broken, { userId: USER, eventType: 'note_created' })
    ).resolves.toBe(0);
    await expect(
      recordLearningEvent(undefined as any, { userId: USER, eventType: 'note_created' })
    ).resolves.toBe(0);
  });
});

describe('reviewFlashcard emits card_reviewed', () => {
  const BEFORE = { interval: 1, easeFactor: 2.5, repetitions: 0, nextReviewDate: '2026-08-20T00:00:00.000Z' };
  const AFTER = { interval: 3, easeFactor: 2.6, repetitions: 1, nextReviewDate: '2026-08-25T00:00:00.000Z', scheduler: 'fsrs' };

  function stub(db: ReturnType<typeof makeDb>, overrides: Record<string, unknown> = {}) {
    return {
      getClient: () => db.client,
      getFlashcardForUser: jest.fn(async () => ({ id: CARD, deck_id: DECK, srs_data: BEFORE, version: 1 })),
      verifyDeckAccess: jest.fn(async () => true),
      getUserPreferences: jest.fn(async () => ({ settings: {} })),
      updateFlashcard: jest.fn(async () => ({ id: CARD, deck_id: DECK, srs_data: AFTER, version: 2 })),
      ...overrides,
    };
  }
  const review = (self: unknown, options?: Record<string, unknown>) =>
    SupabaseService.prototype.reviewFlashcard.call(self as any, CARD, USER, 'good', options ?? {});

  it('writes one row with rating, srs before/after, deck, course, surface and occurred_at', async () => {
    const db = makeDb({ results: { decks: { course_id: COURSE } } });
    const self = stub(db);
    const reviewedAt = '2026-08-21T09:30:00.000Z';
    const result = await review(self, { expectedVersion: 1, surface: 'mobile', occurredAt: reviewedAt });
    expect(result).toMatchObject({ id: CARD, version: 2 });
    expect(self.updateFlashcard).toHaveBeenCalledWith(
      CARD,
      expect.objectContaining({ srsData: expect.any(Object) }),
      USER,
      { expectedVersion: 1 }
    );
    const rows = rowsOf(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: USER,
      event_type: 'card_reviewed',
      target_type: 'flashcard',
      target_id: CARD,
      deck_id: DECK,
      course_id: COURSE,
      rating: 3,
      srs_before: BEFORE,
      srs_after: AFTER,
      surface: 'mobile',
      occurred_at: reviewedAt,
    });
  });

  it('defaults surface to api and occurred_at to now for live reviews', async () => {
    const db = makeDb();
    const before = Date.now();
    await review(stub(db));
    const [row] = rowsOf(db);
    expect(row.surface).toBe('api');
    expect(row.course_id).toBeNull();
    expect(Date.parse(String(row.occurred_at))).toBeGreaterThanOrEqual(before - 1000);
  });

  it('emits nothing when the CAS update conflicts or the card is inaccessible', async () => {
    const conflictDb = makeDb();
    const conflict = stub(conflictDb, {
      updateFlashcard: jest.fn(async () => { throw Object.assign(new Error('conflict'), { code: 'version_conflict' }); }),
    });
    await expect(review(conflict)).rejects.toThrow('conflict');
    expect(inserted(conflictDb)).toHaveLength(0);

    const deniedDb = makeDb();
    await expect(review(stub(deniedDb, { verifyDeckAccess: jest.fn(async () => false) }))).resolves.toBeNull();
    expect(inserted(deniedDb)).toHaveLength(0);
  });
});

describe('test completion emits question_answered', () => {
  const session = {
    id: SESSION,
    user_id: USER,
    course_id: COURSE,
    end_time: '2026-08-21T10:00:00.000Z',
    config: { groupId: GROUP, bundleId: `qbank-${LISTING}`, courseId: 'ignored-when-column-set' },
    questions: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }, { id: 'q4' }],
    user_answers: {
      q1: { questionId: 'q1', selectedOptionIds: ['a'], isCorrect: true, timeSpentSeconds: 12.4 },
      q2: { questionId: 'q2', fillText: 'mitochondria', isCorrect: false, timeSpentSeconds: 30 },
      q3: { questionId: 'q3', isBookmarked: true }, // bookmarked, never answered
      q4: { questionId: 'q4', selectedOptionIds: ['b'] }, // no isCorrect / time recorded
    },
  };

  it('builds one row per attempted answer with correctness, response_ms, session/group/course/listing', () => {
    const events = buildQuestionAnsweredEvents(session, USER, 'web');
    expect(events.map((e) => e.targetId)).toEqual(['q1', 'q2', 'q4']);
    expect(events[0]).toMatchObject({
      eventType: 'question_answered',
      targetType: 'question',
      sessionId: SESSION,
      groupId: GROUP,
      courseId: COURSE,
      listingId: LISTING,
      isCorrect: true,
      responseMs: 12400,
      surface: 'web',
      occurredAt: '2026-08-21T10:00:00.000Z',
    });
    expect(events[1]).toMatchObject({ isCorrect: false, responseMs: 30000 });
    expect(events[2]).toMatchObject({ isCorrect: null, responseMs: null });
  });

  it('accepts the legacy array user_answers shape and non-uuid groupIds', () => {
    const events = buildQuestionAnsweredEvents(
      {
        id: SESSION,
        config: { groupId: 'custom-deck-9', courseId: COURSE },
        questions: [{ id: 'q1' }, { id: 'q2' }],
        user_answers: [{ selectedOptionIds: ['a'], isCorrect: true }, { selectedOptionIds: ['c'] }],
      },
      USER,
      'mobile'
    );
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ targetId: 'q1', groupId: 'custom-deck-9', courseId: COURSE, listingId: null });
    // non-uuid group collapses to NULL at the row layer
    expect(toLearningEventRow(events[0])).toMatchObject({ group_id: null, course_id: COURSE });
  });

  it('recordTestSessionAnswers writes N rows once and skips when the session already emitted', async () => {
    const db = makeDb({
      selectQueue: [
        { data: null, error: null }, // first completion: nothing yet
        { data: { id: 1 }, error: null }, // second call: already emitted
      ],
    });
    await expect(recordTestSessionAnswers(service(db), { session, userId: USER, surface: 'web' }))
      .resolves.toEqual({ inserted: 3, skipped: false });
    await expect(recordTestSessionAnswers(service(db), { session, userId: USER, surface: 'web' }))
      .resolves.toEqual({ inserted: 0, skipped: true });
    expect(rowsOf(db)).toHaveLength(3);
    expect(rowsOf(db).every((r) => r.session_id === SESSION && r.event_type === 'question_answered')).toBe(true);
  });

  it('createTestResult (both completion paths) emits exactly once per session', async () => {
    const db = makeDb({
      results: { test_results: { session_id: SESSION, score: 50 } },
      selectQueue: [
        { data: null, error: null },
        { data: { id: 1 }, error: null },
      ],
    });
    const self = {
      supabase: db.client,
      getClient: () => db.client,
      getTestById: jest.fn(async () => session),
      calculateTestScore: jest.fn(() => 50),
      applyTestCompletionGamification: jest.fn(async () => undefined),
    };
    const call = (surface: 'web' | 'mobile') =>
      SupabaseService.prototype.createTestResult.call(
        self as any,
        SESSION,
        { score: 50, correctAnswersCount: 2, totalQuestions: 4 },
        USER,
        { surface }
      );
    await call('web'); // completeTestDraft → createTestResult
    await call('web'); // client retries POST /tests/:id/results for the same session
    expect(inserted(db, 'test_results').length + db.writes.filter((w) => w.table === 'test_results').length).toBeGreaterThan(0);
    const rows = rowsOf(db);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.target_id)).toEqual(['q1', 'q2', 'q4']);
    expect(rows[0]).toMatchObject({ surface: 'web', listing_id: LISTING, group_id: GROUP, course_id: COURSE });
  });

  it('never fails the completion when the events table is missing', async () => {
    const db = makeDb({
      results: { test_results: { session_id: SESSION, score: 50 } },
      selectQueue: [{ data: null, error: { code: '42P01', message: 'relation "learning_events" does not exist' } }],
    });
    const self = {
      supabase: db.client,
      getClient: () => db.client,
      getTestById: jest.fn(async () => session),
      calculateTestScore: jest.fn(() => 50),
      applyTestCompletionGamification: jest.fn(async () => undefined),
    };
    await expect(
      SupabaseService.prototype.createTestResult.call(
        self as any,
        SESSION,
        { score: 50, correctAnswersCount: 2, totalQuestions: 4 },
        USER
      )
    ).resolves.toMatchObject({ session_id: SESSION });
    expect(inserted(db)).toHaveLength(0);
  });
});

describe('lifecycle', () => {
  it('exportUserDataArchive includes paged learning_events and authored concept_links', async () => {
    const events = [
      { id: 1, user_id: USER, event_type: 'card_reviewed', occurred_at: '2026-08-20T00:00:00.000Z' },
      { id: 2, user_id: USER, event_type: 'question_answered', occurred_at: '2026-08-21T00:00:00.000Z' },
    ];
    const links = [{ concept_id: 'c1', target_type: 'note', target_id: 'n1', confidence: 1, source: 'user' }];
    const db = makeDb({ results: { learning_events: events, concept_links: links } });
    const archive = await exportUserDataArchive({ getClient: () => db.client } as any, USER);
    expect(archive.learningEvents).toEqual(events);
    expect(archive.learningEventsTruncated).toBe(false);
    expect(archive.conceptLinks).toEqual(links);
    expect(db.tables).toEqual(expect.arrayContaining(['learning_events', 'concept_links']));
  });

  it('runDataRetentionPurge never touches learning_events (decision D9)', async () => {
    const db = makeDb({ results: { ai_inference_log: [], ai_analytics: [], product_events: [] } });
    await runDataRetentionPurge({ getClient: () => db.client } as any);
    expect(db.tables).not.toContain('learning_events');
    expect(db.tables).not.toContain('concept_links');
    expect(db.tables).not.toContain('concepts');
  });
});
