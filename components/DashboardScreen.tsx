
import { toDateOnlyLocal } from '@lantern/shared/utils/dateOnly';

import React, { useState, useEffect, useMemo, useCallback, useRef, useLayoutEffect } from 'react';
import { TestResult, Group, User, Badge, UserStats, QuestionType, UserQuestionStats, Message, UserAnswerRecord, AppMode, OfflineSessionBundle, DailyQuizSession, StudyGoalMode, TestSessionData, StudySessionData, PausedSessionSummary } from '../types';
import DailyQuizWidget from './DailyQuizWidget';
import { DailyGoalsProgress } from './DailyGoalsProgress';
import SavedSessionsList from './SavedSessionsList';
import { normalizeUserSettings } from '@lantern/shared/settings';
import { ChartBarIcon, CalendarDaysIcon, CheckCircleIcon, InformationCircleIcon, UsersIcon, ClockIcon, ArrowLeftIcon, PresentationChartLineIcon, ChevronUpIcon, ChevronDownIcon, FunnelIcon, SparklesIcon, TrophyIcon, RocketLaunchIcon, ClockIcon as ClockOutline, AcademicCapIcon as AcademicCapOutline, TagIcon, PresentationChartBarIcon, ExclamationTriangleIcon, RectangleStackIcon, ShoppingBagIcon, PlusCircleIcon, FireIcon, BoltIcon, BellIcon, XMarkIcon, DocumentTextIcon, PlayIcon } from '@heroicons/react/24/solid';
import GroupPerformanceChart, { ChartDataPoint } from './GroupPerformanceChart';
import { useUIStore } from '../stores/uiStore';
import { useFlashcardStore } from '../stores/flashcardStore';
import type { AIStudyPerformanceData } from '@lantern/shared/api';
import { ScreenHeader, Card, StatPill, Button, SkeletonStatRow } from './ui';
import { syncCopy } from '@lantern/shared/design';
import {
  buildActivityMap,
  buildFlashcardAccuracyByDeck,
  countActiveDaysInLastWeek,
  formatActivityLocalDate,
  normalizeTestQuestionForSession,
  normalizeStoredUserAnswer,
  getActivityHeatHexColor,
  getActivityHeatHexColorForCount,
  computeStudyStreak,
  getDashboardFirstName,
  getGroupIdWithDescendants,
  buildRolledUpGroupSeries,
  filterResultsByGroupPerformancePeriod,
  withResolvedGroupIds,
  GROUP_PERFORMANCE_PERIOD_OPTIONS,
  type ActivityHeatLevel,
  type GroupPerformancePeriod,
} from '@lantern/shared/utils';
import { buildDashboardStats, type RawTestResult } from '@lantern/shared/utils/buildDashboardStats';
import type { StudyActivityDay } from '@lantern/shared';
import { BADGE_DEFINITIONS, getXPLevel } from '../gamification';
import { useLoginStreak } from '../hooks/useLoginStreak';
import { DailyQuestsWidget } from './DailyQuestsWidget';
import { DashboardHero } from './dashboard/DashboardHero';
import { DashboardProgress } from './dashboard/DashboardProgress';
import { DashboardQuickLinks } from './dashboard/DashboardQuickLinks';
import { DashboardSummaryRow } from './dashboard/DashboardSummaryRow';
import { DashboardStatGrid } from './dashboard/DashboardStatGrid';
import { GettingStartedChecklist } from './dashboard/GettingStartedChecklist';
import {
  GroupPerformanceMultiSelect,
  type GroupPerformanceOption,
} from './dashboard/GroupPerformanceMultiSelect';
import Modal from './ui/Modal';
import {
  fetchTestResultsPage,
  fetchTestSessionById,
  fetchUserQuestionStats,
  type TestResultsSort,
} from '../services/supabase';
import { useTestStore } from '../stores/testStore';
import { useLibraryStore } from '../stores/libraryStore';
import { useAcademicStore } from '../stores/academicStore';
import { UNFILED_COURSE_ID, UNTOPICED_TOPIC_ID } from '../utils/libraryArchive';
import {
  needsAcademicSetup,
  readAcademicSetupDismissed,
  markAcademicSetupDismissed,
} from '../utils/academicSetup';
import AcademicFeedPanel from './AcademicFeedPanel';
import MasteryPanel from './MasteryPanel';

const SELECTED_GROUP_CHART_IDS_KEY = 'lantern.dashboard.selectedGroupIds';

/**
 * One-line "Finish setting up your profile" nudge (Phase 1 A/F) shown while
 * `currentUser.institutionId` is null. Opens the profile-setup step. Dismissal
 * is per-user and persistent (shared with the setup step's "Skip for now"), so
 * once a user dismisses it — here or in the modal — it stays dismissed and the
 * auto-open doesn't loop. Setting an institution (in setup or Settings) clears
 * the flag.
 */
