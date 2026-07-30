import {
  FlashcardReviewAdvanceGuard,
  resolveAutoAdvanceDelayMs,
} from './flashcardReviewAdvance';

describe('FlashcardReviewAdvanceGuard', () => {
  it('allows one advance per card and blocks duplicates', () => {
    const guard = new FlashcardReviewAdvanceGuard();
    guard.setActiveCard('a');

    const first = guard.tryClaimAdvance('a');
    expect(first.ok).toBe(true);
    expect(guard.tryClaimAdvance('a')).toEqual({ ok: false, reason: 'already_rated' });
  });

  it('rejects stale claims when the visible card has already changed', () => {
    const guard = new FlashcardReviewAdvanceGuard();
    guard.setActiveCard('b');
    expect(guard.tryClaimAdvance('a')).toEqual({ ok: false, reason: 'stale_card' });
  });

  it('invalidates delayed advances after a newer claim', () => {
    const guard = new FlashcardReviewAdvanceGuard();
    guard.setActiveCard('a');
    const first = guard.tryClaimAdvance('a');
    expect(first.ok).toBe(true);
    guard.setActiveCard('b');
    const second = guard.tryClaimAdvance('b');
    expect(second.ok).toBe(true);
    expect(guard.isAdvanceGenerationCurrent(first.generation!)).toBe(false);
    expect(guard.isAdvanceGenerationCurrent(second.generation!)).toBe(true);
  });

  it('reset clears rated ids', () => {
    const guard = new FlashcardReviewAdvanceGuard();
    guard.setActiveCard('a');
    guard.tryClaimAdvance('a');
    guard.reset();
    guard.setActiveCard('a');
    expect(guard.tryClaimAdvance('a').ok).toBe(true);
  });
});

describe('resolveAutoAdvanceDelayMs', () => {
  it('returns 0 for unset / non-positive values', () => {
    expect(resolveAutoAdvanceDelayMs(0)).toBe(0);
    expect(resolveAutoAdvanceDelayMs(-1)).toBe(0);
    expect(resolveAutoAdvanceDelayMs(undefined)).toBe(0);
    expect(resolveAutoAdvanceDelayMs('nope')).toBe(0);
  });

  it('converts seconds to ms and clamps at 30s', () => {
    expect(resolveAutoAdvanceDelayMs(1.5)).toBe(1500);
    expect(resolveAutoAdvanceDelayMs(60)).toBe(30_000);
  });
});
