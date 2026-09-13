import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { normalizeUserSettings } from '@lantern/shared/settings';
import { isQuizzableNote } from '@lantern/shared/utils/noteStudyContent';
import { Card, T } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { useTheme } from '../../theme';
import { tabularNums } from '../../design/typeScale';
import { useAuthStore } from '../../stores/authStore';
import { useGroupStore } from '../../stores/groupStore';
import { useStatsStore } from '../../stores/statsStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useStudyGoalsStore } from '../../stores/studyGoalsStore';
import { useNotesStore } from '../../stores/notesStore';
import { useToastStore } from '../../stores/toastStore';
import {
  fetchDailyQuests,
  purchaseStreakFreeze,
  type DailyQuest,
} from '../../services/gamification';
import { DailyQuestsWidget } from '../DailyQuestsWidget';
import { DailyQuizWidget } from '../DailyQuizWidget';
import { DailyGoalsProgress } from '../DailyGoalsProgress';
import { ActivityHeatmap } from '../dashboard/ActivityHeatmap';
import { AIStudyCoachCard } from '../dashboard/AIStudyCoachCard';
import { DashboardInsights } from '../dashboard/DashboardInsights';
import { buildActivityHeatmapGrid, computeStudyStreak } from '@lantern/shared/utils';
import { AchievementsCard } from './AchievementsCard';
import { GroupPerformanceCard } from './GroupPerformanceCard';
import { RecentTestsCard } from './RecentTestsCard';

/**
 * The progress hub on Profile — the same widgets web shows on /me/progress.
 *
 * Points, today's goals, the three counters, the coach, daily quests, the
 * daily quiz, the 16-week heatmap, achievements, insights, group performance,
 * recent tests and the leaderboard. It reads stores Home already fills and
 * only starts a fetch when this screen opens first.
 *
 * The heatmap, the counters, the coach, insights and the leaderboard arrived
 * here when Home was cut back to its shared spine (SF2 · H2). Home had grown
 * eleven looking-back regions below its six doors; every one of them is still
 * in the app, and all of them are now on this screen, which is the one a
 * student opens to look back. Home's `Your progress` card is the door.
 */
export interface MeProgressProps {
  /** Supplied by the screen, which is the half that can navigate. */
  onOpenLeaderboard?: () => void;
}