const AcademicSetupBanner: React.FC<{ currentUser: User }> = ({ currentUser }) => {
  const openModal = useUIStore((s) => s.openModal);
  const [dismissed, setDismissed] = useState<boolean>(() =>
    readAcademicSetupDismissed(currentUser.id)
  );
  if (dismissed || !needsAcademicSetup(currentUser)) return null;
  const dismiss = () => {
    setDismissed(true);
    markAcademicSetupDismissed(currentUser.id);
  };
  return (
    <div
      role="status"
      className="bg-lantern-primary-background border-b border-lantern-border px-4 py-2 flex items-center justify-between gap-3 text-sm"
    >
      <p className="min-w-0 truncate text-lantern-text">
        <AcademicCapOutline className="w-4 h-4 inline-block mr-1.5 -mt-0.5 text-lantern-primary" aria-hidden />
        Finish setting up your profile — add your university and courses.
      </p>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={() => openModal('usernameRequired')}
          className="px-2.5 py-1 rounded-md text-xs font-semibold text-white bg-lantern-primary hover:bg-lantern-primary-dark"
        >
          Set up
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="p-1.5 rounded-full text-lantern-text-secondary hover:bg-lantern-background-secondary"
          aria-label="Dismiss profile setup reminder"
        >
          <XMarkIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
const GROUP_PERF_PERIOD_KEY = 'lantern.dashboard.groupPerfPeriod';
const RECENT_TESTS_PAGE_SIZE = 5;

function loadSelectedGroupChartIds(): string[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(SELECTED_GROUP_CHART_IDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function saveSelectedGroupChartIds(ids: string[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(SELECTED_GROUP_CHART_IDS_KEY, JSON.stringify(ids));
  } catch {
    // ignore quota / private mode
  }
}

function loadGroupPerfPeriod(): GroupPerformancePeriod {
  try {
    if (typeof localStorage === 'undefined') return 'all';
    const raw = localStorage.getItem(GROUP_PERF_PERIOD_KEY);
    if (raw === '7days' || raw === '30days' || raw === '90days' || raw === 'all') return raw;
  } catch {
    // ignore
  }
  // Same default as the dashboard period; a saved preference still wins.
  return 'all';
}

function saveGroupPerfPeriod(period: GroupPerformancePeriod): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(GROUP_PERF_PERIOD_KEY, period);
  } catch {
    // ignore
  }
}

function buildHierarchicalGroupOptions(
  historyGroups: Group[],
  dataIds: Set<string>
): GroupPerformanceOption[] {
  const byParent = new Map<string | null, Group[]>();
  for (const group of historyGroups) {
    const parentKey = group.parentId || null;
    const list = byParent.get(parentKey) || [];
    list.push(group);
    byParent.set(parentKey, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  const options: GroupPerformanceOption[] = [];
  const walk = (parentId: string | null, level: number) => {
    const children = byParent.get(parentId) || [];
    for (const child of children) {
      if (dataIds.has(child.id)) {
        options.push({ id: child.id, name: child.name, level });
      }
      walk(child.id, level + 1);
    }
  };

  // Roots: no parent, or parent not in the active set (orphaned nesting still shows).
  const historyIds = new Set(historyGroups.map((g) => g.id));
  const roots = historyGroups
    .filter((g) => !g.parentId || !historyIds.has(g.parentId))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const root of roots) {
    if (dataIds.has(root.id)) {
      options.push({ id: root.id, name: root.name, level: 0 });
    }
    walk(root.id, 1);
  }

  // Deduplicate in case a node was both a "root" and reached via walk.
  const seen = new Set<string>();
  return options.filter((opt) => {
    if (seen.has(opt.id)) return false;
    seen.add(opt.id);
    return true;
  });
}

interface DashboardScreenProps {
  testResults: TestResult[];
  groups: Group[];
  currentUser: User;
  offlineBundles?: OfflineSessionBundle[];
  onNavigateToChat?: () => void;
  allMessages: Record<string, Message[]>;
  userQuestionStats: UserQuestionStats;
  onViewAnalysis: (result: TestResult) => void;
  theme: 'light' | 'dark';
  // Quick-action navigation
  onNavigateToFlashcards?: () => void;
  onOpenCreateDeck?: () => void;
  onNavigateToMarketplace?: () => void;
  onNavigateToCreateGroup?: () => void;
  onNavigateToBudget?: () => void;
  onNavigateToStudyHub?: () => void;
  /** Phase 3 M: routing target for a feed row (listing, group, note, profile). */
  onNavigateFromFeed?: (screen: string, params?: Record<string, unknown>) => void;
  onNavigateToLibrary?: () => void;
  onNavigateToOffline?: () => void;
  onToggleCompanion?: () => void;
  deckCount?: number;
  hasBudgetSet?: boolean;
  hasOpenedLibrary?: boolean;
  hasTriedCompanion?: boolean;
  hasSubmittedQuestion?: boolean;
  hasExploredMarketplace?: boolean;
  hasTriedOffline?: boolean;
  dueCardsCount?: number;
  // Flashcard review activity for heatmap
  flashcards?: import('../types').Flashcard[];
  // Today's Summary
  pendingSyncCount?: number;
  unreadNotificationCount?: number;
  // Study flow entry points — called with the selected groupId
  onOpenQuickTest?: (groupId: string) => void;
  onOpenQuickStudy?: (groupId: string) => void;
  onGetStudyRecommendations?: (performanceData: AIStudyPerformanceData) => Promise<{ weakTopics: string[]; suggestedCards: string[]; suggestedQuestions: string[]; studyTip: string; estimatedMinutes: number } | null>;
  onNavigateToNotes?: () => void;
  onOpenImportAndStudy?: () => void;
  onNavigateToAITools?: () => void;
  onReviewDueCards?: () => void;
  onViewTestResult?: (result: TestResult) => void;
  dailyQuests?: Array<{ id: string; questType: string; targetCount: number; progressCount: number; completed: boolean; rewardXp: number }>;
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
  activeTestSession?: TestSessionData | null;
  activeStudySession?: StudySessionData | null;
  onResumeSession?: () => void;
  pausedSessions?: PausedSessionSummary[];
  onResumePausedSession?: (sessionId: string) => void;
  onAbandonPausedSession?: (sessionId: string) => void;
  studyActivityDays?: StudyActivityDay[];
}

interface GroupPerformanceData {
  id: string;
  name: string;
  testCount: number;
  totalScore: number;
  averageScore: number;
  correctAnswers: number;
  totalQuestions: number;
  accuracy: number;
  totalTimeSpentSeconds: number;
  questionsWithTimeData: number;
  averageTimePerQuestion: number;
  chartData: ChartDataPoint[];
  weeklyChartData: ChartDataPoint[];
}

type TimePeriodOptionValue = 'allTime' | 'last7Days' | 'last30Days' | 'last90Days' | 'custom';

const timePeriodOptions: { value: TimePeriodOptionValue, label: string }[] = [
  { value: 'allTime', label: 'All Time' },
  { value: 'last7Days', label: 'Last 7 Days' },
  { value: 'last30Days', label: 'Last 30 Days' },
  { value: 'last90Days', label: 'Last 90 Days' },
  { value: 'custom', label: 'Custom Range' },
];

const StudyHeatmap = ({ data, theme }: { data: Map<string, number>, theme: 'light' | 'dark' }) => {
    const today = new Date();
    // Go back enough days to fill 16 full weeks, ensuring we start on a Sunday
    const startDate = new Date();
    startDate.setDate(today.getDate() - (16 * 7) + 1);
    startDate.setDate(startDate.getDate() - startDate.getDay());

    // Use local date strings (YYYY-MM-DD) to avoid timezone mismatches.
    // toISOString() returns UTC which can shift dates in timezones ahead of UTC.
    const formatLocalDate = (d: Date): string => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };

    // Build list of dates from startDate to today
    const days: Date[] = [];
    const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    while (cursor <= todayEnd) {
        days.push(new Date(cursor));
        cursor.setDate(cursor.getDate() + 1);
    }

    // Absolute activity tiers (shared across users — not relative to max day)
    const legendLevels: ActivityHeatLevel[] = [0, 1, 2, 3, 4];

    return (
        <div className="flex flex-col items-center gap-2 w-full min-w-0">
            <div className="w-full overflow-x-auto">
            <div className="grid grid-rows-7 grid-flow-col gap-0.5 sm:gap-1 w-max mx-auto">
                {days.map(day => {
                    const dateString = formatLocalDate(day);
                    const count = data.get(dateString) || 0;
                    return (
                        <div
                        key={dateString}
                        title={`${count} activit${count !== 1 ? 'ies' : 'y'} on ${day.toLocaleDateString()}`}
                        className="w-2.5 h-2.5 sm:w-3.5 sm:h-3.5 rounded-sm"
                        style={{ backgroundColor: getActivityHeatHexColorForCount(count, theme) }}
                        />
                    );
                })}
            </div>
            </div>
            <div className="flex items-center gap-1 text-xs text-lantern-text-secondary">
                <span>Less</span>
                {legendLevels.map(level => (
                    <div
                        key={level}
                        className="w-3 h-3 rounded-sm"
                        style={{ backgroundColor: getActivityHeatHexColor(level, theme) }}
                        aria-hidden
                    />
                ))}
                <span>More</span>
            </div>
        </div>
    );
};

export default function DashboardScreen({
  testResults: rawTestResults,
  groups,
  currentUser,
  offlineBundles = [],
  onNavigateToChat,
  allMessages,
  userQuestionStats,
  onViewAnalysis,
  theme,
  onNavigateToFlashcards,
  onOpenCreateDeck,
  onNavigateToMarketplace,
  onNavigateToCreateGroup,
  onNavigateToBudget,
  onNavigateToStudyHub,
  onNavigateFromFeed,
  onNavigateToLibrary,
  onNavigateToOffline,
  onToggleCompanion,
  deckCount = 0,
  hasBudgetSet = false,
  hasOpenedLibrary = false,
  hasTriedCompanion = false,
  hasSubmittedQuestion = false,
  hasExploredMarketplace = false,
  hasTriedOffline = false,
  onNavigateToNotes,
  onOpenImportAndStudy,
  onNavigateToAITools,
  onReviewDueCards,
  onViewTestResult,
  dailyQuests = [],
  questsLoaded = false,
  onRefreshGamification,
  serverStreak = 0,
  streakFreezes = 0,
  onPurchaseStreakFreeze,
  dueCardsCount = 0,
  flashcards = [],
  pendingSyncCount = 0,
  unreadNotificationCount = 0,
  onOpenQuickTest,
  onOpenQuickStudy,
  onGetStudyRecommendations,
  studyGoal = 'retention',
  onStudyGoalChange,
  dailyQuiz = null,
  dailyQuizProgress = 0,
  dailyQuizNoteOptions = [],
  startingDailyQuiz = false,
  onStartDailyQuiz,
  onDailyQuizAnswer,
  onCompleteDailyQuiz,
  activeTestSession,
  activeStudySession,
  onResumeSession,
  pausedSessions = [],
  onResumePausedSession,
  onAbandonPausedSession,
  studyActivityDays = [],
}: DashboardScreenProps) {
  const setUserQuestionStats = useTestStore(s => s.setUserQuestionStats);
  // Prefer freshly fetched stats over bootstrap props (bootstrap can miss
  // question stats when the aggregate summary section fails open).
  const [refetchedQuestionStats, setRefetchedQuestionStats] = useState<UserQuestionStats | null>(null);
  const effectiveQuestionStats = refetchedQuestionStats ?? userQuestionStats;

  useEffect(() => {
    const userId = currentUser?.id;
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      try {
        const stats = await fetchUserQuestionStats(userId);
        if (cancelled || !stats || typeof stats !== 'object' || Array.isArray(stats)) return;
        setRefetchedQuestionStats(stats);
        setUserQuestionStats(stats);
      } catch {
        // Keep bootstrap props if refresh fails.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser?.id, setUserQuestionStats]);

  // Group picker state for Quick Test / Quick Study
  const [quickActionPicker, setQuickActionPicker] = useState<'test' | 'study' | null>(null);
  const availableGroups = useMemo(() => groups.filter(g => !g.isArchived), [groups]);

  const handleQuickActionGroupSelect = useCallback((groupId: string) => {
    if (quickActionPicker === 'test') onOpenQuickTest?.(groupId);
    else if (quickActionPicker === 'study') onOpenQuickStudy?.(groupId);
    setQuickActionPicker(null);
  }, [quickActionPicker, onOpenQuickTest, onOpenQuickStudy]);

  // Filter out invalid test results and normalize date fields.
  // Lean history omits question payloads — charts only need startTime/config/score.
  const initialTestResults = useMemo(() => {
    return rawTestResults
      // Only startTime is required — it is what dedupe and period filtering key
      // on. Requiring session.config here dropped lean results the server
      // returns from /dashboard/summary, making web report fewer tests taken
      // than mobile. Consumers of config below guard for its absence.
      .filter(result => result?.session?.startTime)
      .map(result => ({
        ...result,
        session: {
          ...result.session,
          questions: Array.isArray(result.session.questions) ? result.session.questions : [],
          userAnswers: result.session.userAnswers || {},
          startTime: result.session.startTime instanceof Date 
            ? result.session.startTime 
            : new Date(result.session.startTime),
          endTime: result.session.endTime 
            ? (result.session.endTime instanceof Date 
                ? result.session.endTime 
                : new Date(result.session.endTime))
            : undefined,
        }
      }));
  }, [rawTestResults]);
  
  const [selectedTimePeriod, setSelectedTimePeriod] = useState<TimePeriodOptionValue>('allTime');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [chartDisplayMode, setChartDisplayMode] = useState<'bar' | 'line'>('line');
  const [groupPerfPeriod, setGroupPerfPeriod] = useState<GroupPerformancePeriod>(() => loadGroupPerfPeriod());
  const [selectedGroupChartIds, setSelectedGroupChartIds] = useState<string[]>(() =>
    loadSelectedGroupChartIds()
  );
  // Recent Tests follows the Library's course/topic filter (Phase 1 · A/B) —
  // the archive rail's "N tests" badge lands here, so the list has to honour the
  // scope the student just picked instead of quietly showing everything.
  const recentCourseId = useLibraryStore((s) => s.courseFilterId);
  const recentTopicId = useLibraryStore((s) => s.topicFilterId);
  const recentTopicLabel = useLibraryStore((s) => s.topicFilterLabel);
  const clearRecentCourse = useLibraryStore((s) => s.setCourseFilter);
  const clearRecentTopic = useLibraryStore((s) => s.setTopicFilter);
  const resolveRecentCourse = useAcademicStore((s) => s.resolveCourse);
  const [recentSort, setRecentSort] = useState<TestResultsSort>('newest');
  const [recentPage, setRecentPage] = useState(1);
  const [recentPageData, setRecentPageData] = useState<TestResult[]>([]);
  const [recentTotal, setRecentTotal] = useState(0);
  const [recentLoading, setRecentLoading] = useState(false);
  const [aiCoachData, setAiCoachData] = useState<{ weakTopics: string[]; suggestedCards: string[]; suggestedQuestions: string[]; studyTip: string; estimatedMinutes: number } | null>(null);
  const [isCoachLoading, setIsCoachLoading] = useState(false);

  // ── Gamification ──────────────────────────────────────────────────────────
  const { streakData, showDailyBonus, bonusXP, dismissBonus } = useLoginStreak();

  const studyActivityStreak = useMemo(
    () => computeStudyStreak(studyActivityDays).current,
    [studyActivityDays]
  );
  const displayStreak = Math.max(serverStreak, studyActivityStreak);
  const xpInfo = useMemo(() => getXPLevel(currentUser.points), [currentUser.points]);
  const { lowDataMode } = useUIStore();
  // Deck names label the per-deck flashcard accuracy sent to the AI coach;
  // `flashcards` (prop) comes from the same store in App.tsx.
  const decks = useFlashcardStore(s => s.decks);


  const filteredTestResults = useMemo(() => {
    // Deduplicate by startTime, preferring entries that have an id (cloud results over pending)
    const byStartTime = new Map<number, typeof initialTestResults[number]>();
    for (const r of initialTestResults) {
      const ts = new Date(r.session.startTime).getTime();
      const existing = byStartTime.get(ts);
      if (!existing || (!existing.id && r.id)) {
        byStartTime.set(ts, r);
      }
    }
    const deduped = Array.from(byStartTime.values());

    if (selectedTimePeriod === 'allTime') {
      return deduped;
    }

    if (selectedTimePeriod === 'custom') {
      if (customStartDate && customEndDate) {
        try {
          const startDateObj = new Date(customStartDate + "T00:00:00"); // Local time start of day
          const endDateObj = new Date(customEndDate + "T23:59:59.999");   // Local time end of day

          if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
            console.warn("Invalid custom dates provided.");
            return deduped; // Fallback to all if dates are invalid
          }
          if (startDateObj > endDateObj) {
            console.warn("Custom start date is after end date.");
            return []; // No results possible
          }

          return deduped.filter(result => {
            const resultDate = new Date(result.session.startTime);
            return resultDate >= startDateObj && resultDate <= endDateObj;
          });
        } catch (e) {
            console.error("Error parsing custom dates:", e);
            return deduped; 
        }
      } else {
        // If custom is selected but dates aren't set, effectively show "All Time"
        // or a specific message, here we show all for now.
        return deduped;
      }
    }
    
    // Logic for 'last7Days', 'last30Days', 'last90Days'
    const now = new Date();
    let daysToSubtract = 0;
    if (selectedTimePeriod === 'last7Days') daysToSubtract = 7;
    else if (selectedTimePeriod === 'last30Days') daysToSubtract = 30;
    else if (selectedTimePeriod === 'last90Days') daysToSubtract = 90;

    const cutoffDate = new Date(); 
    cutoffDate.setDate(now.getDate() - daysToSubtract);
    cutoffDate.setHours(0, 0, 0, 0); 

    return deduped.filter(result => {
        const resultDate = new Date(result.session.startTime);
        return resultDate >= cutoffDate;
    });
  }, [initialTestResults, selectedTimePeriod, customStartDate, customEndDate]);

  /** Deduped all-time results, then windowed for the Group performance card only. */
  const groupPerformanceResults = useMemo(() => {
    const byStartTime = new Map<number, (typeof initialTestResults)[number]>();
    for (const r of initialTestResults) {
      const ts = new Date(r.session.startTime).getTime();
      const existing = byStartTime.get(ts);
      if (!existing || (!existing.id && r.id)) {
        byStartTime.set(ts, r);
      }
    }
    // Recover mobile draft rows that stored deckId/custom-* as config.groupId.
    const resolved = withResolvedGroupIds(
      Array.from(byStartTime.values()) as unknown as RawTestResult[],
      groups.map((g) => ({ id: g.id, name: g.name }))
    );
    return filterResultsByGroupPerformancePeriod(
      resolved as unknown as typeof initialTestResults,
      groupPerfPeriod
    );
  }, [initialTestResults, groupPerfPeriod, groups]);

  const handleGroupPerfPeriodChange = useCallback((period: GroupPerformancePeriod) => {
    setGroupPerfPeriod(period);
    saveGroupPerfPeriod(period);
  }, []);
  
  // Derived from the shared builder (defined below) rather than counted here,
  // so web and mobile report the same number from the same code path.

  // Shared web/mobile stats builder so both surfaces compute identical
  // metrics. Results are already filtered by the period selector above
  // (including custom ranges), so the builder runs with period 'all'.
  const sharedStats = useMemo(
    () =>
      buildDashboardStats({
        testResults: filteredTestResults as unknown as RawTestResult[],
        period: 'all',
        groups: groups.map(g => ({ id: g.id, name: g.name })),
        userQuestionStats: effectiveQuestionStats,
        totalPoints: currentUser.points ?? 0,
        badges: [],
        currentStreak: 0,
        longestStreak: 0,
        cardsReviewed: 0,
      }),
    [filteredTestResults, groups, effectiveQuestionStats, currentUser.points]
  );

  const totalTestsTakenOverall = sharedStats.totalTestsTaken;
  
  const getGroupName = (groupId: string, storedName?: string): string => {
    const group = groups.find(g => g.id === groupId);
    if (group) return group.name;
    // Use stored name from session config
    if (storedName) return storedName;
    // Fallback: look up the name from any offline bundle with this groupId
    const bundle = offlineBundles.find(b => b.config.groupId === groupId);
    const bundleName = bundle?.displayName || bundle?.config.groupName || bundle?.groupName;
    if (bundleName) return bundleName;
    return groupId ? 'Unknown Exam' : 'Unknown Exam';
  };

  const [allGroupPerformanceData, setAllGroupPerformanceData] = useState<GroupPerformanceData[]>([]);
  const [isRecentTestsExpanded, setIsRecentTestsExpanded] = useState(true);

  useEffect(() => {
    const groupPerformanceMap: Map<string, GroupPerformanceData> = new Map();
    if (groupPerformanceResults.length > 0) {
      groupPerformanceResults.forEach(result => {
        const groupId = result.session.config?.groupId;
        const groupName = getGroupName(groupId, result.session.config?.groupName);
        
        let data = groupPerformanceMap.get(groupId);
        if (!data) {
          data = { 
            id: groupId, 
            name: groupName, 
            testCount: 0, 
            totalScore: 0, 
            averageScore: 0,
            correctAnswers: 0,
            totalQuestions: 0,
            accuracy: 0,
            totalTimeSpentSeconds: 0,
            questionsWithTimeData: 0,
            averageTimePerQuestion: 0,
            chartData: [],
            weeklyChartData: [],
          };
        }

        data.testCount++;
        data.totalScore += result.score;
        data.correctAnswers += result.correctAnswersCount;
        data.totalQuestions += result.totalQuestions;
        
        Object.values(result.session.userAnswers || {}).forEach((answer: UserAnswerRecord) => {
          if (answer.timeSpentSeconds !== undefined) {
            data.totalTimeSpentSeconds += answer.timeSpentSeconds;
            data.questionsWithTimeData++;
          }
        });
        
        groupPerformanceMap.set(groupId, data);
      });

      groupPerformanceMap.forEach(data => {
        data.averageScore = data.testCount > 0 ? data.totalScore / data.testCount : 0;
        data.accuracy = data.totalQuestions > 0 ? (data.correctAnswers / data.totalQuestions) * 100 : 0;
        data.averageTimePerQuestion = data.questionsWithTimeData > 0 ? data.totalTimeSpentSeconds / data.questionsWithTimeData : 0;

        const groupSpecificResults = groupPerformanceResults
          .filter(tr => tr.session.config?.groupId === data.id)
          .sort((a, b) => new Date(a.session.startTime).getTime() - new Date(b.session.startTime).getTime());
        
        data.chartData = groupSpecificResults.map((result, index) => {
          const date = new Date(result.session.startTime);
          const formattedDate = `${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}`;
          return {
            x: `Test ${index + 1} - ${formattedDate}`,
            y: result.score,
          };
        });
        
        // Calculate weekly data
        const weeklyScores: Map<string, { scores: number[]; count: number }> = new Map();
        const getWeek = (date: Date): string => {
            const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
            d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
            const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
            const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
            return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
        };

        groupSpecificResults.forEach(result => {
            const weekKey = getWeek(new Date(result.session.startTime));
            const weekData = weeklyScores.get(weekKey) || { scores: [], count: 0 };
            weekData.scores.push(result.score);
            weekData.count++;
            weeklyScores.set(weekKey, weekData);
        });

        data.weeklyChartData = Array.from(weeklyScores.entries())
            .sort((a,b) => a[0].localeCompare(b[0]))
            .map(([weekKey, { scores, count }]) => ({
                x: weekKey,
                y: scores.reduce((a,b) => a + b, 0) / count,
            }));
      });
    }
    const performanceDataArray = Array.from(groupPerformanceMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    setAllGroupPerformanceData(performanceDataArray);
  }, [groupPerformanceResults, groups]);

  const activeGroupChartOptions = useMemo(() => {
    // Archived groups still hold test history and are counted by the tiles
    // above, so excluding them here left the chart short of the headline
    // total. Groups with no results are still dropped further down.
    const historyGroups = groups;
    const directDataIds = new Set(
      allGroupPerformanceData
        .filter((row) => historyGroups.some((g) => g.id === row.id))
        .map((row) => row.id)
    );
    // Include parents that have no direct tests but have descendant results (rollup).
    const dataIds = new Set<string>();
    for (const group of historyGroups) {
      const rollup = getGroupIdWithDescendants(group.id, historyGroups, { activeOnly: false });
      for (const id of rollup) {
        if (directDataIds.has(id)) {
          dataIds.add(group.id);
          break;
        }
      }
    }
    return buildHierarchicalGroupOptions(historyGroups, dataIds);
  }, [groups, allGroupPerformanceData]);

  // Prune archived/deleted ids and seed a sensible default selection.
  useEffect(() => {
    const validIds = new Set(activeGroupChartOptions.map((opt) => opt.id));
    setSelectedGroupChartIds((prev) => {
      const pruned = prev.filter((id) => validIds.has(id));
      if (pruned.length === 0 && activeGroupChartOptions.length > 0) {
        const next = [activeGroupChartOptions[0].id];
        saveSelectedGroupChartIds(next);
        return next;
      }
      if (pruned.length !== prev.length) {
        saveSelectedGroupChartIds(pruned);
        return pruned;
      }
      return prev;
    });
  }, [activeGroupChartOptions]);

  const handleSelectedGroupChartIdsChange = useCallback((ids: string[]) => {
    setSelectedGroupChartIds(ids);
    saveSelectedGroupChartIds(ids);
  }, []);


  const analysisData = useMemo(() => {
    if (filteredTestResults.length === 0) {
        return { strongestTopics: [], weakestTopics: [], speedAnalysis: [] };
    }

    // Topic insights come from the shared builder (same numbers and
    // selection rules as the mobile dashboard).
    const rankedTopics = sharedStats.topicPerformance
        .filter(t => t.totalQuestions >= 3)
        .map(t => ({ tag: t.tag, accuracy: t.accuracy, count: t.totalQuestions }));
    const strongestTopics = rankedTopics.slice(0, 3);
    const weakestTopics = rankedTopics.length > 3 ? rankedTopics.slice(-3).reverse() : [];

    // Speed-by-question-type is web-only and stays computed inline.
    const speedStats: Map<QuestionType, { totalTime: number; count: number }> = new Map();
    for (const result of filteredTestResults) {
        if (!result.session?.questions) continue;
        for (const question of result.session.questions) {
            const answer = result.session.userAnswers?.[question.id] as UserAnswerRecord | undefined;
            if (!answer) continue;

            const normalizedQuestion = normalizeTestQuestionForSession(question as Record<string, unknown>, 0);
            const normalizedAnswer = normalizeStoredUserAnswer(answer, question.id);
            if (normalizedQuestion.questionType && normalizedAnswer.timeSpentSeconds !== undefined) {
                const stats = speedStats.get(normalizedQuestion.questionType) || { totalTime: 0, count: 0 };
                stats.totalTime += normalizedAnswer.timeSpentSeconds;
                stats.count++;
                speedStats.set(normalizedQuestion.questionType, stats);
            }
        }
    }

    const speedAnalysis = Array.from(speedStats.entries())
        .map(([type, { totalTime, count }]) => ({
            type,
            avgTime: count > 0 ? totalTime / count : 0,
        }))
        .sort((a,b) => a.avgTime - b.avgTime);

    return { strongestTopics, weakestTopics, speedAnalysis };

  }, [filteredTestResults, sharedStats]);
  
  const troublesomeQuestions = useMemo(() => {
    // Selection and counts come from the shared builder (same list as the
    // mobile dashboard). Chat messages remain a web-only stem fallback for
    // questions not embedded in any loaded test result.
    const messageStems = new Map<string, string>();
    (Object.values(allMessages) as Message[][]).flat().forEach((m: Message) => {
        if (m.type === 'QUESTION' && m.questionStem && !messageStems.has(m.id)) {
            messageStems.set(m.id, m.questionStem);
        }
    });

    return sharedStats.troublesomeQuestions.map(q => ({
        id: q.id,
        stem: q.stem !== 'Question not found.' ? q.stem : (messageStems.get(q.id) || 'Question not found.'),
        incorrectAttempts: q.incorrectAttempts,
        accuracy: q.totalAttempts > 0
            ? ((q.totalAttempts - q.incorrectAttempts) / q.totalAttempts) * 100
            : 0,
    }));
    }, [sharedStats, allMessages]);

  const heatmapData = useMemo(() => {
    const map = buildActivityMap(studyActivityDays);

    for (const result of filteredTestResults) {
      const end = result.session?.endTime || result.session?.startTime;
      if (!end) continue;
      const dateStr = formatActivityLocalDate(new Date(end));
      if ((map.get(dateStr) || 0) === 0) {
        map.set(dateStr, (map.get(dateStr) || 0) + 1);
      }
    }

    return map;
  }, [studyActivityDays, filteredTestResults]);

  const toggleRecentTestsExpansion = () => {
    setIsRecentTestsExpanded(prev => !prev);
  };
  
  // Same computation as the mobile dashboard (shared builder).
  const overallAverageTimePerQuestion = sharedStats.averageTimePerQuestion;

  const getTimePeriodLabel = () => {
    if (selectedTimePeriod === 'custom') {
      if (customStartDate && customEndDate) {
        try {
            const startDate = new Date(customStartDate + "T00:00:00");
            const endDate = new Date(customEndDate + "T00:00:00");
            if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return 'Custom Range (Invalid Dates)';
            return `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`;
        } catch {
            return 'Custom Range (Invalid Dates)';
        }
      }
      return 'Custom Range (Select Dates)';
    }
    return timePeriodOptions.find(o => o.value === selectedTimePeriod)?.label || 'All Time';
  };
  const currentPeriodLabel = getTimePeriodLabel();

  const highestLevelBadges = useMemo(() => {
    const badgeMap = new Map<string, Badge>();
    (currentUser.badges || []).forEach(badge => {
        const existing = badgeMap.get(badge.id);
        if (!existing || badge.level > existing.level) {
            badgeMap.set(badge.id, badge);
        }
    });
    // Return all badge definitions, showing earned ones and progress for unearned ones
    return Object.values(BADGE_DEFINITIONS).map(def => {
        const userBadge = badgeMap.get(def.id);
        return {
            definition: def,
            userBadge: userBadge,
        };
    }).sort((a,b) => {
        const aEarned = !!a.userBadge;
        const bEarned = !!b.userBadge;
        if(aEarned && !bEarned) return -1;
        if(!aEarned && bEarned) return 1;
        return 0;
    });
  }, [currentUser.badges, currentUser.stats]);

  const getQuestionTypeLabel = (type: QuestionType) => {
    const labels: Record<QuestionType, string> = {
      [QuestionType.MULTIPLE_CHOICE_SINGLE]: "MCQ (Single)",
      [QuestionType.MULTIPLE_CHOICE_MULTIPLE]: "MCQ (Multiple)",
      [QuestionType.TRUE_FALSE]: "True/False",
      [QuestionType.FILL_IN_THE_BLANK]: "Fill-in-the-Blank",
      [QuestionType.MATCHING]: "Matching",
      [QuestionType.DIAGRAM_LABELING]: "Diagram Labeling",
      [QuestionType.OPEN_ENDED]: "Open Ended",
    };
    return labels[type] || "Unknown Type";
  };
  
  const selectedGroupPerformance = useMemo(() => {
    // Archived groups still hold test history and are counted by the tiles
    // above, so excluding them here left the chart short of the headline
    // total. Groups with no results are still dropped further down.
    const historyGroups = groups;
    const optionIds = new Set(activeGroupChartOptions.map((opt) => opt.id));
    return selectedGroupChartIds
      .filter((id) => optionIds.has(id))
      .map((id) => {
        const name =
          historyGroups.find((g) => g.id === id)?.name ||
          allGroupPerformanceData.find((row) => row.id === id)?.name ||
          getGroupName(id);
        return buildRolledUpGroupSeries({
          groupId: id,
          groupName: name,
          groups: historyGroups,
          results: groupPerformanceResults,
          activeOnly: false,
        });
      })
      .filter((row) => row.testCount > 0);
  }, [
    groups,
    activeGroupChartOptions,
    selectedGroupChartIds,
    allGroupPerformanceData,
    groupPerformanceResults,
  ]);

  const selectionIncludesParentRollup = selectedGroupPerformance.some((g) => g.includesDescendants);

  const isMultiGroupChart = selectedGroupPerformance.length >= 2;
  // Multi-select uses weekly series (aligned dates); single group keeps Timeline/Weekly toggle.
  const effectiveChartMode: 'bar' | 'line' = isMultiGroupChart ? 'line' : chartDisplayMode;
  const useWeeklySeries = isMultiGroupChart || chartDisplayMode === 'bar';

  const unifiedChartDatasets = useMemo(() => {
    if (selectedGroupPerformance.length === 0) return null;

    if (!isMultiGroupChart) {
      const group = selectedGroupPerformance[0];
      const data = useWeeklySeries ? group.weeklyChartData : group.chartData;
      return [{ label: group.name, data }];
    }

    const allXLabels = new Set<string>();
    selectedGroupPerformance.forEach((group) => {
      group.weeklyChartData.forEach((point) => allXLabels.add(point.x));
    });
    const sortedLabels = Array.from(allXLabels).sort();

    return selectedGroupPerformance.map((group) => {
      const dataMap = new Map(group.weeklyChartData.map((p) => [p.x, p.y]));
      const alignedData: ChartDataPoint[] = sortedLabels.map((label) => ({
        x: label,
        y: dataMap.get(label) ?? null,
      }));
      return { label: group.name, data: alignedData };
    });
  }, [selectedGroupPerformance, isMultiGroupChart, useWeeklySeries]);

  const selectedGroupsSummary = useMemo(() => {
    if (selectedGroupPerformance.length === 0) {
      return { testCount: 0, averageScore: 0, accuracy: 0 };
    }
    // Dedupe overlapping parent/child selections in the aggregate strip.
    // Archived groups still hold test history and are counted by the tiles
    // above, so excluding them here left the chart short of the headline
    // total. Groups with no results are still dropped further down.
    const historyGroups = groups;
    const seen = new Set<string>();
    let testCount = 0;
    let totalScore = 0;
    let correctAnswers = 0;
    let totalQuestions = 0;
    for (const selectedId of selectedGroupChartIds) {
      const rollup = getGroupIdWithDescendants(selectedId, historyGroups, { activeOnly: false });
      for (const result of groupPerformanceResults) {
        const gid = result.session.config?.groupId;
        if (!gid || !rollup.has(gid)) continue;
        const key = result.session.id || result.id || String(result.session.startTime);
        if (seen.has(key)) continue;
        seen.add(key);
        testCount++;
        totalScore += result.score;
        correctAnswers += result.correctAnswersCount;
        totalQuestions += result.totalQuestions;
      }
    }
    return {
      testCount,
      averageScore: testCount > 0 ? totalScore / testCount : 0,
      accuracy: totalQuestions > 0 ? (correctAnswers / totalQuestions) * 100 : 0,
    };
  }, [selectedGroupPerformance, selectedGroupChartIds, groups, groupPerformanceResults]);

  const recentPeriodBounds = useMemo(() => {
    if (selectedTimePeriod === 'allTime') return { from: undefined as string | undefined, to: undefined as string | undefined };
    if (selectedTimePeriod === 'custom') {
      if (!customStartDate || !customEndDate) return { from: undefined, to: undefined };
      return {
        from: new Date(customStartDate + 'T00:00:00').toISOString(),
        to: new Date(customEndDate + 'T23:59:59.999').toISOString(),
      };
    }
    const days =
      selectedTimePeriod === 'last7Days' ? 7 : selectedTimePeriod === 'last30Days' ? 30 : 90;
    const from = new Date();
    from.setDate(from.getDate() - days);
    from.setHours(0, 0, 0, 0);
    return { from: from.toISOString(), to: undefined };
  }, [selectedTimePeriod, customStartDate, customEndDate]);

  useEffect(() => {
    setRecentPage(1);
  }, [recentSort, selectedTimePeriod, customStartDate, customEndDate, recentCourseId, recentTopicId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setRecentLoading(true);
      try {
        const { data, pagination } = await fetchTestResultsPage(currentUser.id, {
          page: recentPage,
          limit: RECENT_TESTS_PAGE_SIZE,
          lean: true,
          sort: recentSort,
          from: recentPeriodBounds.from,
          to: recentPeriodBounds.to,
          courseId: recentCourseId,
          topicId: recentTopicId,
        });
        if (!cancelled) {
          setRecentPageData(data as TestResult[]);
          setRecentTotal(pagination.total ?? 0);
        }
      } catch (error) {
        console.error('Failed to load recent tests page', error);
        if (!cancelled) {
          setRecentPageData([]);
          setRecentTotal(0);
        }
      } finally {
        if (!cancelled) setRecentLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [
    currentUser.id,
    recentPage,
    recentSort,
    recentPeriodBounds.from,
    recentPeriodBounds.to,
    recentCourseId,
    recentTopicId,
  ]);

  const recentTotalPages = Math.max(1, Math.ceil(recentTotal / RECENT_TESTS_PAGE_SIZE));

  const hydrateRecentTestResult = useCallback(async (result: TestResult): Promise<TestResult> => {
    const sessionId = result.session?.id || result.id;
    const hasQuestions =
      Array.isArray(result.session?.questions) && result.session.questions.length > 0;
    const hasAnswers =
      !!result.session?.userAnswers && Object.keys(result.session.userAnswers).length > 0;
    if ((hasQuestions && hasAnswers) || !sessionId) {
      return result;
    }
    const full = await fetchTestSessionById(sessionId);
    if (!full?.session?.questions?.length) {
      return result;
    }
    return {
      ...result,
      ...full,
      session: {
        ...result.session,
        ...full.session,
        questions: full.session.questions,
        userAnswers: full.session.userAnswers || {},
      },
      score: result.score ?? full.score ?? 0,
      totalQuestions: result.totalQuestions ?? full.totalQuestions ?? full.session.questions.length,
      correctAnswersCount:
        result.correctAnswersCount ??
        full.correctAnswersCount ??
        Object.values(full.session.userAnswers || {}).filter((a) => a?.isCorrect).length,
    };
  }, []);

  const handleViewRecentAnalysis = useCallback(
    async (result: TestResult) => {
      onViewAnalysis(await hydrateRecentTestResult(result));
    },
    [hydrateRecentTestResult, onViewAnalysis]
  );

  const handleViewRecentReview = useCallback(
    async (result: TestResult) => {
      if (!onViewTestResult) {
        onViewAnalysis(await hydrateRecentTestResult(result));
        return;
      }
      onViewTestResult(await hydrateRecentTestResult(result));
    },
    [hydrateRecentTestResult, onViewAnalysis, onViewTestResult]
  );


  // --- Study streak calculation ---
  const studyStreak = useMemo(() => {
    const days = new Set<string>();
    filteredTestResults.forEach(r => {
      days.add(toDateOnlyLocal(new Date(r.session.startTime)));
    });
    let streak = 0;
    const today = new Date();
    for (let i = 0; i < 365; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      if (days.has(toDateOnlyLocal(d))) {
        streak++;
      } else if (i > 0) {
        break;
      }
    }
    return streak;
  }, [filteredTestResults]);

  const dashboardScrollRef = useRef<HTMLDivElement>(null);
  const dashboardScrollTopRef = useRef(0);

  // Chart remounts / layout thrash were resetting scrollTop; restore after paint.
  useLayoutEffect(() => {
    const el = dashboardScrollRef.current;
    if (!el) return;
    if (Math.abs(el.scrollTop - dashboardScrollTopRef.current) > 1) {
      el.scrollTop = dashboardScrollTopRef.current;
    }
  });

  return (
    <div
      ref={dashboardScrollRef}
      onScroll={(e) => {
        dashboardScrollTopRef.current = e.currentTarget.scrollTop;
      }}
      className="flex-1 min-h-0 flex flex-col bg-transparent text-lantern-text overflow-y-auto overscroll-y-none"
      style={{ overflowAnchor: 'none' }}
    >
      {/* ─── Daily Login Bonus Banner ─── */}
      {showDailyBonus && (
        <div className="bg-gradient-to-r from-lantern-accent to-amber-500 text-white px-4 py-3 flex items-center justify-between gap-3 shadow-lantern-md">
          <div className="flex items-center gap-3">
            <span className="text-2xl" aria-hidden>🔥</span>
            <div>
              <p className="font-bold text-sm leading-tight tracking-tight">
                Day {streakData.streak} streak! +{bonusXP} XP bonus claimed!
              </p>
              <p className="text-orange-50/90 text-xs">
                {streakData.streak >= 7
                  ? `${streakData.streak} days in a row — incredible! Keep it up!`
                  : streakData.streak >= 3
                  ? `${streakData.streak} days strong! Reach 7 days for a bigger reward.`
                  : 'Come back tomorrow to grow your streak!'}
              </p>
            </div>
          </div>
          <button
            onClick={dismissBonus}
            className="flex-shrink-0 p-1.5 rounded-full hover:bg-white/20 transition-colors"
            aria-label="Dismiss bonus notification"
          >
            <XMarkIcon className="w-4 h-4 text-white" />
          </button>
        </div>
      )}
      
      {/* ─── Academic profile setup nudge (Phase 1) ─── */}
      <AcademicSetupBanner currentUser={currentUser} />

      {/* ═══════════════ HERO ═══════════════ */}
      <DashboardHero
        userName={getDashboardFirstName({
          firstName: currentUser.firstName,
          name: currentUser.name,
          username: currentUser.username,
        })}
        streak={displayStreak}
        points={currentUser.points}
        xpLevel={xpInfo.level}
        xpTitle={xpInfo.title}
        xpProgressPercent={xpInfo.progressPercent}
        pointsToNextLevel={xpInfo.pointsToNextLevel}
        dueCardsCount={dueCardsCount}
        totalTestsTaken={totalTestsTakenOverall}
        onPrimaryAction={() => {
          if (dueCardsCount > 0 && onReviewDueCards) onReviewDueCards();
          else if (onNavigateToAITools) onNavigateToAITools();
          else if (onOpenImportAndStudy) onOpenImportAndStudy();
        }}
        activeTestSession={activeTestSession}
        activeStudySession={activeStudySession}
        onResumeSession={onResumeSession}
        lowDataMode={lowDataMode}
      />

      <div className="px-4 md:px-8 mt-4 w-full">
        <div className="w-full">
          <GettingStartedChecklist
            hasDecks={deckCount > 0}
            hasTests={rawTestResults.length > 0}
            hasGroups={groups.length > 0}
            hasBudget={hasBudgetSet}
            hasOpenedLibrary={hasOpenedLibrary}
            hasTriedCompanion={hasTriedCompanion}
            hasSubmittedQuestion={hasSubmittedQuestion}
            hasExploredMarketplace={hasExploredMarketplace}
            hasTriedOffline={hasTriedOffline}
            onCreateDeck={() => {
              if (onOpenCreateDeck) onOpenCreateDeck();
              else onNavigateToFlashcards?.();
            }}
            onTakeTest={() => {
              if (onNavigateToStudyHub) onNavigateToStudyHub();
              else if (groups[0]?.id && onOpenQuickTest) onOpenQuickTest(groups[0].id);
            }}
            onJoinGroup={() => {
              if (onNavigateToCreateGroup) onNavigateToCreateGroup();
              else onNavigateToChat?.();
            }}
            onSetBudget={() => onNavigateToBudget?.()}
            onOpenLibrary={() => onNavigateToLibrary?.() || onNavigateToFlashcards?.()}
            onTryCompanion={() => onToggleCompanion?.()}
            onSubmitQuestion={() => onNavigateToChat?.()}
            onExploreMarketplace={() => onNavigateToMarketplace?.()}
            onTryOffline={() => onNavigateToOffline?.()}
          />
        </div>
      </div>

      {/* Secondary quick links */}
      <div className="px-4 md:px-8 -mt-2 w-full">
        <DashboardQuickLinks
          dueCardsCount={dueCardsCount}
          onNavigateToAITools={onNavigateToAITools}
          onNavigateToNotes={onNavigateToNotes}
          onNavigateToFlashcards={onNavigateToFlashcards}
          onNavigateToMarketplace={onNavigateToMarketplace}
        />
      </div>

      {/* ═══════════════ MAIN CONTENT ═══════════════ */}
      <div className="px-4 md:px-8 py-6 w-full space-y-6">

        {!questsLoaded && dailyQuests.length === 0 && <SkeletonStatRow />}

        {(dailyQuests.length > 0 || questsLoaded) && (
          <DailyQuestsWidget
            quests={dailyQuests.map((q) => ({
              id: q.id,
              questType: (q as any).questType ?? (q as any).quest_type,
              targetCount: (q as any).targetCount ?? (q as any).target_count,
              progressCount: (q as any).progressCount ?? (q as any).progress_count,
              completed: q.completed,
              rewardXp: (q as any).rewardXp ?? (q as any).reward_xp,
            }))}
            streak={displayStreak}
            streakFreezes={streakFreezes}
            onPurchaseStreakFreeze={onPurchaseStreakFreeze}
            questsLoaded={questsLoaded}
            onRefresh={onRefreshGamification}
            theme={theme}
          />
        )}

        {/*
          Phase 3 M: the academic feed is a PRIMARY surface, so it sits above
          "Progress & analytics" rather than inside it — that section is
          collapsed by default and unmounts its children, and a feed nobody
          sees is not a feed. Fetches and fails independently: it cannot blank
          the dashboard if /feed is unavailable.
        */}
        <div className="mb-6">
          <AcademicFeedPanel onNavigate={onNavigateFromFeed} />
        </div>

        <DashboardProgress defaultOpen={false}>
        {/* ─── Stat Cards Row ─── */}
        <DashboardStatGrid
          items={[
            {
              label: 'Tests Taken',
              value: totalTestsTakenOverall,
              icon: <ChartBarIcon className="w-5 h-5 text-lantern-primary" />,
              iconBgClass: 'bg-lantern-primary-background',
            },
            {
              label: 'Avg. Time/Q',
              value: overallAverageTimePerQuestion > 0 ? `${overallAverageTimePerQuestion.toFixed(0)}s` : '—',
              icon: <ClockIcon className="w-5 h-5 text-lantern-accent" />,
              iconBgClass: 'bg-lantern-accent-background',
            },
            {
              label: 'Groups',
              value: groups.length,
              icon: <UsersIcon className="w-5 h-5 text-lantern-success" />,
              iconBgClass: 'bg-lantern-success/15',
            },
            {
              label: 'Cards Due',
              value: dueCardsCount,
              icon: <RectangleStackIcon className="w-5 h-5 text-lantern-warning" />,
              iconBgClass: 'bg-lantern-warning/15',
            },
          ]}
        />

        {pausedSessions.length > 0 && onResumePausedSession && onAbandonPausedSession ? (
          <SavedSessionsList
            sessions={pausedSessions}
            onResume={onResumePausedSession}
            onDiscard={onAbandonPausedSession}
          />
        ) : (activeTestSession || activeStudySession) && onResumeSession ? (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-4 flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-amber-800 dark:text-amber-300">
                {activeTestSession ? 'Test in progress' : 'Study session in progress'}
              </p>
              <p className="text-sm text-amber-700 dark:text-amber-400">
                Pick up where you left off — progress is saved to your account when online.
              </p>
            </div>
            <Button onClick={onResumeSession}>
              <PlayIcon className="w-4 h-4 mr-1" />
              Resume
            </Button>
          </div>
        ) : null}

        {onStartDailyQuiz && onDailyQuizAnswer && onCompleteDailyQuiz && onStudyGoalChange && (
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
        )}

        <DailyGoalsProgress
          study={normalizeUserSettings(currentUser.settings).study}
          activityDays={studyActivityDays}
        />

        <DashboardSummaryRow
          dueCardsCount={dueCardsCount}
          pendingSyncCount={pendingSyncCount}
          unreadNotificationCount={unreadNotificationCount}
        />

        {/* ─── AI Study Coach ─── */}
        {onGetStudyRecommendations && (
          <Card padding="md">
            {lowDataMode ? (
              <p className="text-sm text-lantern-text-secondary flex items-center gap-2">
                <SparklesIcon className="w-5 h-5 text-lantern-primary shrink-0" />
                {syncCopy.lowDataAiHint}
              </p>
            ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-lantern-text flex items-center">
                <SparklesIcon className="w-5 h-5 mr-2 text-lantern-primary" />
                AI Study Coach
              </h2>
              <button
                onClick={async () => {
                  setIsCoachLoading(true);
                  // recentScores stays TEST-derived — that is what it claims to be.
                  const recentScores = analysisData.strongestTopics
                    .concat(analysisData.weakestTopics)
                    .map(t => ({ topic: t.tag, score: t.accuracy, date: new Date().toISOString() }));
                  // Flashcard accuracy = mature / reviewed cards per deck from the
                  // SRS state already in the store (topic = deck name). When no
                  // card has been reviewed the field is OMITTED rather than
                  // filled with test accuracy under the flashcard name.
                  const flashcardAccuracy = buildFlashcardAccuracyByDeck(decks, flashcards);
                  // Days studied in the last 7 days, from the same
                  // /dashboard/summary activity data the heatmap shows. Only if
                  // no activity data is loaded do we fall back to the
                  // test-derived streak, capped at the 7-day window.
                  const studyDaysThisWeek =
                    studyActivityDays.length > 0
                      ? countActiveDaysInLastWeek(studyActivityDays)
                      : Math.min(studyStreak, 7);
                  const result = await onGetStudyRecommendations({
                    recentScores,
                    ...(flashcardAccuracy.length > 0 ? { flashcardAccuracy } : {}),
                    studyDaysThisWeek,
                  });
                  if (result) setAiCoachData(result);
                  setIsCoachLoading(false);
                }}
                disabled={isCoachLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-lantern-primary bg-lantern-primary-background hover:bg-lantern-primary/10 border border-lantern-primary/30 rounded-lantern transition-colors disabled:opacity-50"
              >
                {isCoachLoading ? 'Analyzing...' : aiCoachData ? 'Refresh' : 'Get Recommendations'}
              </button>
            </div>
            {aiCoachData ? (
              <div className="space-y-3">
                <div className="p-3 bg-lantern-primary-background rounded-lantern">
                  <p className="text-sm font-medium text-lantern-primary mb-1">💡 Study Tip</p>
                  <p className="text-sm text-lantern-text">{aiCoachData.studyTip}</p>
                </div>
                {aiCoachData.weakTopics.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-lantern-text-secondary mb-1">Focus Areas</p>
                    <div className="flex flex-wrap gap-1.5">
                      {aiCoachData.weakTopics.map((topic, i) => (
                        <span key={i} className="px-2 py-1 text-xs bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-md">
                          {topic}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <p className="text-xs text-lantern-text-secondary">
                  ⏱ Estimated study time: <span className="font-semibold">{aiCoachData.estimatedMinutes} min</span>
                </p>
              </div>
            ) : (
              <p className="text-sm text-lantern-text-secondary">
                Click "Get Recommendations" to receive personalized study tips based on your performance.
              </p>
            )}
          </>
            )}
          </Card>
        )}

        {/* ─── Activity Heatmap & Filter ─── */}
        <div className="bg-lantern-surface/95 rounded-lantern-xl shadow-lantern border border-lantern-border overflow-hidden">
          <div className="p-4 md:p-5 border-b border-lantern-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h2 className="text-lg font-semibold text-lantern-text flex items-center">
              <CalendarDaysIcon className="w-5 h-5 mr-2 text-emerald-500" />
              Study Activity
            </h2>
            <div className="flex items-center gap-2">
              <FunnelIcon className="w-4 h-4 text-lantern-text-tertiary" />
              <select
                value={selectedTimePeriod}
                onChange={(e) => setSelectedTimePeriod(e.target.value as TimePeriodOptionValue)}
                className="text-sm p-1.5 bg-lantern-surface border border-lantern-border text-lantern-text focus:ring-lantern-primary focus:border-lantern-primary"
              >
                {timePeriodOptions.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          </div>
          {selectedTimePeriod === 'custom' && (
            <div className="px-4 py-3 bg-lantern-background-secondary border-b border-lantern-border">
              <div className="flex flex-col sm:flex-row gap-3">
                <div>
                  <label className="block text-xs text-lantern-text-secondary mb-0.5">Start Date</label>
                  <input type="date" value={customStartDate} onChange={(e) => setCustomStartDate(e.target.value)}
                    className="p-1.5 text-sm border border-lantern-border rounded-lantern bg-lantern-surface text-lantern-text focus:ring-lantern-primary focus:border-lantern-primary"
                    max={customEndDate || undefined} />
                </div>
                <div>
                  <label className="block text-xs text-lantern-text-secondary mb-0.5">End Date</label>
                  <input type="date" value={customEndDate} onChange={(e) => setCustomEndDate(e.target.value)}
                    className="p-1.5 text-sm border border-lantern-border rounded-lantern bg-lantern-surface text-lantern-text focus:ring-lantern-primary focus:border-lantern-primary"
                    min={customStartDate || undefined} />
                </div>
              </div>
            </div>
          )}
          <div className="p-4 md:p-5 overflow-x-auto min-w-0">
            <StudyHeatmap data={heatmapData} theme={theme} />
          </div>
        </div>

        {/* ─── Two-Column Layout: Achievements + Analysis ─── */}
        {/*
          Phase 3 P: the server-side mastery graph. This one belongs inside
          "Progress & analytics" — it IS topic analytics, and it sits next to
          Achievements & Topic Insights. The FEED does not belong here and is
          rendered above, outside the collapsible.
        */}
        <div className="mb-6">
          <MasteryPanel />
        </div>

        <details open className="group">
          <summary className="bg-lantern-surface/95 rounded-lantern-xl shadow-lantern border border-lantern-border p-4 md:p-5 cursor-pointer list-none flex items-center justify-between select-none hover:bg-lantern-background-secondary/60 transition-colors">
            <h2 className="text-lg font-semibold text-lantern-text flex items-center">
              <TrophyIcon className="w-5 h-5 mr-2 text-yellow-500" />
              Achievements &amp; Topic Insights
            </h2>
            <ChevronDownIcon className="w-5 h-5 text-lantern-text-tertiary transition-transform group-open:rotate-180" />
          </summary>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-3">
          
          {/* Achievements Card */}
          <div className="bg-lantern-surface/95 rounded-lantern-xl shadow-lantern border border-lantern-border">
            <div className="p-4 md:p-5 border-b border-lantern-border">
              <h2 className="text-lg font-semibold text-lantern-text flex items-center">
                <TrophyIcon className="w-5 h-5 mr-2 text-yellow-500" />
                Achievements
              </h2>
            </div>
            <div className="p-4 space-y-3 max-h-[400px] overflow-y-auto">
              {highestLevelBadges.map(({ definition, userBadge }) => {
                const currentLevel = userBadge?.level || 0;
                const nextLevelInfo = definition.levels.find(l => l.level === currentLevel + 1);
                const isRisingStar = definition.id === 'RISING_STAR';
                
                let progress = 0;
                let progressText = "0 / 0";
                if (nextLevelInfo && definition.metric !== 'question_upvotes') {
                    const metric = definition.metric;
                    const currentStatValue = currentUser.stats[metric] || 0;
                    const startOfLevel = definition.levels.find(l=>l.level === currentLevel)?.threshold || 0;
                    progress = ((currentStatValue - startOfLevel) / (nextLevelInfo.threshold - startOfLevel)) * 100;
                    progressText = `${currentStatValue} / ${nextLevelInfo.threshold}`;
                } else if (!nextLevelInfo) {
                    progress = 100;
                    progressText = "Max Level!";
                }

                return (
                  <div key={definition.id} className="flex items-center gap-3 p-3 bg-lantern-background-secondary rounded-lg">
                    <span className="text-3xl flex-shrink-0">{definition.icon}</span>
                    <div className="flex-grow min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="font-semibold text-sm text-lantern-text truncate">{userBadge ? userBadge.name : definition.baseName}</p>
                        {userBadge && <span className="text-xs bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400 px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ml-2">Lv.{userBadge.level}</span>}
                      </div>
                      {isRisingStar ? (
                        nextLevelInfo ? (
                          <p className="text-xs text-lantern-text-secondary mt-0.5">
                            Goal: {nextLevelInfo.threshold} upvotes on one question
                          </p>
                        ) : (
                          <p className="text-xs text-green-500 font-semibold mt-0.5">Max Level!</p>
                        )
                      ) : (
                        <div className="mt-1.5">
                          <div className="flex justify-between text-[10px] text-lantern-text-secondary mb-0.5">
                            <span>{progressText}</span>
                          </div>
                          <div className="w-full bg-lantern-background-secondary rounded-full h-1.5">
                            <div className="bg-lantern-primary h-1.5 rounded-full transition-all duration-500" style={{ width: `${Math.min(progress, 100)}%` }}></div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Topic Performance Card */}
          <div className="bg-lantern-surface/95 rounded-lantern-xl shadow-lantern border border-lantern-border">
            <div className="p-4 md:p-5 border-b border-lantern-border">
              <h2 className="text-lg font-semibold text-lantern-text flex items-center">
                <TagIcon className="w-5 h-5 mr-2 text-lantern-primary" />
                Topic Insights
              </h2>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <h4 className="text-xs font-semibold uppercase text-emerald-600 dark:text-emerald-400 tracking-wider mb-2">Strongest</h4>
                <div className="space-y-1.5">
                  {analysisData.strongestTopics.length > 0 ? analysisData.strongestTopics.map(topic => (
                    <div key={topic.tag} className="flex items-center justify-between p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg">
                      <span className="text-sm text-lantern-text truncate pr-2">{topic.tag}</span>
                      <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 flex-shrink-0">{topic.accuracy.toFixed(0)}%</span>
                    </div>
                  )) : <p className="text-xs text-lantern-text-tertiary italic">Not enough data yet.</p>}
                </div>
              </div>
              <div>
                <h4 className="text-xs font-semibold uppercase text-red-600 dark:text-red-400 tracking-wider mb-2">Needs Work</h4>
                <div className="space-y-1.5">
                  {analysisData.weakestTopics.length > 0 ? analysisData.weakestTopics.map(topic => (
                    <div key={topic.tag} className="flex items-center justify-between p-2 bg-red-50 dark:bg-red-900/20 rounded-lg">
                      <span className="text-sm text-lantern-text truncate pr-2">{topic.tag}</span>
                      <span className="text-sm font-bold text-red-600 dark:text-red-400 flex-shrink-0">{topic.accuracy.toFixed(0)}%</span>
                    </div>
                  )) : <p className="text-xs text-lantern-text-tertiary italic">Not enough data yet.</p>}
                </div>
              </div>
              <div>
                <h4 className="text-xs font-semibold uppercase text-lantern-primary tracking-wider mb-2">Speed by Type</h4>
                <div className="space-y-1.5">
                  {analysisData.speedAnalysis.length > 0 ? analysisData.speedAnalysis.map(item => (
                    <div key={item.type} className="flex items-center justify-between p-2 bg-lantern-primary-background rounded-lantern">
                      <span className="text-sm text-lantern-text">{getQuestionTypeLabel(item.type)}</span>
                      <span className="text-sm font-bold text-lantern-primary flex-shrink-0">{item.avgTime.toFixed(1)}s</span>
                    </div>
                  )) : <p className="text-xs text-lantern-text-tertiary italic">No time data available.</p>}
                </div>
              </div>
            </div>
          </div>
          </div>
        </details>

        </DashboardProgress>

        {/* ─── Troublesome Questions ─── */}
        {troublesomeQuestions.length > 0 && (
          <details open className="group">
            <summary className="bg-lantern-surface/95 rounded-lantern-xl shadow-lantern border border-lantern-border p-4 md:p-5 cursor-pointer list-none flex items-center justify-between select-none hover:bg-lantern-background-secondary/60 transition-colors">
              <h2 className="text-lg font-semibold text-lantern-text flex items-center">
                <ExclamationTriangleIcon className="w-5 h-5 mr-2 text-amber-500" />
                Questions to Review
              </h2>
              <ChevronDownIcon className="w-5 h-5 text-lantern-text-tertiary transition-transform group-open:rotate-180" />
            </summary>
            <div className="divide-y divide-lantern-border mt-3 bg-lantern-surface/95 rounded-lantern-xl shadow-lantern border border-lantern-border">
              {troublesomeQuestions.map(q => (
                <div key={q.id} className="p-4 flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-sm font-bold text-amber-600 dark:text-amber-400">{q.accuracy.toFixed(0)}%</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-lantern-text whitespace-pre-wrap break-words">{q.stem}</p>
                    <p className="text-xs text-lantern-text-tertiary mt-1">{q.incorrectAttempts} incorrect attempt{q.incorrectAttempts !== 1 ? 's' : ''}</p>
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}

        {/* ─── Group performance (unified multi-select chart) ─── */}
        <div className="bg-lantern-surface/95 rounded-lantern-xl shadow-lantern border border-lantern-border overflow-hidden">
          <div className="p-4 md:p-5 border-b border-lantern-border">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-lantern-text flex items-center">
                  <PresentationChartBarIcon className="w-5 h-5 mr-2 text-lantern-primary" />
                  Group performance
                </h2>
                <p className="text-xs text-lantern-text-secondary mt-1">
                  Select one or more groups or subgroups. Archived groups are included, since their tests still count towards your totals. Metrics follow the period you pick below.
                </p>
              </div>
              {/* min-w-0 + wrap, not flex-shrink-0: sm: is viewport-based, so
                  with the sidebar docked this row lives in a ~460px column at
                  a 768px viewport — refusing to shrink pushed the chart-mode
                  toggle past the card edge where it couldn't be clicked. */}
              <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:items-center min-w-0">
                <label className="inline-flex items-center gap-1.5 min-w-0">
                  <span className="sr-only">Group performance period</span>
                  <FunnelIcon className="w-4 h-4 text-lantern-text-tertiary shrink-0" aria-hidden />
                  <select
                    value={groupPerfPeriod}
                    onChange={(e) => handleGroupPerfPeriodChange(e.target.value as GroupPerformancePeriod)}
                    aria-label="Group performance period"
                    className="min-h-[36px] text-xs sm:text-sm p-1.5 rounded-lg bg-lantern-surface border border-lantern-border text-lantern-text focus:ring-lantern-primary focus:border-lantern-primary"
                  >
                    {GROUP_PERFORMANCE_PERIOD_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <GroupPerformanceMultiSelect
                  options={activeGroupChartOptions}
                  selectedIds={selectedGroupChartIds}
                  onChange={handleSelectedGroupChartIdsChange}
                  disabled={activeGroupChartOptions.length === 0}
                />
                {!isMultiGroupChart && selectedGroupPerformance.length === 1 && (
                  <div className="flex justify-end gap-0">
                    <button
                      type="button"
                      onClick={() => setChartDisplayMode('line')}
                      className={`px-3 py-2 text-xs rounded-l-lg border transition-colors ${
                        chartDisplayMode === 'line'
                          ? 'bg-lantern-primary text-white border-lantern-primary'
                          : 'bg-lantern-surface border-lantern-border text-lantern-text-secondary'
                      }`}
                    >
                      Timeline
                    </button>
                    <button
                      type="button"
                      onClick={() => setChartDisplayMode('bar')}
                      className={`px-3 py-2 text-xs rounded-r-lg border transition-colors ${
                        chartDisplayMode === 'bar'
                          ? 'bg-lantern-primary text-white border-lantern-primary'
                          : 'bg-lantern-surface border-lantern-border text-lantern-text-secondary'
                      }`}
                    >
                      Weekly
                    </button>
                  </div>
                )}
              </div>
            </div>
            {isMultiGroupChart && (
              <p className="text-[11px] text-lantern-text-tertiary mt-2">
                Comparing multiple groups uses weekly averages so different test dates line up.
              </p>
            )}
            {selectionIncludesParentRollup && (
              <p className="text-[11px] text-lantern-text-tertiary mt-1">
                Parent includes subgroup tests in its series.
              </p>
            )}
          </div>

          {activeGroupChartOptions.length === 0 ? (
            <div className="p-8 text-center">
              <UsersIcon className="w-12 h-12 text-lantern-text-tertiary mx-auto mb-3" />
              <p className="text-sm text-lantern-text-tertiary">
                {groupPerformanceResults.length === 0
                  ? 'No group tests in this period. Try a wider range or All Time.'
                  : 'Take a test in an active group to see performance here.'}
              </p>
            </div>
          ) : selectedGroupPerformance.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-lantern-text-tertiary">
                Select one or more groups from the dropdown to view the chart.
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-px bg-lantern-border">
                <div className="bg-lantern-surface p-3 text-center">
                  <p className="text-xs text-lantern-text-secondary">Tests</p>
                  <p className="text-lg font-bold text-lantern-text">{selectedGroupsSummary.testCount}</p>
                </div>
                <div className="bg-lantern-surface p-3 text-center">
                  <p className="text-xs text-lantern-text-secondary">Avg Score</p>
                  <p className="text-lg font-bold text-lantern-text">
                    {selectedGroupsSummary.averageScore.toFixed(1)}%
                  </p>
                </div>
                <div className="bg-lantern-surface p-3 text-center">
                  <p className="text-xs text-lantern-text-secondary">Accuracy</p>
                  <p className="text-lg font-bold text-lantern-text">
                    {selectedGroupsSummary.accuracy.toFixed(1)}%
                  </p>
                </div>
              </div>
              <div className="p-4">
                {lowDataMode ? (
                  <div className="py-4 text-center text-sm text-lantern-text-secondary bg-lantern-background-secondary rounded-lantern space-y-1">
                    <p className="font-medium">Chart hidden in Low-Data Mode</p>
                    {selectedGroupPerformance.map((group) => (
                      <p key={group.id} className="text-xs">
                        {group.name}: {group.averageScore.toFixed(1)}% avg across {group.testCount}{' '}
                        test{group.testCount !== 1 ? 's' : ''}
                      </p>
                    ))}
                  </div>
                ) : unifiedChartDatasets ? (
                  <GroupPerformanceChart
                    datasets={unifiedChartDatasets}
                    theme={theme}
                    type={effectiveChartMode}
                  />
                ) : null}
                {selectedGroupPerformance.length > 1 && (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead>
                        <tr className="text-lantern-text-secondary border-b border-lantern-border">
                          <th className="py-1.5 pr-3 font-medium">Group</th>
                          <th className="py-1.5 pr-3 font-medium">Tests</th>
                          <th className="py-1.5 pr-3 font-medium">Avg</th>
                          <th className="py-1.5 font-medium">Accuracy</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedGroupPerformance.map((group) => (
                          <tr key={group.id} className="border-b border-lantern-border/60 last:border-0">
                            <td className="py-1.5 pr-3 text-lantern-text font-medium">{group.name}</td>
                            <td className="py-1.5 pr-3 text-lantern-text-secondary">{group.testCount}</td>
                            <td className="py-1.5 pr-3 text-lantern-primary font-semibold">
                              {group.averageScore.toFixed(1)}%
                            </td>
                            <td className="py-1.5 text-lantern-text-secondary">
                              {group.accuracy.toFixed(1)}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* ─── Recent Tests ─── */}
        <div className="bg-lantern-surface/95 rounded-lantern-xl shadow-lantern border border-lantern-border overflow-hidden">
          <button onClick={toggleRecentTestsExpansion} className="w-full flex items-center justify-between p-4 md:p-5 hover:bg-lantern-background-secondary/60 transition-colors" aria-expanded={isRecentTestsExpanded}>
            <h2 className="text-lg font-semibold text-lantern-text flex items-center">
              <PresentationChartLineIcon className="w-5 h-5 mr-2 text-blue-500" />
              Recent Tests
            </h2>
            {isRecentTestsExpanded ? <ChevronUpIcon className="w-5 h-5 text-lantern-text-tertiary" /> : <ChevronDownIcon className="w-5 h-5 text-lantern-text-tertiary" />}
          </button>
          {isRecentTestsExpanded && (
            <div className="border-t border-lantern-border">
              <div className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-lantern-border bg-lantern-background-secondary/40">
                <label className="flex items-center gap-2 text-xs text-lantern-text-secondary">
                  <span>Sort</span>
                  <select
                    value={recentSort}
                    onChange={(e) => setRecentSort(e.target.value as TestResultsSort)}
                    className="rounded-md border border-lantern-border bg-lantern-surface px-2 py-1 text-xs text-lantern-text"
                  >
                    <option value="newest">Newest</option>
                    <option value="oldest">Oldest</option>
                    <option value="highestScore">Highest score</option>
                  </select>
                </label>
                <p className="text-[11px] text-lantern-text-tertiary">
                  {recentTotal > 0
                    ? `Page ${recentPage} of ${recentTotalPages} · ${recentTotal} test${recentTotal !== 1 ? 's' : ''}`
                    : 'No tests in this period'}
                </p>
              </div>
              {/* The Library's scope, always visible and always clearable: a
                  silently narrowed list reads as missing tests. */}
              {recentCourseId && (
                <div className="px-3 py-2 flex flex-wrap items-center gap-2 border-b border-lantern-border bg-lantern-background-secondary/20 text-[11px] text-lantern-text-secondary">
                  <span>
                    Filtered to{' '}
                    <span className="font-semibold text-lantern-text">
                      {recentCourseId === UNFILED_COURSE_ID
                        ? 'unfiled tests'
                        : resolveRecentCourse(recentCourseId)?.code || 'one course'}
                    </span>
                    {recentTopicId ? (
                      <>
                        {' · '}
                        <span className="font-semibold text-lantern-text">
                          {recentTopicId === UNTOPICED_TOPIC_ID ? 'No topic' : recentTopicLabel || 'Topic'}
                        </span>
                      </>
                    ) : null}
                  </span>
                  {recentTopicId ? (
                    <button
                      type="button"
                      onClick={() => clearRecentTopic(recentCourseId, null)}
                      className="rounded-full border border-lantern-border bg-lantern-surface px-2 py-0.5 font-medium text-lantern-text hover:bg-lantern-background-secondary"
                      title="Show every topic in this course"
                    >
                      Whole course
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => clearRecentCourse(null)}
                    className="inline-flex items-center gap-1 rounded-full border border-lantern-border bg-lantern-surface px-2 py-0.5 font-medium text-lantern-text hover:bg-lantern-background-secondary"
                  >
                    <XMarkIcon className="w-3 h-3" aria-hidden /> Clear
                  </button>
                </div>
              )}
              <div className="divide-y divide-lantern-border">
                {recentLoading ? (
                  <div className="p-8 text-center text-sm text-lantern-text-tertiary">Loading tests…</div>
                ) : recentPageData.length > 0 ? (
                  recentPageData.map((result, index) => {
                    const answers = result.session?.userAnswers || {};
                    const answersWithTime = Object.values(answers).filter(
                      (ans: UserAnswerRecord) => ans?.timeSpentSeconds !== undefined
                    );
                    const testTimeSpentSeconds = answersWithTime.reduce(
                      (sum: number, answer: UserAnswerRecord) => sum + (answer.timeSpentSeconds || 0),
                      0
                    );
                    const avgTime =
                      answersWithTime.length > 0
                        ? (testTimeSpentSeconds / answersWithTime.length).toFixed(1)
                        : null;
                    const recentTestKey =
                      result.id ??
                      `${result.session.startTime}-${result.session.config?.groupId ?? 'group'}-${result.totalQuestions}-${index}`;

                    return (
                      <div
                        key={recentTestKey}
                        className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-lantern-background-secondary transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="font-medium text-sm text-lantern-text truncate">
                            {getGroupName(result.session.config?.groupId, result.session.config?.groupName)}
                          </p>
                          <p className="text-xs text-lantern-text-tertiary mt-0.5">
                            {new Date(result.session.startTime).toLocaleString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-4 flex-shrink-0">
                          <div className="text-center">
                            <p className="text-lg font-bold text-lantern-primary">{result.score.toFixed(1)}%</p>
                            <p className="text-[10px] text-lantern-text-tertiary">
                              {result.correctAnswersCount}/{result.totalQuestions}
                            </p>
                          </div>
                          {avgTime && (
                            <div className="text-center">
                              <p className="text-lg font-bold text-lantern-text-secondary">{avgTime}s</p>
                              <p className="text-[10px] text-lantern-text-tertiary">avg/q</p>
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => void handleViewRecentReview(result)}
                            className="px-3 py-1.5 bg-lantern-background-secondary hover:bg-lantern-border/40 text-lantern-text rounded-lantern text-xs font-semibold flex items-center gap-1 transition-colors border border-lantern-border"
                          >
                            Review
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleViewRecentAnalysis(result)}
                            className="px-3 py-1.5 bg-lantern-primary-background hover:bg-lantern-primary/15 text-lantern-primary rounded-lantern text-xs font-semibold flex items-center gap-1 transition-colors"
                          >
                            <PresentationChartLineIcon className="w-3.5 h-3.5" />
                            Analyze
                          </button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="p-8 text-center">
                    <AcademicCapOutline className="w-12 h-12 text-lantern-text-tertiary mx-auto mb-3" />
                    <p className="text-sm text-lantern-text-tertiary">
                      No tests taken yet. Start a test from one of your groups!
                    </p>
                  </div>
                )}
              </div>
              {recentTotal > RECENT_TESTS_PAGE_SIZE && (
                <div className="p-3 flex items-center justify-between border-t border-lantern-border">
                  <button
                    type="button"
                    disabled={recentPage <= 1 || recentLoading}
                    onClick={() => setRecentPage((p) => Math.max(1, p - 1))}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lantern border border-lantern-border disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={recentPage >= recentTotalPages || recentLoading}
                    onClick={() => setRecentPage((p) => p + 1)}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lantern border border-lantern-border disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

      </div>

      {/* ═══════════════ GROUP PICKER MODAL ═══════════════ */}
      {quickActionPicker && (
        <Modal
          isOpen={Boolean(quickActionPicker)}
          onClose={() => setQuickActionPicker(null)}
          ariaLabelledBy="quick-action-group-picker-title"
          maxWidthClass="max-w-md"
          alignClass="items-end sm:items-center justify-center"
          backdropClassName="backdrop-blur-sm"
          panelClassName="!p-0 overflow-hidden border border-lantern-border bg-lantern-surface rounded-lantern-xl"
        >
          <div className="w-full">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-lantern-border">
              <div className="flex items-center gap-2">
                {quickActionPicker === 'test'
                  ? <BoltIcon className="w-5 h-5 text-yellow-500" />
                  : <AcademicCapOutline className="w-5 h-5 text-emerald-500" />
                }
                <h2 id="quick-action-group-picker-title" className="text-base font-semibold text-lantern-text">
                  Select a group for Quick {quickActionPicker === 'test' ? 'Test' : 'Study'}
                </h2>
              </div>
              <button
                onClick={() => setQuickActionPicker(null)}
                className="p-1.5 rounded-lantern hover:bg-lantern-background-secondary transition-colors"
                aria-label="Close"
              >
                <XMarkIcon className="w-5 h-5 text-lantern-text-secondary" />
              </button>
            </div>

            {/* Group list */}
            <div className="max-h-72 overflow-y-auto divide-y divide-lantern-border">
              {availableGroups.length === 0 ? (
                <p className="text-center text-sm text-lantern-text-tertiary py-8">
                  No groups available. Join or create a group first.
                </p>
              ) : (
                availableGroups.map(group => (
                  <button
                    key={group.id}
                    onClick={() => handleQuickActionGroupSelect(group.id)}
                    className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-lantern-background-secondary transition-colors"
                  >
                    {group.avatarUrl ? (
                      <img
                        src={group.avatarUrl}
                        alt={group.name}
                        className="w-9 h-9 rounded-full object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-lantern-primary-background flex items-center justify-center flex-shrink-0">
                        <UsersIcon className="w-5 h-5 text-lantern-primary" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-lantern-text truncate">{group.name}</p>
                      {group.members && group.members.length > 0 && (
                        <p className="text-xs text-lantern-text-tertiary">{group.members.length} member{group.members.length !== 1 ? 's' : ''}</p>
                      )}
                    </div>
                    {quickActionPicker === 'test'
                      ? <BoltIcon className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                      : <AcademicCapOutline className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    }
                  </button>
                ))
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}