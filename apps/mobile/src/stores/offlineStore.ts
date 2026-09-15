// ===========================================
// Lantern Study Mobile - Offline Store
// ===========================================
//
// Purpose: downloadable test bundles and the results taken while offline.
// Holds the bundles this handset can run without a network, and the queue of
// finished results waiting to be uploaded.
//
// Main exports: `useOfflineStore` (zustand), and the types `OfflineTest`,
// `OfflineQuestion`, `PendingResult`, `DownloadOptions`.
//
// Touches:
// - AsyncStorage keys `@lantern_offline_data` (bundles) and the per-user
//   pending-results keys built by ./pendingResultsScope (plus the legacy
//   unkeyed key, migrated once per account on load).
// - services/api: fetchOfflineBundles / saveOfflineBundle /
//   deleteOfflineBundle / fetchMessages / saveTestResult / submitTestResult.
// - utils/offlineQuestionShape + utils/questionHelpers for the one question
//   mapper both bundle paths share.
// - utils/pendingQuestionBankScores, imported lazily during a sync.
// - Read by testStore.submitTest (offline submissions land in
//   `savePendingResult`).
//
// Gotchas:
// - `lockAnswered` is TRI-STATE. `undefined` means "no toggle in this flow",
//   and must stay undefined so the global study setting still applies; an
//   explicit `false` in a cloud bundle's config overrides a global lock-ON
//   after sync.
// - Bundle questions are shared storage between web and mobile and arrive in
//   two shapes (web's Message shape and mobile's own); every read goes through
//   `mapMessageToOfflineQuestion`.
// - Pending results are per user. Nothing may be uploaded under a user id that
//   does not own it, and an unowned legacy entry is adopted only by the
//   signed-in account.

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as api from '../services/api';
import {
  canonicalOfflineQuestionType,
  matchesOfflineQuestionTypeFilter,
} from '../utils/questionHelpers';
import { normalizeOfflineBundleQuestion } from '../utils/offlineQuestionShape';
import {
  PENDING_RESULTS_LEGACY_KEY,
  mergeIntoStoredResults,
  pendingResultsKey,
  planPendingResultsLoad,
  resultsOwnedBy,
  stampOwner,
} from './pendingResultsScope';
import {
  ensureResultIdempotencyKey,
  resultIdempotencyKey,
} from '@lantern/shared/offlineQueue';

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
  /** Exam lock chosen at download time: can't revisit answered questions. */
  lockAnswered?: boolean;
  /** Academic archive: offline_bundles.course_id (config.courseId is the fallback). */
  courseId?: string | null;
  /**
   * Academic archive: the topic within {@link courseId}. Rides in the bundle
   * config only — offline_bundles has no topic_id column — the way web reads
   * bundle.config.topicId. Used to prefill the topic when re-publishing.
   */
  topicId?: string | null;
}

export interface OfflineQuestion {
  id: string;
  stem: string;
  type: string;
  options: { id: string; text: string; isCorrect: boolean }[];
  correctAnswer?: string;
  /** Fill-in-blank: every accepted answer (correctAnswer holds the first). */
  acceptableAnswers?: string[];
  // Matching questions live as three parallel structures in the source
  // Message shape; all three are needed to rebuild playable pairs.
  matchingPromptItems?: Array<{ id: string; text: string }>;
  matchingAnswerItems?: Array<{ id: string; text: string }>;
  correctMatches?: Array<{ promptItemId: string; answerItemId: string }>;
  diagramLabels?: Array<{ id?: string; label?: string; text?: string; x?: number; y?: number }>;
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
  /**
   * The account that finished the test. Pending results are stored per user
   * (see pendingResultsScope) so a second account on the same handset can
   * neither see nor upload the first student's work. Optional only because
   * legacy entries written before scoping carry no owner.
   */
  userId?: string;
  /**
   * FIXED (F2): the attempt's idempotency key, minted ONCE when the result is
   * queued and re-read on every retry. A fresh key per attempt is the same as
   * no key — the server writes a second session for one sitting and the score
   * is counted twice on the dashboard. Optional only because entries queued
   * before F2 carry none; `resultIdempotencyKey` derives a stable key for them.
   */
  idempotencyKey?: string;
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
  // Accepts both the UI's kebab ids (mcq-single) and canonical enum types
  // (multiple_choice_single) — the filter canonicalizes either side.
  questionTypes?: string[];
  questionCount?: number;
  timeLimit?: number; // in minutes, 0 = no limit
  shuffleQuestions?: boolean;
  includeExplanations?: boolean;
  recentlyAddedDays?: number; // 0 = all questions, 7 = last 7 days, 14, 30, etc.
  /** Exam lock: can't revisit answered questions when the bundle is taken. */
  lockAnswered?: boolean;
  /** Academic archive: file the bundle under a course (defaults from the group's course). */
  courseId?: string | null;
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
  savePendingResult: (
    result: Omit<PendingResult, 'id' | 'synced' | 'userId'>,
    userId?: string
  ) => Promise<void>;
  /** Returns honest counts — per-result failures don't throw, so callers must
      not treat a clean return as "everything synced". */
  syncPendingResults: (userId: string) => Promise<{ synced: number; remaining: number }>;
  clearAllOfflineData: (userId?: string) => Promise<void>;
  getOfflineTest: (testId: string) => OfflineTest | undefined;
}

