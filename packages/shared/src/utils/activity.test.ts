import {
  getActivityHeatLevel,
  getActivityHeatTailwindClass,
  getActivityHeatHexColor,
  getActivityHeatColorForCount,
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
    expect(getActivityHeatTailwindClass(0, 'light')).toBe('bg-gray-200');
    expect(getActivityHeatTailwindClass(1, 'light')).toBe('bg-green-200');
    expect(getActivityHeatTailwindClass(0, 'dark')).toBe('bg-slate-700');
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
