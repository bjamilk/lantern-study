/**
 * Offline review sync: one permanently-failing queued review (deleted card,
 * server rejection) must never wedge every later grade behind it, while a
 * plain network failure must keep the whole queue intact for the next pass.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const reviewFlashcard = vi.fn();
vi.mock('../../../services/supabase', () => ({
  reviewFlashcard: (...args: unknown[]) => reviewFlashcard(...args),
}));

import { syncPendingFlashcardReviews } from '../../../services/offlineFlashcardSync';
import { useFlashcardStore } from '../../../stores/flashcardStore';

// Unique per test: the module keeps rejected-attempt counts per entry id.
let seq = 0;
const pending = (flashcardId: string): any => ({
  id: `entry-${++seq}-${flashcardId}`,
  flashcardId,
  deckId: 'd1',
  rating: 'good',
  reviewedAt: '2026-01-01T00:00:00.000Z',
});

const httpError = (status: number) => {
  const err = new Error(`HTTP ${status}`) as Error & { status?: number };
  err.status = status;
  return err;
};

beforeEach(() => {
  useFlashcardStore.setState({ flashcards: [], pendingFlashcardReviews: [] });
  localStorage.clear();
  vi.clearAllMocks();
});

describe('syncPendingFlashcardReviews', () => {
  it('drops a 404 entry and still syncs the grades queued behind it', async () => {
    useFlashcardStore.setState({
      pendingFlashcardReviews: [pending('deleted-card'), pending('live-card')],
    });
    reviewFlashcard.mockImplementation(async (flashcardId: string) => {
      if (flashcardId === 'deleted-card') throw httpError(404);
      return null;
    });

    const result = await syncPendingFlashcardReviews();

    expect(result).toEqual({ synced: 1, remaining: 0, dropped: 1 });
    expect(reviewFlashcard).toHaveBeenCalledTimes(2);
    expect(useFlashcardStore.getState().pendingFlashcardReviews).toEqual([]);
  });

  it('drops a 403 entry the same way', async () => {
    useFlashcardStore.setState({
      pendingFlashcardReviews: [pending('forbidden-card'), pending('live-card')],
    });
    reviewFlashcard.mockImplementation(async (flashcardId: string) => {
      if (flashcardId === 'forbidden-card') throw httpError(403);
      return null;
    });

    const result = await syncPendingFlashcardReviews();
    expect(result).toEqual({ synced: 1, remaining: 0, dropped: 1 });
  });

  it('gives up on an entry the server keeps rejecting after 5 attempts', async () => {
    const entry = pending('always-500');
    useFlashcardStore.setState({ pendingFlashcardReviews: [entry] });
    reviewFlashcard.mockRejectedValue(httpError(500));

    for (let attempt = 1; attempt <= 4; attempt++) {
      const result = await syncPendingFlashcardReviews();
      expect(result).toEqual({ synced: 0, remaining: 1, dropped: 0 });
    }

    const fifth = await syncPendingFlashcardReviews();
    expect(fifth).toEqual({ synced: 0, remaining: 0, dropped: 1 });
    expect(useFlashcardStore.getState().pendingFlashcardReviews).toEqual([]);
  });

  it('keeps the whole queue when the request never reaches the server', async () => {
    useFlashcardStore.setState({
      pendingFlashcardReviews: [pending('a'), pending('b')],
    });
    reviewFlashcard.mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await syncPendingFlashcardReviews();

    expect(result).toEqual({ synced: 0, remaining: 2, dropped: 0 });
    // Head-of-line stop is intentional here: nothing later could succeed.
    expect(reviewFlashcard).toHaveBeenCalledTimes(1);
    expect(useFlashcardStore.getState().pendingFlashcardReviews).toHaveLength(2);
  });

  it('network failures never count toward the drop cap', async () => {
    const entry = pending('flaky-network');
    useFlashcardStore.setState({ pendingFlashcardReviews: [entry] });
    reviewFlashcard.mockRejectedValue(new TypeError('Failed to fetch'));

    for (let i = 0; i < 10; i++) {
      const result = await syncPendingFlashcardReviews();
      expect(result).toEqual({ synced: 0, remaining: 1, dropped: 0 });
    }
    expect(useFlashcardStore.getState().pendingFlashcardReviews).toHaveLength(1);
  });

  it('applies the synced schedule to the in-memory card', async () => {
    const entry = pending('card-1');
    useFlashcardStore.setState({
      flashcards: [{ id: 'card-1', deckId: 'd1', type: 'BASIC', version: 1 } as any],
      pendingFlashcardReviews: [entry],
    });
    reviewFlashcard.mockResolvedValue({ id: 'card-1', version: 2 });

    const result = await syncPendingFlashcardReviews();

    expect(result).toEqual({ synced: 1, remaining: 0, dropped: 0 });
    expect(useFlashcardStore.getState().flashcards[0]?.version).toBe(2);
  });
});
