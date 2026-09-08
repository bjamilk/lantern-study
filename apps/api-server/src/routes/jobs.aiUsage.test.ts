/**
 * GET /api/v1/jobs/:jobId carries the caller's live AI counters.
 *
 * A queued run is accepted with 202 — a 2xx — so the accept publishes the
 * CHARGED numbers and the rate limiter's non-2xx auto-refund never fires. The
 * worker refunds a job that failed before any model answered, but until this
 * header existed nothing ever told the client: the badge kept ticking down for
 * work that produced nothing, which is the opposite of what the Usage & limits
 * screen promises. The poll that learns the job failed is the one moment the
 * corrected counters can reach the phone.
 */
const records = new Map<string, any>();

jest.mock('../queue/jobStatus', () => ({
  getJobRecord: async (jobId: string) => records.get(jobId) ?? null,
  reconcileJobTimeout: async (record: any) => record,
}));

jest.mock('../utils/platformAdminAuth', () => ({
  isLivePlatformAdmin: async () => false,
}));

const usage = { used: 0, limit: 100, resetsAt: '2026-09-08T00:00:00.000Z' };
jest.mock('../middleware/aiRateLimit', () => ({
  applyGlobalUsageHeaders: async (res: any) => {
    res.setHeader('X-AI-Global-Usage-Used', String(usage.used));
    res.setHeader('X-AI-Global-Usage-Limit', String(usage.limit));
    res.setHeader('X-AI-Global-Usage-Resets-At', usage.resetsAt);
  },
}));

import router from './jobs';

async function poll(jobId: string, userId: string) {
  const layer = (router as any).stack.find((l: any) => l.route?.methods?.get);
  const handlers = layer.route.stack.map((s: any) => s.handle);
  const req: any = { user: { id: userId }, params: { jobId }, query: {}, body: {}, headers: {} };
  const res: any = { statusCode: 200, body: undefined, headers: {} };

  await new Promise<void>((resolve, reject) => {
    res.setHeader = (name: string, value: string) => {
      res.headers[name.toLowerCase()] = value;
      return res;
    };
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.json = (body: unknown) => {
      res.body = body;
      resolve();
      return res;
    };
    let index = 1; // index 0 is authMiddleware
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

beforeEach(() => {
  records.clear();
  usage.used = 0;
});

it('reports the refunded counters on the poll that says the job failed', async () => {
  records.set('job-1', {
    id: 'job-1',
    userId: 'owner',
    stage: 'failed',
    status: 'failed',
    error: {
      code: 'JOB_FAILED',
      message: 'AI is temporarily unavailable. Please try again in a moment.',
      retryable: true,
    },
    credit: { charged: 1, refunded: 1, featureKey: 'generate_flashcards' },
  });
  // The worker has already handed the credit back, so the counter reads zero.
  usage.used = 0;

  const res = await poll('job-1', 'owner');

  expect(res.headers['x-ai-global-usage-used']).toBe('0');
  expect(res.headers['x-ai-global-usage-limit']).toBe('100');
  expect(res.body.data.credit).toEqual({
    charged: 1,
    refunded: 1,
    featureKey: 'generate_flashcards',
  });
});

it('reports the charge as it stands while the job is still running', async () => {
  records.set('job-2', { id: 'job-2', userId: 'owner', stage: 'generating', status: 'processing' });
  usage.used = 1;

  const res = await poll('job-2', 'owner');

  expect(res.headers['x-ai-global-usage-used']).toBe('1');
});

it('never rewrites an admin’s own badge from someone else’s job', async () => {
  records.set('job-3', { id: 'job-3', userId: 'someone-else', stage: 'failed', status: 'failed' });

  const res = await poll('job-3', 'admin-reader');

  // A stranger is refused outright; the point here is that no counter of the
  // reader's ever rides on a record that is not theirs.
  expect(res.headers['x-ai-global-usage-used']).toBeUndefined();
});
