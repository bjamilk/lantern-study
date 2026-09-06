/**
 * Mobile durable question-bank score queue — same guarantees as web:
 * offline attempts survive until they post, but never wedge the queue.
 */
const store: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => (key in store ? store[key] : null)),
    setItem: jest.fn(async (key: string, value: string) => {
      store[key] = String(value);
    }),
    removeItem: jest.fn(async (key: string) => {
      delete store[key];
    }),
  },
}));

const recordQuestionBankScore = jest.fn();
jest.mock('../services/api', () => ({
  recordQuestionBankScore: (...args: unknown[]) => recordQuestionBankScore(...args),
}));

import {
  enqueueScoreForBundle,
  flushPendingQuestionBankScores,
  readPendingQuestionBankScores,
} from './pendingQuestionBankScores';

const LEGACY_KEY = '@lantern_pending_qbank_scores';
const USER = 'user-1';
const STORAGE_KEY = `${LEGACY_KEY}:${USER}`;

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  jest.clearAllMocks();
  recordQuestionBankScore.mockResolvedValue({ improved: true });
});

describe('enqueueScoreForBundle', () => {
  it('queues only marketplace bundles', async () => {
    await enqueueScoreForBundle(USER, 'qbank-listing-1', 7, 10);
    await enqueueScoreForBundle(USER, 'offline-12345', 5, 10);
    await enqueueScoreForBundle(USER, undefined, 5, 10);

    const queue = await readPendingQuestionBankScores(USER);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ listingId: 'listing-1', correct: 7, total: 10 });
  });

  it('ignores nonsensical totals', async () => {
    await enqueueScoreForBundle(USER, 'qbank-listing-1', 0, 0);
    await expect(readPendingQuestionBankScores(USER)).resolves.toHaveLength(0);
  });
});

describe('flushPendingQuestionBankScores', () => {
  it('posts and clears queued scores', async () => {
    await enqueueScoreForBundle(USER, 'qbank-listing-1', 7, 10);
    await expect(flushPendingQuestionBankScores(USER)).resolves.toEqual({ posted: 1, remaining: 0 });
    expect(recordQuestionBankScore).toHaveBeenCalledWith('listing-1', 7, 10);
  });

  it('keeps failed entries queued, then drops them after repeated failures', async () => {
    recordQuestionBankScore.mockRejectedValue(new Error('offline'));
    await enqueueScoreForBundle(USER, 'qbank-listing-1', 7, 10);

    await expect(flushPendingQuestionBankScores(USER)).resolves.toEqual({ posted: 0, remaining: 1 });
    expect((await readPendingQuestionBankScores(USER))[0].attempts).toBe(1);

    for (let i = 0; i < 4; i += 1) await flushPendingQuestionBankScores(USER);
    await expect(readPendingQuestionBankScores(USER)).resolves.toHaveLength(0);
  });

  it('drops entries older than the retention window without posting', async () => {
    store[STORAGE_KEY] = JSON.stringify([
      {
        listingId: 'listing-1',
        correct: 7,
        total: 10,
        completedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
        attempts: 0,
      },
    ]);

    await expect(flushPendingQuestionBankScores(USER)).resolves.toEqual({ posted: 0, remaining: 0 });
    expect(recordQuestionBankScore).not.toHaveBeenCalled();
  });

  it('survives corrupt storage', async () => {
    store[STORAGE_KEY] = '{not json';
    await expect(readPendingQuestionBankScores(USER)).resolves.toEqual([]);
    await expect(flushPendingQuestionBankScores(USER)).resolves.toEqual({ posted: 0, remaining: 0 });
  });
});

describe('per-account scoping', () => {
  const OTHER = 'user-2';

  it('never flushes another account\'s queued score', async () => {
    await enqueueScoreForBundle(OTHER, 'qbank-listing-9', 3, 10);

    await expect(flushPendingQuestionBankScores(USER)).resolves.toEqual({
      posted: 0,
      remaining: 0,
    });
    expect(recordQuestionBankScore).not.toHaveBeenCalled();
    // Still waiting for its owner.
    await expect(readPendingQuestionBankScores(OTHER)).resolves.toHaveLength(1);
  });

  it('leaves the other account untouched when one flushes', async () => {
    await enqueueScoreForBundle(USER, 'qbank-listing-1', 7, 10);
    await enqueueScoreForBundle(OTHER, 'qbank-listing-9', 3, 10);

    await expect(flushPendingQuestionBankScores(USER)).resolves.toEqual({
      posted: 1,
      remaining: 0,
    });
    expect(recordQuestionBankScore).toHaveBeenCalledTimes(1);
    await expect(readPendingQuestionBankScores(USER)).resolves.toHaveLength(0);
    await expect(readPendingQuestionBankScores(OTHER)).resolves.toHaveLength(1);
  });

  it('drops unowned legacy entries instead of posting them as this user', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    store[LEGACY_KEY] = JSON.stringify([
      { listingId: 'listing-old', correct: 4, total: 10, completedAt: new Date().toISOString(), attempts: 0 },
    ]);

    await expect(flushPendingQuestionBankScores(USER)).resolves.toEqual({
      posted: 0,
      remaining: 0,
    });
    expect(recordQuestionBankScore).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    // The legacy key is cleaned up so the warn does not repeat forever.
    expect(store[LEGACY_KEY]).toBeUndefined();
    warn.mockRestore();
  });

  it('ignores calls with no signed-in user', async () => {
    await enqueueScoreForBundle(undefined, 'qbank-listing-1', 7, 10);
    expect(Object.keys(store)).toHaveLength(0);
    await expect(flushPendingQuestionBankScores(undefined)).resolves.toEqual({
      posted: 0,
      remaining: 0,
    });
  });
});
