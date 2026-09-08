/**
 * A queued AI run that dies before any model answers must cost nothing.
 *
 * The sync path has been safe for a while: anything that does not finish 2xx is
 * refunded by the middleware itself. The QUEUED path is the one that bit
 * students in production. BullMQ is on there, so `POST /ai/generate-flashcards`
 * answers **202** — a 2xx — and the middleware's auto-refund can never fire.
 * The credits ride on the job record instead, and the worker hands them back
 * when the job permanently fails.
 *
 * These tests run the REAL rate-limit middleware against a REAL job record on a
 * fake Redis, so they pin the whole round trip: charge → 202 → provider
 * unavailable → refund, on BOTH counters (the global allowance and the
 * per-feature cap). Asserting only the global half is how a feature cap quietly
 * drains: the daily badge looks honest while "15 flashcard runs a day" burns
 * down on failures.
 */
import { AI_FEATURE_CREDIT_COST } from '@lantern/shared/utils/aiCredits';

/** Enough of node-redis for the quota keys and the job record. */
const store = new Map<string, string>();

jest.mock('../services/redisStore', () => ({
  redisKey: (suffix: string) => `test:${suffix}`,
  getRedisClient: async () => ({
    isOpen: true,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async set(key: string, value: string, opts?: { NX?: boolean }) {
      if (opts?.NX && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    },
    async del(key: string) {
      store.delete(key);
      return 1;
    },
    async incrBy(key: string, by: number) {
      const next = Number(store.get(key) ?? '0') + by;
      store.set(key, String(next));
      return next;
    },
    async ttl() {
      return 60;
    },
    async expire() {
      return 1;
    },
  }),
}));

jest.mock('../services/jobPush', () => ({
  notifyJobTerminal: async () => 'skipped',
}));

import {
  aiRateLimitForFeature,
  getAIUsage,
  getFeatureAIUsage,
  resetAIUsageForUser,
} from '../middleware/aiRateLimit';
import { createJobRecord, getJobRecord, refundJobCreditOnce, setJobStage } from './jobStatus';

const USER = 'user-queued-refund';
const FEATURE = 'generate_flashcards';

/** The parts of an Express response these middlewares actually touch. */
function mockRes() {
  return {
    headers: {} as Record<string, string>,
    locals: {} as Record<string, unknown>,
    listeners: {} as Record<string, Array<() => void>>,
    statusCode: 200,
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
    },
    on(event: string, cb: () => void) {
      (this.listeners[event] ||= []).push(cb);
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json() {
      return this;
    },
    /** Express emitting 'finish' once the response is flushed. */
    async finish(code: number) {
      this.statusCode = code;
      for (const cb of this.listeners.finish || []) cb();
      await new Promise((resolve) => setTimeout(resolve, 20));
    },
  };
}

async function charge(res: ReturnType<typeof mockRes>) {
  const req = { user: { id: USER }, body: {} } as any;
  await new Promise<void>((resolve, reject) => {
    aiRateLimitForFeature(FEATURE)(req, res as any, (err?: unknown) =>
      err ? reject(err) : resolve()
    );
  });
}

async function counters() {
  return {
    global: (await getAIUsage(USER)).used,
    feature: (await getFeatureAIUsage(USER, FEATURE)).used,
  };
}

beforeEach(async () => {
  store.clear();
  await resetAIUsageForUser(USER);
});

describe('a queued AI run that fails before any model answers', () => {
  it('refunds the global allowance AND the feature cap', async () => {
    const res = mockRes();
    await charge(res);
    expect(await counters()).toEqual({ global: 1, feature: 1 });

    // The handler hands the work to BullMQ and answers 202 with the charge
    // stamped on the job record.
    const stamped = res.locals.aiCharge as { credits: number; featureKey?: string };
    expect(stamped).toEqual({ credits: AI_FEATURE_CREDIT_COST, featureKey: FEATURE, pool: 'daily' });
    await createJobRecord({
      id: 'job-flashcards',
      queue: 'ai-generation',
      name: 'ai.generate.flashcards',
      userId: USER,
      charge: stamped,
    });
    await res.finish(202);

    // 202 is a 2xx: nothing is refunded yet, and that is correct — the work is
    // still running.
    expect(await counters()).toEqual({ global: 1, feature: 1 });

    // Every provider is down. The worker marks the job failed and refunds.
    await setJobStage('job-flashcards', 'failed', {
      error: {
        code: 'JOB_FAILED',
        message: 'AI is temporarily unavailable. Please try again in a moment.',
        retryable: true,
      },
    });
    expect(await refundJobCreditOnce(await getJobRecord('job-flashcards'))).toBe(true);

    expect(await counters()).toEqual({ global: 0, feature: 0 });
  });

  it('refunds the whole reserved amount, not a hard-coded single credit', async () => {
    const res = mockRes();
    await charge(res);
    // A feature route that reserved three credits: the feature CAP still moved
    // one step (it is a cap, not a currency), but the allowance took three.
    await createJobRecord({
      id: 'job-multi',
      queue: 'ai-generation',
      name: 'ai.generate.flashcards',
      userId: USER,
      charge: { credits: 3, featureKey: FEATURE, pool: 'daily' },
    });
    // Two extra credits, as such a route would have taken.
    store.set(
      `test:ai:${new Date().toISOString().slice(0, 10)}:${USER}`,
      '3'
    );

    await refundJobCreditOnce(await getJobRecord('job-multi'));

    expect(await counters()).toEqual({ global: 0, feature: 0 });
  });

  it('refunds once, however many times the failure is reported', async () => {
    const res = mockRes();
    await charge(res);
    await createJobRecord({
      id: 'job-twice',
      queue: 'ai-generation',
      name: 'ai.generate.flashcards',
      userId: USER,
      charge: res.locals.aiCharge as { credits: number; featureKey?: string },
    });

    expect(await refundJobCreditOnce(await getJobRecord('job-twice'))).toBe(true);
    // The worker's catch and the queue's `failed` hook both fire for a stalled
    // job. A second refund would MINT an AI use.
    expect(await refundJobCreditOnce(await getJobRecord('job-twice'))).toBe(false);

    expect(await counters()).toEqual({ global: 0, feature: 0 });
  });

  it('keeps the charge when the job succeeds', async () => {
    const res = mockRes();
    await charge(res);
    await createJobRecord({
      id: 'job-done',
      queue: 'ai-generation',
      name: 'ai.generate.flashcards',
      userId: USER,
      charge: res.locals.aiCharge as { credits: number; featureKey?: string },
    });
    await setJobStage('job-done', 'done', { result: { flashcards: [] } });
    await res.finish(202);

    expect(await counters()).toEqual({ global: 1, feature: 1 });
  });
});
