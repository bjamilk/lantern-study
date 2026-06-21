import type { StudyActivityDay } from '@lantern/shared';

import { XP_LEVELS, getXPLevel } from '@lantern/shared/utils';

export type TimePeriod = '7days' | '30days' | '90days' | 'all';

export interface UserLevel {
  level: number;
  name: string;
  currentXP: number;
  xpForCurrentLevel: number;
  xpForNextLevel: number;
  progressToNextLevel: number;
}

/** Derived from shared XP_LEVELS for backward-compatible re-exports. */
export const LEVEL_THRESHOLDS = XP_LEVELS.map(l => ({
  level: l.level,
  name: l.title,
  xpRequired: l.minPoints,
}));

export const calculateUserLevel = (totalXP: number): UserLevel => {
  const xp = getXPLevel(totalXP);
  const isMaxLevel = xp.maxPoints === -1;
  return {
    level: xp.level,
    name: xp.title,
    currentXP: totalXP,
    xpForCurrentLevel: xp.minPoints,
    xpForNextLevel: isMaxLevel ? totalXP : xp.maxPoints + 1,
    progressToNextLevel: xp.progressPercent,
  };
};

export interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;
  level: number;
  maxLevel: number;
  progress: number;
  currentValue: number;
  targetValue: number;
  unlockedAt?: string;
}

export interface TopicPerformance {
  tag: string;
  totalQuestions: number;
  correctAnswers: number;
  accuracy: number;
  averageTime: number;
}

export interface GroupPerformance {
  groupId: string;
  groupName: string;
  testsCount: number;
  averageScore: number;
  accuracy: number;
  averageTimePerQuestion: number;
  chartData: { date: string; score: number }[];
}

export interface RecentTest {
  id: string;
  groupName: string;
  score: number;
  totalQuestions: number;
  percentage: number;
  completedAt: string;
  timeSpent: number;
  analysis: TestAnalysis;
}

export interface TestAnalysisQuestionTime {
  questionNumber: number;
  time: number;
  status: 'correct' | 'incorrect' | 'unattempted';
  stem: string;
}

export interface TestAnalysis {
  correctCount: number;
  incorrectCount: number;
  unattemptedCount: number;
  timePerQuestion: TestAnalysisQuestionTime[];
  timePerTag: { tag: string; avgTime: number; count: number }[];
  tagPerformance: { tag: string; correct: number; total: number; accuracy: number }[];
}

export interface TroublesomeQuestion {
  id: string;
  stem: string;
  incorrectAttempts: number;
  totalAttempts: number;
  groupName: string;
}

export interface DashboardStats {
  totalPoints: number;
  userLevel: UserLevel;
  currentStreak: number;
  longestStreak: number;
  totalTestsTaken: number;
  averageTimePerQuestion: number;
  totalStudyTime: number;
  cardsReviewed: number;
  overallAccuracy: number;
  topicPerformance: TopicPerformance[];
  groupPerformance: GroupPerformance[];
  badges: Badge[];
  recentTests: RecentTest[];
  troublesomeQuestions: TroublesomeQuestion[];
  weeklyActivity: { day: string; count: number }[];
  activityDays: StudyActivityDay[];
}
