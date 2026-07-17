// ===========================================
// Lantern Study Mobile - Offline Store
// ===========================================

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as api from '../services/api';
import {
  canonicalOfflineQuestionType,
  matchesOfflineQuestionTypeFilter,
} from '../utils/questionHelpers';

export interface OfflineTest {
  id: string;
  testId: string;
  groupId: string;
  groupName: string;
  testName: string;
  questionCount: number;
  downloadedAt: string;
  size: number; // in KB
  questions: OfflineQuestion[];
  // Download options used
  timeLimit?: number; // in minutes
  questionTypes?: string[];
  shuffled?: boolean;
  recentlyAddedDays?: number; // Filter for recently added questions
}

export interface OfflineQuestion {
  id: string;
  stem: string;
  type: string;
  options: { id: string; text: string; isCorrect: boolean }[];
  correctAnswer?: string;
  explanation?: string;
  tags: string[];
  imageUrl?: string;
  createdAt?: string; // When the question was added
}

export interface PendingResult {
  id: string;
  testId: string;
  groupName: string;
  score: number;
  totalQuestions: number;
  percentage: number;
  completedAt: string;
  timeSpent: number;
  synced: boolean;
  sessionPayload?: {
    questions?: unknown[];
    userAnswers?: Record<string, unknown>;
    score: number;
    correctAnswersCount: number;
    totalQuestions: number;
    startTime?: string;
    endTime?: string;
    config?: unknown;
  };
}

export interface DownloadOptions {
  questionTypes?: ('mcq-single' | 'mcq-multiple' | 'true-false' | 'fill-blank')[];
  questionCount?: number;
  timeLimit?: number; // in minutes, 0 = no limit
  shuffleQuestions?: boolean;
  includeExplanations?: boolean;
  recentlyAddedDays?: number; // 0 = all questions, 7 = last 7 days, 14, 30, etc.
}

interface OfflineState {
  downloadedTests: OfflineTest[];
  pendingResults: PendingResult[];
  isDownloading: boolean;
  downloadProgress: number;
  isSyncing: boolean;
  lastSyncAt: string | null;
  totalStorageUsed: number; // in KB
  
  // Actions
  loadOfflineData: (userId?: string) => Promise<void>;
  downloadTest: (
    testId: string,
    groupId: string,
    groupName: string,
    testName: string,
    options?: DownloadOptions,
    userId?: string
  ) => Promise<void>;
  deleteDownloadedTest: (id: string, userId?: string) => Promise<void>;
  savePendingResult: (result: Omit<PendingResult, 'id' | 'synced'>) => Promise<void>;
  syncPendingResults: (userId: string) => Promise<void>;
  clearAllOfflineData: (userId?: string) => Promise<void>;
  getOfflineTest: (testId: string) => OfflineTest | undefined;
}

const STORAGE_KEY = '@lantern_offline_data';
const RESULTS_KEY = '@lantern_pending_results';

const ALL_QUESTION_TYPES = ['mcq-single', 'mcq-multiple', 'true-false', 'fill-blank'] as const;

type ApiOfflineBundle = Awaited<ReturnType<typeof api.fetchOfflineBundles>>[number];

const mapApiBundleToOfflineTest = (bundle: ApiOfflineBundle): OfflineTest => {
  const config = (bundle.config || {}) as Record<string, unknown>;
  const questions = (bundle.questions || []) as OfflineQuestion[];
  const size = Math.round(JSON.stringify(bundle).length / 1024);

  return {
    id: bundle.bundle_id,
    testId: bundle.bundle_id,
    groupId: (config.groupId as string) || bundle.bundle_id,
    groupName: bundle.group_name,
    testName: bundle.display_name || bundle.group_name,
    questionCount: questions.length,
    downloadedAt: bundle.downloaded_at,
    size,
    questions,
    timeLimit: config.timerDuration ? Math.round(Number(config.timerDuration) / 60) : undefined,
    questionTypes: config.allowedQuestionTypes as string[] | undefined,
    shuffled: config.shuffleQuestions as boolean | undefined,
    recentlyAddedDays: config.recentlyAddedDays as number | undefined,
  };
};

