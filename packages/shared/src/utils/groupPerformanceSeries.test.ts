import {
  filterResultsByGroupPerformancePeriod,
  type LeanTestResultLike,
} from './groupPerformanceSeries';

function resultAt(daysAgo: number, id: string): LeanTestResultLike {
  const start = new Date();
  start.setDate(start.getDate() - daysAgo);
  start.setHours(12, 0, 0, 0);
  return {
    id,
    score: 80,
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
