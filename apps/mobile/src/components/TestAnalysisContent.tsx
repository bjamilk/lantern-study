// ===========================================
// Lantern Study Mobile - Test Analysis Charts
// ===========================================

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Dimensions,
  Pressable,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PieChart, BarChart } from 'react-native-gifted-charts';
import type { RecentTest, TestAnalysisQuestionTime } from '../types/dashboardStats';
import { STATUS_BAR_COLORS } from '../utils/testAnalysisHelpers';
import { useTheme } from '../theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface TestAnalysisContentProps {
  test: RecentTest;
  /** Optional header close control when embedded in a custom chrome. */
  onClose?: () => void;
  showHeader?: boolean;
}

export default function TestAnalysisContent({
  test,
  onClose,
  showHeader = false,
}: TestAnalysisContentProps) {
  const { colors } = useTheme();
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
    ].filter(item => item.value > 0);
  }, [analysis]);

  const timePerQuestionData = useMemo(() => {
    if (!analysis) return [];
    return analysis.timePerQuestion.slice(0, 15).map((item) => ({
      value: item.status === 'unattempted' && item.time <= 0 ? 1 : item.time,
      label: `Q${item.questionNumber}`,
      frontColor:
        selectedQuestion?.questionNumber === item.questionNumber
          ? colors.primary
          : STATUS_BAR_COLORS[item.status],
      onPress: () => selectQuestion(item),
    }));
  }, [analysis, selectedQuestion, colors.primary]);

  const timePerTagData = useMemo(() => {
    if (!analysis) return [];
    return analysis.timePerTag.map(item => ({
      value: item.avgTime,
      label: item.tag.length > 8 ? item.tag.substring(0, 8) + '...' : item.tag,
      frontColor: '#8b5cf6',
    }));
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
  const statusLabel =
    selectedQuestion?.status === 'correct'
      ? 'Correct'
      : selectedQuestion?.status === 'incorrect'
        ? 'Incorrect'
        : 'Unattempted';

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
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.contentContainer}
      >
        <View style={[styles.scoreSummary, { backgroundColor: colors.inputBackground }]}>
          <View style={styles.scoreCircle}>
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
              <Ionicons name="pie-chart" size={20} color="#22c55e" />
              <Text style={[styles.chartTitle, { color: colors.text }]}>Question Performance</Text>
            </View>
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
          </View>
        ) : null}

        <View style={[styles.chartSection, { backgroundColor: colors.inputBackground }]}>
          <View style={styles.chartHeader}>
            <Ionicons name="time" size={20} color={colors.primary} />
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
                  <Text style={[styles.legendText, { color: colors.textSecondary }]}>Correct</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: STATUS_BAR_COLORS.incorrect }]} />
                  <Text style={[styles.legendText, { color: colors.textSecondary }]}>Incorrect</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: STATUS_BAR_COLORS.unattempted }]} />
                  <Text style={[styles.legendText, { color: colors.textSecondary }]}>Unattempted</Text>
                </View>
              </View>
              <View style={styles.barChartContainer}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <BarChart
                    data={timePerQuestionData}
                    width={Math.max(SCREEN_WIDTH - 80, timePerQuestionData.length * 35)}
                    height={160}
                    barWidth={24}
                    spacing={8}
                    roundedTop
                    roundedBottom
                    hideRules
                    xAxisThickness={0}
                    yAxisThickness={0}
                    yAxisTextStyle={{ color: colors.textSecondary, fontSize: 10 }}
                    xAxisLabelTextStyle={{ color: colors.textSecondary, fontSize: 9 }}
                    noOfSections={4}
                    maxValue={Math.max(10, ...timePerQuestionData.map(d => d.value)) + 10}
                    isAnimated
                    animationDuration={300}
                    onPress={(_item: unknown, index: number) => {
                      const q = analysis.timePerQuestion[index];
                      if (q) selectQuestion(q);
                    }}
                  />
                </ScrollView>
              </View>

              {selectedQuestion ? (
                <View style={[styles.questionDetail, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.questionDetailHeader}>
                    <Text style={[styles.questionDetailTitle, { color: colors.text }]}>
                      Q{selectedQuestion.questionNumber} · {selectedQuestion.time}s · {statusLabel}
                    </Text>
                    <Pressable onPress={() => setSelectedQuestion(null)} hitSlop={8}>
                      <Ionicons name="close" size={18} color={colors.textSecondary} />
                    </Pressable>
                  </View>
                  <Text style={[styles.questionStem, { color: colors.text }]}>
                    {selectedQuestion.stem || 'Question text unavailable for this session.'}
                  </Text>
                </View>
              ) : null}

              <Text style={[styles.questionsListTitle, { color: colors.text }]}>Questions</Text>
              <View style={styles.questionsList}>
                {analysis.timePerQuestion.map(item => {
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
                          Q{item.questionNumber} · {item.time}s
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
              <Ionicons name="pricetag" size={20} color="#8b5cf6" />
              <Text style={[styles.chartTitle, { color: colors.text }]}>Average Time by Topic</Text>
            </View>
            <View style={styles.barChartContainer}>
              <BarChart
                data={timePerTagData}
                width={SCREEN_WIDTH - 80}
                height={160}
                barWidth={40}
                spacing={16}
                roundedTop
                roundedBottom
                hideRules
                xAxisThickness={0}
                yAxisThickness={0}
                yAxisTextStyle={{ color: colors.textSecondary, fontSize: 10 }}
                xAxisLabelTextStyle={{ color: colors.textSecondary, fontSize: 9 }}
                noOfSections={4}
                maxValue={Math.max(10, ...timePerTagData.map(d => d.value)) + 10}
                isAnimated
                animationDuration={300}
              />
            </View>
          </View>
        )}

        {analysis.tagPerformance.length > 0 && (
          <View style={[styles.chartSection, { backgroundColor: colors.inputBackground }]}>
            <View style={styles.chartHeader}>
              <Ionicons name="stats-chart" size={20} color="#10b981" />
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
  },
  pieCenter: {
    alignItems: 'center',
  },
  pieCenterValue: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  pieCenterLabel: {
    fontSize: 10,
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
    alignItems: 'center',
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
