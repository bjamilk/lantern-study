import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Group, OfflineSessionBundle, TestResult, UserAnswerRecord } from '../../types';
import type { RawTestResult } from '@lantern/shared/utils/buildDashboardStats';
import {
  buildRolledUpGroupSeries,
  filterResultsByGroupPerformancePeriod,
  getGroupIdWithDescendants,
  GROUP_PERFORMANCE_PERIOD_OPTIONS,
  withResolvedGroupIds,
  type GroupPerformancePeriod,
} from '@lantern/shared/utils';
import { useUIStore } from '../../stores/uiStore';
import GroupPerformanceChart, { type ChartDataPoint } from '../GroupPerformanceChart';
import {
  GroupPerformanceMultiSelect,
} from '../dashboard/GroupPerformanceMultiSelect';
import { AppIcon } from '../ui/AppIcon';
import {
  buildHierarchicalGroupOptions,
  getGroupName,
  loadGroupPerfPeriod,
  loadSelectedGroupChartIds,
  normalizeTestResults,
  saveGroupPerfPeriod,
  saveSelectedGroupChartIds,
} from './progressHelpers';

interface GroupPerformanceData {
  id: string;
  name: string;
  testCount: number;
  totalScore: number;
  averageScore: number;
  correctAnswers: number;
  totalQuestions: number;
  accuracy: number;
  totalTimeSpentSeconds: number;
  questionsWithTimeData: number;
  averageTimePerQuestion: number;
  chartData: ChartDataPoint[];
  weeklyChartData: ChartDataPoint[];
}

interface GroupPerformanceCardProps {
  testResults: TestResult[];
  groups: Group[];
  offlineBundles?: OfflineSessionBundle[];
  theme: 'light' | 'dark';
}