const persistLocalTests = async (downloadedTests: OfflineTest[]) => {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(downloadedTests));
  const totalStorageUsed = downloadedTests.reduce((sum, t) => sum + t.size, 0);
  return totalStorageUsed;
};

// Mock questions — dev fallback only when group has no question messages
const generateMockQuestions = (count: number, allowedTypes?: string[], recentlyAddedDays?: number): OfflineQuestion[] => {
  const types = allowedTypes && allowedTypes.length > 0 
    ? allowedTypes 
    : ALL_QUESTION_TYPES;
  const tags = ['Biology', 'Chemistry', 'Physics', 'Anatomy', 'Genetics'];
  
  return Array.from({ length: count }, (_, i) => {
    // Generate random createdAt date - some recent, some older
    const daysAgo = recentlyAddedDays && recentlyAddedDays > 0
      ? Math.floor(Math.random() * recentlyAddedDays) // All within the filter range
      : Math.floor(Math.random() * 60); // Random from last 60 days
    const createdAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
    
    return {
      id: `q-${Date.now()}-${i}`,
      stem: `Sample question ${i + 1}: What is the correct answer for this practice question about ${tags[i % tags.length]}?`,
      type: types[i % types.length],
      options: [
        { id: 'a', text: 'Option A', isCorrect: i % 4 === 0 },
        { id: 'b', text: 'Option B', isCorrect: i % 4 === 1 },
        { id: 'c', text: 'Option C', isCorrect: i % 4 === 2 },
        { id: 'd', text: 'Option D', isCorrect: i % 4 === 3 },
      ],
      explanation: 'This is the explanation for why this answer is correct.',
      tags: [tags[i % tags.length]],
      createdAt,
    };
  });
};

const mapMessageToOfflineQuestion = (message: any, index: number): OfflineQuestion | null => {
  const payload = message.question || message.questionData || message;
  const stem = payload.questionStem || payload.stem || message.text || message.content;
  if (!stem) return null;

  const rawOptions = payload.options || [];
  const options = Array.isArray(rawOptions)
    ? rawOptions.map((opt: any, i: number) => ({
        id: String(opt.id ?? opt.optionId ?? `opt-${i}`),
        text: String(opt.text ?? opt.optionText ?? opt.label ?? ''),
        isCorrect: Boolean(opt.isCorrect ?? opt.correct ?? payload.correctAnswerIds?.includes?.(opt.id)),
      }))
    : [];

  return {
    id: String(message.id ?? `q-${index}`),
    stem: String(stem),
    type:
      canonicalOfflineQuestionType(payload.questionType || payload.type || message.questionType) ||
      String(payload.questionType || payload.type || 'mcq-single'),
    options,
    explanation: payload.explanation || message.explanation,
    tags: payload.tags || message.tags || [],
    imageUrl: payload.imageUrl || message.imageUrl,
    createdAt: message.created_at || message.timestamp || new Date().toISOString(),
  };
};

const fetchGroupQuestionsForOffline = async (
  groupId: string,
  options?: DownloadOptions
): Promise<OfflineQuestion[]> => {
  const messages = await api.fetchMessages(groupId, { limit: 200 });
  const list = Array.isArray(messages) ? messages : (messages as any)?.data || [];
  let questions = list
    .filter(
      (m: any) =>
        m.type === 'QUESTION' ||
        m.type === 'question' ||
        m.questionType ||
        m.questionStem
    )
    .map(mapMessageToOfflineQuestion)
    .filter(Boolean) as OfflineQuestion[];

  if (options?.questionTypes?.length) {
    questions = questions.filter((q) =>
      matchesOfflineQuestionTypeFilter(q.type, options.questionTypes!)
    );
  }

  if (options?.recentlyAddedDays && options.recentlyAddedDays > 0) {
    const cutoff = Date.now() - options.recentlyAddedDays * 24 * 60 * 60 * 1000;
    questions = questions.filter(q => !q.createdAt || new Date(q.createdAt).getTime() >= cutoff);
  }

  if (options?.questionCount && options.questionCount > 0) {
    questions = questions.slice(0, options.questionCount);
  }

  if (questions.length === 0) {
    throw new Error('No questions found in this group. Add questions to the group chat first.');
  }

  return questions;
};