const STORAGE_KEY = '@lantern_offline_data';
/**
 * Pending results are keyed per user. RESULTS_KEY is the LEGACY unkeyed key,
 * read once per account on load and then removed — see pendingResultsScope.
 */
const RESULTS_KEY = PENDING_RESULTS_LEGACY_KEY;

/**
 * Write pending results to `key`, MERGED with what the key already holds.
 *
 * Memory is only a cache of the key and may not have been loaded for this
 * user yet (second account on a shared handset, a save before the first
 * load); a plain overwrite would drop the results that live only in storage.
 * `dropIds` removes the entries a sync just uploaded.
 */
const writePendingResults = async (
  key: string,
  results: PendingResult[],
  dropIds?: ReadonlySet<string>
) => {
  const existingRaw = await AsyncStorage.getItem(key);
  await AsyncStorage.setItem(
    key,
    JSON.stringify(mergeIntoStoredResults(existingRaw, results, dropIds))
  );
};

/** Persist `userId`'s pending results under their own key. */
const persistPendingResults = async (
  userId: string | undefined,
  results: PendingResult[],
  dropIds?: ReadonlySet<string>
) => {
  await writePendingResults(userId ? pendingResultsKey(userId) : RESULTS_KEY, results, dropIds);
};

type ApiOfflineBundle = Awaited<ReturnType<typeof api.fetchOfflineBundles>>[number];

const mapApiBundleToOfflineTest = (bundle: ApiOfflineBundle): OfflineTest => {
  const config = (bundle.config || {}) as Record<string, unknown>;
  // Offline bundles are shared storage: web writes the group Message shape
  // ({questionStem, correctAnswerIds}) while mobile writes {stem, options:
  // [{isCorrect}]}. A cloud bundle — a web-made one, or a marketplace question
  // bank delivered to a buyer — can be either, and mapMessageToOfflineQuestion
  // already reads both. Without this the stem and options render empty.
  const questions = (bundle.questions || [])
    .map((q, index) => mapMessageToOfflineQuestion(q, index))
    .filter(Boolean) as OfflineQuestion[];
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
    lockAnswered: config.lockAnsweredQuestions as boolean | undefined,
    // Column first (filterable server-side), config.courseId as the fallback.
    courseId:
      (bundle as { course_id?: string | null }).course_id ??
      (typeof config.courseId === 'string' ? config.courseId : null),
    // No offline_bundles.topic_id column, so config.topicId is the only source
    // (web writes and reads it the same way).
    topicId: typeof config.topicId === 'string' ? config.topicId : null,
  };
};

const persistLocalTests = async (downloadedTests: OfflineTest[]) => {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(downloadedTests));
  const totalStorageUsed = downloadedTests.reduce((sum, t) => sum + t.size, 0);
  return totalStorageUsed;
};

/**
 * The ONE mapper. Both paths that build a bundle read it: the group download
 * below, and the cloud hydration above (a web-made bundle, or a purchased
 * question bank). It lives in utils/offlineQuestionShape so a jest test can
 * hold the shipped code — the earlier test mirrored a private copy of this
 * function and stayed green while the real one dropped every option's text.
 */
const mapMessageToOfflineQuestion = (message: any, index: number): OfflineQuestion | null => {
  const question = normalizeOfflineBundleQuestion(message, index);
  if (!question) return null;
  // Kept from the old mapper: the stored type is canonicalised so the
  // download-time type filters compare like with like.
  return {
    ...question,
    type: canonicalOfflineQuestionType(question.type) || question.type,
  } as OfflineQuestion;
};

