import { buildFlashcardReviewQueue } from './studySession';
import type { SrsData } from '../types';

function dueCard(id: string, nextReviewDate = '2000-01-01T00:00:00.000Z'): { id: string; srsData: SrsData } {
  return {
    id,
    srsData: {
      repetitions: 2,
      easeFactor: 2.5,
      interval: 1,
      nextReviewDate,
    },
  };
}

function newCard(id: string): { id: string; srsData?: SrsData } {
  return { id };
}

describe('buildFlashcardReviewQueue', () => {
  it('includes due cards even when many cards were already reviewed today', () => {
    const cards = [dueCard('due-1'), dueCard('due-2'), newCard('new-1')];
    const queue = buildFlashcardReviewQueue(cards, {
      srsNewCardsPerDay: 20,
      newCardsIntroducedToday: 0,
    });

    expect(queue.map((c) => c.id)).toEqual(['due-1', 'due-2', 'new-1']);
  });

  it('limits new cards to srsNewCardsPerDay minus newCardsIntroducedToday', () => {
    const cards = [newCard('new-1'), newCard('new-2'), newCard('new-3')];
    const queue = buildFlashcardReviewQueue(cards, {
      srsNewCardsPerDay: 2,
      newCardsIntroducedToday: 1,
    });

    expect(queue.map((c) => c.id)).toEqual(['new-1']);
  });

  it('returns empty queue when no cards are due and new-card budget is exhausted', () => {
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const cards = [dueCard('not-due', futureDate), newCard('new-1')];
    const queue = buildFlashcardReviewQueue(cards, {
      srsNewCardsPerDay: 10,
      newCardsIntroducedToday: 10,
    });

    expect(queue).toEqual([]);
  });

  it('prioritizes due review cards before introducing new cards', () => {
    const cards = [newCard('new-1'), dueCard('due-1')];
    const queue = buildFlashcardReviewQueue(cards, {
      srsNewCardsPerDay: 5,
      newCardsIntroducedToday: 0,
    });

    expect(queue.map((c) => c.id)).toEqual(['due-1', 'new-1']);
  });
});
