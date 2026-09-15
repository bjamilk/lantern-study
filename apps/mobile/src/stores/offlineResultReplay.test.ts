/**
 * The offline result replay must be KEYED (F2 · E3 C6/H11).
 *
 * `saveTestResult` with no sessionId CREATES a session. Unkeyed, a result
 * whose upload landed server-side but failed on the wire was written again on
 * the next reconnect: two sessions for one sitting, the score counted twice on
 * the dashboard. These pin that the key is minted once at enqueue and is
 * IDENTICAL on every retry — a key that changes per attempt is the same as no
 * key at all.
 */
const store: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => store[key] ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: jest.fn(async (key: string) => {
      delete store[key];
    }),
    multiRemove: jest.fn(async (keys: string[]) => {
      for (const key of keys) delete store[key];
    }),
  },
}));

const saveTestResult = jest.fn();
const submitTestResult = jest.fn();
jest.mock('../services/api', () => ({
  saveTestResult: (...args: unknown[]) => saveTestResult(...args),
  submitTestResult: (...args: unknown[]) => submitTestResult(...args),
  deleteOfflineBundle: jest.fn(async () => undefined),
}));

import { useOfflineStore } from './offlineStore';
import { resultIdempotencyKey } from '@lantern/shared/offlineQueue';

const USER = 'user-1';

const payload = {
  score: 80,
  correctAnswersCount: 8,
  totalQuestions: 10,
  questions: [],
  userAnswers: {},
};

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  jest.clearAllMocks();
  useOfflineStore.setState({ pendingResults: [], isSyncing: false });
});

describe('savePendingResult', () => {
  it('mints one idempotency key at enqueue', async () => {
    await useOfflineStore.getState().savePendingResult(
      {
        testId: 't1',
        groupName: 'Biology',
        score: 8,
        totalQuestions: 10,
        percentage: 80,
        completedAt: new Date().toISOString(),
        timeSpent: 120,
        sessionPayload: payload,
      } as never,
      USER
    );

    const [queued] = useOfflineStore.getState().pendingResults;
    expect(queued.idempotencyKey).toEqual(expect.any(String));
    expect(queued.idempotencyKey).toBeTruthy();
  });
});

describe('syncPendingResults', () => {
  const queueOne = async () => {
    await useOfflineStore.getState().savePendingResult(
      {
        testId: 't1',
        groupName: 'Biology',
        score: 8,
        totalQuestions: 10,
        percentage: 80,
        completedAt: new Date().toISOString(),
        timeSpent: 120,
        sessionPayload: payload,
      } as never,
      USER
    );
    return useOfflineStore.getState().pendingResults[0];
  };

  it('sends the entry\'s key on both halves of the upload', async () => {
    saveTestResult.mockResolvedValue({ id: 'session-1' });
    submitTestResult.mockResolvedValue({});

    const queued = await queueOne();
    await useOfflineStore.getState().syncPendingResults(USER);

    expect(saveTestResult).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ idempotencyKey: queued.idempotencyKey })
    );
    expect(submitTestResult).toHaveBeenCalledWith(
      'session-1',
      expect.any(Object),
      { idempotencyKey: queued.idempotencyKey }
    );
  });

  it('replays with the SAME key after a failed submit — never a fresh one', async () => {
    const queued = await queueOne();

    // First attempt: the session lands, the submit dies on the wire.
    saveTestResult.mockResolvedValue({ id: 'session-1' });
    submitTestResult.mockRejectedValueOnce(new Error('Network request failed'));
    await useOfflineStore.getState().syncPendingResults(USER);

    // The result is still queued (work is never dropped on a transient error).
    expect(useOfflineStore.getState().pendingResults).toHaveLength(1);

    // Second attempt, next reconnect.
    submitTestResult.mockResolvedValue({});
    await useOfflineStore.getState().syncPendingResults(USER);

    const keys = saveTestResult.mock.calls.map((call) => (call[1] as any).idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(queued.idempotencyKey);
    expect(keys[1]).toBe(queued.idempotencyKey);
  });

  it('derives a stable key for an entry queued before F2 existed', async () => {
    const legacy = {
      id: 'result-legacy',
      testId: 't1',
      groupName: 'Biology',
      score: 8,
      totalQuestions: 10,
      percentage: 80,
      completedAt: new Date().toISOString(),
      timeSpent: 120,
      synced: false,
      userId: USER,
      sessionPayload: payload,
    };
    useOfflineStore.setState({ pendingResults: [legacy as never] });

    saveTestResult.mockResolvedValue({ id: 'session-1' });
    submitTestResult.mockRejectedValueOnce(new Error('Network request failed'));
    await useOfflineStore.getState().syncPendingResults(USER);
    submitTestResult.mockResolvedValue({});
    await useOfflineStore.getState().syncPendingResults(USER);

    const keys = saveTestResult.mock.calls.map((call) => (call[1] as any).idempotencyKey);
    expect(keys[0]).toBe(resultIdempotencyKey(legacy, { userId: USER }));
    expect(keys[1]).toBe(keys[0]);
  });

  it('never uploads another account\'s queued result', async () => {
    useOfflineStore.setState({
      pendingResults: [
        {
          id: 'result-other',
          testId: 't1',
          groupName: 'Biology',
          score: 8,
          totalQuestions: 10,
          percentage: 80,
          completedAt: new Date().toISOString(),
          timeSpent: 120,
          synced: false,
          userId: 'user-2',
          sessionPayload: payload,
        } as never,
      ],
    });

    await useOfflineStore.getState().syncPendingResults(USER);

    expect(saveTestResult).not.toHaveBeenCalled();
    // And it is still there — preserved, not purged.
    expect(useOfflineStore.getState().pendingResults).toHaveLength(1);
  });
});
