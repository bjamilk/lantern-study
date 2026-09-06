// ===========================================
// Lantern Study Mobile - Stats Store
// ===========================================

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as api from '../services/api';
import {
  initialUserStats,
  getBadgeProgress,
  BADGE_DEFINITIONS,
} from '@lantern/shared/utils';
import type { UserStats as SharedUserStats, Badge as SharedBadge, BadgeId } from '@lantern/shared';
import { classifyRequestFailure } from '@lantern/shared/network';
import { mergeStatsRefresh } from '../screens/dashboard/dashboardProgressState';
import {
  fetchTestResultsCached,
  loadCachedDashboardStats,
  saveCachedDashboardStats,
} from '../services/dashboardCache';
import { normalizeDashboardStats } from '../utils/testAnalysisHelpers';
import { useGroupStore } from './groupStore';
import { useFlashcardStore } from './flashcardStore';

import { recordLoginStreak as recordServerLoginStreak } from '../services/gamification';
import { fetchStudyActivity } from '../services/gamification';
import {
  calculateUserLevel,
  type Badge,
  type DashboardStats,
  type RecentTest,
  type TestAnalysisQuestionTime,
  type TimePeriod,
  type UserLevel,
} from '../types/dashboardStats';

export type {
  Badge,
  DashboardStats,
  GroupPerformance,
  RecentTest,
  TestAnalysis,
  TestAnalysisQuestionTime,
  TimePeriod,
  TopicPerformance,
  TroublesomeQuestion,
  UserLevel,
} from '../types/dashboardStats';
export { calculateUserLevel, LEVEL_THRESHOLDS } from '../types/dashboardStats';

type BuildDashboardStatsModule = typeof import('../utils/buildDashboardStats');
let buildDashboardStatsModule: BuildDashboardStatsModule | null = null;

async function getBuildDashboardStatsModule(): Promise<BuildDashboardStatsModule> {
  if (!buildDashboardStatsModule) {
    buildDashboardStatsModule = await import('../utils/buildDashboardStats');
  }
  return buildDashboardStatsModule;
}

const DEMO_MODE = false;

/**
 * Deliberately does NOT swallow. It used to answer a failed call with
 * `{ current: 0, longest: 0 }`, which is indistinguishable from a student who
 * really has no streak — the caller tallies the failure instead and decides
 * whether the whole snapshot is trustworthy.
 */
async function recordLoginStreak(_userId: string): Promise<{ current: number; longest: number }> {
  const result = await recordServerLoginStreak();
  return {
    current: result?.currentStreak ?? result?.current_streak ?? 0,
    longest: result?.longestStreak ?? result?.longest_streak ?? 0,
  };
}

/**
 * The only failures that mean "we never got an answer out of the device".
 * A 404, a 403 or an empty account ARE answers and must not demote the
 * dashboard — see `mergeStatsRefresh`.
 */
function isUnreachableFailure(error: unknown): boolean {
  const kind = classifyRequestFailure(error);
  return kind === 'offline' || kind === 'timeout' || kind === 'server';
}

/** Counts remote sources and how many of them never reached Lantern. */
interface SourceTally {
  attempted: number;
  unreachable: number;
}

/**
 * Run one source, keep the tally honest, and fall back so the rest of the
 * refresh can still build. The fallback is NOT presented as data: if enough
 * sources land here, `mergeStatsRefresh` throws the whole snapshot away.
 */
async function tallySource<T>(tally: SourceTally, run: () => Promise<T>, fallback: T): Promise<T> {
  tally.attempted += 1;
  try {
    return await run();
  } catch (error) {
    if (isUnreachableFailure(error)) tally.unreachable += 1;
    return fallback;
  }
}

