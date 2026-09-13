// ===========================================
// Lantern Study Mobile - Downloads Screen
// ===========================================

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
  Switch,
  useWindowDimensions,
} from 'react-native';
import { appAlert, confirmAsync } from '../../components/ui/appDialog';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { useChrome } from '../../components/layout/ChromeContext';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useOfflineStore, OfflineTest, PendingResult } from '../../stores/offlineStore';
import { matchesCourseFilter } from '../../utils/libraryArchive';
import { useTestStore } from '../../stores/testStore';
import { offlineQuestionsToTestQuestions } from '../../utils/questionHelpers';
import { planBundlePlayability } from '../../utils/offlineQuestionShape';
import { useFlashcardStore } from '../../stores/flashcardStore';
import { BRAND_INK, useTheme } from '../../theme';
import { useAuthStore } from '../../stores/authStore';
import { restoreQuestionBanks } from '../../services/api';
import { PublishQuestionBankModal } from './PublishQuestionBankModal';
import { getConnectionStatus, syncCopy, featureAccents, lightColors } from '@lantern/shared/design';
import { pluralize } from '@lantern/shared/utils';
import { humanizeFailureMessage } from '@lantern/shared/network';
import { useNetworkStatus, usePendingWork } from '../../hooks';
import { syncService } from '../../services/syncService';
import {
  flushPendingQuestionBankScores,
  readPendingQuestionBankScores,
} from '../../utils/pendingQuestionBankScores';
import { useSettingsStore } from '../../stores/settingsStore';
import { AppIcon } from '../../components/ui/AppIcon';
import { Illustration } from '../../components/ui/Illustration';

import { toTab } from '../../navigation/nestedTab';

// Question type options
const QUESTION_TYPES = [
  { id: 'mcq-single', label: 'Single Choice', icon: 'radio-button-on' },
  { id: 'mcq-multiple', label: 'Multiple Choice', icon: 'checkbox' },
  { id: 'true-false', label: 'True/False', icon: 'swap-horizontal' },
  { id: 'fill-blank', label: 'Fill in Blank', icon: 'text' },
] as const;

/**
 * Downloads — one name for one place.
 *
 * The Me row said "Downloads" and this screen said "Offline Mode", which read
 * as two features. The screen is called Downloads everywhere a student can see
 * it; "offline" stays in the code (the store, the routes) where it describes
 * the mechanism rather than naming the destination.
 */