/**
 * Build the question list for a group download: fetch the last 200 messages,
 * keep the ones that are questions, then apply the download options in a fixed
 * order — type filter, recency filter, count cap. The count cap runs LAST so
 * "20 questions of type X" means twenty of X, not twenty messages of which
 * some are X. Throws when nothing survives, because an empty bundle is
 * indistinguishable from a broken one once it is on disk.
 */
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

  // Boot/refresh path. Reads local bundles and this account's pending results,
  // migrates the legacy unkeyed results key, then merges the cloud bundle list
  // over the local one. A cloud fetch failure must leave the local cache
  // standing (it is caught and warned, not rethrown) — the whole point of this
  // store is that it works with no network.
  loadOfflineData: async (userId?: string) => {
    try {
      const [testsData, scopedResultsRaw, legacyResultsRaw] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY),
        userId ? AsyncStorage.getItem(pendingResultsKey(userId)) : Promise.resolve(null),
        AsyncStorage.getItem(RESULTS_KEY),
      ]);

      // Bundles already on this handset were written by whichever build
      // downloaded them, so they carry the old shapes too. Re-normalising on
      // read repairs the ones that can be repaired (string options, options
      // under another key) instead of leaving a downloaded test unanswerable
      // until it is deleted and fetched again. It is a no-op for a bundle
      // that is already canonical.
      let downloadedTests: OfflineTest[] = (testsData ? JSON.parse(testsData) : []).map(
        (test: OfflineTest) => ({
          ...test,
          questions: (test.questions || [])
            .map((q, index) => mapMessageToOfflineQuestion(q, index))
            .filter(Boolean) as OfflineQuestion[],
        })
      );

      // Without a user there is nobody to attribute pending results to, so we
      // load none rather than risk showing (and later uploading) another
      // account's work. Whatever is already in memory stays put.
      let pendingResults: PendingResult[] = get().pendingResults;
      if (userId) {
        const plan = planPendingResultsLoad<PendingResult>(
          userId,
          scopedResultsRaw,
          legacyResultsRaw
        );
        for (const write of plan.writes) {
          // Merged, not overwritten: another account's key may already hold
          // results the legacy list knows nothing about.
          await writePendingResults(write.key, write.results);
        }
        if (plan.removeLegacy) {
          await AsyncStorage.removeItem(RESULTS_KEY);
        }
        pendingResults = plan.results;
      }

      if (userId) {
        try {
          const apiBundles = await api.fetchOfflineBundles(userId);
          const cloud = apiBundles.map(mapApiBundleToOfflineTest);
          const cloudIds = new Set(cloud.map(t => t.id));
          // MERGE, don't replace: a bundle whose fire-and-forget cloud save
          // failed exists only locally — wholesale replacement silently
          // deleted it (and its questions) on the next refresh.
          const localOnly = downloadedTests.filter(t => !cloudIds.has(t.id));
          downloadedTests = [...cloud, ...localOnly];
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

  // Download a group's questions into a local bundle, then mirror it to the
  // cloud. Local persistence happens BEFORE the API call and the API call is
  // best-effort: a bundle whose cloud save failed still exists on the handset,
  // and loadOfflineData merges rather than replaces so that it survives.
  // `downloadProgress` moves on real checkpoints, not a timer.
  downloadTest: async (testId, groupId, groupName, testName, options, userId) => {
    set({ isDownloading: true, downloadProgress: 0 });
    
    try {
      // Real progress checkpoints: fetch questions → persist locally → sync to cloud.
      set({ downloadProgress: 10 });

      let questions = await fetchGroupQuestionsForOffline(groupId, options);
      
      set({ downloadProgress: 60 });
      
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
        // Web's config field name, so cross-device bundles keep the lock.
        // Emit only an explicit choice: flows with no lock toggle must stay
        // undefined so taking the bundle falls back to the global setting —
        // a bare `false` here would override a global lock-ON after sync.
        ...(typeof options?.lockAnswered === 'boolean'
          ? { lockAnsweredQuestions: options.lockAnswered }
          : {}),
        // The API lifts config.courseId into offline_bundles.course_id.
        ...(options?.courseId ? { courseId: options.courseId } : {}),
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
        lockAnswered: options?.lockAnswered,
        courseId: options?.courseId ?? null,
        // Mobile's download flow files by course only — no topic is chosen here,
        // so a fresh bundle starts unfiled. A topic can be set later at publish.
        topicId: null,
      };
      
      const downloadedTests = [...get().downloadedTests, newTest];
      const totalStorageUsed = await persistLocalTests(downloadedTests);

      set({ downloadProgress: 85 });

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

  // Queue one finished offline attempt. Called by testStore.submitTest when it
  // ran offline. The write is merged into the user's key rather than
  // overwriting it, because memory may not hold everything storage does.
  savePendingResult: async (result, userId) => {
    try {
      // FIXED (F2): the key is minted HERE, at enqueue, and never again — that
      // is what makes a retry idempotent rather than a second session.
      const newResult: PendingResult = ensureResultIdempotencyKey({
        ...result,
        id: `result-${Date.now()}`,
        synced: false,
        ...(userId ? { userId } : {}),
      });

      const pendingResults = [...get().pendingResults, newResult];

      // Persist only this user's own entries under their key; anything in
      // memory belonging to nobody/another account is not written there.
      await persistPendingResults(
        userId,
        userId ? resultsOwnedBy(pendingResults, userId) : pendingResults
      );

      set({ pendingResults });
    } catch (error) {
      console.error('Failed to save result:', error);
      throw error;
    }
  },

  // Upload this account's queued results on reconnect and drop only the ones
  // that actually landed.
  //
  // Error contract: a per-result failure is logged and the entry is LEFT in
  // the queue (never counted as synced, never dropped), so a transient network
  // error retries on the next sync instead of destroying the student's work.
  // The outer catch rethrows so the caller can surface a real failure — a
  // swallow here would report a clean sync that never happened. The return
  // value is the honest count; a clean return does not mean "all uploaded".
  syncPendingResults: async (userId: string) => {
    set({ isSyncing: true });

    // Question-bank scores ride the same reconnect moment, independent of the
    // result replay below so a failure on either side cannot block the other.
    void import('../utils/pendingQuestionBankScores')
      .then(({ flushPendingQuestionBankScores }) => flushPendingQuestionBankScores(userId))
      .catch(() => {
        /* leaderboard is not critical to result sync */
      });

    try {
      // Only this account's results. An entry belonging to another student on
      // a shared handset must never be uploaded under this user id. An entry
      // with no owner at all is adopted by the signed-in user, the same rule
      // the legacy migration uses — otherwise it could never be uploaded.
      const owned = get().pendingResults.map(r =>
        r.userId ? r : stampOwner(r, userId)
      );
      const unsynced = resultsOwnedBy(owned, userId).filter(r => !r.synced);
      const syncedIds = new Set<string>();

      // FIXED (F2): the replay is keyed. Each entry carries the key minted at
      // enqueue (or, for an entry queued before F2, a key derived
      // deterministically from its own id), so a result whose upload landed
      // server-side but failed on the wire replays the FIRST session back
      // instead of writing a second one and counting the score twice.
      for (const result of unsynced) {
        const idempotencyKey = resultIdempotencyKey(result, { userId });
        try {
          if (result.sessionPayload) {
            const savedSession = await api.saveTestResult(userId, {
              ...result.sessionPayload,
              idempotencyKey,
            });
            if (savedSession?.id) {
              await api.submitTestResult(
                savedSession.id,
                {
                  score: result.sessionPayload.score,
                  correctAnswersCount: result.sessionPayload.correctAnswersCount,
                  totalQuestions: result.sessionPayload.totalQuestions,
                },
                { idempotencyKey }
              );
            }
          } else {
            await api.saveTestResult(userId, {
              score: result.percentage,
              correctAnswersCount: result.score,
              totalQuestions: result.totalQuestions,
              startTime: result.completedAt,
              endTime: result.completedAt,
              config: { groupName: result.groupName, testId: result.testId },
              idempotencyKey,
            });
          }
          syncedIds.add(result.id);
        } catch (syncError) {
          console.error('Failed to sync result:', result.id, syncError);
        }
      }

      const pendingResults = get()
        .pendingResults.map(r => (r.userId ? r : stampOwner(r, userId)))
        .filter(r => !syncedIds.has(r.id));

      await persistPendingResults(userId, resultsOwnedBy(pendingResults, userId), syncedIds);

      set({
        pendingResults,
        isSyncing: false,
        lastSyncAt: new Date().toISOString(),
      });
      return {
        synced: syncedIds.size,
        remaining: pendingResults.filter(r => !r.synced).length,
      };
    } catch (error) {
      console.error('Failed to sync results:', error);
      set({ isSyncing: false });
      throw error;
    }
  },

  // Wipe local offline state, and the signed-in account's cloud bundles with
  // it. Per-bundle API deletes are individually caught so one failure cannot
  // leave the local wipe half-done; the storage removals only clear this
  // user's results key, never another account's.
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
        // Clear only the signed-in account's results (plus the legacy key,
        // which by then holds nothing this app writes).
        AsyncStorage.removeItem(RESULTS_KEY),
        ...(userId ? [AsyncStorage.removeItem(pendingResultsKey(userId))] : []),
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