export function MeProgress({ onOpenLeaderboard }: MeProgressProps = {}) {
  const { colors, isDark } = useTheme();
  const user = useAuthStore((s) => s.user);
  const groups = useGroupStore((s) => s.groups);
  const stats = useStatsStore((s) => s.stats);
  const leanTestResults = useStatsStore((s) => s.leanTestResults);
  const statsLoading = useStatsStore((s) => s.isLoading);
  const selectedPeriod = useStatsStore((s) => s.selectedPeriod);
  const fetchStats = useStatsStore((s) => s.fetchStats);
  const studySettings = useSettingsStore((s) => s.settings.study);
  const notes = useNotesStore((s) => s.notes);
  const loadNotes = useNotesStore((s) => s.loadNotes);
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

  const [quests, setQuests] = useState<DailyQuest[]>([]);
  const [questsLoaded, setQuestsLoaded] = useState(false);
  const [purchasingFreeze, setPurchasingFreeze] = useState(false);
  const [quizLoading, setQuizLoading] = useState(false);

  useEffect(() => {
    if (!user?.id || stats || statsLoading) return;
    void fetchStats(user.id, selectedPeriod);
  }, [user?.id, stats, statsLoading, selectedPeriod, fetchStats]);

  useEffect(() => {
    if (notes.length === 0) void loadNotes();
  }, [notes.length, loadNotes]);

  useEffect(() => {
    let alive = true;
    void fetchDailyQuests()
      .then((next) => {
        if (alive) setQuests(next);
      })
      .catch(() => {
        if (alive) setQuests([]);
      })
      .finally(() => {
        if (alive) setQuestsLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const todayQuiz = useMemo(() => {
    const quiz = getDailyQuizForToday() ?? dailyQuiz;
    if (!quiz || quiz.sourceNoteTitle || !quiz.noteId) return quiz;
    const note = notes.find((n) => n.id === quiz.noteId);
    return note
      ? { ...quiz, sourceNoteTitle: note.title?.trim() || 'Untitled note' }
      : quiz;
  }, [getDailyQuizForToday, dailyQuiz, notes]);

  const quizNoteOptions = useMemo(
    () =>
      notes.filter(isQuizzableNote).map((note) => ({
        id: note.id,
        title: note.title?.trim() || 'Untitled note',
      })),
    [notes],
  );

  const startQuiz = useCallback(
    async (noteId: string) => {
      const note = notes.find((n) => n.id === noteId);
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
    [notes, startDailyQuizFromContent, setDailyQuiz],
  );

  const handlePurchaseFreeze = useCallback(async () => {
    if (purchasingFreeze) return;
    setPurchasingFreeze(true);
    try {
      await purchaseStreakFreeze();
      useToastStore.getState().showToast('Streak freeze purchased.', 'success');
    } catch (error: unknown) {
      useToastStore
        .getState()
        .showToast(error instanceof Error ? error.message : 'Could not purchase streak freeze.', 'error');
    } finally {
      setPurchasingFreeze(false);
    }
  }, [purchasingFreeze]);

  const activityDays = stats?.activityDays ?? [];
  const study = normalizeUserSettings({ study: studySettings }).study;
  const heatmap = useMemo(() => buildActivityHeatmapGrid(activityDays), [activityDays]);
  // The coach's streak, by the same rule Home's greeting uses: whichever of
  // the server's count and the activity days is longer.
  const streak = useMemo(
    () => Math.max(computeStudyStreak(activityDays).current, stats?.currentStreak ?? 0),
    [activityDays, stats?.currentStreak]
  );

  return (
    <View className="px-4 pt-4">
      <T.Heading>Progress</T.Heading>
      <T.Caption tone="secondary" className="mt-0.5 mb-3">
        Goals, quests and your test history.
      </T.Caption>

      <Card className="mb-4">
        <View className="flex-row items-center gap-3">
          <AppIcon name="sparkles" size={22} color={colors.warning} />
          <View className="flex-1 min-w-0">
            <T.Body className="font-semibold">Points</T.Body>
            <T.Caption tone="secondary">
              {stats?.userLevel
                ? `Level ${stats.userLevel.level} · ${stats.userLevel.name}`
                : statsLoading
                  ? 'Loading your total…'
                  : 'Earned from quests, tests and study streaks'}
            </T.Caption>
          </View>
          <T.Title tabular accessibilityLabel={`${stats?.totalPoints ?? 0} points`}>
            {(stats?.totalPoints ?? 0).toLocaleString()}
          </T.Title>
        </View>
        {stats?.currentStreak ? (
          <T.Caption tone="secondary" className="mt-2" style={tabularNums}>
            {stats.currentStreak} day streak · longest {stats.longestStreak}
          </T.Caption>
        ) : null}
      </Card>

      {/* The three counters that used to sit mid-Home. Flat cards, no amber:
          the streak's flame takes the warning token rather than a Tailwind
          orange hex that no theme owned. */}
      <View className="flex-row gap-3 mb-4">
        <Card className="flex-1 items-center py-3">
          <T.Title tabular>{stats?.totalTestsTaken ?? '—'}</T.Title>
          <T.Caption tone="secondary" className="mt-1">
            Tests taken
          </T.Caption>
        </Card>
        <Card className="flex-1 items-center py-3">
          <T.Title tabular>
            {stats?.averageTimePerQuestion ? `${stats.averageTimePerQuestion}s` : '—'}
          </T.Title>
          <T.Caption tone="secondary" className="mt-1">
            Avg / question
          </T.Caption>
        </Card>
        <Card className="flex-1 items-center py-3">
          <View className="flex-row items-center gap-1">
            <AppIcon name="flame" size={16} color={colors.warning} />
            <T.Title tabular>{stats?.currentStreak ?? '—'}</T.Title>
          </View>
          <T.Caption tone="secondary" className="mt-1">
            Streak
          </T.Caption>
        </Card>
      </View>

      <DailyGoalsProgress study={study} activityDays={activityDays} />

      <AIStudyCoachCard stats={stats} streak={streak} />

      {quests.length > 0 || questsLoaded ? (
        <DailyQuestsWidget
          quests={quests}
          streak={stats?.currentStreak ?? 0}
          streakFreezes={0}
          onPurchaseFreeze={() => void handlePurchaseFreeze()}
          purchasingFreeze={purchasingFreeze}
        />
      ) : null}

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

      <Card className="mb-4">
        <T.Body className="font-semibold mb-2">16-week activity</T.Body>
        {statsLoading && !stats ? (
          <T.Caption tone="tertiary">Loading activity…</T.Caption>
        ) : (
          <>
            <ActivityHeatmap days={heatmap.days} theme={isDark ? 'dark' : 'light'} />
            <T.Caption tone="tertiary" className="mt-2">
              Darker = more study activity
            </T.Caption>
          </>
        )}
      </Card>

      <AchievementsCard badges={stats?.badges ?? []} loading={statsLoading} />

      <DashboardInsights stats={stats} />

      <GroupPerformanceCard
        groups={groups}
        testResults={leanTestResults}
        loading={statsLoading}
      />

      <RecentTestsCard userId={user?.id} groups={groups} />

      {/* The leaderboard's only door. It used to be a banner on Home with an
          amber `#f59e0b` trophy; it is a flat row here, with the trophy in the
          warning token so it answers to the theme. `Leaderboard` lives on the
          Home stack, so the navigate names the tab and lets the nested
          navigator find the screen. */}
      {onOpenLeaderboard ? (
        <Pressable
          onPress={onOpenLeaderboard}
          accessibilityRole="button"
          accessibilityLabel="Open leaderboard"
          testID="me-progress-leaderboard"
          className="active:opacity-80 mb-4"
        >
          <Card className="flex-row items-center gap-3">
            <AppIcon name="trophy" size={20} color={colors.warning} />
            <View className="flex-1 min-w-0">
              <T.Body className="font-semibold">Leaderboard</T.Body>
              <T.Caption tone="secondary">See how you rank against other students</T.Caption>
            </View>
            <AppIcon name="chevron-forward" size={18} color={colors.textTertiary} />
          </Card>
        </Pressable>
      ) : null}
    </View>
  );
}

export default MeProgress;
