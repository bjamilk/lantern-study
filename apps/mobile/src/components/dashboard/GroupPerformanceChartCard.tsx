/**
 * Mobile Group performance chart — parity with web Dashboard multi-select chart.
 */
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { LineChart } from 'react-native-gifted-charts';
import { Card } from '../ui';
import {
  buildRolledUpGroupSeries,
  filterResultsByGroupPerformancePeriod,
  getGroupIdWithDescendants,
  withResolvedGroupIds,
  GROUP_PERFORMANCE_PERIOD_OPTIONS,
  type GroupPerformancePeriod,
  type LeanTestResultLike,
} from '@lantern/shared/utils';
import { useSettingsStore } from '../../stores/settingsStore';

const SELECTED_GROUP_CHART_IDS_KEY = 'lantern.dashboard.selectedGroupIds';
const GROUP_PERF_PERIOD_KEY = 'lantern.dashboard.groupPerfPeriod';

export interface ChartGroupOption {
  id: string;
  name: string;
  parentId?: string | null;
  isArchived?: boolean;
  level: number;
}

interface GroupPerformanceChartCardProps {
  groups: Array<{ id: string; name: string; parentId?: string | null; isArchived?: boolean }>;
  testResults: LeanTestResultLike[];
}

const SERIES_COLORS = ['#4f46e5', '#e11d48', '#0d9488', '#d97706', '#0284c7', '#c026d3'];

async function loadSelectedIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(SELECTED_GROUP_CHART_IDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

async function saveSelectedIds(ids: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(SELECTED_GROUP_CHART_IDS_KEY, JSON.stringify(ids));
  } catch {
    // ignore
  }
}

async function loadPeriod(): Promise<GroupPerformancePeriod> {
  try {
    const raw = await AsyncStorage.getItem(GROUP_PERF_PERIOD_KEY);
    if (raw === '7days' || raw === '30days' || raw === '90days' || raw === 'all') return raw;
  } catch {
    // ignore
  }
  // Same default as the dashboard period above the chart. A saved preference
  // still wins — this is only the starting point.
  return 'all';
}

async function savePeriod(period: GroupPerformancePeriod): Promise<void> {
  try {
    await AsyncStorage.setItem(GROUP_PERF_PERIOD_KEY, period);
  } catch {
    // ignore
  }
}

