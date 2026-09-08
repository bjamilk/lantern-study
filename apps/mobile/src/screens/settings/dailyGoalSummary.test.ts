import { dailyGoalSummary } from './dailyGoalSummary';

describe('dailyGoalSummary', () => {
  it('uses the singular for a goal of one', () => {
    expect(dailyGoalSummary(1, 1)).toBe('1 card, 1 test');
  });

  it('uses the plural for zero and for many', () => {
    expect(dailyGoalSummary(0, 0)).toBe('0 cards, 0 tests');
    expect(dailyGoalSummary(20, 2)).toBe('20 cards, 2 tests');
  });
});