export default function OfflineScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  // Mounted both as the OfflineTab base tab and as the root-stack modal the
  // Library tree opens with a course filter. Only the modal gets a back arrow.
  const isBaseTab = route.name === 'OfflineTab';
  const tabBarClearance = useTabBarClearance(16);
  const { onScroll: chromeOnScroll } = useChrome();
  // Library tree deep link: { courseId, courseLabel, topicLabel } — courseId is
  // a uuid or the literal 'null' (bundles not filed under any course). A topic
  // label may ride along even though offline_bundles has no topic_id: it is
  // shown only to explain why the list is the whole course, never to filter.
  const routeCourseId: string | null | undefined = route.params?.courseId;
  const routeCourseLabel: string | undefined = route.params?.courseLabel;
  const routeTopicLabel: string | null | undefined = route.params?.topicLabel;
  const [courseFilter, setCourseFilter] = useState<{ id: string; label: string } | null>(
    routeCourseId ? { id: routeCourseId, label: routeCourseLabel || 'Course' } : null
  );
  // Display-only: downloads cannot be narrowed by topic, so this drives the
  // honesty line, not the filter.
  const [topicFilterLabel, setTopicFilterLabel] = useState<string | null>(routeTopicLabel ?? null);
  useEffect(() => {
    if (routeCourseId) {
      setCourseFilter({ id: routeCourseId, label: routeCourseLabel || 'Course' });
      setTopicFilterLabel(routeTopicLabel ?? null);
    }
  }, [routeCourseId, routeCourseLabel, routeTopicLabel]);
  const userId = useAuthStore(s => s.user?.id) || '';
  const [refreshing, setRefreshing] = useState(false);
  const [restoringBanks, setRestoringBanks] = useState(false);
  /** True while handleSync drains the sync queue as well as the results. */
  const [syncingAll, setSyncingAll] = useState(false);
  const [publishTarget, setPublishTarget] = useState<OfflineTest | null>(null);
  const [selectedTab, setSelectedTab] = useState<'downloads' | 'pending'>('downloads');
  const { colors } = useTheme();
  // Pixel height, not '85%': percentage heights resolved against the themed
  // overlay have already burned us on release builds (footer collapsed to
  // zero). A definite px height cannot be mis-resolved.
  const insets = useSafeAreaInsets();
  const network = useNetworkStatus();
  const lowDataMode = useSettingsStore(s => s.settings.appearance.lowDataMode);


  const {
    downloadedTests,
    pendingResults,
    downloadProgress,
    isSyncing,
    totalStorageUsed,
    lastSyncAt,
    loadOfflineData,
    deleteDownloadedTest,
    syncPendingResults,
    clearAllOfflineData,
  } = useOfflineStore();

  // Every queue, not just offline test results: a queued flashcard or message
  // is work waiting to upload, and counting only results made the screen say
  // "Pending Sync 0" while that work sat unsent. Declared after the store for
  // the same reason as connectionStatus below.
  const pending = usePendingWork();
  const unsyncedResults = pendingResults.filter(r => !r.synced).length;

  // Must run after useOfflineStore — earlier access caused a TDZ crash (blank screen).
  const connectionStatus = getConnectionStatus({
    isOnline: network.isConnected,
    lowDataMode,
    pendingSyncCount: pending.total,
    isSyncing,
    lastSyncedAt: lastSyncAt,
  });

  const startQuestionSet = useTestStore(s => s.startQuestionSet);

  // flashcard offline data
  const { decks, offlineDeckIds, unmarkDeckOffline } = useFlashcardStore();


  // Course filter from the Library tree. Purchased packs (qbank-*) are plain
  // bundles carrying the listing's course, so they filter the same way.
  const visibleTests = courseFilter
    ? downloadedTests.filter(t => matchesCourseFilter(t.courseId, courseFilter.id))
    : downloadedTests;
  const visibleOfflineDeckIds = courseFilter
    ? offlineDeckIds.filter(id => {
        const deck = decks.find(d => d.id === id);
        return deck ? matchesCourseFilter(deck.course_id, courseFilter.id) : false;
      })
    : offlineDeckIds;

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
    appAlert(
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

  const handleStartOfflineTest = async (test: OfflineTest, mode: 'test' | 'study' = 'test') => {
    if (!test.questions.length) {
      appAlert('No Questions', 'This offline bundle has no questions.');
      return;
    }

    // A downloaded question with no readable answer options cannot be
    // answered — on device that shipped as four blank rows and a score the
    // student never earned. Leave those out, and say so; if none are left,
    // do not open a session at all.
    const playability = planBundlePlayability(test.questions);
    if (!playability.canStart) {
      appAlert('Nothing to answer', playability.notice ?? 'This offline bundle has no questions.');
      return;
    }
    if (playability.notice) {
      // Asked BEFORE the session opens, not thrown over the first question:
      // a shorter test than the one they downloaded is their call to make.
      const proceed = await confirmAsync('Some questions left out', playability.notice, {
        confirmLabel: 'Start anyway',
      });
      if (!proceed) return;
    }

    try {
      const questions = offlineQuestionsToTestQuestions(playability.playable);
      // Study mode: untimed, unscored practice — web bundles always offered
      // it; mobile hardcoded scored tests.
      await startQuestionSet(test.testName, questions, mode, {
        // The bundle's own limit, 0 ("None") included. This used to invent
        // `max(questions * 2, 5)` minutes whenever the bundle said untimed —
        // the same fabricated default the group launcher had.
        timeLimitMinutes: mode === 'test' ? Math.max(0, test.timeLimit ?? 0) : 0,
        lockAnswered: mode === 'test' ? test.lockAnswered : undefined,
      });
      // Offline is a ROOT-stack modal, so 'StudyTab' is not a sibling route
      // here — it lives inside 'Main'. The unnested navigate was silently
      // dropped in release builds and Start did nothing. Navigating via
      // 'Main' also pops this modal so the test screen is actually visible.
      navigation.navigate('Main', {
        screen: 'StudyTab',
        params: toTab('TestTaking', {
          testId: test.testId,
          testName: test.testName,
          mode,
          isOffline: true,
          offlineTestId: test.id,
          groupName: test.groupName,
        }),
      });
    } catch {
      appAlert('Error', 'Failed to start offline test.');
    }
  };

  /**
   * Upload everything that is waiting, not just test results.
   *
   * Two independent queues have to be drained: the shared SyncQueue (messages,
   * flashcards, decks, notes) and the offline store's results — which also
   * flushes queued question-bank scores. Draining only the second is what made
   * a queued flashcard invisible here.
   */
  const handleSync = async () => {
    if (pending.total === 0) {
      appAlert('Nothing to sync', 'All your work is already uploaded.');
      return;
    }

    setSyncingAll(true);
    let queueSynced = 0;
    try {
      const queueResult = await syncService.syncNow();
      queueSynced = queueResult.success;
    } catch {
      // Per-queue failures are reported through the remaining count below.
    }

    // Queued question-bank scores are the third queue and can be the ONLY
    // thing pending. Flush them here, awaited, before the results replay:
    // syncPendingResults fires its own detached flush, which then finds an
    // empty queue instead of racing this one and posting a score twice.
    // flushPendingQuestionBankScores never throws.
    const scoreOutcome = await flushPendingQuestionBankScores(userId);

    let resultsSynced = 0;
    if (unsyncedResults > 0) {
      try {
        const outcome = await syncPendingResults(userId);
        resultsSynced = outcome.synced;
      } catch {
        // Same: what is left is what matters, not the throw.
      }
    }

    // A tap that lands while the automatic sync is already running hits the
    // queue's "already syncing" guard and returns {0,0} — that is a no-op, not
    // a failure (build 149 showed the false "Sync failed" alert 1.5s before the
    // concurrent run finished with 1 success). Wait for the in-flight run to
    // settle before judging what is left.
    const waitForQueueIdle = async () => {
      for (let i = 0; i < 50; i += 1) {
        if (!syncService.getStatus().queueStatus.isSyncing) return;
        await new Promise<void>(resolve => setTimeout(resolve, 300));
      }
    };
    await waitForQueueIdle();
    const queueSnapshot = syncService.getStatus();

    // Count what is actually left in all three queues before reporting —
    // "Everything has been uploaded" must be true of the scores as well.
    const scoresRemaining = await readPendingQuestionBankScores(userId)
      .then(entries => entries.length)
      .catch(() => scoreOutcome.remaining);
    pending.refresh();
    setSyncingAll(false);

    const synced = queueSynced + resultsSynced + scoreOutcome.posted;
    const remaining = syncService.getPendingCount() +
      useOfflineStore.getState().pendingResults.filter(r => !r.synced).length +
      scoresRemaining;

    if (remaining === 0) {
      appAlert('Synced', 'Everything has been uploaded.');
    } else if (synced > 0) {
      appAlert(
        'Partly synced',
        `${pluralize(synced, 'item')} uploaded; ${remaining} still waiting. ` +
          'The rest is still saved on this device — check your connection and try again.'
      );
    } else if (!queueSnapshot.isOnline || !network.isConnected) {
      // Offline is not a failure: nothing was attempted, nothing was lost.
      appAlert(
        'Waiting for a connection',
        `${pluralize(remaining, 'item')} saved on this device. ` +
          'They will upload automatically as soon as you are back online.'
      );
    } else {
      appAlert(
        'Sync failed',
        'Nothing could be uploaded. Your work is still saved on this device and will sync ' +
          'automatically once you are back online.'
      );
    }
  };

  const handleClearAll = () => {
    appAlert(
      'Clear all downloads',
      'This will remove all downloaded tests and pending results. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            await clearAllOfflineData(userId || undefined);
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
      appAlert(
        'Restore complete',
        restored > 0
          ? `Restored ${pluralize(restored, 'question bank')}.`
          : 'No purchased question banks to restore.'
      );
    } catch (e: unknown) {
      // A transport failure or server string is never printed as-is.
      appAlert('Could not restore purchases', humanizeFailureMessage(e));
    } finally {
      setRestoringBanks(false);
    }
  };

  const DownloadedTestItem = ({ test }: { test: OfflineTest }) => (
    <View style={[styles.testItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.testInfo}>
        <View style={styles.testHeader}>
          <AppIcon name="document-text" size={20} color={colors.primaryText} />
          <Text style={[styles.testName, { color: colors.text }]} numberOfLines={1}>{test.testName}</Text>
          {/* Marketplace purchases carry the qbank- bundle id (see web parity). */}
          {test.id.startsWith('qbank-') ? (
            <View style={[styles.purchasedBadge, { backgroundColor: colors.primaryFill + '1a' }]}>
              <Text style={[styles.purchasedBadgeText, { color: colors.primaryText }]}>PURCHASED</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.testMeta, { color: colors.textSecondary }]}>
          {test.groupName} • {pluralize(test.questionCount, 'question')}
        </Text>
        <View style={styles.testDetails}>
          <View style={styles.detailBadge}>
            <AppIcon name="cloud-download" size={12} color={colors.textTertiary} />
            <Text style={[styles.detailText, { color: colors.textTertiary }]}>{formatDate(test.downloadedAt)}</Text>
          </View>
          <View style={styles.detailBadge}>
            <AppIcon name="server" size={12} color={colors.textTertiary} />
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
            <AppIcon name="storefront" size={18} color={colors.primaryText} />
          </TouchableOpacity>
        ) : null}
        {/* Icon-only: with publish + delete this row holds four controls, and
            text labels crushed the bundle name to nothing on 360dp screens. */}
        <TouchableOpacity
          style={[styles.startButton, { backgroundColor: colors.surfaceSecondary }]}
          onPress={() => handleStartOfflineTest(test, 'study')}
          accessibilityLabel="Study this bundle (untimed, unscored)"
        >
          <AppIcon name="book" size={18} color={colors.primaryText} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.startButton, { backgroundColor: colors.primaryFill }]}
          onPress={() => handleStartOfflineTest(test, 'test')}
          accessibilityLabel="Take this bundle as a scored test"
        >
          <AppIcon name="play" size={18} color="#ffffff" />
        </TouchableOpacity>
        
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={() => handleDeleteTest(test)}
        >
          <AppIcon name="trash" size={18} color="#ef4444" />
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
        <AppIcon 
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

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        {isBaseTab ? (
          <View style={{ width: 40 }} />
        ) : (
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <AppIcon name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
        )}
        <Text style={[styles.headerTitle, { color: colors.text }]}>Downloads</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.content}
        // Padding lives on the content container, not the outer style —
        // vertical padding there clips the scrollable extent on Android — and
        // the bottom inset keeps the last buttons above the system nav bar.
        contentContainerStyle={{
          padding: 16,
          paddingBottom: isBaseTab ? tabBarClearance : insets.bottom + 32,
        }}
        onScroll={chromeOnScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primaryText}
          />
        }
      >
        {/* Storage Status */}
        <View style={[styles.storageCard, { backgroundColor: colors.card }]}>
          <View style={styles.storageHeader}>
            <AppIcon name="folder" size={24} color={featureAccents.offline} />
            <View style={styles.storageInfo}>
              <Text style={[styles.storageTitle, { color: colors.text }]}>Downloads storage</Text>
              <Text style={[styles.storageSize, { color: colors.textSecondary }]}>
                {formatSize(totalStorageUsed)} used · {connectionStatus.shortLabel}
              </Text>
              {lowDataMode ? (
                <Text style={{ fontSize: 11, color: colors.textTertiary, marginTop: 2 }}>
                  {syncCopy.savedLocally}
                </Text>
              ) : null}
            </View>
            {/* The screen's one picture, on its header block (spec v3 §5.6:
                heroes, not lists — the downloaded-test rows below stay bare).
                `budget` is the feature key on purpose: `featureAccents.offline`
                IS budget's amber ink, so this is the same hue the folder glyph
                beside it already uses, not a ninth colour.

                It is drawn from string literals in the bundle like every other
                asset here, so it renders identically with `lowDataMode` on —
                which matters more on this screen than on any other. */}
            <Illustration name="download-phone" feature="budget" size={56} />
          </View>
          
          <View style={styles.storageStats}>
            <View style={styles.storageStat}>
              <Text style={[styles.statValue, { color: colors.text }]}>{downloadedTests.length}</Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Downloaded</Text>
            </View>
            <View style={styles.storageStat}>
              <Text style={[styles.statValue, { color: colors.text }]}>{pending.total}</Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Pending Sync</Text>
            </View>
          </View>

          {/* Name the pending work. A bare number never told the student
              whether it was a result, a message or a flashcard. */}
          {pending.total > 0 && (
            <Text
              accessibilityLabel={pending.label}
              style={[styles.pendingBreakdown, { color: colors.textSecondary }]}
            >
              {pending.breakdownLabel} waiting to sync
            </Text>
          )}

          {pending.total > 0 && (
            <TouchableOpacity
              style={styles.syncButton}
              onPress={handleSync}
              disabled={isSyncing || syncingAll}
              accessibilityRole="button"
              accessibilityLabel={`Sync now. ${pending.label}`}
              accessibilityState={{ disabled: isSyncing || syncingAll, busy: isSyncing || syncingAll }}
            >
              {isSyncing || syncingAll ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <>
                  <AppIcon name="cloud-upload" size={18} color="#ffffff" />
                  <Text style={styles.syncButtonText}>
                    {/* Honest label: the button drains every queue, so it only
                        says "Results" when results are all there is. */}
                    {unsyncedResults === pending.total ? 'Sync Results' : 'Sync now'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* Library course filter (deep link from the Library tree) */}
        {courseFilter ? (
          <View style={{ marginBottom: 12, gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 999,
                  backgroundColor: colors.primaryFill + '20',
                  maxWidth: '70%',
                }}
              >
                <AppIcon name="school" size={14} color={colors.primaryText} />
                <Text style={{ fontSize: 12, fontWeight: '600', color: colors.primaryText, flexShrink: 1 }} numberOfLines={1}>
                  {courseFilter.label}
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    setCourseFilter(null);
                    setTopicFilterLabel(null);
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Clear course filter ${courseFilter.label}`}
                >
                  <AppIcon name="close-circle" size={16} color={colors.primaryText} />
                </TouchableOpacity>
              </View>
              <Text style={{ fontSize: 11, color: colors.textSecondary, flex: 1 }} numberOfLines={1}>
                {visibleTests.length} of {downloadedTests.length} bundles
              </Text>
            </View>
            {/* offline_bundles has no topic_id, so a topic cannot narrow this
                list. Say so rather than silently showing the whole course under
                a topic the student had selected. Mirrors web. */}
            {topicFilterLabel ? (
              <Text style={{ fontSize: 11, color: colors.textTertiary }}>
                Downloads are filed by course, not by topic — showing the whole course.
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* Tabs */}
        <View style={[styles.tabs, { backgroundColor: colors.cardSecondary }]}>
          <TouchableOpacity
            style={[
              styles.tab,
              selectedTab === 'downloads' && { backgroundColor: colors.background },
            ]}
            onPress={() => setSelectedTab('downloads')}
          >
            <AppIcon 
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
            <AppIcon 
              name="time" 
              size={18} 
              color={selectedTab === 'pending' ? colors.primary : colors.textTertiary} 
            />
            <Text style={[
              styles.tabText,
              { color: selectedTab === 'pending' ? colors.primary : colors.textSecondary },
              selectedTab === 'pending' && styles.activeTabText
            ]}>
              Results ({pendingResults.filter(r => !r.synced).length})
            </Text>
          </TouchableOpacity>
        </View>

        {/* Content based on tab */}
        {selectedTab === 'downloads' ? (
          <View style={styles.section}>
            {/* flashcard decks downloaded offline */}
            {visibleOfflineDeckIds.length > 0 && (
              <>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Downloaded Decks</Text>
                {visibleOfflineDeckIds.map(id => {
                  const deck = decks.find(d => d.id === id);
                  if (!deck) return null;
                  return (
                    <View key={id} style={[styles.offlineDeckItem, { backgroundColor: colors.card, borderColor: colors.border, borderBottomColor: colors.border }]}>
                      <Text style={[styles.offlineDeckName, { color: colors.text }]} numberOfLines={1}>{deck.name}</Text>
                      <TouchableOpacity
                        onPress={() => unmarkDeckOffline(id)}
                      >
                        <AppIcon name="trash" size={18} color="#ef4444" />
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
              <AppIcon name="bag-handle" size={16} color={colors.primaryText} />
              <Text style={[styles.restoreButtonText, { color: colors.primaryText }]}>
                {restoringBanks ? 'Restoring…' : 'Restore marketplace purchases'}
              </Text>
            </TouchableOpacity>
            {visibleTests.length > 0 ? (
              <>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Downloaded Tests</Text>
                {visibleTests.map(test => (
                  <DownloadedTestItem key={test.id} test={test} />
                ))}
              </>
            ) : (
              <View style={styles.emptyState}>
                <AppIcon name="cloud-download" size={48} color={colors.textTertiary} />
                <Text style={[styles.emptyTitle, { color: colors.text }]}>
                  {courseFilter && downloadedTests.length > 0 ? `Nothing filed under ${courseFilter.label}` : 'No Downloads Yet'}
                </Text>
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  {courseFilter && downloadedTests.length > 0
                    ? 'Bundles downloaded from a group linked to this course, and purchased packs for it, appear here.'
                    : 'Download tests from your study groups to access them offline'}
                </Text>
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
                <AppIcon name="checkmark-circle" size={48} color="#10b981" />
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
            <AppIcon name="trash" size={18} color="#ef4444" />
            <Text style={styles.clearButtonText}>Clear all downloads</Text>
          </TouchableOpacity>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>


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
  },
  // Storage Card
  storageCard: {
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
  pendingBreakdown: {
    fontSize: 12,
    marginTop: 4,
    marginBottom: 4,
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
  tabText: {
    fontSize: 14,
    color: '#9ca3af',
  },
  activeTabText: {
    color: BRAND_INK,
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
    fontSize: 11,
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
    // Build 153: a hardcoded #6366f1 under a white label is 4.45:1.
    // `primaryFill` is identical in both palettes, so a static style is fine.
    backgroundColor: lightColors.primaryFill,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 4,
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

});