export const useOfflineStore = create<OfflineState>((set, get) => ({
  downloadedTests: [],
  pendingResults: [],
  isDownloading: false,
  downloadProgress: 0,
  isSyncing: false,
  lastSyncAt: null,
  totalStorageUsed: 0,

  loadOfflineData: async (userId?: string) => {
    try {
      const [testsData, resultsData] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY),
        AsyncStorage.getItem(RESULTS_KEY),
      ]);
      
      let downloadedTests: OfflineTest[] = testsData ? JSON.parse(testsData) : [];
      const pendingResults = resultsData ? JSON.parse(resultsData) : [];

      if (userId) {
        try {
          const apiBundles = await api.fetchOfflineBundles(userId);
          downloadedTests = apiBundles.map(mapApiBundleToOfflineTest);
          await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(downloadedTests));
        } catch (apiError) {
          console.warn('Failed to fetch offline bundles from API, using cache:', apiError);
        }
      }
      
      const totalStorageUsed = downloadedTests.reduce((sum: number, t: OfflineTest) => sum + t.size, 0);
      
      set({ downloadedTests, pendingResults, totalStorageUsed });
    } catch (error) {
      console.error('Failed to load offline data:', error);
    }
  },

  downloadTest: async (testId, groupId, groupName, testName, options, userId) => {
    set({ isDownloading: true, downloadProgress: 0 });
    
    try {
      // Simulate download progress
      for (let i = 0; i <= 100; i += 10) {
        await new Promise(resolve => setTimeout(resolve, 200));
        set({ downloadProgress: i });
      }
      
      set({ downloadProgress: 30 });

      let questions: OfflineQuestion[];
      try {
        questions = await fetchGroupQuestionsForOffline(groupId, options);
      } catch (fetchError) {
        if (__DEV__) {
          console.warn('[OfflineStore] Falling back to sample questions in dev:', fetchError);
          const questionCount = options?.questionCount || 10;
          questions = generateMockQuestions(questionCount, options?.questionTypes, options?.recentlyAddedDays);
        } else {
          throw fetchError;
        }
      }
      
      set({ downloadProgress: 70 });
      
      // Shuffle if requested
      if (options?.shuffleQuestions) {
        questions = questions.sort(() => Math.random() - 0.5);
      }
      
      // Remove explanations if not requested
      if (options?.includeExplanations === false) {
        questions = questions.map(q => ({ ...q, explanation: undefined }));
      }
      
      // Calculate approximate size (rough estimate)
      const size = Math.round(JSON.stringify(questions).length / 1024);
      
      const bundleId = `offline-${Date.now()}`;
      const config = {
        groupId,
        groupName,
        numberOfQuestions: questions.length,
        timerDuration: (options?.timeLimit || 0) * 60,
        allowedQuestionTypes: options?.questionTypes,
        shuffleQuestions: options?.shuffleQuestions,
        recentlyAddedDays: options?.recentlyAddedDays,
      };

      const newTest: OfflineTest = {
        id: bundleId,
        testId: bundleId,
        groupId,
        groupName,
        testName,
        questionCount: questions.length,
        downloadedAt: new Date().toISOString(),
        size,
        questions,
        timeLimit: options?.timeLimit,
        questionTypes: options?.questionTypes,
        shuffled: options?.shuffleQuestions,
        recentlyAddedDays: options?.recentlyAddedDays,
      };
      
      const downloadedTests = [...get().downloadedTests, newTest];
      const totalStorageUsed = await persistLocalTests(downloadedTests);

      if (userId) {
        try {
          await api.saveOfflineBundle(userId, {
            bundleId,
            config,
            questions,
            groupName,
            displayName: testName,
            downloadedAt: newTest.downloadedAt,
          });
        } catch (apiError) {
          console.warn('Failed to save offline bundle to API:', apiError);
        }
      }
      
      set({ 
        downloadedTests, 
        totalStorageUsed,
        isDownloading: false, 
        downloadProgress: 100 
      });
    } catch (error) {
      console.error('Failed to download test:', error);
      set({ isDownloading: false, downloadProgress: 0 });
      throw error;
    }
  },

  deleteDownloadedTest: async (id: string, userId?: string) => {
    try {
      const downloadedTests = get().downloadedTests.filter(t => t.id !== id);
      const totalStorageUsed = await persistLocalTests(downloadedTests);

      if (userId) {
        try {
          await api.deleteOfflineBundle(userId, id);
        } catch (apiError) {
          console.warn('Failed to delete offline bundle from API:', apiError);
        }
      }
      
      set({ downloadedTests, totalStorageUsed });
    } catch (error) {
      console.error('Failed to delete test:', error);
      throw error;
    }
  },

  savePendingResult: async (result) => {
    try {
      const newResult: PendingResult = {
        ...result,
        id: `result-${Date.now()}`,
        synced: false,
      };
      
      const pendingResults = [...get().pendingResults, newResult];
      
      await AsyncStorage.setItem(RESULTS_KEY, JSON.stringify(pendingResults));
      
      set({ pendingResults });
    } catch (error) {
      console.error('Failed to save result:', error);
      throw error;
    }
  },

  syncPendingResults: async (userId: string) => {
    set({ isSyncing: true });
    
    try {
      const unsynced = get().pendingResults.filter(r => !r.synced);
      const syncedIds = new Set<string>();

      for (const result of unsynced) {
        try {
          if (result.sessionPayload) {
            const savedSession = await api.saveTestResult(userId, result.sessionPayload);
            if (savedSession?.id) {
              await api.submitTestResult(savedSession.id, {
                score: result.sessionPayload.score,
                correctAnswersCount: result.sessionPayload.correctAnswersCount,
                totalQuestions: result.sessionPayload.totalQuestions,
              });
            }
          } else {
            await api.saveTestResult(userId, {
              score: result.percentage,
              correctAnswersCount: result.score,
              totalQuestions: result.totalQuestions,
              startTime: result.completedAt,
              endTime: result.completedAt,
              config: { groupName: result.groupName, testId: result.testId },
            });
          }
          syncedIds.add(result.id);
        } catch (syncError) {
          console.error('Failed to sync result:', result.id, syncError);
        }
      }

      const pendingResults = get().pendingResults.filter(r => !syncedIds.has(r.id));
      
      await AsyncStorage.setItem(RESULTS_KEY, JSON.stringify(pendingResults));
      
      set({ 
        pendingResults,
        isSyncing: false,
        lastSyncAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Failed to sync results:', error);
      set({ isSyncing: false });
      throw error;
    }
  },

  clearAllOfflineData: async (userId?: string) => {
    try {
      if (userId) {
        const { downloadedTests } = get();
        await Promise.all(
          downloadedTests.map(t =>
            api.deleteOfflineBundle(userId, t.id).catch(err =>
              console.warn('Failed to delete bundle from API:', t.id, err)
            )
          )
        );
      }

      await Promise.all([
        AsyncStorage.removeItem(STORAGE_KEY),
        AsyncStorage.removeItem(RESULTS_KEY),
      ]);
      
      set({
        downloadedTests: [],
        pendingResults: [],
        totalStorageUsed: 0,
      });
    } catch (error) {
      console.error('Failed to clear offline data:', error);
      throw error;
    }
  },

  getOfflineTest: (testId: string) => {
    return get().downloadedTests.find(t => t.testId === testId);
  },
}));
