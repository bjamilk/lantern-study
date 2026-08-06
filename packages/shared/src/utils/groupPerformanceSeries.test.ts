import {
  buildRolledUpGroupSeries,
  filterResultsByGroupPerformancePeriod,
  resolveResultGroupId,
  withResolvedGroupIds,
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

describe('resolveResultGroupId', () => {
  const groups = [
    { id: 'g1', name: 'Anatomy' },
    { id: 'g2', name: 'Biochem' },
  ];

  it('keeps a valid study-group id', () => {
    expect(resolveResultGroupId(resultAt(1, 'a'), groups)).toBe('g1');
  });

  it('recovers from custom/deck ids via "Name Test" groupName', () => {
    const bad: LeanTestResultLike = {
      ...resultAt(1, 'b', 75),
      session: {
        id: 'b',
        startTime: new Date().toISOString(),
        config: { groupId: 'custom-123', groupName: 'Anatomy Test' },
      },
    };
    expect(resolveResultGroupId(bad, groups)).toBe('g1');
    expect(withResolvedGroupIds([bad], groups)[0]?.session.config?.groupId).toBe('g1');
  });
});

describe('buildRolledUpGroupSeries', () => {
  it('includes mis-attributed mobile draft rows via groupName fallback', () => {
    const results: LeanTestResultLike[] = [
      resultAt(10, 'old', 70),
      {
        id: 'new',
        score: 88,
        totalQuestions: 10,
        correctAnswersCount: 9,
        session: {
          id: 'new',
          startTime: new Date().toISOString(),
          config: { groupId: 'custom-999', groupName: 'Anatomy Test' },
        },
      },
    ];
    const series = buildRolledUpGroupSeries({
      groupId: 'g1',
      groupName: 'Anatomy',
      groups: [{ id: 'g1', name: 'Anatomy' }],
      results,
      activeOnly: true,
    });
    expect(series.testCount).toBe(2);
    expect(series.chartData.at(-1)?.y).toBe(88);
  });

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
