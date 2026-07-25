import { getGroupIdWithDescendants, type GroupTreeNode } from './groupTree';

export interface LeanTestResultLike {
  id?: string;
  score: number;
  totalQuestions: number;
  correctAnswersCount: number;
  session: {
    id?: string;
    startTime?: string | Date;
    config?: { groupId?: string; groupName?: string };
  };
}

export interface GroupSeriesPoint {
  x: string;
  y: number | null;
}

export interface RolledUpGroupSeries {
  id: string;
  name: string;
  testCount: number;
  totalScore: number;
  averageScore: number;
  correctAnswers: number;
  totalQuestions: number;
  accuracy: number;
  chartData: GroupSeriesPoint[];
  weeklyChartData: GroupSeriesPoint[];
  includesDescendants: boolean;
}

/** Period window for Group performance charts (independent of other dashboard filters). */
export type GroupPerformancePeriod = '7days' | '30days' | '90days' | 'all';

export const GROUP_PERFORMANCE_PERIOD_OPTIONS: ReadonlyArray<{
  value: GroupPerformancePeriod;
  label: string;
  shortLabel: string;
}> = [
  { value: '7days', label: 'Last 7 Days', shortLabel: '7d' },
  { value: '30days', label: 'Last 30 Days', shortLabel: '30d' },
  { value: '90days', label: 'Last 90 Days', shortLabel: '90d' },
  { value: 'all', label: 'All Time', shortLabel: 'All' },
];

function toDate(value?: string | Date): Date {
  if (!value) return new Date(0);
  return value instanceof Date ? value : new Date(value);
}

export function getGroupPerformancePeriodCutoff(period: GroupPerformancePeriod): Date | null {
  if (period === 'all') return null;
  const days = period === '7days' ? 7 : period === '30days' ? 30 : 90;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  cutoff.setHours(0, 0, 0, 0);
  return cutoff;
}

export function filterResultsByGroupPerformancePeriod<T extends LeanTestResultLike>(
  results: T[],
  period: GroupPerformancePeriod
): T[] {
  const cutoff = getGroupPerformancePeriodCutoff(period);
  if (!cutoff) return results;
  return results.filter((result) => toDate(result.session.startTime) >= cutoff);
}

export function getIsoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function buildRolledUpGroupSeries(params: {
  groupId: string;
  groupName: string;
  groups: GroupTreeNode[];
  results: LeanTestResultLike[];
  activeOnly?: boolean;
}): RolledUpGroupSeries {
  const rollupIds = getGroupIdWithDescendants(params.groupId, params.groups, {
    activeOnly: params.activeOnly !== false,
  });
  const includesDescendants = rollupIds.size > 1;

  const groupResults = params.results
    .filter((r) => {
      const gid = r.session.config?.groupId;
      return typeof gid === 'string' && rollupIds.has(gid);
    })
    .sort(
      (a, b) => toDate(a.session.startTime).getTime() - toDate(b.session.startTime).getTime()
    );

  let totalScore = 0;
  let correctAnswers = 0;
  let totalQuestions = 0;
  for (const result of groupResults) {
    totalScore += result.score;
    correctAnswers += result.correctAnswersCount;
    totalQuestions += result.totalQuestions;
  }

  const testCount = groupResults.length;
  const chartData: GroupSeriesPoint[] = groupResults.map((result, index) => {
    const date = toDate(result.session.startTime);
    const formattedDate = `${(date.getMonth() + 1).toString().padStart(2, '0')}/${date
      .getDate()
      .toString()
      .padStart(2, '0')}`;
    return {
      x: `Test ${index + 1} - ${formattedDate}`,
      y: result.score,
    };
  });

  const weeklyScores = new Map<string, { scores: number[]; count: number }>();
  for (const result of groupResults) {
    const weekKey = getIsoWeekKey(toDate(result.session.startTime));
    const weekData = weeklyScores.get(weekKey) || { scores: [], count: 0 };
    weekData.scores.push(result.score);
    weekData.count++;
    weeklyScores.set(weekKey, weekData);
  }

  const weeklyChartData: GroupSeriesPoint[] = Array.from(weeklyScores.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([weekKey, { scores, count }]) => ({
      x: weekKey,
      y: scores.reduce((sum, s) => sum + s, 0) / count,
    }));

  return {
    id: params.groupId,
    name: params.groupName,
    testCount,
    totalScore,
    averageScore: testCount > 0 ? totalScore / testCount : 0,
    correctAnswers,
    totalQuestions,
    accuracy: totalQuestions > 0 ? (correctAnswers / totalQuestions) * 100 : 0,
    chartData,
    weeklyChartData,
    includesDescendants,
  };
}