function mapSharedBadgesToDashboard(
  userBadges: SharedBadge[],
  stats: SharedUserStats
): Badge[] {
  return (Object.keys(BADGE_DEFINITIONS) as BadgeId[]).map((badgeId) => {
    const def = BADGE_DEFINITIONS[badgeId];
    const metric = def.metric === 'question_upvotes' ? 0 : stats[def.metric as keyof SharedUserStats] || 0;
    const earned = userBadges.find((b) => b.id === badgeId);
    const progressInfo = getBadgeProgress(badgeId, metric);

    return {
      id: badgeId,
      name: earned?.name || def.baseName,
      description: earned?.description || def.baseDescription(def.levels[0]?.threshold ?? 0),
      icon: mapBadgeIcon(def.icon),
      level: earned?.level || 0,
      maxLevel: def.levels.length,
      progress: progressInfo?.progress ?? 0,
      currentValue: progressInfo?.current ?? metric,
      targetValue: progressInfo?.target ?? def.levels[0]?.threshold ?? 0,
      unlockedAt: earned?.dateAwarded,
    };
  });
}

function mapBadgeIcon(emoji: string): string {
  const iconMap: Record<string, string> = {
    '🚀': 'rocket',
    '❓': 'help-circle',
    '🌟': 'star',
    '📝': 'document-text',
    '🎯': 'trophy',
    '🏆': 'medal',
    '⚔️': 'game-controller',
    '💰': 'cash',
    '⭐': 'star-half',
    '🤝': 'hand-left',
  };
  return iconMap[emoji] || 'ribbon';
}

function mapGamificationSnapshot(profile: {
  points?: number;
  badges?: unknown[];
  stats?: unknown;
}): { badges: Badge[]; totalPoints: number } {
  const stats = { ...initialUserStats, ...(profile.stats as Partial<SharedUserStats>) };
  return {
    badges: mapSharedBadgesToDashboard((profile.badges as SharedBadge[]) || [], stats),
    totalPoints: profile.points ?? 0,
  };
}

async function loadUserGamificationSnapshot(userId: string): Promise<{
  badges: Badge[];
  totalPoints: number;
}> {
  const profile = await api.fetchUserProfile(userId);
  return mapGamificationSnapshot(profile);
}

function normalizeSummaryActivityDays(raw: unknown): Array<{ date: string; count: number }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row: any) => ({
      date: String(row?.date || row?.activity_date || ''),
      count: Number(row?.count) || 0,
      ...(row?.breakdown ? { breakdown: row.breakdown } : {}),
    }))
    .filter(day => Boolean(day.date));
}

/**
 * Ask the server to reconcile badge stats and award anything newly earned.
 *
 * This used to run `checkAndAwardBadges` here on the device and write the result
 * straight to the profile. Web never did that, so the same account earned badges
 * at different moments depending on which app was open, and two clients could
 * race each other into a double award. The server now owns awarding — it also
 * recounts the underlying stats from source rows, which the device cannot do.
 */
function syncBadgesInBackground(userId: string): void {
  void (async () => {
    try {
      const result = await api.syncGamificationProgress();
      if (!result) return;

      const current = useStatsStore.getState().stats;
      if (!current) return;

      const badges = (result.badges as SharedBadge[]) || [];
      const stats = { ...initialUserStats, ...(result.stats as Partial<SharedUserStats>) };

      useStatsStore.setState({
        stats: {
          ...current,
          badges: mapSharedBadgesToDashboard(badges, stats),
          totalPoints: result.points,
          userLevel: calculateUserLevel(result.points),
        },
      });
    } catch (error) {
      console.warn('[StatsStore] Badge sync failed:', error);
    }
  })();
}

interface StatsFetchContext {
  groups?: Array<{ id: string; name: string }>;
  flashcards?: Record<string, any[]>;
  force?: boolean;
}

