/**
 * The offline test-result replay, pinned against the way it can strand a
 * student's work (G4 · H14).
 *
 * The FIFO stops on the first TRANSIENT failure so history keeps its order —
 * which means a PERMANENT rejection that is misread as transient stops every
 * result queued behind it from ever syncing. `createTestSession` threw the
 * server's own sentence with no status in it, and the classifier only scraped
 * the message, so the permanent branch was unreachable. Both halves are tested
 * here: a 4xx lets the queue continue, a 5xx keeps everything, and a rejected
 * result is SET ASIDE, never deleted.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const memory: Record<string, string> = {};
vi.stubGlobal('window', { name: 'test' });
vi.stubGlobal('localStorage', {
  getItem: (key: string) => memory[key] ?? null,
  setItem: (key: string, value: string) => {
    memory[key] = value;
  },
  removeItem: (key: string) => {
    delete memory[key];
  },
  clear: () => {
    for (const key of Object.keys(memory)) delete memory[key];
  },
  key: (i: number) => Object.keys(memory)[i] ?? null,
  get length() {
    return Object.keys(memory).length;
  },
});

const createTestSession = vi.fn();
const createTestResult = vi.fn();
const markPendingSyncResultAsSynced = vi.fn().mockResolvedValue(undefined);
const upsertUserQuestionStat = vi.fn().mockResolvedValue(undefined);

vi.mock('./supabase', () => ({
  createTestSession: (...args: unknown[]) => createTestSession(...args),
  createTestResult: (...args: unknown[]) => createTestResult(...args),
  markPendingSyncResultAsSynced: (...args: unknown[]) => markPendingSyncResultAsSynced(...args),
  upsertUserQuestionStat: (...args: unknown[]) => upsertUserQuestionStat(...args),
}));

vi.mock('./pendingQuestionBankScores', () => ({
  flushPendingQuestionBankScores: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./offlineQueueOwner', () => ({
  takeQuarantinedQueue: () => [],
}));

const state = {
  pendingSyncResults: [] as any[],
  userQuestionStats: {} as Record<string, unknown>,
  setPendingSyncResults: (results: any[]) => {
    state.pendingSyncResults = results;
  },
  updateTestResults: (fn: (prev: any[]) => any[]) => {
    state.testResults = fn(state.testResults);
  },
  testResults: [] as any[],
};

vi.mock('../stores/testStore', () => ({
  useTestStore: { getState: () => state },
}));

import { readFailedTestResults, syncPendingTestResults } from './offlineTestSync';

const USER = 'user-1';

/** A queued offline result, minimal but the shape the replay reads. */
const queued = (id: string) => ({
  id,
  score: 1,
  correctAnswersCount: 1,
  totalQuestions: 1,
  session: {
    config: {},
    questions: [],
    userAnswers: {},
    startTime: Date.now(),
    endTime: Date.now(),
    isOffline: true,
  },
});

/** What the API layer throws now: the status travels on the error. */
const apiError = (status: number, message = 'Invalid session payload') => {
  const err = new Error(`${message} (status: ${status})`) as Error & {
    status?: number;
    code?: string;
  };
  err.status = status;
  err.code = status === 403 ? 'ACCOUNT_SUSPENDED' : undefined;
  return err;
};

beforeEach(() => {
  for (const key of Object.keys(memory)) delete memory[key];
  vi.clearAllMocks();
  state.pendingSyncResults = [];
  state.testResults = [];
  state.userQuestionStats = {};
  createTestResult.mockResolvedValue({ id: 'result-row' });
  markPendingSyncResultAsSynced.mockResolvedValue(undefined);
});

describe('permanent rejections do not wedge the queue', () => {
  it('a 400 on the first result still lets the second one sync', async () => {
    state.pendingSyncResults = [queued('r1'), queued('r2')];
    createTestSession
      .mockRejectedValueOnce(apiError(400))
      .mockResolvedValueOnce({ id: 'session-2' });

    const outcome = await syncPendingTestResults(USER);

    expect(outcome.synced).toBe(1);
    expect(outcome.failed).toBe(1);
    expect(outcome.remaining).toBe(0);
    expect(createTestSession).toHaveBeenCalledTimes(2);
  });

  it('sets the rejected result aside instead of deleting it', async () => {
    state.pendingSyncResults = [queued('r1')];
    createTestSession.mockRejectedValueOnce(apiError(403, 'Account suspended'));

    await syncPendingTestResults(USER);

    const failed = readFailedTestResults(USER);
    expect(failed).toHaveLength(1);
    expect(failed[0].result.id).toBe('r1');
    expect(failed[0].status).toBe(403);
    expect(failed[0].code).toBe('ACCOUNT_SUSPENDED');
    // And it is out of the FIFO, so nothing queues behind it forever.
    expect(state.pendingSyncResults).toEqual([]);
  });

  it('classifies by the status PROPERTY, not only by the message', async () => {
    state.pendingSyncResults = [queued('r1'), queued('r2')];
    // The server's own sentence — no status anywhere in the text. This is
    // exactly what used to be read as transient and break the loop.
    const bare = new Error('Invalid session payload') as Error & { status?: number };
    bare.status = 422;
    createTestSession.mockRejectedValueOnce(bare).mockResolvedValueOnce({ id: 'session-2' });

    const outcome = await syncPendingTestResults(USER);

    expect(outcome.failed).toBe(1);
    expect(outcome.synced).toBe(1);
  });
});

describe('transient failures keep everything and stop', () => {
  it('a 503 on the first result leaves both queued and does not try the second', async () => {
    state.pendingSyncResults = [queued('r1'), queued('r2')];
    createTestSession.mockRejectedValue(apiError(503, 'Service unavailable'));

    const outcome = await syncPendingTestResults(USER);

    expect(outcome.synced).toBe(0);
    expect(outcome.failed).toBeUndefined();
    expect(outcome.remaining).toBe(2);
    expect(createTestSession).toHaveBeenCalledTimes(1);
    expect(state.pendingSyncResults.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(readFailedTestResults(USER)).toEqual([]);
  });

  it('treats a network error with no status as transient', async () => {
    state.pendingSyncResults = [queued('r1'), queued('r2')];
    createTestSession.mockRejectedValue(new TypeError('Failed to fetch'));

    const outcome = await syncPendingTestResults(USER);

    expect(outcome.remaining).toBe(2);
    expect(createTestSession).toHaveBeenCalledTimes(1);
  });

  it('keeps 408 and 429 in the queue', async () => {
    for (const status of [408, 429]) {
      state.pendingSyncResults = [queued('r1')];
      createTestSession.mockRejectedValue(apiError(status, 'Slow down'));
      const outcome = await syncPendingTestResults(USER);
      expect(outcome.remaining).toBe(1);
      expect(readFailedTestResults(USER)).toEqual([]);
    }
  });
});
