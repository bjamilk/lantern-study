import React, { useCallback, useEffect, useMemo, useState } from 'react';

import {

  Modal,

  Pressable,

  RefreshControl,

  ScrollView,

  Text,

  View,

} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';


import { CompositeScreenProps, useFocusEffect } from '@react-navigation/native';

import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';

import { useAuthStore } from '../../stores/authStore';

import { useFlashcardStore } from '../../stores/flashcardStore';

import { useGroupStore } from '../../stores/groupStore';
import { useBudgetStore } from '../../stores/budgetStore';

import {
  useStatsStore,
  type DashboardStats,
  type TimePeriod,
  type RecentTest,
} from '../../stores/statsStore';

import { useStudyGoalsStore } from '../../stores/studyGoalsStore';
import { useSettingsStore } from '../../stores/settingsStore';

import { useNotesStore } from '../../stores/notesStore';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { useScreenBottomPadding } from '../../components/layout';
import { useChrome } from '../../components/layout/ChromeContext';
import { useTestStore } from '../../stores/testStore';

import { Card, Button, FeatureRow, FeatureTile, T } from '../../components/ui';

import { DashboardHeroCard } from '../../components/dashboard/DashboardHeroCard';

import { DashboardQuickLinks } from '../../components/dashboard/DashboardQuickLinks';
import { GettingStartedChecklist } from '../../components/dashboard/GettingStartedChecklist';
import { DashboardInsights } from '../../components/dashboard/DashboardInsights';
import { GroupPerformanceChartCard } from '../../components/dashboard/GroupPerformanceChartCard';
import { AIStudyCoachCard } from '../../components/dashboard/AIStudyCoachCard';
import { CourseReadinessCard } from '../../components/dashboard/CourseReadinessCard';
import { JoinClassCard } from '../../components/classes/JoinClassCard';
import { ClassWorkCard } from '../../components/classes/ClassWorkCard';
import { useCompanionStore } from '../../stores/companionStore';
import * as api from '../../services/api';
import { refreshUserData } from '../../services/dataRefresh';

import { DailyQuestsWidget } from '../../components/DailyQuestsWidget';

import { DailyQuizWidget } from '../../components/DailyQuizWidget';
import ImportAndStudyModal from '../../components/ImportAndStudyModal';
import { InFlightJobsCard } from '../../components/jobs';
import { CollapsibleSection } from '../../components/CollapsibleSection';
import { DailyGoalsProgress } from '../../components/DailyGoalsProgress';

import { fetchDailyQuests, recordLoginStreak, purchaseStreakFreeze, type DailyQuest } from '../../services/gamification';
import { WALLET_COINS } from '@lantern/shared/utils';
import {
  resolveSavedSessions,
  savedSessionSubtitle,
  savedSessionsOverflowLabel,
} from '@lantern/shared/utils';
import { isCardDue } from '@lantern/shared/utils/srs';
import { formatDisplayDate } from '@lantern/shared/utils/displayDate';
import { isQuizzableNote } from '@lantern/shared/utils/noteStudyContent';
import { useToastStore } from '../../stores/toastStore';

import { HomeStackParamList, MainTabParamList } from '../../navigation/types';
import {
  classifyRequestFailure,
  lastSyncedLabel,
  STALE_PROGRESS_COPY,
  UNAVAILABLE_PROGRESS_COPY,
} from '@lantern/shared/network';
import {
  resolveProgressDisplay,
  statsHaveSignal,
  type LastGoodStats,
} from './dashboardProgressState';
import { featureAccents } from '@lantern/shared/design';
import { buildActivityHeatmapGrid, getActivityHeatHexColorForCount, getActivityHeatHexColor, computeStudyStreak, getDashboardFirstName, type ActivityHeatLevel } from '@lantern/shared/utils';

import { useTheme } from '../../theme';
import { RequestError } from '../../components/RequestError';
import { AppIcon, isAppIconName } from '../../components/ui/AppIcon';