function buildHierarchicalOptions(
  historyGroups: Array<{ id: string; name: string; parentId?: string | null; isArchived?: boolean }>,
  dataIds: Set<string>
): ChartGroupOption[] {
  const byParent = new Map<string | null, typeof historyGroups>();
  for (const group of historyGroups) {
    const key = group.parentId || null;
    const list = byParent.get(key) || [];
    list.push(group);
    byParent.set(key, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  const options: ChartGroupOption[] = [];
  const historyIds = new Set(historyGroups.map((g) => g.id));
  const roots = historyGroups
    .filter((g) => !g.parentId || !historyIds.has(g.parentId))
    .sort((a, b) => a.name.localeCompare(b.name));

  const walk = (parentId: string, level: number) => {
    const children = byParent.get(parentId) || [];
    for (const child of children) {
      if (dataIds.has(child.id)) {
        options.push({
          id: child.id,
          name: child.name,
          parentId: child.parentId,
          isArchived: child.isArchived,
          level,
        });
      }
      walk(child.id, level + 1);
    }
  };

  for (const root of roots) {
    if (dataIds.has(root.id)) {
      options.push({
        id: root.id,
        name: root.name,
        parentId: root.parentId,
        isArchived: root.isArchived,
        level: 0,
      });
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

export function GroupPerformanceChartCard({ groups, testResults }: GroupPerformanceChartCardProps) {
  const lowDataMode = useSettingsStore((s) => s.settings.appearance.lowDataMode);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [displayMode, setDisplayMode] = useState<'timeline' | 'weekly'>('timeline');
  // Match the dashboard's own default. These two periods disagreeing is why the
  // chart total never reconciled with the "Tests taken" tile above it.
  const [period, setPeriod] = useState<GroupPerformancePeriod>('all');

  // Archiving a group does not erase the tests taken in it, and those tests are
  // still counted by every other number on this screen. Excluding them here made
  // the chart total 12 against a headline of 13, which reads as a broken chart
  // rather than a deliberate filter. Groups with no history are still hidden,
  // since `options` below only keeps ids that actually have results.
  const historyGroups = useMemo(() => groups, [groups]);

  const periodResults = useMemo(() => {
    const resolved = withResolvedGroupIds(
      testResults,
      groups.map((g) => ({ id: g.id, name: g.name }))
    );
    return filterResultsByGroupPerformancePeriod(resolved, period);
  }, [testResults, period, groups]);

  const options = useMemo(() => {
    const directDataIds = new Set(
      periodResults
        .map((r) => r.session.config?.groupId)
        .filter((id): id is string => typeof id === 'string' && historyGroups.some((g) => g.id === id))
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
    return buildHierarchicalOptions(historyGroups, dataIds);
  }, [historyGroups, periodResults]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadSelectedIds(), loadPeriod()]).then(([ids, savedPeriod]) => {
      if (cancelled) return;
      setSelectedIds(ids);
      setPeriod(savedPeriod);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const valid = new Set(options.map((o) => o.id));
    setSelectedIds((prev) => {
      const pruned = prev.filter((id) => valid.has(id));
      if (pruned.length === 0 && options.length > 0) {
        const next = [options[0].id];
        void saveSelectedIds(next);
        return next;
      }
      if (pruned.length !== prev.length) {
        void saveSelectedIds(pruned);
        return pruned;
      }
      return prev;
    });
  }, [options]);

  const updateSelection = useCallback((ids: string[]) => {
    setSelectedIds(ids);
    void saveSelectedIds(ids);
  }, []);

  const updatePeriod = useCallback((next: GroupPerformancePeriod) => {
    setPeriod(next);
    void savePeriod(next);
  }, []);

  const selectedSeries = useMemo(
    () =>
      selectedIds
        .filter((id) => options.some((o) => o.id === id))
        .map((id) => {
          const name = historyGroups.find((g) => g.id === id)?.name || options.find((o) => o.id === id)?.name || id;
          return buildRolledUpGroupSeries({
            groupId: id,
            groupName: name,
            groups: historyGroups,
            results: periodResults,
            activeOnly: false,
          });
        })
        .filter((s) => s.testCount > 0),
    [selectedIds, options, historyGroups, periodResults]
  );

  const isMulti = selectedSeries.length >= 2;
  const useWeekly = isMulti || displayMode === 'weekly';
  const includesParentRollup = selectedSeries.some((s) => s.includesDescendants);

  const chartWidth = Math.max(280, width - 64);


  const lineDatasets = useMemo(() => {
    if (selectedSeries.length === 0) return [];
    if (!isMulti) {
      const series = selectedSeries[0];
      const points = useWeekly ? series.weeklyChartData : series.chartData;
      // A label under every point overlaps once the points are packed to fit the
      // card, so keep roughly six evenly spaced ones plus the last for the
      // end of the range. Every point is still plotted — only labels are thinned.
      const stride = Math.max(1, Math.ceil(points.length / 6));
      return [
        {
          data: points.map((p, i) => ({
            value: p.y ?? 0,
            // Points are labelled "Test 3 - 06/21"; keep just the MM/DD. Taking
            // 8 characters kept a leading "- " that pushed the date past the
            // available width, so every label rendered as "- 06/…".
            label: i % stride === 0 || i === points.length - 1 ? String(p.x).slice(-5) : '',
          })),
          color: SERIES_COLORS[0],
        },
      ];
    }
    const labels = new Set<string>();
    selectedSeries.forEach((s) => s.weeklyChartData.forEach((p) => labels.add(p.x)));
    const sorted = Array.from(labels).sort();
    return selectedSeries.map((series, index) => {
      const map = new Map(series.weeklyChartData.map((p) => [p.x, p.y]));
      return {
        data: sorted.map((label, i) => ({
          value: map.get(label) ?? 0,
          label: i % Math.max(1, Math.floor(sorted.length / 4)) === 0 ? label.slice(-5) : '',
        })),
        color: SERIES_COLORS[index % SERIES_COLORS.length],
      };
    });
  }, [selectedSeries, isMulti, useWeekly]);

  /**
   * Fit every point inside the card instead of drawing a chart wider than it.
   *
   * The width used to be `max(chartWidth, points * 36)`, which for 11 tests asks
   * for ~396dp inside a ~330dp card. Android clips overflowing children while
   * iOS lets them spill, so the same data looked truncated on one platform and
   * not the other — and the horizontal ScrollView that was meant to rescue it
   * fought gifted-charts' own internal scroll view, so on Android it neither
   * fitted nor scrolled. Sizing to the container and deriving the spacing shows
   * the whole series without scrolling, which is how web already behaves.
   */
  const chartGeometry = useMemo(() => {
    const Y_AXIS_WIDTH = 46;
    // Labels are centred on their point, so the first one needs room to its left
    // or it is clipped by the axis, and the last needs room to its right or the
    // plot runs past the card edge.
    const INITIAL_SPACING = 22;
    const END_SPACING = 18;
    // `width` is the plot area only — gifted-charts draws the y-axis labels
    // outside it, so passing the full card width made the axis rule overrun the
    // card's right edge by roughly the axis width.
    const renderWidth = Math.max(140, chartWidth - Y_AXIS_WIDTH);
    const plotWidth = Math.max(120, renderWidth - INITIAL_SPACING - END_SPACING);
    const count = lineDatasets[0]?.data.length ?? 0;
    // Below this, points sit on top of each other and the line is unreadable;
    // gifted-charts then scrolls internally rather than silently dropping data.
    const MIN_SPACING = 14;
    const spacing = count > 1 ? Math.max(MIN_SPACING, plotWidth / (count - 1)) : plotWidth;
    return {
      width: renderWidth,
      spacing,
      initialSpacing: INITIAL_SPACING,
      endSpacing: END_SPACING,
      count,
    };
  }, [chartWidth, lineDatasets]);

  const summary = useMemo(() => {
    const seen = new Set<string>();
    let testCount = 0;
    let totalScore = 0;
    let correct = 0;
    let totalQ = 0;
    for (const id of selectedIds) {
      const rollup = getGroupIdWithDescendants(id, historyGroups, { activeOnly: false });
      for (const result of periodResults) {
        const gid = result.session.config?.groupId;
        if (!gid || !rollup.has(gid)) continue;
        const key = result.session.id || result.id || String(result.session.startTime);
        if (seen.has(key)) continue;
        seen.add(key);
        testCount++;
        totalScore += result.score;
        correct += result.correctAnswersCount;
        totalQ += result.totalQuestions;
      }
    }
    return {
      testCount,
      averageScore: testCount > 0 ? totalScore / testCount : 0,
      accuracy: totalQ > 0 ? (correct / totalQ) * 100 : 0,
    };
  }, [selectedIds, historyGroups, periodResults]);

  const buttonLabel =
    selectedIds.length === 0
      ? 'Select groups'
      : selectedIds.length === 1
        ? options.find((o) => o.id === selectedIds[0])?.name || '1 group'
        : `${selectedIds.length} groups`;

  return (
    <Card className="mb-4">
      <View className="flex-row items-center gap-2 mb-2">
        <Ionicons name="stats-chart" size={16} color="#4f46e5" />
        <Text className="text-sm font-semibold text-lantern-text">Group performance</Text>
      </View>

      <View className="flex-row flex-wrap gap-1.5 mb-3">
        {GROUP_PERFORMANCE_PERIOD_OPTIONS.map((opt) => {
          const active = period === opt.value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => updatePeriod(opt.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={opt.label}
              className={`px-2.5 py-1.5 rounded-lg min-h-[36px] justify-center ${
                active ? 'bg-lantern-primary' : 'bg-lantern-background-secondary'
              }`}
            >
              <Text
                className={`text-xs font-semibold ${
                  active ? 'text-white' : 'text-lantern-text-secondary'
                }`}
              >
                {opt.shortLabel}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View className="flex-row flex-wrap gap-2 mb-3">
        <Pressable
          onPress={() => setPickerOpen(true)}
          disabled={options.length === 0}
          className="flex-1 min-w-[140px] flex-row items-center justify-between px-3 py-2 rounded-xl border border-lantern-border bg-lantern-surface"
        >
          <Text className="text-sm text-lantern-text flex-1 pr-2" numberOfLines={1}>
            {options.length === 0 ? 'No group data' : buttonLabel}
          </Text>
          <Ionicons name="chevron-down" size={16} color="#94a3b8" />
        </Pressable>
        {!isMulti && selectedSeries.length === 1 ? (
          <View className="flex-row rounded-xl overflow-hidden border border-lantern-border">
            <Pressable
              onPress={() => setDisplayMode('timeline')}
              className={`px-3 py-2 ${displayMode === 'timeline' ? 'bg-lantern-primary' : 'bg-lantern-surface'}`}
            >
              <Text
                className={`text-xs font-semibold ${
                  displayMode === 'timeline' ? 'text-white' : 'text-lantern-text-secondary'
                }`}
              >
                Timeline
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setDisplayMode('weekly')}
              className={`px-3 py-2 ${displayMode === 'weekly' ? 'bg-lantern-primary' : 'bg-lantern-surface'}`}
            >
              <Text
                className={`text-xs font-semibold ${
                  displayMode === 'weekly' ? 'text-white' : 'text-lantern-text-secondary'
                }`}
              >
                Weekly
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {isMulti ? (
        <Text className="text-[11px] text-lantern-text-tertiary mb-2">
          Comparing multiple groups uses weekly averages so different test dates line up.
        </Text>
      ) : null}
      {includesParentRollup ? (
        <Text className="text-[11px] text-lantern-text-tertiary mb-2">
          Parent includes subgroup tests in its series.
        </Text>
      ) : null}

      {options.length === 0 ? (
        <Text className="text-sm text-lantern-text-tertiary py-4 text-center">
          {periodResults.length === 0
            ? 'No group tests in this period. Try a wider range or All.'
            : 'Take a test in an active group to see performance here.'}
        </Text>
      ) : selectedSeries.length === 0 ? (
        <Text className="text-sm text-lantern-text-tertiary py-4 text-center">
          Select one or more groups to view the chart.
        </Text>
      ) : (
        <>
          <View className="flex-row border border-lantern-border rounded-xl mb-3 overflow-hidden">
            <View className="flex-1 items-center py-2">
              <Text className="text-[10px] text-lantern-text-secondary">Tests</Text>
              <Text className="text-base font-bold text-lantern-text">{summary.testCount}</Text>
            </View>
            <View className="flex-1 items-center py-2 border-l border-lantern-border">
              <Text className="text-[10px] text-lantern-text-secondary">Avg</Text>
              <Text className="text-base font-bold text-lantern-text">
                {summary.averageScore.toFixed(1)}%
              </Text>
            </View>
            <View className="flex-1 items-center py-2 border-l border-lantern-border">
              <Text className="text-[10px] text-lantern-text-secondary">Accuracy</Text>
              <Text className="text-base font-bold text-lantern-text">
                {summary.accuracy.toFixed(1)}%
              </Text>
            </View>
          </View>

          {lowDataMode ? (
            <View className="py-3 px-2 rounded-xl bg-lantern-background-secondary">
              <Text className="text-sm font-medium text-lantern-text-secondary text-center mb-1">
                Chart hidden in Low-Data Mode
              </Text>
              {selectedSeries.map((s) => (
                <Text key={s.id} className="text-xs text-lantern-text-tertiary text-center">
                  {s.name}: {s.averageScore.toFixed(1)}% avg across {s.testCount} test
                  {s.testCount !== 1 ? 's' : ''}
                </Text>
              ))}
            </View>
          ) : lineDatasets.length > 0 && lineDatasets[0].data.length > 0 ? (
            <View>
              {useWeekly ? (
                <LineChart
                  data={lineDatasets[0].data}
                  data2={lineDatasets[1]?.data}
                  data3={lineDatasets[2]?.data}
                  data4={lineDatasets[3]?.data}
                  data5={lineDatasets[4]?.data}
                  height={180}
                  width={chartGeometry.width}
                  spacing={chartGeometry.spacing}
                  initialSpacing={chartGeometry.initialSpacing}
                  endSpacing={chartGeometry.endSpacing}
                  color={SERIES_COLORS[0]}
                  color2={SERIES_COLORS[1]}
                  color3={SERIES_COLORS[2]}
                  color4={SERIES_COLORS[3]}
                  color5={SERIES_COLORS[4]}
                  thickness={2}
                  hideDataPoints={lineDatasets[0].data.length > 12}
                  yAxisTextStyle={{ color: '#94a3b8', fontSize: 10 }}
                  xAxisLabelTextStyle={{ color: '#94a3b8', fontSize: 9 }}
                  noOfSections={4}
                  maxValue={100}
                  yAxisOffset={0}
                  isAnimated
                />
              ) : (
                <LineChart
                  data={lineDatasets[0].data}
                  height={180}
                  width={chartGeometry.width}
                  spacing={chartGeometry.spacing}
                  initialSpacing={chartGeometry.initialSpacing}
                  endSpacing={chartGeometry.endSpacing}
                  color={SERIES_COLORS[0]}
                  thickness={2}
                  hideDataPoints={false}
                  yAxisTextStyle={{ color: '#94a3b8', fontSize: 10 }}
                  xAxisLabelTextStyle={{ color: '#94a3b8', fontSize: 9 }}
                  noOfSections={4}
                  maxValue={100}
                  isAnimated
                />
              )}
            </View>
          ) : (
            <Text className="text-sm text-lantern-text-tertiary text-center py-4">No chart points yet.</Text>
          )}

          {selectedSeries.length > 1 ? (
            <View className="mt-3 gap-1">
              {selectedSeries.map((s, index) => (
                <View key={s.id} className="flex-row items-center justify-between">
                  <View className="flex-row items-center gap-2 flex-1 pr-2">
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: SERIES_COLORS[index % SERIES_COLORS.length],
                      }}
                    />
                    <Text className="text-xs text-lantern-text" numberOfLines={1}>
                      {s.name}
                    </Text>
                  </View>
                  <Text className="text-xs font-semibold text-lantern-primary">
                    {s.averageScore.toFixed(1)}%
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </>
      )}

      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <Pressable className="flex-1 bg-black/40 justify-end" onPress={() => setPickerOpen(false)}>
          <Pressable
            className="bg-lantern-surface rounded-t-2xl max-h-[70%] border-t border-lantern-border"
            style={{ paddingBottom: insets.bottom + 12 }}
            onPress={(e) => e.stopPropagation()}
          >
            <View className="flex-row items-center justify-between px-4 py-3 border-b border-lantern-border">
              <Pressable onPress={() => updateSelection(options.map((o) => o.id))}>
                <Text className="text-xs font-semibold text-lantern-primary">Select all</Text>
              </Pressable>
              <Text className="text-sm font-semibold text-lantern-text">Groups</Text>
              <Pressable onPress={() => updateSelection([])}>
                <Text className="text-xs font-semibold text-lantern-text-secondary">Clear</Text>
              </Pressable>
            </View>
            <ScrollView>
              {options.map((opt) => {
                const checked = selectedIds.includes(opt.id);
                return (
                  <Pressable
                    key={opt.id}
                    onPress={() =>
                      updateSelection(
                        checked ? selectedIds.filter((id) => id !== opt.id) : [...selectedIds, opt.id]
                      )
                    }
                    className="flex-row items-center gap-2 px-4 py-3 border-b border-lantern-border/60"
                    style={{ paddingLeft: 16 + opt.level * 14 }}
                  >
                    <View
                      className={`w-5 h-5 rounded border items-center justify-center ${
                        checked ? 'bg-lantern-primary border-lantern-primary' : 'border-lantern-border'
                      }`}
                    >
                      {checked ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
                    </View>
                    <Text className="text-sm text-lantern-text flex-1" numberOfLines={1}>
                      {opt.level > 0 ? '└ ' : ''}
                      {opt.name}
                      {/* Archived groups still hold test history and are counted
                          in the totals above, so they stay selectable — labelled
                          so it is clear why an archived group is listed. */}
                      {opt.isArchived ? ' (archived)' : ''}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable
              onPress={() => setPickerOpen(false)}
              className="m-4 py-3 rounded-xl bg-lantern-primary items-center"
            >
              <Text className="text-sm font-semibold text-white">Done</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </Card>
  );
}

export default GroupPerformanceChartCard;
