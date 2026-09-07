/**
 * The job record is what a student sees while their work is queued, and the
 * ledger that decides whether they get their credit back. These tests pin the
 * two promises that matter: progress only ever moves forwards, and a job that
 * failed or timed out refunds exactly once — never twice, never zero times.
 */
import { JOB_STALE_TIMEOUT_MS } from '@lantern/shared/jobs/jobState';

const store = new Map<string, string>();
const refunds: Array<{ userId: string; credits: number; featureKey?: string }> = [];

jest.mock('../services/redisStore', () => ({
  redisKey: (suffix: string) => `test:${suffix}`,
  getRedisClient: async () => ({
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async set(key: string, value: string, opts?: { NX?: boolean }) {
      if (opts?.NX && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    },
  }),
}));

const pushes: Array<{ id: string; stage: string; sourceTitle?: string }> = [];
let pushThrows = false;

jest.mock('../services/jobPush', () => ({
  notifyJobTerminal: async (job: { id: string; stage: string; sourceTitle?: string }) => {
    pushes.push({ id: job.id, stage: job.stage, sourceTitle: job.sourceTitle });
    if (pushThrows) throw new Error('expo exploded');
    return 'sent';
  },
}));

jest.mock('../middleware/aiRateLimit', () => ({
  refundAiCredits: async (userId: string, credits: number) => {
    refunds.push({ userId, credits });
  },
  refundFeatureAiCredit: async (userId: string, featureKey: string) => {
    refunds.push({ userId, credits: 1, featureKey });
  },
}));

import {
  createJobRecord,
  getJobRecord,
  reconcileJobTimeout,
  refundJobCreditOnce,
  saveJobRecord,
  setJobStage,
  updateJobStatus,
} from './jobStatus';

async function newJob(id: string, credits = 1) {
  return createJobRecord({
    id,
    queue: 'ai-generation',
    name: 'ai.generate.flashcards',
    userId: 'user-1',
    charge: credits > 0 ? { credits } : undefined,
  });
}

beforeEach(() => {
  store.clear();
  refunds.length = 0;
  pushes.length = 0;
  pushThrows = false;
});

describe('job record lifecycle', () => {
  it('starts queued with the kind derived and the credit ledger open', async () => {
    const record = await newJob('job-a');
    expect(record.kind).toBe('flashcards');
    expect(record.stage).toBe('queued');
    expect(record.status).toBe('queued');
    expect(record.percent).toBe(0);
    expect(record.credit).toEqual({ charged: 1, refunded: 0, featureKey: undefined });
  });

  it('walks reading → generating → saving → done and records where the work landed', async () => {
    await newJob('job-b');
    const reading = await setJobStage('job-b', 'reading');
    expect(reading?.stage).toBe('reading');
    expect(reading?.startedAt).toBeTruthy();

    await setJobStage('job-b', 'generating', { percent: 60 });
    await setJobStage('job-b', 'saving');
    const done = await setJobStage('job-b', 'done', {
      result: { flashcards: ['a'] },
      resultRef: { type: 'deck', id: 'deck-1', route: '/flashcards/deck-1' },
    });

    expect(done?.stage).toBe('done');
    expect(done?.percent).toBe(100);
    expect(done?.status).toBe('completed');
    expect(done?.finishedAt).toBeTruthy();
    expect(done?.resultRef?.route).toBe('/flashcards/deck-1');
    expect(refunds).toHaveLength(0);
  });

  it('keeps percent monotonic across writers', async () => {
    await newJob('job-c');
    await setJobStage('job-c', 'generating', { percent: 70 });
    const back = await setJobStage('job-c', 'generating', { percent: 10 });
    expect(back?.percent).toBe(70);
  });

  it('refuses to move a finished job (a late retry cannot un-finish it)', async () => {
    await newJob('job-d');
    await setJobStage('job-d', 'done', { result: 'ok' });
    await setJobStage('job-d', 'failed', {
      error: { code: 'LATE', message: 'too late', retryable: true },
    });
    const record = await getJobRecord('job-d');
    expect(record?.stage).toBe('done');
    expect(record?.result).toBe('ok');
  });

  it('keeps the legacy status entry point working', async () => {
    await newJob('job-e');
    await updateJobStatus('job-e', 'active');
    expect((await getJobRecord('job-e'))?.stage).toBe('generating');
    await updateJobStatus('job-e', 'failed', { error: 'provider exploded' });
    const record = await getJobRecord('job-e');
    expect(record?.stage).toBe('failed');
    expect(record?.error).toEqual({
      code: 'JOB_FAILED',
      message: 'provider exploded',
      retryable: true,
    });
  });
});

describe('credit refunds', () => {
  it('refunds a failed job exactly once, however many times it is asked', async () => {
    await newJob('job-f', 2);
    await setJobStage('job-f', 'failed', {
      error: { code: 'AI_DOWN', message: 'provider down', retryable: true },
    });

    expect(await refundJobCreditOnce(await getJobRecord('job-f'))).toBe(true);
    expect(await refundJobCreditOnce(await getJobRecord('job-f'))).toBe(false);
    expect(await refundJobCreditOnce(await getJobRecord('job-f'))).toBe(false);

    expect(refunds).toEqual([{ userId: 'user-1', credits: 2 }]);
    const record = await getJobRecord('job-f');
    expect(record?.credit).toEqual({ charged: 2, refunded: 2, featureKey: undefined });
    expect(record?.chargeRefunded).toBe(true);
  });

  it('never refunds a job that was never charged', async () => {
    await newJob('job-g', 0);
    expect(await refundJobCreditOnce(await getJobRecord('job-g'))).toBe(false);
    expect(refunds).toHaveLength(0);
  });

  it('refunds the feature quota when the charge carried a feature key', async () => {
    await createJobRecord({
      id: 'job-h',
      queue: 'ai-generation',
      name: 'notes.ai.summarize',
      userId: 'user-1',
      charge: { credits: 1, featureKey: 'smart_notes' },
    });
    await setJobStage('job-h', 'failed', {
      error: { code: 'AI_DOWN', message: 'down', retryable: true },
    });
    await refundJobCreditOnce(await getJobRecord('job-h'));
    expect(refunds).toEqual([{ userId: 'user-1', credits: 1, featureKey: 'smart_notes' }]);
  });
});

describe('stale jobs time out', () => {
  it('reports a stuck job as timed_out and refunds it once', async () => {
    const created = await newJob('job-i');
    await setJobStage('job-i', 'generating');

    const later = Date.parse(created.createdAt) + JOB_STALE_TIMEOUT_MS + 1000;
    const first = await reconcileJobTimeout(await getJobRecord('job-i'), later);
    expect(first?.stage).toBe('timed_out');
    expect(first?.status).toBe('failed');
    expect(first?.percent).toBe(100);
    expect(first?.error?.code).toBe('JOB_TIMED_OUT');
    expect(first?.error?.retryable).toBe(true);
    expect(first?.credit).toEqual({ charged: 1, refunded: 1, featureKey: undefined });

    // Polled again a minute later: still timed out, still one refund.
    const second = await reconcileJobTimeout(await getJobRecord('job-i'), later + 60_000);
    expect(second?.stage).toBe('timed_out');
    expect(refunds).toEqual([{ userId: 'user-1', credits: 1 }]);
  });

  it('leaves a job inside the window alone', async () => {
    const created = await newJob('job-j');
    await setJobStage('job-j', 'generating');
    const soon = Date.parse(created.createdAt) + JOB_STALE_TIMEOUT_MS - 1000;
    const record = await reconcileJobTimeout(await getJobRecord('job-j'), soon);
    expect(record?.stage).toBe('generating');
    expect(refunds).toHaveLength(0);
  });

  it('never times out a job that already finished', async () => {
    await newJob('job-k');
    await setJobStage('job-k', 'done', { result: 'ok' });
    const record = await reconcileJobTimeout(
      await getJobRecord('job-k'),
      Date.now() + JOB_STALE_TIMEOUT_MS * 10
    );
    expect(record?.stage).toBe('done');
    expect(refunds).toHaveLength(0);
  });
});

describe('records written by an older deploy', () => {
  it('reads a status-only record into the stage model', async () => {
    store.set(
      'test:job:legacy-1',
      JSON.stringify({
        id: 'legacy-1',
        queue: 'ai-generation',
        name: 'notes.ai.quiz',
        status: 'failed',
        error: 'it broke',
        userId: 'user-1',
        charge: { credits: 1 },
        createdAt: '2026-09-06T10:00:00.000Z',
        updatedAt: '2026-09-06T10:00:00.000Z',
      })
    );
    const record = await getJobRecord('legacy-1');
    expect(record?.stage).toBe('failed');
    expect(record?.kind).toBe('quiz');
    expect(record?.percent).toBe(100);
    expect(record?.error?.message).toBe('it broke');
    expect(record?.credit).toEqual({ charged: 1, refunded: 0, featureKey: undefined });
  });

  it('does not re-refund a legacy record that was already refunded', async () => {
    store.set(
      'test:job:legacy-2',
      JSON.stringify({
        id: 'legacy-2',
        queue: 'ai-generation',
        name: 'ai.generate.flashcards',
        status: 'failed',
        error: 'it broke',
        userId: 'user-1',
        charge: { credits: 1 },
        chargeRefunded: true,
        createdAt: '2026-09-06T10:00:00.000Z',
        updatedAt: '2026-09-06T10:00:00.000Z',
      })
    );
    expect(await refundJobCreditOnce(await getJobRecord('legacy-2'))).toBe(false);
    expect(refunds).toHaveLength(0);
  });
});

describe('saveJobRecord', () => {
  it('round-trips a record', async () => {
    const record = await newJob('job-l');
    await saveJobRecord({ ...record, percent: 42, stage: 'generating', status: 'active' });
    const read = await getJobRecord('job-l');
    expect(read?.percent).toBe(42);
    expect(read?.stage).toBe('generating');
  });
});


/**
 * The client poller does not run while the app is backgrounded, so the server's
 * terminal transition is the only thing that can tell a student their work
 * landed. These pin that it fires on every terminal end, exactly once, and that
 * it can never take the job down with it.
 */
describe('completion push', () => {
  it('announces a finished job once, with the source it came from', async () => {
    await createJobRecord({
      id: 'push-done',
      queue: 'ai-generation',
      name: 'ai.generate.flashcards',
      userId: 'user-1',
      sourceTitle: 'SDOH',
    });
    await setJobStage('push-done', 'generating');
    expect(pushes).toHaveLength(0);

    await setJobStage('push-done', 'done', { result: { flashcards: [1, 2] } });
    expect(pushes).toEqual([{ id: 'push-done', stage: 'done', sourceTitle: 'SDOH' }]);

    // A straggling attempt cannot re-announce a job that already finished.
    await setJobStage('push-done', 'failed');
    expect(pushes).toHaveLength(1);
  });

  it('announces a failure and a timeout too', async () => {
    await newJob('push-failed');
    await setJobStage('push-failed', 'failed', {
      error: { code: 'JOB_FAILED', message: 'nope', retryable: false },
    });
    expect(pushes.map((p) => p.stage)).toEqual(['failed']);

    pushes.length = 0;
    const stale = await newJob('push-stale');
    await saveJobRecord({
      ...stale,
      stage: 'generating',
      status: 'active',
      updatedAt: new Date(Date.now() - JOB_STALE_TIMEOUT_MS - 1000).toISOString(),
    });
    await reconcileJobTimeout(await getJobRecord('push-stale'));
    expect(pushes.map((p) => p.stage)).toEqual(['timed_out']);
  });

  it('never lets the notification break the job record', async () => {
    pushThrows = true;
    await newJob('push-throws');
    await expect(setJobStage('push-throws', 'done', { result: {} })).resolves.toMatchObject({
      stage: 'done',
    });
    expect((await getJobRecord('push-throws'))?.stage).toBe('done');
  });
});
