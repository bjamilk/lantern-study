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

const STORAGE_KEY = '@lantern_pending_qbank_scores';

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  jest.clearAllMocks();
  recordQuestionBankScore.mockResolvedValue({ improved: true });
});

describe('enqueueScoreForBundle', () => {
  it('queues only marketplace bundles', async () => {
    await enqueueScoreForBundle('qbank-listing-1', 7, 10);
    await enqueueScoreForBundle('offline-12345', 5, 10);
    await enqueueScoreForBundle(undefined, 5, 10);

    const queue = await readPendingQuestionBankScores();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ listingId: 'listing-1', correct: 7, total: 10 });
  });

  it('ignores nonsensical totals', async () => {
    await enqueueScoreForBundle('qbank-listing-1', 0, 0);
    await expect(readPendingQuestionBankScores()).resolves.toHaveLength(0);
  });
});

describe('flushPendingQuestionBankScores', () => {
  it('posts and clears queued scores', async () => {
    await enqueueScoreForBundle('qbank-listing-1', 7, 10);
    await expect(flushPendingQuestionBankScores()).resolves.toEqual({ posted: 1, remaining: 0 });
    expect(recordQuestionBankScore).toHaveBeenCalledWith('listing-1', 7, 10);
  });

  it('keeps failed entries queued, then drops them after repeated failures', async () => {
    recordQuestionBankScore.mockRejectedValue(new Error('offline'));
    await enqueueScoreForBundle('qbank-listing-1', 7, 10);

    await expect(flushPendingQuestionBankScores()).resolves.toEqual({ posted: 0, remaining: 1 });
    expect((await readPendingQuestionBankScores())[0].attempts).toBe(1);

    for (let i = 0; i < 4; i += 1) await flushPendingQuestionBankScores();
    await expect(readPendingQuestionBankScores()).resolves.toHaveLength(0);
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

    await expect(flushPendingQuestionBankScores()).resolves.toEqual({ posted: 0, remaining: 0 });
    expect(recordQuestionBankScore).not.toHaveBeenCalled();
  });

  it('survives corrupt storage', async () => {
    store[STORAGE_KEY] = '{not json';
    await expect(readPendingQuestionBankScores()).resolves.toEqual([]);
    await expect(flushPendingQuestionBankScores()).resolves.toEqual({ posted: 0, remaining: 0 });
  });
});
