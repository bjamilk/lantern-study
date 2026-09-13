/**
 * Home — the shared spine, and nothing else.
 *
 * The SF2 mobile evidence counted 18 regions across 7 screens where StudyFetch
 * has 4 across 1.5, and Home was the worst of them: eighteen cards, of which
 * everything below the doors was telemetry about work already done. A student
 * opening the app to study scrolled past today's goals, three stat cards, a
 * coach, daily quests, a 16-week heatmap, badges, recent tests, a group chart,
 * insights, a due/groups pair, an off-palette amber "Quick Test" banner, a
 * leaderboard banner and an inline daily quiz before reaching anything they
 * could start.
 *
 * Home is now the eight regions `homeRegions()` in `@lantern/shared/dashboard`
 * returns, in that order, and the order is the SHARED one so the phone and the
 * browser cannot drift:
 *
 *   1 greeting · 2 your study sets · 3 recent materials · 4 recent activities
 *   5 upcoming exam (or readiness) · 6 quick actions · 7 your progress · 8 join a class
 *
 * Everything that left is still in the app. The looking-back half — goals,
 * quests, the quiz, badges, the heatmap, the stat cards, the coach, recent
 * tests, group performance, insights — is on the Progress screen
 * (`screens/me/MeProgressScreen`), which region 7's one card opens. The Quick
 * Test banner and the due/groups stat pair are gone rather than moved: "Create
 * a quiz" is one of the six doors, the due figure is the greeting's own
 * button, and a group count belongs to Chat.
 *
 * No amber. The `bg-amber-500` banner and the three amber panels were Tailwind
 * palette hexes (`#F59E0B`) that no token owned, so they were the same colour
 * in both themes and answered to nothing. What remains is flat cards and
 * feature tints.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CompositeScreenProps, useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';

import { useAuthStore } from '../../stores/authStore';
import { useFlashcardStore } from '../../stores/flashcardStore';
import { useStatsStore, type DashboardStats } from '../../stores/statsStore';
import { useNotesStore } from '../../stores/notesStore';
import { useTestStore } from '../../stores/testStore';
import { useCompanionStore } from '../../stores/companionStore';
import { useStudySetStore } from '../../stores/studySetStore';
import { useToastStore } from '../../stores/toastStore';

import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { useChrome } from '../../components/layout/ChromeContext';
import { Card, Button, FeatureRow, T } from '../../components/ui';

import { DashboardHeroCard } from '../../components/dashboard/DashboardHeroCard';
import { HomeStudySetsCard } from '../../components/dashboard/HomeStudySetsCard';
import { HomeQuickActions } from '../../components/dashboard/HomeQuickActions';
import { HomeRecentMaterials } from '../../components/dashboard/HomeRecentMaterials';
import { HomeRecentActivities } from '../../components/dashboard/HomeRecentActivities';
import { HomeUpcomingExam } from '../../components/dashboard/HomeUpcomingExam';
import { HomeProgressCard } from '../../components/dashboard/HomeProgressCard';
import { CourseReadinessCard } from '../../components/dashboard/CourseReadinessCard';
import { JoinClassCard } from '../../components/classes/JoinClassCard';
import { ClassWorkCard } from '../../components/classes/ClassWorkCard';
import ImportAndStudyModal from '../../components/ImportAndStudyModal';
import {
  nearestUpcomingExam,
  recentActivities,
  recentActivitiesFromResume,
  recentActivityRoute,
  resumeRouteForHref,
  type HomeQuickActionId,
  type RecentActivity,
} from '../../components/dashboard/homeSections';

import * as api from '../../services/api';
import { refreshUserData } from '../../services/dataRefresh';
import { fetchStudyResume } from '../../services/academic';
import { recordLoginStreak } from '../../services/gamification';

import { dueReviewPlan } from '@lantern/shared/learning';
import {
  emptyStudyResume,
  isCalendarNote,
  isLectureNote,
  notePreviewText,
  primaryHomeAction,
  type StudyResume,
  type StudyResumeMaterial,
} from '@lantern/shared/learning';
import { isCardDue } from '@lantern/shared/utils/srs';
import { todayDateOnlyLocal } from '@lantern/shared/utils/dateOnly';
import {
  resolveSavedSessions,
  savedSessionSubtitle,
  savedSessionsOverflowLabel,
} from '@lantern/shared/utils';
import { computeStudyStreak, getDashboardFirstName } from '@lantern/shared/utils';
import { classifyRequestFailure, lastSyncedLabel } from '@lantern/shared/network';

import {
  resolveProgressDisplay,
  statsHaveSignal,
  type LastGoodStats,
} from './dashboardProgressState';

import { HomeStackParamList, MainTabParamList } from '../../navigation/types';
import { toTab } from '../../navigation/nestedTab';
import { recorderDoorPrompt, shouldCreateLectureNote } from '../study/recorderDoor';
import { confirmSheet } from '../../stores/confirmStore';
import { useOnlineEffect } from '../../hooks';
import { useTheme } from '../../theme';

type Props = CompositeScreenProps<
  NativeStackScreenProps<HomeStackParamList, 'Dashboard'>,
  BottomTabScreenProps<MainTabParamList>
>;

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

export function DashboardScreen({ navigation }: Props) {
  const tabBarClearance = useTabBarClearance(24);
  const { onScroll: chromeOnScroll } = useChrome();
  const { colors } = useTheme();

  const user = useAuthStore((s) => s.user);
  const profileName = useAuthStore((s) => s.profileName);
  const profileFirstName = useAuthStore((s) => s.profileFirstName);

  const { decks, fetchDecks } = useFlashcardStore();
  const flashcardsByDeck = useFlashcardStore((s) => s.flashcards);

  const openCompanion = useCompanionStore((s) => s.open);
  const { notes, loadNotes, createNote } = useNotesStore();

  const { stats, selectedPeriod, fetchStats } = useStatsStore();
  /**
   * The stats store's own verdict on its last refresh. The store counts how
   * many of its remote sources never reached Lantern and, when they didn't,
   * keeps the snapshot it already had instead of replacing it with the zeros
   * it can always assemble locally.
   */
  const statsSyncFailed = useStatsStore((s) => s.syncFailed);
  const statsLastSyncedAt = useStatsStore((s) => s.lastSyncedAt);

  /* ── Region 4's resume rows: work that is literally still open ───────── */
  const activeTest = useTestStore((s) => s.activeTest);
  const rawPausedSessions = useTestStore((s) => s.pausedSessions);
  const refreshPausedSessions = useTestStore((s) => s.refreshPausedSessions);
  const resumePausedSession = useTestStore((s) => s.resumePausedSession);
  const abandonPausedSession = useTestStore((s) => s.abandonPausedSession);
  const pauseActiveTest = useTestStore((s) => s.pauseActiveTest);
  // Eight rows reading "Test · SDOH · 0 of 5 answered" are not eight things to
  // resume. The shared rule collapses blank duplicates, drops blank drafts
  // nobody came back to, and caps what Home draws — it never touches a session
  // that holds answers.
  const savedSessions = useMemo(() => resolveSavedSessions(rawPausedSessions), [rawPausedSessions]);
  const pausedSessions = savedSessions.sessions;

  const [refreshing, setRefreshing] = useState(false);
  /**
   * Every pull bumps this, and the readiness card reloads on the change. That
   * card owns its own fetch (it is the only thing on Home that calls
   * `fetchCourseReadiness`), so `load()` below cannot reach it — which is why
   * a failed readiness load used to survive every pull on this screen.
   */
  const [readinessReloadToken, setReadinessReloadToken] = useState(0);
  /**
   * The screen's own corroborating signal: the streak call in `load` below
   * throws when the device cannot reach Lantern. It is NOT read off
   * `statsError`, because a refresh with no network does not fail loudly — it
   * records no error at all.
   */
  const [sideCallsFailed, setSideCallsFailed] = useState(false);
  /** Either witness is enough to stop Home claiming the numbers are current. */
  const syncFailed = statsSyncFailed || sideCallsFailed;
  /** The last snapshot we know actually came back from the server. */
  const [lastGood, setLastGood] = useState<LastGoodStats<DashboardStats> | null>(null);
  const [serverStreak, setServerStreak] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [openingRecorder, setOpeningRecorder] = useState(false);
  /**
   * Home's resume feed — the same `GET /users/me/study-resume` web reads.
   *
   * Fetched HERE rather than inside each region, because the greeting's one
   * primary button, the "Recent materials" tiles and the "Recent activities"
   * rows are the same request: a fetch in each would re-ask three times on
   * every focus, and a "Continue" whose href came from a different round-trip
   * than the rows could point somewhere the rows do not show. It never rejects
   * (see services/academic.ts), so there is no failure branch to render — an
   * empty feed IS the offline answer.
   */
  const [resume, setResume] = useState<StudyResume>(() => emptyStudyResume());

  // Count over every loaded card rather than summing each deck's due_count.
  // enrichDecksWithStats only fills due_count for decks present in `decks`, so a
  // card whose deck is missing from that list contributes nothing — which made
  // two signed-in devices disagree (37 on iOS, 38 on Android) and both differ
  // from web, which counts a flat list. This matches web exactly.
  const dueCount = useMemo(
    () =>
      Object.values(flashcardsByDeck).reduce(
        (total, cards) => total + cards.filter((card) => isCardDue(card.srsData)).length,
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

  const load = useCallback(async () => {
    if (!user?.id) return;
    await Promise.all([
      fetchDecks(user.id),
      loadNotes().catch(() => {}),
      fetchStats(user.id, selectedPeriod).catch(() => {}),
    ]);

    // `reached` means Lantern answered; `unreachable` means the call could not
    // get there. Only "nothing got through" demotes the dashboard.
    let reached = false;
    let unreachable = false;
    try {
      const streakRes = await recordLoginStreak();
      reached = true;
      setServerStreak(
        streakRes?.current_streak ??
          streakRes?.currentStreak ??
          streakRes?.current ??
          stats?.currentStreak ??
          0
      );
    } catch (error) {
      if (isUnreachable(error)) unreachable = true;
      setServerStreak(stats?.currentStreak ?? 0);
    }
    setSideCallsFailed(unreachable && !reached);
  }, [user?.id, fetchDecks, loadNotes, fetchStats, selectedPeriod, stats?.currentStreak]);

  useEffect(() => {
    void load();
    // Mount and sign-in only: `load` changes identity on every stats tick, and
    // depending on it here would refetch the whole screen in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Home tab stays mounted; refetch on return from a test or a study session.
  useFocusEffect(
    useCallback(() => {
      if (!user?.id) return;
      void fetchStats(user.id, selectedPeriod, { force: true }).catch(() => {});
      // The hero's due count and the tab badges come from decks + notifications,
      // which bootstrap only loads once — refresh them so Home cannot keep
      // showing a stale "N due" or unread count.
      void refreshUserData(user.id, { only: ['flashcards', 'notifications'] });
      // On focus, not only on mount: the student may have just come back from
      // the very activity the greeting is about to offer to resume.
      void fetchStudyResume().then(setResume);
    }, [user?.id, selectedPeriod, fetchStats])
  );

  // The set list is the one Home section that used to sit out a pull-to-refresh
  // and only recover on a tab re-entry — it is not part of `load()`, so refresh
  // and reconnect have to ask it directly.
  useOnlineEffect(() => {
    void useStudySetStore.getState().notifyReconnected();
  }, []);

  useEffect(() => {
    void refreshPausedSessions();
  }, [refreshPausedSessions, user?.id]);

  const onRefresh = async () => {
    setRefreshing(true);
    setReadinessReloadToken((n) => n + 1);
    await Promise.all([
      load(),
      useStudySetStore
        .getState()
        .loadSets({ force: true })
        .catch(() => undefined),
      fetchStudyResume().then(setResume),
    ]);
    setRefreshing(false);
  };

  const parent = navigation.getParent();

  /**
   * The Record door. Recording has no screen of its own — a lecture is
   * recorded INTO a note — so this lands on the editor with its mic in reach.
   *
   * It ASKS first. Creating the note on the tap itself meant every mis-tap and
   * every curious first tap left an empty "Lecture — 6 Sep" in the library
   * (D4); nothing is written until the student says yes, and when they do the
   * editor opens with the recorder already running. The prompt is planned in
   * recorderDoor.ts, where it is unit-tested.
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
      parent?.navigate('StudyTab', toTab('NoteEditor', { noteId: note.id, startRecording: true }));
    } catch {
      useToastStore
        .getState()
        .showToast('Could not start a lecture note. Check your connection and try again.', 'error');
    } finally {
      setOpeningRecorder(false);
    }
  };

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

  /* ── Home's regions, in the shared spine's order ─────────────────────── */

  const studySets = useStudySetStore((s) => s.sets);
  const lastOpenedSetId = useStudySetStore((s) => s.lastOpenedId);

  /**
   * What "Study all N due" plans to review, by the one shared rule.
   *
   * `dueReviewPlan` is the same planner web runs, so the phone and the browser
   * can no longer pick different decks from the same cards. The phone opens the
   * first leg AND hands the route the rest of the queue, so the session chains
   * deck by deck and actually deals the N the button counted.
   */
  const reviewPlan = useMemo(
    () =>
      dueReviewPlan(
        decks.map((deck) => ({ id: deck.id, name: deck.name })),
        (deckId) => (flashcardsByDeck[deckId] ?? []).filter((card) => isCardDue(card.srsData))
      ),
    [flashcardsByDeck, decks]
  );
  /**
   * ONE button, whose label and destination come out of the same call.
   * `primaryHomeAction` is the shared rule — due cards beat a resume, a resume
   * beats an import — so a button that says "Continue" cannot land on the
   * import sheet.
   */
  const primaryAction = useMemo(
    () =>
      primaryHomeAction({
        dueCardsCount: dueCount,
        reviewPlan,
        lastActivity: resume.lastActivity,
      }),
    [dueCount, reviewPlan, resume.lastActivity]
  );

  /** A resume href is a web PATH; the phone navigates by screen and params. */
  const openResumeHref = useCallback(
    (href: string | null | undefined) => {
      const route = resumeRouteForHref(href);
      if (!route) {
        parent?.navigate('StudyTab', toTab('StudyHub'));
        return;
      }
      parent?.navigate('StudyTab', toTab(route.screen, route.params));
    },
    [parent]
  );

  const reviewDeck = reviewPlan.first;

  const handlePrimaryAction = useCallback(() => {
    if (primaryAction.kind === 'review') {
      // Nothing actually due (a stale count, or cards not loaded yet): the
      // list is the honest fallback, never a review screen with no cards.
      if (!reviewDeck) {
        parent?.navigate('StudyTab', toTab('FlashcardsList'));
        return;
      }
      parent?.navigate(
        'StudyTab',
        toTab('FlashcardReview', {
          deckId: reviewDeck.deckId,
          deckName: reviewDeck.deckName ?? undefined,
          // The whole queue, so the session continues into the next deck when
          // this one ends and the button's N is the N actually dealt.
          queueDeckIds: reviewPlan.legs.map((leg) => leg.deckId),
        })
      );
      return;
    }
    if (primaryAction.kind === 'continue') {
      openResumeHref(primaryAction.href);
      return;
    }
    setImportOpen(true);
  }, [primaryAction, parent, openResumeHref, reviewDeck, reviewPlan]);

  /**
   * The set a "last set's …" door opens. The set most recently opened, else
   * the first one loaded — a door that needs a set and has none falls back to
   * the hub rather than dead-ending.
   */
  const doorSetId = lastOpenedSetId ?? studySets[0]?.id ?? null;

  const upcomingExam = useMemo(
    () => nearestUpcomingExam(studySets, todayDateOnlyLocal()),
    [studySets]
  );

  /**
   * Region 3. The server's feed when it answered, else the notes we already
   * have. The fallback is the same rule web uses — filed notes that are not
   * the generated calendar note — so an offline Home still shows the things a
   * student was reading.
   */
  const recentMaterials = useMemo<StudyResumeMaterial[]>(() => {
    if (resume.recentMaterials.length > 0) return resume.recentMaterials;
    return notes
      .filter((note) => !isCalendarNote(note) && note.studySetId)
      .slice(0, 4)
      .map((note) => ({
        id: note.id,
        title: note.title || 'Untitled note',
        studySetId: note.studySetId || lastOpenedSetId || '',
        kind: isLectureNote(note) ? ('lecture' as const) : ('note' as const),
        href: note.id,
        preview: notePreviewText(note.body),
        updatedAt: note.updatedAt || '',
      }));
  }, [resume.recentMaterials, notes, lastOpenedSetId]);

  /**
   * Region 4. The server's resume rows in the shared row shape; when the feed
   * is empty (offline, or a brand-new account) the shared builder assembles
   * what the device itself can prove from the notes it holds. A deck cannot
   * contribute here: `Deck` carries no last-studied stamp, and the shared
   * builder drops any row without a real timestamp rather than invent one.
   */
  const activities = useMemo<RecentActivity[]>(() => {
    const fromServer = recentActivitiesFromResume(resume.recentActivities);
    if (fromServer.length > 0) return fromServer;
    return recentActivities({
      notes: notes.filter((note) => !isCalendarNote(note)).map((note) => ({
        id: note.id,
        title: note.title,
        setId: note.studySetId ?? null,
        lastOpenedAt: note.updatedAt ?? null,
        isLecture: isLectureNote(note),
      })),
    });
  }, [resume.recentActivities, notes]);

  const openMaterial = useCallback(
    (material: StudyResumeMaterial) => {
      parent?.navigate('StudyTab', toTab('NoteEditor', { noteId: material.id }));
    },
    [parent]
  );

  const openActivity = useCallback(
    (activity: RecentActivity) => {
      const route = recentActivityRoute(activity);
      // A companion row has no Study-stack screen; it opens the companion.
      if (!route) {
        openCompanion();
        return;
      }
      parent?.navigate('StudyTab', toTab(route.screen, route.params));
    },
    [parent, openCompanion]
  );

  /**
   * The six doors. Each one that needs a set opens THAT set's studio; with no
   * set yet there is nothing to open, so it falls back to the hub (or, for
   * Record a lecture, to the standalone recorder, which needs no set at all).
   */
  const quickActionHandlers: Partial<Record<HomeQuickActionId, () => void>> = {
    import: () => setImportOpen(true),
    createQuiz: () =>
      doorSetId
        ? parent?.navigate('StudyTab', toTab('AdaptiveQuiz', { studySetId: doorSetId }))
        : parent?.navigate('StudyTab', toTab('StudyHub')),
    askLantern: () => openCompanion(),
    tutor: () =>
      doorSetId
        ? parent?.navigate('StudyTab', toTab('LessonStudio', { studySetId: doorSetId }))
        : parent?.navigate('StudyTab', toTab('StudyHub')),
    recordLecture: () =>
      doorSetId
        ? parent?.navigate('StudyTab', toTab('LectureStudio', { studySetId: doorSetId }))
        : void openRecorder(),
    openStudy: () => parent?.navigate('StudyTab', toTab('StudyHub')),
  };

  const handleResumeTest = () => {
    if (!activeTest) return;
    parent?.navigate(
      'StudyTab',
      toTab('TestTaking', {
        testId: activeTest.test.id,
        testName: activeTest.test.name,
        mode: activeTest.mode,
      })
    );
  };

  const handleResumePaused = async (sessionId: string) => {
    try {
      await resumePausedSession(sessionId);
      const resumed = useTestStore.getState().activeTest;
      if (!resumed) return;
      parent?.navigate(
        'StudyTab',
        toTab('TestTaking', {
          testId: resumed.test.id,
          testName: resumed.test.name,
          mode: resumed.mode,
        })
      );
    } catch {
      // Refresh the list if the resume failed.
      void refreshPausedSessions();
    }
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
             white puck across the greeting (device pass on build 159, D8). */
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
        {/* 1 — GREETING. Web's ONE primary button: its label and its
            destination come from the same `primaryHomeAction` call, so
            "Study all 12 due" reviews, "Continue" resumes and "Import & study"
            imports. The word and the tap cannot disagree. */}
        <DashboardHeroCard
          userName={displayName}
          streak={streak}
          points={shownStats?.totalPoints ?? 0}
          // The hero's figure is the button's figure: the plan total, so the
          // card cannot print one number and open a session of another.
          dueCount={reviewPlan.totalDue}
          totalTests={shownStats?.totalTestsTaken ?? 0}
          level={level}
          // Offline with nothing real cached: the card drops the figures and
          // says why, instead of drawing "LEVEL 1 Newcomer · 0 XP". This is
          // also why the amber "couldn't refresh your stats" banner is gone —
          // the card that owns the figures says it itself.
          progressKnown={progressKnown}
          progressPending={progressPending}
          progressNote={
            progress.mode === 'stale' ? lastSyncedLabel(progress.syncedAt) : undefined
          }
          onPrimaryAction={handlePrimaryAction}
          primaryActionLabel={primaryAction.label}
        />

        {/* 2 — YOUR STUDY SETS. */}
        <HomeStudySetsCard
          onOpenSet={(studySetId, title) =>
            parent?.navigate('StudyTab', toTab('CourseRoom', { studySetId, courseLabel: title }))
          }
          onOpenHub={() => parent?.navigate('StudyTab', toTab('StudyHub'))}
          onNewSet={() => parent?.navigate('StudyTab', toTab('StudyHub'))}
        />

        {/* 3 — RECENT MATERIALS. */}
        <HomeRecentMaterials materials={recentMaterials} onOpenMaterial={openMaterial} />

        {/* 4 — RECENT ACTIVITIES. Work that is literally still open comes
            first — a paused test and a test in progress are the strongest
            "resume" there is, and they carry a Discard the feed cannot. The
            panel is a NEUTRAL card: the whole thing used to be amber, which
            spent a saturated state colour on ordinary work in progress. The
            hue that matters is per-ROW and is carried by the disc. */}
        {pausedSessions.length > 0 || activeTest ? (
          <Card className="mb-3">
            <T.Caption tone="secondary" className="mb-1">
              Still open
            </T.Caption>
            {activeTest ? (
              <FeatureRow
                feature="tests"
                icon="clipboard"
                title={activeTest.test.name}
                subtitle={`Question ${activeTest.currentQuestionIndex + 1} of ${activeTest.questions.length}`}
                onPress={handleResumeTest}
                accessibilityLabel={`Resume ${activeTest.test.name}`}
                right={
                  <View className="flex-row items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onPress={() => void pauseActiveTest()}
                      accessibilityLabel={`Pause ${activeTest.test.name}`}
                    >
                      Pause
                    </Button>
                    <Button size="sm" onPress={handleResumeTest}>
                      Resume
                    </Button>
                  </View>
                }
              />
            ) : null}
            {pausedSessions.map((session, index) => (
              <View
                key={session.id}
                className={
                  index > 0 || activeTest ? 'border-t border-lantern-border' : undefined
                }
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
              <T.Caption tone="tertiary" className="mt-2">
                {savedSessionsOverflowLabel(savedSessions.hiddenCount)}
              </T.Caption>
            ) : null}
          </Card>
        ) : null}

        <HomeRecentActivities activities={activities} onOpen={openActivity} />

        {/* 5 — UPCOMING EXAM. A set knows its own exam date, so that is what
            Home says. Only when no set names one does the readiness panel take
            the slot — it answers "am I ready", which is the useful thing to
            show a student who has not told us when the exam is. It is also the
            screen's ONE tint panel (spec §5.7). */}
        {upcomingExam ? (
          <HomeUpcomingExam
            exam={upcomingExam}
            onOpenSet={(studySetId) =>
              parent?.navigate('StudyTab', toTab('CourseRoom', { studySetId }))
            }
          />
        ) : (
          <CourseReadinessCard reloadToken={readinessReloadToken} />
        )}

        {/* 6 — QUICK ACTIONS: the six doors. */}
        <HomeQuickActions onAction={quickActionHandlers} />

        {/* 7 — YOUR PROGRESS: one card, one line, one chevron. The eleven
            looking-back regions that used to live below this point are behind
            it, on the Progress screen. */}
        <HomeProgressCard
          streak={streak}
          level={level}
          points={shownStats?.totalPoints ?? 0}
          known={progressKnown}
          pending={progressPending}
          onOpen={() => parent?.navigate('MeTab', toTab('MeProgress'))}
        />

        {/* 8 — JOIN A CLASS, and the work of the classes already joined: both
            are the same region's content, and `ClassWorkCard` draws nothing
            when there is none. */}
        <JoinClassCard />
        <ClassWorkCard />
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
          parent?.navigate(
            'MarketTab',
            toTab('StudyProductDrafts', {
              source: { noteIds: [result.noteId], title: result.noteTitle },
            })
          );
        }}
      />
    </SafeAreaView>
  );
}