interface StatsState {
  stats: DashboardStats | null;
  /** Lean completed tests from dashboard summary (for charts / rollup). */
  leanTestResults: Array<{
    id?: string;
    score: number;
    totalQuestions: number;
    correctAnswersCount: number;
    session: {
      id?: string;
      startTime?: string | Date;
      config?: { groupId?: string; groupName?: string };
    };
  }>;
  selectedPeriod: TimePeriod;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  /**
   * The last refresh could not reach Lantern, so `stats` is whatever we held
   * before it — true, but not current. Separate from `error`, which stays null
   * here: nothing threw, the sources simply never left the device.
   */
  syncFailed: boolean;
  /** When `stats` last came back from the server, if we know. */
  lastSyncedAt: number | null;

  // Actions
  hydrateFromCache: (userId: string) => Promise<boolean>;
  fetchStats: (userId: string, period: TimePeriod, context?: StatsFetchContext) => Promise<void>;
  setSelectedPeriod: (period: TimePeriod) => void;
}

let inflightStatsKey: string | null = null;
let inflightStatsPromise: Promise<void> | null = null;

function resolveStatsContext(context?: StatsFetchContext) {
  const groups =
    context?.groups ??
    useGroupStore
      .getState()
      .groups.filter(group => !group.isArchived)
      .map(group => ({ id: group.id, name: group.name }));

  const flashcards = context?.flashcards ?? useFlashcardStore.getState().flashcards;
  return { groups, flashcards };
}

function mockQuestionTimes(
  entries: Array<{ time: number; status?: TestAnalysisQuestionTime['status']; stem?: string }>
): TestAnalysisQuestionTime[] {
  return entries.map((entry, index) => ({
    questionNumber: index + 1,
    time: entry.time,
    status: entry.status ?? 'correct',
    stem: entry.stem ?? `Sample question ${index + 1}`,
  }));
}

function mockRandomQuestionTimes(
  count: number,
  correct: number,
  incorrect: number,
  unattempted: number
): TestAnalysisQuestionTime[] {
  const statuses: TestAnalysisQuestionTime['status'][] = [
    ...Array(correct).fill('correct'),
    ...Array(incorrect).fill('incorrect'),
    ...Array(unattempted).fill('unattempted'),
  ];
  return Array.from({ length: count }, (_, i) => {
    const status = statuses[i] ?? 'correct';
    return {
      questionNumber: i + 1,
      time: status === 'unattempted' ? 0 : 20 + ((i * 7) % 25),
      status,
      stem: `Sample question ${i + 1}`,
    };
  });
}

