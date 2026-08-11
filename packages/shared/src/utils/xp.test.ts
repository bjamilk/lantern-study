import { computeActivityXp } from './xp';

describe('computeActivityXp', () => {
  it('awards full rate for the first tests of the day', () => {
    expect(computeActivityXp({ type: 'test', amount: 1, priorAmountToday: 0 })).toBe(15);
    expect(computeActivityXp({ type: 'test', amount: 3, priorAmountToday: 0 })).toBe(45);
  });

  it('diminishes after the full-rate window', () => {
    // 4th test of the day: reduced rate.
    expect(computeActivityXp({ type: 'test', amount: 1, priorAmountToday: 3 })).toBe(5);
    // Mixed: 2 full + 2 reduced.
    expect(computeActivityXp({ type: 'test', amount: 4, priorAmountToday: 1 })).toBe(40);
  });

  it('enforces the daily cap', () => {
    // Prior 9 tests = 45 + 6*5 = 75 XP already — at the 75 cap.
    expect(computeActivityXp({ type: 'test', amount: 5, priorAmountToday: 9 })).toBe(0);
    // Prior 8 = 70 XP; one more would be 5, still within cap.
    expect(computeActivityXp({ type: 'test', amount: 5, priorAmountToday: 8 })).toBe(5);
  });

  it('scales scored types by quality: 100% earns 2x a 0%', () => {
    const perfect = computeActivityXp({ type: 'test', amount: 1, priorAmountToday: 0, scorePercent: 100 });
    const failed = computeActivityXp({ type: 'test', amount: 1, priorAmountToday: 0, scorePercent: 0 });
    const twenty = computeActivityXp({ type: 'test', amount: 1, priorAmountToday: 0, scorePercent: 20 });
    expect(perfect).toBe(15);
    expect(failed).toBe(8); // 15 * 0.5, rounded
    expect(twenty).toBe(9); // 15 * 0.6
    expect(perfect).toBeGreaterThan(twenty);
  });

  it('does not scale unscored types by quality', () => {
    expect(
      computeActivityXp({ type: 'flashcard', amount: 10, priorAmountToday: 0, scorePercent: 0 })
    ).toBe(5); // 10 cards * 0.5, quality ignored
  });

  it('flashcards: 1 XP per 2 cards up to the 20 XP cap', () => {
    expect(computeActivityXp({ type: 'flashcard', amount: 40, priorAmountToday: 0 })).toBe(20);
    expect(computeActivityXp({ type: 'flashcard', amount: 500, priorAmountToday: 0 })).toBe(20);
    expect(computeActivityXp({ type: 'flashcard', amount: 10, priorAmountToday: 40 })).toBe(0);
  });

  it('daily quiz awards once', () => {
    expect(computeActivityXp({ type: 'daily_quiz', amount: 1, priorAmountToday: 0 })).toBe(5);
    expect(computeActivityXp({ type: 'daily_quiz', amount: 1, priorAmountToday: 1 })).toBe(0);
  });

  it('unknown types and zero amounts award nothing', () => {
    expect(computeActivityXp({ type: 'mystery', amount: 5, priorAmountToday: 0 })).toBe(0);
    expect(computeActivityXp({ type: 'test', amount: 0, priorAmountToday: 0 })).toBe(0);
  });
});
