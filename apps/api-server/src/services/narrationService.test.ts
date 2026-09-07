/**
 * The narration script service, from the API's side of the wire.
 *
 * The three properties worth pinning are the three a student would feel:
 * a document that cannot be read is refused BEFORE any credit is reserved, a
 * retry never pays twice, and a run where every model call failed throws
 * rather than storing an empty script and calling it ready.
 */
import type { SupabaseService } from './supabase';

jest.mock('./aiService', () => ({
  chatCompletion: jest.fn(),
  extractJSON: jest.requireActual('./aiService').extractJSON,
}));
jest.mock('./notePages', () => ({
  ensurePages: jest.fn(),
  ensurePageImages: jest.fn(async () => ({ available: true, rendered: 0 })),
  getPages: jest.fn(async () => ({ available: true, reason: 'ok', pages: [] })),
  signPageImages: jest.fn(async () => new Map<number, string>()),
}));

import {
  NARRATION_STALE_AFTER_MS,
  NARRATION_STALLED_MESSAGE,
  __resetNarrationWarningForTests,
  buildNarrationScript,
  claimNarrationRun,
  expireStalledNarration,
  getNarrationBundle,
  getNarrationScript,
  isMissingNarrationSchema,
  isNarrationRunStale,
  narrationApiPayload,
  releaseNarrationClaim,
  resolveNarrationTarget,
  type StoredNarrationScript,
} from './narrationService';
import { chatCompletion } from './aiService';
import { ensurePages } from './notePages';

const chatMock = chatCompletion as jest.MockedFunction<any>;
const ensurePagesMock = ensurePages as jest.MockedFunction<any>;

const ATTACHMENT_ID = 'att-1';
const NOTE_ID = 'note-1';
const USER_ID = 'user-1';

type PgError = { code?: string; message?: string } | null;

/**
 * In-memory stand-in for narration_scripts, keyed by its real PK.
 *
 * It supports the four shapes the service actually issues — the read, the
 * upsert, the claiming INSERT and the guarded UPDATE (and the release's
 * DELETE) — including the two things the claim depends on being real: a unique
 * violation when a row already exists, and an UPDATE that matches nothing when
 * the guard does not hold.
 */
type StoreWrite = {
  op: 'insert' | 'update' | 'delete';
  payload: Record<string, unknown>;
  filters: Record<string, string>;
  statusIn: string[] | null;
};

