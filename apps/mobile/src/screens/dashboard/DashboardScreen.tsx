// ===========================================
// Lantern Study Mobile - Enhanced Dashboard Screen
// ===========================================

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Dimensions,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { BarChart, PieChart, LineChart } from 'react-native-gifted-charts';
import { useAuthStore } from '../../stores/authStore';
import { useFlashcardStore } from '../../stores/flashcardStore';
import { useTestStore } from '../../stores/testStore';
import { useGroupStore } from '../../stores/groupStore';
import { useStatsStore, TimePeriod, Badge, TopicPerformance, GroupPerformance, RecentTest, TroublesomeQuestion, UserLevel, LEVEL_THRESHOLDS } from '../../stores/statsStore';
import { useTheme } from '../../theme';
import TestAnalysisModal from '../../components/TestAnalysisModal';
import AIUsageBadge from '../../components/AIUsageBadge';
import { useAIHandlers } from '../../hooks/useAIHandlers';
import type { AIStudyRecommendation } from '../../services/ai';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Time period options
const TIME_PERIODS: { value: TimePeriod; label: string }[] = [
  { value: '7days', label: '7 Days' },
  { value: '30days', label: '30 Days' },
  { value: '90days', label: '90 Days' },
  { value: 'all', label: 'All Time' },
];

// Tab options for in-depth analysis
type AnalysisTab = 'topics' | 'speed' | 'troublesome';

// Duration options for group comparison
type ComparisonDuration = '7days' | '14days' | '30days' | '90days';
const COMPARISON_DURATIONS: { value: ComparisonDuration; label: string }[] = [
  { value: '7days', label: '7D' },
  { value: '14days', label: '14D' },
  { value: '30days', label: '30D' },
  { value: '90days', label: '90D' },
];

