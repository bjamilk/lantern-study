import { createJobClient, normalizeJobRecord, type JobFetch, type JobProgress } from './jobClient';
import type { JobRecordView } from './jobState';

function jobBody(over: Partial<JobRecordView> = {}) {
  return {
    success: true,
    data: {
      id: 'job-1',
      kind: 'flashcards',
      name: 'ai.generate.flashcards',
      status: 'queued',
      stage: 'queued',
      percent: 0,
      createdAt: '2026-09-06T10:00:00.000Z',
      updatedAt: '2026-09-06T10:00:00.000Z',
      credit: { charged: 1, refunded: 0 },
      ...over,
    },
  };
}

function ok(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function makeClient(fetchImpl: JobFetch, budgetMs = 90_000, clock?: () => number) {
  const delays: number[] = [];
  const client = createJobClient({
    getBaseUrl: () => 'https://api.test',
    getAuthHeaders: async () => ({ Authorization: 'Bearer t' }),
    fetchImpl,
    budgetMs,
    now: clock ?? (() => 0),
    sleep: async (ms) => {
      delays.push(ms);
    },
  });
  return { client, delays };
}

describe('normalizeJobRecord', () => {
  it('reads the new structured shape', () => {
    const rec = normalizeJobRecord(
      jobBody({
        stage: 'failed',
        status: 'failed',
        percent: 100,
        error: { code: 'AI_DOWN', message: 'offline', retryable: true },
      }).data
    );
    expect(rec?.stage).toBe('failed');
    expect(rec?.error).toEqual({ code: 'AI_DOWN', message: 'offline', retryable: true });
  });

  it('falls back to legacy status + string error from an older server', () => {
    const rec = normalizeJobRecord({
      id: 'j',
      name: 'notes.ai.summarize',
      status: 'failed',
      error: 'Something broke',
    });
    expect(rec?.stage).toBe('failed');
    expect(rec?.kind).toBe('smart_notes');
    expect(rec?.percent).toBe(100);
    expect(rec?.error?.message).toBe('Something broke');
  });
});

describe('startJob', () => {
  it('returns the async jobId for a 202', async () => {
    const fetchImpl: JobFetch = async () => ok({ success: true, jobId: 'job-1' }, 202);
    const { client } = makeClient(fetchImpl);
    const updates: JobProgress[] = [];
    const outcome = await client.startJob('flashcards', {
      url: 'https://api.test/api/v1/ai/generate-flashcards',
      body: { notes: 'x' },
      onUpdate: (u) => updates.push(u),
    });
    expect(outcome).toEqual({ mode: 'async', jobId: 'job-1' });
    expect(updates.map((u) => u.stage)).toEqual(['queued']);
  });

  it('presents a synchronous 200 as queued → done instantly', async () => {
    const fetchImpl: JobFetch = async () => ok({ flashcards: [{ front: 'a', back: 'b' }] });
    const { client } = makeClient(fetchImpl);
    const updates: JobProgress[] = [];
    const outcome = await client.startJob<{ flashcards: unknown[] }>('flashcards', {
      url: 'https://api.test/api/v1/ai/generate-flashcards',
      body: { notes: 'x' },
      onUpdate: (u) => updates.push(u),
    });
    expect(outcome.mode).toBe('sync');
    if (outcome.mode === 'sync') expect(outcome.result.flashcards).toHaveLength(1);
    expect(updates.map((u) => u.stage)).toEqual(['queued', 'done']);
    expect(updates[1]?.percent).toBe(100);
  });

  it('throws the server error for a non-2xx', async () => {
    const fetchImpl: JobFetch = async () => ok({ error: 'Out of credits' }, 429);
    const { client } = makeClient(fetchImpl);
    await expect(
      client.startJob('flashcards', { url: 'https://api.test/x', body: {} })
    ).rejects.toThrow('Out of credits');
  });
});

describe('watchJob', () => {
  it('polls with backoff until done and reports the result', async () => {
    const stages = ['reading', 'generating', 'saving', 'done'] as const;
    let i = 0;
    const fetchImpl: JobFetch = async () => {
      const stage = stages[Math.min(i, stages.length - 1)];
      i += 1;
      return ok(
        jobBody({
          stage,
          status: stage === 'done' ? 'completed' : 'active',
          percent: stage === 'done' ? 100 : 40,
          result: stage === 'done' ? { flashcards: ['card'] } : undefined,
          resultRef: stage === 'done' ? { type: 'deck', id: 'deck-2' } : undefined,
        })
      );
    };
    const { client, delays } = makeClient(fetchImpl);
    const updates: JobProgress[] = [];
    const outcome = await client.watchJob<{ flashcards: string[] }>('job-1', (u) => updates.push(u));

    expect(outcome.status).toBe('done');
    if (outcome.status === 'done') {
      expect(outcome.result.flashcards).toEqual(['card']);
      expect(outcome.record?.resultRef?.id).toBe('deck-2');
    }
    expect(delays).toEqual([1000, 2000, 4000, 5000]);
    expect(updates.map((u) => u.stage)).toEqual([
      'queued',
      'reading',
      'generating',
      'saving',
      'done',
    ]);
    expect(updates.every((u, idx) => idx === 0 || u.percent >= (updates[idx - 1]?.percent ?? 0))).toBe(
      true
    );
  });

  it('reports a failure with its structured error and the observed refund', async () => {
    const fetchImpl: JobFetch = async () =>
      ok(
        jobBody({
          stage: 'failed',
          status: 'failed',
          percent: 100,
          error: { code: 'AI_DOWN', message: 'The tutor is offline.', retryable: true },
          credit: { charged: 1, refunded: 1 },
        })
      );
    const { client } = makeClient(fetchImpl);
    const outcome = await client.watchJob('job-1');
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.error.code).toBe('AI_DOWN');
      expect(outcome.record?.credit).toEqual({ charged: 1, refunded: 1 });
    }
  });

  it('yields still_running (never an error) when the budget runs out', async () => {
    let clock = 0;
    const fetchImpl: JobFetch = async () => {
      clock += 30_000;
      return ok(jobBody({ stage: 'generating', status: 'active', percent: 50 }));
    };
    const { client } = makeClient(fetchImpl, 60_000, () => clock);
    const outcome = await client.watchJob('job-1');
    expect(outcome.status).toBe('still_running');
    expect(outcome.jobId).toBe('job-1');
    expect(outcome.record?.stage).toBe('generating');
  });

  it('resumeJob reattaches to a job that finished while the app was away', async () => {
    const fetchImpl: JobFetch = async () =>
      ok(jobBody({ stage: 'done', status: 'completed', percent: 100, result: { ok: 1 } }));
    const { client } = makeClient(fetchImpl);
    const outcome = await client.resumeJob<{ ok: number }>('job-1');
    expect(outcome.status).toBe('done');
    if (outcome.status === 'done') expect(outcome.result).toEqual({ ok: 1 });
  });

  it('cancelWatch stops the watch without failing it', async () => {
    let calls = 0;
    const fetchImpl: JobFetch = async () => {
      calls += 1;
      return ok(jobBody({ stage: 'generating', status: 'active', percent: 30 }));
    };
    const client = createJobClient({
      getBaseUrl: () => 'https://api.test',
      getAuthHeaders: async () => ({}),
      fetchImpl,
      now: () => 0,
      sleep: async () => {
        client.cancelWatch('job-1');
      },
    });
    const outcome = await client.watchJob('job-1');
    expect(outcome.status).toBe('cancelled');
    expect(calls).toBe(0);
  });

  it('survives a transient status-check failure and still finishes', async () => {
    let call = 0;
    const fetchImpl: JobFetch = async () => {
      call += 1;
      if (call === 1) throw new Error('network down');
      return ok(jobBody({ stage: 'done', status: 'completed', percent: 100, result: 'yes' }));
    };
    const { client } = makeClient(fetchImpl);
    const outcome = await client.watchJob<string>('job-1');
    expect(outcome.status).toBe('done');
    if (outcome.status === 'done') expect(outcome.result).toBe('yes');
  });

  it('never reports work as lost when the server keeps erroring', async () => {
    const fetchImpl: JobFetch = async () => {
      throw new Error('network down');
    };
    const { client } = makeClient(fetchImpl);
    const outcome = await client.watchJob('job-1');
    expect(outcome.status).toBe('still_running');
  });
});

