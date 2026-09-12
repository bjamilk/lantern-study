import {
  buildAchievementRows,
  buildHierarchicalGroupOptions,
  getGroupName,
  loadGroupPerfPeriod,
  loadSelectedGroupChartIds,
  normalizeTestResults,
  RECENT_TESTS_PAGE_SIZE,
  recentTestsPageCount,
  saveGroupPerfPeriod,
  saveSelectedGroupChartIds,
} from './progressHelpers';
import * as sharedMeProgress from '@lantern/shared/learning';
import type { Group, TestResult } from '../../types';

/**
 * Me's arithmetic moved into `@lantern/shared/learning/meProgress` so the phone
 * could compute the SAME figures. This file guards the seam: the web module
 * must keep handing back the shared implementations (not a second copy that
 * drifts), and the parts that stayed here — localStorage, the web
 * `TestResult` shape — must still work.
 */
describe('progressHelpers', () => {
  it('re-exports the shared implementations rather than its own copy', () => {
    expect(getGroupName).toBe(sharedMeProgress.getGroupName);
    expect(buildHierarchicalGroupOptions).toBe(sharedMeProgress.buildHierarchicalGroupOptions);
    expect(buildAchievementRows).toBe(sharedMeProgress.buildAchievementRows);
    expect(recentTestsPageCount).toBe(sharedMeProgress.recentTestsPageCount);
    expect(RECENT_TESTS_PAGE_SIZE).toBe(sharedMeProgress.RECENT_TESTS_PAGE_SIZE);
  });

  it('still names a group, and still falls back when it is gone', () => {
    const groups = [{ id: 'g1', name: 'Pharmacology' }] as Group[];
    expect(getGroupName('g1', groups)).toBe('Pharmacology');
    expect(getGroupName('gone', groups, [], 'Anatomy MCQ')).toBe('Anatomy MCQ');
    expect(getGroupName(undefined, groups)).toBe('Unknown Exam');
  });

  it('still offers only groups that have data, with their depth', () => {
    const groups = [
      { id: 'root', name: 'Year 2' },
      { id: 'child', name: 'Alpha', parentId: 'root' },
    ] as Group[];
    expect(buildHierarchicalGroupOptions(groups, new Set(['child']))).toEqual([
      { id: 'child', name: 'Alpha', level: 1 },
    ]);
  });

  it('normalizes the web TestResult shape — dates in, missing collections filled', () => {
    const raw = [
      { session: { startTime: '2026-01-02T03:04:05.000Z' } },
      { session: {} },
    ] as unknown as TestResult[];
    const normalized = normalizeTestResults(raw);
    expect(normalized).toHaveLength(1);
    expect(normalized[0].session.startTime).toBeInstanceOf(Date);
    expect(normalized[0].session.questions).toEqual([]);
    expect(normalized[0].session.userAnswers).toEqual({});
  });

  it('keeps the chart selection and the period in localStorage', () => {
    withLocalStorage(() => {
      expect(loadSelectedGroupChartIds()).toEqual([]);
      saveSelectedGroupChartIds(['a', 'b']);
      expect(loadSelectedGroupChartIds()).toEqual(['a', 'b']);

      expect(loadGroupPerfPeriod()).toBe('all');
      saveGroupPerfPeriod('30days');
      expect(loadGroupPerfPeriod()).toBe('30days');
    });
  });

  it('survives a corrupt stored selection instead of throwing at render', () => {
    withLocalStorage(() => {
      localStorage.setItem('lantern.dashboard.selectedGroupIds', '{not json');
      expect(loadSelectedGroupChartIds()).toEqual([]);
    });
  });

  it('reads as empty where there is no storage at all, rather than throwing', () => {
    // Server rendering and the test runner's node environment both have no
    // `localStorage`; Me must still build.
    expect(loadSelectedGroupChartIds()).toEqual([]);
    expect(loadGroupPerfPeriod()).toBe('all');
    expect(() => saveGroupPerfPeriod('7days')).not.toThrow();
  });
});

/**
 * These suites run in vitest's node environment, which has no `localStorage`
 * — the one thing this module still owns. An in-memory stand-in for the body
 * of a test, removed afterwards so the no-storage case above stays honest.
 */
function withLocalStorage(body: () => void): void {
  const store = new Map<string, string>();
  const stub = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: stub,
    configurable: true,
    writable: true,
  });
  try {
    body();
  } finally {
    Reflect.deleteProperty(globalThis, 'localStorage');
  }
}
