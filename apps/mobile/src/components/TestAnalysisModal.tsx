// ===========================================
// Lantern Study Mobile - Test Analysis Modal
// ===========================================

import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PieChart, BarChart } from 'react-native-gifted-charts';
import type { RecentTest } from '../types/dashboardStats';
import { STATUS_BAR_COLORS } from '../utils/testAnalysisHelpers';
import { useTheme } from '../theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface TestAnalysisModalProps {
  visible: boolean;
  onClose: () => void;
  test: RecentTest | null;
}

export default function TestAnalysisModal({ visible, onClose, test }: TestAnalysisModalProps) {
  const { colors } = useTheme();
  
  if (!test) return null;

  const { analysis } = test;

  // Pie chart data for question performance
  const pieData = useMemo(() => [
    { value: analysis.correctCount, color: '#22c55e', text: `${analysis.correctCount}`, label: 'Correct' },
    { value: analysis.incorrectCount, color: '#ef4444', text: `${analysis.incorrectCount}`, label: 'Incorrect' },
    { value: analysis.unattemptedCount, color: '#f59e0b', text: `${analysis.unattemptedCount}`, label: 'Skipped' },
  ].filter(item => item.value > 0), [analysis]);

  // Bar chart data for time per question
  const timePerQuestionData = useMemo(() => 
    analysis.timePerQuestion.slice(0, 15).map((item) => ({
      value: item.status === 'unattempted' && item.time <= 0 ? 1 : item.time,
      label: `Q${item.questionNumber}`,
      frontColor: STATUS_BAR_COLORS[item.status],
    })), [analysis.timePerQuestion]);

  // Bar chart data for time per tag
  const timePerTagData = useMemo(() => 
    analysis.timePerTag.map(item => ({
      value: item.avgTime,
      label: item.tag.length > 8 ? item.tag.substring(0, 8) + '...' : item.tag,
      frontColor: '#8b5cf6',
    })), [analysis.timePerTag]);

  // Calculate average time
  const avgTime = useMemo(() => {
    const totalTime = analysis.timePerQuestion.reduce((sum, q) => sum + q.time, 0);
    return analysis.timePerQuestion.length > 0 ? Math.round(totalTime / analysis.timePerQuestion.length) : 0;
  }, [analysis.timePerQuestion]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: colors.card }]}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <View>
              <Text style={[styles.title, { color: colors.text }]}>Test Analysis</Text>
              <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{test.groupName}</Text>
            </View>
            <TouchableOpacity style={[styles.closeButton, { backgroundColor: colors.background }]} onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView 
            style={styles.content} 
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.contentContainer}
          >
            {/* Score Summary */}
            <View style={[styles.scoreSummary, { backgroundColor: colors.inputBackground }]}>
              <View style={styles.scoreCircle}>
                <Text style={[styles.scorePercentage, { color: colors.text }]}>{test.percentage}%</Text>
                <Text style={[styles.scoreLabel, { color: colors.textSecondary }]}>Score</Text>
              </View>
              <View style={styles.scoreDetails}>
                <View style={styles.scoreDetailItem}>
                  <Text style={[styles.scoreDetailValue, { color: colors.text }]}>{test.score}/{test.totalQuestions}</Text>
                  <Text style={[styles.scoreDetailLabel, { color: colors.textSecondary }]}>Correct</Text>
                </View>
                <View style={styles.scoreDetailItem}>
                  <Text style={[styles.scoreDetailValue, { color: colors.text }]}>{avgTime}s</Text>
                  <Text style={[styles.scoreDetailLabel, { color: colors.textSecondary }]}>Avg Time</Text>
                </View>
                <View style={styles.scoreDetailItem}>
                  <Text style={[styles.scoreDetailValue, { color: colors.text }]}>{Math.floor(test.timeSpent / 60)}m</Text>
                  <Text style={[styles.scoreDetailLabel, { color: colors.textSecondary }]}>Total Time</Text>
                </View>
              </View>
            </View>

            {/* Question Performance Pie Chart */}
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
                      <Text style={[styles.legendText, { color: colors.textSecondary }]}>{item.label}: {item.value}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>

            {/* Time per Question Bar Chart */}
            <View style={[styles.chartSection, { backgroundColor: colors.inputBackground }]}>
              <View style={styles.chartHeader}>
                <Ionicons name="time" size={20} color={colors.primary} />
                <Text style={[styles.chartTitle, { color: colors.text }]}>Time per Question (seconds)</Text>
              </View>
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
                    maxValue={Math.max(...timePerQuestionData.map(d => d.value)) + 10}
                    isAnimated
                    animationDuration={300}
                  />
                </ScrollView>
              </View>
            </View>

            {/* Time per Tag Bar Chart */}
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
                    maxValue={Math.max(...timePerTagData.map(d => d.value)) + 10}
                    isAnimated
                    animationDuration={300}
                  />
                </View>
              </View>
            )}

            {/* Tag Performance */}
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
                        <Text style={[
                          styles.tagAccuracy,
                          { color: tag.accuracy >= 80 ? '#10b981' : tag.accuracy >= 60 ? '#f59e0b' : '#ef4444' }
                        ]}>
                          {tag.accuracy}%
                        </Text>
                      </View>
                      <View style={[styles.tagProgressBar, { backgroundColor: colors.border }]}>
                        <View 
                          style={[
                            styles.tagProgressFill,
                            { 
                              width: `${tag.accuracy}%`,
                              backgroundColor: tag.accuracy >= 80 ? '#10b981' : tag.accuracy >= 60 ? '#f59e0b' : '#ef4444',
                            }
                          ]} 
                        />
                      </View>
                      <Text style={[styles.tagScore, { color: colors.textSecondary }]}>{tag.correct}/{tag.total} correct</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Bottom spacing */}
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '92%',
    minHeight: '70%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  subtitle: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 2,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1e293b',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
  },
  // Score Summary
  scoreSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
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
    color: '#ffffff',
  },
  scoreDetailLabel: {
    fontSize: 11,
    color: '#9ca3af',
    marginTop: 2,
  },
  // Chart Section
  chartSection: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  chartHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  chartTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  chartHint: {
    fontSize: 11,
    color: '#9ca3af',
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
  // Pie Chart
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
    color: '#ffffff',
  },
  pieCenterLabel: {
    fontSize: 10,
    color: '#9ca3af',
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
    color: '#e2e8f0',
  },
  // Bar Chart
  barChartContainer: {
    alignItems: 'center',
  },
  // Tag Performance
  tagPerformanceList: {
    gap: 12,
  },
  tagPerformanceItem: {
    backgroundColor: '#0f172a',
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
    color: '#ffffff',
  },
  tagAccuracy: {
    fontSize: 14,
    fontWeight: '600',
  },
  tagProgressBar: {
    height: 6,
    backgroundColor: '#334155',
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
    color: '#9ca3af',
  },
});
