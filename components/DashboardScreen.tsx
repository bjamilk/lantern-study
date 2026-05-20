

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { TestResult, Group, User, Badge, UserStats, QuestionType, UserQuestionStats, Message, UserAnswerRecord, UserQuestionStat, AppMode } from '../types';
import { ChartBarIcon, CalendarDaysIcon, CheckCircleIcon, InformationCircleIcon, UsersIcon, ClockIcon, ArrowLeftIcon, PresentationChartLineIcon, ChevronUpIcon, ChevronDownIcon, FunnelIcon, SparklesIcon, TrophyIcon, RocketLaunchIcon, ClockIcon as ClockOutline, AcademicCapIcon as AcademicCapOutline, TagIcon, PresentationChartBarIcon, ExclamationTriangleIcon, RectangleStackIcon, ShoppingBagIcon, PlusCircleIcon, PlayIcon, FireIcon, BoltIcon, BellIcon, XMarkIcon } from '@heroicons/react/24/solid';
import GroupPerformanceChart, { ChartDataPoint } from './GroupPerformanceChart';
import { BADGE_DEFINITIONS, getXPLevel } from '../gamification';
import { useLoginStreak } from '../hooks/useLoginStreak';

interface DashboardScreenProps {
  testResults: TestResult[];
  groups: Group[];
  currentUser: User;
  onNavigateToChat: () => void;
  allMessages: Record<string, Message[]>;
  userQuestionStats: UserQuestionStats;
  onViewAnalysis: (result: TestResult) => void;
  theme: 'light' | 'dark';
  // Quick-action navigation
  onNavigateToFlashcards?: () => void;
  onNavigateToMarketplace?: () => void;
  onNavigateToCreateGroup?: () => void;
  dueCardsCount?: number;
  // Flashcard review activity for heatmap
  flashcards?: import('../types').Flashcard[];
  // Today's Summary
  pendingSyncCount?: number;
  unreadNotificationCount?: number;
  // Study flow entry points
  onOpenQuickTest?: () => void;
  onOpenQuickStudy?: () => void;
  onGetStudyRecommendations?: (performanceData: {
    recentScores: { topic: string; score: number; date: string }[];
    flashcardAccuracy: { topic: string; correctRate: number }[];
    studyHoursThisWeek: number;
  }) => Promise<{ weakTopics: string[]; suggestedCards: string[]; suggestedQuestions: string[]; studyTip: string; estimatedMinutes: number } | null>;
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

    // Compute max activity to scale colors proportionally
    let maxCount = 0;
    data.forEach(count => { if (count > maxCount) maxCount = count; });
    
    const getColorForCount = (count: number): string => {
        if (count === 0) {
            return theme === 'dark' ? 'bg-slate-700' : 'bg-gray-200';
        }
        // Scale into 4 intensity levels based on the user's max daily activity
        const ratio = maxCount > 0 ? count / maxCount : 0;
        if (theme === 'dark') {
            if (ratio <= 0.25) return 'bg-green-900';
            if (ratio <= 0.5) return 'bg-green-700';
            if (ratio <= 0.75) return 'bg-green-500';
            return 'bg-green-400';
        }
        if (ratio <= 0.25) return 'bg-green-200';
        if (ratio <= 0.5) return 'bg-green-400';
        if (ratio <= 0.75) return 'bg-green-500';
        return 'bg-green-600';
    };

    return (
        <div className="flex justify-center items-center">
            <div className="grid grid-rows-7 grid-flow-col gap-1">
                {days.map(day => {
                    const dateString = formatLocalDate(day);
                    const count = data.get(dateString) || 0;
                    return (
                        <div
                        key={dateString}
                        title={`${count} activit${count !== 1 ? 'ies' : 'y'} on ${day.toLocaleDateString()}`}
                        className={`w-3.5 h-3.5 rounded-sm ${getColorForCount(count)}`}
                        />
                    );
                })}
            </div>
        </div>
    );
};

