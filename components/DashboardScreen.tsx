

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { TestResult, Group, User, Badge, UserStats, QuestionType, UserQuestionStats, Message, UserAnswerRecord, UserQuestionStat, AppMode, OfflineSessionBundle, DailyQuizSession, StudyGoalMode, TestSessionData, StudySessionData } from '../types';
import DailyQuizWidget from './DailyQuizWidget';
import { DailyGoalsProgress } from './DailyGoalsProgress';
import { normalizeUserSettings } from '@lantern/shared/settings';
import { ChartBarIcon, CalendarDaysIcon, CheckCircleIcon, InformationCircleIcon, UsersIcon, ClockIcon, ArrowLeftIcon, PresentationChartLineIcon, ChevronUpIcon, ChevronDownIcon, FunnelIcon, SparklesIcon, TrophyIcon, RocketLaunchIcon, ClockIcon as ClockOutline, AcademicCapIcon as AcademicCapOutline, TagIcon, PresentationChartBarIcon, ExclamationTriangleIcon, RectangleStackIcon, ShoppingBagIcon, PlusCircleIcon, FireIcon, BoltIcon, BellIcon, XMarkIcon, DocumentTextIcon, PlayIcon } from '@heroicons/react/24/solid';
import GroupPerformanceChart, { ChartDataPoint } from './GroupPerformanceChart';
import { useUIStore } from '../stores/uiStore';
import { ScreenHeader, Card, StatPill, Button, SkeletonStatRow } from './ui';
import { syncCopy } from '@lantern/shared/design';
import { buildActivityMap, formatActivityLocalDate, normalizeTestQuestionForSession, normalizeStoredUserAnswer, getActivityHeatColorForCount, getActivityHeatTailwindClass, type ActivityHeatLevel } from '@lantern/shared/utils';
import type { StudyActivityDay } from '@lantern/shared';
import { BADGE_DEFINITIONS, getXPLevel } from '../gamification';
import { checkAnswerIsCorrect } from '../utils/helpers';
import { useLoginStreak } from '../hooks/useLoginStreak';
import { DailyQuestsWidget } from './DailyQuestsWidget';
import { DashboardHero } from './dashboard/DashboardHero';
import { DashboardProgress } from './dashboard/DashboardProgress';
import { GettingStartedChecklist } from './dashboard/GettingStartedChecklist';

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
  onNavigateToMarketplace?: () => void;
  onNavigateToCreateGroup?: () => void;
  onNavigateToBudget?: () => void;
  onNavigateToStudyHub?: () => void;
  deckCount?: number;
  hasBudgetSet?: boolean;
  dueCardsCount?: number;
  // Flashcard review activity for heatmap
  flashcards?: import('../types').Flashcard[];
  // Today's Summary
  pendingSyncCount?: number;
  unreadNotificationCount?: number;
  // Study flow entry points — called with the selected groupId
  onOpenQuickTest?: (groupId: string) => void;
  onOpenQuickStudy?: (groupId: string) => void;
  onGetStudyRecommendations?: (performanceData: {
    recentScores: { topic: string; score: number; date: string }[];
    flashcardAccuracy: { topic: string; correctRate: number }[];
    studyHoursThisWeek: number;
  }) => Promise<{ weakTopics: string[]; suggestedCards: string[]; suggestedQuestions: string[]; studyTip: string; estimatedMinutes: number } | null>;
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
  onStartDailyQuiz?: () => void;
  onDailyQuizAnswer?: (questionId: string, answer: string) => void;
  onCompleteDailyQuiz?: () => void;
  activeTestSession?: TestSessionData | null;
  activeStudySession?: StudySessionData | null;
  onResumeSession?: () => void;
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
        <div className="flex flex-col items-center gap-2">
            <div className="grid grid-rows-7 grid-flow-col gap-1">
                {days.map(day => {
                    const dateString = formatLocalDate(day);
                    const count = data.get(dateString) || 0;
                    return (
                        <div
                        key={dateString}
                        title={`${count} activit${count !== 1 ? 'ies' : 'y'} on ${day.toLocaleDateString()}`}
                        className={`w-3.5 h-3.5 rounded-sm ${getActivityHeatColorForCount(count, theme)}`}
                        />
                    );
                })}
            </div>
            <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                <span>Less</span>
                {legendLevels.map(level => (
                    <div
                        key={level}
                        className={`w-3 h-3 rounded-sm ${getActivityHeatTailwindClass(level, theme)}`}
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
  onNavigateToMarketplace,
  onNavigateToCreateGroup,
  onNavigateToBudget,
  onNavigateToStudyHub,
  deckCount = 0,
  hasBudgetSet = false,
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
  onStartDailyQuiz,
  onDailyQuizAnswer,
  onCompleteDailyQuiz,
  activeTestSession,
  activeStudySession,
  onResumeSession,
  studyActivityDays = [],
}: DashboardScreenProps) {

  // Group picker state for Quick Test / Quick Study
  const [quickActionPicker, setQuickActionPicker] = useState<'test' | 'study' | null>(null);
  const availableGroups = useMemo(() => groups.filter(g => !g.isArchived), [groups]);

  const handleQuickActionGroupSelect = useCallback((groupId: string) => {
    if (quickActionPicker === 'test') onOpenQuickTest?.(groupId);
    else if (quickActionPicker === 'study') onOpenQuickStudy?.(groupId);
    setQuickActionPicker(null);
  }, [quickActionPicker, onOpenQuickTest, onOpenQuickStudy]);

  // Filter out invalid test results and normalize date fields
  const initialTestResults = useMemo(() => {
    return rawTestResults
      .filter(result => 
        result?.session?.startTime && 
        result?.session?.config &&
        Array.isArray(result?.session?.questions)
      )
      .map(result => ({
        ...result,
        session: {
          ...result.session,
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
  const [isAnalysisExpanded, setIsAnalysisExpanded] = useState(true);
  const [chartDisplayMode, setChartDisplayMode] = useState<'bar' | 'line'>('line');
  const [selectedComparisonGroupIds, setSelectedComparisonGroupIds] = useState<string[]>([]);
  const [aiCoachData, setAiCoachData] = useState<{ weakTopics: string[]; suggestedCards: string[]; suggestedQuestions: string[]; studyTip: string; estimatedMinutes: number } | null>(null);
  const [isCoachLoading, setIsCoachLoading] = useState(false);

  // ── Gamification ──────────────────────────────────────────────────────────
  const { streakData, showDailyBonus, bonusXP, dismissBonus } = useLoginStreak();
  const xpInfo = useMemo(() => getXPLevel(currentUser.points), [currentUser.points]);
  const { lowDataMode } = useUIStore();


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
  
  const totalTestsTakenOverall = filteredTestResults.length;
  
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
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [isRecentTestsExpanded, setIsRecentTestsExpanded] = useState(true);

  useEffect(() => {
    const groupPerformanceMap: Map<string, GroupPerformanceData> = new Map();
    if (totalTestsTakenOverall > 0) {
      filteredTestResults.forEach(result => {
        const groupId = result.session.config.groupId;
        const groupName = getGroupName(groupId, result.session.config.groupName);
        
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
        
        Object.values(result.session.userAnswers).forEach((answer: UserAnswerRecord) => {
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

        const groupSpecificResults = filteredTestResults
          .filter(tr => tr.session.config.groupId === data.id)
          .sort((a, b) => new Date(a.session.startTime).getTime() - new Date(b.session.startTime).getTime());
        
        data.chartData = groupSpecificResults.map((result, index) => {
          const date = new Date(result.session.startTime);
          const formattedDate = `${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}`;
          const formattedTime = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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

    const initialExpandedState: Record<string, boolean> = {};
    performanceDataArray.forEach(groupData => {
      initialExpandedState[groupData.id] = true; 
    });
    setExpandedGroups(initialExpandedState);

  }, [filteredTestResults, groups, totalTestsTakenOverall]);


  const analysisData = useMemo(() => {
    if (filteredTestResults.length === 0) {
        return { strongestTopics: [], weakestTopics: [], speedAnalysis: [] };
    }

    const tagStats: Map<string, { correct: number; total: number }> = new Map();
    const speedStats: Map<QuestionType, { totalTime: number; count: number }> = new Map();

    for (const result of filteredTestResults) {
        // Skip if session or questions is undefined
        if (!result.session?.questions) continue;
        
        for (const question of result.session.questions) {
            const answer = result.session.userAnswers?.[question.id] as UserAnswerRecord | undefined;
            if (!answer) continue;

            const normalizedQuestion = normalizeTestQuestionForSession(question as Record<string, unknown>, 0);
            const normalizedAnswer = normalizeStoredUserAnswer(answer, question.id);

            // Topic performance calculation
            if (question.tags) {
                for (const tag of question.tags) {
                    const stats = tagStats.get(tag) || { correct: 0, total: 0 };
                    const correct = checkAnswerIsCorrect(normalizedQuestion, normalizedAnswer);
                    stats.total++;
                    if (correct) {
                        stats.correct++;
                    }
                    tagStats.set(tag, stats);
                }
            }
            
            // Speed analysis calculation
            if (normalizedQuestion.questionType && normalizedAnswer.timeSpentSeconds !== undefined) {
                const stats = speedStats.get(normalizedQuestion.questionType) || { totalTime: 0, count: 0 };
                stats.totalTime += normalizedAnswer.timeSpentSeconds;
                stats.count++;
                speedStats.set(normalizedQuestion.questionType, stats);
            }
        }
    }
    
    const topicPerformance = Array.from(tagStats.entries())
        .map(([tag, { correct, total }]) => ({
            tag,
            accuracy: total > 0 ? (correct / total) * 100 : 0,
            count: total,
        }))
        .filter(item => item.count >= 2)
        .sort((a, b) => b.accuracy - a.accuracy);

    const strongestTopics = [...topicPerformance].slice(0, 3);
    const weakestTopics = [...topicPerformance].filter(t => t.accuracy < 100).sort((a, b) => a.accuracy - b.accuracy).slice(0, 3);

    const speedAnalysis = Array.from(speedStats.entries())
        .map(([type, { totalTime, count }]) => ({
            type,
            avgTime: count > 0 ? totalTime / count : 0,
        }))
        .sort((a,b) => a.avgTime - b.avgTime);

    return { strongestTopics, weakestTopics, speedAnalysis };

  }, [filteredTestResults]);
  
  const troublesomeQuestions = useMemo(() => {
    // Build question stem map from TWO sources:
    // 1. Test results (always loaded at startup — most reliable)
    // 2. Chat messages (only loaded when a group chat is opened)
    const questionMap = new Map<string, string>();

    // Source 1: test results — each result embeds the full question objects
    for (const result of filteredTestResults) {
      if (!result.session?.questions) continue;
      for (const q of result.session.questions) {
        if (q.questionStem && !questionMap.has(q.id)) {
          questionMap.set(q.id, q.questionStem);
        }
      }
    }

    // Source 2: chat messages (fallback for questions not yet in any test result)
    const allQuestionsList: Message[] = (Object.values(allMessages) as Message[][]).flat().filter((m: Message) => m.type === 'QUESTION');
    allQuestionsList.forEach((q: Message) => {
        if (q.questionStem && !questionMap.has(q.id)) {
            questionMap.set(q.id, q.questionStem);
        }
    });

    return Object.entries(userQuestionStats)
        .filter(([, stats]: [string, UserQuestionStat]) => (stats.incorrectAttempts > 0))
        .map(([questionId, stats]: [string, UserQuestionStat]) => ({
            id: questionId,
            stem: questionMap.get(questionId) || 'Question not found.',
            incorrectAttempts: stats.incorrectAttempts,
            accuracy: (stats.correctAttempts + stats.incorrectAttempts > 0)
                ? (stats.correctAttempts / (stats.correctAttempts + stats.incorrectAttempts)) * 100
                : 0,
        }))
        .sort((a, b) => b.incorrectAttempts - a.incorrectAttempts)
        .slice(0, 5); // Top 5
    }, [filteredTestResults, allMessages, userQuestionStats]);

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

  const simulatedGroupAverages = useMemo(() => {
    const averages = new Map<string, number>();
    filteredTestResults.forEach(result => {
        const key = result.session.startTime.toISOString();
        if (!averages.has(key)) {
            // Generate a random offset between -7 and +10
            const offset = Math.random() * 17 - 7;
            const groupAvg = Math.max(40, Math.min(98, result.score - offset)); // Clamp to a realistic range
            averages.set(key, Math.round(groupAvg));
        }
    });
    return averages;
  }, [filteredTestResults]);

  const toggleGroupExpansion = (groupId: string) => {
    setExpandedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const toggleRecentTestsExpansion = () => {
    setIsRecentTestsExpanded(prev => !prev);
  };
  
  let overallTotalTimeSpent = 0;
  let overallQuestionsWithTime = 0;
  filteredTestResults.forEach(result => {
    Object.values(result.session.userAnswers).forEach((answer: UserAnswerRecord) => {
        if (answer.timeSpentSeconds !== undefined) {
            overallTotalTimeSpent += answer.timeSpentSeconds;
            overallQuestionsWithTime++;
        }
    });
  });
  const overallAverageTimePerQuestion = overallQuestionsWithTime > 0 
    ? (overallTotalTimeSpent / overallQuestionsWithTime)
    : 0;

  const recentTests = [...filteredTestResults].sort((a,b) => new Date(b.session.startTime).getTime() - new Date(a.session.startTime).getTime()).slice(0, 5);

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
  }, [currentUser.badges]);

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
  
  const handleComparisonGroupToggle = (groupId: string) => {
    setSelectedComparisonGroupIds(prev =>
      prev.includes(groupId)
        ? prev.filter(id => id !== groupId)
        : [...prev, groupId]
    );
  };

  const comparisonChartDatasets = useMemo(() => {
    if (selectedComparisonGroupIds.length < 2) {
      return null;
    }

    const selectedGroupsData = allGroupPerformanceData.filter(g =>
      selectedComparisonGroupIds.includes(g.id)
    );

    const allXLabels = new Set<string>();
    selectedGroupsData.forEach(group => {
      group.weeklyChartData.forEach(point => {
        allXLabels.add(point.x);
      });
    });

    const sortedLabels = Array.from(allXLabels).sort();

    const datasets = selectedGroupsData.map(group => {
      const dataMap = new Map(group.weeklyChartData.map(p => [p.x, p.y]));
      const alignedData: ChartDataPoint[] = sortedLabels.map(label => ({
        x: label,
        // FIX: Removed the unnecessary and problematic cast. The nullish coalescing operator is sufficient to handle undefined values.
        y: dataMap.get(label) ?? null,
      }));
      return {
        label: group.name,
        data: alignedData,
      };
    });
    
    return datasets;
  }, [selectedComparisonGroupIds, allGroupPerformanceData]);


  // --- Greeting ---
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  // --- Study streak calculation ---
  const studyStreak = useMemo(() => {
    const days = new Set<string>();
    filteredTestResults.forEach(r => {
      days.add(new Date(r.session.startTime).toISOString().split('T')[0]);
    });
    let streak = 0;
    const today = new Date();
    for (let i = 0; i < 365; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      if (days.has(d.toISOString().split('T')[0])) {
        streak++;
      } else if (i > 0) {
        break;
      }
    }
    return streak;
  }, [filteredTestResults]);

  return (
    <div className="flex-1 flex flex-col bg-transparent text-lantern-text overflow-y-auto">

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
      
      {/* ═══════════════ HERO ═══════════════ */}
      <DashboardHero
        userName={currentUser.firstName || currentUser.name}
        streak={serverStreak || streakData.streak}
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
        primaryActionLabel={
          dueCardsCount > 0 ? `Review ${dueCardsCount} due card${dueCardsCount !== 1 ? 's' : ''}` : 'Import & study'
        }
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
            onCreateDeck={() => onNavigateToFlashcards?.()}
            onTakeTest={() => {
              if (onNavigateToStudyHub) onNavigateToStudyHub();
              else if (groups[0]?.id && onOpenQuickTest) onOpenQuickTest(groups[0].id);
            }}
            onJoinGroup={() => {
              if (onNavigateToCreateGroup) onNavigateToCreateGroup();
              else onNavigateToChat?.();
            }}
            onSetBudget={() => onNavigateToBudget?.()}
          />
        </div>
      </div>

      {/* Secondary quick links */}
      <div className="px-4 md:px-8 -mt-2 w-full">
        <div className="w-full">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {onNavigateToAITools && (
              <Button variant="secondary" className="flex-col h-auto py-3" onClick={onNavigateToAITools}>
                <SparklesIcon className="w-5 h-5 text-amber-600" />
                <span className="text-xs">AI Tools</span>
              </Button>
            )}
            {onNavigateToNotes && (
              <Button variant="secondary" className="flex-col h-auto py-3" onClick={onNavigateToNotes}>
                <DocumentTextIcon className="w-5 h-5 text-indigo-600" />
                <span className="text-xs">Notes</span>
              </Button>
            )}
            <Button variant="secondary" className="flex-col h-auto py-3 relative" onClick={onNavigateToFlashcards}>
              <RectangleStackIcon className="w-5 h-5 text-emerald-600" />
              <span className="text-xs">Flashcards</span>
              {dueCardsCount > 0 && (
                <span className="absolute top-1.5 right-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                  {dueCardsCount > 99 ? '99+' : dueCardsCount}
                </span>
              )}
            </Button>
            <Button variant="secondary" className="flex-col h-auto py-3" onClick={onNavigateToMarketplace}>
              <ShoppingBagIcon className="w-5 h-5 text-purple-600" />
              <span className="text-xs">Explore</span>
            </Button>
          </div>
        </div>
      </div>

      {/* ═══════════════ MAIN CONTENT ═══════════════ */}
      <div className="flex-1 px-4 md:px-8 py-6 w-full space-y-6">

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
            streak={serverStreak || streakData.streak}
            streakFreezes={streakFreezes}
            onPurchaseStreakFreeze={onPurchaseStreakFreeze}
            questsLoaded={questsLoaded}
            onRefresh={onRefreshGamification}
            theme={theme}
          />
        )}

        {filteredTestResults.length > 0 && onViewTestResult && (
          <Card padding="md">
            <h2 className="text-lg font-semibold text-lantern-text mb-3">Recent tests</h2>
            <div className="space-y-2">
              {filteredTestResults.slice(0, 5).map((result) => {
                const score = result.session.questions.length
                  ? Math.round((result.correctCount / result.session.questions.length) * 100)
                  : 0;
                return (
                  <button
                    key={result.session.id}
                    type="button"
                    onClick={() => onViewTestResult(result)}
                    className="w-full flex items-center justify-between p-3 rounded-lg border border-lantern-border hover:border-lantern-primary text-left transition-colors"
                  >
                    <div>
                      <p className="font-medium text-sm text-lantern-text">
                        {new Date(result.session.startTime).toLocaleDateString()} · {result.session.questions.length} questions
                      </p>
                      <p className="text-xs text-lantern-text-secondary">{score}% correct</p>
                    </div>
                    <span className="text-sm font-semibold text-lantern-primary">Review</span>
                  </button>
                );
              })}
            </div>
          </Card>
        )}

        <DashboardProgress defaultOpen={false}>
        {/* ─── Stat Cards Row ─── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <div className="bg-lantern-surface/95 rounded-lantern-xl p-4 shadow-lantern border border-lantern-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center flex-shrink-0">
                <ChartBarIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">Tests Taken</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">{totalTestsTakenOverall}</p>
              </div>
            </div>
          </div>
          <div className="bg-lantern-surface/95 rounded-lantern-xl p-4 shadow-lantern border border-lantern-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center flex-shrink-0">
                <ClockIcon className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">Avg. Time/Q</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">
                  {overallAverageTimePerQuestion > 0 ? `${overallAverageTimePerQuestion.toFixed(0)}s` : '—'}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-lantern-surface/95 rounded-lantern-xl p-4 shadow-lantern border border-lantern-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center flex-shrink-0">
                <UsersIcon className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">Groups</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">{groups.length}</p>
              </div>
            </div>
          </div>
          <div className="bg-lantern-surface/95 rounded-lantern-xl p-4 shadow-lantern border border-lantern-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-orange-100 dark:bg-orange-900/40 flex items-center justify-center flex-shrink-0">
                <RectangleStackIcon className="w-5 h-5 text-orange-600 dark:text-orange-400" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">Cards Due</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">{dueCardsCount}</p>
              </div>
            </div>
          </div>
        </div>

        {(activeTestSession || activeStudySession) && onResumeSession && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-4 flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-amber-800 dark:text-amber-300">
                {activeTestSession ? 'Test in progress' : 'Study session in progress'}
              </p>
              <p className="text-sm text-amber-700 dark:text-amber-400">
                Pick up where you left off — your answers are saved.
              </p>
            </div>
            <Button onClick={onResumeSession}>
              <PlayIcon className="w-4 h-4 mr-1" />
              Resume
            </Button>
          </div>
        )}

        {onStartDailyQuiz && onDailyQuizAnswer && onCompleteDailyQuiz && onStudyGoalChange && (
          <DailyQuizWidget
            theme={theme}
            studyGoal={studyGoal}
            dailyQuiz={dailyQuiz}
            progress={dailyQuizProgress}
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

        {/* ─── Today's Summary ─── */}
        <div className="bg-lantern-surface/95 rounded-lantern-xl shadow-lantern border border-lantern-border p-4 md:p-5">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200 flex items-center mb-4">
            <RocketLaunchIcon className="w-5 h-5 mr-2 text-indigo-500" />
            Today's Summary
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="flex items-center gap-3 p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg">
              <RectangleStackIcon className="w-8 h-8 text-emerald-500 flex-shrink-0" />
              <div>
                <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{dueCardsCount}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Flashcards Due</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
              <ClockOutline className="w-8 h-8 text-amber-500 flex-shrink-0" />
              <div>
                <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">{pendingSyncCount}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Pending Syncs</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
              <BellIcon className="w-8 h-8 text-blue-500 flex-shrink-0" />
              <div>
                <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">{unreadNotificationCount}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Unread Notifications</p>
              </div>
            </div>
          </div>
        </div>

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
              <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200 flex items-center">
                <SparklesIcon className="w-5 h-5 mr-2 text-purple-500" />
                AI Study Coach
              </h2>
              <button
                onClick={async () => {
                  setIsCoachLoading(true);
                  const recentScores = analysisData.strongestTopics
                    .concat(analysisData.weakestTopics)
                    .map(t => ({ topic: t.tag, score: t.accuracy, date: new Date().toISOString() }));
                  const flashcardAccuracy = analysisData.strongestTopics.map(t => ({
                    topic: t.tag,
                    correctRate: t.accuracy / 100,
                  }));
                  const result = await onGetStudyRecommendations({
                    recentScores,
                    flashcardAccuracy,
                    studyHoursThisWeek: studyStreak,
                  });
                  if (result) setAiCoachData(result);
                  setIsCoachLoading(false);
                }}
                disabled={isCoachLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 hover:bg-purple-100 dark:hover:bg-purple-900/40 border border-purple-200 dark:border-purple-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {isCoachLoading ? 'Analyzing...' : aiCoachData ? 'Refresh' : 'Get Recommendations'}
              </button>
            </div>
            {aiCoachData ? (
              <div className="space-y-3">
                <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                  <p className="text-sm font-medium text-purple-700 dark:text-purple-300 mb-1">💡 Study Tip</p>
                  <p className="text-sm text-slate-700 dark:text-slate-300">{aiCoachData.studyTip}</p>
                </div>
                {aiCoachData.weakTopics.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Focus Areas</p>
                    <div className="flex flex-wrap gap-1.5">
                      {aiCoachData.weakTopics.map((topic, i) => (
                        <span key={i} className="px-2 py-1 text-xs bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-md">
                          {topic}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  ⏱ Estimated study time: <span className="font-semibold">{aiCoachData.estimatedMinutes} min</span>
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Click "Get Recommendations" to receive personalized study tips based on your performance.
              </p>
            )}
          </>
            )}
          </Card>
        )}

        {/* ─── Activity Heatmap & Filter ─── */}
        <div className="bg-lantern-surface/95 rounded-lantern-xl shadow-lantern border border-lantern-border overflow-hidden">
          <div className="p-4 md:p-5 border-b border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200 flex items-center">
              <CalendarDaysIcon className="w-5 h-5 mr-2 text-emerald-500" />
              Study Activity
            </h2>
            <div className="flex items-center gap-2">
              <FunnelIcon className="w-4 h-4 text-slate-400" />
              <select
                value={selectedTimePeriod}
                onChange={(e) => setSelectedTimePeriod(e.target.value as TimePeriodOptionValue)}
                className="text-sm p-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:ring-indigo-500 focus:border-indigo-500"
              >
                {timePeriodOptions.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          </div>
          {selectedTimePeriod === 'custom' && (
            <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
              <div className="flex flex-col sm:flex-row gap-3">
                <div>
                  <label className="block text-xs text-slate-600 dark:text-slate-400 mb-0.5">Start Date</label>
                  <input type="date" value={customStartDate} onChange={(e) => setCustomStartDate(e.target.value)}
                    className="p-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
                    max={customEndDate || undefined} />
                </div>
                <div>
                  <label className="block text-xs text-slate-600 dark:text-slate-400 mb-0.5">End Date</label>
                  <input type="date" value={customEndDate} onChange={(e) => setCustomEndDate(e.target.value)}
                    className="p-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
                    min={customStartDate || undefined} />
                </div>
              </div>
            </div>
          )}
          <div className="p-4 md:p-5">
            <StudyHeatmap data={heatmapData} theme={theme} />
          </div>
        </div>

        {/* ─── Two-Column Layout: Achievements + Analysis ─── */}
        <details open className="group">
          <summary className="bg-lantern-surface/95 rounded-lantern-xl shadow-lantern border border-lantern-border p-4 md:p-5 cursor-pointer list-none flex items-center justify-between select-none hover:bg-lantern-background-secondary/60 transition-colors">
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200 flex items-center">
              <TrophyIcon className="w-5 h-5 mr-2 text-yellow-500" />
              Achievements &amp; Topic Insights
            </h2>
            <ChevronDownIcon className="w-5 h-5 text-slate-400 transition-transform group-open:rotate-180" />
          </summary>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-3">
          
          {/* Achievements Card */}
          <div className="bg-lantern-surface/95 rounded-lantern-xl shadow-lantern border border-lantern-border">
            <div className="p-4 md:p-5 border-b border-slate-200 dark:border-slate-700">
              <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200 flex items-center">
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
                  <div key={definition.id} className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-700/40 rounded-lg">
                    <span className="text-3xl flex-shrink-0">{definition.icon}</span>
                    <div className="flex-grow min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="font-semibold text-sm text-slate-800 dark:text-slate-200 truncate">{userBadge ? userBadge.name : definition.baseName}</p>
                        {userBadge && <span className="text-xs bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400 px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ml-2">Lv.{userBadge.level}</span>}
                      </div>
                      {isRisingStar ? (
                        nextLevelInfo ? (
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Goal: {nextLevelInfo.threshold} upvotes on one question
                          </p>
                        ) : (
                          <p className="text-xs text-green-500 font-semibold mt-0.5">Max Level!</p>
                        )
                      ) : (
                        <div className="mt-1.5">
                          <div className="flex justify-between text-[10px] text-slate-500 dark:text-slate-400 mb-0.5">
                            <span>{progressText}</span>
                          </div>
                          <div className="w-full bg-slate-200 dark:bg-slate-600 rounded-full h-1.5">
                            <div className="bg-indigo-500 h-1.5 rounded-full transition-all duration-500" style={{ width: `${Math.min(progress, 100)}%` }}></div>
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
            <div className="p-4 md:p-5 border-b border-slate-200 dark:border-slate-700">
              <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200 flex items-center">
                <TagIcon className="w-5 h-5 mr-2 text-purple-500" />
                Topic Insights
              </h2>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <h4 className="text-xs font-semibold uppercase text-emerald-600 dark:text-emerald-400 tracking-wider mb-2">Strongest</h4>
                <div className="space-y-1.5">
                  {analysisData.strongestTopics.length > 0 ? analysisData.strongestTopics.map(topic => (
                    <div key={topic.tag} className="flex items-center justify-between p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg">
                      <span className="text-sm text-slate-700 dark:text-slate-300 truncate pr-2">{topic.tag}</span>
                      <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 flex-shrink-0">{topic.accuracy.toFixed(0)}%</span>
                    </div>
                  )) : <p className="text-xs text-slate-400 italic">Not enough data yet.</p>}
                </div>
              </div>
              <div>
                <h4 className="text-xs font-semibold uppercase text-red-600 dark:text-red-400 tracking-wider mb-2">Needs Work</h4>
                <div className="space-y-1.5">
                  {analysisData.weakestTopics.length > 0 ? analysisData.weakestTopics.map(topic => (
                    <div key={topic.tag} className="flex items-center justify-between p-2 bg-red-50 dark:bg-red-900/20 rounded-lg">
                      <span className="text-sm text-slate-700 dark:text-slate-300 truncate pr-2">{topic.tag}</span>
                      <span className="text-sm font-bold text-red-600 dark:text-red-400 flex-shrink-0">{topic.accuracy.toFixed(0)}%</span>
                    </div>
                  )) : <p className="text-xs text-slate-400 italic">Not enough data yet.</p>}
                </div>
              </div>
              <div>
                <h4 className="text-xs font-semibold uppercase text-indigo-600 dark:text-indigo-400 tracking-wider mb-2">Speed by Type</h4>
                <div className="space-y-1.5">
                  {analysisData.speedAnalysis.length > 0 ? analysisData.speedAnalysis.map(item => (
                    <div key={item.type} className="flex items-center justify-between p-2 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg">
                      <span className="text-sm text-slate-700 dark:text-slate-300">{getQuestionTypeLabel(item.type)}</span>
                      <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400 flex-shrink-0">{item.avgTime.toFixed(1)}s</span>
                    </div>
                  )) : <p className="text-xs text-slate-400 italic">No time data available.</p>}
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
              <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200 flex items-center">
                <ExclamationTriangleIcon className="w-5 h-5 mr-2 text-amber-500" />
                Questions to Review
              </h2>
              <ChevronDownIcon className="w-5 h-5 text-slate-400 transition-transform group-open:rotate-180" />
            </summary>
            <div className="divide-y divide-slate-100 dark:divide-slate-700/50 mt-3 bg-lantern-surface/95 rounded-lantern-xl shadow-lantern border border-lantern-border">
              {troublesomeQuestions.map(q => (
                <div key={q.id} className="p-4 flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-sm font-bold text-amber-600 dark:text-amber-400">{q.accuracy.toFixed(0)}%</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-700 dark:text-slate-300 line-clamp-2">{q.stem}</p>
                    <p className="text-xs text-slate-400 mt-1">{q.incorrectAttempts} incorrect attempt{q.incorrectAttempts !== 1 ? 's' : ''}</p>
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}

        {/* ─── Performance by Group ─── */}
        {allGroupPerformanceData.length > 0 && (
          <details open className="group/perf">
            <summary className="bg-lantern-surface/95 rounded-lantern-xl shadow-lantern border border-lantern-border p-4 md:p-5 cursor-pointer list-none flex items-center justify-between select-none hover:bg-lantern-background-secondary/60 transition-colors">
              <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200 flex items-center">
                <PresentationChartBarIcon className="w-5 h-5 mr-2 text-indigo-500" />
                Performance by Group
              </h2>
              <ChevronDownIcon className="w-5 h-5 text-slate-400 transition-transform group-open/perf:rotate-180" />
            </summary>
            <div className="space-y-4 mt-3">
            {allGroupPerformanceData.map(groupData => (
              <div key={groupData.id} className="bg-lantern-surface/95 rounded-lantern-xl shadow-lantern border border-lantern-border overflow-hidden">
                <button onClick={() => toggleGroupExpansion(groupData.id)} className="w-full flex items-center justify-between p-4 md:p-5 hover:bg-lantern-background-secondary/60 transition-colors" aria-expanded={!!expandedGroups[groupData.id]}>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
                      <UsersIcon className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <h3 className="font-semibold text-slate-800 dark:text-slate-200">{groupData.name}</h3>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="hidden sm:inline text-sm text-slate-500 dark:text-slate-400">{groupData.testCount} test{groupData.testCount !== 1 ? 's' : ''}</span>
                    <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">{groupData.averageScore.toFixed(1)}%</span>
                    {expandedGroups[groupData.id] ? <ChevronUpIcon className="w-5 h-5 text-slate-400" /> : <ChevronDownIcon className="w-5 h-5 text-slate-400" />}
                  </div>
                </button>
                {expandedGroups[groupData.id] && (
                  <div className="border-t border-slate-200 dark:border-slate-700">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-slate-200 dark:bg-slate-700">
                      <div className="bg-white dark:bg-slate-800 p-3 text-center">
                        <p className="text-xs text-slate-500 dark:text-slate-400">Tests</p>
                        <p className="text-lg font-bold text-slate-900 dark:text-white">{groupData.testCount}</p>
                      </div>
                      <div className="bg-white dark:bg-slate-800 p-3 text-center">
                        <p className="text-xs text-slate-500 dark:text-slate-400">Avg Score</p>
                        <p className="text-lg font-bold text-slate-900 dark:text-white">{groupData.averageScore.toFixed(1)}%</p>
                      </div>
                      <div className="bg-white dark:bg-slate-800 p-3 text-center">
                        <p className="text-xs text-slate-500 dark:text-slate-400">Accuracy</p>
                        <p className="text-lg font-bold text-slate-900 dark:text-white">{groupData.accuracy.toFixed(1)}%</p>
                      </div>
                      <div className="bg-white dark:bg-slate-800 p-3 text-center">
                        <p className="text-xs text-slate-500 dark:text-slate-400">Avg Time/Q</p>
                        <p className="text-lg font-bold text-slate-900 dark:text-white">{groupData.averageTimePerQuestion > 0 ? `${groupData.averageTimePerQuestion.toFixed(1)}s` : '—'}</p>
                      </div>
                    </div>
                    <div className="p-4">
                      {lowDataMode ? (
                        <div className="py-4 text-center text-sm text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-700/30 rounded-lg">
                          <p className="font-medium">Chart hidden in Low-Data Mode</p>
                          <p className="text-xs mt-1">Avg Score: {groupData.averageScore.toFixed(1)}% across {groupData.testCount} test{groupData.testCount !== 1 ? 's' : ''}</p>
                        </div>
                      ) : (
                        <GroupPerformanceChart datasets={[{ label: 'Score', data: chartDisplayMode === 'bar' ? groupData.weeklyChartData : groupData.chartData }]} theme={theme} type={chartDisplayMode} />
                      )}
                      <div className="flex justify-end gap-1 mt-3">
                        <button onClick={() => setChartDisplayMode('line')} className={`px-3 py-1 text-xs rounded-l-lg border transition-colors ${chartDisplayMode === 'line' ? 'bg-indigo-500 text-white border-indigo-500' : 'bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'}`}>Timeline</button>
                        <button onClick={() => setChartDisplayMode('bar')} className={`px-3 py-1 text-xs rounded-r-lg border transition-colors ${chartDisplayMode === 'bar' ? 'bg-indigo-500 text-white border-indigo-500' : 'bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'}`}>Weekly</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
            </div>
          </details>
        )}

        {/* ─── Recent Tests ─── */}
        <div className="bg-lantern-surface/95 rounded-lantern-xl shadow-lantern border border-lantern-border overflow-hidden">
          <button onClick={toggleRecentTestsExpansion} className="w-full flex items-center justify-between p-4 md:p-5 hover:bg-lantern-background-secondary/60 transition-colors" aria-expanded={isRecentTestsExpanded}>
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200 flex items-center">
              <PresentationChartLineIcon className="w-5 h-5 mr-2 text-blue-500" />
              Recent Tests
            </h2>
            {isRecentTestsExpanded ? <ChevronUpIcon className="w-5 h-5 text-slate-400" /> : <ChevronDownIcon className="w-5 h-5 text-slate-400" />}
          </button>
          {isRecentTestsExpanded && (
            <div className="border-t border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700/50">
              {recentTests.length > 0 ? recentTests.map((result, index) => {
                let testTimeSpentSeconds = 0;
                const answersWithTime = Object.values(result.session.userAnswers).filter((ans: UserAnswerRecord) => ans.timeSpentSeconds !== undefined);
                if (answersWithTime.length > 0) {
                  testTimeSpentSeconds = answersWithTime.reduce((sum: number, answer: UserAnswerRecord) => sum + (answer.timeSpentSeconds || 0), 0);
                }
                const avgTime = answersWithTime.length > 0 ? (testTimeSpentSeconds / answersWithTime.length).toFixed(1) : null;
                const recentTestKey = result.id ?? `${result.session.startTime}-${result.session.config.groupId ?? 'group'}-${result.totalQuestions}-${index}`;

                return (
                  <div key={recentTestKey} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors">
                    <div className="min-w-0">
                      <p className="font-medium text-sm text-slate-800 dark:text-slate-200 truncate">{getGroupName(result.session.config.groupId, result.session.config.groupName)}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{new Date(result.session.startTime).toLocaleString()}</p>
                    </div>
                    <div className="flex items-center gap-4 flex-shrink-0">
                      <div className="text-center">
                        <p className="text-lg font-bold text-indigo-600 dark:text-indigo-400">{result.score.toFixed(1)}%</p>
                        <p className="text-[10px] text-slate-400">{result.correctAnswersCount}/{result.totalQuestions}</p>
                      </div>
                      {avgTime && (
                        <div className="text-center">
                          <p className="text-lg font-bold text-slate-600 dark:text-slate-300">{avgTime}s</p>
                          <p className="text-[10px] text-slate-400">avg/q</p>
                        </div>
                      )}
                      <button 
                        onClick={() => onViewAnalysis(result)} 
                        className="px-3 py-1.5 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors"
                      >
                        <PresentationChartLineIcon className="w-3.5 h-3.5" />
                        Analyze
                      </button>
                    </div>
                  </div>
                )
              }) : (
                <div className="p-8 text-center">
                  <AcademicCapOutline className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
                  <p className="text-sm text-slate-400">No tests taken yet. Start a test from one of your groups!</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ─── Group Comparison ─── */}
        {allGroupPerformanceData.length >= 2 && (
          <details className="group/comp">
            <summary className="bg-lantern-surface/95 rounded-lantern-xl shadow-lantern border border-lantern-border p-4 md:p-5 cursor-pointer list-none flex items-center justify-between select-none hover:bg-lantern-background-secondary/60 transition-colors">
              <div>
                <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200 flex items-center">
                  <PresentationChartBarIcon className="w-5 h-5 mr-2 text-teal-500" />
                  Group Comparison
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Select two or more groups to compare their weekly performance.</p>
              </div>
              <ChevronDownIcon className="w-5 h-5 text-slate-400 transition-transform group-open/comp:rotate-180 flex-shrink-0" />
            </summary>
            <div className="p-4 mt-3 bg-lantern-surface/95 rounded-lantern-xl shadow-lantern border border-lantern-border">
              <div className="flex flex-wrap gap-2 mb-4">
                {allGroupPerformanceData.map(groupData => (
                  <button 
                    key={groupData.id}
                    onClick={() => handleComparisonGroupToggle(groupData.id)}
                    className={`px-3 py-1.5 text-xs rounded-full border transition-all ${selectedComparisonGroupIds.includes(groupData.id) ? 'bg-indigo-500 text-white border-indigo-500 shadow-sm' : 'bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 border-slate-300 dark:border-slate-600'}`}
                  >
                    {groupData.name}
                  </button>
                ))}
              </div>
              {comparisonChartDatasets ? (
                lowDataMode ? (
                  <div className="py-4 text-center text-sm text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-700/30 rounded-lg">
                    <p className="font-medium">Chart hidden in Low-Data Mode</p>
                    <p className="text-xs mt-1">{comparisonChartDatasets.length} group{comparisonChartDatasets.length !== 1 ? 's' : ''} selected for comparison</p>
                  </div>
                ) : (
                  <GroupPerformanceChart datasets={comparisonChartDatasets} theme={theme} type="line" />
                )
              ) : (
                <p className="text-center text-sm text-slate-400 py-6">Select at least two groups to compare.</p>
              )}
            </div>
          </details>
        )}
      </div>

      {/* ═══════════════ GROUP PICKER MODAL ═══════════════ */}
      {quickActionPicker && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => setQuickActionPicker(null)}
        >
          <div
            className="w-full max-w-md bg-white dark:bg-slate-800 rounded-2xl shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2">
                {quickActionPicker === 'test'
                  ? <BoltIcon className="w-5 h-5 text-yellow-500" />
                  : <AcademicCapOutline className="w-5 h-5 text-emerald-500" />
                }
                <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">
                  Select a group for Quick {quickActionPicker === 'test' ? 'Test' : 'Study'}
                </h2>
              </div>
              <button
                onClick={() => setQuickActionPicker(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                aria-label="Close"
              >
                <XMarkIcon className="w-5 h-5 text-slate-500 dark:text-slate-400" />
              </button>
            </div>

            {/* Group list */}
            <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700">
              {availableGroups.length === 0 ? (
                <p className="text-center text-sm text-slate-400 dark:text-slate-500 py-8">
                  No groups available. Join or create a group first.
                </p>
              ) : (
                availableGroups.map(group => (
                  <button
                    key={group.id}
                    onClick={() => handleQuickActionGroupSelect(group.id)}
                    className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors"
                  >
                    {group.avatarUrl ? (
                      <img
                        src={group.avatarUrl}
                        alt={group.name}
                        className="w-9 h-9 rounded-full object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center flex-shrink-0">
                        <UsersIcon className="w-5 h-5 text-indigo-500 dark:text-indigo-400" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{group.name}</p>
                      {group.members && group.members.length > 0 && (
                        <p className="text-xs text-slate-400 dark:text-slate-500">{group.members.length} member{group.members.length !== 1 ? 's' : ''}</p>
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
        </div>
      )}
    </div>
  );
}