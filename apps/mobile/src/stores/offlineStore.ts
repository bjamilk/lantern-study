// ===========================================
// Lantern Study Mobile - Offline Store
// ===========================================

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
  loadOfflineData: () => Promise<void>;
  downloadTest: (testId: string, groupId: string, groupName: string, testName: string, options?: DownloadOptions) => Promise<void>;
  deleteDownloadedTest: (id: string) => Promise<void>;
  savePendingResult: (result: Omit<PendingResult, 'id' | 'synced'>) => Promise<void>;
  syncPendingResults: () => Promise<void>;
  clearAllOfflineData: () => Promise<void>;
  getOfflineTest: (testId: string) => OfflineTest | undefined;
}

const STORAGE_KEY = '@lantern_offline_data';
const RESULTS_KEY = '@lantern_pending_results';

// All question types available
const ALL_QUESTION_TYPES = ['mcq-single', 'mcq-multiple', 'true-false', 'fill-blank'] as const;

// Mock questions for demo download
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

export const useOfflineStore = create<OfflineState>((set, get) => ({
  downloadedTests: [],
  pendingResults: [],
  isDownloading: false,
  downloadProgress: 0,
  isSyncing: false,
  lastSyncAt: null,
  totalStorageUsed: 0,

  loadOfflineData: async () => {
    try {
      const [testsData, resultsData] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY),
        AsyncStorage.getItem(RESULTS_KEY),
      ]);
      
      const downloadedTests = testsData ? JSON.parse(testsData) : [];
      const pendingResults = resultsData ? JSON.parse(resultsData) : [];
      
      // Calculate total storage
      const totalStorageUsed = downloadedTests.reduce((sum: number, t: OfflineTest) => sum + t.size, 0);
      
      set({ downloadedTests, pendingResults, totalStorageUsed });
    } catch (error) {
      console.error('Failed to load offline data:', error);
    }
  },

  downloadTest: async (testId: string, groupId: string, groupName: string, testName: string, options?: DownloadOptions) => {
    set({ isDownloading: true, downloadProgress: 0 });
    
    try {
      // Simulate download progress
      for (let i = 0; i <= 100; i += 10) {
        await new Promise(resolve => setTimeout(resolve, 200));
        set({ downloadProgress: i });
      }
      
      // Use options or defaults
      const questionCount = options?.questionCount || Math.floor(Math.random() * 20) + 10;
      const questionTypes = options?.questionTypes;
      const recentlyAddedDays = options?.recentlyAddedDays;
      
      // Generate mock questions (in real app, fetch from API with filters)
      let questions = generateMockQuestions(questionCount, questionTypes, recentlyAddedDays);
      
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
      
      const newTest: OfflineTest = {
        id: `offline-${Date.now()}`,
        testId,
        groupId,
        groupName,
        testName,
        questionCount: questions.length,
        downloadedAt: new Date().toISOString(),
        size,
        questions,
        timeLimit: options?.timeLimit,
        questionTypes: questionTypes,
        shuffled: options?.shuffleQuestions,
        recentlyAddedDays: recentlyAddedDays,
      };
      
      const downloadedTests = [...get().downloadedTests, newTest];
      const totalStorageUsed = downloadedTests.reduce((sum, t) => sum + t.size, 0);
      
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(downloadedTests));
      
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

  deleteDownloadedTest: async (id: string) => {
    try {
      const downloadedTests = get().downloadedTests.filter(t => t.id !== id);
      const totalStorageUsed = downloadedTests.reduce((sum, t) => sum + t.size, 0);
      
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(downloadedTests));
      
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

  syncPendingResults: async () => {
    set({ isSyncing: true });
    
    try {
      // Simulate sync delay
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Mark all as synced
      const pendingResults = get().pendingResults.map(r => ({ ...r, synced: true }));
      
      // In a real app, you would send these to the server, then remove synced ones
      const unsyncedResults = pendingResults.filter(r => !r.synced);
      
      await AsyncStorage.setItem(RESULTS_KEY, JSON.stringify(unsyncedResults));
      
      set({ 
        pendingResults: unsyncedResults,
        isSyncing: false,
        lastSyncAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Failed to sync results:', error);
      set({ isSyncing: false });
      throw error;
    }
  },

  clearAllOfflineData: async () => {
    try {
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
