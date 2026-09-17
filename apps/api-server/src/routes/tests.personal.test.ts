/**
 * POST /tests/personal — the missing half of "save this quiz".
 *
 * A quiz generated from a note had nowhere to be stored: POST /tests treats any
 * payload carrying questions as a COMPLETED attempt, so the quiz landed in
 * History (or nowhere) and "Available Tests" stayed empty. This route writes
 * the shape that list reads: questions present, no end_time, in_progress.
 */

/** Stands in for the api_idempotency_keys table: one key -> one stored response. */
const idempotencyStore = new Map<string, unknown>();

jest.mock('../services/idempotency', () => ({
  normalizeIdempotencyKey: (header: string | undefined, fallback?: string) =>
    (Array.isArray(header) ? header[0] : header) || fallback || null,
  withIdempotency: async (
    _client: unknown,
    userId: string,
    op: string,
    key: string | null,
    fn: () => Promise<unknown>,
  ) => {
    if (!key) return fn();
    const storeKey = `${userId}:${op}:${key}`;
    if (idempotencyStore.has(storeKey)) return idempotencyStore.get(storeKey);
    const result = await fn();
    idempotencyStore.set(storeKey, result);
    return result;
  },
}));

/** The job record store lives in Redis; the route only ever adds a pointer. */
const stampedRefs: Array<{ jobId: string; ref: unknown }> = [];
let stampThrows = false;

jest.mock('../queue/jobStatus', () => ({
  attachJobResultRef: async (jobId: string, ref: unknown) => {
    stampedRefs.push({ jobId, ref });
    if (stampThrows) throw new Error('redis down');
    return null;
  },
}));

import { setIdempotencyClient } from '../middleware/idempotency';
import router, {
  initializeTestRoutes,
  normalizePersonalTestQuestions,
} from './tests';
import { stubDataLayer } from '../services/data/testStub';

// The stubbed withIdempotency above never touches it, but the middleware
// resolves the client before calling through.
setIdempotencyClient(() => ({}) as any);

beforeEach(() => {
  idempotencyStore.clear();
  stampedRefs.length = 0;
  stampThrows = false;
});

async function runRoute(path: string, req: any) {
  const layer = (router as any).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.post,
  );
  if (!layer) throw new Error(`route POST ${path} not found`);
  const handlers = layer.route.stack.map((s: any) => s.handle);

  const res: any = { statusCode: 200, body: undefined };
  await new Promise<void>((resolve, reject) => {
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.json = (body: unknown) => {
      res.body = body;
      resolve();
      return res;
    };
    // Index 0 is authMiddleware; req.user is supplied directly.
    let index = 1;
    const next = (err?: unknown) => {
      if (err) return reject(err);
      const handler = handlers[index++];
      if (!handler) return reject(new Error('route never responded'));
      try {
        const out = handler(req, res, next);
        if (out && typeof out.catch === 'function') out.catch(reject);
      } catch (thrown) {
        reject(thrown);
      }
    };
    next();
    setTimeout(() => reject(new Error('route never responded')), 2000).unref?.();
  });
  return res;
}

const question = (n: number) => ({
  question: `Question ${n}`,
  type: 'multiple_choice_single',
  options: ['a', 'b'],
  correctAnswer: 'a',
});

function initWith(createPersonalTest: jest.Mock) {
  const supabase: any = {
    createPersonalTest,
    mapTestSessionRowToClient: (row: any) => ({ id: row.id, title: row.title, status: row.status }),
  };
  const cache: any = { get: async () => null, set: async () => {}, delete: async () => {}, deletePattern: async () => {} };
  initializeTestRoutes(stubDataLayer(supabase) as any, cache);
  return supabase;
}

const request = (body: any) => ({ user: { id: 'user-1' }, body, query: {}, params: {}, headers: {} });

const okRow = {
  id: 'test-1',
  title: "Today's quiz · SDOH",
  status: 'in_progress',
  end_time: null,
};

