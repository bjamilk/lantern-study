// ===========================================
// Lantern Study Mobile - Stats Store
// ===========================================

import { create } from 'zustand';
import * as api from '../services/api';

const DEMO_MODE = false;

export type TimePeriod = '7days' | '30days' | '90days' | 'all';

// User Level System - based on total XP points
export interface UserLevel {
  level: number;
  name: string;
  currentXP: number;
  xpForCurrentLevel: number;
  xpForNextLevel: number;
  progressToNextLevel: number; // 0-100
}

// Level thresholds
export const LEVEL_THRESHOLDS = [
  { level: 1, name: 'Novice', xpRequired: 0 },
  { level: 2, name: 'Apprentice', xpRequired: 100 },
  { level: 3, name: 'Student', xpRequired: 300 },
  { level: 4, name: 'Scholar', xpRequired: 600 },
  { level: 5, name: 'Adept', xpRequired: 1000 },
  { level: 6, name: 'Expert', xpRequired: 1500 },
  { level: 7, name: 'Master', xpRequired: 2200 },
  { level: 8, name: 'Grandmaster', xpRequired: 3000 },
  { level: 9, name: 'Legend', xpRequired: 4000 },
  { level: 10, name: 'Champion', xpRequired: 5500 },
  { level: 11, name: 'Elite', xpRequired: 7500 },
  { level: 12, name: 'Sage', xpRequired: 10000 },
];

export const calculateUserLevel = (totalXP: number): UserLevel => {
  let currentLevel = LEVEL_THRESHOLDS[0];
  let nextLevel = LEVEL_THRESHOLDS[1];

  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
    if (totalXP >= LEVEL_THRESHOLDS[i].xpRequired) {
      currentLevel = LEVEL_THRESHOLDS[i];
      nextLevel = LEVEL_THRESHOLDS[i + 1] || currentLevel;
    } else {
      break;
    }
  }

  const xpInCurrentLevel = totalXP - currentLevel.xpRequired;
  const xpNeededForNextLevel = nextLevel.xpRequired - currentLevel.xpRequired;
  const progressToNextLevel = xpNeededForNextLevel > 0 
    ? Math.min(100, (xpInCurrentLevel / xpNeededForNextLevel) * 100)
    : 100;

  return {
    level: currentLevel.level,
    name: currentLevel.name,
    currentXP: totalXP,
    xpForCurrentLevel: currentLevel.xpRequired,
    xpForNextLevel: nextLevel.xpRequired,
    progressToNextLevel,
  };
};

export interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;
  level: number;
  maxLevel: number;
  progress: number; // 0-100
  currentValue: number; // Current stat value
  targetValue: number; // Target for next level
  unlockedAt?: string;
}

export interface TopicPerformance {
  tag: string;
  totalQuestions: number;
  correctAnswers: number;
  accuracy: number;
  averageTime: number; // seconds
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
  // Analysis data
  analysis: TestAnalysis;
}

export interface TestAnalysis {
  correctCount: number;
  incorrectCount: number;
  unattemptedCount: number;
  timePerQuestion: { questionNumber: number; time: number }[];
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
  // Overview
  totalPoints: number;
  userLevel: UserLevel;
  currentStreak: number;
  longestStreak: number;
  
  // Activity
  totalTestsTaken: number;
  averageTimePerQuestion: number;
  totalStudyTime: number; // minutes
  cardsReviewed: number;
  
  // Performance
  overallAccuracy: number;
  topicPerformance: TopicPerformance[];
  groupPerformance: GroupPerformance[];
  
  // Badges
  badges: Badge[];
  
  // Recent Activity
  recentTests: RecentTest[];
  troublesomeQuestions: TroublesomeQuestion[];
  
  // Weekly Activity Heatmap
  weeklyActivity: { day: string; count: number }[];
}

interface StatsState {
  stats: DashboardStats | null;
  selectedPeriod: TimePeriod;
  isLoading: boolean;
  error: string | null;
  
