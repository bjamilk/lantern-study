import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
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
import { AchievementsCard } from './AchievementsCard';
import { GroupPerformanceCard } from './GroupPerformanceCard';
import { RecentTestsCard } from './RecentTestsCard';

/**
 * The progress hub on Profile — the same widgets web shows on /me/progress.
 *
 * Points, today's goals, daily quests, the daily quiz, achievements, group
 * performance and recent tests. It reads stores Home already fills and only
 * starts a fetch when this screen opens first.
 */
export function MeProgress() {
  const { colors } = useTheme();
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

      <DailyGoalsProgress study={study} activityDays={activityDays} />

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

      <AchievementsCard badges={stats?.badges ?? []} loading={statsLoading} />

      <GroupPerformanceCard
        groups={groups}
        testResults={leanTestResults}
        loading={statsLoading}
      />

      <RecentTestsCard userId={user?.id} groups={groups} />
    </View>
  );
}

export default MeProgress;
