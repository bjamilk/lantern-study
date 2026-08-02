// ===========================================
// Lantern Study Mobile - Test Screen
// ===========================================

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Modal,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTestStore, type Test, type TestAttempt, type TestMode } from '../../stores/testStore';
import { useAuthStore } from '../../stores/authStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTheme } from '../../theme';
import TestConfigModal, { type TestConfigOptions } from '../../components/TestConfigModal';
import { normalizeApiQuestions } from '../../utils/questionHelpers';
import { trackTestStarted } from '../../services/productAnalytics';

type TabType = 'tests' | 'history';

export default function TestScreen() {
  const navigation = useNavigation<any>();
  const [activeTab, setActiveTab] = useState<TabType>('tests');
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTest, setSelectedTest] = useState<Test | null>(null);
  const [configTest, setConfigTest] = useState<Test | null>(null);
  const [selectedMode, setSelectedMode] = useState<TestMode>('test');
  const [showConfigModal, setShowConfigModal] = useState(false);
  
  const { user } = useAuthStore();
  const defaultTestMode = useSettingsStore(s => s.settings.study.defaultTestMode);
  const { colors } = useTheme();
  const { tests, attempts, isLoading, fetchTests, fetchAttempts, startTest, startQuestionSet, testQuestionsById, deleteAttempt, clearTestHistory } = useTestStore();

  useEffect(() => {
    setSelectedMode(defaultTestMode === 'exam' ? 'test' : 'study');
  }, [defaultTestMode]);

  useEffect(() => {
    if (user?.id) {
      fetchTests(user.id);
      fetchAttempts(user.id);
    }
  }, [user?.id, fetchTests, fetchAttempts]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (user?.id) {
      await Promise.all([fetchTests(user.id), fetchAttempts(user.id)]);
    }
    setRefreshing(false);
  }, [user?.id, fetchTests, fetchAttempts]);

  const handleStartTest = useCallback(async (test: Test, mode: TestMode) => {
    try {
      await startTest(test.id, mode);
      trackTestStarted({
        mode: mode === 'test' ? 'test' : 'study',
        questionCount: useTestStore.getState().activeTest?.questions.length ?? 0,
      });
      navigation.navigate('TestTaking', { 
        testId: test.id, 
        testName: test.name,
        mode: mode 
      });
    } catch (error) {
      Alert.alert('Error', 'Failed to start test');
    }
  }, [startTest, navigation]);

  // Handle advanced configuration submission
  const handleConfigSubmit = useCallback((config: TestConfigOptions, mode: TestMode) => {
    if (!configTest || !user?.id) return;
    const test = configTest;
    setShowConfigModal(false);
    setConfigTest(null);
    void startTest(test.id, mode, {
      timeLimit: config.timerDuration > 0 ? Math.ceil(config.timerDuration / 60) : test.timeLimit,
      questionCount: config.numberOfQuestions,
      userId: user.id,
      questionTypes: config.selectedQuestionTypes.length ? config.selectedQuestionTypes : undefined,
      tags: config.selectedTags.length ? config.selectedTags : undefined,
      spacedRepetition: config.useSpacedRepetition,
      focusOnNew: config.focusOnNew,
    }).then(() => {
      trackTestStarted({
        mode: mode === 'test' ? 'test' : 'study',
        questionCount: useTestStore.getState().activeTest?.questions.length ?? 0,
      });
      navigation.navigate('TestTaking', {
        testId: test.id,
        testName: test.name,
        mode,
      });
    }).catch(() => {
      Alert.alert('Error', 'Failed to start test');
    });
  }, [configTest, user?.id, startTest, navigation]);

  const configTags = useMemo(() => {
    if (!configTest) return [] as string[];
    const tags = new Set<string>();
    (testQuestionsById[configTest.id] || []).forEach(q => q.tags?.forEach(t => tags.add(t)));
    return Array.from(tags);
  }, [configTest, testQuestionsById]);

  const handleRetake = useCallback(async (attempt: TestAttempt) => {
    const questions = normalizeApiQuestions(
      attempt.answers
        .map(a => a.questionSnapshot)
        .filter((q): q is NonNullable<typeof q> => !!q)
    );

    const timeLimitMinutes = attempt.timeLimitMinutes ?? 0;
    const sessionName = attempt.testName || 'Retake';

    if (questions.length > 0) {
      await startQuestionSet(sessionName, questions, 'test', { timeLimitMinutes });
      navigation.navigate('TestTaking', {
        testId: 'custom',
        testName: sessionName,
        mode: 'test',
        groupName: attempt.groupName,
        groupId: attempt.groupId,
      });
      return;
    }

    const lookupId = attempt.originalTestId || attempt.testId;
    const existingTest = tests.find(t => t.id === lookupId);
    if (existingTest) {
      try {
        await startTest(existingTest.id, 'test', {
          timeLimit: timeLimitMinutes || existingTest.timeLimit,
          userId: user?.id,
        });
        navigation.navigate('TestTaking', {
          testId: existingTest.id,
          testName: existingTest.name,
          mode: 'test',
          groupName: attempt.groupName,
          groupId: attempt.groupId,
        });
      } catch {
        Alert.alert('Error', 'Failed to start test');
      }
      return;
    }

    Alert.alert('Cannot retake', 'Question data is no longer available for this test.');
  }, [tests, startQuestionSet, startTest, navigation, user?.id]);

  const handleViewAttempt = useCallback((attempt: TestAttempt) => {
    navigation.navigate('TestResults', { attemptId: attempt.id });
  }, [navigation]);

  const handleDeleteAttempt = useCallback((attempt: TestAttempt) => {
    if (!user?.id) return;
    Alert.alert(
      'Delete test result?',
      `Remove "${attempt.testName}" from your history? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void deleteAttempt(user.id, attempt.id).catch(() => {
              Alert.alert('Error', 'Failed to delete test result.');
            });
          },
        },
      ]
    );
  }, [user?.id, deleteAttempt]);

  const handleClearHistory = useCallback(() => {
    if (!user?.id || attempts.length === 0) return;
    Alert.alert(
      'Clear test history?',
      'Delete all completed test history? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: () => {
            void clearTestHistory(user.id)
              .then(() => fetchAttempts(user.id))
              .catch(() => {
                Alert.alert('Error', 'Failed to clear test history.');
              });
          },
        },
      ]
    );
  }, [user?.id, attempts.length, clearTestHistory, fetchAttempts]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const renderTestItem = useCallback(({ item }: { item: Test }) => (
    <TouchableOpacity
      style={[styles.testCard, { backgroundColor: colors.card }]}
      onPress={() => setSelectedTest(item)}
      activeOpacity={0.7}
    >
      <View style={[styles.testIcon, { backgroundColor: colors.primaryLight }]}>
        <Ionicons name="document-text" size={24} color={colors.primary} />
      </View>
      
      <View style={styles.testInfo}>
        <Text style={[styles.testName, { color: colors.text }]} numberOfLines={1}>{item.name}</Text>
        <Text style={[styles.testDescription, { color: colors.textSecondary }]} numberOfLines={1}>
          {item.description || `From ${item.deckName}`}
        </Text>
        
        <View style={styles.testMeta}>
          <View style={styles.metaItem}>
            <Ionicons name="help-circle-outline" size={14} color={colors.textSecondary} />
            <Text style={[styles.metaText, { color: colors.textSecondary }]}>{item.questionCount} questions</Text>
          </View>
          <View style={styles.metaItem}>
            <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
            <Text style={[styles.metaText, { color: colors.textSecondary }]}>
              {item.timeLimit > 0 ? `${item.timeLimit} min` : 'No limit'}
            </Text>
          </View>
          <View style={styles.metaItem}>
            <Ionicons name="checkmark-circle-outline" size={14} color={colors.textSecondary} />
            <Text style={[styles.metaText, { color: colors.textSecondary }]}>{item.passingScore}% to pass</Text>
          </View>
        </View>
      </View>
      
      <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
    </TouchableOpacity>
  ), [colors]);

  const renderAttemptItem = useCallback(({ item }: { item: TestAttempt }) => (
    <View style={[styles.attemptCard, { backgroundColor: colors.card }]}>
      <TouchableOpacity
        style={styles.attemptMain}
        onPress={() => handleViewAttempt(item)}
        activeOpacity={0.7}
      >
        <View style={[
          styles.attemptIcon,
          {
            backgroundColor: item.passed ? colors.successBackground : colors.errorBackground,
          }
        ]}>
          <Ionicons 
            name={item.passed ? 'checkmark-circle' : 'close-circle'} 
            size={24} 
            color={item.passed ? colors.success : colors.error} 
          />
        </View>
        
        <View style={styles.attemptInfo}>
          <Text style={[styles.attemptName, { color: colors.text }]} numberOfLines={1}>{item.testName}</Text>
          {item.groupName ? (
            <Text style={[styles.attemptSource, { color: colors.textSecondary }]} numberOfLines={1}>
              From {item.groupName}
            </Text>
          ) : null}
          <Text style={[styles.attemptDate, { color: colors.textSecondary }]}>{formatDate(item.completedAt || item.startedAt)}</Text>
          
          <View style={styles.attemptStats}>
            <View style={[
              styles.scoreBadge,
              {
                backgroundColor: item.passed ? colors.successBackground : colors.errorBackground,
              }
            ]}>
              <Text style={[
                styles.scoreText,
                { color: item.passed ? colors.success : colors.error }
              ]}>
                {item.percentage}%
              </Text>
            </View>
            <Text style={[styles.attemptMeta, { color: colors.textSecondary }]}>
              {item.score}/{item.totalPoints} pts • {formatTime(item.timeSpent)}
            </Text>
          </View>
        </View>
        
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </TouchableOpacity>

      <View style={styles.attemptActions}>
        <TouchableOpacity
          style={[styles.retakeButton, { borderColor: colors.border, flex: 1 }]}
          onPress={() => void handleRetake(item)}
          activeOpacity={0.7}
        >
          <Ionicons name="refresh" size={16} color={colors.primary} />
          <Text style={[styles.retakeButtonText, { color: colors.primary }]}>Retake</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.deleteHistoryButton, { borderColor: colors.border }]}
          onPress={() => handleDeleteAttempt(item)}
          activeOpacity={0.7}
        >
          <Ionicons name="trash-outline" size={16} color={colors.error} />
          <Text style={[styles.deleteHistoryButtonText, { color: colors.error }]}>Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  ), [handleViewAttempt, handleRetake, handleDeleteAttempt, colors]);

  const ListEmptyComponent = useMemo(() => (
    <View style={styles.emptyContainer}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.primaryLight }]}>
        <Ionicons 
          name={activeTab === 'tests' ? 'document-text-outline' : 'time-outline'} 
          size={64} 
          color={colors.primary} 
        />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.text }]}>
        {activeTab === 'tests' ? 'No Tests Available' : 'No Test History'}
      </Text>
      <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
        {activeTab === 'tests' 
          ? 'Saved deck quizzes you can launch appear here. Group chat tests show up in History after you finish them.'
          : 'Your completed tests and scores appear here. Tap a result to review answers or retake.'
        }
      </Text>
    </View>
  ), [activeTab, colors]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Tests</Text>
          {activeTab === 'history' && attempts.length > 0 ? (
            <TouchableOpacity onPress={handleClearHistory} style={styles.clearHistoryButton}>
              <Text style={[styles.clearHistoryText, { color: colors.error }]}>Clear History</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
          Review scores in History · Launch saved quizzes under Available Tests
        </Text>
      </View>

      {/* Tabs */}
      <View style={[styles.tabContainer, { backgroundColor: colors.card }]}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'tests' && [styles.activeTab, { backgroundColor: colors.primary + '20' }]]}
          onPress={() => setActiveTab('tests')}
        >
          <Text style={[styles.tabText, { color: colors.textSecondary }, activeTab === 'tests' && { color: colors.primary }]}>
            Available Tests
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'history' && [styles.activeTab, { backgroundColor: colors.primary + '20' }]]}
          onPress={() => setActiveTab('history')}
        >
          <Text style={[styles.tabText, { color: colors.textSecondary }, activeTab === 'history' && { color: colors.primary }]}>
            History
          </Text>
        </TouchableOpacity>
      </View>

      {/* List */}
      {activeTab === 'tests' ? (
        <FlatList
          key="tests-list"
          data={tests}
          keyExtractor={(item) => item.id}
          renderItem={renderTestItem}
          ListEmptyComponent={ListEmptyComponent}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        />
      ) : (
        <FlatList
          key="history-list"
          data={attempts}
          keyExtractor={(item) => item.id}
          renderItem={renderAttemptItem}
          ListEmptyComponent={ListEmptyComponent}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        />
      )}

      {/* Test Detail Modal */}
      <Modal
        visible={!!selectedTest}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setSelectedTest(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            {selectedTest && (
              <>
                <View style={styles.modalHeader}>
                  <View style={[styles.modalIcon, { backgroundColor: colors.primaryLight }]}>
                    <Ionicons name="document-text" size={32} color={colors.primary} />
                  </View>
                  <Text style={[styles.modalTitle, { color: colors.text }]}>{selectedTest.name}</Text>
                  <Text style={[styles.modalDescription, { color: colors.textSecondary }]}>
                    {selectedTest.description || `Quiz from ${selectedTest.deckName}`}
                  </Text>
                </View>

                {/* Mode Selection */}
                <View style={styles.modeSection}>
                  <Text style={[styles.modeSectionTitle, { color: colors.textSecondary }]}>Choose Mode</Text>
                  <View style={styles.modeOptions}>
                    <TouchableOpacity
                      style={[
                        styles.modeOption,
                        { backgroundColor: colors.background, borderColor: colors.border },
                        selectedMode === 'test' && { borderColor: colors.primary, backgroundColor: colors.primaryLight }
                      ]}
                      onPress={() => setSelectedMode('test')}
                      activeOpacity={0.7}
                    >
                      <View style={[
                        styles.modeIconContainer,
                        { backgroundColor: colors.card },
                        selectedMode === 'test' && { backgroundColor: colors.primary }
                      ]}>
                        <Ionicons 
                          name="timer" 
                          size={28} 
                          color={selectedMode === 'test' ? colors.textInverse : colors.primary} 
                        />
                      </View>
                      <Text style={[
                        styles.modeTitle,
                        { color: colors.text },
                        selectedMode === 'test' && { color: colors.primary }
                      ]}>Test Mode</Text>
                      <Text style={[styles.modeDescription, { color: colors.textSecondary }]}>
                        Timed • Scored{'\n'}No hints
                      </Text>
                      {selectedMode === 'test' && (
                        <View style={styles.modeCheck}>
                          <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                        </View>
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.modeOption,
                        { backgroundColor: colors.background, borderColor: colors.border },
                        selectedMode === 'study' && {
                          borderColor: colors.success,
                          backgroundColor: colors.successBackground,
                        }
                      ]}
                      onPress={() => setSelectedMode('study')}
                      activeOpacity={0.7}
                    >
                      <View style={[
                        styles.modeIconContainer,
                        { backgroundColor: colors.card },
                        selectedMode === 'study' && { backgroundColor: colors.success }
                      ]}>
                        <Ionicons 
                          name="book" 
                          size={28} 
                          color={selectedMode === 'study' ? colors.textInverse : colors.success} 
                        />
                      </View>
                      <Text style={[
                        styles.modeTitle,
                        { color: colors.text },
                        selectedMode === 'study' && { color: colors.success }
                      ]}>Study Mode</Text>
                      <Text style={[styles.modeDescription, { color: colors.textSecondary }]}>
                        Untimed • Feedback{'\n'}Learn as you go
                      </Text>
                      {selectedMode === 'study' && (
                        <View style={styles.modeCheck}>
                          <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                        </View>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={[styles.modalStats, { backgroundColor: colors.backgroundSecondary }]}>
                  <View style={styles.modalStatItem}>
                    <Ionicons name="help-circle" size={24} color={colors.primary} />
                    <Text style={[styles.modalStatValue, { color: colors.text }]}>{selectedTest.questionCount}</Text>
                    <Text style={[styles.modalStatLabel, { color: colors.textSecondary }]}>Questions</Text>
                  </View>
                  <View style={styles.modalStatItem}>
                    <Ionicons 
                      name={selectedMode === 'test' ? 'time' : 'infinite'} 
                      size={24} 
                      color={colors.warning} 
                    />
                    <Text style={[styles.modalStatValue, { color: colors.text }]}>
                      {selectedMode === 'test' 
                        ? (selectedTest.timeLimit > 0 ? selectedTest.timeLimit : '∞')
                        : '∞'
                      }
                    </Text>
                    <Text style={[styles.modalStatLabel, { color: colors.textSecondary }]}>
                      {selectedMode === 'test' ? 'Minutes' : 'No Limit'}
                    </Text>
                  </View>
                  <View style={styles.modalStatItem}>
                    <Ionicons 
                      name={selectedMode === 'test' ? 'trophy' : 'bulb'} 
                      size={24} 
                      color={colors.success} 
                    />
                    <Text style={[styles.modalStatValue, { color: colors.text }]}>
                      {selectedMode === 'test' ? `${selectedTest.passingScore}%` : 'Learn'}
                    </Text>
                    <Text style={[styles.modalStatLabel, { color: colors.textSecondary }]}>
                      {selectedMode === 'test' ? 'To Pass' : 'Focus'}
                    </Text>
                  </View>
                </View>

                <View style={styles.modalButtons}>
                  <TouchableOpacity
                    style={[styles.cancelButton, { backgroundColor: colors.background, borderColor: colors.border }]}
                    onPress={() => {
                      setSelectedTest(null);
                      setSelectedMode('test'); // Reset to default
                    }}
                  >
                    <Text style={[styles.cancelButtonText, { color: colors.text }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.startButton,
                      {
                        backgroundColor:
                          selectedMode === 'study' ? colors.success : colors.primary,
                      },
                    ]}
                    onPress={() => {
                      const test = selectedTest;
                      const mode = selectedMode;
                      setSelectedTest(null);
                      setSelectedMode('test'); // Reset to default
                      handleStartTest(test, mode);
                    }}
                  >
                    <Ionicons 
                      name={selectedMode === 'test' ? 'play' : 'book'} 
                      size={20} 
                      color={colors.textInverse} 
                    />
                    <Text style={[styles.startButtonText, { color: colors.textInverse }]}>
                      {selectedMode === 'test' ? 'Start Test' : 'Start Study'}
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Advanced Configuration Link */}
                <TouchableOpacity 
                  style={styles.advancedLink}
                  onPress={() => {
                    if (!selectedTest) return;
                    setConfigTest(selectedTest);
                    setShowConfigModal(true);
                    setSelectedTest(null);
                  }}
                >
                  <Ionicons name="settings-outline" size={16} color={colors.primary} />
                  <Text style={[styles.advancedLinkText, { color: colors.primary }]}>
                    Advanced Configuration
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Advanced Test Configuration Modal */}
      {configTest && (
        <TestConfigModal
          visible={showConfigModal}
          onClose={() => {
            setShowConfigModal(false);
            setConfigTest(null);
          }}
          onSubmit={handleConfigSubmit}
          mode={selectedMode}
          maxQuestions={configTest.questionCount || 10}
          availableTags={configTags}
          testName={configTest.name || ''}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  clearHistoryButton: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  clearHistoryText: {
    fontSize: 14,
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  headerSubtitle: {
    fontSize: 14,
    marginTop: 4,
    lineHeight: 20,
  },
  tabContainer: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 16,
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 10,
  },
  activeTab: {
    backgroundColor: '#6366f1',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9ca3af',
  },
  activeTabText: {
    color: '#ffffff',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 100,
  },
  testCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  testIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#6366f120',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  testInfo: {
    flex: 1,
  },
  testName: {
    fontSize: 17,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 4,
  },
  testDescription: {
    fontSize: 14,
    color: '#9ca3af',
    marginBottom: 8,
  },
  testMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 12,
    color: '#6b7280',
  },
  attemptCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  attemptMain: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  attemptIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  attemptInfo: {
    flex: 1,
  },
  attemptName: {
    fontSize: 17,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 2,
  },
  attemptSource: {
    fontSize: 13,
    marginBottom: 2,
  },
  attemptDate: {
    fontSize: 13,
    color: '#6b7280',
    marginBottom: 8,
  },
  attemptStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  scoreBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  scoreText: {
    fontSize: 14,
    fontWeight: '700',
  },
  attemptMeta: {
    fontSize: 13,
    color: '#9ca3af',
  },
  attemptActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  retakeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  retakeButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  deleteHistoryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  deleteHistoryButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 40,
  },
  emptyIcon: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#6366f120',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1e293b',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  modalHeader: {
    alignItems: 'center',
    marginBottom: 24,
  },
  modalIcon: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: '#6366f120',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 8,
    textAlign: 'center',
  },
  modalDescription: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
  },
  modalStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 24,
    paddingVertical: 16,
    borderRadius: 16,
  },
  modalStatItem: {
    alignItems: 'center',
  },
  modalStatValue: {
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 8,
  },
  modalStatLabel: {
    fontSize: 12,
    marginTop: 4,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#334155',
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  startButton: {
    flex: 1,
    flexDirection: 'row',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  startButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  // Mode selection styles
  modeSection: {
    marginBottom: 20,
  },
  modeSectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 12,
  },
  modeOptions: {
    flexDirection: 'row',
    gap: 12,
  },
  modeOption: {
    flex: 1,
    backgroundColor: '#0f172a',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
    position: 'relative',
  },
  modeOptionActive: {
    borderColor: '#6366f1',
    backgroundColor: '#1e293b',
  },
  modeIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#1e293b',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  modeIconContainerActive: {
    backgroundColor: '#6366f1',
  },
  modeTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#9ca3af',
    marginBottom: 6,
  },
  modeTitleActive: {
    color: '#ffffff',
  },
  modeDescription: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 18,
  },
  modeCheck: {
    position: 'absolute',
    top: 8,
    right: 8,
  },
  advancedLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 16,
    paddingVertical: 8,
  },
  advancedLinkText: {
    fontSize: 14,
    fontWeight: '500',
  },
});
