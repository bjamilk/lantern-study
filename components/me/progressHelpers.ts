import type { Group, OfflineSessionBundle, TestResult } from '../../types';
import type { GroupPerformanceOption } from '../dashboard/GroupPerformanceMultiSelect';

export const SELECTED_GROUP_CHART_IDS_KEY = 'lantern.dashboard.selectedGroupIds';
export const GROUP_PERF_PERIOD_KEY = 'lantern.dashboard.groupPerfPeriod';
export const RECENT_TESTS_PAGE_SIZE = 5;

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

export function getGroupName(
  groupId: string | undefined,
  groups: Group[],
  offlineBundles: OfflineSessionBundle[] = [],
  storedName?: string
): string {
  const group = groups.find((g) => g.id === groupId);
  if (group) return group.name;
  if (storedName) return storedName;
  const bundle = offlineBundles.find((b) => b.config.groupId === groupId);
  const bundleName = bundle?.displayName || bundle?.config.groupName || bundle?.groupName;
  if (bundleName) return bundleName;
  return groupId ? 'Unknown Exam' : 'Unknown Exam';
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

export function buildHierarchicalGroupOptions(
  historyGroups: Group[],
  dataIds: Set<string>
): GroupPerformanceOption[] {
  const byParent = new Map<string | null, Group[]>();
  for (const group of historyGroups) {
    const parentKey = group.parentId || null;
    const list = byParent.get(parentKey) || [];
    list.push(group);
    byParent.set(parentKey, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  const options: GroupPerformanceOption[] = [];
  const walk = (parentId: string | null, level: number) => {
    const children = byParent.get(parentId) || [];
    for (const child of children) {
      if (dataIds.has(child.id)) {
        options.push({ id: child.id, name: child.name, level });
      }
      walk(child.id, level + 1);
    }
  };

  const historyIds = new Set(historyGroups.map((g) => g.id));
  const roots = historyGroups
    .filter((g) => !g.parentId || !historyIds.has(g.parentId))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const root of roots) {
    if (dataIds.has(root.id)) {
      options.push({ id: root.id, name: root.name, level: 0 });
    }
    walk(root.id, 1);
  }

  const seen = new Set<string>();
  return options.filter((opt) => {
    if (seen.has(opt.id)) return false;
    seen.add(opt.id);
    return true;
  });
}