// Mock data generator based on period
const generateMockStats = (period: TimePeriod): DashboardStats => {
  const multiplier = period === '7days' ? 0.3 : period === '30days' ? 0.6 : period === '90days' ? 0.85 : 1;
  const totalPoints = Math.round(2450 * multiplier);
  
  return {
    totalPoints,
    userLevel: calculateUserLevel(totalPoints),
    currentStreak: 7,
    longestStreak: 14,
    
    totalTestsTaken: Math.round(28 * multiplier),
    averageTimePerQuestion: 32,
    totalStudyTime: Math.round(845 * multiplier),
    cardsReviewed: Math.round(342 * multiplier),
    
    overallAccuracy: 78 + Math.round(Math.random() * 10),
    
    topicPerformance: [
      { tag: 'Biology', totalQuestions: Math.round(45 * multiplier), correctAnswers: Math.round(38 * multiplier), accuracy: 84, averageTime: 28 },
      { tag: 'Chemistry', totalQuestions: Math.round(32 * multiplier), correctAnswers: Math.round(25 * multiplier), accuracy: 78, averageTime: 35 },
      { tag: 'Physics', totalQuestions: Math.round(28 * multiplier), correctAnswers: Math.round(20 * multiplier), accuracy: 71, averageTime: 42 },
      { tag: 'Math', totalQuestions: Math.round(22 * multiplier), correctAnswers: Math.round(19 * multiplier), accuracy: 86, averageTime: 25 },
      { tag: 'History', totalQuestions: Math.round(18 * multiplier), correctAnswers: Math.round(14 * multiplier), accuracy: 78, averageTime: 30 },
    ],
    
    groupPerformance: [
      {
        groupId: 'group-1',
        groupName: 'Biology Study Group',
        testsCount: Math.round(12 * multiplier),
        averageScore: 82,
        accuracy: 85,
        averageTimePerQuestion: 28,
        chartData: [
          { date: '2025-11-24', score: 75 },
          { date: '2025-11-25', score: 80 },
          { date: '2025-11-26', score: 78 },
          { date: '2025-11-27', score: 85 },
          { date: '2025-11-28', score: 82 },
          { date: '2025-11-29', score: 88 },
          { date: '2025-11-30', score: 90 },
        ],
      },
      {
        groupId: 'group-2',
        groupName: 'Chemistry Champions',
        testsCount: Math.round(8 * multiplier),
        averageScore: 76,
        accuracy: 78,
        averageTimePerQuestion: 35,
        chartData: [
          { date: '2025-11-24', score: 70 },
          { date: '2025-11-25', score: 72 },
          { date: '2025-11-26', score: 75 },
          { date: '2025-11-27', score: 78 },
          { date: '2025-11-28', score: 76 },
          { date: '2025-11-29', score: 80 },
          { date: '2025-11-30', score: 82 },
        ],
      },
      {
        groupId: 'group-3',
        groupName: 'Physics Masters',
        testsCount: Math.round(6 * multiplier),
        averageScore: 71,
        accuracy: 72,
        averageTimePerQuestion: 42,
        chartData: [
          { date: '2025-11-24', score: 65 },
          { date: '2025-11-25', score: 68 },
          { date: '2025-11-26', score: 70 },
          { date: '2025-11-27', score: 72 },
          { date: '2025-11-28', score: 70 },
          { date: '2025-11-29', score: 74 },
          { date: '2025-11-30', score: 76 },
        ],
      },
    ],
    
    badges: [
      { id: 'GROUP_FOUNDER', name: 'Group Founder I', description: 'Create 1 study group', icon: 'rocket', level: 1, maxLevel: 10, progress: 100, currentValue: 1, targetValue: 3, unlockedAt: '2025-11-15' },
      { id: 'TEST_TAKER', name: 'Test Taker III', description: 'Complete 25 tests', icon: 'document-text', level: 3, maxLevel: 10, progress: 60, currentValue: 22, targetValue: 25 },
      { id: 'HIGH_SCORER', name: 'High Scorer II', description: 'Score 80%+ on 5 tests', icon: 'trophy', level: 2, maxLevel: 10, progress: 80, currentValue: 8, targetValue: 10 },
      { id: 'PERFECTIONIST', name: 'Perfectionist I', description: 'Score 100% on 1 test', icon: 'star', level: 1, maxLevel: 10, progress: 100, currentValue: 1, targetValue: 3, unlockedAt: '2025-11-28' },
      { id: 'DUELIST', name: 'Duelist', description: 'Win 3 head-to-head games', icon: 'game-controller', level: 0, maxLevel: 10, progress: 33, currentValue: 1, targetValue: 3 },
      { id: 'QUESTION_ASKER', name: 'Question Asker', description: 'Submit 5 questions', icon: 'help-circle', level: 0, maxLevel: 10, progress: 20, currentValue: 1, targetValue: 5 },
      { id: 'CARD_MASTER', name: 'Card Master II', description: 'Review 50 flashcards', icon: 'albums', level: 2, maxLevel: 10, progress: 68, currentValue: 42, targetValue: 50 },
      { id: 'STREAK_KEEPER', name: 'Streak Keeper I', description: 'Maintain 3-day streak', icon: 'flame', level: 1, maxLevel: 10, progress: 70, currentValue: 7, targetValue: 7, unlockedAt: '2025-11-20' },
    ],
    
    recentTests: [
      { 
        id: 'test-1', 
        groupName: 'Biology Study Group', 
        score: 18, 
        totalQuestions: 20, 
        percentage: 90, 
        completedAt: '2025-11-30T14:30:00Z', 
        timeSpent: 540,
        analysis: {
          correctCount: 18,
          incorrectCount: 2,
          unattemptedCount: 0,
          timePerQuestion: mockQuestionTimes([
            { time: 25 }, { time: 30 }, { time: 28 }, { time: 22 }, { time: 35 }, { time: 18 },
            { time: 42 }, { time: 20 }, { time: 33 }, { time: 27 }, { time: 31 }, { time: 24 },
            { time: 29 }, { time: 26 }, { time: 38 }, { time: 21 }, { time: 34 }, { time: 23 },
            { time: 28, status: 'incorrect' }, { time: 26, status: 'incorrect' },
          ]),
          timePerTag: [
            { tag: 'Cell Biology', avgTime: 28, count: 6 },
            { tag: 'Genetics', avgTime: 32, count: 5 },
            { tag: 'Ecology', avgTime: 25, count: 4 },
            { tag: 'Anatomy', avgTime: 30, count: 5 },
          ],
          tagPerformance: [
            { tag: 'Cell Biology', correct: 5, total: 6, accuracy: 83 },
            { tag: 'Genetics', correct: 5, total: 5, accuracy: 100 },
            { tag: 'Ecology', correct: 4, total: 4, accuracy: 100 },
            { tag: 'Anatomy', correct: 4, total: 5, accuracy: 80 },
          ],
        },
      },
      { 
        id: 'test-2', 
        groupName: 'Chemistry Champions', 
        score: 14, 
        totalQuestions: 18, 
        percentage: 78, 
        completedAt: '2025-11-29T10:15:00Z', 
        timeSpent: 480,
        analysis: {
          correctCount: 14,
          incorrectCount: 3,
          unattemptedCount: 1,
          timePerQuestion: mockQuestionTimes([
            { time: 32 }, { time: 28 }, { time: 45 }, { time: 25 }, { time: 38 }, { time: 22 },
            { time: 35 }, { time: 30 }, { time: 27 }, { time: 42 }, { time: 20 }, { time: 33 },
            { time: 28 }, { time: 0, status: 'unattempted' }, { time: 31 },
            { time: 24, status: 'incorrect' }, { time: 36, status: 'incorrect' }, { time: 29, status: 'incorrect' },
          ]),
          timePerTag: [
            { tag: 'Organic Chemistry', avgTime: 35, count: 6 },
            { tag: 'Inorganic Chemistry', avgTime: 28, count: 5 },
            { tag: 'Physical Chemistry', avgTime: 32, count: 4 },
            { tag: 'Biochemistry', avgTime: 30, count: 3 },
          ],
          tagPerformance: [
            { tag: 'Organic Chemistry', correct: 4, total: 6, accuracy: 67 },
            { tag: 'Inorganic Chemistry', correct: 4, total: 5, accuracy: 80 },
            { tag: 'Physical Chemistry', correct: 3, total: 4, accuracy: 75 },
            { tag: 'Biochemistry', correct: 3, total: 3, accuracy: 100 },
          ],
        },
      },
      { 
        id: 'test-3', 
        groupName: 'Physics Masters', 
        score: 12, 
        totalQuestions: 15, 
        percentage: 80, 
        completedAt: '2025-11-28T16:45:00Z', 
        timeSpent: 420,
        analysis: {
          correctCount: 12,
          incorrectCount: 3,
          unattemptedCount: 0,
          timePerQuestion: mockRandomQuestionTimes(15, 12, 3, 0),
          timePerTag: [
            { tag: 'Mechanics', avgTime: 32, count: 5 },
            { tag: 'Thermodynamics', avgTime: 35, count: 4 },
            { tag: 'Electromagnetism', avgTime: 30, count: 3 },
            { tag: 'Optics', avgTime: 28, count: 3 },
          ],
          tagPerformance: [
            { tag: 'Mechanics', correct: 4, total: 5, accuracy: 80 },
            { tag: 'Thermodynamics', correct: 3, total: 4, accuracy: 75 },
            { tag: 'Electromagnetism', correct: 2, total: 3, accuracy: 67 },
            { tag: 'Optics', correct: 3, total: 3, accuracy: 100 },
          ],
        },
      },
      { 
        id: 'test-4', 
        groupName: 'Biology Study Group', 
        score: 16, 
        totalQuestions: 20, 
        percentage: 80, 
        completedAt: '2025-11-27T09:00:00Z', 
        timeSpent: 600,
        analysis: {
          correctCount: 16,
          incorrectCount: 4,
          unattemptedCount: 0,
          timePerQuestion: mockRandomQuestionTimes(20, 16, 4, 0),
          timePerTag: [
            { tag: 'Cell Biology', avgTime: 30, count: 5 },
            { tag: 'Genetics', avgTime: 28, count: 5 },
            { tag: 'Ecology', avgTime: 32, count: 5 },
            { tag: 'Anatomy', avgTime: 29, count: 5 },
          ],
          tagPerformance: [
            { tag: 'Cell Biology', correct: 4, total: 5, accuracy: 80 },
            { tag: 'Genetics', correct: 4, total: 5, accuracy: 80 },
            { tag: 'Ecology', correct: 4, total: 5, accuracy: 80 },
            { tag: 'Anatomy', correct: 4, total: 5, accuracy: 80 },
          ],
        },
      },
      { 
        id: 'test-5', 
        groupName: 'Chemistry Champions', 
        score: 15, 
        totalQuestions: 18, 
        percentage: 83, 
        completedAt: '2025-11-26T11:30:00Z', 
        timeSpent: 510,
        analysis: {
          correctCount: 15,
          incorrectCount: 3,
          unattemptedCount: 0,
          timePerQuestion: mockRandomQuestionTimes(18, 15, 3, 0),
          timePerTag: [
            { tag: 'Organic Chemistry', avgTime: 30, count: 6 },
            { tag: 'Inorganic Chemistry', avgTime: 28, count: 6 },
            { tag: 'Physical Chemistry', avgTime: 32, count: 6 },
          ],
          tagPerformance: [
            { tag: 'Organic Chemistry', correct: 5, total: 6, accuracy: 83 },
            { tag: 'Inorganic Chemistry', correct: 5, total: 6, accuracy: 83 },
            { tag: 'Physical Chemistry', correct: 5, total: 6, accuracy: 83 },
          ],
        },
      },
    ],
    
    troublesomeQuestions: [
      { id: 'q-1', stem: 'What is the difference between mitosis and meiosis?', incorrectAttempts: 5, totalAttempts: 8, groupName: 'Biology Study Group' },
      { id: 'q-2', stem: 'Calculate the molarity of a solution containing...', incorrectAttempts: 4, totalAttempts: 6, groupName: 'Chemistry Champions' },
      { id: 'q-3', stem: 'Explain Newton\'s third law with an example', incorrectAttempts: 3, totalAttempts: 5, groupName: 'Physics Masters' },
    ],
    
    weeklyActivity: [
      { day: 'Mon', count: 12 },
      { day: 'Tue', count: 8 },
      { day: 'Wed', count: 15 },
      { day: 'Thu', count: 10 },
      { day: 'Fri', count: 18 },
      { day: 'Sat', count: 22 },
      { day: 'Sun', count: 14 },
    ],
    activityDays: [],
  };
};

