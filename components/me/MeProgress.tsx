import React from 'react';
import { normalizeUserSettings } from '@lantern/shared/settings';
import { computeStudyStreak } from '@lantern/shared/utils';
import type { StudyActivityDay } from '@lantern/shared';
import type {
  DailyQuizSession,
  Group,
  OfflineSessionBundle,
  StudyGoalMode,
  TestResult,
  User,
} from '../../types';
import { DailyQuestsWidget } from '../DailyQuestsWidget';
import DailyQuizWidget from '../DailyQuizWidget';
import { DailyGoalsProgress } from '../DailyGoalsProgress';
import { SkeletonStatRow } from '../ui';
import { AchievementsCard } from './AchievementsCard';
import { GroupPerformanceCard } from './GroupPerformanceCard';
import { RecentTestsCard } from './RecentTestsCard';

export interface MeProgressProps {
  currentUser: User;
  groups: Group[];
  testResults: TestResult[];
  theme: 'light' | 'dark';
  offlineBundles?: OfflineSessionBundle[];
  studyActivityDays?: StudyActivityDay[];
  dailyQuests?: Array<{
    id: string;
    questType: string;
    targetCount: number;
    progressCount: number;
    completed: boolean;
    rewardXp: number;
  }>;
  questsLoaded?: boolean;
  onRefreshGamification?: () => void;
  serverStreak?: number;
  streakFreezes?: number;
  onPurchaseStreakFreeze?: () => void;
  studyGoal?: StudyGoalMode;
  onStudyGoalChange?: (goal: StudyGoalMode) => void;
  dailyQuiz?: DailyQuizSession | null;
  dailyQuizProgress?: number;
  dailyQuizNoteOptions?: Array<{ id: string; title: string }>;
  startingDailyQuiz?: boolean;
  onStartDailyQuiz?: (noteId: string) => void;
  onDailyQuizAnswer?: (questionId: string, answer: string) => void;
  onCompleteDailyQuiz?: () => void;
  onViewAnalysis: (result: TestResult) => void;
  onViewTestResult?: (result: TestResult) => void;
}

export const MeProgress: React.FC<MeProgressProps> = ({
  currentUser,
  groups,
  testResults,
  theme,
  offlineBundles = [],
  studyActivityDays = [],
  dailyQuests = [],
  questsLoaded = false,
  onRefreshGamification,
  serverStreak = 0,
  streakFreezes = 0,
  onPurchaseStreakFreeze,
  studyGoal = 'retention',
  onStudyGoalChange,
  dailyQuiz = null,
  dailyQuizProgress = 0,
  dailyQuizNoteOptions = [],
  startingDailyQuiz = false,
  onStartDailyQuiz,
  onDailyQuizAnswer,
  onCompleteDailyQuiz,
  onViewAnalysis,
  onViewTestResult,
}) => {
  const displayStreak = Math.max(serverStreak, computeStudyStreak(studyActivityDays).current);
  return (
  <section className="space-y-4">

    {dailyQuests.length > 0 || questsLoaded ? (
      <DailyQuestsWidget
        quests={dailyQuests.map((q) => ({
          id: q.id,
          questType: (q as { questType?: string; quest_type?: string }).questType
            ?? (q as { quest_type?: string }).quest_type,
          targetCount: (q as { targetCount?: number; target_count?: number }).targetCount
            ?? (q as { target_count?: number }).target_count,
          progressCount: (q as { progressCount?: number; progress_count?: number }).progressCount
            ?? (q as { progress_count?: number }).progress_count,
          completed: q.completed,
          rewardXp: (q as { rewardXp?: number; reward_xp?: number }).rewardXp
            ?? (q as { reward_xp?: number }).reward_xp,
        }))}
        streak={displayStreak}
        streakFreezes={streakFreezes}
        onPurchaseStreakFreeze={onPurchaseStreakFreeze}
        questsLoaded={questsLoaded}
        onRefresh={onRefreshGamification}
        theme={theme}
      />
    ) : (
      <SkeletonStatRow />
    )}

    {onStartDailyQuiz && onDailyQuizAnswer && onCompleteDailyQuiz && onStudyGoalChange ? (
      <DailyQuizWidget
        theme={theme}
        studyGoal={studyGoal}
        dailyQuiz={dailyQuiz}
        progress={dailyQuizProgress}
        noteOptions={dailyQuizNoteOptions}
        starting={startingDailyQuiz}
        onStudyGoalChange={onStudyGoalChange}
        onStartQuiz={onStartDailyQuiz}
        onAnswer={onDailyQuizAnswer}
        onComplete={onCompleteDailyQuiz}
      />
    ) : null}

    <DailyGoalsProgress
      study={normalizeUserSettings(currentUser.settings).study}
      activityDays={studyActivityDays}
    />

    <AchievementsCard currentUser={currentUser} />
    <GroupPerformanceCard
      testResults={testResults}
      groups={groups}
      offlineBundles={offlineBundles}
      theme={theme}
    />
    <RecentTestsCard
      currentUser={currentUser}
      groups={groups}
      offlineBundles={offlineBundles}
      onViewAnalysis={onViewAnalysis}
      onViewTestResult={onViewTestResult}
    />
  </section>
  );
};

export default MeProgress;
