// ===========================================
// Lantern Study Mobile - Test Analysis Charts
// ===========================================
// Time-per-question bars are custom Pressable views — not gifted-charts BarChart.
// Nesting BarChart inside a horizontal ScrollView fights gifted-charts' own
// scroller on Android (same bug GroupPerformanceChartCard documented), which
// left the analysis screen looking empty after OTA even when data was fine.

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TouchableOpacity,
} from 'react-native';
import { PieChart } from 'react-native-gifted-charts';
import type { RecentTest, TestAnalysisQuestionTime } from '../types/dashboardStats';
import { STATUS_BAR_COLORS } from '../utils/testAnalysisHelpers';
import { useTheme } from '../theme';
import { ErrorBoundary } from './ErrorBoundary';
import { AppIcon } from './ui/AppIcon';
import { T } from './ui';
import { useFeatureAccent } from './ui/FeatureDisc';
import type { QuestionSource } from '../screens/tests/confidenceReveal';

/**
 * The word beside the dot.
 *
 * Every question card said how it went in a coloured dot and a coloured
 * border and nothing else (device finding T5, build 162) — which is no
 * signal at all to a reader who cannot separate the two hues, and none in a
 * screenshot either. Colour keeps the meaning; it stops being the only thing
 * carrying it.
 */
const QUESTION_STATUS_LABELS: Record<'correct' | 'incorrect' | 'unattempted', string> = {
  correct: 'Correct',
  incorrect: 'Incorrect',
  unattempted: 'Not answered',
};

interface TestAnalysisContentProps {
  test: RecentTest;
  /** Optional header close control when embedded in a custom chrome. */
  onClose?: () => void;
  showHeader?: boolean;
  /**
   * Where this session's questions came from — a note, a deck or a study
   * group. Drawn as one chip under the title, because the mobile question
   * snapshot carries no per-question provenance: every question in an
   * analysis shares the attempt's source, and claiming otherwise per row
   * would be inventing detail the data does not have.
   *
   * Both this and `onOpenSource` are needed for the chip to appear: a chip
   * that looks like a link and does nothing is worse than no chip.
   */
  source?: QuestionSource | null;
  onOpenSource?: (source: QuestionSource) => void;
}

