import React, { useCallback, useEffect, useMemo, useState } from 'react';

import {

  Modal,

  Pressable,

  RefreshControl,

  ScrollView,

  Text,

  View,

  useWindowDimensions,

} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';

import { Ionicons } from '@expo/vector-icons';

import { CompositeScreenProps, useFocusEffect } from '@react-navigation/native';

import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';

import { useAuthStore } from '../../stores/authStore';

import { useFlashcardStore } from '../../stores/flashcardStore';

import { useGroupStore } from '../../stores/groupStore';
import { useBudgetStore } from '../../stores/budgetStore';

import { useStatsStore, type TimePeriod, type RecentTest } from '../../stores/statsStore';

import { useStudyGoalsStore } from '../../stores/studyGoalsStore';
import { useSettingsStore } from '../../stores/settingsStore';

import { useNotesStore } from '../../stores/notesStore';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { useChrome } from '../../components/layout/ChromeContext';
import { useTestStore } from '../../stores/testStore';

import { Card, Button } from '../../components/ui';

import { DashboardHeroCard } from '../../components/dashboard/DashboardHeroCard';

import { DashboardQuickLinks } from '../../components/dashboard/DashboardQuickLinks';
import { GettingStartedChecklist } from '../../components/dashboard/GettingStartedChecklist';
import { DashboardInsights } from '../../components/dashboard/DashboardInsights';
import { GroupPerformanceChartCard } from '../../components/dashboard/GroupPerformanceChartCard';
import { AIStudyCoachCard } from '../../components/dashboard/AIStudyCoachCard';
import { CourseReadinessCard } from '../../components/dashboard/CourseReadinessCard';
import { useCompanionStore } from '../../stores/companionStore';
import * as api from '../../services/api';
import { refreshUserData } from '../../services/dataRefresh';

import { DailyQuestsWidget } from '../../components/DailyQuestsWidget';

import { DailyQuizWidget } from '../../components/DailyQuizWidget';
import ImportAndStudyModal from '../../components/ImportAndStudyModal';
import { CollapsibleSection } from '../../components/CollapsibleSection';
import { DailyGoalsProgress } from '../../components/DailyGoalsProgress';

import { fetchDailyQuests, recordLoginStreak, purchaseStreakFreeze, type DailyQuest } from '../../services/gamification';
import { WALLET_COINS } from '@lantern/shared/utils';
import { isCardDue } from '@lantern/shared/utils/srs';
import { isQuizzableNote } from '@lantern/shared/utils/noteStudyContent';
import { useToastStore } from '../../stores/toastStore';

import { HomeStackParamList, MainTabParamList } from '../../navigation/types';
import { featureAccents } from '@lantern/shared/design';
import { buildActivityHeatmapGrid, getActivityHeatHexColorForCount, getActivityHeatHexColor, computeStudyStreak, getDashboardFirstName, type ActivityHeatLevel } from '@lantern/shared/utils';

import { useTheme } from '../../theme';



type Props = CompositeScreenProps<

  NativeStackScreenProps<HomeStackParamList, 'Dashboard'>,

  BottomTabScreenProps<MainTabParamList>

>;



const PERIOD_OPTIONS: { value: TimePeriod; label: string }[] = [

  { value: '7days', label: '7d' },

  { value: '30days', label: '30d' },

  { value: '90days', label: '90d' },

  { value: 'all', label: 'All' },

];

const RECENT_TESTS_PAGE_SIZE = 5;



function ActivityHeatmap({ days, theme }: { days: { date: string; count: number }[]; theme: 'light' | 'dark' }) {
  const legendLevels: ActivityHeatLevel[] = [0, 1, 2, 3, 4];
  const weeks: { date: string; count: number }[][] = [];

  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  return (
    <View className="overflow-hidden items-center gap-2">
      <View className="flex-row flex-wrap gap-1">
        {weeks.map((week, wi) => (
          <View key={`week-${wi}`} className="gap-1">
            {week.map(day => (
              <View
                key={day.date}
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 2,
                  backgroundColor: getActivityHeatHexColorForCount(day.count, theme),
                }}
              />
            ))}
          </View>
        ))}
      </View>
      <View className="flex-row items-center gap-1">
        <Text className="text-xs text-lantern-text-tertiary">Less</Text>
        {legendLevels.map(level => (
          <View
            key={level}
            style={{
              width: 12,
              height: 12,
              borderRadius: 2,
              backgroundColor: getActivityHeatHexColor(level, theme),
            }}
          />
        ))}
        <Text className="text-xs text-lantern-text-tertiary">More</Text>
      </View>
    </View>
  );
}