/**
 * A queued run answers 202 — a 2xx — so the accept publishes the CHARGED
 * counters and no auto-refund can fire on it. When the job then fails the
 * server hands the credits back, and the poll that reports the failure is the
 * only moment the client can hear about it. Without this the badge kept a
 * charge for work that produced nothing.
 */
describe('AI counters on a job poll', () => {
  function withHeaders(body: unknown, headers: Record<string, string>, status = 200) {
    return {
      ...ok(body, status),
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    };
  }

  it('republishes the refunded counters from the poll that reports a failure', async () => {
    const seen: Array<{ used: number; remaining: number }> = [];
    const fetchImpl: JobFetch = async () =>
      withHeaders(
        jobBody({
          stage: 'failed',
          status: 'failed',
          percent: 100,
          error: {
            code: 'JOB_FAILED',
            message: 'AI is temporarily unavailable. Please try again in a moment.',
            retryable: true,
          },
          credit: { charged: 1, refunded: 1 },
        })
      , {
        'x-ai-global-usage-used': '0',
        'x-ai-global-usage-limit': '100',
        'x-ai-global-usage-resets-at': '2026-09-08T00:00:00.000Z',
      });

    const client = createJobClient({
      getBaseUrl: () => 'https://api.test',
      getAuthHeaders: async () => ({}),
      fetchImpl,
      now: () => 0,
      sleep: async () => {},
      onUsageUpdate: (usage) => seen.push({ used: usage.used, remaining: usage.remaining }),
    });

    const outcome = await client.watchJob('job-1');
    expect(outcome.status).toBe('failed');
    expect(seen[seen.length - 1]).toEqual({ used: 0, remaining: 100 });
  });

  it('says nothing when the server sends no counters', async () => {
    const seen: unknown[] = [];
    const fetchImpl: JobFetch = async () =>
      ok(jobBody({ stage: 'done', status: 'completed', percent: 100, result: { ok: true } }));

    const client = createJobClient({
      getBaseUrl: () => 'https://api.test',
      getAuthHeaders: async () => ({}),
      fetchImpl,
      now: () => 0,
      sleep: async () => {},
      onUsageUpdate: (usage) => seen.push(usage),
    });

    await client.watchJob('job-1');
    // An absent header means "this server does not know", which must never be
    // published as zero.
    expect(seen).toEqual([]);
  });
});
