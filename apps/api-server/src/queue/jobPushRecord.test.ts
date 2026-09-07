/**
 * A student watched a quiz finish and no notification ever arrived, and the
 * job record could not say why. These pin the two writes that make delivery
 * checkable: the push audit lands ON the record, and a test the CLIENT saved
 * afterwards can still be stamped onto the job that generated it.
 */
import type { JobPushAudit } from '@lantern/shared/jobs/jobState';

const store = new Map<string, string>();

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

jest.mock('../middleware/aiRateLimit', () => ({
  refundAiCredits: jest.fn(async () => {}),
  refundFeatureAiCredit: jest.fn(async () => {}),
}));

/**
 * Stand in for the real sender, but exercise the contract that matters here:
 * whatever the queue hands as `recordPush` is what writes the audit.
 */
const audits: Array<{ jobId: string; push: JobPushAudit }> = [];
let nextAudit: JobPushAudit = { attemptedAt: '2026-09-05T10:00:00.000Z', skippedReason: 'no_token' };

jest.mock('../services/jobPush', () => ({
  notifyJobTerminal: async (
    job: { id: string },
    deps: { recordPush?: (jobId: string, push: JobPushAudit) => Promise<void> } = {},
  ) => {
    audits.push({ jobId: job.id, push: nextAudit });
    await deps.recordPush?.(job.id, nextAudit);
    return 'no_token';
  },
}));

import {
  attachJobResultRef,
  createJobRecord,
  getJobRecord,
  recordJobPushAudit,
  refundJobCreditOnce,
  setJobStage,
} from './jobStatus';

/** The fire-and-forget push runs after the terminal write returns. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

async function newQuizJob(id: string) {
  return createJobRecord({
    id,
    queue: 'ai-generation',
    name: 'notes.ai.quiz',
    userId: 'user-1',
    charge: { credits: 1, featureKey: 'generate_questions' },
    sourceTitle: 'SDOH',
  });
}

beforeEach(() => {
  store.clear();
  audits.length = 0;
  nextAudit = { attemptedAt: '2026-09-05T10:00:00.000Z', skippedReason: 'no_token' };
});

describe('push audit on the job record', () => {
  it('is written when the job goes terminal, and is readable afterwards', async () => {
    await newQuizJob('job-1');
    await setJobStage('job-1', 'generating');
    await setJobStage('job-1', 'done', { result: { questions: [{}, {}] } });
    await flush();

    const record = await getJobRecord('job-1');
    expect(record?.push).toEqual({
      attemptedAt: '2026-09-05T10:00:00.000Z',
      skippedReason: 'no_token',
    });
    // The generating note's title rides along, so the push can name it.
    expect(audits[0]).toMatchObject({ jobId: 'job-1' });
  });

  it('does not clobber a refund that landed while the push was in flight', async () => {
    // The push runs AFTER the terminal write, so the audit writer must re-read
    // the record: writing back a blob captured earlier would erase the refund
    // the failure path recorded in between.
    await newQuizJob('job-2');
    await setJobStage('job-2', 'failed', {
      error: { code: 'JOB_FAILED', message: 'nope', retryable: true },
    });
    await flush();

    await refundJobCreditOnce(await getJobRecord('job-2'));
    expect((await getJobRecord('job-2'))?.chargeRefunded).toBe(true);

    await recordJobPushAudit('job-2', {
      attemptedAt: '2026-09-05T10:00:01.000Z',
      skippedReason: 'prefs_off',
    });

    const after = await getJobRecord('job-2');
    expect(after?.chargeRefunded).toBe(true);
    expect(after?.credit).toEqual({ charged: 1, refunded: 1, featureKey: 'generate_questions' });
    expect(after?.error?.message).toBe('nope');
    expect(after?.push?.skippedReason).toBe('prefs_off');
  });

  it('is a no-op for a job that no longer exists', async () => {
    await expect(recordJobPushAudit('gone', { attemptedAt: 'x' })).resolves.toBeUndefined();
    expect(await getJobRecord('gone')).toBeNull();
  });
});

describe('attachJobResultRef', () => {
  it('points a finished quiz job at the test the app saved from it', async () => {
    await newQuizJob('job-3');
    await setJobStage('job-3', 'done', { resultRef: { type: 'quiz', id: 'note-1' } });
    await flush();

    const updated = await attachJobResultRef('job-3', {
      type: 'test',
      id: 'test-9',
      route: '/tests/test-9',
    });
    expect(updated?.resultRef).toEqual({ type: 'test', id: 'test-9', route: '/tests/test-9' });
    // Stage, error and the credit ledger are untouched — this only adds a pointer.
    expect(updated?.stage).toBe('done');
    expect(updated?.credit).toEqual({ charged: 1, refunded: 0, featureKey: 'generate_questions' });
    expect((await getJobRecord('job-3'))?.resultRef?.id).toBe('test-9');
  });

  it('lets the first saved test win, so a retry cannot repoint the job', async () => {
    await newQuizJob('job-4');
    await setJobStage('job-4', 'done');
    await flush();
    await attachJobResultRef('job-4', { type: 'test', id: 'test-first' });
    await attachJobResultRef('job-4', { type: 'test', id: 'test-second' });
    expect((await getJobRecord('job-4'))?.resultRef?.id).toBe('test-first');
  });

  it('ignores an unknown job or an id-less ref', async () => {
    await expect(attachJobResultRef('missing', { type: 'test', id: 't' })).resolves.toBeNull();
    await newQuizJob('job-5');
    await expect(attachJobResultRef('job-5', { type: 'test', id: '' })).resolves.toBeNull();
  });
});