import { toTab } from '../../navigation/nestedTab';
import { recorderDoorPrompt, shouldCreateLectureNote } from '../study/recorderDoor';
import { confirmSheet } from '../../stores/confirmStore';
import { tabularNums } from '../../design/typeScale';
import { readWorkspaceRecents } from '../../utils/workspaceRecents';
import { getMyActiveCourses } from '../../services/academic';
import { courseWorkspaceLabel } from '@lantern/shared';
import type { UserCourse } from '@lantern/shared/types';
import type { WorkspaceRecent } from '@lantern/shared';

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

/**
 * "We could not reach Lantern", as opposed to "Lantern said no".
 *
 * Only these three kinds may demote the dashboard to its last-synced numbers.
 * A 403 or a 404 is an answer, and an answer is allowed to be believed.
 */
function isUnreachable(error: unknown): boolean {
  const kind = classifyRequestFailure(error);
  return kind === 'offline' || kind === 'timeout' || kind === 'server';
}



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

  const { notes, loadNotes, createNote } = useNotesStore();

  const { stats, leanTestResults, selectedPeriod, isLoading: statsLoading, error: statsError, fetchStats, setSelectedPeriod } = useStatsStore();
  /**
   * The stats store's own verdict on its last refresh. This is now the primary
   * signal: the store counts how many of its remote sources never reached
   * Lantern and, when they didn't, keeps the snapshot it already had instead
   * of replacing it with the zeros it can always assemble locally.
   */
  const statsSyncFailed = useStatsStore(s => s.syncFailed);
  const statsLastSyncedAt = useStatsStore(s => s.lastSyncedAt);

  const activeTest = useTestStore(s => s.activeTest);
  const rawPausedSessions = useTestStore(s => s.pausedSessions);
  const refreshPausedSessions = useTestStore(s => s.refreshPausedSessions);
  const resumePausedSession = useTestStore(s => s.resumePausedSession);
  const abandonPausedSession = useTestStore(s => s.abandonPausedSession);
  // Eight rows reading "Test · SDOH · 0 of 5 answered" are not eight things to
  // resume. The shared rule collapses blank duplicates, drops blank drafts
  // nobody came back to, and caps what Home draws — it never touches a session
  // that holds answers.
  const savedSessions = useMemo(() => resolveSavedSessions(rawPausedSessions), [rawPausedSessions]);
  const pausedSessions = savedSessions.sessions;
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

  /**
   * Every pull bumps this, and the readiness card reloads on the change. That
   * card owns its own fetch (it is the only thing on Home that calls
   * `fetchCourseReadiness`), so `load()` below cannot reach it — which is why
   * a failed readiness load used to survive every pull on this screen.
   */
  const [readinessReloadToken, setReadinessReloadToken] = useState(0);

  const [quests, setQuests] = useState<DailyQuest[]>([]);

  /**
   * The screen's own corroborating signal: the two gamification calls in
   * `load` below throw when the device cannot reach Lantern. It is NOT read
   * off `statsError`, because a refresh with no network does not fail loudly —
   * it records no error at all.
   */
  const [sideCallsFailed, setSideCallsFailed] = useState(false);

  /** Either witness is enough to stop Home claiming the numbers are current. */
  const syncFailed = statsSyncFailed || sideCallsFailed;

  /** The last snapshot we know actually came back from the server. */
  const [lastGood, setLastGood] = useState<LastGoodStats<DashboardStats> | null>(null);

  const [serverStreak, setServerStreak] = useState(0);

  const [streakFreezes, setStreakFreezes] = useState(0);

  const [purchasingFreeze, setPurchasingFreeze] = useState(false);

  const [quizLoading, setQuizLoading] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [openingRecorder, setOpeningRecorder] = useState(false);
  const [workspaceRecents, setWorkspaceRecents] = useState<WorkspaceRecent[]>([]);
  const [workspaceCourses, setWorkspaceCourses] = useState<UserCourse[]>([]);

  const [analysisLoadingId, setAnalysisLoadingId] = useState<string | null>(null);
  const [recentSort, setRecentSort] = useState<'newest' | 'oldest' | 'highestScore'>('newest');
  const [recentPage, setRecentPage] = useState(1);
  const [recentPageItems, setRecentPageItems] = useState<RecentTest[]>([]);
  const [recentTotal, setRecentTotal] = useState(0);
  const [recentLoading, setRecentLoading] = useState(false);
  // Whatever the last page load threw. Kept so the section can say "we
  // couldn't load these" instead of "no tests in this period yet" — the second
  // is a claim about the student's history that a failed request cannot make.
  const [recentError, setRecentError] = useState<unknown>(null);
  const [recentReload, setRecentReload] = useState(0);

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

  // Empty, not 'Student', while the profile has not resolved: the auth
  // listener sets `user` first and fills the name in a beat later (or the
  // profile fetch failed), and a cold start greeted a real account as
  // "Good morning, Student". The card drops the name until it knows one.
  const displayName = useMemo(
    () =>
      getDashboardFirstName(
        {
          firstName: profileFirstName || (user?.user_metadata?.first_name as string | undefined),
          name: profileName || (user?.user_metadata?.name as string | undefined),
          username: user?.user_metadata?.username as string | undefined,
        },
        ''
      ),
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
        setRecentError(null);
      } catch (error) {
        // Rows already on screen stay: a failed page tells us nothing about
        // the tests we were already showing.
        if (!cancelled) setRecentError(error);
      } finally {
        if (!cancelled) setRecentLoading(false);
      }
    };
    void loadRecent();
    return () => {
      cancelled = true;
    };
  }, [user?.id, recentPage, recentSort, recentPeriodBounds.from, recentPeriodBounds.to, groups, recentReload]);

  const recentTotalPages = Math.max(1, Math.ceil(recentTotal / RECENT_TESTS_PAGE_SIZE));

  // Remember every snapshot that carries real work AND arrived while we could
  // reach Lantern. This is what the screen falls back to, so it must never be
  // filled from a refresh that failed.
  useEffect(() => {
    if (syncFailed) return;
    if (stats && statsHaveSignal(stats)) {
      setLastGood({ stats, at: statsLastSyncedAt ?? Date.now() });
    }
  }, [stats, syncFailed, statsLastSyncedAt]);

  /**
   * The single decision about what Home may claim. `shownStats` is what the
   * whole screen renders from below — never `stats` directly — so one branch
   * cannot show live numbers while its neighbour shows offline zeros.
   */
  const progress = resolveProgressDisplay({ live: stats, lastGood, syncFailed });
  const shownStats = progress.stats;
  const progressKnown = progress.mode !== 'unavailable';
  // Nothing has come back yet — neither the cache nor the server — and the
  // refresh has not failed either. That is "not loaded", not "zero": a cold
  // start used to print "0d streak · 0 pts" for the beat before hydration.
  const progressPending = progressKnown && shownStats == null;

  const heatmap = useMemo(

    () => buildActivityHeatmapGrid(shownStats?.activityDays || []),

    [shownStats?.activityDays]

  );



  const load = async () => {

    if (!user?.id) return;

    await Promise.all([

      fetchDecks(user.id),

      fetchGroups(user.id),

      loadNotes().catch(() => {}),

      fetchStats(user.id, selectedPeriod).catch(() => {}),

    ]);

    // Two live calls, two verdicts. `reached` means Lantern answered at least
    // once; `unreachable` means at least one call could not get there. Only
    // "nothing got through" demotes the dashboard — a single flaky endpoint
    // must not blank numbers the other call just proved are current.
    let reached = false;
    let unreachable = false;

    try {

      const streakRes = await recordLoginStreak();

      reached = true;

      setServerStreak(
        streakRes?.current_streak ?? streakRes?.currentStreak ?? streakRes?.current ?? stats?.currentStreak ?? 0
      );

      setStreakFreezes(streakRes?.streak_freezes ?? streakRes?.streakFreezes ?? 0);

    } catch (error) {

      if (isUnreachable(error)) unreachable = true;

      setServerStreak(stats?.currentStreak ?? 0);

    }

    try {

      const q = await fetchDailyQuests();

      reached = true;

      setQuests(q);

    } catch (error) {

      if (isUnreachable(error)) unreachable = true;

      // Keep yesterday's quests rather than emptying the widget out of
      // existence: the last list we were given is still the last true one.

    }

    setSideCallsFailed(unreachable && !reached);

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
      void readWorkspaceRecents().then(setWorkspaceRecents);
      void getMyActiveCourses().then(setWorkspaceCourses).catch(() => undefined);
    }, [user?.id, selectedPeriod, fetchStats])
  );

  const onRefresh = async () => {

    setRefreshing(true);

    setReadinessReloadToken((n) => n + 1);

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

  /**
   * The Record door. Recording has no screen of its own — a lecture is
   * recorded INTO a note — so this lands on the editor with its mic in reach.
   *
   * It ASKS first. Creating the note on the tap itself meant every mis-tap and
   * every curious first tap left an empty "Lecture — 6 Sep" in the library
   * (D4); nothing is written until the student says yes, and when they do the
   * editor opens with the recorder already running, so the note that lands has
   * a recording in it. The prompt is planned in recorderDoor.ts, where it is
   * unit-tested.
   */
  const openRecorder = async () => {
    if (openingRecorder) return;
    // Held for the whole flow, prompt included: a second tap while the sheet
    // is up would otherwise stack two prompts and create two notes.
    setOpeningRecorder(true);
    try {
      const prompt = recorderDoorPrompt();
      const confirmed = await confirmSheet({
        title: prompt.title,
        message: prompt.message,
        confirmLabel: prompt.confirmLabel,
        cancelLabel: prompt.cancelLabel,
      });
      if (!shouldCreateLectureNote(confirmed)) return;
      const note = await createNote({ title: prompt.noteTitle, body: '' });
      parent?.navigate(
        'StudyTab',
        toTab('NoteEditor', { noteId: note.id, startRecording: true })
      );
    } catch {
      useToastStore
        .getState()
        .showToast('Could not start a lecture note. Check your connection and try again.', 'error');
    } finally {
      setOpeningRecorder(false);
    }
  };

  const { isDark, colors } = useTheme();

  const studyActivityStreak = useMemo(
    () => computeStudyStreak(shownStats?.activityDays ?? []).current,
    [shownStats?.activityDays]
  );
  // `serverStreak` is 0 when the streak call could not get through, so it only
  // takes part while we have something real to compare it against.
  const streak = progressKnown
    ? Math.max(serverStreak, studyActivityStreak, shownStats?.currentStreak || 0)
    : 0;

  const level = shownStats?.userLevel;



  const handlePeriodChange = (period: TimePeriod) => {

    setSelectedPeriod(period);

  };



  /**
   * Home's Test door.
   *
   * It used to open a "Pick a group" sheet — or jump straight into a group
   * chat when there was exactly one — because a group was the only place a
   * test was authored. That is no longer true, and it never made sense from
   * Home: pressing "Test" landed the student in a conversation. The door now
   * opens the Tests list, where History, Available Tests and "+ New test"
   * (which offers a deck, a note, or the group) all live.
   */
  const handleQuickTest = () => {
    parent?.navigate('StudyTab', toTab('TestsList'));
  };

  const handleResumeTest = () => {

    if (!activeTest) return;

    parent?.navigate('StudyTab', toTab('TestTaking', {

      testId: activeTest.test.id,

      testName: activeTest.test.name,

      mode: activeTest.mode,

    }));

  };

  React.useEffect(() => {
    void refreshPausedSessions();
  }, [refreshPausedSessions, user?.id]);

  const handleResumePaused = async (sessionId: string) => {
    try {
      await resumePausedSession(sessionId);
      const resumed = useTestStore.getState().activeTest;
      if (!resumed) return;
      parent?.navigate('StudyTab', toTab('TestTaking', {
        testId: resumed.test.id,
        testName: resumed.test.name,
        mode: resumed.mode,
      }));
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
        refreshControl={
          /* Themed, not platform-default: the stock spinner is white on both
             platforms, which vanished into the dark surface and dragged a
             white puck across the greeting (device pass on build 159, D8).
             `tintColor` is iOS, `colors`/`progressBackgroundColor` Android. */
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primaryText}
            colors={[colors.primaryText]}
            progressBackgroundColor={colors.surface}
          />
        }
        showsVerticalScrollIndicator={false}
      >

        {/* CARD 1 — the greeting. Neutral, one amber chip, no button of its
            own: the doors below are the action, and a hero CTA plus a Review
            tile was the same tap offered twice. */}
        <DashboardHeroCard
          userName={displayName}
          streak={streak}
          points={shownStats?.totalPoints ?? 0}
          dueCount={dueCount}
          totalTests={shownStats?.totalTestsTaken ?? 0}
          level={level}
          // Offline with nothing real cached: the card drops the figures and
          // says why, instead of drawing "LEVEL 1 Newcomer · 0 XP".
          progressKnown={progressKnown}
          progressPending={progressPending}
          progressNote={
            progress.mode === 'stale' ? lastSyncedLabel(progress.syncedAt) : undefined
          }
        />

        {/* CARD 2 — the screen's ONE tint panel, in the tests family's sky.
            Spec §5.7: the single coloured thing above the fold answers "am I
            ready", and it keeps its honest empty and failed states. */}
        <CourseReadinessCard reloadToken={readinessReloadToken} />

        <JoinClassCard />
        <ClassWorkCard />

        {workspaceRecents.length > 0 ? (
          <Card className="mb-3">
            <T.Caption tone="secondary" className="mb-1">
              Jump back in
            </T.Caption>
            {workspaceRecents.slice(0, 4).map((row, index) => {
              const course = workspaceCourses.find((c) => c.course.id === row.courseId)?.course;
              const label = course ? courseWorkspaceLabel(course) : 'Course';
              return (
                <View
                  key={row.courseId}
                  className={index > 0 ? 'border-t border-lantern-border' : undefined}
                >
                  <FeatureRow
                    feature="notes"
                    icon="library"
                    title={label}
                    subtitle="Open workspace"
                    onPress={() =>
                      parent?.navigate(
                        'StudyTab',
                        toTab('CourseRoom', { courseId: row.courseId, courseLabel: label })
                      )
                    }
                  />
                </View>
              );
            })}
          </Card>
        ) : null}

        {/* The four doors. Review is lime because it IS flashcards; the three
            siblings each carry their own feature hue, which is four hues on
            the screen and none of them repeated. Each also carries its own
            spot illustration (§5.6) — these are doors, which is the one place
            the imagery rule allows a picture. */}
        <View className="flex-row gap-3 mb-3">
          <FeatureTile
            feature="flashcards"
            icon="layers"
            title={dueCount > 0 ? 'Review' : 'Flashcards'}
            subtitle={dueCount > 0 ? 'Cards ready now' : 'Nothing due right now'}
            count={dueCount}
            countLabel={`${dueCount} due`}
            onPress={() => parent?.navigate('StudyTab', toTab('FlashcardsList'))}
            illustration="cards-fan"
            testID="home-tile-review"
          />
          <FeatureTile
            feature="notes"
            icon="cloud-upload"
            title="Import"
            subtitle="Paste material, get cards"
            onPress={() => setImportOpen(true)}
            illustration="import-tray"
            testID="home-tile-import"
          />
        </View>
        <View className="flex-row gap-3 mb-4">
          <FeatureTile
            feature="recording"
            icon="mic"
            title="Record"
            subtitle="Capture a lecture"
            onPress={() => void openRecorder()}
            illustration="mic-wave"
            testID="home-tile-record"
          />
          <FeatureTile
            feature="tests"
            icon="clipboard"
            title="Test"
            subtitle="Practise under time"
            onPress={() => parent?.navigate('StudyTab', toTab('TestsList'))}
            illustration="test-sheet"
            testID="home-tile-test"
          />
        </View>

        <GettingStartedChecklist
          hasDecks={decks.length > 0}
          hasTests={(shownStats?.totalTestsTaken ?? 0) > 0}
          hasGroups={groups.length > 0}
          hasBudget={Boolean(budget?.monthlyLimit && budget.monthlyLimit > 0) || transactions.length > 0}
          hasTriedCompanion={companionOpen}
          onCreateDeck={() => parent?.navigate('StudyTab', toTab('Library', { tab: 'flashcards' }))}
          onTakeTest={() => parent?.navigate('StudyTab', toTab('TestsList'))}
          onJoinGroup={() => parent?.navigate('ChatTab')}
          onSetBudget={() => parent?.navigate('BudgetTab')}
          onOpenLibrary={() => parent?.navigate('StudyTab', toTab('Library'))}
          onTryCompanion={() => openCompanion()}
          onSubmitQuestion={() => parent?.navigate('ChatTab')}
          onExploreMarketplace={() => parent?.navigate('MarketTab')}
          onTryOffline={() => {
            const root = parent?.getParent?.() ?? parent;
            (root as { navigate?: (name: string) => void } | undefined)?.navigate?.('Offline');
          }}
        />

        {/* Wave G: everything the AI is making, or just made, in one place —
            the in-app half of the delivery promise, for when a notification is
            denied, missed or swiped away. Renders nothing when idle. */}
        <InFlightJobsCard />

        {pausedSessions.length > 0 ? (
          // A NEUTRAL card. The whole thing used to be an amber panel, which
          // spent a saturated state colour on a list of ordinary work in
          // progress. The hue that matters is per-ROW — sky for a paused test,
          // lime for a paused study run — and it is carried by the disc.
          <Card className="mb-4">
            <Text className="text-caption font-semibold text-lantern-text-secondary mb-1">
              Saved sessions
            </Text>
            {pausedSessions.map((session, index) => (
              <View
                key={session.id}
                className={index > 0 ? 'border-t border-lantern-border' : undefined}
              >
                <FeatureRow
                  feature={session.sessionKind === 'study' ? 'flashcards' : 'tests'}
                  icon={session.sessionKind === 'study' ? 'layers' : 'clipboard'}
                  title={session.title}
                  subtitle={savedSessionSubtitle(session)}
                  onPress={() => void handleResumePaused(session.id)}
                  accessibilityLabel={`Resume ${session.title}, ${savedSessionSubtitle(session)}`}
                  right={
                    <View className="flex-row items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onPress={() => void abandonPausedSession(session.id)}
                        accessibilityLabel={`Discard ${session.title}`}
                      >
                        Discard
                      </Button>
                      <Button size="sm" onPress={() => void handleResumePaused(session.id)}>
                        Resume
                      </Button>
                    </View>
                  }
                />
              </View>
            ))}
            {savedSessions.hiddenCount > 0 ? (
              <Text className="text-caption text-lantern-text-tertiary mt-2">
                {savedSessionsOverflowLabel(savedSessions.hiddenCount)}
              </Text>
            ) : null}
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

                  ? 'bg-lantern-primary-fill'

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



        {/* One banner for "these numbers are not current", whichever way we
            found out: the stats store threw, or every live call failed to
            leave the device. It names which of the two states the figures
            below are in, so "last synced" is never mistaken for "now". */}
        {(statsError && !statsLoading) || progress.mode !== 'live' ? (
          <Card className="mb-4 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800">
            <View className="flex-row items-center gap-3">
              <AppIcon name="cloud-offline" size={20} color="#b45309" />
              <View className="flex-1">
                <Text className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                  {progress.mode === 'unavailable'
                    ? UNAVAILABLE_PROGRESS_COPY.title
                    : progress.mode === 'stale'
                      ? STALE_PROGRESS_COPY.title
                      : "Couldn't refresh your stats"}
                </Text>
                <Text className="text-xs text-amber-800/80 dark:text-amber-200/80 mt-0.5">
                  {progress.mode === 'unavailable'
                    ? UNAVAILABLE_PROGRESS_COPY.body
                    : progress.mode === 'stale'
                      ? `${STALE_PROGRESS_COPY.body} ${lastSyncedLabel(progress.syncedAt)}.`
                      : 'Showing your latest saved data.'}
                </Text>
              </View>
              <Button
                size="sm"
                variant="secondary"
                onPress={() => {
                  // The whole load, not just the stats call: `syncFailed` is
                  // only cleared by the live calls inside it succeeding, and
                  // `load` re-runs the stats fetch anyway.
                  void load();
                }}
              >
                Try again
              </Button>
            </View>
          </Card>
        ) : null}

        <DailyGoalsProgress
          study={studySettings}
          activityDays={shownStats?.activityDays ?? []}
        />



        {statsLoading && !shownStats ? (
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

            <Text className="text-2xl font-bold text-lantern-primary-text" style={tabularNums}>{shownStats?.totalTestsTaken ?? '—'}</Text>

            <Text className="text-xs text-lantern-text-secondary mt-1">Tests taken</Text>

          </Card>

          <Card className="flex-1 items-center py-3">

            <Text className="text-2xl font-bold text-lantern-accent" style={tabularNums}>

              {shownStats?.averageTimePerQuestion ? `${shownStats.averageTimePerQuestion}s` : '—'}

            </Text>

            <Text className="text-xs text-lantern-text-secondary mt-1">Avg / question</Text>

          </Card>

          <Card className="flex-1 items-center py-3">

            <View className="flex-row items-center gap-1">

              <AppIcon name="flame" size={16} color="#f97316" />

              <Text className="text-2xl font-bold text-emerald-600" style={tabularNums}>{progressKnown && !progressPending ? streak : '—'}</Text>

            </View>

            <Text className="text-xs text-lantern-text-secondary mt-1">Streak</Text>

          </Card>

        </View>
        )}



        <AIStudyCoachCard stats={shownStats} streak={streak} />

        {/* Quests, the heatmap and badges are the LOOKING-BACK half of Home,
            so they sit below the doors, the readiness panel and the stats —
            never above the one thing a student came here to do. */}
        <DailyQuestsWidget
          quests={quests}
          streak={streak}
          streakFreezes={streakFreezes}
          onPurchaseFreeze={() => void handlePurchaseFreeze()}
          purchasingFreeze={purchasingFreeze}
        />



        <Card className="mb-4">

          <Text className="text-sm font-semibold text-lantern-text mb-2">

            16-week activity

          </Text>

          {statsLoading && !shownStats ? (

            <Text className="text-xs text-lantern-text-tertiary">Loading activity...</Text>

          ) : (

            <>

              <ActivityHeatmap days={heatmap.days} theme={isDark ? 'dark' : 'light'} />

              <Text className="text-xs text-lantern-text-tertiary mt-2">Darker = more study activity</Text>

            </>

          )}

        </Card>



        {shownStats?.badges?.some(b => b.level > 0) ? (

          <CollapsibleSection
            id="badges"
            title="Badges"
            collapsedSummary={`${shownStats.badges.filter(b => b.level > 0).length} earned`}
          >

            <View className="flex-row flex-wrap gap-2">

              {shownStats.badges.filter(b => b.level > 0).slice(0, 12).map(badge => (

                <Card key={`badge-${badge.id}`} className="w-28 items-center py-3 px-2">

                  <AppIcon

                    name={isAppIconName(badge.icon) ? badge.icon : 'ribbon'}

                    size={22}

                    color={badge.level > 0 ? colors.primary : colors.textTertiary}

                  />

                  <Text className="text-label font-semibold text-lantern-text mt-1 text-center" numberOfLines={2}>

                    {badge.name}

                  </Text>

                  {badge.level > 0 ? (

                    <Text className="text-[11px] text-lantern-primary-text mt-0.5">Lv {badge.level}</Text>

                  ) : (

                    <Text className="text-[11px] text-lantern-text-tertiary mt-0.5">{badge.progress}%</Text>

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
                    recentSort === opt.key ? 'bg-lantern-primary-fill' : 'bg-lantern-background-secondary'
                  }`}
                >
                  <Text
                    className={`text-label font-semibold ${
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

          {recentError && recentPageItems.length === 0 ? (
            <RequestError
              error={recentError}
              variant="inline"
              onRetry={() => setRecentReload((n) => n + 1)}
            />
          ) : recentLoading ? (
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
                          : `${formatDisplayDate(test.completedAt)} · ${formatDuration(test.timeSpent)}`}
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

        <DashboardInsights stats={shownStats} />



        <View className="flex-row gap-3 mb-4">

          <Card className="flex-1 items-center py-4">

            <Text className="text-2xl font-bold text-lantern-primary-text" style={tabularNums}>{dueCount}</Text>

            <Text className="text-xs text-lantern-text-secondary mt-1">Due cards</Text>

          </Card>

          <Card className="flex-1 items-center py-4">

            <Text className="text-2xl font-bold text-lantern-accent" style={tabularNums}>{groups.length}</Text>

            <Text className="text-xs text-lantern-text-secondary mt-1">Groups</Text>

          </Card>

        </View>



        <Pressable

          onPress={handleQuickTest}

          className="flex-row items-center gap-3 bg-amber-500 rounded-2xl p-4 mb-4 active:opacity-90"

        >

          <View className="w-10 h-10 rounded-xl bg-white/20 items-center justify-center">

            <AppIcon name="flash" size={22} color="#fff" />

          </View>

          <View className="flex-1">

            <Text className="font-semibold text-white">Quick Test</Text>

            <Text className="text-xs text-white/80">

              Your tests, your scores, and a new one

            </Text>

          </View>

          <AppIcon name="chevron-forward" size={18} color="#fff" />

        </Pressable>



        <Pressable
          onPress={() => navigation.navigate('Leaderboard')}
          className="flex-row items-center gap-3 bg-lantern-surface border border-lantern-border rounded-2xl p-4 mb-4 active:opacity-80"
          accessibilityRole="button"
          accessibilityLabel="Open leaderboard"
        >
          <View className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 items-center justify-center">
            <AppIcon name="trophy" size={20} color="#f59e0b" />
          </View>
          <View className="flex-1">
            <Text className="font-semibold text-lantern-text">Leaderboard</Text>
            <Text className="text-xs text-lantern-text-secondary">See how you rank against other students</Text>
          </View>
          <AppIcon name="chevron-forward" size={18} color="#94a3b8" />
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
              onPress: () => parent?.navigate('StudyTab', toTab('Library', { tab: 'flashcards' })),
            },
            {
              id: 'notes',
              label: 'Notes',
              icon: 'document-text',
              iconColor: featureAccents.library,
              onPress: () => parent?.navigate('StudyTab', toTab('Library', { tab: 'notes' })),
            },
            {
              id: 'tests',
              label: 'Tests',
              icon: 'help-circle',
              iconColor: '#d97706',
              onPress: () => parent?.navigate('StudyTab', toTab('TestsList')),
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
          parent?.navigate('StudyTab', toTab('NoteEditor', { noteId }));
        }}
        onTurnIntoStudyProduct={(result) => {
          setImportOpen(false);
          parent?.navigate('MarketTab', toTab('StudyProductDrafts', { source: { noteIds: [result.noteId], title: result.noteTitle } }));
        }}
      />

    </SafeAreaView>

  );

}