export default function DashboardScreen({ testResults: rawTestResults, groups, currentUser, onNavigateToChat, allMessages, userQuestionStats, onViewAnalysis, theme, onNavigateToFlashcards, onNavigateToMarketplace, onNavigateToCreateGroup, dueCardsCount = 0, flashcards = [], pendingSyncCount = 0, unreadNotificationCount = 0, onOpenQuickTest, onOpenQuickStudy, onGetStudyRecommendations }: DashboardScreenProps) {
  
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


  const filteredTestResults = useMemo(() => {
    if (selectedTimePeriod === 'allTime') {
      return initialTestResults;
    }

    if (selectedTimePeriod === 'custom') {
      if (customStartDate && customEndDate) {
        try {
          const startDateObj = new Date(customStartDate + "T00:00:00"); // Local time start of day
          const endDateObj = new Date(customEndDate + "T23:59:59.999");   // Local time end of day

          if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
            console.warn("Invalid custom dates provided.");
            return initialTestResults; // Fallback to all if dates are invalid
          }
          if (startDateObj > endDateObj) {
            console.warn("Custom start date is after end date.");
            return []; // No results possible
          }

          return initialTestResults.filter(result => {
            const resultDate = new Date(result.session.startTime);
            return resultDate >= startDateObj && resultDate <= endDateObj;
          });
        } catch (e) {
            console.error("Error parsing custom dates:", e);
            return initialTestResults; 
        }
      } else {
        // If custom is selected but dates aren't set, effectively show "All Time"
        // or a specific message, here we show all for now.
        return initialTestResults;
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

    return initialTestResults.filter(result => {
        const resultDate = new Date(result.session.startTime);
        return resultDate >= cutoffDate;
    });
  }, [initialTestResults, selectedTimePeriod, customStartDate, customEndDate]);
  
  const totalTestsTakenOverall = filteredTestResults.length;
  
  const getGroupName = (groupId: string): string => {
    const group = groups.find(g => g.id === groupId);
    return group ? group.name : 'Unknown Group';
  };

  const [allGroupPerformanceData, setAllGroupPerformanceData] = useState<GroupPerformanceData[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [isRecentTestsExpanded, setIsRecentTestsExpanded] = useState(true);

  useEffect(() => {
    const groupPerformanceMap: Map<string, GroupPerformanceData> = new Map();
    if (totalTestsTakenOverall > 0) {
      filteredTestResults.forEach(result => {
        const groupId = result.session.config.groupId;
        const groupName = getGroupName(groupId);
        
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

            // Topic performance calculation
            if (question.tags) {
                for (const tag of question.tags) {
                    const stats = tagStats.get(tag) || { correct: 0, total: 0 };
                    stats.total++;
                    if (answer.isCorrect) {
                        stats.correct++;
                    }
                    tagStats.set(tag, stats);
                }
            }
            
            // Speed analysis calculation
            if (question.questionType && answer.timeSpentSeconds !== undefined) {
                const stats = speedStats.get(question.questionType) || { totalTime: 0, count: 0 };
                stats.totalTime += answer.timeSpentSeconds;
                stats.count++;
                speedStats.set(question.questionType, stats);
            }
        }
    }
    
    const topicPerformance = Array.from(tagStats.entries())
        .map(([tag, { correct, total }]) => ({
            tag,
            accuracy: total > 0 ? (correct / total) * 100 : 0,
            count: total,
        }))
        .filter(item => item.count >= 3)
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
    const data = new Map<string, number>();
    // Use local date format (matching StudyHeatmap's formatLocalDate)
    const toLocalDateStr = (d: Date): string => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };
    // Count completed tests (use ALL results, not filtered by time period)
    initialTestResults.forEach(result => {
        const dateStr = toLocalDateStr(new Date(result.session.startTime));
        data.set(dateStr, (data.get(dateStr) || 0) + 1);
    });
    // Count question attempts from userQuestionStats
    if (userQuestionStats) {
        const attemptDates = new Set<string>();
        Object.values(userQuestionStats).forEach((stat: UserQuestionStat) => {
            if (stat.lastAttempted) {
                const dateStr = toLocalDateStr(new Date(stat.lastAttempted));
                attemptDates.add(dateStr);
            }
        });
        attemptDates.forEach(dateStr => {
            data.set(dateStr, (data.get(dateStr) || 0) + 1);
        });
    }
    // Count flashcard reviews (infer review date from nextReviewDate - interval)
    if (flashcards && flashcards.length > 0) {
        flashcards.forEach(fc => {
            if (fc.srsData?.nextReviewDate && fc.srsData.interval >= 0) {
                const nextDate = new Date(fc.srsData.nextReviewDate);
                const reviewDate = new Date(nextDate);
                reviewDate.setDate(reviewDate.getDate() - (fc.srsData.interval || 1));
                const dateStr = toLocalDateStr(reviewDate);
                data.set(dateStr, (data.get(dateStr) || 0) + 1);
            }
        });
    }
    return data;
  }, [initialTestResults, userQuestionStats, flashcards]);

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
    <div className="flex-1 flex flex-col bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 overflow-y-auto">

      {/* ─── Daily Login Bonus Banner ─── */}
      {showDailyBonus && (
        <div className="bg-gradient-to-r from-orange-500 to-amber-500 text-white px-4 py-3 flex items-center justify-between gap-3 shadow-md">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🔥</span>
            <div>
              <p className="font-bold text-sm leading-tight">
                Day {streakData.streak} streak! +{bonusXP} XP bonus claimed!
              </p>
              <p className="text-orange-100 text-xs">
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
      
      {/* ═══════════════ HERO SECTION ═══════════════ */}
      <div className="bg-gradient-to-br from-indigo-600 via-indigo-500 to-purple-600 dark:from-indigo-900 dark:via-indigo-800 dark:to-purple-900 px-4 md:px-8 py-6 md:py-8">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-white">
                {getGreeting()}, {currentUser.name.split(' ')[0]}!
              </h1>
              <p className="text-indigo-200 dark:text-indigo-300 mt-1 text-sm md:text-base">
                {totalTestsTakenOverall > 0
                  ? `You've completed ${totalTestsTakenOverall} test${totalTestsTakenOverall !== 1 ? 's' : ''}. Keep up the great work!`
                  : 'Ready to start studying? Jump into a group or review your flashcards.'}
              </p>
            </div>
            <div className="flex items-center gap-4">
              {/* Streak badge */}
              <div className="flex items-center gap-2 bg-white/15 backdrop-blur-sm rounded-xl px-4 py-2.5">
                <FireIcon className="w-6 h-6 text-orange-300" />
                <div>
                  <p className="text-xs text-indigo-200 font-medium">Streak</p>
                  <p className="text-xl font-bold text-white leading-none">{streakData.streak} day{streakData.streak !== 1 ? 's' : ''}</p>
                </div>
              </div>
              {/* Points badge */}
              <div className="flex items-center gap-2 bg-white/15 backdrop-blur-sm rounded-xl px-4 py-2.5">
                <SparklesIcon className="w-6 h-6 text-yellow-300" />
                <div>
                  <p className="text-xs text-indigo-200 font-medium">Points</p>
                  <p className="text-xl font-bold text-white leading-none">{currentUser.points.toLocaleString()}</p>
                </div>
              </div>
            </div>
          </div>

          {/* ─── XP Level Progress Bar ─── */}
          <div className="mt-4 bg-white/10 backdrop-blur-sm rounded-xl px-4 py-3">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span className="text-lg leading-none">{xpInfo.icon}</span>
                <span className="text-sm font-bold text-white">
                  Level {xpInfo.level} — {xpInfo.title}
                </span>
              </div>
              <span className="text-xs text-indigo-200">
                {xpInfo.maxPoints === -1
                  ? `${currentUser.points.toLocaleString()} XP · Max Level`
                  : `${xpInfo.pointsToNextLevel.toLocaleString()} XP to Level ${xpInfo.level + 1}`}
              </span>
            </div>
            <div className="w-full bg-white/20 rounded-full h-2.5 overflow-hidden">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${xpInfo.color} transition-all duration-700`}
                style={{ width: `${xpInfo.progressPercent}%` }}
              />
            </div>
          </div>

          {/* ═══════════════ QUICK ACTIONS ═══════════════ */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
            <button
              onClick={onNavigateToChat}
              className="group flex flex-col items-center gap-2 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-xl p-4 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
            >
              <div className="w-10 h-10 rounded-full bg-blue-400/30 flex items-center justify-center group-hover:bg-blue-400/50 transition-colors">
                <PlayIcon className="w-5 h-5 text-white" />
              </div>
              <span className="text-sm font-semibold text-white">Start Test</span>
            </button>
            <button
              onClick={onNavigateToFlashcards}
              className="group flex flex-col items-center gap-2 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-xl p-4 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] relative"
            >
              <div className="w-10 h-10 rounded-full bg-emerald-400/30 flex items-center justify-center group-hover:bg-emerald-400/50 transition-colors">
                <RectangleStackIcon className="w-5 h-5 text-white" />
              </div>
              <span className="text-sm font-semibold text-white">Flashcards</span>
              {dueCardsCount > 0 && (
                <span className="absolute top-2 right-2 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                  {dueCardsCount > 99 ? '99+' : dueCardsCount}
                </span>
              )}
            </button>
            <button
              onClick={onNavigateToMarketplace}
              className="group flex flex-col items-center gap-2 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-xl p-4 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
            >
              <div className="w-10 h-10 rounded-full bg-purple-400/30 flex items-center justify-center group-hover:bg-purple-400/50 transition-colors">
                <ShoppingBagIcon className="w-5 h-5 text-white" />
              </div>
              <span className="text-sm font-semibold text-white">Marketplace</span>
            </button>
            <button
              onClick={onNavigateToCreateGroup}
              className="group flex flex-col items-center gap-2 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-xl p-4 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
            >
              <div className="w-10 h-10 rounded-full bg-amber-400/30 flex items-center justify-center group-hover:bg-amber-400/50 transition-colors">
                <PlusCircleIcon className="w-5 h-5 text-white" />
              </div>
              <span className="text-sm font-semibold text-white">New Group</span>
            </button>
          </div>

          {/* ═══════════════ QUICK TEST / QUICK STUDY ═══════════════ */}
          {(onOpenQuickTest || onOpenQuickStudy) && (
            <div className="flex gap-3 mt-4">
              {onOpenQuickTest && (
                <button
                  onClick={onOpenQuickTest}
                  className="flex-1 flex items-center justify-center gap-2 bg-white/15 hover:bg-white/25 backdrop-blur-sm rounded-xl px-4 py-3 transition-all duration-200 hover:scale-[1.01] active:scale-[0.99]"
                >
                  <BoltIcon className="w-5 h-5 text-yellow-300" />
                  <span className="text-sm font-semibold text-white">Quick Test</span>
                </button>
              )}
              {onOpenQuickStudy && (
                <button
                  onClick={onOpenQuickStudy}
                  className="flex-1 flex items-center justify-center gap-2 bg-white/15 hover:bg-white/25 backdrop-blur-sm rounded-xl px-4 py-3 transition-all duration-200 hover:scale-[1.01] active:scale-[0.99]"
                >
                  <AcademicCapOutline className="w-5 h-5 text-emerald-300" />
                  <span className="text-sm font-semibold text-white">Quick Study</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ═══════════════ MAIN CONTENT ═══════════════ */}
      <div className="flex-1 px-4 md:px-8 py-6 max-w-6xl mx-auto w-full space-y-6">

        {/* ─── Stat Cards Row ─── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
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
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
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
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
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
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
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

        {/* ─── Today's Summary ─── */}
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 md:p-5">
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
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 md:p-5">
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
          </div>
        )}

        {/* ─── Activity Heatmap & Filter ─── */}
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
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
          <summary className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 md:p-5 cursor-pointer list-none flex items-center justify-between select-none hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200 flex items-center">
              <TrophyIcon className="w-5 h-5 mr-2 text-yellow-500" />
              Achievements &amp; Topic Insights
            </h2>
            <ChevronDownIcon className="w-5 h-5 text-slate-400 transition-transform group-open:rotate-180" />
          </summary>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-3">
          
          {/* Achievements Card */}
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
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
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
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

        {/* ─── Troublesome Questions ─── */}
        {troublesomeQuestions.length > 0 && (
          <details open className="group">
            <summary className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 md:p-5 cursor-pointer list-none flex items-center justify-between select-none hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
              <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200 flex items-center">
                <ExclamationTriangleIcon className="w-5 h-5 mr-2 text-amber-500" />
                Questions to Review
              </h2>
              <ChevronDownIcon className="w-5 h-5 text-slate-400 transition-transform group-open:rotate-180" />
            </summary>
            <div className="divide-y divide-slate-100 dark:divide-slate-700/50 mt-3 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
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
            <summary className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 md:p-5 cursor-pointer list-none flex items-center justify-between select-none hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
              <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200 flex items-center">
                <PresentationChartBarIcon className="w-5 h-5 mr-2 text-indigo-500" />
                Performance by Group
              </h2>
              <ChevronDownIcon className="w-5 h-5 text-slate-400 transition-transform group-open/perf:rotate-180" />
            </summary>
            <div className="space-y-4 mt-3">
            {allGroupPerformanceData.map(groupData => (
              <div key={groupData.id} className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
                <button onClick={() => toggleGroupExpansion(groupData.id)} className="w-full flex items-center justify-between p-4 md:p-5 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors" aria-expanded={!!expandedGroups[groupData.id]}>
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
                      <GroupPerformanceChart datasets={[{ label: 'Score', data: chartDisplayMode === 'bar' ? groupData.weeklyChartData : groupData.chartData }]} theme={theme} type={chartDisplayMode} />
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
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
          <button onClick={toggleRecentTestsExpansion} className="w-full flex items-center justify-between p-4 md:p-5 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors" aria-expanded={isRecentTestsExpanded}>
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200 flex items-center">
              <PresentationChartLineIcon className="w-5 h-5 mr-2 text-blue-500" />
              Recent Tests
            </h2>
            {isRecentTestsExpanded ? <ChevronUpIcon className="w-5 h-5 text-slate-400" /> : <ChevronDownIcon className="w-5 h-5 text-slate-400" />}
          </button>
          {isRecentTestsExpanded && (
            <div className="border-t border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700/50">
              {recentTests.length > 0 ? recentTests.map(result => {
                let testTimeSpentSeconds = 0;
                const answersWithTime = Object.values(result.session.userAnswers).filter((ans: UserAnswerRecord) => ans.timeSpentSeconds !== undefined);
                if (answersWithTime.length > 0) {
                  testTimeSpentSeconds = answersWithTime.reduce((sum: number, answer: UserAnswerRecord) => sum + (answer.timeSpentSeconds || 0), 0);
                }
                const avgTime = answersWithTime.length > 0 ? (testTimeSpentSeconds / answersWithTime.length).toFixed(1) : null;
                
                return (
                  <div key={result.session.startTime.toISOString()} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors">
                    <div className="min-w-0">
                      <p className="font-medium text-sm text-slate-800 dark:text-slate-200 truncate">{getGroupName(result.session.config.groupId)}</p>
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
            <summary className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 md:p-5 cursor-pointer list-none flex items-center justify-between select-none hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
              <div>
                <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200 flex items-center">
                  <PresentationChartBarIcon className="w-5 h-5 mr-2 text-teal-500" />
                  Group Comparison
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Select two or more groups to compare their weekly performance.</p>
              </div>
              <ChevronDownIcon className="w-5 h-5 text-slate-400 transition-transform group-open/comp:rotate-180 flex-shrink-0" />
            </summary>
            <div className="p-4 mt-3 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
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
                <GroupPerformanceChart datasets={comparisonChartDatasets} theme={theme} type="line" />
              ) : (
                <p className="text-center text-sm text-slate-400 py-6">Select at least two groups to compare.</p>
              )}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}