export function DashboardScreen({ navigation }: Props) {
  const tabBarClearance = useTabBarClearance(24);
  const { onScroll: chromeOnScroll } = useChrome();
  const { width: windowWidth } = useWindowDimensions();
  const heroQuestsSideBySide = windowWidth >= 768;

  const user = useAuthStore(s => s.user);
  const profileName = useAuthStore(s => s.profileName);
  const profileFirstName = useAuthStore(s => s.profileFirstName);

  const { decks, fetchDecks } = useFlashcardStore();
  const flashcardsByDeck = useFlashcardStore(s => s.flashcards);

  const { groups, fetchGroups } = useGroupStore();

  const openCompanion = useCompanionStore(s => s.open);
  const companionOpen = useCompanionStore(s => s.isOpen);
  const budget = useBudgetStore(s => s.budget);
  const transactions = useBudgetStore(s => s.transactions);

  const { notes, loadNotes } = useNotesStore();

  const { stats, leanTestResults, selectedPeriod, isLoading: statsLoading, error: statsError, fetchStats, setSelectedPeriod } = useStatsStore();

  const activeTest = useTestStore(s => s.activeTest);
  const pausedSessions = useTestStore(s => s.pausedSessions);
  const refreshPausedSessions = useTestStore(s => s.refreshPausedSessions);
  const resumePausedSession = useTestStore(s => s.resumePausedSession);
  const abandonPausedSession = useTestStore(s => s.abandonPausedSession);
  const pauseActiveTest = useTestStore(s => s.pauseActiveTest);

  const {

    studyGoal,

    dailyQuiz,

    dailyQuizProgress,

    setStudyGoal,

    setDailyQuiz,

    answerDailyQuestion,

    completeDailyQuiz,

    getDailyQuizForToday,

    startDailyQuizFromContent,

  } = useStudyGoalsStore();

  const studySettings = useSettingsStore(s => s.settings.study);

  const [refreshing, setRefreshing] = useState(false);

  const [quests, setQuests] = useState<DailyQuest[]>([]);

  const [serverStreak, setServerStreak] = useState(0);

  const [streakFreezes, setStreakFreezes] = useState(0);

  const [purchasingFreeze, setPurchasingFreeze] = useState(false);

  const [quizLoading, setQuizLoading] = useState(false);

  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const [analysisLoadingId, setAnalysisLoadingId] = useState<string | null>(null);
  const [recentSort, setRecentSort] = useState<'newest' | 'oldest' | 'highestScore'>('newest');
  const [recentPage, setRecentPage] = useState(1);
  const [recentPageItems, setRecentPageItems] = useState<RecentTest[]>([]);
  const [recentTotal, setRecentTotal] = useState(0);
  const [recentLoading, setRecentLoading] = useState(false);

  const openDetailedAnalysis = useCallback(
    (test: RecentTest) => {
      // Navigate to a stack screen — nested RN Modal fails under some parents,
      // and the analysis screen hydrates lean rows via fetchTestSessionDetail.
      setAnalysisLoadingId(test.id);
      navigation.navigate('TestAnalysis', {
        test,
        sessionId: test.id,
      });
      setAnalysisLoadingId(null);
    },
    [navigation]
  )



  // Count over every loaded card rather than summing each deck's due_count.
  // enrichDecksWithStats only fills due_count for decks present in `decks`, so a
  // card whose deck is missing from that list contributes nothing — which made
  // two signed-in devices disagree (37 on iOS, 38 on Android) and both differ
  // from web, which counts a flat list. This matches web exactly.
  const dueCount = useMemo(
    () =>
      Object.values(flashcardsByDeck).reduce(
        (total, cards) => total + cards.filter(card => isCardDue(card.srsData)).length,
        0
      ),
    [flashcardsByDeck]
  );

  const displayName = useMemo(
    () =>
      getDashboardFirstName({
        firstName: profileFirstName || (user?.user_metadata?.first_name as string | undefined),
        name: profileName || (user?.user_metadata?.name as string | undefined),
        username: user?.user_metadata?.username as string | undefined,
      }),
    [profileFirstName, profileName, user]
  );

  const todayQuiz = useMemo(() => {
    const quiz = getDailyQuizForToday() ?? dailyQuiz;
    if (!quiz || quiz.sourceNoteTitle || !quiz.noteId) return quiz;
    const note = notes.find(n => n.id === quiz.noteId);
    return note
      ? { ...quiz, sourceNoteTitle: note.title?.trim() || 'Untitled note' }
      : quiz;
  }, [getDailyQuizForToday, dailyQuiz, notes]);

  const availableGroups = useMemo(() => groups.filter(g => !g.isArchived), [groups]);

  const recentPeriodBounds = useMemo(() => {
    if (selectedPeriod === 'all') return { from: undefined as string | undefined, to: undefined as string | undefined };
    const days = selectedPeriod === '7days' ? 7 : selectedPeriod === '30days' ? 30 : 90;
    const from = new Date();
    from.setDate(from.getDate() - days);
    from.setHours(0, 0, 0, 0);
    return { from: from.toISOString(), to: undefined as string | undefined };
  }, [selectedPeriod]);

  useEffect(() => {
    setRecentPage(1);
  }, [recentSort, selectedPeriod]);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    const loadRecent = async () => {
      setRecentLoading(true);
      try {
        const result = await api.fetchTestResultsPage(user.id, {
          page: recentPage,
          limit: RECENT_TESTS_PAGE_SIZE,
          lean: true,
          sort: recentSort,
          from: recentPeriodBounds.from,
          to: recentPeriodBounds.to,
        });
        if (cancelled) return;
        const rows = Array.isArray(result.data) ? result.data : [];
        const mapped: RecentTest[] = rows.map((item: any) => {
          const start = item.session?.startTime ? new Date(item.session.startTime) : new Date();
          const end = item.session?.endTime ? new Date(item.session.endTime) : start;
          const groupId = item.session?.config?.groupId;
          const groupName =
            item.session?.config?.groupName ||
            groups.find((g) => g.id === groupId)?.name ||
            'Unknown exam';
          return {
            id: item.id || item.session?.id || `${start.getTime()}`,
            groupName,
            score: item.correctAnswersCount ?? 0,
            totalQuestions: item.totalQuestions ?? 0,
            percentage: Math.round(item.score ?? 0),
            completedAt: (item.session?.endTime || item.session?.startTime || start).toString(),
            timeSpent: Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000)),
            analysis: {
              correctCount: item.correctAnswersCount ?? 0,
              incorrectCount: Math.max(
                0,
                (item.totalQuestions ?? 0) - (item.correctAnswersCount ?? 0)
              ),
              unattemptedCount: 0,
              timePerQuestion: [],
              timePerTag: [],
              tagPerformance: [],
            },
          };
        });
        setRecentPageItems(mapped);
        setRecentTotal(result.pagination?.total ?? mapped.length);
      } catch {
        if (!cancelled) {
          setRecentPageItems([]);
          setRecentTotal(0);
        }
      } finally {
        if (!cancelled) setRecentLoading(false);
      }
    };
    void loadRecent();
    return () => {
      cancelled = true;
    };
  }, [user?.id, recentPage, recentSort, recentPeriodBounds.from, recentPeriodBounds.to, groups]);

  const recentTotalPages = Math.max(1, Math.ceil(recentTotal / RECENT_TESTS_PAGE_SIZE));

  const heatmap = useMemo(

    () => buildActivityHeatmapGrid(stats?.activityDays || []),

    [stats?.activityDays]

  );



  const load = async () => {

    if (!user?.id) return;

    await Promise.all([

      fetchDecks(user.id),

      fetchGroups(user.id),

      loadNotes().catch(() => {}),

      fetchStats(user.id, selectedPeriod).catch(() => {}),

    ]);

    try {

      const streakRes = await recordLoginStreak();

      setServerStreak(
        streakRes?.current_streak ?? streakRes?.currentStreak ?? streakRes?.current ?? stats?.currentStreak ?? 0
      );

      setStreakFreezes(streakRes?.streak_freezes ?? streakRes?.streakFreezes ?? 0);

    } catch {

      setServerStreak(stats?.currentStreak ?? 0);

    }

    try {

      const q = await fetchDailyQuests();

      setQuests(q);

    } catch {

      setQuests([]);

    }

  };



  useEffect(() => {

    void load();

  }, [user?.id]);



  useEffect(() => {

    if (!user?.id) return;

    void fetchStats(user.id, selectedPeriod).catch(() => {});

  }, [selectedPeriod, user?.id]);

  // Home tab stays mounted; refetch chart inputs when returning from a test.
  useFocusEffect(
    useCallback(() => {
      if (!user?.id) return;
      void fetchStats(user.id, selectedPeriod, { force: true }).catch(() => {});
      // The hero's due count and the tab badges come from decks + notifications,
      // which bootstrap only loads once — refresh them alongside the chart so
      // Home cannot keep showing a stale "N due" or unread count.
      void refreshUserData(user.id, { only: ['flashcards', 'notifications'] });
    }, [user?.id, selectedPeriod, fetchStats])
  );

  const onRefresh = async () => {

    setRefreshing(true);

    await load();

    setRefreshing(false);

  };

  const handlePurchaseFreeze = useCallback(async () => {
    const { walletBalance } = useBudgetStore.getState();
    const { showToast } = useToastStore.getState();
    if (walletBalance < WALLET_COINS.STREAK_FREEZE_COST) {
      showToast(
        `You need ${WALLET_COINS.STREAK_FREEZE_COST} coins for a streak freeze (you have ${walletBalance}). Earn coins by studying daily.`,
        'error'
      );
      return;
    }
    setPurchasingFreeze(true);
    try {
      const result = await purchaseStreakFreeze();
      setStreakFreezes(result?.streak_freezes ?? result?.streakFreezes ?? 1);
      if (typeof result?.walletBalance === 'number') {
        useBudgetStore.setState({ walletBalance: result.walletBalance });
      }
      showToast('Streak freeze purchased! It protects your streak for one missed day.', 'success');
    } catch (error: any) {
      showToast(error?.message || 'Could not purchase streak freeze.', 'error');
    } finally {
      setPurchasingFreeze(false);
    }
  }, []);



  const quizNoteOptions = useMemo(
    () =>
      notes
        // Shared with web: excludes archived notes, and measures the same study
        // content web does (attachment text included), which the old
        // body/summary length check missed.
        .filter(isQuizzableNote)
        .map(n => ({
          id: n.id,
          title: n.title?.trim() || 'Untitled note',
        })),
    [notes]
  );

  const startQuiz = useCallback(
    async (noteId: string) => {
      const note = notes.find(n => n.id === noteId);
      // Re-check on start, not just when the list was built: a note can be
      // archived (or emptied) between render and tap.
      if (!note || !isQuizzableNote(note)) return;

      setQuizLoading(true);
      try {
        const content = `${note.title}\n${note.body || note.summary || ''}`.slice(0, 4000);
        await startDailyQuizFromContent(content, note.id, note.title);
      } catch {
        setDailyQuiz(null);
      } finally {
        setQuizLoading(false);
      }
    },
    [notes, startDailyQuizFromContent, setDailyQuiz]
  );



  const parent = navigation.getParent();

  const { isDark, colors } = useTheme();

  const studyActivityStreak = useMemo(
    () => computeStudyStreak(stats?.activityDays ?? []).current,
    [stats?.activityDays]
  );
  const streak = Math.max(serverStreak, studyActivityStreak, stats?.currentStreak || 0);

  const level = stats?.userLevel;



  const handlePeriodChange = (period: TimePeriod) => {

    setSelectedPeriod(period);

  };



  const handleQuickTest = () => {

    if (availableGroups.length > 1) {

      setGroupPickerOpen(true);

      return;

    }

    if (availableGroups.length === 1) {

      parent?.navigate('ChatTab', {

        screen: 'GroupChat',

        params: { groupId: availableGroups[0].id, groupName: availableGroups[0].name },

        // Keep the chat list beneath, so back reaches it.
        initial: false,

      });

      return;

    }

    parent?.navigate('StudyTab', { screen: 'TestsList' });

  };



  const handleGroupPick = (groupId: string, groupName: string) => {

    setGroupPickerOpen(false);

    parent?.navigate('ChatTab', { screen: 'GroupChat', params: { groupId, groupName }, initial: false });

  };



  const handleResumeTest = () => {

    if (!activeTest) return;

    parent?.navigate('StudyTab', {

      screen: 'TestTaking',

      params: {

        testId: activeTest.test.id,

        testName: activeTest.test.name,

        mode: activeTest.mode,

      },

    });

  };

  React.useEffect(() => {
    void refreshPausedSessions();
  }, [refreshPausedSessions, user?.id]);

  const handleResumePaused = async (sessionId: string) => {
    try {
      await resumePausedSession(sessionId);
      const resumed = useTestStore.getState().activeTest;
      if (!resumed) return;
      parent?.navigate('StudyTab', {
        screen: 'TestTaking',
        params: {
          testId: resumed.test.id,
          testName: resumed.test.name,
          mode: resumed.mode,
        },
      });
    } catch {
      // refresh list if resume failed
      void refreshPausedSessions();
    }
  };



  const formatDuration = (seconds: number) => {

    const m = Math.floor(seconds / 60);

    const s = seconds % 60;

    return m > 0 ? `${m}m ${s}s` : `${s}s`;

  };



  return (

    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: tabBarClearance, paddingHorizontal: 16 }}
        onScroll={chromeOnScroll}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >

        <View className={heroQuestsSideBySide ? 'flex-row gap-3 mb-4 items-stretch' : undefined}>
        <View className={heroQuestsSideBySide ? 'flex-1' : undefined}>
        <DashboardHeroCard
          userName={displayName}
          streak={streak}
          points={stats?.totalPoints ?? 0}
          dueCount={dueCount}
          totalTests={stats?.totalTestsTaken ?? 0}
          level={level}
          className={heroQuestsSideBySide ? 'mb-0 h-full' : undefined}
          onPrimaryAction={() => {
            if (dueCount > 0) {
              parent?.navigate('StudyTab', { screen: 'FlashcardsList' });
            } else {
              setImportOpen(true);
            }
          }}
          primaryActionLabel={
            dueCount > 0
              ? `Review ${dueCount} due card${dueCount !== 1 ? 's' : ''}`
              : 'Import & study'
          }
        />
        </View>
        <View className={heroQuestsSideBySide ? 'flex-1' : undefined}>
        <DailyQuestsWidget
          quests={quests}
          streak={streak}
          streakFreezes={streakFreezes}
          onPurchaseFreeze={() => void handlePurchaseFreeze()}
          purchasingFreeze={purchasingFreeze}
          className={heroQuestsSideBySide ? 'mb-0 h-full' : undefined}
        />
        </View>
        </View>

        <GettingStartedChecklist
          hasDecks={decks.length > 0}
          hasTests={(stats?.totalTestsTaken ?? 0) > 0}
          hasGroups={groups.length > 0}
          hasBudget={Boolean(budget?.monthlyLimit && budget.monthlyLimit > 0) || transactions.length > 0}
          hasTriedCompanion={companionOpen}
          onCreateDeck={() => parent?.navigate('StudyTab', { screen: 'Library', params: { tab: 'flashcards' } })}
          onTakeTest={() => parent?.navigate('StudyTab', { screen: 'TestsList' })}
          onJoinGroup={() => parent?.navigate('ChatTab')}
          onSetBudget={() => parent?.navigate('BudgetTab')}
          onOpenLibrary={() => parent?.navigate('StudyTab', { screen: 'Library' })}
          onTryCompanion={() => openCompanion()}
          onSubmitQuestion={() => parent?.navigate('ChatTab')}
          onExploreMarketplace={() => parent?.navigate('MarketTab')}
          onTryOffline={() => {
            const root = parent?.getParent?.() ?? parent;
            (root as { navigate?: (name: string) => void } | undefined)?.navigate?.('Offline');
          }}
        />

        {pausedSessions.length > 0 ? (
          <Card className="mb-4 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800">
            <Text className="font-semibold text-amber-900 dark:text-amber-100 mb-2">
              Saved sessions ({pausedSessions.length})
            </Text>
            {pausedSessions.map((session) => (
              <View
                key={session.id}
                className="flex-row items-center justify-between gap-2 py-2 border-t border-amber-200/60 dark:border-amber-800/60"
              >
                <View className="flex-1 min-w-0">
                  <Text className="font-medium text-amber-900 dark:text-amber-100" numberOfLines={1}>
                    {session.title}
                  </Text>
                  <Text className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                    {session.sessionKind === 'study' ? 'Study' : 'Test'} · {session.answeredCount}/
                    {session.totalQuestions} answered
                  </Text>
                </View>
                <Button size="sm" variant="secondary" onPress={() => void abandonPausedSession(session.id)}>
                  Discard
                </Button>
                <Button size="sm" onPress={() => void handleResumePaused(session.id)}>
                  Resume
                </Button>
              </View>
            ))}
          </Card>
        ) : activeTest ? (
          <Card className="mb-4 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800">

            <View className="flex-row items-center justify-between gap-3">

              <View className="flex-1">

                <Text className="font-semibold text-amber-900 dark:text-amber-100">Test in progress</Text>

                <Text className="text-sm text-amber-700 dark:text-amber-300 mt-0.5">

                  {activeTest.test.name} — question {activeTest.currentQuestionIndex + 1} of{' '}

                  {activeTest.questions.length}

                </Text>

              </View>

              <Button size="sm" variant="secondary" onPress={() => void pauseActiveTest()}>
                Pause
              </Button>

              <Button size="sm" onPress={handleResumeTest}>

                Resume

              </Button>

            </View>

          </Card>

        ) : null}



        <View className="flex-row gap-2 mb-3">

          {PERIOD_OPTIONS.map(opt => (

            <Pressable

              key={opt.value}

              onPress={() => handlePeriodChange(opt.value)}

              className={`px-3 py-1.5 rounded-full ${

                selectedPeriod === opt.value

                  ? 'bg-lantern-primary'

                  : 'bg-lantern-surface border border-lantern-border'

              }`}

            >

              <Text

                className={`text-xs font-semibold ${

                  selectedPeriod === opt.value ? 'text-white' : 'text-lantern-text-secondary'

                }`}

              >

                {opt.label}

              </Text>

            </Pressable>

          ))}

        </View>



        {statsError && !statsLoading ? (
          <Card className="mb-4 bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800">
            <View className="flex-row items-center gap-3">
              <Ionicons name="cloud-offline-outline" size={20} color="#dc2626" />
              <View className="flex-1">
                <Text className="text-sm font-semibold text-red-700 dark:text-red-300">
                  Couldn't refresh your stats
                </Text>
                <Text className="text-xs text-red-600/80 dark:text-red-400/80 mt-0.5">
                  Showing your latest saved data.
                </Text>
              </View>
              <Button
                size="sm"
                variant="secondary"
                onPress={() => {
                  if (user?.id) void fetchStats(user.id, selectedPeriod, { force: true }).catch(() => {});
                }}
              >
                Retry
              </Button>
            </View>
          </Card>
        ) : null}

        <DailyGoalsProgress
          study={studySettings}
          activityDays={stats?.activityDays ?? []}
        />



        {statsLoading && !stats ? (
          <View className="flex-row gap-3 mb-4">
            {[0, 1, 2].map(i => (
              <Card key={`stat-skeleton-${i}`} className="flex-1 items-center py-3">
                <View className="w-10 h-7 rounded-md bg-lantern-border/60" />
                <View className="w-16 h-3 rounded bg-lantern-border/40 mt-2" />
              </Card>
            ))}
          </View>
        ) : (
        <View className="flex-row gap-3 mb-4">

          <Card className="flex-1 items-center py-3">

            <Text className="text-2xl font-bold text-lantern-primary">{stats?.totalTestsTaken ?? '—'}</Text>

            <Text className="text-xs text-lantern-text-secondary mt-1">Tests taken</Text>

          </Card>

          <Card className="flex-1 items-center py-3">

            <Text className="text-2xl font-bold text-lantern-accent">

              {stats?.averageTimePerQuestion ? `${stats.averageTimePerQuestion}s` : '—'}

            </Text>

            <Text className="text-xs text-lantern-text-secondary mt-1">Avg / question</Text>

          </Card>

          <Card className="flex-1 items-center py-3">

            <View className="flex-row items-center gap-1">

              <Ionicons name="flame" size={16} color="#f97316" />

              <Text className="text-2xl font-bold text-emerald-600">{streak}</Text>

            </View>

            <Text className="text-xs text-lantern-text-secondary mt-1">Streak</Text>

          </Card>

        </View>
        )}



        <AIStudyCoachCard stats={stats} streak={streak} />

        <CourseReadinessCard />



        <Card className="mb-4">

          <Text className="text-sm font-semibold text-lantern-text mb-2">

            16-week activity

          </Text>

          {statsLoading && !stats ? (

            <Text className="text-xs text-lantern-text-tertiary">Loading activity...</Text>

          ) : (

            <>

              <ActivityHeatmap days={heatmap.days} theme={isDark ? 'dark' : 'light'} />

              <Text className="text-xs text-lantern-text-tertiary mt-2">Darker = more study activity</Text>

            </>

          )}

        </Card>



        {stats?.badges?.some(b => b.level > 0) ? (

          <CollapsibleSection
            id="badges"
            title="Badges"
            collapsedSummary={`${stats.badges.filter(b => b.level > 0).length} earned`}
          >

            <View className="flex-row flex-wrap gap-2">

              {stats.badges.filter(b => b.level > 0).slice(0, 12).map(badge => (

                <Card key={`badge-${badge.id}`} className="w-28 items-center py-3 px-2">

                  <Ionicons

                    name={(badge.icon as keyof typeof Ionicons.glyphMap) || 'ribbon'}

                    size={22}

                    color={badge.level > 0 ? colors.primary : colors.textTertiary}

                  />

                  <Text className="text-[10px] font-semibold text-lantern-text mt-1 text-center" numberOfLines={2}>

                    {badge.name}

                  </Text>

                  {badge.level > 0 ? (

                    <Text className="text-[9px] text-lantern-primary mt-0.5">Lv {badge.level}</Text>

                  ) : (

                    <Text className="text-[9px] text-lantern-text-tertiary mt-0.5">{badge.progress}%</Text>

                  )}

                </Card>

              ))}

            </View>

          </CollapsibleSection>

        ) : null}



        <CollapsibleSection
          id="recentTests"
          title="Recent tests"
          collapsedSummary={recentPageItems.length ? `${recentPageItems.length} shown` : undefined}
          headerRight={
            <View className="flex-row gap-1">
              {([
                { key: 'newest', label: 'New' },
                { key: 'oldest', label: 'Old' },
                { key: 'highestScore', label: 'Top' },
              ] as const).map((opt) => (
                <Pressable
                  key={opt.key}
                  onPress={() => setRecentSort(opt.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: recentSort === opt.key }}
                  accessibilityLabel={`Sort recent tests: ${opt.label}`}
                  className={`px-2 py-1 rounded-full ${
                    recentSort === opt.key ? 'bg-lantern-primary' : 'bg-lantern-background-secondary'
                  }`}
                >
                  <Text
                    className={`text-[10px] font-semibold ${
                      recentSort === opt.key ? 'text-white' : 'text-lantern-text-secondary'
                    }`}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          }
        >

          {recentLoading ? (
            <Text className="text-sm text-lantern-text-tertiary py-3">Loading tests…</Text>
          ) : recentPageItems.length > 0 ? (
            recentPageItems.map((test) => (
              <Pressable
                key={`${test.id}-${test.completedAt}`}
                onPress={() => void openDetailedAnalysis(test)}
                disabled={analysisLoadingId === test.id}
                className="mb-2 active:opacity-90"
              >
                <Card className="py-3">
                  <View className="flex-row items-center justify-between">
                    <View className="flex-1 min-w-0 pr-2">
                      <Text className="font-medium text-lantern-text" numberOfLines={1}>
                        {test.groupName}
                      </Text>
                      <Text className="text-xs text-lantern-text-secondary mt-0.5">
                        {analysisLoadingId === test.id
                          ? 'Loading analysis…'
                          : `${new Date(test.completedAt).toLocaleDateString()} · ${formatDuration(test.timeSpent)}`}
                      </Text>
                    </View>
                    <View
                      className={`px-2 py-1 rounded-full ${
                        test.percentage >= 80
                          ? 'bg-emerald-100 dark:bg-emerald-900/40'
                          : test.percentage >= 60
                            ? 'bg-amber-100 dark:bg-amber-900/40'
                            : 'bg-red-100 dark:bg-red-900/40'
                      }`}
                    >
                      <Text
                        className={`text-sm font-bold ${
                          test.percentage >= 80
                            ? 'text-emerald-700 dark:text-emerald-300'
                            : test.percentage >= 60
                              ? 'text-amber-700 dark:text-amber-300'
                              : 'text-red-700 dark:text-red-300'
                        }`}
                      >
                        {test.percentage}%
                      </Text>
                    </View>
                  </View>
                </Card>
              </Pressable>
            ))
          ) : (
            <Text className="text-sm text-lantern-text-tertiary py-3">
              No tests in this period yet.
            </Text>
          )}

          {recentTotal > RECENT_TESTS_PAGE_SIZE ? (
            <View className="flex-row items-center justify-between mt-2">
              <Pressable
                disabled={recentPage <= 1 || recentLoading}
                onPress={() => setRecentPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1.5 rounded-lg border border-lantern-border"
                style={{ opacity: recentPage <= 1 ? 0.4 : 1 }}
              >
                <Text className="text-xs font-semibold text-lantern-text">Previous</Text>
              </Pressable>
              <Text className="text-[11px] text-lantern-text-tertiary">
                Page {recentPage} of {recentTotalPages}
              </Text>
              <Pressable
                disabled={recentPage >= recentTotalPages || recentLoading}
                onPress={() => setRecentPage((p) => p + 1)}
                className="px-3 py-1.5 rounded-lg border border-lantern-border"
                style={{ opacity: recentPage >= recentTotalPages ? 0.4 : 1 }}
              >
                <Text className="text-xs font-semibold text-lantern-text">Next</Text>
              </Pressable>
            </View>
          ) : null}
        </CollapsibleSection>

        <GroupPerformanceChartCard groups={groups} testResults={leanTestResults} />

        <DashboardInsights stats={stats} />



        <View className="flex-row gap-3 mb-4">

          <Card className="flex-1 items-center py-4">

            <Text className="text-2xl font-bold text-lantern-primary">{dueCount}</Text>

            <Text className="text-xs text-lantern-text-secondary mt-1">Due cards</Text>

          </Card>

          <Card className="flex-1 items-center py-4">

            <Text className="text-2xl font-bold text-lantern-accent">{groups.length}</Text>

            <Text className="text-xs text-lantern-text-secondary mt-1">Groups</Text>

          </Card>

        </View>



        <Pressable

          onPress={handleQuickTest}

          className="flex-row items-center gap-3 bg-amber-500 rounded-2xl p-4 mb-4 active:opacity-90"

        >

          <View className="w-10 h-10 rounded-xl bg-white/20 items-center justify-center">

            <Ionicons name="flash" size={22} color="#fff" />

          </View>

          <View className="flex-1">

            <Text className="font-semibold text-white">Quick Test</Text>

            <Text className="text-xs text-white/80">

              {availableGroups.length > 0 ? 'Pick a group & practice' : 'Go to tests'}

            </Text>

          </View>

          <Ionicons name="chevron-forward" size={18} color="#fff" />

        </Pressable>



        <Pressable
          onPress={() => navigation.navigate('Leaderboard')}
          className="flex-row items-center gap-3 bg-lantern-surface border border-lantern-border rounded-2xl p-4 mb-4 active:opacity-80"
          accessibilityRole="button"
          accessibilityLabel="Open leaderboard"
        >
          <View className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 items-center justify-center">
            <Ionicons name="trophy" size={20} color="#f59e0b" />
          </View>
          <View className="flex-1">
            <Text className="font-semibold text-lantern-text">Leaderboard</Text>
            <Text className="text-xs text-lantern-text-secondary">See how you rank against other students</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
        </Pressable>



        <CollapsibleSection
          id="dailyQuiz"
          title="Daily quiz"
          collapsedSummary={
            todayQuiz?.completed
              ? 'Done today'
              : todayQuiz
                ? `${Object.keys(todayQuiz.answers || {}).length}/${todayQuiz.questions.length} answered`
                : undefined
          }
        >
        <DailyQuizWidget
          studyGoal={studyGoal}
          dailyQuiz={todayQuiz}
          progress={dailyQuizProgress}
          loading={quizLoading}
          noteOptions={quizNoteOptions}
          onStudyGoalChange={setStudyGoal}
          onStartQuiz={(noteId) => void startQuiz(noteId)}
          onAnswer={answerDailyQuestion}
          onComplete={completeDailyQuiz}
        />
        </CollapsibleSection>

        <Text className="text-sm font-semibold text-lantern-text mb-2">Quick actions</Text>

        <DashboardQuickLinks
          links={[
            {
              id: 'flashcards',
              label: 'Flashcards',
              icon: 'layers',
              iconColor: '#059669',
              badge: dueCount,
              onPress: () => parent?.navigate('StudyTab', { screen: 'Library', params: { tab: 'flashcards' } }),
            },
            {
              id: 'notes',
              label: 'Notes',
              icon: 'document-text',
              iconColor: featureAccents.library,
              onPress: () => parent?.navigate('StudyTab', { screen: 'Library', params: { tab: 'notes' } }),
            },
            {
              id: 'tests',
              label: 'Tests',
              icon: 'help-circle',
              iconColor: '#d97706',
              onPress: () => parent?.navigate('StudyTab', { screen: 'TestsList' }),
            },
            {
              id: 'marketplace',
              label: 'Explore',
              icon: 'bag',
              iconColor: featureAccents.marketplace,
              onPress: () => parent?.navigate('MarketTab'),
            },
          ]}
        />

      </ScrollView>



      <ImportAndStudyModal
        visible={importOpen}
        onClose={() => setImportOpen(false)}
        onOpenNote={(noteId) => {
          setImportOpen(false);
          parent?.navigate('StudyTab', { screen: 'NoteEditor', params: { noteId } });
        }}
        onTurnIntoStudyProduct={(result) => {
          setImportOpen(false);
          parent?.navigate('MarketTab', {
            screen: 'StudyProductDrafts',
            params: { source: { noteIds: [result.noteId], title: result.noteTitle } },
          });
        }}
      />

      <Modal visible={groupPickerOpen} transparent animationType="fade" onRequestClose={() => setGroupPickerOpen(false)}>

        <Pressable className="flex-1 bg-black/40 justify-center px-6" onPress={() => setGroupPickerOpen(false)}>

          <Pressable
            onPress={e => e.stopPropagation?.()}
            accessibilityViewIsModal
            accessibilityLabel="Pick a group"
            className="bg-lantern-surface rounded-2xl p-4 border border-lantern-border"
          >

            <Text className="text-lg font-bold text-lantern-text mb-3" accessibilityRole="header">Pick a group</Text>

            {availableGroups.map(g => (

              <Pressable

                key={g.id}

                onPress={() => handleGroupPick(g.id, g.name)}

                className="py-3 border-b border-lantern-border"

              >

                <Text className="text-lantern-text font-medium">{g.name}</Text>

              </Pressable>

            ))}

            <Button

              variant="secondary"

              className="mt-3"

              onPress={() => {

                setGroupPickerOpen(false);

                parent?.navigate('StudyTab', { screen: 'TestsList' });

              }}

            >

              All tests instead

            </Button>

          </Pressable>

        </Pressable>

      </Modal>



    </SafeAreaView>

  );

}