describe('normalizePersonalTestQuestions', () => {
  it('refuses an empty set — an empty test is the same dead end as an empty deck', () => {
    const result = normalizePersonalTestQuestions([]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('EMPTY_QUESTIONS');
  });

  it('names the question that has no prompt', () => {
    const result = normalizePersonalTestQuestions([question(1), { options: ['a'] }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection).toMatchObject({ code: 'INVALID_QUESTION', index: 1 });
  });

  it('accepts text/prompt as the question body and fills in a stable id', () => {
    const result = normalizePersonalTestQuestions([{ text: 'From the note' }, { prompt: 'Second' }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.questions.map((q) => q.id)).toEqual(['q1', 'q2']);
    expect(result.questions[0].question).toBe('From the note');
  });

  it('keeps an id the caller already assigned — answers are keyed by it', () => {
    const result = normalizePersonalTestQuestions([{ id: 'note-q-9', question: 'Keep me' }]);
    if (!result.ok) throw new Error('expected valid');
    expect(result.questions[0].id).toBe('note-q-9');
  });
});

describe('POST /tests/personal', () => {
  it('saves a launchable test and returns it', async () => {
    const createPersonalTest = jest.fn(async () => okRow);
    initWith(createPersonalTest);

    const res = await runRoute(
      '/personal',
      request({
        title: "Today's quiz · SDOH",
        sourceNoteId: 'note-1',
        questions: [question(1), question(2)],
      }),
    );

    expect(res.statusCode).toBe(201);
    expect(res.body.data).toMatchObject({ id: 'test-1', status: 'in_progress' });
    expect(createPersonalTest).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Today's quiz · SDOH",
        sourceNoteId: 'note-1',
        questions: expect.arrayContaining([expect.objectContaining({ id: 'q1' })]),
      }),
      'user-1',
    );
  });

  it('rejects a titleless save', async () => {
    const createPersonalTest = jest.fn();
    initWith(createPersonalTest);

    const res = await runRoute('/personal', request({ title: '  ', questions: [question(1)] }));

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: 'INVALID_TITLE', retryable: false });
    expect(createPersonalTest).not.toHaveBeenCalled();
  });

  it('rejects an empty question set before writing anything', async () => {
    const createPersonalTest = jest.fn();
    initWith(createPersonalTest);

    const res = await runRoute('/personal', request({ title: 'Quiz', questions: [] }));

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: 'EMPTY_QUESTIONS', retryable: false });
    expect(createPersonalTest).not.toHaveBeenCalled();
  });

  it('replays the first test on a retry with the same clientKey instead of creating a second', async () => {
    const createPersonalTest = jest.fn(async () => okRow);
    initWith(createPersonalTest);
    const body = { clientKey: 'job_1', title: 'Quiz', questions: [question(1)] };

    const first = await runRoute('/personal', request(body));
    const second = await runRoute('/personal', request(body));

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.body.data).toEqual(first.body.data);
    expect(createPersonalTest).toHaveBeenCalledTimes(1);
  });

  it('stamps the saved test onto the job that generated it', async () => {
    // Until this landed the job record only knew it had made "a quiz", so its
    // notification could offer nothing better than lanternstudy://jobs/<id>.
    const createPersonalTest = jest.fn(async () => okRow);
    initWith(createPersonalTest);

    const res = await runRoute(
      '/personal',
      request({
        title: 'Quiz',
        sourceJobId: 'srv-job-9',
        questions: [question(1)],
      }),
    );

    expect(res.statusCode).toBe(201);
    expect(stampedRefs).toEqual([
      { jobId: 'srv-job-9', ref: { type: 'test', id: 'test-1', route: '/tests/test-1' } },
    ]);
  });

  it('saves the test even when the job record cannot be stamped', async () => {
    stampThrows = true;
    const createPersonalTest = jest.fn(async () => okRow);
    initWith(createPersonalTest);

    const res = await runRoute(
      '/personal',
      request({ title: 'Quiz', sourceJobId: 'srv-job-9', questions: [question(1)] }),
    );

    expect(res.statusCode).toBe(201);
    expect(res.body.data).toMatchObject({ id: 'test-1' });
  });

  it('stamps nothing when the save did not come from a job', async () => {
    const createPersonalTest = jest.fn(async () => okRow);
    initWith(createPersonalTest);
    await runRoute('/personal', request({ title: 'Quiz', questions: [question(1)] }));
    expect(stampedRefs).toEqual([]);
  });

  it('falls back to the generating job id as the key when no clientKey is sent', async () => {
    const createPersonalTest = jest.fn(async () => okRow);
    initWith(createPersonalTest);
    const body = { sourceJobId: 'srv-job-9', title: 'Quiz', questions: [question(1)] };

    await runRoute('/personal', request(body));
    await runRoute('/personal', request(body));

    expect(createPersonalTest).toHaveBeenCalledTimes(1);
  });
});