function TimePerQuestionBars({
  items,
  selectedQuestionNumber,
  onSelect,
  labelColor,
  activeColor,
}: {
  items: TestAnalysisQuestionTime[];
  selectedQuestionNumber?: number;
  onSelect: (item: TestAnalysisQuestionTime) => void;
  labelColor: string;
  activeColor: string;
}) {
  const maxTime = Math.max(1, ...items.map((item) => item.time));

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={items.length > 8}
      contentContainerStyle={styles.barsRow}
    >
      {items.map((item) => {
        const active = selectedQuestionNumber === item.questionNumber;
        const displayTime = item.time > 0 ? item.time : item.status === 'unattempted' ? 0 : 1;
        const barHeight = Math.max(10, Math.round((Math.max(displayTime, 1) / maxTime) * 120));
        const color = active ? activeColor : STATUS_BAR_COLORS[item.status];

        return (
          <Pressable
            key={item.questionNumber}
            onPress={() => onSelect(item)}
            accessibilityRole="button"
            accessibilityLabel={`Question ${item.questionNumber}, ${item.time} seconds, ${QUESTION_STATUS_LABELS[item.status]}`}
            style={[styles.barItem, active && styles.barItemActive]}
          >
            <Text style={[styles.barValue, { color: labelColor }]}>{item.time}s</Text>
            <View style={[styles.barTrack, { height: 128 }]}>
              <View
                style={[
                  styles.barFill,
                  {
                    height: barHeight,
                    backgroundColor: color,
                  },
                ]}
              />
            </View>
            <Text style={[styles.barLabel, { color: labelColor }]}>Q{item.questionNumber}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function TopicBars({
  items,
  labelColor,
  barColor,
}: {
  items: Array<{ tag: string; avgTime: number }>;
  labelColor: string;
  barColor: string;
}) {
  const maxTime = Math.max(1, ...items.map((item) => item.avgTime));

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={items.length > 5} contentContainerStyle={styles.barsRow}>
      {items.map((item) => {
        const barHeight = Math.max(10, Math.round((Math.max(item.avgTime, 1) / maxTime) * 120));
        const label = item.tag.length > 8 ? `${item.tag.substring(0, 8)}…` : item.tag;
        return (
          <View key={item.tag} style={styles.barItem}>
            <Text style={[styles.barValue, { color: labelColor }]}>{item.avgTime}s</Text>
            <View style={[styles.barTrack, { height: 128 }]}>
              <View style={[styles.barFill, { height: barHeight, backgroundColor: barColor }]} />
            </View>
            <Text style={[styles.barLabel, { color: labelColor }]} numberOfLines={1}>
              {label}
            </Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

export default function TestAnalysisContent({
  test,
  onClose,
  showHeader = false,
  source,
  onOpenSource,
}: TestAnalysisContentProps) {
  const { colors } = useTheme();
  const sourceAccent = useFeatureAccent('tests');
  const [selectedQuestion, setSelectedQuestion] = useState<TestAnalysisQuestionTime | null>(null);
  const analysis = test.analysis;

  useEffect(() => {
    setSelectedQuestion(null);
  }, [test.id]);

  const selectQuestion = (item: TestAnalysisQuestionTime) => {
    setSelectedQuestion(item);
  };

  const pieData = useMemo(() => {
    if (!analysis) return [];
    return [
      { value: analysis.correctCount, color: '#22c55e', text: `${analysis.correctCount}`, label: 'Correct' },
      { value: analysis.incorrectCount, color: '#ef4444', text: `${analysis.incorrectCount}`, label: 'Incorrect' },
      { value: analysis.unattemptedCount, color: '#f59e0b', text: `${analysis.unattemptedCount}`, label: 'Skipped' },
    ].filter((item) => item.value > 0);
  }, [analysis]);

  const avgTime = useMemo(() => {
    if (!analysis?.timePerQuestion.length) return 0;
    const totalTime = analysis.timePerQuestion.reduce((sum, q) => sum + q.time, 0);
    return Math.round(totalTime / analysis.timePerQuestion.length);
  }, [analysis]);

  if (!analysis) {
    return (
      <View style={styles.emptyState}>
        <Text style={{ color: colors.textSecondary }}>No analysis data for this test.</Text>
      </View>
    );
  }

  const hasBars = analysis.timePerQuestion.length > 0;
  const statusLabel = selectedQuestion ? QUESTION_STATUS_LABELS[selectedQuestion.status] : '';

  return (
    <View style={styles.root}>
      {showHeader ? (
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View>
            <Text style={[styles.title, { color: colors.text }]}>Test Analysis</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{test.groupName}</Text>
          </View>
          {onClose ? (
            <TouchableOpacity
              style={[styles.closeButton, { backgroundColor: colors.background }]}
              onPress={onClose}
            >
              <AppIcon name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.contentContainer}
      >
        {/* "Where did these questions come from?" — one tap from the chart. */}
        {source && onOpenSource ? (
          <TouchableOpacity
            style={[styles.sourceChip, { borderColor: sourceAccent.ink }]}
            onPress={() => onOpenSource(source)}
            accessibilityRole="link"
            accessibilityLabel={`${source.label}. Opens the source.`}
          >
            <AppIcon name="arrow-forward" size={12} color={sourceAccent.ink} />
            <T.Label style={{ color: sourceAccent.ink }} numberOfLines={1}>
              {source.label}
            </T.Label>
          </TouchableOpacity>
        ) : null}

        <View style={[styles.scoreSummary, { backgroundColor: colors.inputBackground }]}>
          <View style={[styles.scoreCircle, { backgroundColor: colors.primaryFill }]}>
            <Text style={styles.scorePercentage}>{test.percentage}%</Text>
            <Text style={styles.scoreLabel}>Score</Text>
          </View>
          <View style={styles.scoreDetails}>
            <View style={styles.scoreDetailItem}>
              <Text style={[styles.scoreDetailValue, { color: colors.text }]}>
                {test.score}/{test.totalQuestions}
              </Text>
              <Text style={[styles.scoreDetailLabel, { color: colors.textSecondary }]}>Correct</Text>
            </View>
            <View style={styles.scoreDetailItem}>
              <Text style={[styles.scoreDetailValue, { color: colors.text }]}>{avgTime}s</Text>
              <Text style={[styles.scoreDetailLabel, { color: colors.textSecondary }]}>Avg Time</Text>
            </View>
            <View style={styles.scoreDetailItem}>
              <Text style={[styles.scoreDetailValue, { color: colors.text }]}>
                {Math.floor(test.timeSpent / 60)}m
              </Text>
              <Text style={[styles.scoreDetailLabel, { color: colors.textSecondary }]}>Total Time</Text>
            </View>
          </View>
        </View>

        {pieData.length > 0 ? (
          <View style={[styles.chartSection, { backgroundColor: colors.inputBackground }]}>
            <View style={styles.chartHeader}>
              <AppIcon name="pie-chart" size={20} color="#22c55e" />
              <Text style={[styles.chartTitle, { color: colors.text }]}>Question Performance</Text>
            </View>
            <ErrorBoundary fallbackTitle="Performance chart failed to render">
              <View style={styles.pieChartContainer}>
                <PieChart
                  data={pieData}
                  donut
                  radius={80}
                  innerRadius={50}
                  innerCircleColor={colors.card}
                  centerLabelComponent={() => (
                    <View style={styles.pieCenter}>
                      <Text style={[styles.pieCenterValue, { color: colors.text }]}>{test.percentage}%</Text>
                      <Text style={[styles.pieCenterLabel, { color: colors.textSecondary }]}>Accuracy</Text>
                    </View>
                  )}
                />
                <View style={styles.pieLegend}>
                  {pieData.map((item, index) => (
                    <View key={index} style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: item.color }]} />
                      <Text style={[styles.legendText, { color: colors.textSecondary }]}>
                        {item.label}: {item.value}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            </ErrorBoundary>
          </View>
        ) : null}

        <View style={[styles.chartSection, { backgroundColor: colors.inputBackground }]}>
          <View style={styles.chartHeader}>
            <AppIcon name="time" size={20} color={colors.primaryText} />
            <Text style={[styles.chartTitle, { color: colors.text }]}>Time per Question (seconds)</Text>
          </View>
          {hasBars ? (
            <>
              <Text style={[styles.chartHint, { color: colors.textSecondary }]}>
                Tap a bar to see the question
              </Text>
              <View style={styles.statusLegend}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: STATUS_BAR_COLORS.correct }]} />
                  <Text style={[styles.legendText, { color: colors.textSecondary }]}>{QUESTION_STATUS_LABELS.correct}</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: STATUS_BAR_COLORS.incorrect }]} />
                  <Text style={[styles.legendText, { color: colors.textSecondary }]}>{QUESTION_STATUS_LABELS.incorrect}</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: STATUS_BAR_COLORS.unattempted }]} />
                  <Text style={[styles.legendText, { color: colors.textSecondary }]}>{QUESTION_STATUS_LABELS.unattempted}</Text>
                </View>
              </View>
              <View style={styles.barChartContainer}>
                <TimePerQuestionBars
                  items={analysis.timePerQuestion}
                  selectedQuestionNumber={selectedQuestion?.questionNumber}
                  onSelect={selectQuestion}
                  labelColor={colors.textSecondary}
                  activeColor={colors.primaryText}
                />
              </View>

              {selectedQuestion ? (
                <View style={[styles.questionDetail, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.questionDetailHeader}>
                    <Text style={[styles.questionDetailTitle, { color: colors.text }]}>
                      Q{selectedQuestion.questionNumber} · {selectedQuestion.time}s · {statusLabel}
                    </Text>
                    <Pressable onPress={() => setSelectedQuestion(null)} hitSlop={8}>
                      <AppIcon name="close" size={18} color={colors.textSecondary} />
                    </Pressable>
                  </View>
                  <Text style={[styles.questionStem, { color: colors.text }]}>
                    {selectedQuestion.stem || 'Question text unavailable for this session.'}
                  </Text>
                </View>
              ) : null}

              <Text style={[styles.questionsListTitle, { color: colors.text }]}>Questions</Text>
              <View style={styles.questionsList}>
                {analysis.timePerQuestion.map((item) => {
                  const active = selectedQuestion?.questionNumber === item.questionNumber;
                  return (
                    <Pressable
                      key={item.questionNumber}
                      onPress={() => selectQuestion(item)}
                      style={[
                        styles.questionRow,
                        {
                          backgroundColor: active ? colors.primary + '18' : colors.card,
                          borderColor: active ? colors.primary : STATUS_BAR_COLORS[item.status],
                        },
                      ]}
                    >
                      <View
                        style={[styles.questionRowDot, { backgroundColor: STATUS_BAR_COLORS[item.status] }]}
                      />
                      <View style={styles.questionRowText}>
                        <Text style={[styles.questionRowMeta, { color: colors.textSecondary }]}>
                          Q{item.questionNumber} · {item.time}s · {QUESTION_STATUS_LABELS[item.status]}
                        </Text>
                        <Text
                          style={[styles.questionRowStem, { color: colors.text }]}
                          numberOfLines={active ? undefined : 2}
                        >
                          {item.stem || `Question ${item.questionNumber}`}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : (
            <Text style={[styles.chartHint, { color: colors.textSecondary }]}>
              Per-question timing is not available for this session yet. Pull to refresh or reopen after the session finishes syncing.
            </Text>
          )}
        </View>

        {analysis.timePerTag.length > 0 && (
          <View style={[styles.chartSection, { backgroundColor: colors.inputBackground }]}>
            <View style={styles.chartHeader}>
              <AppIcon name="pricetag" size={20} color="#8b5cf6" />
              <Text style={[styles.chartTitle, { color: colors.text }]}>Average Time by Topic</Text>
            </View>
            <View style={styles.barChartContainer}>
              <TopicBars
                items={analysis.timePerTag}
                labelColor={colors.textSecondary}
                barColor="#8b5cf6"
              />
            </View>
          </View>
        )}

        {analysis.tagPerformance.length > 0 && (
          <View style={[styles.chartSection, { backgroundColor: colors.inputBackground }]}>
            <View style={styles.chartHeader}>
              <AppIcon name="stats-chart" size={20} color="#10b981" />
              <Text style={[styles.chartTitle, { color: colors.text }]}>Performance by Topic</Text>
            </View>
            <View style={styles.tagPerformanceList}>
              {analysis.tagPerformance.map((tag, index) => (
                <View key={index} style={[styles.tagPerformanceItem, { backgroundColor: colors.card }]}>
                  <View style={styles.tagPerformanceHeader}>
                    <Text style={[styles.tagName, { color: colors.text }]}>{tag.tag}</Text>
                    <Text
                      style={[
                        styles.tagAccuracy,
                        {
                          color:
                            tag.accuracy >= 80 ? '#10b981' : tag.accuracy >= 60 ? '#f59e0b' : '#ef4444',
                        },
                      ]}
                    >
                      {tag.accuracy}%
                    </Text>
                  </View>
                  <View style={[styles.tagProgressBar, { backgroundColor: colors.border }]}>
                    <View
                      style={[
                        styles.tagProgressFill,
                        {
                          width: `${tag.accuracy}%`,
                          backgroundColor:
                            tag.accuracy >= 80 ? '#10b981' : tag.accuracy >= 60 ? '#f59e0b' : '#ef4444',
                        },
                      ]}
                    />
                  </View>
                  <Text style={[styles.tagScore, { color: colors.textSecondary }]}>
                    {tag.correct}/{tag.total} correct
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <View style={{ height: 24 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 14,
    marginTop: 2,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
  },
  sourceChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    marginBottom: 12,
    maxWidth: '100%',
  },
  scoreSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
  },
  scoreCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#6366f1',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 20,
  },
  scorePercentage: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  scoreLabel: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  scoreDetails: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  scoreDetailItem: {
    alignItems: 'center',
  },
  scoreDetailValue: {
    fontSize: 18,
    fontWeight: '600',
  },
  scoreDetailLabel: {
    fontSize: 11,
    marginTop: 2,
  },
  chartSection: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  chartHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  chartTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  chartHint: {
    fontSize: 11,
    marginBottom: 12,
    textAlign: 'center',
  },
  statusLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 12,
  },
  pieChartContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    minHeight: 180,
  },
  pieCenter: {
    alignItems: 'center',
  },
  pieCenterValue: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  pieCenterLabel: {
    fontSize: 11,
  },
  pieLegend: {
    gap: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  legendText: {
    fontSize: 14,
  },
  barChartContainer: {
    minHeight: 168,
    width: '100%',
  },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 4,
    paddingTop: 4,
    gap: 6,
    minHeight: 168,
  },
  barItem: {
    width: 40,
    alignItems: 'center',
  },
  barItemActive: {
    opacity: 1,
  },
  barValue: {
    fontSize: 11,
    marginBottom: 4,
    fontWeight: '600',
  },
  barTrack: {
    width: 28,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  barFill: {
    width: 24,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
  },
  barLabel: {
    fontSize: 11,
    marginTop: 6,
    fontWeight: '600',
  },
  questionDetail: {
    marginTop: 14,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  questionDetailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  questionDetailTitle: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  questionStem: {
    fontSize: 14,
    lineHeight: 20,
  },
  questionsListTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
  },
  questionsList: {
    gap: 8,
  },
  questionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  questionRowDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 4,
  },
  questionRowText: {
    flex: 1,
  },
  questionRowMeta: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2,
  },
  questionRowStem: {
    fontSize: 13,
    lineHeight: 18,
  },
  tagPerformanceList: {
    gap: 12,
  },
  tagPerformanceItem: {
    borderRadius: 8,
    padding: 12,
  },
  tagPerformanceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  tagName: {
    fontSize: 14,
    fontWeight: '500',
  },
  tagAccuracy: {
    fontSize: 14,
    fontWeight: '600',
  },
  tagProgressBar: {
    height: 6,
    borderRadius: 3,
    marginBottom: 6,
    overflow: 'hidden',
  },
  tagProgressFill: {
    height: '100%',
    borderRadius: 3,
  },
  tagScore: {
    fontSize: 12,
  },
});
