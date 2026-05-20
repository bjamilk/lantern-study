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
import { useTheme } from '../../theme';
import TestConfigModal, { type TestConfigOptions } from '../../components/TestConfigModal';

type TabType = 'tests' | 'history';

export default function TestScreen() {
  const navigation = useNavigation<any>();
  const [activeTab, setActiveTab] = useState<TabType>('tests');
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTest, setSelectedTest] = useState<Test | null>(null);
  const [selectedMode, setSelectedMode] = useState<TestMode>('test');
  const [showConfigModal, setShowConfigModal] = useState(false);
  
  const { user } = useAuthStore();
  const { colors } = useTheme();
  const { tests, attempts, isLoading, fetchTests, fetchAttempts, startTest } = useTestStore();

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
    if (!selectedTest) return;
    setShowConfigModal(false);
    // TODO: Apply config to test start (question count, timer, types filter)
    // For now, just start with the mode
    handleStartTest(selectedTest, mode);
  }, [selectedTest, handleStartTest]);

  const handleViewAttempt = useCallback((attempt: TestAttempt) => {
    navigation.navigate('TestResults', { attemptId: attempt.id });
  }, [navigation]);

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
    <TouchableOpacity
      style={[styles.attemptCard, { backgroundColor: colors.card }]}
      onPress={() => handleViewAttempt(item)}
      activeOpacity={0.7}
    >
      <View style={[
        styles.attemptIcon,
        { backgroundColor: item.passed ? '#10b98120' : '#ef444420' }
      ]}>
        <Ionicons 
          name={item.passed ? 'checkmark-circle' : 'close-circle'} 
          size={24} 
          color={item.passed ? '#10b981' : '#ef4444'} 
        />
      </View>
      
      <View style={styles.attemptInfo}>
        <Text style={[styles.attemptName, { color: colors.text }]} numberOfLines={1}>{item.testName}</Text>
        <Text style={[styles.attemptDate, { color: colors.textSecondary }]}>{formatDate(item.completedAt || item.startedAt)}</Text>
        
        <View style={styles.attemptStats}>
          <View style={[
            styles.scoreBadge,
            { backgroundColor: item.passed ? '#10b98120' : '#ef444420' }
          ]}>
            <Text style={[
              styles.scoreText,
              { color: item.passed ? '#10b981' : '#ef4444' }
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
  ), [handleViewAttempt, colors]);

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
          ? 'Create a test from your flashcard decks to get started'
          : 'Complete a test to see your results here'
        }
      </Text>
    </View>
  ), [activeTab, colors]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Tests</Text>
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
              tintColor="#6366f1"
              colors={['#6366f1']}
            />
          }
        />
      ) : (
        <FlatList
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
              tintColor="#6366f1"
              colors={['#6366f1']}
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
                          color={selectedMode === 'test' ? '#ffffff' : colors.primary} 
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
                        selectedMode === 'study' && { borderColor: '#10b981', backgroundColor: '#10b98110' }
                      ]}
                      onPress={() => setSelectedMode('study')}
                      activeOpacity={0.7}
                    >
                      <View style={[
                        styles.modeIconContainer,
                        { backgroundColor: colors.card },
                        selectedMode === 'study' && { backgroundColor: '#10b981' }
                      ]}>
                        <Ionicons 
                          name="book" 
                          size={28} 
                          color={selectedMode === 'study' ? '#ffffff' : '#10b981'} 
                        />
                      </View>
                      <Text style={[
                        styles.modeTitle,
                        { color: colors.text },
                        selectedMode === 'study' && { color: '#10b981' }
                      ]}>Study Mode</Text>
                      <Text style={[styles.modeDescription, { color: colors.textSecondary }]}>
                        Untimed • Feedback{'\n'}Learn as you go
                      </Text>
                      {selectedMode === 'study' && (
                        <View style={styles.modeCheck}>
                          <Ionicons name="checkmark-circle" size={20} color="#10b981" />
                        </View>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.modalStats}>
                  <View style={styles.modalStatItem}>
                    <Ionicons name="help-circle" size={24} color={colors.primary} />
                    <Text style={[styles.modalStatValue, { color: colors.text }]}>{selectedTest.questionCount}</Text>
                    <Text style={[styles.modalStatLabel, { color: colors.textSecondary }]}>Questions</Text>
                  </View>
                  <View style={styles.modalStatItem}>
                    <Ionicons 
                      name={selectedMode === 'test' ? 'time' : 'infinite'} 
                      size={24} 
                      color="#f97316" 
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
                      color="#10b981" 
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
                      selectedMode === 'study' && styles.startButtonStudy
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
                      color="#ffffff" 
                    />
                    <Text style={styles.startButtonText}>
                      {selectedMode === 'test' ? 'Start Test' : 'Start Study'}
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Advanced Configuration Link */}
                <TouchableOpacity 
                  style={styles.advancedLink}
                  onPress={() => {
                    setSelectedTest(null);
                    setShowConfigModal(true);
                  }}
                >
                  <Ionicons name="settings-outline" size={16} color="#6366f1" />
                  <Text style={styles.advancedLinkText}>Advanced Configuration</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Advanced Test Configuration Modal */}
      {selectedTest && (
        <TestConfigModal
          visible={showConfigModal}
          onClose={() => {
            setShowConfigModal(false);
            setSelectedTest(null);
          }}
          onSubmit={handleConfigSubmit}
          mode={selectedMode}
          maxQuestions={selectedTest?.questionCount || 10}
          availableTags={['Biology', 'Chemistry', 'Physics']} // TODO: Get from actual test/deck
          testName={selectedTest?.name || ''}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
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
    backgroundColor: '#1e293b',
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
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
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
    backgroundColor: '#0f172a',
    borderRadius: 16,
  },
  modalStatItem: {
    alignItems: 'center',
  },
  modalStatValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
    marginTop: 8,
  },
  modalStatLabel: {
    fontSize: 12,
    color: '#6b7280',
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
    backgroundColor: '#6366f1',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  startButtonStudy: {
    backgroundColor: '#10b981',
  },
  startButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
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
    color: '#6366f1',
    fontWeight: '500',
  },
});
