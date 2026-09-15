/**
 * F7a: two halves of the same promise — a queued job that fails for a transient
 * reason is retried, and a queued job that is still working is not killed.
 *
 * 1. `enqueueJob` passes real `attempts`/`backoff`, so the retry-aware code
 *    downstream (`refundChargeOnFinalFailure`, `JobError.retryable`) stops being
 *    dead code: attempt 1 is no longer always final.
 * 2. `withJobHeartbeat` re-stamps the record's stage on an interval, and because
 *    `reconcileJobTimeout` measures SILENCE from `updatedAt`, that is what keeps
 *    a long study-pack generation from being timed out and refunded underneath a
 *    worker that is still running.
 */
import { JOB_STALE_TIMEOUT_MS, isJobStale } from '@lantern/shared/jobs/jobState';

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

jest.mock('../services/jobPush', () => ({ notifyJobTerminal: async () => 'skipped' }));
jest.mock('../middleware/aiRateLimit', () => ({
  refundAiCredits: async () => {},
  refundFeatureAiCredit: async () => {},
}));

import { retryOptionsForJob } from './enqueue';
import { createJobRecord, getJobRecord, setJobStage, reconcileJobTimeout } from './jobStatus';
import { withJobHeartbeat } from './processors';
import type { JobProgress } from './processors';

describe('queued job retries', () => {
  it('every job name carries a real attempts count and a backoff', () => {
    for (const name of [
      'ai.generate.questions',
      'ai.studyPack.generate',
      'notes.ai.narration',
      'deck.importApkg',
      'export.userData',
      'cron.studyReminders',
    ] as const) {
      const opts = retryOptionsForJob(name);
      expect(opts.attempts).toBeGreaterThanOrEqual(1);
      expect(opts.backoff.delay).toBeGreaterThanOrEqual(0);
      expect(['exponential', 'fixed']).toContain(opts.backoff.type);
    }
  });

  it('transient AI work retries, long generations retry once, crons do not retry', () => {
    expect(retryOptionsForJob('ai.generate.questions').attempts).toBe(3);
    expect(retryOptionsForJob('ai.generate.questions').backoff.type).toBe('exponential');
    // A study pack is a dozen model calls; a second full re-run costs more than
    // the failure does.
    expect(retryOptionsForJob('ai.studyPack.generate').attempts).toBe(2);
    // Crons come round again on their own schedule.
    expect(retryOptionsForJob('cron.studyReminders').attempts).toBe(1);
  });

  it('the AI backoff delay leaves room inside the stale window for the next attempt', () => {
    // A delay longer than the stale window would time the record out between
    // attempts, which is the bug this lane fixed, not a new one.
    expect(retryOptionsForJob('ai.generate.questions').backoff.delay).toBeLessThan(
      JOB_STALE_TIMEOUT_MS / 2
    );
  });
});

describe('long-job heartbeat', () => {
  function fakeJob(id: string) {
    const progressWrites: unknown[] = [];
    return {
      job: {
        id,
        async updateProgress(value: unknown) {
          progressWrites.push(value);
        },
      } as never,
      progressWrites,
    };
  }

  function progressFor(jobId: string): JobProgress {
    return {
      async stage(stage, percent) {
        await setJobStage(jobId, stage, { percent });
      },
      ref() {},
      resultRef: undefined,
    };
  }

  it('keeps a job alive past the stale window while the work is still running', async () => {
    const jobId = 'heartbeat-job';
    await createJobRecord({ id: jobId, queue: 'ai-generation', name: 'ai.studyPack.generate' });
    await setJobStage(jobId, 'generating');

    const { job, progressWrites } = fakeJob(jobId);

    // The work takes longer than the stale window would allow in real time; we
    // assert against a clock that has moved past it rather than sleeping.
    const finished = await withJobHeartbeat(
      job,
      progressFor(jobId),
      'generating',
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        return 'pack';
      },
      10,
    );
    expect(finished).toBe('pack');
    expect(progressWrites.length).toBeGreaterThan(0);

    const record = await getJobRecord(jobId);
    expect(record).not.toBeNull();
    // The heartbeat moved `updatedAt`, so a reconcile run one stale window after
    // the job STARTED no longer sees silence.
    const startedAt = Date.parse(record!.createdAt);
    expect(isJobStale(record as never, startedAt + JOB_STALE_TIMEOUT_MS + 1)).toBe(false);

    const reconciled = await reconcileJobTimeout(record, startedAt + JOB_STALE_TIMEOUT_MS + 1);
    expect(reconciled?.stage).toBe('generating');
  });

  it('without a heartbeat the same job is timed out and refunded', async () => {
    const jobId = 'silent-job';
    await createJobRecord({ id: jobId, queue: 'ai-generation', name: 'ai.studyPack.generate' });
    await setJobStage(jobId, 'generating');
    const record = await getJobRecord(jobId);
    const reconciled = await reconcileJobTimeout(
      record,
      Date.parse(record!.updatedAt) + JOB_STALE_TIMEOUT_MS + 1,
    );
    expect(reconciled?.stage).toBe('timed_out');
  });

  it('stops ticking once the work finishes', async () => {
    const jobId = 'heartbeat-stop';
    await createJobRecord({ id: jobId, queue: 'ai-generation', name: 'ai.studyPack.generate' });
    await setJobStage(jobId, 'generating');
    const { job, progressWrites } = fakeJob(jobId);
    await withJobHeartbeat(job, progressFor(jobId), 'generating', async () => 'done', 5);
    const afterRun = progressWrites.length;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(progressWrites.length).toBe(afterRun);
  });
});
