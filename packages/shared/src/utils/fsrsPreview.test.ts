import { previewFsrsIntervals, formatStudyInterval } from './fsrs';

describe('previewFsrsIntervals', () => {
  it('returns an interval for every grade and orders again <= good <= easy for a new card', () => {
    const p = previewFsrsIntervals(undefined);
    expect(Object.keys(p).sort()).toEqual(['again', 'easy', 'good', 'hard']);
    expect(p.again).toBeGreaterThanOrEqual(1);
    expect(p.easy).toBeGreaterThanOrEqual(p.good);
    expect(p.good).toBeGreaterThanOrEqual(p.again);
  });

  it('respects the maxInterval cap', () => {
    const p = previewFsrsIntervals(
      { repetitions: 20, easeFactor: 2.5, interval: 300, nextReviewDate: '2030-01-01T00:00:00Z', stability: 400 } as never,
      { maxInterval: 30 }
    );
    expect(p.easy).toBeLessThanOrEqual(30);
  });
});

describe('formatStudyInterval', () => {
  it('formats days, weeks, months, years', () => {
    expect(formatStudyInterval(1)).toBe('1d');
    expect(formatStudyInterval(6)).toBe('6d');
    expect(formatStudyInterval(14)).toBe('2w');
    expect(formatStudyInterval(90)).toBe('3mo');
    expect(formatStudyInterval(365)).toBe('1y');
    expect(formatStudyInterval(0)).toBe('1d');
  });
});
