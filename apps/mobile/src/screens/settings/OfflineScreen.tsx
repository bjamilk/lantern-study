// ===========================================
// Lantern Study Mobile - Offline Mode Screen
// ===========================================

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
  Switch,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useOfflineStore, OfflineTest, PendingResult, DownloadOptions } from '../../stores/offlineStore';
import { useTestStore } from '../../stores/testStore';
import { offlineQuestionsToTestQuestions } from '../../utils/questionHelpers';
import { useFlashcardStore } from '../../stores/flashcardStore';
import { useGroupStore } from '../../stores/groupStore';
import { ThemeScope, useTheme } from '../../theme';
import { useAuthStore } from '../../stores/authStore';
import { restoreQuestionBanks } from '../../services/api';
import { PublishQuestionBankModal } from './PublishQuestionBankModal';
import { getConnectionStatus, syncCopy, featureAccents } from '@lantern/shared/design';
import { useNetworkStatus } from '../../hooks';
import { useSettingsStore } from '../../stores/settingsStore';

// Question type options
const QUESTION_TYPES = [
  { id: 'mcq-single', label: 'Single Choice', icon: 'radio-button-on' },
  { id: 'mcq-multiple', label: 'Multiple Choice', icon: 'checkbox' },
  { id: 'true-false', label: 'True/False', icon: 'swap-horizontal' },
  { id: 'fill-blank', label: 'Fill in Blank', icon: 'text' },
] as const;

