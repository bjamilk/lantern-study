import {
  applyLocalFlashcardReview,
  createPendingFlashcardReview,
} from './offlineReview';
import type { SrsData } from '../types';

const defaultStudy = { srsMaxInterval: 365 };

function cardWithSrs(id: string, srsData?: SrsData) {
  return { id, deckId: 'deck-1', srsData };
}

describe('createPendingFlashcardReview', () => {
  it('creates a review entry with rating and timestamps', () => {
    const review = createPendingFlashcardReview('card-1', 'deck-1', 'good', 'rev-1');
    expect(review).toMatchObject({
      id: 'rev-1',
      flashcardId: 'card-1',
      deckId: 'deck-1',
      rating: 'good',
    });
    expect(review.reviewedAt).toBeTruthy();
  });
});

describe('applyLocalFlashcardReview', () => {
  it('assigns FSRS scheduler data for a new card rated good', () => {
    const updated = applyLocalFlashcardReview(cardWithSrs('new-1'), 'good', defaultStudy);
    expect(updated.srsData?.scheduler).toBe('fsrs');
    expect(updated.srsData?.repetitions).toBe(1);
    expect(updated.srsData?.nextReviewDate).toBeTruthy();
  });

  it('resets repetitions when rated again', () => {
    const existing = cardWithSrs('due-1', {
      repetitions: 3,
      easeFactor: 2.4,
      interval: 6,
      nextReviewDate: '2000-01-01T00:00:00.000Z',
      scheduler: 'fsrs',
      stability: 6,
      difficulty: 5,
    });
    const updated = applyLocalFlashcardReview(existing, 'again', defaultStudy);
    expect(updated.srsData?.repetitions).toBe(0);
    expect(updated.srsData?.failedAttempts).toBeGreaterThan(0);
  });

  it('respects srsMaxInterval cap from study settings', () => {
    const existing = cardWithSrs('due-2', {
      repetitions: 10,
      easeFactor: 2.5,
      interval: 30,
      nextReviewDate: '2000-01-01T00:00:00.000Z',
      scheduler: 'fsrs',
      stability: 200,
      difficulty: 3,
    });
    const updated = applyLocalFlashcardReview(existing, 'easy', { srsMaxInterval: 14 });
    expect(updated.srsData?.interval).toBeLessThanOrEqual(14);
  });
});
