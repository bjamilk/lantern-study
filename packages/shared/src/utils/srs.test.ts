import { isCardDue, getCardsDue, normalizeSrsData } from './srs';
import type { SrsData } from '../types';

describe('isCardDue', () => {
  it('does not treat brand-new / unscheduled cards as due', () => {
    expect(isCardDue(undefined)).toBe(false);
    expect(isCardDue({} as SrsData)).toBe(false);
    expect(
      isCardDue({
        interval: 0,
        easeFactor: 2.5,
        repetitions: 0,
        nextReviewDate: undefined as unknown as string,
      })
    ).toBe(false);
  });

  it('does not treat reviewed cards as due when only snake_case next_review_date is set', () => {
    // Regression: web assigned raw API srs_data without mapping; isCardDue only
    // read nextReviewDate and treated repetitions>0 + missing date as forever-due.
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    expect(
      isCardDue({
        interval: 3,
        ease_factor: 2.5,
        repetitions: 1,
        next_review_date: future,
      } as unknown as SrsData)
    ).toBe(false);
    expect(normalizeSrsData({ next_review_date: future, repetitions: 1, interval: 3 })?.nextReviewDate).toBe(
      future
    );
  });

  it('treats scheduled cards as due when nextReviewDate is in the past', () => {
    expect(
      isCardDue({
        interval: 1,
        easeFactor: 2.5,
        repetitions: 2,
        nextReviewDate: '2000-01-01T00:00:00.000Z',
      })
    ).toBe(true);
  });

  it('treats scheduled cards as not due when nextReviewDate is in the future', () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    expect(
      isCardDue({
        interval: 7,
        easeFactor: 2.5,
        repetitions: 3,
        nextReviewDate: future,
      })
    ).toBe(false);
  });

  it('treats learning cards with repetitions but missing date as due', () => {
    expect(
      isCardDue({
        interval: 1,
        easeFactor: 2.5,
        repetitions: 1,
        nextReviewDate: undefined as unknown as string,
      })
    ).toBe(true);
  });

  it('getCardsDue excludes new cards', () => {
    const cards = [
      { id: 'new', srsData: undefined },
      {
        id: 'due',
        srsData: {
          interval: 1,
          easeFactor: 2.5,
          repetitions: 2,
          nextReviewDate: '2000-01-01T00:00:00.000Z',
        },
      },
      {
        id: 'later',
        srsData: {
          interval: 7,
          easeFactor: 2.5,
          repetitions: 2,
          nextReviewDate: new Date(Date.now() + 86400000).toISOString(),
        },
      },
    ];
    expect(getCardsDue(cards).map((c) => c.id)).toEqual(['due']);
  });
});
