/**
 * Web Test Store
 * Manages tests, test sessions, and test results
 * 
 * Note: This store provides state management for tests.
 * API calls should be made through the supabase service functions
 * and then state updated through the store methods.
 */
import { create } from 'zustand';
import { 
  TestConfig, 
  TestQuestion, 
  UserAnswerRecord, 
  TestSessionData, 
  StudySessionData, 
  TestResult,
  GameSession,
  UserQuestionStats,
  OfflineSessionBundle,
  PausedSessionSummary,
} from '../types';
import type { StudyActivityDay } from '@lantern/shared';

interface TestState {
  // State
  activeTestSession: TestSessionData | null;
  activeStudySession: StudySessionData | null;
  activeGameSession: GameSession | null;
  pausedSessions: PausedSessionSummary[];
  testResults: TestResult[];
  userQuestionStats: UserQuestionStats;
  studyActivityDays: StudyActivityDay[];
  offlineBundles: OfflineSessionBundle[];
  pendingSyncResults: TestResult[];
  isLoading: boolean;
  error: string | null;
  
  // Actions - Test Session
  setActiveTestSession: (session: TestSessionData | null) => void;
  updateTestAnswer: (questionId: string, answer: UserAnswerRecord) => void;
  
  // Actions - Study Session
  setActiveStudySession: (session: StudySessionData | null) => void;
  setPausedSessions: (sessions: PausedSessionSummary[]) => void;
  upsertPausedSessionSummary: (summary: PausedSessionSummary) => void;
  removePausedSession: (sessionId: string) => void;
  
  // Actions - Game Session
  setActiveGameSession: (session: GameSession | null) => void;
  updateGameSession: (updates: Partial<GameSession>) => void;
  
  // Actions - Test Results
  setTestResults: (results: TestResult[]) => void;
  updateTestResults: (updater: (prev: TestResult[]) => TestResult[]) => void;
  addTestResult: (result: TestResult) => void;
  
  // Actions - Question Stats
  setUserQuestionStats: (stats: UserQuestionStats) => void;
  setStudyActivityDays: (days: StudyActivityDay[]) => void;
  updateQuestionStat: (questionId: string, isCorrect: boolean) => void;
  
  // Actions - Offline Mode
  setOfflineBundles: (bundles: OfflineSessionBundle[]) => void;
  updateOfflineBundles: (updater: (prev: OfflineSessionBundle[]) => OfflineSessionBundle[]) => void;
  addOfflineBundle: (bundle: OfflineSessionBundle) => void;
  removeOfflineBundle: (bundleId: string) => void;
  
  // Actions - Pending Sync
  setPendingSyncResults: (results: TestResult[]) => void;
  updatePendingSyncResults: (updater: (prev: TestResult[]) => TestResult[]) => void;
  addPendingSyncResult: (result: TestResult) => void;
  clearPendingSyncResults: () => void;
  
  // Utility
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
  reset: () => void;
  initFromStorage: () => void;
}

// Helper to safely get from localStorage
const getFromStorage = <T,>(key: string, defaultValue: T): T => {
  if (typeof window === 'undefined') return defaultValue;
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : defaultValue;
  } catch {
    return defaultValue;
  }
};