function makeStore(options: { failWith?: PgError } = {}) {
  const rows = new Map<string, Record<string, unknown>>();
  const key = (attachmentId: string, userId: string) => `${attachmentId}#${userId}`;
  /** Every write the service issued, in order, with the guards it carried. */
  const writes: StoreWrite[] = [];

  const from = jest.fn((table: string) => {
    if (table !== 'narration_scripts') throw new Error(`unexpected table ${table}`);
    const filters: Record<string, string> = {};
    let statusIn: string[] | null = null;
    let op: 'read' | 'insert' | 'update' | 'delete' = 'read';
    let payload: Record<string, unknown> = {};

    const rowKey = () => key(filters.attachment_id, filters.user_id);
    // Every `.eq` is a real guard, `version` included: the stale sweep and the
    // heartbeat both guard on it, and a mock that ignored it would pass a
    // write that clobbers a newer run.
    const guardHolds = (row: Record<string, unknown> | undefined) => {
      if (!row) return false;
      if (statusIn && !statusIn.includes(String(row.status))) return false;
      for (const [column, value] of Object.entries(filters)) {
        if (String(row[column]) !== value) return false;
      }
      return true;
    };

    const run = () => {
      if (op !== 'read') writes.push({ op, payload: { ...payload }, filters: { ...filters }, statusIn });
      if (options.failWith) return { data: null, error: options.failWith };
      if (op === 'insert') {
        const id = key(String(payload.attachment_id), String(payload.user_id));
        if (rows.has(id)) {
          return {
            data: null,
            error: { code: '23505', message: 'duplicate key value violates unique constraint' },
          };
        }
        rows.set(id, { ...payload });
        return { data: [{ ...payload }], error: null };
      }
      if (op === 'update') {
        const row = rows.get(rowKey());
        if (!guardHolds(row)) return { data: [], error: null };
        rows.set(rowKey(), { ...row, ...payload });
        return { data: [{ ...rows.get(rowKey()) }], error: null };
      }
      if (op === 'delete') {
        const row = rows.get(rowKey());
        if (!guardHolds(row)) return { data: [], error: null };
        rows.delete(rowKey());
        return { data: [{ ...row }], error: null };
      }
      return { data: rows.get(rowKey()) || null, error: null };
    };

    const query: any = {
      select: () => query,
      eq: (column: string, value: unknown) => {
        filters[column] = String(value);
        return query;
      },
      in: (column: string, values: string[]) => {
        if (column === 'status') statusIn = values;
        return query;
      },
      insert: (incoming: Record<string, unknown>) => {
        op = 'insert';
        payload = incoming;
        return query;
      },
      update: (incoming: Record<string, unknown>) => {
        op = 'update';
        payload = incoming;
        return query;
      },
      delete: () => {
        op = 'delete';
        return query;
      },
      maybeSingle: () => Promise.resolve(run()),
      upsert: (incoming: Record<string, unknown>) => {
        if (options.failWith) return Promise.resolve({ data: null, error: options.failWith });
        const id = key(String(incoming.attachment_id), String(incoming.user_id));
        rows.set(id, { ...(rows.get(id) || {}), ...incoming });
        return Promise.resolve({ data: null, error: null });
      },
      // Every write chain is awaited directly, with or without a trailing
      // .select(), so the builder itself has to be thenable.
      then: (resolve: (value: unknown) => unknown, reject?: (err: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve, reject),
    };
    return query;
  });

  return { rows, from, key, writes };
}

function makeService(store: ReturnType<typeof makeStore>): SupabaseService {
  return {
    getClient: () => ({ from: store.from }),
    getNoteAttachment: jest.fn(async () => ({ id: ATTACHMENT_ID, type: 'pdf' })),
  } as unknown as SupabaseService;
}

function pages(count: number) {
  return Array.from({ length: count }, (_, pageIndex) => ({
    attachmentId: ATTACHMENT_ID,
    pageIndex,
    text: `Page ${pageIndex} explains something real and long enough to narrate.`,
    charCount: 60,
    imagePath: null,
  }));
}

function reply(pageIndexes: number[]) {
  return {
    text: JSON.stringify({
      segments: pageIndexes.map((pageIndex) => ({
        pageIndex,
        text: `Spoken paragraph for page ${pageIndex}.`,
      })),
    }),
    provider: 'groq',
  };
}

afterEach(() => {
  // The dead-run tests freeze the clock with a spy; nothing else may inherit it.
  jest.restoreAllMocks();
});

beforeEach(() => {
  jest.clearAllMocks();
  __resetNarrationWarningForTests();
  ensurePagesMock.mockResolvedValue({
    available: true,
    reason: 'ok',
    pages: pages(6),
    backfilled: 0,
  });
});

describe('isMissingNarrationSchema', () => {
  it('recognizes an unapplied migration', () => {
    expect(isMissingNarrationSchema({ code: '42P01' })).toBe(true);
    expect(isMissingNarrationSchema({ code: 'PGRST205' })).toBe(true);
    expect(
      isMissingNarrationSchema({
        message: 'relation "public.narration_scripts" does not exist',
      })
    ).toBe(true);
  });

  it('does not mistake a real fault for an unapplied migration', () => {
    expect(isMissingNarrationSchema({ code: '23505', message: 'duplicate key' })).toBe(false);
    expect(isMissingNarrationSchema(null)).toBe(false);
  });
});

describe('resolveNarrationTarget', () => {
  it('prices a short document at two uses', async () => {
    const service = makeService(makeStore());
    const target = await resolveNarrationTarget(service, {
      noteId: NOTE_ID,
      attachmentId: ATTACHMENT_ID,
      userId: USER_ID,
    });
    expect(target.ok).toBe(true);
    if (target.ok) {
      expect(target.cost).toBe(2);
      expect(target.pageCount).toBe(6);
      expect(target.reuse).toBe(false);
    }
  });

  it('prices a long document at three uses and stops at the ceiling', async () => {
    ensurePagesMock.mockResolvedValue({
      available: true,
      reason: 'ok',
      pages: pages(60),
      backfilled: 0,
    });
    const service = makeService(makeStore());
    const target = await resolveNarrationTarget(service, {
      noteId: NOTE_ID,
      attachmentId: ATTACHMENT_ID,
      userId: USER_ID,
    });
    if (!target.ok) throw new Error('expected a chargeable target');
    expect(target.pageCount).toBe(40);
    expect(target.cost).toBe(3);
    expect(target.truncated).toBe(true);
  });

  it('refuses a document with no readable text, before anything is charged', async () => {
    ensurePagesMock.mockResolvedValue({
      available: true,
      reason: 'ok',
      pages: [{ attachmentId: ATTACHMENT_ID, pageIndex: 0, text: '', charCount: 0, imagePath: null }],
      backfilled: 0,
    });
    const service = makeService(makeStore());
    const target = await resolveNarrationTarget(service, {
      noteId: NOTE_ID,
      attachmentId: ATTACHMENT_ID,
      userId: USER_ID,
    });
    expect(target.ok).toBe(false);
    if (!target.ok) {
      expect(target.status).toBe(400);
      expect(target.reason).toBe('no_pages');
    }
  });

  it('says the feature is not switched on when the migration is missing', async () => {
    const service = makeService(makeStore({ failWith: { code: '42P01' } }));
    const target = await resolveNarrationTarget(service, {
      noteId: NOTE_ID,
      attachmentId: ATTACHMENT_ID,
      userId: USER_ID,
    });
    expect(target.ok).toBe(false);
    if (!target.ok) {
      expect(target.reason).toBe('schema_missing');
      // 200, not an error: the student's document is fine, the server is not
      // finished being set up.
      expect(target.status).toBe(200);
    }
  });

  it('reuses a script that already exists rather than charging again', async () => {
    const store = makeStore();
    store.rows.set(store.key(ATTACHMENT_ID, USER_ID), {
      attachment_id: ATTACHMENT_ID,
      user_id: USER_ID,
      version: 1,
      status: 'ready',
      page_count: 6,
      credit_cost: 2,
      segments: [],
    });
    const target = await resolveNarrationTarget(makeService(store), {
      noteId: NOTE_ID,
      attachmentId: ATTACHMENT_ID,
      userId: USER_ID,
    });
    if (!target.ok) throw new Error('expected reuse, not a refusal');
    expect(target.reuse).toBe(true);
    expect(target.cost).toBe(0);
    // The expensive part never ran.
    expect(ensurePagesMock).not.toHaveBeenCalled();
  });

  it('reuses a run that is still being written, so a double tap costs once', async () => {
    const store = makeStore();
    store.rows.set(store.key(ATTACHMENT_ID, USER_ID), {
      attachment_id: ATTACHMENT_ID,
      user_id: USER_ID,
      version: 1,
      status: 'generating',
      page_count: 6,
      credit_cost: 2,
      segments: [],
    });
    const target = await resolveNarrationTarget(makeService(store), {
      noteId: NOTE_ID,
      attachmentId: ATTACHMENT_ID,
      userId: USER_ID,
    });
    if (!target.ok) throw new Error('expected reuse');
    expect(target.reuse).toBe(true);
  });

  it('charges again only when the student asks for a new reading', async () => {
    const store = makeStore();
    store.rows.set(store.key(ATTACHMENT_ID, USER_ID), {
      attachment_id: ATTACHMENT_ID,
      user_id: USER_ID,
      version: 1,
      status: 'ready',
      page_count: 6,
      credit_cost: 2,
      segments: [],
    });
    const target = await resolveNarrationTarget(makeService(store), {
      noteId: NOTE_ID,
      attachmentId: ATTACHMENT_ID,
      userId: USER_ID,
      regenerate: true,
    });
    if (!target.ok) throw new Error('expected a chargeable target');
    expect(target.reuse).toBe(false);
    expect(target.cost).toBe(2);
    expect(target.existing?.version).toBe(1);
  });

  it('retries a failed run without treating it as an existing script', async () => {
    const store = makeStore();
    store.rows.set(store.key(ATTACHMENT_ID, USER_ID), {
      attachment_id: ATTACHMENT_ID,
      user_id: USER_ID,
      version: 1,
      status: 'failed',
      page_count: 6,
      credit_cost: 2,
      segments: [],
    });
    const target = await resolveNarrationTarget(makeService(store), {
      noteId: NOTE_ID,
      attachmentId: ATTACHMENT_ID,
      userId: USER_ID,
    });
    if (!target.ok) throw new Error('expected a chargeable target');
    expect(target.reuse).toBe(false);
  });
});

describe('buildNarrationScript', () => {
  it('writes one segment per page and stores it ready', async () => {
    const store = makeStore();
    chatMock.mockResolvedValueOnce(reply([0, 1, 2, 3])).mockResolvedValueOnce(reply([4, 5]));
    const result = await buildNarrationScript(makeService(store), {
      noteId: NOTE_ID,
      attachmentId: ATTACHMENT_ID,
      userId: USER_ID,
      version: 1,
      creditCost: 2,
      title: 'Lecture 4',
    });

    expect(result.segmentCount).toBe(6);
    const row = store.rows.get(store.key(ATTACHMENT_ID, USER_ID))!;
    expect(row.status).toBe('ready');
    expect((row.segments as unknown[]).length).toBe(6);
    expect(row.credit_cost).toBe(2);
  });

  it('runs one model call per four pages, plus a merge', async () => {
    const store = makeStore();
    chatMock.mockResolvedValue(reply([0, 1, 2, 3]));
    await buildNarrationScript(makeService(store), {
      noteId: NOTE_ID,
      attachmentId: ATTACHMENT_ID,
      userId: USER_ID,
    });
    // Six pages → two map calls, and one merge because there is a join.
    expect(chatMock).toHaveBeenCalledTimes(3);
  });

  it('skips the merge pass for a document that took one call', async () => {
    ensurePagesMock.mockResolvedValue({
      available: true,
      reason: 'ok',
      pages: pages(3),
      backfilled: 0,
    });
    const store = makeStore();
    chatMock.mockResolvedValue(reply([0, 1, 2]));
    await buildNarrationScript(makeService(store), {
      noteId: NOTE_ID,
      attachmentId: ATTACHMENT_ID,
      userId: USER_ID,
    });
    expect(chatMock).toHaveBeenCalledTimes(1);
  });

  it('keeps a partial script rather than losing the pages that worked', async () => {
    const store = makeStore();
    chatMock
      .mockResolvedValueOnce(reply([0, 1, 2, 3]))
      .mockRejectedValueOnce(new Error('provider down'))
      .mockResolvedValueOnce(reply([0, 1, 2, 3]));
    const result = await buildNarrationScript(makeService(store), {
      noteId: NOTE_ID,
      attachmentId: ATTACHMENT_ID,
      userId: USER_ID,
    });
    expect(result.segmentCount).toBe(4);
    expect(store.rows.get(store.key(ATTACHMENT_ID, USER_ID))!.status).toBe('ready');
  });

  it('throws when every call failed, so the job refunds instead of storing silence', async () => {
    const store = makeStore();
    chatMock.mockRejectedValue(new Error('provider down'));
    await expect(
      buildNarrationScript(makeService(store), {
        noteId: NOTE_ID,
        attachmentId: ATTACHMENT_ID,
        userId: USER_ID,
      })
    ).rejects.toThrow();
    expect(store.rows.get(store.key(ATTACHMENT_ID, USER_ID))!.status).not.toBe('ready');
  });

  it('drops a page the model invented', async () => {
    ensurePagesMock.mockResolvedValue({
      available: true,
      reason: 'ok',
      pages: pages(2),
      backfilled: 0,
    });
    const store = makeStore();
    chatMock.mockResolvedValue(reply([0, 1, 99]));
    const result = await buildNarrationScript(makeService(store), {
      noteId: NOTE_ID,
      attachmentId: ATTACHMENT_ID,
      userId: USER_ID,
    });
    expect(result.segmentCount).toBe(2);
  });
});

describe('getNarrationScript', () => {
  it('reports an unapplied migration instead of throwing', async () => {
    const result = await getNarrationScript(
      makeService(makeStore({ failWith: { code: 'PGRST205' } })),
      ATTACHMENT_ID,
      USER_ID
    );
    expect(result.available).toBe(false);
    expect(result.reason).toBe('schema_missing');
    expect(result.script).toBeNull();
  });

  it('answers null for a document nobody has narrated', async () => {
    const result = await getNarrationScript(makeService(makeStore()), ATTACHMENT_ID, USER_ID);
    expect(result.available).toBe(true);
    expect(result.script).toBeNull();
  });
});

/* ---------------------------------------------- claiming, and dead runs -- */

const NOW = Date.parse('2026-09-07T12:00:00.000Z');
const isoAgo = (ms: number) => new Date(NOW - ms).toISOString();

function storedScript(overrides: Partial<StoredNarrationScript> = {}): StoredNarrationScript {
  return {
    sourceId: ATTACHMENT_ID,
    version: 1,
    status: 'failed',
    pageCount: 6,
    creditCost: 2,
    segments: [],
    jobId: null,
    errorMessage: null,
    createdAt: isoAgo(60_000),
    updatedAt: isoAgo(60_000),
    ...overrides,
  };
}

/** Put a row in the store the way the database would hold it. */
function seed(store: ReturnType<typeof makeStore>, row: Record<string, unknown>) {
  store.rows.set(store.key(ATTACHMENT_ID, USER_ID), {
    attachment_id: ATTACHMENT_ID,
    user_id: USER_ID,
    version: 1,
    page_count: 6,
    credit_cost: 2,
    segments: [],
    error_message: null,
    job_id: null,
    created_at: isoAgo(60_000),
    updated_at: isoAgo(60_000),
    ...row,
  });
}

describe('claimNarrationRun', () => {
  it('lets exactly one of two simultaneous first requests own the run', async () => {
    const service = makeService(makeStore());
    const claim = () =>
      claimNarrationRun(service, {
        attachmentId: ATTACHMENT_ID,
        userId: USER_ID,
        previous: null,
        pageCount: 6,
        creditCost: 2,
      });

    const [first, second] = await Promise.all([claim(), claim()]);

    // This is the double tap: both requests read "nothing here" a moment
    // apart. Only one may go on to be charged.
    expect([first.claimed, second.claimed].filter(Boolean)).toHaveLength(1);
    expect(first.available && second.available).toBe(true);
  });

  it('lets exactly one of two retries of a failed run own the retry', async () => {
    const store = makeStore();
    seed(store, { status: 'failed', error_message: 'provider down' });
    const service = makeService(store);
    const previous = storedScript({ status: 'failed', errorMessage: 'provider down' });

    const claim = () =>
      claimNarrationRun(service, {
        attachmentId: ATTACHMENT_ID,
        userId: USER_ID,
        previous,
        pageCount: 6,
        creditCost: 2,
      });
    const [first, second] = await Promise.all([claim(), claim()]);

    expect([first.claimed, second.claimed].filter(Boolean)).toHaveLength(1);
    const row = store.rows.get(store.key(ATTACHMENT_ID, USER_ID))!;
    expect(row.status).toBe('queued');
    // One retry, so one version bump — not two.
    expect(row.version).toBe(2);
  });

  it('claims a finished script for a regeneration, and refuses a second one', async () => {
    const store = makeStore();
    seed(store, { status: 'ready', segments: [{ pageIndex: 0, text: 'old' }] });
    const service = makeService(store);
    const previous = storedScript({ status: 'ready' });

    const first = await claimNarrationRun(service, {
      attachmentId: ATTACHMENT_ID,
      userId: USER_ID,
      previous,
      pageCount: 6,
      creditCost: 2,
    });
    expect(first.claimed).toBe(true);
    expect(first.version).toBe(2);

    const second = await claimNarrationRun(service, {
      attachmentId: ATTACHMENT_ID,
      userId: USER_ID,
      previous,
      pageCount: 6,
      creditCost: 2,
    });
    expect(second.claimed).toBe(false);
  });

  it('reports an unapplied migration instead of claiming', async () => {
    const result = await claimNarrationRun(makeService(makeStore({ failWith: { code: '42P01' } })), {
      attachmentId: ATTACHMENT_ID,
      userId: USER_ID,
      previous: null,
      pageCount: 6,
      creditCost: 2,
    });
    expect(result.available).toBe(false);
    expect(result.claimed).toBe(false);
  });
});

describe('releaseNarrationClaim', () => {
  it('removes a row the claim created when the charge is refused', async () => {
    const store = makeStore();
    const service = makeService(store);
    await claimNarrationRun(service, {
      attachmentId: ATTACHMENT_ID,
      userId: USER_ID,
      previous: null,
      pageCount: 6,
      creditCost: 2,
    });
    expect(store.rows.size).toBe(1);

    await releaseNarrationClaim(service, {
      attachmentId: ATTACHMENT_ID,
      userId: USER_ID,
      previous: null,
    });

    // A 429 must not leave the student staring at a run that will never start.
    expect(store.rows.size).toBe(0);
  });

  it('puts a previous script back exactly as it was', async () => {
    const store = makeStore();
    const segments = [
      { pageIndex: 0, order: 0, text: 'The old reading.', estimatedSeconds: 6, startMs: 0, durationMs: 6000 },
    ];
    seed(store, { status: 'ready', version: 3, credit_cost: 3, segments });
    const service = makeService(store);
    const previous = storedScript({ status: 'ready', version: 3, creditCost: 3, segments });

    const claim = await claimNarrationRun(service, {
      attachmentId: ATTACHMENT_ID,
      userId: USER_ID,
      previous,
      pageCount: 6,
      creditCost: 2,
    });
    expect(claim.claimed).toBe(true);

    await releaseNarrationClaim(service, {
      attachmentId: ATTACHMENT_ID,
      userId: USER_ID,
      previous: claim.previous,
    });

    const row = store.rows.get(store.key(ATTACHMENT_ID, USER_ID))!;
    expect(row.status).toBe('ready');
    expect(row.version).toBe(3);
    expect(row.credit_cost).toBe(3);
    // The regeneration that was refused must not have cost the student the
    // reading they already had.
    expect(row.segments).toEqual(segments);
  });

  it('leaves a run that has already started alone', async () => {
    const store = makeStore();
    seed(store, { status: 'generating', version: 2 });
    const service = makeService(store);

    await releaseNarrationClaim(service, {
      attachmentId: ATTACHMENT_ID,
      userId: USER_ID,
      previous: storedScript({ status: 'failed' }),
    });

    expect(store.rows.get(store.key(ATTACHMENT_ID, USER_ID))!.status).toBe('generating');
  });
});

describe('a run whose worker died', () => {
  it('is stale only strictly past the window', () => {
    const queued = (age: number) =>
      storedScript({ status: 'queued', updatedAt: isoAgo(age), createdAt: isoAgo(age) });

    expect(isNarrationRunStale(queued(NARRATION_STALE_AFTER_MS - 1), NOW)).toBe(false);
    // The boundary itself is still a live run.
    expect(isNarrationRunStale(queued(NARRATION_STALE_AFTER_MS), NOW)).toBe(false);
    expect(isNarrationRunStale(queued(NARRATION_STALE_AFTER_MS + 1), NOW)).toBe(true);
  });

  it('is never claimed for a run that is not in flight, or for an undated row', () => {
    const old = NARRATION_STALE_AFTER_MS * 10;
    expect(isNarrationRunStale(storedScript({ status: 'ready', updatedAt: isoAgo(old) }), NOW)).toBe(false);
    expect(isNarrationRunStale(storedScript({ status: 'failed', updatedAt: isoAgo(old) }), NOW)).toBe(false);
    expect(
      isNarrationRunStale(storedScript({ status: 'queued', updatedAt: '', createdAt: undefined }), NOW)
    ).toBe(false);
    expect(isNarrationRunStale(null, NOW)).toBe(false);
  });

  it('is retried and charged rather than reused forever', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    const store = makeStore();
    seed(store, {
      status: 'generating',
      updated_at: isoAgo(NARRATION_STALE_AFTER_MS + 60_000),
    });

    const target = await resolveNarrationTarget(makeService(store), {
      noteId: NOTE_ID,
      attachmentId: ATTACHMENT_ID,
      userId: USER_ID,
    });

    if (!target.ok) throw new Error('expected a chargeable target');
    expect(target.reuse).toBe(false);
    expect(target.cost).toBe(2);
    // The dead run is recorded as failed, so nothing reuses it again.
    const row = store.rows.get(store.key(ATTACHMENT_ID, USER_ID))!;
    expect(row.status).toBe('failed');
    expect(row.error_message).toBe(NARRATION_STALLED_MESSAGE);
  });

  it('still reuses a run that is merely slow', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    const store = makeStore();
    seed(store, { status: 'generating', updated_at: isoAgo(NARRATION_STALE_AFTER_MS - 60_000) });

    const target = await resolveNarrationTarget(makeService(store), {
      noteId: NOTE_ID,
      attachmentId: ATTACHMENT_ID,
      userId: USER_ID,
    });

    if (!target.ok) throw new Error('expected reuse');
    expect(target.reuse).toBe(true);
    expect(target.cost).toBe(0);
    expect(store.rows.get(store.key(ATTACHMENT_ID, USER_ID))!.status).toBe('generating');
  });

  it('is reported to a polling client as a failure, with the reason', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    const store = makeStore();
    seed(store, { status: 'queued', updated_at: isoAgo(NARRATION_STALE_AFTER_MS + 1000) });

    const result = await getNarrationBundle(makeService(store), {
      noteId: NOTE_ID,
      attachmentId: ATTACHMENT_ID,
      userId: USER_ID,
    });

    if (!result.available) throw new Error('expected an available bundle');
    expect(result.bundle?.status).toBe('failed');
    expect(result.bundle?.errorMessage).toBe(NARRATION_STALLED_MESSAGE);

    // And on the wire, so a player stops polling instead of spinning forever.
    const payload = narrationApiPayload(ATTACHMENT_ID, result.bundle);
    expect(payload.status).toBe('failed');
    expect(payload.reason).toBe('unreadable');
    expect(payload.errorMessage).toBe(NARRATION_STALLED_MESSAGE);
  });

  it('cannot be retired twice: a second request that saw the same dead row reuses the new run', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    const store = makeStore();
    const service = makeService(store);
    seed(store, { status: 'generating', updated_at: isoAgo(NARRATION_STALE_AFTER_MS + 60_000) });

    // Both requests read the dead row before either wrote anything.
    const seenByA = (await getNarrationScript(service, ATTACHMENT_ID, USER_ID)).script;
    const seenByB = (await getNarrationScript(service, ATTACHMENT_ID, USER_ID)).script;

    // A retires it, claims the retry and is charged for version 2.
    const aView = await expireStalledNarration(service, seenByA, { userId: USER_ID }, NOW);
    const aClaim = await claimNarrationRun(service, {
      attachmentId: ATTACHMENT_ID,
      userId: USER_ID,
      previous: aView,
      pageCount: 6,
      creditCost: 2,
    });
    expect(aClaim.claimed).toBe(true);
    expect(store.rows.get(store.key(ATTACHMENT_ID, USER_ID))!.status).toBe('queued');

    // B's retirement lands AFTER A's claim. It must not touch A's live run,
    // and B's own claim must then lose to it.
    const bView = await expireStalledNarration(service, seenByB, { userId: USER_ID }, NOW);
    const row = store.rows.get(store.key(ATTACHMENT_ID, USER_ID))!;
    expect(row.status).toBe('queued');
    expect(row.version).toBe(2);
    const bClaim = await claimNarrationRun(service, {
      attachmentId: ATTACHMENT_ID,
      userId: USER_ID,
      previous: bView,
      pageCount: 6,
      creditCost: 2,
    });
    expect(bClaim.claimed).toBe(false);
    expect(store.rows.get(store.key(ATTACHMENT_ID, USER_ID))!.status).toBe('queued');
  });

  it('is kept alive by a heartbeat after every batch, guarded on its own version', async () => {
    const store = makeStore();
    chatMock.mockResolvedValueOnce(reply([0, 1, 2, 3])).mockResolvedValueOnce(reply([4, 5]));
    chatMock.mockResolvedValueOnce(reply([0, 1, 2, 3, 4, 5]));
    await buildNarrationScript(makeService(store), {
      noteId: NOTE_ID,
      attachmentId: ATTACHMENT_ID,
      userId: USER_ID,
      version: 3,
      creditCost: 2,
    });
    const heartbeats = store.writes.filter(
      (write) =>
        write.op === 'update' &&
        Object.keys(write.payload).join() === 'updated_at' &&
        write.filters.status === 'generating'
    );
    // Six pages → two batches → two touches, each refusing to revive any
    // other version's row.
    expect(heartbeats).toHaveLength(2);
    for (const beat of heartbeats) expect(beat.filters.version).toBe('3');
  });
});
