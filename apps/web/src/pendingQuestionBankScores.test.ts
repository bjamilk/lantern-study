/**
 * Durable question-bank score queue: offline attempts must survive until they
 * post, but must never wedge the queue forever.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The web suite runs in node; the queue only needs the getItem/setItem/clear
// surface, so a tiny in-memory stand-in beats pulling in a DOM environment.
const memoryStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();
vi.stubGlobal('localStorage', memoryStorage);

const recordQuestionBankScore = vi.fn();
vi.mock('../../../services/supabase', () => ({
  recordQuestionBankScore: (...args: unknown[]) => recordQuestionBankScore(...args),
}));

import {
  enqueueScoreForBundle,
  flushPendingQuestionBankScores,
  readPendingQuestionBankScores,
} from '../../../services/pendingQuestionBankScores';

const STORAGE_KEY = 'lantern_pending_qbank_scores';

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  recordQuestionBankScore.mockResolvedValue({ improved: true });
});

describe('enqueueScoreForBundle', () => {
  it('queues only marketplace bundles', () => {
    enqueueScoreForBundle('qbank-listing-1', 7, 10);
    enqueueScoreForBundle('offline-12345', 5, 10); // a self-made bundle
    enqueueScoreForBundle(undefined, 5, 10);

    const queue = readPendingQuestionBankScores();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ listingId: 'listing-1', correct: 7, total: 10, attempts: 0 });
  });

  it('ignores nonsensical totals', () => {
    enqueueScoreForBundle('qbank-listing-1', 0, 0);
    expect(readPendingQuestionBankScores()).toHaveLength(0);
  });

  it('keeps every attempt rather than deduping by bank', () => {
    enqueueScoreForBundle('qbank-listing-1', 4, 10);
    enqueueScoreForBundle('qbank-listing-1', 9, 10);
    expect(readPendingQuestionBankScores()).toHaveLength(2);
  });
});

describe('flushPendingQuestionBankScores', () => {
  it('posts and clears queued scores', async () => {
    enqueueScoreForBundle('qbank-listing-1', 7, 10);
    enqueueScoreForBundle('qbank-listing-2', 3, 5);

    await expect(flushPendingQuestionBankScores()).resolves.toEqual({ posted: 2, remaining: 0 });
    expect(recordQuestionBankScore).toHaveBeenCalledWith('listing-1', 7, 10);
    expect(readPendingQuestionBankScores()).toHaveLength(0);
  });

  /**
   * What `recordQuestionBankScore` throws for a non-ok HTTP answer: the status
   * both in the message (the queue's classifier parses it there) and as a
   * property (the contract offlineFlashcardSync reads).
   */
  const httpError = (status: number) =>
    Object.assign(new Error(`Failed to record score (status: ${status})`), { status });

  it('keeps a server-rejected entry queued with an incremented attempt count', async () => {
    recordQuestionBankScore.mockRejectedValue(httpError(500));
    enqueueScoreForBundle('qbank-listing-1', 7, 10);

    await expect(flushPendingQuestionBankScores()).resolves.toEqual({ posted: 0, remaining: 1 });
    expect(readPendingQuestionBankScores()[0]?.attempts).toBe(1);
  });

  // F1 / E3 L4: a transport failure carries no HTTP status. Counting it meant
  // five flaky reconnects DELETED a legitimate score unsent.
  it('does NOT count a network failure as an attempt', async () => {
    recordQuestionBankScore.mockRejectedValue(new TypeError('Failed to fetch'));
    enqueueScoreForBundle('qbank-listing-1', 7, 10);

    for (let i = 0; i < 10; i += 1) await flushPendingQuestionBankScores();

    const queue = readPendingQuestionBankScores();
    expect(queue).toHaveLength(1);
    expect(queue[0]?.attempts).toBe(0);
  });

  it('drops an entry after repeated SERVER rejections instead of retrying forever', async () => {
    recordQuestionBankScore.mockRejectedValue(httpError(400));
    enqueueScoreForBundle('qbank-listing-1', 7, 10);

    for (let i = 0; i < 5; i += 1) await flushPendingQuestionBankScores();

    expect(readPendingQuestionBankScores()).toHaveLength(0);
  });

  it('drops entries older than the retention window without posting', async () => {
    const stale = [
      {
        listingId: 'listing-1',
        correct: 7,
        total: 10,
        completedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
        attempts: 0,
      },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stale));

    await expect(flushPendingQuestionBankScores()).resolves.toEqual({ posted: 0, remaining: 0 });
    expect(recordQuestionBankScore).not.toHaveBeenCalled();
  });

  it('survives corrupt storage', async () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    expect(readPendingQuestionBankScores()).toEqual([]);
    await expect(flushPendingQuestionBankScores()).resolves.toEqual({ posted: 0, remaining: 0 });
  });
});