export const useStatsStore = create<StatsState>((set, get) => ({
  stats: null,
  leanTestResults: [],
  syncFailed: false,
  lastSyncedAt: null,
  // Matches the web dashboard, which defaults to All Time. The two defaulting
  // differently made the same account show different totals side by side —
  // e.g. 13 tests taken on web against 10 on mobile — which reads as a sync bug.
  selectedPeriod: 'all',
  isLoading: false,
  isRefreshing: false,
  error: null,

  hydrateFromCache: async (userId: string) => {
    const cached = await loadCachedDashboardStats(userId);
    if (!cached?.stats) return false;

    const cachedAt = Date.parse(cached.cachedAt ?? '');
    set({
      stats: normalizeDashboardStats(cached.stats),
      selectedPeriod: cached.period,
      isLoading: false,
      isRefreshing: false,
      // Only snapshots that came back from the server are ever cached now, so
      // a hydrated one carries a real sync time — that is what dates the
      // "Last synced …" line instead of it guessing "a while ago".
      lastSyncedAt: Number.isFinite(cachedAt) ? cachedAt : null,
    });
    return true;
  },

  fetchStats: async (userId: string, period: TimePeriod, context?: StatsFetchContext) => {
    const requestKey = `${userId}:${period}`;
    if (inflightStatsPromise && inflightStatsKey === requestKey) {
      return inflightStatsPromise;
    }

    const hasExistingStats = !!get().stats;
    set({
      isLoading: !hasExistingStats,
      isRefreshing: hasExistingStats,
      error: null,
    });
    const tally: SourceTally = { attempted: 0, unreachable: 0 };

    const run = async () => {
      if (DEMO_MODE) {
        await new Promise(resolve => setTimeout(resolve, 300));
        const stats = generateMockStats(period);
        set({
          stats,
          leanTestResults: [],
          selectedPeriod: period,
          isLoading: false,
          isRefreshing: false,
          syncFailed: false,
          lastSyncedAt: Date.now(),
        });
        return;
      }

      const { groups, flashcards } = resolveStatsContext(context);
      const forceRefresh = context?.force === true;

      try {
        // Preferred path: one aggregate request replaces the five parallel calls below.
        let summary: Awaited<ReturnType<typeof api.fetchDashboardSummary>> | null = null;
        let summaryUnreachable = false;
        try {
          summary = await api.fetchDashboardSummary();
        } catch (error) {
          summaryUnreachable = isUnreachableFailure(error);
          summary = null;
        }

        let testResultsRaw: unknown;
        let questionStatsRaw: unknown;
        let loginStreak: { current: number; longest: number };
        let gamification: { badges: Badge[]; totalPoints: number };
        let activityDaysRaw: unknown;

        if (summary) {
          testResultsRaw = summary.testResults;
          // null => summary section failed; fall back to dedicated endpoint.
          if (summary.userQuestionStats === null) {
            questionStatsRaw = await tallySource(
              tally,
              () => api.fetchUserQuestionStats(userId),
              []
            );
          } else {
            questionStatsRaw = summary.userQuestionStats;
          }
          loginStreak = {
            current: summary.streak?.current_streak ?? summary.streak?.currentStreak ?? 0,
            longest: summary.streak?.longest_streak ?? summary.streak?.longestStreak ?? 0,
          };
          gamification = summary.profile
            ? mapGamificationSnapshot(summary.profile)
            : { badges: [], totalPoints: 0 };
          activityDaysRaw = normalizeSummaryActivityDays(summary.activityDays);
        } else {
          // Every one of these used to swallow its own failure, which is how a
          // phone with no radio produced a complete, confident snapshot of
          // zeros. They still fall back so the build can finish — but each
          // failure is counted, and the count decides whether the result is
          // allowed anywhere near the screen or the cache.
          [testResultsRaw, questionStatsRaw, loginStreak, gamification, activityDaysRaw] = await Promise.all([
            tallySource(
              tally,
              () =>
                fetchTestResultsCached(userId, api.fetchTestResults, {
                  limit: 500,
                  force: forceRefresh,
                }),
              [] as unknown[]
            ),
            tallySource(tally, () => api.fetchUserQuestionStats(userId), [] as unknown[]),
            tallySource(tally, () => recordLoginStreak(userId), { current: 0, longest: 0 }),
            tallySource(tally, () => loadUserGamificationSnapshot(userId), {
              badges: [] as Badge[],
              totalPoints: 0,
            }),
            tallySource(tally, () => fetchStudyActivity(), [] as unknown[]),
          ]);
          // The aggregate endpoint is the sixth source, not a free lookup: when
          // it failed because the device is offline, that is one more piece of
          // evidence that nothing got out.
          if (summaryUnreachable) {
            tally.attempted += 1;
            tally.unreachable += 1;
          }
        }

        syncBadgesInBackground(userId);

        const {
          buildDashboardStats,
          normalizeTestResults,
          normalizeUserQuestionStats,
        } = await getBuildDashboardStatsModule();

        const testResults = normalizeTestResults(testResultsRaw);
        const userQuestionStats = normalizeUserQuestionStats(questionStatsRaw);
        const currentStreak = loginStreak.current;
        const longestStreak = Math.max(loginStreak.longest, currentStreak);

        const stats = normalizeDashboardStats({
          ...buildDashboardStats({
            testResults,
            period,
            groups,
            userQuestionStats,
            flashcards,
            totalPoints: gamification.totalPoints,
            badges: gamification.badges,
            currentStreak,
            longestStreak,
          }),
          activityDays: Array.isArray(activityDaysRaw) ? activityDaysRaw : [],
        });

        // The whole point of the tally. A snapshot built on sources that never
        // reached Lantern replaces nothing and is cached nowhere — otherwise
        // the zeros go into AsyncStorage and the "last synced progress" the
        // student is promised becomes zero too, permanently.
        const resolution = mergeStatsRefresh({
          previous: get().stats,
          incoming: stats,
          attempted: tally.attempted,
          unreachable: tally.unreachable,
        });

        set({
          stats: resolution.stats,
          // Recent tests come back empty from a failed fetch for the same
          // reason the totals come back zero — keep the rows we already have.
          leanTestResults: resolution.stale ? get().leanTestResults : testResults,
          selectedPeriod: period,
          isLoading: false,
          isRefreshing: false,
          error: null,
          syncFailed: resolution.stale,
          lastSyncedAt: resolution.stale ? get().lastSyncedAt : Date.now(),
        });
        if (resolution.persist) {
          void saveCachedDashboardStats(userId, period, stats);
        }
      } catch (error: any) {
        console.error('Failed to fetch stats from API:', error);
        const unreachable = isUnreachableFailure(error) || tally.unreachable > 0;
        const message = error?.message ?? 'Could not load your stats';

        // The same empty-snapshot trap, one level up: this branch used to
        // build a zeroed dashboard out of local data whenever the store had
        // nothing yet. Offline, that is a fabricated claim about the
        // student's work, so we hold nothing and let Home show dashes.
        if (!get().stats && !unreachable) {
          const { buildDashboardStats } = await getBuildDashboardStatsModule();
          const stats = buildDashboardStats({
            testResults: [],
            period,
            groups,
            userQuestionStats: {},
            flashcards,
            totalPoints: 0,
            badges: [],
            currentStreak: 0,
            longestStreak: 0,
          });
          set({
            stats,
            leanTestResults: [],
            selectedPeriod: period,
            isLoading: false,
            isRefreshing: false,
            error: message,
            syncFailed: false,
          });
        } else {
          set({
            isLoading: false,
            isRefreshing: false,
            error: unreachable ? null : message,
            syncFailed: unreachable,
          });
        }
      }
    };

    inflightStatsKey = requestKey;
    inflightStatsPromise = run().finally(() => {
      inflightStatsPromise = null;
      inflightStatsKey = null;
    });
    return inflightStatsPromise;
  },

  setSelectedPeriod: (period: TimePeriod) => {
    set({ selectedPeriod: period });
  },
}));
