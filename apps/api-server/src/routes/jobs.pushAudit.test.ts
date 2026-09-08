/**
 * GET /api/v1/jobs/:jobId — the record a waiting student polls.
 *
 * It now carries `push`: what the server did about the completion
 * notification. That names the owner's device registration and their
 * notification preferences, so it goes to the owner and to nobody else — not
 * even to a platform admin, who can still read the rest of the record.
 */
const records = new Map<string, any>();

jest.mock('../queue/jobStatus', () => ({
  getJobRecord: async (jobId: string) => records.get(jobId) ?? null,
  reconcileJobTimeout: async (record: any) => record,
}));

let admin = false;
jest.mock('../utils/platformAdminAuth', () => ({
  isLivePlatformAdmin: async () => admin,
}));

import router from './jobs';

const PUSH = {
  attemptedAt: '2026-09-05T10:00:00.000Z',
  skippedReason: 'no_token' as const,
  tokenCount: 0,
  url: 'lanternstudy://test/test-9',
};

async function runRoute(jobId: string, userId: string) {
  const layer = (router as any).stack.find((l: any) => l.route?.methods?.get);
  const handlers = layer.route.stack.map((s: any) => s.handle);
  const req: any = { user: { id: userId }, params: { jobId }, query: {}, body: {}, headers: {} };

  const res: any = { statusCode: 200, body: undefined, headers: {} };
  await new Promise<void>((resolve, reject) => {
    // The route stamps the caller's live AI counters on every poll.
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
  admin = false;
  records.set('job-1', {
    id: 'job-1',
    userId: 'owner',
    kind: 'quiz',
    stage: 'done',
    percent: 100,
    resultRef: { type: 'test', id: 'test-9' },
    push: PUSH,
  });
});

describe('GET /jobs/:jobId push audit', () => {
  it('tells the owner exactly what happened to their notification', async () => {
    const res = await runRoute('job-1', 'owner');
    expect(res.statusCode).toBe(200);
    expect(res.body.data.push).toEqual(PUSH);
    // The rest of the record is unchanged.
    expect(res.body.data).toMatchObject({
      stage: 'done',
      resultRef: { type: 'test', id: 'test-9' },
    });
  });

  it('withholds it from a platform admin reading someone else’s job', async () => {
    admin = true;
    const res = await runRoute('job-1', 'someone-else');
    expect(res.statusCode).toBe(200);
    expect(res.body.data.push).toBeUndefined();
    expect(res.body.data.stage).toBe('done');
  });

  it('still refuses a stranger outright', async () => {
    const res = await runRoute('job-1', 'stranger');
    expect(res.statusCode).toBe(403);
  });

  it('omits the key entirely for a job that was never pushed', async () => {
    records.set('job-2', { id: 'job-2', userId: 'owner', kind: 'quiz', stage: 'queued', percent: 0 });
    const res = await runRoute('job-2', 'owner');
    expect('push' in res.body.data).toBe(false);
  });
});
