import type { TestResult } from '../../types';

/**
 * The arithmetic behind Me — which exam a result belongs to, which groups the
 * chart may offer, how a badge's progress reads and how the test pages count —
 * lives in `@lantern/shared/learning/meProgress` so the phone's Me screen
 * computes the SAME numbers from the SAME code. What stays in this file is the
 * part that is web's alone: `localStorage`, and the web `TestResult` shape.
 */
export {
  RECENT_TESTS_PAGE_SIZE,
  MAX_LEVEL_TEXT,
  averageSecondsPerQuestion,
  buildAchievementRows,
  buildAchievementRowsFromSummaries,
  buildHierarchicalGroupOptions,
  getGroupName,
  recentTestsPageCount,
  type AchievementRow,
  type MeGroupOption,
} from '@lantern/shared/learning';

export const SELECTED_GROUP_CHART_IDS_KEY = 'lantern.dashboard.selectedGroupIds';
export const GROUP_PERF_PERIOD_KEY = 'lantern.dashboard.groupPerfPeriod';

export function normalizeTestResults(rawTestResults: TestResult[]): TestResult[] {
  return rawTestResults
    .filter((result) => result?.session?.startTime)
    .map((result) => ({
      ...result,
      session: {
        ...result.session,
        questions: Array.isArray(result.session.questions) ? result.session.questions : [],
        userAnswers: result.session.userAnswers || {},
        startTime:
          result.session.startTime instanceof Date
            ? result.session.startTime
            : new Date(result.session.startTime),
        endTime: result.session.endTime
          ? result.session.endTime instanceof Date
            ? result.session.endTime
            : new Date(result.session.endTime)
          : undefined,
      },
    }));
}

export function loadSelectedGroupChartIds(): string[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(SELECTED_GROUP_CHART_IDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function saveSelectedGroupChartIds(ids: string[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(SELECTED_GROUP_CHART_IDS_KEY, JSON.stringify(ids));
  } catch {
    // ignore quota / private mode
  }
}

export function loadGroupPerfPeriod(): '7days' | '30days' | '90days' | 'all' {
  try {
    if (typeof localStorage === 'undefined') return 'all';
    const raw = localStorage.getItem(GROUP_PERF_PERIOD_KEY);
    if (raw === '7days' || raw === '30days' || raw === '90days' || raw === 'all') return raw;
  } catch {
    // ignore
  }
  return 'all';
}

export function saveGroupPerfPeriod(period: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(GROUP_PERF_PERIOD_KEY, period);
  } catch {
    // ignore
  }
}
