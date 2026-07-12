import {
  getActivityHeatLevel,
  getActivityHeatTailwindClass,
  getActivityHeatHexColor,
  getActivityHeatColorForCount,
  computeStudyStreak,
} from './activity';

describe('getActivityHeatLevel', () => {
  it('returns 0 for zero or negative counts', () => {
    expect(getActivityHeatLevel(0)).toBe(0);
    expect(getActivityHeatLevel(-1)).toBe(0);
  });

  it('returns 1 for a single activity', () => {
    expect(getActivityHeatLevel(1)).toBe(1);
  });

  it('returns 2 for 2–4 activities', () => {
    expect(getActivityHeatLevel(2)).toBe(2);
    expect(getActivityHeatLevel(4)).toBe(2);
  });

  it('returns 3 for 5–9 activities', () => {
    expect(getActivityHeatLevel(5)).toBe(3);
    expect(getActivityHeatLevel(9)).toBe(3);
  });

  it('returns 4 for 10+ activities', () => {
    expect(getActivityHeatLevel(10)).toBe(4);
    expect(getActivityHeatLevel(50)).toBe(4);
  });
});

describe('getActivityHeatTailwindClass', () => {
  it('maps each level to distinct light and dark classes', () => {
    expect(getActivityHeatTailwindClass(0, 'light')).toBe('bg-lantern-background-secondary');
    expect(getActivityHeatTailwindClass(1, 'light')).toBe('bg-green-200');
    expect(getActivityHeatTailwindClass(0, 'dark')).toBe('bg-lantern-surface-secondary');
    expect(getActivityHeatTailwindClass(4, 'dark')).toBe('bg-green-400');
  });
});

describe('getActivityHeatHexColor', () => {
  it('returns a hex color for each level', () => {
    expect(getActivityHeatHexColor(0)).toMatch(/^#/);
    expect(getActivityHeatHexColor(4)).toMatch(/^#/);
  });
});

describe('getActivityHeatColorForCount', () => {
  it('uses absolute tiers so one activity is always the lightest green', () => {
    expect(getActivityHeatColorForCount(1, 'light')).toBe('bg-green-200');
    expect(getActivityHeatColorForCount(1, 'dark')).toBe('bg-green-900');
  });
});

describe('computeStudyStreak', () => {
  const ref = new Date(2026, 5, 15); // 2026-06-15 local

  it('returns zero when there is no activity', () => {
    expect(computeStudyStreak([], ref)).toEqual({
      current: 0,
      longest: 0,
      lastActiveDate: null,
    });
  });

  it('counts consecutive days ending today', () => {
    const result = computeStudyStreak(
      [
        { date: '2026-06-15', count: 2 },
        { date: '2026-06-14', count: 1 },
        { date: '2026-06-13', count: 3 },
      ],
      ref
    );
    expect(result.current).toBe(3);
    expect(result.longest).toBe(3);
    expect(result.lastActiveDate).toBe('2026-06-15');
  });

  it('counts from yesterday when today has no activity yet', () => {
    const result = computeStudyStreak(
      [
        { date: '2026-06-14', count: 1 },
        { date: '2026-06-13', count: 1 },
      ],
      ref
    );
    expect(result.current).toBe(2);
    expect(result.longest).toBe(2);
  });

  it('returns zero current streak when last activity was before yesterday', () => {
    const result = computeStudyStreak([{ date: '2026-06-12', count: 5 }], ref);
    expect(result.current).toBe(0);
    expect(result.longest).toBe(1);
  });

  it('tracks longest streak across gaps in history', () => {
    const result = computeStudyStreak(
      [
        { date: '2026-06-15', count: 1 },
        { date: '2026-06-10', count: 1 },
        { date: '2026-06-09', count: 1 },
        { date: '2026-06-08', count: 1 },
        { date: '2026-06-07', count: 1 },
      ],
      ref
    );
    expect(result.current).toBe(1);
    expect(result.longest).toBe(4);
  });
});