export const useTestStore = create<TestState>()((set, get) => ({
  // Initial State (initialized from localStorage when available)
  activeTestSession: null,
  activeStudySession: null,
  activeGameSession: null,
  pausedSessions: [],
  testResults: [],
  userQuestionStats: {},
  studyActivityDays: [],
  offlineBundles: getFromStorage<OfflineSessionBundle[]>('offlineBundles', []),
  pendingSyncResults: getFromStorage<TestResult[]>('pendingSyncResults', []),
  isLoading: false,
  error: null,
  
  // Test Session
  setActiveTestSession: (session) => set({ activeTestSession: session }),
  
  updateTestAnswer: (questionId, answer) => {
    set((state) => {
      if (!state.activeTestSession) return state;
      
      return {
        activeTestSession: {
          ...state.activeTestSession,
          userAnswers: {
            ...state.activeTestSession.userAnswers,
            [questionId]: answer,
          },
        },
      };
    });
  },
  
  // Study Session
  setActiveStudySession: (session) => set({ activeStudySession: session }),

  setPausedSessions: (sessions) => set({ pausedSessions: sessions }),

  upsertPausedSessionSummary: (summary) =>
    set((state) => {
      const others = state.pausedSessions.filter((s) => s.id !== summary.id);
      return {
        pausedSessions: [summary, ...others].sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        ),
      };
    }),

  removePausedSession: (sessionId) =>
    set((state) => ({
      pausedSessions: state.pausedSessions.filter((s) => s.id !== sessionId),
    })),
  
  // Game Session
  setActiveGameSession: (session) => set({ activeGameSession: session }),
  
  updateGameSession: (updates) => {
    set((state) => {
      if (!state.activeGameSession) return state;
      return {
        activeGameSession: { ...state.activeGameSession, ...updates },
      };
    });
  },
  
  // Test Results
  setTestResults: (results) => set({ testResults: results }),
  
  updateTestResults: (updater) => set((state) => ({
    testResults: updater(state.testResults),
  })),
  
  addTestResult: (result) => set((state) => ({
    testResults: [...state.testResults, result],
  })),
  
  // Question Stats
  setUserQuestionStats: (stats) => set({ userQuestionStats: stats }),

  setStudyActivityDays: (days) => set({ studyActivityDays: days }),
  
  updateQuestionStat: (questionId, isCorrect) => {
    set((state) => {
      const currentStat = state.userQuestionStats[questionId] || {
        correctAttempts: 0,
        incorrectAttempts: 0,
        lastAttempted: new Date().toISOString(),
      };
      
      return {
        userQuestionStats: {
          ...state.userQuestionStats,
          [questionId]: {
            ...currentStat,
            correctAttempts: currentStat.correctAttempts + (isCorrect ? 1 : 0),
            incorrectAttempts: currentStat.incorrectAttempts + (isCorrect ? 0 : 1),
            lastAttempted: new Date().toISOString(),
          },
        },
      };
    });
  },
  
  // Offline Mode
  setOfflineBundles: (bundles) => set({ offlineBundles: bundles }),
  
  updateOfflineBundles: (updater) => set((state) => ({
    offlineBundles: updater(state.offlineBundles),
  })),
  
  addOfflineBundle: (bundle) => set((state) => ({
    offlineBundles: [...state.offlineBundles, bundle],
  })),
  
  removeOfflineBundle: (bundleId) => set((state) => ({
    offlineBundles: state.offlineBundles.filter(b => b.bundleId !== bundleId),
  })),
  
  // Pending Sync
  setPendingSyncResults: (results) => {
    try {
      localStorage.setItem('pendingSyncResults', JSON.stringify(results));
    } catch (e) {
      console.error('Failed to save pending results:', e);
    }
    set({ pendingSyncResults: results });
  },
  
  updatePendingSyncResults: (updater) => {
    set((state) => {
      const updated = updater(state.pendingSyncResults);
      try {
        localStorage.setItem('pendingSyncResults', JSON.stringify(updated));
      } catch (e) {
        console.error('Failed to save pending results:', e);
      }
      return { pendingSyncResults: updated };
    });
  },
  
  addPendingSyncResult: (result) => {
    set((state) => {
      const updated = [...state.pendingSyncResults, result];
      // Also persist to localStorage
      try {
        localStorage.setItem('pendingSyncResults', JSON.stringify(updated));
      } catch (e) {
        console.error('Failed to save pending results:', e);
      }
      return { pendingSyncResults: updated };
    });
  },
  
  clearPendingSyncResults: () => {
    try {
      localStorage.removeItem('pendingSyncResults');
    } catch (e) {
      console.error('Failed to clear pending results:', e);
    }
    set({ pendingSyncResults: [] });
  },
  
  // Utility
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  clearError: () => set({ error: null }),
  
  initFromStorage: () => {
    set({
      offlineBundles: getFromStorage<OfflineSessionBundle[]>('offlineBundles', []),
      pendingSyncResults: getFromStorage<TestResult[]>('pendingSyncResults', []),
    });
  },
  
  reset: () => set({
    activeTestSession: null,
    activeStudySession: null,
    activeGameSession: null,
    pausedSessions: [],
    testResults: [],
    userQuestionStats: {},
    studyActivityDays: [],
    offlineBundles: [],
    pendingSyncResults: [],
    isLoading: false,
    error: null,
  }),
}));
