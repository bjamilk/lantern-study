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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useOfflineStore, OfflineTest, PendingResult, DownloadOptions } from '../../stores/offlineStore';
import { useFlashcardStore } from '../../stores/flashcardStore';
import { useGroupStore } from '../../stores/groupStore';
import { useTheme } from '../../theme';

// Question type options
const QUESTION_TYPES = [
  { id: 'mcq-single', label: 'Single Choice', icon: 'radio-button-on' },
  { id: 'mcq-multiple', label: 'Multiple Choice', icon: 'checkbox' },
  { id: 'true-false', label: 'True/False', icon: 'swap-horizontal' },
  { id: 'fill-blank', label: 'Fill in Blank', icon: 'text' },
] as const;

export default function OfflineScreen() {
  const navigation = useNavigation<any>();
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTab, setSelectedTab] = useState<'downloads' | 'pending'>('downloads');
  const { colors } = useTheme();
  
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

  // flashcard offline data
  const { decks, offlineDeckIds, unmarkDeckOffline } = useFlashcardStore();
  
  const { groups } = useGroupStore();

  useEffect(() => {
    loadOfflineData();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadOfflineData();
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

  const handleStartOfflineTest = (test: OfflineTest) => {
    navigation.navigate('TestTaking', {
      testId: test.testId,
      testName: test.testName,
      isOffline: true,
      offlineTestId: test.id,
    });
  };

  const handleSync = async () => {
    if (pendingResults.length === 0) {
      Alert.alert('Nothing to Sync', 'All your results are already synced.');
      return;
    }
    
    try {
      await syncPendingResults();
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

  const DownloadedTestItem = ({ test }: { test: OfflineTest }) => (
    <View style={styles.testItem}>
      <View style={styles.testInfo}>
        <View style={styles.testHeader}>
          <Ionicons name="document-text" size={20} color="#6366f1" />
          <Text style={styles.testName} numberOfLines={1}>{test.testName}</Text>
        </View>
        <Text style={styles.testMeta}>
          {test.groupName} • {test.questionCount} questions
        </Text>
        <View style={styles.testDetails}>
          <View style={styles.detailBadge}>
            <Ionicons name="cloud-download" size={12} color="#9ca3af" />
            <Text style={styles.detailText}>{formatDate(test.downloadedAt)}</Text>
          </View>
          <View style={styles.detailBadge}>
            <Ionicons name="server" size={12} color="#9ca3af" />
            <Text style={styles.detailText}>{formatSize(test.size)}</Text>
          </View>
        </View>
      </View>
      
      <View style={styles.testActions}>
        <TouchableOpacity
          style={styles.startButton}
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
    <View style={styles.resultItem}>
      <View style={styles.resultInfo}>
        <Text style={styles.resultGroup}>{result.groupName}</Text>
        <View style={styles.resultScoreRow}>
          <Text style={[
            styles.resultScore,
            { color: result.percentage >= 80 ? '#10b981' : result.percentage >= 60 ? '#f59e0b' : '#ef4444' }
          ]}>
            {result.percentage}%
          </Text>
          <Text style={styles.resultDetails}>
            {result.score}/{result.totalQuestions} correct
          </Text>
        </View>
        <Text style={styles.resultDate}>{formatDate(result.completedAt)}</Text>
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
      <View style={styles.availableItem}>
        <View style={styles.availableInfo}>
          <Text style={styles.availableName}>{group.name}</Text>
          <Text style={styles.availableMeta}>
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
            style={styles.downloadButton}
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
      <View style={[styles.header, { backgroundColor: colors.card }]}>
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
            tintColor="#6366f1"
          />
        }
      >
        {/* Storage Status */}
        <View style={styles.storageCard}>
          <View style={styles.storageHeader}>
            <Ionicons name="folder" size={24} color="#6366f1" />
            <View style={styles.storageInfo}>
              <Text style={styles.storageTitle}>Offline Storage</Text>
              <Text style={styles.storageSize}>
                {formatSize(totalStorageUsed)} used
              </Text>
            </View>
          </View>
          
          <View style={styles.storageStats}>
            <View style={styles.storageStat}>
              <Text style={styles.statValue}>{downloadedTests.length}</Text>
              <Text style={styles.statLabel}>Downloaded</Text>
            </View>
            <View style={styles.storageStat}>
              <Text style={styles.statValue}>{pendingResults.filter(r => !r.synced).length}</Text>
              <Text style={styles.statLabel}>Pending Sync</Text>
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
        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tab, selectedTab === 'downloads' && styles.activeTab]}
            onPress={() => setSelectedTab('downloads')}
          >
            <Ionicons 
              name="download" 
              size={18} 
              color={selectedTab === 'downloads' ? '#6366f1' : '#9ca3af'} 
            />
            <Text style={[
              styles.tabText,
              selectedTab === 'downloads' && styles.activeTabText
            ]}>
              Downloads ({downloadedTests.length})
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.tab, selectedTab === 'pending' && styles.activeTab]}
            onPress={() => setSelectedTab('pending')}
          >
            <Ionicons 
              name="time" 
              size={18} 
              color={selectedTab === 'pending' ? '#6366f1' : '#9ca3af'} 
            />
            <Text style={[
              styles.tabText,
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
                <Text style={styles.sectionTitle}>Downloaded Decks</Text>
                {offlineDeckIds.map(id => {
                  const deck = decks.find(d => d.id === id);
                  if (!deck) return null;
                  return (
                    <View key={id} style={styles.offlineDeckItem}>
                      <Text style={styles.offlineDeckName} numberOfLines={1}>{deck.name}</Text>
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
            {downloadedTests.length > 0 ? (
              <>
                <Text style={styles.sectionTitle}>Downloaded Tests</Text>
                {downloadedTests.map(test => (
                  <DownloadedTestItem key={test.id} test={test} />
                ))}
              </>
            ) : (
              <View style={styles.emptyState}>
                <Ionicons name="cloud-download" size={48} color="#6b7280" />
                <Text style={styles.emptyTitle}>No Downloads Yet</Text>
                <Text style={styles.emptyText}>
                  Download tests from your study groups to access them offline
                </Text>
              </View>
            )}
            
            {/* Available to Download */}
            {groups.length > 0 && (
              <View style={styles.availableSection}>
                <Text style={styles.sectionTitle}>Available to Download</Text>
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
                <Text style={styles.sectionTitle}>Test Results</Text>
                {pendingResults.map(result => (
                  <PendingResultItem key={result.id} result={result} />
                ))}
              </>
            ) : (
              <View style={styles.emptyState}>
                <Ionicons name="checkmark-circle" size={48} color="#10b981" />
                <Text style={styles.emptyTitle}>All Synced!</Text>
                <Text style={styles.emptyText}>
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
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                Download Options
              </Text>
              <TouchableOpacity onPress={() => setShowDownloadModal(false)}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
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
                        downloadOptions.questionCount === count && styles.countButtonActive,
                      ]}
                      onPress={() => setDownloadOptions(prev => ({ ...prev, questionCount: count }))}
                    >
                      <Text style={[
                        styles.countButtonText,
                        downloadOptions.questionCount === count && styles.countButtonTextActive,
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
                        downloadOptions.timeLimit === time && styles.countButtonActive,
                      ]}
                      onPress={() => setDownloadOptions(prev => ({ ...prev, timeLimit: time }))}
                    >
                      <Text style={[
                        styles.countButtonText,
                        downloadOptions.timeLimit === time && styles.countButtonTextActive,
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
                        downloadOptions.recentlyAddedDays === option.value && styles.countButtonActive,
                      ]}
                      onPress={() => setDownloadOptions(prev => ({ ...prev, recentlyAddedDays: option.value }))}
                    >
                      <Text style={[
                        styles.countButtonText,
                        downloadOptions.recentlyAddedDays === option.value && styles.countButtonTextActive,
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

            {/* Download Button */}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setShowDownloadModal(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
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
                      downloadOptions
                    );
                    setShowDownloadModal(false);
                    Alert.alert('Success', 'Test downloaded for offline use!');
                  } catch (error) {
                    Alert.alert('Error', 'Failed to download test');
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
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
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
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
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
    backgroundColor: '#1e293b',
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
    backgroundColor: '#0f172a',
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
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
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
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
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
    borderBottomColor: '#334155',
  },
  offlineDeckName: {
    flex: 1,
    fontSize: 16,
    color: '#ffffff',
    marginRight: 8,
  },
  availableItem: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
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
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  modalBody: {
    padding: 20,
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
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
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
    borderTopColor: '#334155',
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#334155',
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
