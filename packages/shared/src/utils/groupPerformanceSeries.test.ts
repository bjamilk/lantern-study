import {
  buildRolledUpGroupSeries,
  filterResultsByGroupPerformancePeriod,
  type LeanTestResultLike,
} from './groupPerformanceSeries';

function resultAt(daysAgo: number, id: string, score = 80): LeanTestResultLike {
  const start = new Date();
  start.setDate(start.getDate() - daysAgo);
  start.setHours(12, 0, 0, 0);
  return {
    id,
    score,
    totalQuestions: 10,
    correctAnswersCount: 8,
    session: {
      id,
      startTime: start.toISOString(),
      config: { groupId: 'g1', groupName: 'Anatomy' },
    },
  };
}

describe('filterResultsByGroupPerformancePeriod', () => {
  const results = [resultAt(2, 'a'), resultAt(20, 'b'), resultAt(45, 'c'), resultAt(120, 'd')];

  it('keeps all results for all', () => {
    expect(filterResultsByGroupPerformancePeriod(results, 'all')).toHaveLength(4);
  });

  it('filters last 7 days', () => {
    const ids = filterResultsByGroupPerformancePeriod(results, '7days').map((r) => r.id);
    expect(ids).toEqual(['a']);
  });

  it('filters last 30 days', () => {
    const ids = filterResultsByGroupPerformancePeriod(results, '30days').map((r) => r.id);
    expect(ids).toEqual(['a', 'b']);
  });

  it('filters last 90 days', () => {
    const ids = filterResultsByGroupPerformancePeriod(results, '90days').map((r) => r.id);
    expect(ids).toEqual(['a', 'b', 'c']);
  });
});

describe('buildRolledUpGroupSeries', () => {
  it('includes oldest-through-newest points for all-time history', () => {
    // Unsorted input spanning well beyond a 500-result / 90-day window.
    const results = [
      resultAt(2, 'newest', 90),
      resultAt(400, 'oldest', 50),
      resultAt(200, 'mid', 70),
    ];
    for (let i = 0; i < 12; i++) {
      results.push(resultAt(30 + i * 7, `w${i}`, 60 + i));
    }

    const series = buildRolledUpGroupSeries({
      groupId: 'g1',
      groupName: 'Anatomy',
      groups: [{ id: 'g1' }],
      results,
      activeOnly: true,
    });

    expect(series.testCount).toBe(results.length);
    expect(series.chartData).toHaveLength(results.length);
    expect(series.chartData[0].y).toBe(50);
    expect(series.chartData[series.chartData.length - 1].y).toBe(90);
    expect(series.chartData[0].x.startsWith('Test 1')).toBe(true);
    expect(series.chartData[series.chartData.length - 1].x.startsWith(`Test ${results.length}`)).toBe(
      true
    );
    expect(series.weeklyChartData.length).toBeGreaterThan(0);
  });
});
