import { isCardDue } from '@lantern/shared/utils/srs';

/**
 * Web, mobile and the API server each counted due flashcards their own way, and
 * the counts disagreed — the dashboard showed 38 due on web and 37 on mobile.
 *
 * The cause was mobile requiring `repetitions > 0` in addition to isCardDue, so a
 * card scheduled with a past date but never reviewed counted on web and not on
 * mobile. The agreed rule is that such a card IS due.
 *
 * These tests pin the shared predicate that all three now call, with the edge
 * cases that actually differed.
 */
const HOUR = 60 * 60 * 1000;
const past = () => new Date(Date.now() - 24 * HOUR).toISOString();
const future = () => new Date(Date.now() + 24 * HOUR).toISOString();

describe('isCardDue — cross-platform due-card parity', () => {
  it('counts a scheduled card whose date has passed', () => {
    expect(isCardDue({ nextReviewDate: past(), repetitions: 3, interval: 5, easeFactor: 2.5 })).toBe(true);
  });

  it('counts a past-due card that has never been reviewed (repetitions = 0)', () => {
    // The exact case that made web and mobile disagree.
    expect(isCardDue({ nextReviewDate: past(), repetitions: 0, interval: 0, easeFactor: 2.5 })).toBe(true);
  });

  it('does not count a card scheduled in the future', () => {
    expect(isCardDue({ nextReviewDate: future(), repetitions: 2, interval: 5, easeFactor: 2.5 })).toBe(false);
  });

  it('treats a brand new card with no schedule as not due', () => {
    expect(isCardDue(undefined)).toBe(false);
    expect(isCardDue({})).toBe(false);
  });

  it('counts a dateless card that has been reviewed, since that state is corrupt but real', () => {
    expect(isCardDue({ repetitions: 2, interval: 3, easeFactor: 2.4 })).toBe(true);
    expect(isCardDue({ repetitions: 0, interval: 0, easeFactor: 2.5 })).toBe(false);
  });

  it('accepts every field spelling the three call sites pass', () => {
    // Clients send camelCase; Postgres rows arrive snake_case; the server's old
    // local copy also accepted `nextReview`.
    expect(isCardDue({ nextReviewDate: past(), repetitions: 1 })).toBe(true);
    expect(isCardDue({ next_review_date: past(), repetitions: 1 })).toBe(true);
    expect(isCardDue({ next_review: past(), repetitions: 1 })).toBe(true);
    expect(isCardDue({ nextReview: past(), repetitions: 1 })).toBe(true);
  });

  it('falls back to the repetitions rule when the date is unparseable', () => {
    expect(isCardDue({ nextReviewDate: 'not-a-date', repetitions: 4 })).toBe(true);
    expect(isCardDue({ nextReviewDate: 'not-a-date', repetitions: 0 })).toBe(false);
  });

  it('agrees with a whole-collection count, which is what the dashboards show', () => {
    const cards = [
      { srsData: { nextReviewDate: past(), repetitions: 3 } },      // due
      { srsData: { nextReviewDate: past(), repetitions: 0 } },      // due — the regression case
      { srsData: { nextReviewDate: future(), repetitions: 1 } },    // not due
      { srsData: {} },                                             // new, not due
      { srsData: { repetitions: 2 } },                             // dateless but reviewed → due
    ];
    expect(cards.filter((c) => isCardDue(c.srsData)).length).toBe(3);
  });
});