// Line colors for group comparison chart
const LINE_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export default function DashboardScreen() {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const [activeAnalysisTab, setActiveAnalysisTab] = useState<AnalysisTab>('topics');
  const [showBadgeModal, setShowBadgeModal] = useState(false);
  const [selectedBadge, setSelectedBadge] = useState<Badge | null>(null);
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [selectedTest, setSelectedTest] = useState<RecentTest | null>(null);
  
  // Group comparison states
  const [selectedComparisonGroups, setSelectedComparisonGroups] = useState<string[]>([]);
  const [comparisonDuration, setComparisonDuration] = useState<ComparisonDuration>('7days');
  
  // Get data from stores
  const { user } = useAuthStore();
  const { decks, flashcards, fetchDecks } = useFlashcardStore();
  const { tests, attempts, fetchTests, fetchAttempts } = useTestStore();
  const { groups, fetchGroups } = useGroupStore();
  const { stats, selectedPeriod, isLoading, fetchStats, setSelectedPeriod } = useStatsStore();
  
  const userName = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'Student';

  // Fetch all data on mount
  useEffect(() => {
    if (user?.id) {
      fetchDecks(user.id);
      fetchTests(user.id);
      fetchAttempts(user.id);
      fetchGroups(user.id);
      fetchStats(user.id, selectedPeriod);
    }
  }, [user?.id]);

  // Handle period change
  const handlePeriodChange = useCallback((period: TimePeriod) => {
    setSelectedPeriod(period);
    if (user?.id) {
      fetchStats(user.id, period);
    }
  }, [user?.id, fetchStats, setSelectedPeriod]);

  // Calculate basic stats from local stores
  const localStats = useMemo(() => {
    const totalCards = Object.values(flashcards).reduce((sum, cards) => sum + cards.length, 0);
    const now = new Date();
    const dueCards = Object.values(flashcards).flat().filter(card => {
      const nextReview = card.srs_data?.next_review;
      return !nextReview || new Date(nextReview) <= now;
    }).length;
    
    return {
      cardsCount: totalCards,
      cardsToReview: dueCards,
      decksCount: decks.length,
      testsCount: tests.length,
      groupsCount: groups.length,
    };
  }, [flashcards, decks, tests, groups]);

  // Weekly activity data for bar chart
  const weeklyActivityData = useMemo(() => {
    if (!stats?.weeklyActivity) return [];
    return stats.weeklyActivity.map((item, index) => ({
      value: item.count,
      label: item.day,
      frontColor: index === stats.weeklyActivity.length - 1 ? '#8b5cf6' : '#6366f1',
    }));
  }, [stats?.weeklyActivity]);

  // Initialize selected comparison groups when stats load
  useEffect(() => {
    if (stats?.groupPerformance && selectedComparisonGroups.length === 0) {
      // Select first 2 groups by default
      const defaultGroups = stats.groupPerformance.slice(0, 2).map(g => g.groupId);
      setSelectedComparisonGroups(defaultGroups);
    }
  }, [stats?.groupPerformance]);

  // Toggle group selection for comparison
  const toggleComparisonGroup = useCallback((groupId: string) => {
    setSelectedComparisonGroups(prev => {
      if (prev.includes(groupId)) {
        // Don't allow deselecting if only one is selected
        if (prev.length === 1) return prev;
        return prev.filter(id => id !== groupId);
      } else {
        // Max 4 groups for readability
        if (prev.length >= 4) return prev;
        return [...prev, groupId];
      }
    });
  }, []);

  // Line chart data for group comparison
  const groupComparisonLineData = useMemo(() => {
    if (!stats?.groupPerformance || selectedComparisonGroups.length === 0) return [];
    
    // Filter groups based on selection
    const selectedGroups = stats.groupPerformance.filter(g => 
      selectedComparisonGroups.includes(g.groupId)
    );
    
    // Calculate days to show based on duration
    const daysToShow = comparisonDuration === '7days' ? 7 : 
                       comparisonDuration === '14days' ? 14 :
                       comparisonDuration === '30days' ? 30 : 90;
    
    // Get chart data for each selected group
    return selectedGroups.map((group, index) => {
      const data = group.chartData?.slice(-daysToShow) || [];
      return {
        groupId: group.groupId,
        groupName: group.groupName,
        color: LINE_COLORS[index % LINE_COLORS.length],
        data: data.map((point, i) => ({
          value: point.score,
          label: i === 0 || i === data.length - 1 ? new Date(point.date).getDate().toString() : '',
          dataPointText: '',
        })),
      };
    });
  }, [stats?.groupPerformance, selectedComparisonGroups, comparisonDuration]);

  // Legacy group comparison data (keeping for backward compatibility if needed elsewhere)
  const groupComparisonData = useMemo(() => {
    if (!stats?.groupPerformance) return [];
    const colors = ['#6366f1', '#8b5cf6', '#a855f7', '#c084fc', '#e879f9'];
    return stats.groupPerformance.map((group, i) => ({
      value: group.averageScore,
      color: colors[i % colors.length],
      text: `${group.averageScore}%`,
    }));
  }, [stats?.groupPerformance]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (user?.id) {
      await Promise.all([
        fetchDecks(user.id),
        fetchTests(user.id),
        fetchAttempts(user.id),
        fetchGroups(user.id),
        fetchStats(user.id, selectedPeriod),
      ]);
    }
    setRefreshing(false);
  }, [user?.id, selectedPeriod]);

  const handleQuickAction = useCallback((action: string) => {
    switch (action) {
      case 'review':
        navigation.navigate('Flashcards');
        break;
      case 'test':
        navigation.navigate('Tests');
        break;
      case 'groups':
        navigation.navigate('Groups');
        break;
    }
  }, [navigation]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  // ========== Components ==========

  const TimePeriodSelector = () => (
    <View style={[styles.periodSelector, { backgroundColor: colors.card }]}>
      {TIME_PERIODS.map(period => (
        <TouchableOpacity
          key={period.value}
          style={[
            styles.periodButton,
            { backgroundColor: selectedPeriod === period.value ? colors.primary : 'transparent' },
          ]}
          onPress={() => handlePeriodChange(period.value)}
        >
          <Text
            style={[
              styles.periodButtonText,
              { color: selectedPeriod === period.value ? '#fff' : colors.textSecondary },
            ]}
          >
            {period.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  const StatCard = ({ icon, label, value, color, subtitle }: { 
    icon: string; 
    label: string; 
    value: string | number; 
    color: string;
    subtitle?: string;
  }) => (
    <View style={[styles.statCard, { backgroundColor: colors.card }]}>
      <View style={[styles.statIconContainer, { backgroundColor: color + '20' }]}>
        <Ionicons name={icon as any} size={22} color={color} />
      </View>
      <Text style={[styles.statValue, { color: colors.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{label}</Text>
      {subtitle && <Text style={[styles.statSubtitle, { color: colors.textSecondary }]}>{subtitle}</Text>}
    </View>
  );

  const BadgeItem = ({ badge, onPress }: { badge: Badge; onPress: () => void }) => (
    <TouchableOpacity style={[styles.badgeItem, { backgroundColor: colors.card }]} onPress={onPress}>
      <View style={[styles.badgeIconContainer, badge.level > 0 ? styles.badgeUnlocked : { backgroundColor: colors.inputBackground }]}>
        <Ionicons name={badge.icon as any} size={24} color={badge.level > 0 ? '#fbbf24' : colors.textSecondary} />
      </View>
      <View style={styles.badgeInfo}>
        <Text style={[styles.badgeName, { color: colors.text }]} numberOfLines={1}>{badge.name}</Text>
        <Text style={[styles.badgeLevel, { color: colors.textSecondary }]}>
          {badge.level > 0 ? `Level ${badge.level}/${badge.maxLevel}` : 'Locked'}
        </Text>
        <View style={[styles.badgeProgressBar, { backgroundColor: colors.inputBackground }]}>
          <View style={[styles.badgeProgressFill, { width: `${badge.progress}%` }]} />
        </View>
        <Text style={[styles.badgeProgressText, { color: colors.textSecondary }]}>
          {badge.currentValue}/{badge.targetValue}
        </Text>
      </View>
    </TouchableOpacity>
  );

  const TopicPerformanceItem = ({ topic, index }: { topic: TopicPerformance; index: number }) => (
    <View style={[styles.topicItem, { backgroundColor: colors.card }]}>
      <View style={styles.topicHeader}>
        <Text style={[styles.topicRank, { color: colors.textSecondary }]}>#{index + 1}</Text>
        <Text style={[styles.topicName, { color: colors.text }]}>{topic.tag}</Text>
        <Text style={[
          styles.topicAccuracy,
          { color: topic.accuracy >= 80 ? '#10b981' : topic.accuracy >= 60 ? '#f59e0b' : '#ef4444' }
        ]}>
          {topic.accuracy}%
        </Text>
      </View>
      <View style={[styles.topicProgressBar, { backgroundColor: colors.inputBackground }]}>
        <View style={[
          styles.topicProgressFill, 
          { 
            width: `${topic.accuracy}%`,
            backgroundColor: topic.accuracy >= 80 ? '#10b981' : topic.accuracy >= 60 ? '#f59e0b' : '#ef4444',
          }
        ]} />
      </View>
      <View style={styles.topicStats}>
        <Text style={[styles.topicStatText, { color: colors.textSecondary }]}>
          {topic.correctAnswers}/{topic.totalQuestions} correct
        </Text>
        <Text style={[styles.topicStatText, { color: colors.textSecondary }]}>
          Avg: {topic.averageTime}s
        </Text>
      </View>
    </View>
  );

  const GroupPerformanceCard = ({ group }: { group: GroupPerformance }) => {
    const lineData = group.chartData.map(d => ({
      value: d.score,
      dataPointText: '',
    }));

    return (
      <View style={[styles.groupPerformanceCard, { backgroundColor: colors.card }]}>
        <View style={styles.groupPerformanceHeader}>
          <Text style={[styles.groupPerformanceName, { color: colors.text }]} numberOfLines={1}>{group.groupName}</Text>
          <Text style={[styles.groupPerformanceScore, { color: colors.primary }]}>{group.averageScore}%</Text>
        </View>
        <View style={styles.groupPerformanceChart}>
          <LineChart
            data={lineData}
            width={SCREEN_WIDTH - 120}
            height={80}
            spacing={30}
            initialSpacing={10}
            color={colors.primary}
            thickness={2}
            startFillColor="rgba(99, 102, 241, 0.2)"
            endFillColor="rgba(99, 102, 241, 0)"
            startOpacity={0.8}
            endOpacity={0}
            areaChart
            hideDataPoints
            hideRules
            hideYAxisText
            hideAxesAndRules
            curved
            isAnimated
          />
        </View>
        <View style={styles.groupPerformanceStats}>
          <View style={styles.groupStatItem}>
            <Ionicons name="document-text-outline" size={14} color={colors.textSecondary} />
            <Text style={[styles.groupStatValue, { color: colors.textSecondary }]}>{group.testsCount} tests</Text>
          </View>
          <View style={styles.groupStatItem}>
            <Ionicons name="checkmark-circle-outline" size={14} color={colors.textSecondary} />
            <Text style={[styles.groupStatValue, { color: colors.textSecondary }]}>{group.accuracy}% accuracy</Text>
          </View>
          <View style={styles.groupStatItem}>
            <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
            <Text style={[styles.groupStatValue, { color: colors.textSecondary }]}>{group.averageTimePerQuestion}s avg</Text>
          </View>
        </View>
      </View>
    );
  };

  // ─── AI Study Coach Card ───────────────────────────────────
  const AIStudyCoachCard = () => {
    const [recommendation, setRecommendation] = useState<AIStudyRecommendation | null>(null);
    const [coachLoading, setCoachLoading] = useState(false);
    const [coachError, setCoachError] = useState<string | null>(null);
    const { handleAIStudyRecommendations } = useAIHandlers();

    const fetchRecommendation = async () => {
      setCoachLoading(true);
      setCoachError(null);

      // Build performance data from stores
      const recentScores = (stats?.recentTests || []).map(t => ({
        topic: t.groupName || 'General',
        score: t.percentage,
        date: t.completedAt,
      }));
      const flashcardAccuracy = (stats?.topicPerformance || []).map(tp => ({
        topic: tp.topic,
        correctRate: tp.accuracy,
      }));

      const result = await handleAIStudyRecommendations({
        recentScores,
        flashcardAccuracy,
        studyHoursThisWeek: stats?.studyHoursThisWeek || 0,
      });

      if (result) {
        setRecommendation(result);
      } else {
        setCoachError('Could not get recommendations');
      }
      setCoachLoading(false);
    };

    return (
      <View style={[styles.aiCoachCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.aiCoachHeader}>
          <View style={styles.aiCoachTitleRow}>
            <Ionicons name="sparkles" size={20} color={colors.primary} />
            <Text style={[styles.aiCoachTitle, { color: colors.text }]}>AI Study Coach</Text>
          </View>
          <AIUsageBadge variant="badge" />
        </View>

        {!recommendation && !coachLoading && (
          <TouchableOpacity
            style={[styles.aiCoachBtn, { backgroundColor: colors.primary }]}
            onPress={fetchRecommendation}
          >
            <Ionicons name="bulb" size={18} color="#fff" />
            <Text style={styles.aiCoachBtnText}>Get Personalized Recommendations</Text>
          </TouchableOpacity>
        )}

        {coachLoading && (
          <View style={styles.aiCoachLoading}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.aiCoachLoadingText, { color: colors.textSecondary }]}>
              Analyzing your performance...
            </Text>
          </View>
        )}

        {coachError && (
          <Text style={[styles.aiCoachErrorText, { color: colors.error }]}>{coachError}</Text>
        )}

        {recommendation && (
          <View style={styles.aiCoachResult}>
            <Text style={[styles.aiCoachTip, { color: colors.text }]}>
              💡 {recommendation.studyTip}
            </Text>
            {recommendation.weakTopics.length > 0 && (
              <View style={styles.aiCoachSection}>
                <Text style={[styles.aiCoachSectionLabel, { color: colors.textSecondary }]}>
                  Focus on these topics:
                </Text>
                <View style={styles.aiCoachTopics}>
                  {recommendation.weakTopics.map((topic, i) => (
                    <View key={i} style={[styles.aiCoachTopicBadge, { backgroundColor: colors.errorBackground }]}>
                      <Text style={[styles.aiCoachTopicText, { color: colors.error }]}>{topic}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
            <View style={styles.aiCoachEstimate}>
              <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
              <Text style={[styles.aiCoachEstimateText, { color: colors.textSecondary }]}>
                Estimated study time: {recommendation.estimatedMinutes} min
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.aiCoachRefresh, { borderColor: colors.border }]}
              onPress={fetchRecommendation}
            >
              <Ionicons name="refresh" size={14} color={colors.primary} />
              <Text style={[styles.aiCoachRefreshText, { color: colors.primary }]}>Refresh</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const RecentTestItem = ({ test }: { test: RecentTest }) => (
    <TouchableOpacity 
      style={[styles.recentTestItem, { backgroundColor: colors.card }]}
      onPress={() => {
        setSelectedTest(test);
        setShowAnalysisModal(true);
      }}
    >
      <View style={styles.recentTestLeft}>
        <View style={[
          styles.recentTestScoreBadge,
          { 
            backgroundColor: test.percentage >= 80 ? '#10b98120' : 
                            test.percentage >= 60 ? '#f59e0b20' : '#ef444420',
          }
        ]}>
          <Text style={[
            styles.recentTestScoreText,
            { 
              color: test.percentage >= 80 ? '#10b981' : 
                     test.percentage >= 60 ? '#f59e0b' : '#ef4444',
            }
          ]}>
            {test.percentage}%
          </Text>
        </View>
        <View style={styles.recentTestInfo}>
          <Text style={[styles.recentTestGroup, { color: colors.text }]} numberOfLines={1}>{test.groupName}</Text>
          <Text style={[styles.recentTestDetails, { color: colors.textSecondary }]}>
            {test.score}/{test.totalQuestions} • {formatTime(test.timeSpent)}
          </Text>
        </View>
      </View>
      <View style={styles.recentTestRight}>
        <Text style={[styles.recentTestDate, { color: colors.textSecondary }]}>{formatDate(test.completedAt)}</Text>
        <View style={styles.viewAnalysisHint}>
          <Ionicons name="analytics" size={14} color={colors.primary} />
          <Text style={[styles.viewAnalysisText, { color: colors.primary }]}>View</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  const TroublesomeQuestionItem = ({ question }: { question: TroublesomeQuestion }) => (
    <View style={[styles.troublesomeItem, { backgroundColor: colors.card }]}>
      <View style={styles.troublesomeHeader}>
        <View style={styles.troublesomeBadge}>
          <Ionicons name="warning" size={14} color="#ef4444" />
          <Text style={styles.troublesomeCount}>
            {question.incorrectAttempts}/{question.totalAttempts} incorrect
          </Text>
        </View>
        <Text style={[styles.troublesomeGroup, { color: colors.textSecondary }]}>{question.groupName}</Text>
      </View>
      <Text style={[styles.troublesomeQuestion, { color: colors.text }]} numberOfLines={2}>
        {question.stem}
      </Text>
    </View>
  );

  const AnalysisTabs = () => (
    <View style={[styles.analysisTabs, { backgroundColor: colors.card }]}>
      <TouchableOpacity
        style={[styles.analysisTab, activeAnalysisTab === 'topics' && styles.analysisTabActive]}
        onPress={() => setActiveAnalysisTab('topics')}
      >
        <Ionicons name="bar-chart" size={18} color={activeAnalysisTab === 'topics' ? colors.primary : colors.textSecondary} />
        <Text style={[styles.analysisTabText, { color: activeAnalysisTab === 'topics' ? colors.primary : colors.textSecondary }]}>
          Topics
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.analysisTab, activeAnalysisTab === 'speed' && styles.analysisTabActive]}
        onPress={() => setActiveAnalysisTab('speed')}
      >
        <Ionicons name="speedometer" size={18} color={activeAnalysisTab === 'speed' ? colors.primary : colors.textSecondary} />
        <Text style={[styles.analysisTabText, { color: activeAnalysisTab === 'speed' ? colors.primary : colors.textSecondary }]}>
          Speed
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.analysisTab, activeAnalysisTab === 'troublesome' && styles.analysisTabActive]}
        onPress={() => setActiveAnalysisTab('troublesome')}
      >
        <Ionicons name="alert-circle" size={18} color={activeAnalysisTab === 'troublesome' ? colors.primary : colors.textSecondary} />
        <Text style={[styles.analysisTabText, { color: activeAnalysisTab === 'troublesome' ? colors.primary : colors.textSecondary }]}>
          Needs Work
        </Text>
      </TouchableOpacity>
    </View>
  );

  // Badge Modal
  const BadgeModal = () => (
    <Modal
      visible={showBadgeModal}
      transparent
      animationType="fade"
      onRequestClose={() => setShowBadgeModal(false)}
    >
      <TouchableOpacity 
        style={[styles.modalOverlay, { backgroundColor: colors.modalOverlay }]} 
        activeOpacity={1}
        onPress={() => setShowBadgeModal(false)}
      >
        <View style={[styles.badgeModalContent, { backgroundColor: colors.card }]}>
          {selectedBadge && (
            <>
              <View style={[
                styles.badgeModalIcon,
                selectedBadge.level > 0 ? styles.badgeUnlocked : { backgroundColor: colors.inputBackground }
              ]}>
                <Ionicons 
                  name={selectedBadge.icon as any} 
                  size={48} 
                  color={selectedBadge.level > 0 ? '#fbbf24' : colors.textSecondary} 
                />
              </View>
              <Text style={[styles.badgeModalName, { color: colors.text }]}>{selectedBadge.name}</Text>
              <Text style={[styles.badgeModalDescription, { color: colors.textSecondary }]}>{selectedBadge.description}</Text>
              <Text style={[styles.badgeModalLevel, { color: colors.primary }]}>
                {selectedBadge.level > 0 
                  ? `Level ${selectedBadge.level} of ${selectedBadge.maxLevel}`
                  : 'Not Yet Unlocked'
                }
              </Text>
              <View style={styles.badgeModalProgressContainer}>
                <View style={[styles.badgeModalProgressBar, { backgroundColor: colors.inputBackground }]}>
                  <View style={[styles.badgeModalProgressFill, { width: `${selectedBadge.progress}%` }]} />
                </View>
                <Text style={[styles.badgeModalProgressText, { color: colors.textSecondary }]}>
                  {selectedBadge.currentValue}/{selectedBadge.targetValue}
                </Text>
              </View>
              {selectedBadge.unlockedAt && (
                <Text style={[styles.badgeModalUnlocked, { color: colors.textSecondary }]}>
                  Unlocked on {new Date(selectedBadge.unlockedAt).toLocaleDateString()}
                </Text>
              )}
            </>
          )}
        </View>
      </TouchableOpacity>
    </Modal>
  );

  if (isLoading && !stats) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading your stats...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={[styles.greeting, { color: colors.textSecondary }]}>Welcome back,</Text>
            <Text style={[styles.userName, { color: colors.text }]}>{userName}!</Text>
          </View>
          <View style={styles.headerRight}>
            <View style={[styles.pointsBadge, { backgroundColor: colors.card }]}>
              <Ionicons name="star" size={16} color="#fbbf24" />
              <Text style={styles.pointsText}>{stats?.totalPoints?.toLocaleString() || 0}</Text>
            </View>
          </View>
        </View>

        {/* Time Period Filter */}
        <TimePeriodSelector />

        {/* Streak Banner */}
        <View style={[styles.streakBanner, { backgroundColor: colors.card }]}>
          <View style={[styles.streakIconContainer, { backgroundColor: colors.warningBackground }]}>
            <Ionicons name="flame" size={32} color="#f97316" />
          </View>
          <View style={styles.streakInfo}>
            <Text style={[styles.streakCount, { color: colors.text }]}>{stats?.currentStreak || 0} Day Streak!</Text>
            <Text style={[styles.streakMessage, { color: colors.textSecondary }]}>
              {stats?.longestStreak && stats.currentStreak < stats.longestStreak 
                ? `Best: ${stats.longestStreak} days. Keep going!`
                : 'This is your best streak! 🎉'
              }
            </Text>
          </View>
        </View>

        {/* Overall Activity Stats */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Overall Activity</Text>
        <View style={styles.statsGrid}>
          <StatCard
            icon="document-text"
            label="Tests Taken"
            value={stats?.totalTestsTaken || 0}
            color="#6366f1"
          />
          <StatCard
            icon="time"
            label="Avg Time/Q"
            value={`${stats?.averageTimePerQuestion || 0}s`}
            color="#8b5cf6"
          />
          <StatCard
            icon="checkmark-circle"
            label="Accuracy"
            value={`${stats?.overallAccuracy || 0}%`}
            color="#10b981"
          />
          <StatCard
            icon="hourglass"
            label="Study Time"
            value={`${Math.floor((stats?.totalStudyTime || 0) / 60)}h`}
            color="#f59e0b"
          />
        </View>

        {/* My Achievements - Enhanced with Level */}
        <View style={[styles.achievementsCard, { backgroundColor: colors.card }]}>
          {/* User Level Section */}
          <View style={styles.levelSection}>
            <View style={styles.levelBadge}>
              <Text style={styles.levelNumber}>{stats?.userLevel?.level || 1}</Text>
            </View>
            <View style={styles.levelInfo}>
              <Text style={[styles.levelName, { color: colors.text }]}>{stats?.userLevel?.name || 'Novice'}</Text>
              <Text style={[styles.levelXP, { color: colors.primary }]}>
                {stats?.userLevel?.currentXP?.toLocaleString() || 0} XP
              </Text>
              <View style={styles.levelProgressContainer}>
                <View style={[styles.levelProgressBar, { backgroundColor: colors.inputBackground }]}>
                  <View 
                    style={[
                      styles.levelProgressFill, 
                      { width: `${stats?.userLevel?.progressToNextLevel || 0}%` }
                    ]} 
                  />
                </View>
                <Text style={[styles.levelProgressText, { color: colors.textSecondary }]}>
                  {stats?.userLevel?.xpForNextLevel && stats?.userLevel?.level < 12
                    ? `${stats.userLevel.xpForNextLevel - stats.userLevel.currentXP} XP to Level ${stats.userLevel.level + 1}`
                    : 'Max Level!'
                  }
                </Text>
              </View>
            </View>
          </View>

          {/* Divider */}
          <View style={[styles.achievementsDivider, { backgroundColor: colors.border }]} />

          {/* Badges Section */}
          <View style={styles.badgesSection}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.badgesSectionTitle, { color: colors.text }]}>Badges & Progress</Text>
              <TouchableOpacity onPress={() => navigation.navigate('More', { screen: 'Settings' })}>
                <Text style={[styles.seeAllText, { color: colors.primary }]}>See All</Text>
              </TouchableOpacity>
            </View>
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.badgesScrollContent}
            >
              {stats?.badges?.slice(0, 5).map(badge => (
                <BadgeItem
                  key={badge.id}
                  badge={badge}
                  onPress={() => {
                    setSelectedBadge(badge);
                    setShowBadgeModal(true);
                  }}
                />
              ))}
            </ScrollView>
          </View>
        </View>

        {/* Weekly Activity Chart */}
        <View style={[styles.chartContainer, { backgroundColor: colors.card }]}>
          <Text style={[styles.sectionTitleInCard, { color: colors.text }]}>Weekly Activity</Text>
          <Text style={[styles.chartSubtitle, { color: colors.textSecondary }]}>Questions answered per day</Text>
          {weeklyActivityData.length > 0 && (
            <View style={styles.chartWrapper}>
              <BarChart
                data={weeklyActivityData}
                width={SCREEN_WIDTH - 80}
                height={130}
                barWidth={28}
                spacing={16}
                roundedTop
                roundedBottom
                hideRules
                xAxisThickness={0}
                yAxisThickness={0}
                yAxisTextStyle={{ color: colors.textSecondary, fontSize: 10 }}
                xAxisLabelTextStyle={{ color: colors.textSecondary, fontSize: 11 }}
                noOfSections={4}
                maxValue={Math.max(...weeklyActivityData.map(d => d.value)) + 5}
                isAnimated
                animationDuration={500}
              />
            </View>
          )}
        </View>

        {/* In-Depth Analysis */}
        <View style={[styles.chartContainer, { backgroundColor: colors.card }]}>
          <Text style={[styles.sectionTitleInCard, { color: colors.text }]}>In-Depth Analysis</Text>
          <AnalysisTabs />
          
          {activeAnalysisTab === 'topics' && (
            <View style={styles.topicsList}>
              {stats?.topicPerformance?.slice(0, 5).map((topic, index) => (
                <TopicPerformanceItem key={topic.tag} topic={topic} index={index} />
              ))}
            </View>
          )}

          {activeAnalysisTab === 'speed' && (
            <View style={styles.speedAnalysis}>
              <View style={[styles.speedCard, { backgroundColor: colors.inputBackground }]}>
                <View style={styles.speedCardIcon}>
                  <Ionicons name="flash" size={24} color="#f59e0b" />
                </View>
                <View style={styles.speedCardContent}>
                  <Text style={[styles.speedCardValue, { color: colors.text }]}>{stats?.averageTimePerQuestion || 0}s</Text>
                  <Text style={[styles.speedCardLabel, { color: colors.textSecondary }]}>Average Time per Question</Text>
                </View>
              </View>
              <View style={[styles.speedTopics, { backgroundColor: colors.inputBackground }]}>
                <Text style={[styles.speedTopicsTitle, { color: colors.text }]}>Speed by Topic</Text>
                {stats?.topicPerformance?.slice(0, 4).map(topic => (
                  <View key={topic.tag} style={[styles.speedTopicItem, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.speedTopicName, { color: colors.text }]}>{topic.tag}</Text>
                    <Text style={[styles.speedTopicTime, { color: colors.primary }]}>{topic.averageTime}s</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {activeAnalysisTab === 'troublesome' && (
            <View style={styles.troublesomeList}>
              {stats?.troublesomeQuestions?.length ? (
                stats.troublesomeQuestions.map(q => (
                  <TroublesomeQuestionItem key={q.id} question={q} />
                ))
              ) : (
                <View style={styles.emptyState}>
                  <Ionicons name="checkmark-circle" size={48} color="#10b981" />
                  <Text style={[styles.emptyStateText, { color: colors.textSecondary }]}>Great job! No troublesome questions.</Text>
                </View>
              )}
            </View>
          )}
        </View>

        {/* Performance by Group */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Performance by Group</Text>
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.groupsScrollContent}
        >
          {stats?.groupPerformance?.map(group => (
            <GroupPerformanceCard key={group.groupId} group={group} />
          ))}
        </ScrollView>

        {/* Group Comparison Line Chart */}
        {stats?.groupPerformance && stats.groupPerformance.length > 0 && (
          <View style={[styles.chartContainer, { backgroundColor: colors.card }]}>
            <Text style={[styles.sectionTitleInCard, { color: colors.text }]}>Group Comparison</Text>
            <Text style={[styles.chartSubtitle, { color: colors.textSecondary }]}>Performance trends over time</Text>
            
            {/* Duration Selector */}
            <View style={styles.comparisonDurationSelector}>
              {COMPARISON_DURATIONS.map(duration => (
                <TouchableOpacity
                  key={duration.value}
                  style={[
                    styles.comparisonDurationChip,
                    { backgroundColor: comparisonDuration === duration.value ? colors.primary : colors.inputBackground }
                  ]}
                  onPress={() => setComparisonDuration(duration.value)}
                >
                  <Text style={[
                    styles.comparisonDurationChipText,
                    { color: comparisonDuration === duration.value ? '#fff' : colors.textSecondary }
                  ]}>
                    {duration.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            
            {/* Group Selector */}
            <Text style={[styles.groupSelectorLabel, { color: colors.textSecondary }]}>Select groups to compare (max 4):</Text>
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false}
              style={styles.groupSelectorScroll}
              contentContainerStyle={styles.groupSelectorContent}
            >
              {stats.groupPerformance.map((group, index) => {
                const isSelected = selectedComparisonGroups.includes(group.groupId);
                const colorIndex = selectedComparisonGroups.indexOf(group.groupId);
                return (
                  <TouchableOpacity
                    key={group.groupId}
                    style={[
                      styles.groupSelectorChip,
                      { borderColor: colors.border, backgroundColor: colors.inputBackground },
                      isSelected && { 
                        borderColor: LINE_COLORS[colorIndex % LINE_COLORS.length],
                        backgroundColor: `${LINE_COLORS[colorIndex % LINE_COLORS.length]}20`
                      }
                    ]}
                    onPress={() => toggleComparisonGroup(group.groupId)}
                  >
                    {isSelected && (
                      <View style={[styles.groupSelectorDot, { backgroundColor: LINE_COLORS[colorIndex % LINE_COLORS.length] }]} />
                    )}
                    <Text style={[
                      styles.groupSelectorChipText,
                      { color: colors.textSecondary },
                      isSelected && { color: LINE_COLORS[colorIndex % LINE_COLORS.length] }
                    ]} numberOfLines={1}>
                      {group.groupName.length > 15 ? group.groupName.substring(0, 15) + '...' : group.groupName}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            
            {/* Line Chart */}
            {groupComparisonLineData.length > 0 && groupComparisonLineData[0]?.data?.length > 0 ? (
              <View style={styles.lineChartWrapper}>
                <LineChart
                  data={groupComparisonLineData[0]?.data || []}
                  data2={groupComparisonLineData[1]?.data}
                  data3={groupComparisonLineData[2]?.data}
                  data4={groupComparisonLineData[3]?.data}
                  color={groupComparisonLineData[0]?.color || '#6366f1'}
                  color2={groupComparisonLineData[1]?.color}
                  color3={groupComparisonLineData[2]?.color}
                  color4={groupComparisonLineData[3]?.color}
                  width={SCREEN_WIDTH - 80}
                  height={180}
                  curved
                  thickness={2}
                  hideDataPoints={false}
                  dataPointsColor={groupComparisonLineData[0]?.color || '#6366f1'}
                  dataPointsColor2={groupComparisonLineData[1]?.color}
                  dataPointsColor3={groupComparisonLineData[2]?.color}
                  dataPointsColor4={groupComparisonLineData[3]?.color}
                  dataPointsRadius={4}
                  xAxisColor={colors.border}
                  yAxisColor={colors.border}
                  yAxisTextStyle={{ color: colors.textSecondary, fontSize: 10 }}
                  xAxisLabelTextStyle={{ color: colors.textSecondary, fontSize: 10 }}
                  noOfSections={4}
                  maxValue={100}
                  yAxisLabelSuffix="%"
                  rulesColor={colors.border}
                  rulesType="solid"
                  areaChart
                  startFillColor={`${groupComparisonLineData[0]?.color || '#6366f1'}30`}
                  endFillColor={`${groupComparisonLineData[0]?.color || '#6366f1'}05`}
                  startFillColor2={groupComparisonLineData[1] ? `${groupComparisonLineData[1].color}30` : undefined}
                  endFillColor2={groupComparisonLineData[1] ? `${groupComparisonLineData[1].color}05` : undefined}
                  startFillColor3={groupComparisonLineData[2] ? `${groupComparisonLineData[2].color}30` : undefined}
                  endFillColor3={groupComparisonLineData[2] ? `${groupComparisonLineData[2].color}05` : undefined}
                  startFillColor4={groupComparisonLineData[3] ? `${groupComparisonLineData[3].color}30` : undefined}
                  endFillColor4={groupComparisonLineData[3] ? `${groupComparisonLineData[3].color}05` : undefined}
                  initialSpacing={10}
                  spacing={SCREEN_WIDTH / (groupComparisonLineData[0]?.data?.length || 7 + 2)}
                />
                
                {/* Legend */}
                <View style={styles.lineChartLegend}>
                  {groupComparisonLineData.map(group => (
                    <View key={group.groupId} style={styles.lineChartLegendItem}>
                      <View style={[styles.lineChartLegendLine, { backgroundColor: group.color }]} />
                      <Text style={[styles.lineChartLegendText, { color: colors.textSecondary }]} numberOfLines={1}>
                        {group.groupName.length > 12 ? group.groupName.substring(0, 12) + '...' : group.groupName}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : (
              <View style={styles.emptyState}>
                <Ionicons name="analytics-outline" size={40} color={colors.textSecondary} />
                <Text style={[styles.emptyStateText, { color: colors.textSecondary }]}>Select groups to compare</Text>
              </View>
            )}
          </View>
        )}

        {/* Recent Tests */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Recent Tests</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Tests')}>
            <Text style={[styles.seeAllText, { color: colors.primary }]}>View All</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.recentTestsContainer}>
          {stats?.recentTests?.slice(0, 5).map(test => (
            <RecentTestItem key={test.id} test={test} />
          ))}
        </View>

        {/* AI Study Coach */}
        <AIStudyCoachCard />

        {/* Quick Actions */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Quick Actions</Text>
        <View style={styles.actionsContainer}>
          <TouchableOpacity style={[styles.actionButton, { backgroundColor: colors.card }]} onPress={() => handleQuickAction('review')}>
            <View style={[styles.actionIcon, { backgroundColor: '#6366f120' }]}>
              <Ionicons name="play" size={24} color={colors.primary} />
            </View>
            <View style={styles.actionContent}>
              <Text style={[styles.actionText, { color: colors.text }]}>Continue Review</Text>
              <Text style={[styles.actionSubtext, { color: colors.textSecondary }]}>{localStats.cardsToReview} cards due</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
          </TouchableOpacity>

          <TouchableOpacity style={[styles.actionButton, { backgroundColor: colors.card }]} onPress={() => handleQuickAction('test')}>
            <View style={[styles.actionIcon, { backgroundColor: '#10b98120' }]}>
              <Ionicons name="document-text" size={24} color="#10b981" />
            </View>
            <View style={styles.actionContent}>
              <Text style={[styles.actionText, { color: colors.text }]}>Take a Test</Text>
              <Text style={[styles.actionSubtext, { color: colors.textSecondary }]}>{localStats.testsCount} tests available</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
          </TouchableOpacity>

          <TouchableOpacity style={[styles.actionButton, { backgroundColor: colors.card }]} onPress={() => handleQuickAction('groups')}>
            <View style={[styles.actionIcon, { backgroundColor: '#f9731620' }]}>
              <Ionicons name="people" size={24} color="#f97316" />
            </View>
            <View style={styles.actionContent}>
              <Text style={[styles.actionText, { color: colors.text }]}>My Study Groups</Text>
              <Text style={[styles.actionSubtext, { color: colors.textSecondary }]}>{localStats.groupsCount} groups</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Bottom Spacing */}
        <View style={{ height: 100 }} />
      </ScrollView>

      <BadgeModal />
      
      {/* Test Analysis Modal */}
      <TestAnalysisModal
        visible={showAnalysisModal}
        onClose={() => {
          setShowAnalysisModal(false);
          setSelectedTest(null);
        }}
        test={selectedTest}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: undefined,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 16,
  },
  greeting: {
    fontSize: 16,
  },
  userName: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  pointsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  pointsText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fbbf24',
  },
  periodSelector: {
    flexDirection: 'row',
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 4,
    marginBottom: 20,
  },
  periodButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  periodButtonActive: {
    backgroundColor: '#6366f1',
  },
  periodButtonText: {
    fontSize: 13,
    color: '#9ca3af',
    fontWeight: '500',
  },
  periodButtonTextActive: {
    color: '#ffffff',
  },
  streakBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#f97316',
  },
  streakIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  streakInfo: {
    flex: 1,
  },
  streakCount: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  streakMessage: {
    fontSize: 14,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  sectionTitleInCard: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  seeAllText: {
    fontSize: 14,
    color: '#6366f1',
    fontWeight: '500',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
  },
  statCard: {
    width: (SCREEN_WIDTH - 52) / 2,
    backgroundColor: '#1e293b',
    padding: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  statIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  statValue: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: 'center',
  },
  statSubtitle: {
    fontSize: 10,
    color: '#64748b',
    marginTop: 2,
  },
  badgesScrollContent: {
    paddingBottom: 4,
    marginBottom: 20,
    gap: 12,
  },
  badgeItem: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 12,
    width: 140,
    alignItems: 'center',
  },
  badgeIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  badgeUnlocked: {
    backgroundColor: '#fbbf2420',
  },
  badgeLocked: {
    backgroundColor: '#64748b20',
  },
  badgeInfo: {
    alignItems: 'center',
    width: '100%',
  },
  badgeName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 4,
    textAlign: 'center',
  },
  badgeLevel: {
    fontSize: 10,
    color: '#9ca3af',
    marginBottom: 6,
  },
  badgeProgressBar: {
    width: '100%',
    height: 4,
    backgroundColor: '#334155',
    borderRadius: 2,
    overflow: 'hidden',
  },
  badgeProgressFill: {
    height: '100%',
    backgroundColor: '#6366f1',
    borderRadius: 2,
  },
  badgeProgressText: {
    fontSize: 9,
    color: '#64748b',
    marginTop: 2,
    textAlign: 'center',
  },
  // Achievements Card with Level
  achievementsCard: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
  },
  levelSection: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  levelBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#6366f1',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
    borderWidth: 3,
    borderColor: '#818cf8',
  },
  levelNumber: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  levelInfo: {
    flex: 1,
  },
  levelName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 2,
  },
  levelXP: {
    fontSize: 14,
    color: '#fbbf24',
    fontWeight: '600',
    marginBottom: 8,
  },
  levelProgressContainer: {
    width: '100%',
  },
  levelProgressBar: {
    height: 8,
    backgroundColor: '#334155',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 4,
  },
  levelProgressFill: {
    height: '100%',
    backgroundColor: '#6366f1',
    borderRadius: 4,
  },
  levelProgressText: {
    fontSize: 11,
    color: '#9ca3af',
  },
  achievementsDivider: {
    height: 1,
    backgroundColor: '#334155',
    marginVertical: 16,
  },
  badgesSection: {},
  badgesSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  chartContainer: {
    backgroundColor: '#1e293b',
    padding: 20,
    borderRadius: 16,
    marginBottom: 24,
  },
  chartSubtitle: {
    fontSize: 14,
    color: '#9ca3af',
    marginBottom: 16,
  },
  chartWrapper: {
    alignItems: 'center',
  },
  analysisTabs: {
    flexDirection: 'row',
    backgroundColor: '#0f172a',
    borderRadius: 8,
    padding: 4,
    marginBottom: 16,
  },
  analysisTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    gap: 6,
    borderRadius: 6,
  },
  analysisTabActive: {
    backgroundColor: '#1e293b',
  },
  analysisTabText: {
    fontSize: 12,
    color: '#9ca3af',
    fontWeight: '500',
  },
  analysisTabTextActive: {
    color: '#6366f1',
  },
  topicsList: {
    gap: 12,
  },
  topicItem: {
    backgroundColor: '#0f172a',
    borderRadius: 8,
    padding: 12,
  },
  topicHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  topicRank: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6366f1',
    marginRight: 8,
    width: 24,
  },
  topicName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: '#ffffff',
  },
  topicAccuracy: {
    fontSize: 14,
    fontWeight: '600',
  },
  topicProgressBar: {
    height: 6,
    backgroundColor: '#334155',
    borderRadius: 3,
    marginBottom: 8,
    overflow: 'hidden',
  },
  topicProgressFill: {
    height: '100%',
    borderRadius: 3,
  },
  topicStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  topicStatText: {
    fontSize: 11,
    color: '#9ca3af',
  },
  speedAnalysis: {
    gap: 16,
  },
  speedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 16,
  },
  speedCardIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#f59e0b20',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  speedCardContent: {
    flex: 1,
  },
  speedCardValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  speedCardLabel: {
    fontSize: 14,
    color: '#9ca3af',
  },
  speedTopics: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 16,
  },
  speedTopicsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 12,
  },
  speedTopicItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  speedTopicName: {
    fontSize: 14,
    color: '#e2e8f0',
  },
  speedTopicTime: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6366f1',
  },
  troublesomeList: {
    gap: 12,
  },
  troublesomeItem: {
    backgroundColor: '#0f172a',
    borderRadius: 8,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#ef4444',
  },
  troublesomeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  troublesomeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  troublesomeCount: {
    fontSize: 12,
    color: '#ef4444',
    fontWeight: '500',
  },
  troublesomeGroup: {
    fontSize: 11,
    color: '#9ca3af',
  },
  troublesomeQuestion: {
    fontSize: 13,
    color: '#e2e8f0',
    lineHeight: 18,
  },
  emptyState: {
    alignItems: 'center',
    padding: 24,
  },
  emptyStateText: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 12,
    textAlign: 'center',
  },
  groupsScrollContent: {
    paddingBottom: 4,
    marginBottom: 20,
    gap: 12,
  },
  groupPerformanceCard: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    width: SCREEN_WIDTH - 80,
  },
  groupPerformanceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  groupPerformanceName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
    flex: 1,
    marginRight: 12,
  },
  groupPerformanceScore: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#10b981',
  },
  groupPerformanceChart: {
    marginBottom: 12,
  },
  groupPerformanceStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  groupStatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  groupStatValue: {
    fontSize: 11,
    color: '#9ca3af',
  },
  pieChartWrapper: {
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
    fontSize: 11,
    color: '#9ca3af',
  },
  pieLegend: {
    gap: 10,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 12,
    color: '#e2e8f0',
    maxWidth: 100,
  },
  // New Group Comparison Line Chart Styles
  comparisonDurationSelector: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 16,
  },
  comparisonDurationChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#334155',
  },
  comparisonDurationChipActive: {
    backgroundColor: '#6366f1',
  },
  comparisonDurationChipText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#9ca3af',
  },
  comparisonDurationChipTextActive: {
    color: '#ffffff',
  },
  groupSelectorLabel: {
    fontSize: 12,
    color: '#9ca3af',
    marginBottom: 8,
  },
  groupSelectorScroll: {
    marginBottom: 16,
  },
  groupSelectorContent: {
    gap: 8,
    paddingRight: 16,
  },
  groupSelectorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#475569',
    backgroundColor: '#0f172a',
    gap: 6,
  },
  groupSelectorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  groupSelectorChipText: {
    fontSize: 12,
    color: '#94a3b8',
    maxWidth: 120,
  },
  lineChartWrapper: {
    alignItems: 'center',
    marginTop: 8,
  },
  lineChartLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
    marginTop: 16,
  },
  lineChartLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  lineChartLegendLine: {
    width: 16,
    height: 3,
    borderRadius: 2,
  },
  lineChartLegendText: {
    fontSize: 11,
    color: '#e2e8f0',
  },
  recentTestsContainer: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 24,
  },
  recentTestItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  recentTestLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  recentTestScoreBadge: {
    width: 48,
    height: 48,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  recentTestScoreText: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  recentTestInfo: {
    flex: 1,
  },
  recentTestGroup: {
    fontSize: 14,
    fontWeight: '500',
    color: '#ffffff',
    marginBottom: 4,
  },
  recentTestDetails: {
    fontSize: 12,
    color: '#9ca3af',
  },
  recentTestRight: {
    alignItems: 'flex-end',
  },
  recentTestDate: {
    fontSize: 11,
    color: '#64748b',
  },
  viewAnalysisHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#6366f120',
    borderRadius: 8,
  },
  viewAnalysisText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#6366f1',
  },
  actionsContainer: {
    gap: 12,
    marginBottom: 24,
  },
  // AI Study Coach styles
  aiCoachCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
  },
  aiCoachHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  aiCoachTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  aiCoachTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  aiCoachBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
  },
  aiCoachBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  aiCoachLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    justifyContent: 'center',
  },
  aiCoachLoadingText: {
    fontSize: 14,
  },
  aiCoachErrorText: {
    fontSize: 13,
    textAlign: 'center',
  },
  aiCoachResult: {
    gap: 10,
  },
  aiCoachTip: {
    fontSize: 15,
    lineHeight: 22,
  },
  aiCoachSection: {
    gap: 6,
  },
  aiCoachSectionLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  aiCoachTopics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  aiCoachTopicBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  aiCoachTopicText: {
    fontSize: 12,
    fontWeight: '600',
  },
  aiCoachEstimate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  aiCoachEstimateText: {
    fontSize: 12,
  },
  aiCoachRefresh: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 4,
  },
  aiCoachRefreshText: {
    fontSize: 13,
    fontWeight: '500',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    padding: 16,
    borderRadius: 16,
  },
  actionIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  actionContent: {
    flex: 1,
  },
  actionText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#ffffff',
  },
  actionSubtext: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  badgeModalContent: {
    backgroundColor: '#1e293b',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    width: '100%',
    maxWidth: 300,
  },
  badgeModalIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  badgeModalName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 8,
    textAlign: 'center',
  },
  badgeModalDescription: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    marginBottom: 16,
  },
  badgeModalLevel: {
    fontSize: 14,
    color: '#6366f1',
    fontWeight: '500',
    marginBottom: 12,
  },
  badgeModalProgressContainer: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  badgeModalProgressBar: {
    flex: 1,
    height: 8,
    backgroundColor: '#334155',
    borderRadius: 4,
    overflow: 'hidden',
  },
  badgeModalProgressFill: {
    height: '100%',
    backgroundColor: '#6366f1',
    borderRadius: 4,
  },
  badgeModalProgressText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6366f1',
    width: 40,
  },
  badgeModalUnlocked: {
    fontSize: 12,
    color: '#10b981',
    marginTop: 4,
  },
});