export default function OfflineScreen() {
  const navigation = useNavigation<any>();
  const userId = useAuthStore(s => s.user?.id) || '';
  const [refreshing, setRefreshing] = useState(false);
  const [restoringBanks, setRestoringBanks] = useState(false);
  const [publishTarget, setPublishTarget] = useState<OfflineTest | null>(null);
  const [selectedTab, setSelectedTab] = useState<'downloads' | 'pending'>('downloads');
  const { colors } = useTheme();
  // Pixel height, not '85%': percentage heights resolved against the themed
  // overlay have already burned us on release builds (footer collapsed to
  // zero). A definite px height cannot be mis-resolved.
  const { height: windowHeight } = useWindowDimensions();
  const modalSheetHeight = Math.round(windowHeight * 0.85);
  const network = useNetworkStatus();
  const lowDataMode = useSettingsStore(s => s.settings.appearance.lowDataMode);

  // Download options modal state
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<any>(null);
  const [downloadOptions, setDownloadOptions] = useState<DownloadOptions>({
    questionTypes: ['mcq-single', 'mcq-multiple', 'true-false', 'fill-blank'],
    questionCount: 20,
    timeLimit: 0,
    shuffleQuestions: true,
    includeExplanations: true,
    recentlyAddedDays: 0, // 0 = all questions
  });

  const {
    downloadedTests,
    pendingResults,
    isDownloading,
    downloadProgress,
    isSyncing,
    totalStorageUsed,
    lastSyncAt,
    loadOfflineData,
    deleteDownloadedTest,
    syncPendingResults,
    clearAllOfflineData,
    downloadTest,
  } = useOfflineStore();

  // Must run after useOfflineStore — earlier access caused a TDZ crash (blank screen).
  const connectionStatus = getConnectionStatus({
    isOnline: network.isConnected,
    lowDataMode,
    pendingSyncCount: pendingResults.filter(r => !r.synced).length,
    isSyncing,
    lastSyncedAt: lastSyncAt,
  });

  const startQuestionSet = useTestStore(s => s.startQuestionSet);

  // flashcard offline data
  const { decks, offlineDeckIds, unmarkDeckOffline } = useFlashcardStore();
  
  const { groups } = useGroupStore();

  useEffect(() => {
    loadOfflineData(userId || undefined);
  }, [userId]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadOfflineData(userId || undefined);
    setRefreshing(false);
  };

  const formatSize = (kb: number) => {
    if (kb < 1024) return `${kb} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString([], { 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handleDeleteTest = (test: OfflineTest) => {
    Alert.alert(
      'Delete Download',
      `Remove "${test.testName}" from offline storage?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteDownloadedTest(test.id);
          },
        },
      ]
    );
  };

  const handleStartOfflineTest = async (test: OfflineTest) => {
    if (!test.questions.length) {
      Alert.alert('No Questions', 'This offline bundle has no questions.');
      return;
    }

    try {
      const questions = offlineQuestionsToTestQuestions(test.questions);
      await startQuestionSet(test.testName, questions, 'test', {
        timeLimitMinutes: test.timeLimit || Math.max(questions.length * 2, 5),
      });
      // Offline is a ROOT-stack modal, so 'StudyTab' is not a sibling route
      // here — it lives inside 'Main'. The unnested navigate was silently
      // dropped in release builds and Start did nothing. Navigating via
      // 'Main' also pops this modal so the test screen is actually visible.
      navigation.navigate('Main', {
        screen: 'StudyTab',
        params: {
          screen: 'TestTaking',
          params: {
            testId: test.testId,
            testName: test.testName,
            mode: 'test',
            isOffline: true,
            offlineTestId: test.id,
            groupName: test.groupName,
          },
        },
      });
    } catch {
      Alert.alert('Error', 'Failed to start offline test.');
    }
  };

  const handleSync = async () => {
    if (pendingResults.length === 0) {
      Alert.alert('Nothing to Sync', 'All your results are already synced.');
      return;
    }
    
    try {
      await syncPendingResults(userId);
      Alert.alert('Success', 'All results have been synced!');
    } catch (error) {
      Alert.alert('Sync Failed', 'Please check your internet connection and try again.');
    }
  };

  const handleClearAll = () => {
    Alert.alert(
      'Clear All Offline Data',
      'This will remove all downloaded tests and pending results. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            await clearAllOfflineData();
          },
        },
      ]
    );
  };

  /** Pull purchased question banks back onto this device (new install / clear). */
  const handleRestoreQuestionBanks = async () => {
    if (!userId) return;
    setRestoringBanks(true);
    try {
      const { restored } = await restoreQuestionBanks();
      await loadOfflineData(userId);
      Alert.alert(
        'Restore complete',
        restored > 0
          ? `Restored ${restored} question bank${restored !== 1 ? 's' : ''}.`
          : 'No purchased question banks to restore.'
      );
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not restore purchases');
    } finally {
      setRestoringBanks(false);
    }
  };

  const DownloadedTestItem = ({ test }: { test: OfflineTest }) => (
    <View style={[styles.testItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.testInfo}>
        <View style={styles.testHeader}>
          <Ionicons name="document-text" size={20} color={colors.primary} />
          <Text style={[styles.testName, { color: colors.text }]} numberOfLines={1}>{test.testName}</Text>
          {/* Marketplace purchases carry the qbank- bundle id (see web parity). */}
          {test.id.startsWith('qbank-') ? (
            <View style={[styles.purchasedBadge, { backgroundColor: colors.primary + '1a' }]}>
              <Text style={[styles.purchasedBadgeText, { color: colors.primary }]}>PURCHASED</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.testMeta, { color: colors.textSecondary }]}>
          {test.groupName} • {test.questionCount} questions
        </Text>
        <View style={styles.testDetails}>
          <View style={styles.detailBadge}>
            <Ionicons name="cloud-download" size={12} color={colors.textTertiary} />
            <Text style={[styles.detailText, { color: colors.textTertiary }]}>{formatDate(test.downloadedAt)}</Text>
          </View>
          <View style={styles.detailBadge}>
            <Ionicons name="server" size={12} color={colors.textTertiary} />
            <Text style={[styles.detailText, { color: colors.textTertiary }]}>{formatSize(test.size)}</Text>
          </View>
        </View>
      </View>
      
      <View style={styles.testActions}>
        {/* Purchased banks are someone else's product — not republishable. */}
        {!test.id.startsWith('qbank-') ? (
          <TouchableOpacity
            style={styles.publishButton}
            onPress={() => setPublishTarget(test)}
            accessibilityLabel="Publish to marketplace"
          >
            <Ionicons name="storefront-outline" size={18} color={colors.primary} />
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={[styles.startButton, { backgroundColor: colors.primary }]}
          onPress={() => handleStartOfflineTest(test)}
        >
          <Ionicons name="play" size={18} color="#ffffff" />
          <Text style={styles.startButtonText}>Start</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={() => handleDeleteTest(test)}
        >
          <Ionicons name="trash" size={18} color="#ef4444" />
        </TouchableOpacity>
      </View>
    </View>
  );

  const PendingResultItem = ({ result }: { result: PendingResult }) => (
    <View style={[styles.resultItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.resultInfo}>
        <Text style={[styles.resultGroup, { color: colors.text }]}>{result.groupName}</Text>
        <View style={styles.resultScoreRow}>
          <Text style={[
            styles.resultScore,
            { color: result.percentage >= 80 ? '#10b981' : result.percentage >= 60 ? '#f59e0b' : '#ef4444' }
          ]}>
            {result.percentage}%
          </Text>
          <Text style={[styles.resultDetails, { color: colors.textSecondary }]}>
            {result.score}/{result.totalQuestions} correct
          </Text>
        </View>
        <Text style={[styles.resultDate, { color: colors.textTertiary }]}>{formatDate(result.completedAt)}</Text>
      </View>
      
      <View style={[
        styles.syncBadge,
        result.synced ? styles.syncedBadge : styles.pendingBadge
      ]}>
        <Ionicons 
          name={result.synced ? 'checkmark-circle' : 'time'} 
          size={14} 
          color={result.synced ? '#10b981' : '#f59e0b'} 
        />
        <Text style={[
          styles.syncText,
          { color: result.synced ? '#10b981' : '#f59e0b' }
        ]}>
          {result.synced ? 'Synced' : 'Pending'}
        </Text>
      </View>
    </View>
  );

  const AvailableDownloadItem = ({ group }: { group: any }) => {
    const isDownloaded = downloadedTests.some(t => t.groupId === group.id);
    
    const handleOpenDownloadModal = () => {
      setSelectedGroup(group);
      // Reset options to defaults when opening modal
      setDownloadOptions({
        questionTypes: ['mcq-single', 'mcq-multiple', 'true-false', 'fill-blank'],
        questionCount: 20,
        timeLimit: 0,
        shuffleQuestions: true,
        includeExplanations: true,
      });
      setShowDownloadModal(true);
    };
    
    return (
      <View style={[styles.availableItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.availableInfo}>
          <Text style={[styles.availableName, { color: colors.text }]}>{group.name}</Text>
          <Text style={[styles.availableMeta, { color: colors.textSecondary }]}>
            {group.memberCount} members
          </Text>
        </View>
        
        {isDownloaded ? (
          <View style={styles.downloadedBadge}>
            <Ionicons name="checkmark-circle" size={16} color="#10b981" />
            <Text style={styles.downloadedText}>Downloaded</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.downloadButton, { backgroundColor: colors.primary }]}
            onPress={handleOpenDownloadModal}
          >
            <Ionicons name="options" size={16} color="#ffffff" />
            <Text style={styles.downloadButtonText}>Customize</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Offline Mode</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {/* Storage Status */}
        <View style={[styles.storageCard, { borderLeftColor: featureAccents.offline, backgroundColor: colors.card }]}>
          <View style={styles.storageHeader}>
            <Ionicons name="folder" size={24} color={featureAccents.offline} />
            <View style={styles.storageInfo}>
              <Text style={[styles.storageTitle, { color: colors.text }]}>Offline Storage</Text>
              <Text style={[styles.storageSize, { color: colors.textSecondary }]}>
                {formatSize(totalStorageUsed)} used · {connectionStatus.shortLabel}
              </Text>
              {lowDataMode ? (
                <Text style={{ fontSize: 11, color: colors.textTertiary, marginTop: 2 }}>
                  {syncCopy.savedLocally}
                </Text>
              ) : null}
            </View>
          </View>
          
          <View style={styles.storageStats}>
            <View style={styles.storageStat}>
              <Text style={[styles.statValue, { color: colors.text }]}>{downloadedTests.length}</Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Downloaded</Text>
            </View>
            <View style={styles.storageStat}>
              <Text style={[styles.statValue, { color: colors.text }]}>{pendingResults.filter(r => !r.synced).length}</Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Pending Sync</Text>
            </View>
          </View>
          
          {pendingResults.filter(r => !r.synced).length > 0 && (
            <TouchableOpacity
              style={styles.syncButton}
              onPress={handleSync}
              disabled={isSyncing}
            >
              {isSyncing ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <>
                  <Ionicons name="cloud-upload" size={18} color="#ffffff" />
                  <Text style={styles.syncButtonText}>Sync Results</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* Tabs */}
        <View style={[styles.tabs, { backgroundColor: colors.cardSecondary }]}>
          <TouchableOpacity
            style={[
              styles.tab,
              selectedTab === 'downloads' && { backgroundColor: colors.background },
            ]}
            onPress={() => setSelectedTab('downloads')}
          >
            <Ionicons 
              name="download" 
              size={18} 
              color={selectedTab === 'downloads' ? colors.primary : colors.textTertiary} 
            />
            <Text style={[
              styles.tabText,
              { color: selectedTab === 'downloads' ? colors.primary : colors.textSecondary },
              selectedTab === 'downloads' && styles.activeTabText
            ]}>
              Downloads ({downloadedTests.length})
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[
              styles.tab,
              selectedTab === 'pending' && { backgroundColor: colors.background },
            ]}
            onPress={() => setSelectedTab('pending')}
          >
            <Ionicons 
              name="time" 
              size={18} 
              color={selectedTab === 'pending' ? colors.primary : colors.textTertiary} 
            />
            <Text style={[
              styles.tabText,
              { color: selectedTab === 'pending' ? colors.primary : colors.textSecondary },
              selectedTab === 'pending' && styles.activeTabText
            ]}>
              Pending ({pendingResults.filter(r => !r.synced).length})
            </Text>
          </TouchableOpacity>
        </View>

        {/* Content based on tab */}
        {selectedTab === 'downloads' ? (
          <View style={styles.section}>
            {/* flashcard decks downloaded offline */}
            {offlineDeckIds.length > 0 && (
              <>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Downloaded Decks</Text>
                {offlineDeckIds.map(id => {
                  const deck = decks.find(d => d.id === id);
                  if (!deck) return null;
                  return (
                    <View key={id} style={[styles.offlineDeckItem, { backgroundColor: colors.card, borderColor: colors.border, borderBottomColor: colors.border }]}>
                      <Text style={[styles.offlineDeckName, { color: colors.text }]} numberOfLines={1}>{deck.name}</Text>
                      <TouchableOpacity
                        onPress={() => unmarkDeckOffline(id)}
                      >
                        <Ionicons name="trash" size={18} color="#ef4444" />
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </>
            )}
            <TouchableOpacity
              style={[styles.restoreButton, { borderColor: colors.border }]}
              disabled={restoringBanks}
              onPress={() => void handleRestoreQuestionBanks()}
            >
              <Ionicons name="bag-handle-outline" size={16} color={colors.primary} />
              <Text style={[styles.restoreButtonText, { color: colors.primary }]}>
                {restoringBanks ? 'Restoring…' : 'Restore marketplace purchases'}
              </Text>
            </TouchableOpacity>
            {downloadedTests.length > 0 ? (
              <>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Downloaded Tests</Text>
                {downloadedTests.map(test => (
                  <DownloadedTestItem key={test.id} test={test} />
                ))}
              </>
            ) : (
              <View style={styles.emptyState}>
                <Ionicons name="cloud-download" size={48} color={colors.textTertiary} />
                <Text style={[styles.emptyTitle, { color: colors.text }]}>No Downloads Yet</Text>
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  Download tests from your study groups to access them offline
                </Text>
              </View>
            )}
            
            {/* Available to Download */}
            {groups.length > 0 && (
              <View style={styles.availableSection}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Available to Download</Text>
                {groups.slice(0, 5).map(group => (
                  <AvailableDownloadItem key={group.id} group={group} />
                ))}
              </View>
            )}
          </View>
        ) : (
          <View style={styles.section}>
            {pendingResults.length > 0 ? (
              <>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Test Results</Text>
                {pendingResults.map(result => (
                  <PendingResultItem key={result.id} result={result} />
                ))}
              </>
            ) : (
              <View style={styles.emptyState}>
                <Ionicons name="checkmark-circle" size={48} color="#10b981" />
                <Text style={[styles.emptyTitle, { color: colors.text }]}>All Synced!</Text>
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  All your offline test results have been synced
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Clear Data */}
        {(downloadedTests.length > 0 || pendingResults.length > 0) && (
          <TouchableOpacity style={styles.clearButton} onPress={handleClearAll}>
            <Ionicons name="trash" size={18} color="#ef4444" />
            <Text style={styles.clearButtonText}>Clear All Offline Data</Text>
          </TouchableOpacity>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Download Options Modal */}
      <Modal
        visible={showDownloadModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowDownloadModal(false)}
      >
        <ThemeScope style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card, height: modalSheetHeight }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                Download Options
              </Text>
              <TouchableOpacity onPress={() => setShowDownloadModal(false)}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.modalBody}
              // Padding must live on the content container, NOT the ScrollView
              // style: vertical padding on the outer style clips the scrollable
              // extent on Android, which is how the old inside-the-scroll footer
              // ended up unreachable on Pixel-8-sized screens.
              contentContainerStyle={styles.modalBodyContent}
              showsVerticalScrollIndicator={false}
            >
              {/* Group Name */}
              <View style={styles.modalSection}>
                <Text style={[styles.modalSectionTitle, { color: colors.text }]}>
                  {selectedGroup?.name || 'Test'}
                </Text>
                <Text style={[styles.modalSectionSubtitle, { color: colors.textSecondary }]}>
                  Configure your offline test download
                </Text>
              </View>

              {/* Question Count */}
              <View style={styles.modalSection}>
                <Text style={[styles.optionLabel, { color: colors.text }]}>
                  Number of Questions
                </Text>
                <View style={styles.countSelector}>
                  {[10, 20, 30, 50, 100].map(count => (
                    <TouchableOpacity
                      key={count}
                      style={[
                        styles.countButton,
                        {
                          backgroundColor:
                            downloadOptions.questionCount === count ? colors.primary : colors.background,
                          borderColor:
                            downloadOptions.questionCount === count ? colors.primary : colors.border,
                        },
                      ]}
                      onPress={() => setDownloadOptions(prev => ({ ...prev, questionCount: count }))}
                    >
                      <Text style={[
                        styles.countButtonText,
                        {
                          color:
                            downloadOptions.questionCount === count ? '#ffffff' : colors.text,
                        },
                      ]}>
                        {count}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Question Types */}
              <View style={styles.modalSection}>
                <Text style={[styles.optionLabel, { color: colors.text }]}>
                  Question Types
                </Text>
                <View style={styles.typesList}>
                  {QUESTION_TYPES.map(type => {
                    const isSelected = downloadOptions.questionTypes?.includes(type.id as any);
                    return (
                      <TouchableOpacity
                        key={type.id}
                        style={[
                          styles.typeItem,
                          { backgroundColor: colors.background },
                          isSelected && styles.typeItemActive,
                        ]}
                        onPress={() => {
                          setDownloadOptions(prev => {
                            const types = prev.questionTypes || [];
                            if (isSelected) {
                              return { ...prev, questionTypes: types.filter(t => t !== type.id) as any };
                            } else {
                              return { ...prev, questionTypes: [...types, type.id] as any };
                            }
                          });
                        }}
                      >
                        <Ionicons
                          name={type.icon as any}
                          size={18}
                          color={isSelected ? '#6366f1' : colors.textSecondary}
                        />
                        <Text style={[
                          styles.typeItemText,
                          { color: isSelected ? '#6366f1' : colors.text },
                        ]}>
                          {type.label}
                        </Text>
                        {isSelected && (
                          <Ionicons name="checkmark" size={16} color="#6366f1" />
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Time Limit */}
              <View style={styles.modalSection}>
                <Text style={[styles.optionLabel, { color: colors.text }]}>
                  Time Limit (minutes)
                </Text>
                <View style={styles.countSelector}>
                  {[0, 15, 30, 45, 60, 90].map(time => (
                    <TouchableOpacity
                      key={time}
                      style={[
                        styles.countButton,
                        {
                          backgroundColor:
                            downloadOptions.timeLimit === time ? colors.primary : colors.background,
                          borderColor:
                            downloadOptions.timeLimit === time ? colors.primary : colors.border,
                        },
                      ]}
                      onPress={() => setDownloadOptions(prev => ({ ...prev, timeLimit: time }))}
                    >
                      <Text style={[
                        styles.countButtonText,
                        {
                          color: downloadOptions.timeLimit === time ? '#ffffff' : colors.text,
                        },
                      ]}>
                        {time === 0 ? 'None' : time}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Recently Added Questions */}
              <View style={styles.modalSection}>
                <Text style={[styles.optionLabel, { color: colors.text }]}>
                  Recently Added Questions
                </Text>
                <View style={styles.countSelector}>
                  {[
                    { value: 0, label: 'All' },
                    { value: 7, label: '7 days' },
                    { value: 14, label: '14 days' },
                    { value: 30, label: '30 days' },
                    { value: 60, label: '60 days' },
                  ].map(option => (
                    <TouchableOpacity
                      key={option.value}
                      style={[
                        styles.countButton,
                        {
                          backgroundColor:
                            downloadOptions.recentlyAddedDays === option.value
                              ? colors.primary
                              : colors.background,
                          borderColor:
                            downloadOptions.recentlyAddedDays === option.value
                              ? colors.primary
                              : colors.border,
                        },
                      ]}
                      onPress={() => setDownloadOptions(prev => ({ ...prev, recentlyAddedDays: option.value }))}
                    >
                      <Text style={[
                        styles.countButtonText,
                        {
                          color:
                            downloadOptions.recentlyAddedDays === option.value
                              ? '#ffffff'
                              : colors.text,
                        },
                      ]}>
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={[styles.optionHint, { color: colors.textSecondary }]}>
                  Filter to only include questions added within the selected time period
                </Text>
              </View>

              {/* Additional Options */}
              <View style={styles.modalSection}>
                <Text style={[styles.optionLabel, { color: colors.text }]}>
                  Additional Options
                </Text>
                
                <View style={[styles.switchRow, { backgroundColor: colors.background }]}>
                  <View style={styles.switchInfo}>
                    <Ionicons name="shuffle" size={20} color={colors.primary} />
                    <Text style={[styles.switchLabel, { color: colors.text }]}>
                      Shuffle Questions
                    </Text>
                  </View>
                  <Switch
                    value={downloadOptions.shuffleQuestions}
                    onValueChange={(value) => 
                      setDownloadOptions(prev => ({ ...prev, shuffleQuestions: value }))
                    }
                    trackColor={{ false: '#374151', true: '#6366f180' }}
                    thumbColor={downloadOptions.shuffleQuestions ? '#6366f1' : '#9ca3af'}
                  />
                </View>
                
                <View style={[styles.switchRow, { backgroundColor: colors.background }]}>
                  <View style={styles.switchInfo}>
                    <Ionicons name="bulb" size={20} color={colors.primary} />
                    <Text style={[styles.switchLabel, { color: colors.text }]}>
                      Include Explanations
                    </Text>
                  </View>
                  <Switch
                    value={downloadOptions.includeExplanations}
                    onValueChange={(value) => 
                      setDownloadOptions(prev => ({ ...prev, includeExplanations: value }))
                    }
                    trackColor={{ false: '#374151', true: '#6366f180' }}
                    thumbColor={downloadOptions.includeExplanations ? '#6366f1' : '#9ca3af'}
                  />
                </View>
              </View>
            </ScrollView>

            {/* Pinned footer. Sibling of the ScrollView on purpose: the old
                zero-height collapse happened under a maxHeight/auto parent and
                a '85%' percentage height; with the definite px height above
                plus minHeight here it cannot collapse, and the buttons stay
                visible without scrolling. */}
            <View style={[styles.modalActions, { borderTopColor: colors.border }]}>
              <TouchableOpacity
                style={[styles.cancelButton, { backgroundColor: colors.background }]}
                onPress={() => setShowDownloadModal(false)}
              >
                <Text style={[styles.cancelButtonText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.confirmDownloadButton,
                  isDownloading && styles.buttonDisabled,
                ]}
                onPress={async () => {
                  if (!selectedGroup) return;
                  try {
                    await downloadTest(
                      `test-${selectedGroup.id}`,
                      selectedGroup.id,
                      selectedGroup.name,
                      `${selectedGroup.name} Practice Test`,
                      downloadOptions,
                      userId || undefined
                    );
                    setShowDownloadModal(false);
                    Alert.alert('Success', 'Test downloaded for offline use!');
                  } catch (error) {
                    const message =
                      error instanceof Error && error.message.trim()
                        ? error.message
                        : 'Failed to download test';
                    Alert.alert('Error', message);
                  }
                }}
                disabled={isDownloading || (downloadOptions.questionTypes?.length === 0)}
              >
                {isDownloading ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <>
                    <Ionicons name="download" size={18} color="#ffffff" />
                    <Text style={styles.confirmDownloadButtonText}>
                      Download ({downloadOptions.questionCount} Q)
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </ThemeScope>
      </Modal>

      <PublishQuestionBankModal
        test={publishTarget}
        onClose={() => setPublishTarget(null)}
        onPublished={() => void loadOfflineData(userId || undefined)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'transparent',
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#ffffff',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  // Storage Card
  storageCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 3,
  },
  storageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  storageInfo: {
    flex: 1,
  },
  storageTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
  },
  storageSize: {
    fontSize: 14,
    color: '#9ca3af',
  },
  storageStats: {
    flexDirection: 'row',
    gap: 20,
  },
  storageStat: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  statLabel: {
    fontSize: 12,
    color: '#9ca3af',
  },
  syncButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#10b981',
    padding: 12,
    borderRadius: 10,
    gap: 8,
    marginTop: 16,
  },
  syncButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  // Tabs
  tabs: {
    flexDirection: 'row',
    backgroundColor: 'transparent',
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
  },
  activeTab: {
    backgroundColor: 'transparent',
  },
  tabText: {
    fontSize: 14,
    color: '#9ca3af',
  },
  activeTabText: {
    color: '#6366f1',
    fontWeight: '500',
  },
  // Section
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 12,
  },
  // Test Item
  testItem: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
  },
  testInfo: {
    flex: 1,
  },
  testHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  testName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#ffffff',
    flex: 1,
  },
  purchasedBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  publishButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  restoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    marginBottom: 16,
    minHeight: 44,
  },
  restoreButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  purchasedBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  testMeta: {
    fontSize: 13,
    color: '#9ca3af',
    marginBottom: 8,
  },
  testDetails: {
    flexDirection: 'row',
    gap: 12,
  },
  detailBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  detailText: {
    fontSize: 11,
    color: '#9ca3af',
  },
  testActions: {
    flexDirection: 'row',
    gap: 8,
  },
  startButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#6366f1',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 4,
  },
  startButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '500',
  },
  deleteButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#ef444420',
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Result Item
  resultItem: {
    backgroundColor: 'transparent',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
  },
  resultInfo: {
    flex: 1,
  },
  resultGroup: {
    fontSize: 16,
    fontWeight: '500',
    color: '#ffffff',
    marginBottom: 4,
  },
  resultScoreRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginBottom: 4,
  },
  resultScore: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  resultDetails: {
    fontSize: 14,
    color: '#9ca3af',
  },
  resultDate: {
    fontSize: 12,
    color: '#6b7280',
  },
  syncBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 4,
  },
  syncedBadge: {
    backgroundColor: '#10b98120',
  },
  pendingBadge: {
    backgroundColor: '#f59e0b20',
  },
  syncText: {
    fontSize: 12,
    fontWeight: '500',
  },
  // Available Downloads
  availableSection: {
    marginTop: 24,
  },
  offlineDeckItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'transparent',
  },
  offlineDeckName: {
    flex: 1,
    fontSize: 16,
    color: '#ffffff',
    marginRight: 8,
  },
  availableItem: {
    backgroundColor: 'transparent',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
  },
  availableInfo: {
    flex: 1,
  },
  availableName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#ffffff',
  },
  availableMeta: {
    fontSize: 13,
    color: '#9ca3af',
    marginTop: 2,
  },
  downloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#6366f1',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  downloadingButton: {
    opacity: 0.7,
  },
  downloadButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '500',
  },
  downloadedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  downloadedText: {
    color: '#10b981',
    fontSize: 13,
    fontWeight: '500',
  },
  // Empty State
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  // Clear Button
  clearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    marginTop: 8,
  },
  clearButtonText: {
    color: '#ef4444',
    fontSize: 14,
    fontWeight: '500',
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    // Height is set inline as a definite px value (85% of the window, via
    // useWindowDimensions). A fixed height (not maxHeight) is required: with
    // maxHeight and auto height, Yoga clamps this container AFTER measuring
    // children, so the body never shrinks and the Cancel/Download footer is
    // pushed off-screen — offline downloads were impossible on a Pixel 8.
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'transparent',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  modalBody: {
    // flex:1 (with the fixed-height modalContent above) bounds the body to
    // the space between header and footer; flexShrink alone was not enough
    // because the maxHeight clamp happened after child measurement.
    flex: 1,
  },
  modalBodyContent: {
    // Scroll padding lives here, not on the ScrollView style — vertical
    // padding on the outer style clips the scrollable extent on Android.
    padding: 20,
    paddingBottom: 24,
  },
  modalSection: {
    marginBottom: 24,
  },
  modalSectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 4,
  },
  modalSectionSubtitle: {
    fontSize: 14,
  },
  optionLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
  },
  optionHint: {
    fontSize: 12,
    marginTop: 8,
    fontStyle: 'italic',
  },
  countSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  countButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  countButtonActive: {
    backgroundColor: '#6366f1',
    borderColor: '#6366f1',
  },
  countButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#9ca3af',
  },
  countButtonTextActive: {
    color: '#ffffff',
  },
  typesList: {
    gap: 8,
  },
  typeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  typeItemActive: {
    borderColor: '#6366f1',
    backgroundColor: '#6366f120',
  },
  typeItemText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
  },
  switchInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  switchLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  modalActions: {
    flexDirection: 'row',
    padding: 20,
    paddingBottom: 40,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: 'transparent',
    // Belt and suspenders against the release-build zero-height collapse:
    // a definite floor means the footer can never measure to nothing.
    minHeight: 76,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: 'transparent',
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#9ca3af',
  },
  confirmDownloadButton: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#6366f1',
    gap: 8,
  },
  confirmDownloadButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