export const GroupPerformanceCard: React.FC<GroupPerformanceCardProps> = ({
  testResults: rawTestResults,
  groups,
  offlineBundles = [],
  theme,
}) => {
  const { lowDataMode } = useUIStore();
  const initialTestResults = useMemo(() => normalizeTestResults(rawTestResults), [rawTestResults]);
  const [chartDisplayMode, setChartDisplayMode] = useState<'bar' | 'line'>('line');
  const [groupPerfPeriod, setGroupPerfPeriod] = useState<GroupPerformancePeriod>(() => loadGroupPerfPeriod());
  const [selectedGroupChartIds, setSelectedGroupChartIds] = useState<string[]>(() => loadSelectedGroupChartIds());
  const [allGroupPerformanceData, setAllGroupPerformanceData] = useState<GroupPerformanceData[]>([]);

  const groupPerformanceResults = useMemo(() => {
    const byStartTime = new Map<number, TestResult>();
    for (const r of initialTestResults) {
      const ts = new Date(r.session.startTime).getTime();
      const existing = byStartTime.get(ts);
      if (!existing || (!existing.id && r.id)) {
        byStartTime.set(ts, r);
      }
    }
    const resolved = withResolvedGroupIds(
      Array.from(byStartTime.values()) as unknown as RawTestResult[],
      groups.map((g) => ({ id: g.id, name: g.name }))
    );
    return filterResultsByGroupPerformancePeriod(
      resolved as unknown as TestResult[],
      groupPerfPeriod
    );
  }, [initialTestResults, groupPerfPeriod, groups]);

  const handleGroupPerfPeriodChange = useCallback((period: GroupPerformancePeriod) => {
    setGroupPerfPeriod(period);
    saveGroupPerfPeriod(period);
  }, []);

  useEffect(() => {
    const groupPerformanceMap: Map<string, GroupPerformanceData> = new Map();
    if (groupPerformanceResults.length > 0) {
      groupPerformanceResults.forEach((result) => {
        const groupId = result.session.config?.groupId;
        if (!groupId) return;
        const groupName = getGroupName(groupId, groups, offlineBundles, result.session.config?.groupName);

        let data = groupPerformanceMap.get(groupId);
        if (!data) {
          data = {
            id: groupId,
            name: groupName,
            testCount: 0,
            totalScore: 0,
            averageScore: 0,
            correctAnswers: 0,
            totalQuestions: 0,
            accuracy: 0,
            totalTimeSpentSeconds: 0,
            questionsWithTimeData: 0,
            averageTimePerQuestion: 0,
            chartData: [],
            weeklyChartData: [],
          };
        }

        data.testCount++;
        data.totalScore += result.score;
        data.correctAnswers += result.correctAnswersCount;
        data.totalQuestions += result.totalQuestions;

        Object.values(result.session.userAnswers || {}).forEach((answer: UserAnswerRecord) => {
          if (answer.timeSpentSeconds !== undefined) {
            data.totalTimeSpentSeconds += answer.timeSpentSeconds;
            data.questionsWithTimeData++;
          }
        });

        groupPerformanceMap.set(groupId, data);
      });

      groupPerformanceMap.forEach((data) => {
        data.averageScore = data.testCount > 0 ? data.totalScore / data.testCount : 0;
        data.accuracy = data.totalQuestions > 0 ? (data.correctAnswers / data.totalQuestions) * 100 : 0;
        data.averageTimePerQuestion =
          data.questionsWithTimeData > 0 ? data.totalTimeSpentSeconds / data.questionsWithTimeData : 0;

        const groupSpecificResults = groupPerformanceResults
          .filter((tr) => tr.session.config?.groupId === data.id)
          .sort((a, b) => new Date(a.session.startTime).getTime() - new Date(b.session.startTime).getTime());

        data.chartData = groupSpecificResults.map((result, index) => {
          const date = new Date(result.session.startTime);
          const formattedDate = `${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}`;
          return {
            x: `Test ${index + 1} - ${formattedDate}`,
            y: result.score,
          };
        });

        const weeklyScores: Map<string, { scores: number[]; count: number }> = new Map();
        const getWeek = (date: Date): string => {
          const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
          d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
          const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
          const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
          return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
        };

        groupSpecificResults.forEach((result) => {
          const weekKey = getWeek(new Date(result.session.startTime));
          const weekData = weeklyScores.get(weekKey) || { scores: [], count: 0 };
          weekData.scores.push(result.score);
          weekData.count++;
          weeklyScores.set(weekKey, weekData);
        });

        data.weeklyChartData = Array.from(weeklyScores.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([weekKey, { scores, count }]) => ({
            x: weekKey,
            y: scores.reduce((a, b) => a + b, 0) / count,
          }));
      });
    }
    setAllGroupPerformanceData(
      Array.from(groupPerformanceMap.values()).sort((a, b) => a.name.localeCompare(b.name))
    );
  }, [groupPerformanceResults, groups, offlineBundles]);

  const activeGroupChartOptions = useMemo(() => {
    const historyGroups = groups;
    const directDataIds = new Set(
      allGroupPerformanceData
        .filter((row) => historyGroups.some((g) => g.id === row.id))
        .map((row) => row.id)
    );
    const dataIds = new Set<string>();
    for (const group of historyGroups) {
      const rollup = getGroupIdWithDescendants(group.id, historyGroups, { activeOnly: false });
      for (const id of rollup) {
        if (directDataIds.has(id)) {
          dataIds.add(group.id);
          break;
        }
      }
    }
    return buildHierarchicalGroupOptions(historyGroups, dataIds);
  }, [groups, allGroupPerformanceData]);

  useEffect(() => {
    const validIds = new Set(activeGroupChartOptions.map((opt) => opt.id));
    setSelectedGroupChartIds((prev) => {
      const pruned = prev.filter((id) => validIds.has(id));
      if (pruned.length === 0 && activeGroupChartOptions.length > 0) {
        const next = [activeGroupChartOptions[0].id];
        saveSelectedGroupChartIds(next);
        return next;
      }
      if (pruned.length !== prev.length) {
        saveSelectedGroupChartIds(pruned);
        return pruned;
      }
      return prev;
    });
  }, [activeGroupChartOptions]);

  const handleSelectedGroupChartIdsChange = useCallback((ids: string[]) => {
    setSelectedGroupChartIds(ids);
    saveSelectedGroupChartIds(ids);
  }, []);

  const selectedGroupPerformance = useMemo(() => {
    const historyGroups = groups;
    const optionIds = new Set(activeGroupChartOptions.map((opt) => opt.id));
    return selectedGroupChartIds
      .filter((id) => optionIds.has(id))
      .map((id) => {
        const name =
          historyGroups.find((g) => g.id === id)?.name ||
          allGroupPerformanceData.find((row) => row.id === id)?.name ||
          getGroupName(id, groups, offlineBundles);
        return buildRolledUpGroupSeries({
          groupId: id,
          groupName: name,
          groups: historyGroups,
          results: groupPerformanceResults,
          activeOnly: false,
        });
      })
      .filter((row) => row.testCount > 0);
  }, [
    groups,
    offlineBundles,
    activeGroupChartOptions,
    selectedGroupChartIds,
    allGroupPerformanceData,
    groupPerformanceResults,
  ]);

  const selectionIncludesParentRollup = selectedGroupPerformance.some((g) => g.includesDescendants);
  const isMultiGroupChart = selectedGroupPerformance.length >= 2;
  const effectiveChartMode: 'bar' | 'line' = isMultiGroupChart ? 'line' : chartDisplayMode;
  const useWeeklySeries = isMultiGroupChart || chartDisplayMode === 'bar';

  const unifiedChartDatasets = useMemo(() => {
    if (selectedGroupPerformance.length === 0) return null;

    if (!isMultiGroupChart) {
      const group = selectedGroupPerformance[0];
      const data = useWeeklySeries ? group.weeklyChartData : group.chartData;
      return [{ label: group.name, data }];
    }

    const allXLabels = new Set<string>();
    selectedGroupPerformance.forEach((group) => {
      group.weeklyChartData.forEach((point) => allXLabels.add(point.x));
    });
    const sortedLabels = Array.from(allXLabels).sort();

    return selectedGroupPerformance.map((group) => {
      const dataMap = new Map(group.weeklyChartData.map((p) => [p.x, p.y]));
      const alignedData: ChartDataPoint[] = sortedLabels.map((label) => ({
        x: label,
        y: dataMap.get(label) ?? null,
      }));
      return { label: group.name, data: alignedData };
    });
  }, [selectedGroupPerformance, isMultiGroupChart, useWeeklySeries]);

  const selectedGroupsSummary = useMemo(() => {
    if (selectedGroupPerformance.length === 0) {
      return { testCount: 0, averageScore: 0, accuracy: 0 };
    }
    const historyGroups = groups;
    const seen = new Set<string>();
    let testCount = 0;
    let totalScore = 0;
    let correctAnswers = 0;
    let totalQuestions = 0;
    for (const selectedId of selectedGroupChartIds) {
      const rollup = getGroupIdWithDescendants(selectedId, historyGroups, { activeOnly: false });
      for (const result of groupPerformanceResults) {
        const gid = result.session.config?.groupId;
        if (!gid || !rollup.has(gid)) continue;
        const key = result.session.id || result.id || String(result.session.startTime);
        if (seen.has(key)) continue;
        seen.add(key);
        testCount++;
        totalScore += result.score;
        correctAnswers += result.correctAnswersCount;
        totalQuestions += result.totalQuestions;
      }
    }
    return {
      testCount,
      averageScore: testCount > 0 ? totalScore / testCount : 0,
      accuracy: totalQuestions > 0 ? (correctAnswers / totalQuestions) * 100 : 0,
    };
  }, [selectedGroupPerformance, selectedGroupChartIds, groups, groupPerformanceResults]);

  return (
    <div className="rounded-2xl border border-lantern-border bg-lantern-surface overflow-hidden">
      <div className="p-4 md:p-5 border-b border-lantern-border">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-heading font-semibold text-lantern-text flex items-center">
              <AppIcon name="easel" size={20} className="mr-2 text-lantern-primary-text" />
              Group performance
            </h2>
          </div>
          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:items-center min-w-0">
            <label className="inline-flex items-center gap-1.5 min-w-0">
              <span className="sr-only">Group performance period</span>
              <AppIcon name="filter" size={16} className="text-lantern-text-tertiary shrink-0" aria-hidden />
              <select
                value={groupPerfPeriod}
                onChange={(e) => handleGroupPerfPeriodChange(e.target.value as GroupPerformancePeriod)}
                aria-label="Group performance period"
                className="min-h-[36px] text-caption sm:text-body p-1.5 rounded-lg bg-lantern-surface border border-lantern-border text-lantern-text focus:ring-lantern-primary focus:border-lantern-primary"
              >
                {GROUP_PERFORMANCE_PERIOD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <GroupPerformanceMultiSelect
              options={activeGroupChartOptions}
              selectedIds={selectedGroupChartIds}
              onChange={handleSelectedGroupChartIdsChange}
              disabled={activeGroupChartOptions.length === 0}
            />
            {!isMultiGroupChart && selectedGroupPerformance.length === 1 && (
              <div className="flex justify-end gap-0">
                <button
                  type="button"
                  onClick={() => setChartDisplayMode('line')}
                  className={`px-3 py-2 text-caption rounded-l-lg border transition-colors ${
                    chartDisplayMode === 'line'
                      ? 'bg-lantern-primary-fill text-white border-lantern-primary'
                      : 'bg-lantern-surface border-lantern-border text-lantern-text-secondary'
                  }`}
                >
                  Timeline
                </button>
                <button
                  type="button"
                  onClick={() => setChartDisplayMode('bar')}
                  className={`px-3 py-2 text-caption rounded-r-lg border transition-colors ${
                    chartDisplayMode === 'bar'
                      ? 'bg-lantern-primary-fill text-white border-lantern-primary'
                      : 'bg-lantern-surface border-lantern-border text-lantern-text-secondary'
                  }`}
                >
                  Weekly
                </button>
              </div>
            )}
          </div>
        </div>
        {isMultiGroupChart && (
          <p className="text-caption text-lantern-text-tertiary mt-2">
            Comparing multiple groups uses weekly averages so different test dates line up.
          </p>
        )}
        {selectionIncludesParentRollup && (
          <p className="text-caption text-lantern-text-tertiary mt-1">
            Parent includes subgroup tests in its series.
          </p>
        )}
      </div>

      {activeGroupChartOptions.length === 0 ? (
        <div className="p-8 text-center">
          <AppIcon name="people" size={48} filled className="text-lantern-text-tertiary mx-auto mb-3" />
          <p className="text-body text-lantern-text-tertiary">
            {groupPerformanceResults.length === 0
              ? 'No group tests in this period. Try a wider range or All Time.'
              : 'Take a test in an active group to see performance here.'}
          </p>
        </div>
      ) : selectedGroupPerformance.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-body text-lantern-text-tertiary">
            Select one or more groups from the dropdown to view the chart.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-px bg-lantern-border">
            <div className="bg-lantern-surface p-3 text-center">
              <p className="text-caption text-lantern-text-secondary">Tests</p>
              <p className="text-heading font-bold tabular-nums text-lantern-text">{selectedGroupsSummary.testCount}</p>
            </div>
            <div className="bg-lantern-surface p-3 text-center">
              <p className="text-caption text-lantern-text-secondary">Avg Score</p>
              <p className="text-heading font-bold tabular-nums text-lantern-text">
                {selectedGroupsSummary.averageScore.toFixed(1)}%
              </p>
            </div>
            <div className="bg-lantern-surface p-3 text-center">
              <p className="text-caption text-lantern-text-secondary">Accuracy</p>
              <p className="text-heading font-bold tabular-nums text-lantern-text">
                {selectedGroupsSummary.accuracy.toFixed(1)}%
              </p>
            </div>
          </div>
          <div className="p-4">
            {lowDataMode ? (
              <div className="py-4 text-center text-body text-lantern-text-secondary bg-lantern-background-secondary rounded-lantern space-y-1">
                <p className="font-medium">Chart hidden in Low-Data Mode</p>
                {selectedGroupPerformance.map((group) => (
                  <p key={group.id} className="text-caption">
                    {group.name}: {group.averageScore.toFixed(1)}% avg across {group.testCount}{' '}
                    test{group.testCount !== 1 ? 's' : ''}
                  </p>
                ))}
              </div>
            ) : unifiedChartDatasets ? (
              <GroupPerformanceChart
                datasets={unifiedChartDatasets}
                theme={theme}
                type={effectiveChartMode}
              />
            ) : null}
            {selectedGroupPerformance.length > 1 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-caption text-left">
                  <thead>
                    <tr className="text-lantern-text-secondary border-b border-lantern-border">
                      <th className="py-1.5 pr-3 font-medium">Group</th>
                      <th className="py-1.5 pr-3 font-medium">Tests</th>
                      <th className="py-1.5 pr-3 font-medium">Avg</th>
                      <th className="py-1.5 font-medium">Accuracy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedGroupPerformance.map((group) => (
                      <tr key={group.id} className="border-b border-lantern-border/60 last:border-0">
                        <td className="py-1.5 pr-3 text-lantern-text font-medium">{group.name}</td>
                        <td className="py-1.5 pr-3 text-lantern-text-secondary">{group.testCount}</td>
                        <td className="py-1.5 pr-3 text-lantern-primary-text font-semibold">
                          {group.averageScore.toFixed(1)}%
                        </td>
                        <td className="py-1.5 text-lantern-text-secondary">{group.accuracy.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default GroupPerformanceCard;