  // Actions
  fetchStats: (userId: string, period: TimePeriod) => Promise<void>;
  setSelectedPeriod: (period: TimePeriod) => void;
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
          timePerQuestion: [
            { questionNumber: 1, time: 25 }, { questionNumber: 2, time: 30 }, { questionNumber: 3, time: 28 },
            { questionNumber: 4, time: 22 }, { questionNumber: 5, time: 35 }, { questionNumber: 6, time: 18 },
            { questionNumber: 7, time: 42 }, { questionNumber: 8, time: 20 }, { questionNumber: 9, time: 33 },
            { questionNumber: 10, time: 27 }, { questionNumber: 11, time: 31 }, { questionNumber: 12, time: 24 },
            { questionNumber: 13, time: 29 }, { questionNumber: 14, time: 26 }, { questionNumber: 15, time: 38 },
            { questionNumber: 16, time: 21 }, { questionNumber: 17, time: 34 }, { questionNumber: 18, time: 23 },
            { questionNumber: 19, time: 28 }, { questionNumber: 20, time: 26 },
          ],
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
          timePerQuestion: [
            { questionNumber: 1, time: 32 }, { questionNumber: 2, time: 28 }, { questionNumber: 3, time: 45 },
            { questionNumber: 4, time: 25 }, { questionNumber: 5, time: 38 }, { questionNumber: 6, time: 22 },
            { questionNumber: 7, time: 35 }, { questionNumber: 8, time: 30 }, { questionNumber: 9, time: 27 },
            { questionNumber: 10, time: 42 }, { questionNumber: 11, time: 20 }, { questionNumber: 12, time: 33 },
            { questionNumber: 13, time: 28 }, { questionNumber: 14, time: 0 }, { questionNumber: 15, time: 31 },
            { questionNumber: 16, time: 24 }, { questionNumber: 17, time: 36 }, { questionNumber: 18, time: 29 },
          ],
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
          timePerQuestion: [
            { questionNumber: 1, time: 30 }, { questionNumber: 2, time: 35 }, { questionNumber: 3, time: 28 },
            { questionNumber: 4, time: 42 }, { questionNumber: 5, time: 25 }, { questionNumber: 6, time: 38 },
            { questionNumber: 7, time: 22 }, { questionNumber: 8, time: 33 }, { questionNumber: 9, time: 28 },
            { questionNumber: 10, time: 45 }, { questionNumber: 11, time: 20 }, { questionNumber: 12, time: 31 },
            { questionNumber: 13, time: 26 }, { questionNumber: 14, time: 29 }, { questionNumber: 15, time: 27 },
          ],
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
          timePerQuestion: Array.from({ length: 20 }, (_, i) => ({ questionNumber: i + 1, time: 25 + Math.floor(Math.random() * 20) })),
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
          timePerQuestion: Array.from({ length: 18 }, (_, i) => ({ questionNumber: i + 1, time: 22 + Math.floor(Math.random() * 25) })),
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
  };
};

export const useStatsStore = create<StatsState>((set, get) => ({
  stats: null,
  selectedPeriod: '30days',
  isLoading: false,
  error: null,

  fetchStats: async (userId: string, period: TimePeriod) => {
    set({ isLoading: true, error: null });
    
    if (DEMO_MODE) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const stats = generateMockStats(period);
      set({ stats, selectedPeriod: period, isLoading: false });
      return;
    }
    
    try {
      // Fetch gamification stats from API
      const apiStats = await api.fetchGamificationStats(userId);
      
      // Use API stats where available, generate mock for the rest
      const baseStats = generateMockStats(period);
      
      // Override with real API data
      const totalPoints = apiStats?.total_points || apiStats?.xp || baseStats.totalPoints;
      const stats: DashboardStats = {
        ...baseStats,
        totalPoints,
        userLevel: calculateUserLevel(totalPoints),
        currentStreak: apiStats?.streak_days || baseStats.currentStreak,
        cardsReviewed: apiStats?.cards_reviewed || baseStats.cardsReviewed,
        // The rest uses generated mock data since the API doesn't provide it yet
      };
      
      set({ stats, selectedPeriod: period, isLoading: false });
    } catch (error: any) {
      console.error('Failed to fetch stats from API:', error);
      // Fall back to mock stats on error
      const stats = generateMockStats(period);
      set({ stats, selectedPeriod: period, isLoading: false, error: error.message });
    }
  },

  setSelectedPeriod: (period: TimePeriod) => {
    set({ selectedPeriod: period });
  },
}));
