// ===========================================
// Lantern Study Mobile - Test Store
// ===========================================

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PausedSessionSummary } from '@lantern/shared';
import * as api from '../services/api';
import {
  abandonMobileTestDraft,
  completeMobileTestDraft,
  createMobileTestDraft,
  fetchMobilePausedSessions,
  fetchMobileTestDraft,
  patchMobileTestDraft,
} from '../services/testDrafts';
import { trackStudyActivity } from '../services/gamification';
import { trackTestCompleted } from '../services/productAnalytics';
import { syncService } from '../services/syncService';
import { fetchTestResultsCached, clearTestResultsCache } from '../services/dashboardCache';
import { normalizeApiQuestions, flashcardsToQuestions, filterTestQuestions, formatCorrectAnswerDisplay, resolveCorrectAnswerLabel, restoreMatchingAnswerMap } from '../utils/questionHelpers';
import { normalizeUserQuestionStats } from '../utils/buildDashboardStats';
import { useOfflineStore } from './offlineStore';
import {
  normalizeTestQuestionForSession,
  toUserAnswerRecord,
  shuffleArray,
  nearestPreviousUnlockedIndex,
} from '@lantern/shared/utils';
import { useSettingsStore } from './settingsStore';
import {
  hasStoredTimerChoice,
  resolveAttemptTimeLimitMinutes,
  resolveResumeTimeLimitMinutes,
} from '../utils/resolveAttemptTimeLimitMinutes';
import {
  activeElapsedSeconds,
  bankedSecondsFromTimings,
  timingsFromDraftAnswers,
} from '../utils/testDuration';

const DEMO_MODE = false;

function unwrapFlashcards(response: unknown): api.Flashcard[] {
  if (Array.isArray(response)) return response as api.Flashcard[];
  if (response && typeof response === 'object' && Array.isArray((response as any).data)) {
    return (response as any).data as api.Flashcard[];
  }
  return [];
}


function buildQuestionStatsFromAttempts(
  attempts: TestAttempt[]
): Record<string, { correctAttempts: number; incorrectAttempts: number }> {
  const stats: Record<string, { correctAttempts: number; incorrectAttempts: number }> = {};
  for (const attempt of attempts) {
    for (const answer of attempt.answers) {
      if (!stats[answer.questionId]) {
        stats[answer.questionId] = { correctAttempts: 0, incorrectAttempts: 0 };
      }
      if (answer.isCorrect) {
        stats[answer.questionId].correctAttempts += 1;
      } else {
        stats[answer.questionId].incorrectAttempts += 1;
      }
    }
  }
  return stats;
}

function buildSessionPayload(
  activeTest: ActiveTest,
  attempt: Pick<TestAttempt, 'startedAt' | 'completedAt'>,
  answers: TestAttempt['answers'],
  percentage: number,
  correctCount: number,
  options?: { groupName?: string; groupId?: string }
) {
  const canonicalQuestions = activeTest.questions.map((q, index) =>
    normalizeTestQuestionForSession(q as unknown as Record<string, unknown>, index)
  );

  const userAnswers: Record<string, ReturnType<typeof toUserAnswerRecord>> = {};
  for (const answer of answers) {
    const question = activeTest.questions.find(q => q.id === answer.questionId);
    if (!question) continue;
    const raw = activeTest.answers[answer.questionId];
    const attempted =
      raw !== undefined &&
      raw !== null &&
      !(typeof raw === 'string' && raw.trim() === '') &&
      !(Array.isArray(raw) && raw.length === 0);
    // Omit unattempted keys entirely so hydrate matches web (skipped ≠ wrong).
    if (!attempted) continue;
    userAnswers[answer.questionId] = toUserAnswerRecord(
      question as unknown as Record<string, unknown>,
      raw,
      {
        isCorrect: answer.isCorrect,
        timeSpentSeconds: activeTest.answerTimings?.[answer.questionId],
      }
    );
  }

  return {
    questions: canonicalQuestions,
    userAnswers,
    score: percentage,
    correctAnswersCount: correctCount,
    totalQuestions: activeTest.questions.length,
    startTime: attempt.startedAt,
    endTime: attempt.completedAt,
    config: {
      name: activeTest.test.name,
      testId: activeTest.test.id,
      deckName: activeTest.test.deckName,
      groupName: options?.groupName || activeTest.test.deckName,
      groupId: options?.groupId,
      // Academic archive: the API lifts config.courseId/topicId into
      // test_sessions.course_id/topic_id. The topic never travels without it.
      ...(activeTest.courseId ? { courseId: activeTest.courseId } : {}),
      ...(activeTest.courseId && activeTest.topicId ? { topicId: activeTest.topicId } : {}),
      passingScore: activeTest.test.passingScore,
      mode: activeTest.mode,
      // Persist timer so retake restores the same conditions (minutes + seconds for web parity).
      timerDurationMinutes: activeTest.test.timeLimit || 0,
      timerDuration: (activeTest.test.timeLimit || 0) * 60,
      numberOfQuestions: activeTest.questions.length,
    },
  };
}

function buildDraftPayloadFromActive(activeTest: ActiveTest) {
  const canonicalQuestions = activeTest.questions.map((q, index) =>
    normalizeTestQuestionForSession(q as unknown as Record<string, unknown>, index),
  );
  const userAnswers: Record<string, ReturnType<typeof toUserAnswerRecord>> = {};
  for (const [questionId, answer] of Object.entries(activeTest.answers)) {
    const question = activeTest.questions.find((q) => q.id === questionId);
    if (!question) continue;
    userAnswers[questionId] = toUserAnswerRecord(
      question as unknown as Record<string, unknown>,
      answer,
      { timeSpentSeconds: activeTest.answerTimings?.[questionId] },
    );
  }
  // Study-group id only — never deckId/custom session id. Those broke Group
  // Performance after cloud drafts landed (chart filters by group membership).
  const groupId = activeTest.groupId || undefined;
  const groupName = activeTest.groupName || activeTest.test.name;
  return {
    config: {
      groupId,
      groupName,
      // Academic archive: the API lifts config.courseId/topicId into
      // test_sessions.course_id/topic_id. The topic never travels without it.
      ...(activeTest.courseId ? { courseId: activeTest.courseId } : {}),
      ...(activeTest.courseId && activeTest.topicId ? { topicId: activeTest.topicId } : {}),
      numberOfQuestions: activeTest.questions.length,
      questionIds: activeTest.questions.map((q) => q.id),
      // Both units, so a resume never has to guess at the reader's choice —
      // and so an untimed session reads as 0 minutes rather than as a key
      // that happens to be missing. See utils/resolveAttemptTimeLimitMinutes.
      timerDurationMinutes: activeTest.test.timeLimit || 0,
      timerDuration: (activeTest.test.timeLimit || 0) * 60,
      allowedQuestionTypes: [],
      testId: activeTest.test.id,
      deckId: activeTest.test.deckId,
      deckName: activeTest.test.deckName,
      name: activeTest.test.name,
      // Web's field name, so a cross-platform resume also enforces the lock.
      // The locked-question set itself is not persisted: it is derivable on
      // resume from answers + current index (see resumePausedSession).
      lockAnsweredQuestions: activeTest.lockAnswered === true,
    },
    questions: canonicalQuestions,
    user_answers: userAnswers,
    session_kind: (activeTest.mode === 'study' ? 'study' : 'test') as 'test' | 'study',
    title: activeTest.test.name,
    current_question_index: activeTest.currentQuestionIndex,
    remaining_time_seconds: activeTest.mode === 'test' ? activeTest.timeRemaining : null,
    start_time: new Date(activeTest.startTime).toISOString(),
  };
}

async function ensureMobileDraft(activeTest: ActiveTest): Promise<ActiveTest> {
  if (activeTest.draftId && !activeTest.draftId.startsWith('local-')) {
    return activeTest;
  }
  try {
    const created = await createMobileTestDraft(buildDraftPayloadFromActive(activeTest));
    return { ...activeTest, draftId: String(created.id) };
  } catch (error) {
    console.warn('Failed to create test draft', error);
    return {
      ...activeTest,
      draftId: activeTest.draftId || `local-${Date.now()}`,
    };
  }
}

// Storage keys
const TESTS_STORAGE_KEY = 'lantern_tests';
const ATTEMPTS_STORAGE_KEY = 'lantern_test_attempts';
const TEST_QUESTIONS_STORAGE_KEY = 'lantern_test_questions';

// 7 Question Types matching web app
export type QuestionType = 
  | 'multiple_choice_single'    // MCQ with single answer
  | 'multiple_choice_multiple'  // MCQ with multiple answers
  | 'true_false'                // True/False
  | 'fill_in_blank'             // Fill in the blank
  | 'matching'                  // Match pairs
  | 'diagram_labeling'          // Label parts of a diagram
  | 'open_ended';               // Open-ended/essay

// For matching questions
export interface MatchingPair {
  id: string;
  left: string;
  right: string;
}

// For diagram labeling
export interface DiagramLabel {
  id: string;
  label: string;
  x: number; // percentage position
  y: number;
}

export interface TestQuestion {
  id: string;
  type: QuestionType;
  question: string;
  // For MCQ single/multiple and true/false
  options?: string[];
  optionItems?: Array<{ id: string; text: string }>;
  // For MCQ single, true/false, fill in blank
  correctAnswer?: string;
  // For MCQ multiple - array of correct options
  correctAnswers?: string[];
  // For matching - pairs to match
  matchingPairs?: MatchingPair[];
  // For diagram labeling
  diagramUrl?: string;
  imageUrl?: string;
  diagramLabels?: DiagramLabel[];
  // For fill in blank - multiple blanks support
  blanks?: { id: string; correctAnswer: string }[];
  // For open-ended - sample answer or keywords
  sampleAnswer?: string;
  keywords?: string[];
  explanation?: string;
  points: number;
  tags?: string[];
}

export interface Test {
  id: string;
  name: string;
  description?: string;
  deckId?: string;
  deckName?: string;
  questionCount: number;
  timeLimit: number; // in minutes, 0 = no limit
  passingScore: number; // percentage
  createdAt: string;
}

export interface TestAttempt {
  id: string;
  testId: string;
  /** Original template/deck test id when the attempt was a one-off session. */
  originalTestId?: string;
  testName: string;
  groupId?: string;
  groupName?: string;
  /** Academic archive: test_sessions.course_id (lifted from config.courseId). Drives the Library's course filter on History. */
  courseId?: string | null;
  /** Syllabus topic inside `courseId` (test_sessions.topic_id via config.topicId). */
  topicId?: string | null;
  startedAt: string;
  completedAt?: string;
  score: number;
  totalPoints: number;
  percentage: number;
  passed: boolean;
  /** Minutes; 0 = no time limit. Used to restore conditions on retake. */
  timeLimitMinutes?: number;
  answers: {
    questionId: string;
    userAnswer: string | string[] | Record<string, string>; // Support different answer formats
    isCorrect: boolean;
    points: number;
    questionText?: string;
    questionType?: QuestionType;
    correctAnswer?: string | string[] | Record<string, string>;
    options?: string[];
    explanation?: string;
    tags?: string[];
    /** Per-question dwell time for detailed analysis charts. */
    timeSpentSeconds?: number;
    questionSnapshot?: TestQuestion;
  }[];
  timeSpent: number; // in seconds
}

// Test vs Study Mode
export type TestMode = 'test' | 'study';

export interface ActiveTest {
  test: Test;
  questions: TestQuestion[];
  currentQuestionIndex: number;
  answers: Record<string, string | string[] | Record<string, string>>; // Support different formats
  answerTimings: Record<string, number>;
  /**
   * When the FIRST run of this session began. It is the draft's `start_time`
   * and the attempt's `startedAt`, so it keeps meaning that across a resume —
   * it is NOT how long the reader has been working (see `runStartedAt`).
   */
  startTime: number;
  /**
   * When the CURRENT run began: the same as `startTime` on a fresh start, and
   * the moment of the resume otherwise. Duration is measured from here.
   */
  runStartedAt: number;
  /**
   * Active seconds banked by earlier runs of this session, recovered on resume
   * from the per-question timings the draft already persists. A snapshot taken
   * at the resume: re-answering a question afterwards re-times it for the
   * per-question chart without revising this total.
   */
  bankedSeconds: number;
  timeRemaining: number; // in seconds
  mode: TestMode; // 'test' = timed, no feedback | 'study' = untimed, immediate feedback
  // For study mode - track which questions have been answered and revealed
  revealedAnswers: Set<string>;
  flaggedQuestions: Set<string>;
  /** Exam lock: once answered + advanced, a question can't be revisited (test mode). */
  lockAnswered?: boolean;
  /** Ids of questions locked from navigation when lockAnswered is on. */
  lockedQuestionIds?: Set<string>;
  /** Server draft id for durable pause/resume */
  draftId?: string;
  /** Study group attribution for dashboard Group Performance */
  groupId?: string;
  groupName?: string;
  /** Academic archive: course this session belongs to (test_sessions.course_id via config.courseId). */
  courseId?: string | null;
  /** Syllabus topic inside `courseId` (test_sessions.topic_id via config.topicId). */
  topicId?: string | null;
}

export interface StartTestConfig {
  timeLimit?: number;
  questionCount?: number;
  userId?: string;
  questionTypes?: QuestionType[];
  tags?: string[];
  spacedRepetition?: boolean;
  focusOnNew?: boolean;
  groupId?: string;
  groupName?: string;
  /** Exam lock for this session; falls back to the study setting when omitted. */
  lockAnswered?: boolean;
  /** Academic archive: course picked in TestConfig (defaults from the group). */
  courseId?: string | null;
  /** Topic picked in TestConfig; ignored without a course. */
  topicId?: string | null;
}

/** True when a stored mobile answer counts as answered (non-empty). */
export function isMobileAnswerAnswered(
  answer: string | string[] | Record<string, string> | undefined
): boolean {
  if (answer == null) return false;
  if (typeof answer === 'string') return answer.trim() !== '';
  if (Array.isArray(answer)) return answer.length > 0;
  if (typeof answer === 'object') return Object.keys(answer).length > 0;
  return false;
}

export interface UserQuestionStatEntry {
  correctAttempts: number;
  incorrectAttempts: number;
  lastAttempted?: string | null;
  stem?: string | null;
  groupName?: string | null;
}

export interface TestPresetConfig {
  numberOfQuestions: number;
  timerDuration?: number;
  allowedQuestionTypes: string[];
  selectedTags?: string[];
  focusOnNew?: boolean;
}

export interface TestPreset {
  id: string;
  name: string;
  config: TestPresetConfig;
}

interface TestState {
  tests: Test[];
  attempts: TestAttempt[];
  activeTest: ActiveTest | null;
  pausedSessions: PausedSessionSummary[];
  testQuestionsById: Record<string, TestQuestion[]>;
  userQuestionStats: Record<string, UserQuestionStatEntry>;
  testPresets: TestPreset[];
  isLoading: boolean;
  error: string | null;
  
  // Local storage helpers
  loadFromStorage: () => Promise<void>;
  saveToStorage: () => Promise<void>;
  
  // Actions
  fetchTests: (userId: string) => Promise<void>;
  fetchAttempts: (userId: string) => Promise<void>;
  hydrateAttemptDetail: (attemptId: string) => Promise<void>;
  startTest: (testId: string, mode?: TestMode, config?: StartTestConfig) => Promise<void>;
  startQuestionSet: (
    testName: string,
    questions: TestQuestion[],
    mode?: TestMode,
    options?: {
      timeLimitMinutes?: number;
      groupId?: string;
      groupName?: string;
      lockAnswered?: boolean;
      /** Academic archive: course this session is filed under. */
      courseId?: string | null;
      /** Syllabus topic inside `courseId`; ignored without one. */
      topicId?: string | null;
    }
  ) => Promise<void>;
  /** Bind study-group attribution once route params are known (after draft create). */
  setActiveTestAttribution: (attribution: { groupId?: string; groupName?: string }) => void;
  answerQuestion: (questionId: string, answer: string | string[] | Record<string, string>, timeSpentSeconds?: number) => void;
  revealAnswer: (questionId: string) => void; // For study mode
  checkCurrentAnswer: () => { isCorrect: boolean; explanation?: string } | null; // For study mode
  toggleFlag: (questionId: string) => void;
  goToQuestion: (index: number) => void;
  nextQuestion: () => void;
  previousQuestion: () => void;
  submitTest: (userId: string, options?: { isOffline?: boolean; groupName?: string; groupId?: string }) => Promise<TestAttempt>;
  exitStudyMode: () => void; // Exit without submitting (study or test)
  pauseActiveTest: () => Promise<void>;
  refreshPausedSessions: () => Promise<void>;
  resumePausedSession: (sessionId: string) => Promise<void>;
  abandonPausedSession: (sessionId: string) => Promise<void>;
  updateTimeRemaining: (seconds: number) => void;
  loadUserQuestionStats: (userId: string) => Promise<void>;
  loadTestPresets: (userId: string) => Promise<void>;
  clearTestPresets: () => void;
  saveTestPreset: (userId: string, name: string, config: TestPresetConfig) => Promise<void>;
  deleteTestPreset: (userId: string, presetId: string) => Promise<void>;
  deleteAttempt: (userId: string, sessionId: string) => Promise<void>;
  clearTestHistory: (userId: string) => Promise<void>;
  createTestFromDeck: (deckId: string, deckName: string, userId: string, config: {
    questionCount: number;
    timeLimit: number;
    passingScore: number;
  }) => Promise<Test>;
}

// Mock test questions with all 7 types
const mockQuestions: Record<string, TestQuestion[]> = {
  'test-1': [
    {
      id: 'q1',
      type: 'multiple_choice_single',
      question: 'What is the powerhouse of the cell?',
      options: ['Nucleus', 'Mitochondria', 'Ribosome', 'Golgi apparatus'],
      correctAnswer: 'Mitochondria',
      explanation: 'Mitochondria are known as the powerhouse of the cell because they produce ATP through cellular respiration.',
      points: 10,
      tags: ['Biology', 'Cell Biology'],
    },
    {
      id: 'q2',
      type: 'true_false',
      question: 'DNA stands for Deoxyribonucleic acid.',
      options: ['True', 'False'],
      correctAnswer: 'True',
      explanation: 'DNA is the abbreviation for Deoxyribonucleic acid.',
      points: 10,
      tags: ['Biology', 'Genetics'],
    },
    {
      id: 'q3',
      type: 'multiple_choice_multiple',
      question: 'Which of the following are organelles found in plant cells? (Select all that apply)',
      options: ['Chloroplast', 'Cell wall', 'Centriole', 'Vacuole', 'Mitochondria'],
      correctAnswers: ['Chloroplast', 'Cell wall', 'Vacuole', 'Mitochondria'],
      explanation: 'Plant cells have chloroplasts for photosynthesis, cell walls for structure, large vacuoles, and mitochondria. Centrioles are typically found in animal cells.',
      points: 15,
      tags: ['Biology', 'Cell Biology'],
    },
    {
      id: 'q4',
      type: 'fill_in_blank',
      question: 'The process by which plants convert light energy into chemical energy is called ___.',
      correctAnswer: 'photosynthesis',
      blanks: [{ id: 'b1', correctAnswer: 'photosynthesis' }],
      explanation: 'Photosynthesis is the process by which plants convert light energy into glucose.',
      points: 10,
      tags: ['Biology', 'Plants'],
    },
    {
      id: 'q5',
      type: 'matching',
      question: 'Match each organelle with its function:',
      matchingPairs: [
        { id: 'm1', left: 'Nucleus', right: 'Contains genetic material' },
        { id: 'm2', left: 'Ribosome', right: 'Protein synthesis' },
        { id: 'm3', left: 'Mitochondria', right: 'Energy production' },
        { id: 'm4', left: 'Golgi apparatus', right: 'Packaging proteins' },
      ],
      explanation: 'Each organelle has a specific function in the cell.',
      points: 20,
      tags: ['Biology', 'Cell Biology'],
    },
  ],
  'test-2': [
    {
      id: 'q6',
      type: 'multiple_choice_single',
      question: 'What is the chemical symbol for water?',
      options: ['H2O', 'CO2', 'NaCl', 'O2'],
      correctAnswer: 'H2O',
      explanation: 'Water consists of two hydrogen atoms and one oxygen atom.',
      points: 10,
      tags: ['Chemistry', 'Compounds'],
    },
    {
      id: 'q7',
      type: 'fill_in_blank',
      question: 'The pH of a neutral solution is ___.',
      correctAnswer: '7',
      blanks: [{ id: 'b1', correctAnswer: '7' }],
      explanation: 'A neutral solution has a pH of 7, acids are below 7, and bases are above 7.',
      points: 10,
      tags: ['Chemistry', 'pH'],
    },
    {
      id: 'q8',
      type: 'true_false',
      question: 'An acid has a pH greater than 7.',
      options: ['True', 'False'],
      correctAnswer: 'False',
      explanation: 'Acids have a pH less than 7, while bases have a pH greater than 7.',
      points: 10,
      tags: ['Chemistry', 'pH'],
    },
    {
      id: 'q9',
      type: 'open_ended',
      question: 'Explain the difference between ionic and covalent bonds. Provide an example of each.',
      sampleAnswer: 'Ionic bonds involve the transfer of electrons between atoms, creating ions that are attracted to each other (e.g., NaCl). Covalent bonds involve the sharing of electrons between atoms (e.g., H2O).',
      keywords: ['transfer', 'sharing', 'electrons', 'ions'],
      explanation: 'Understanding bond types is fundamental to chemistry.',
      points: 20,
      tags: ['Chemistry', 'Bonds'],
    },
    {
      id: 'q10',
      type: 'diagram_labeling',
      question: 'Label the parts of an atom:',
      diagramUrl: 'https://example.com/atom-diagram.png',
      diagramLabels: [
        { id: 'l1', label: 'Nucleus', x: 50, y: 50 },
        { id: 'l2', label: 'Electron', x: 80, y: 30 },
        { id: 'l3', label: 'Proton', x: 45, y: 45 },
        { id: 'l4', label: 'Neutron', x: 55, y: 55 },
      ],
      explanation: 'An atom consists of a nucleus containing protons and neutrons, with electrons orbiting around it.',
      points: 15,
      tags: ['Chemistry', 'Atomic Structure'],
    },
  ],
};

const mockTests: Test[] = [
  {
    id: 'test-1',
    name: 'Biology Basics Quiz',
    description: 'Test your knowledge of cell biology',
    deckId: 'deck-1',
    deckName: 'Biology 101',
    questionCount: 5,
    timeLimit: 10,
    passingScore: 70,
    createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'test-2',
    name: 'Chemistry Fundamentals',
    description: 'Basic chemistry concepts',
    deckId: 'deck-3',
    deckName: 'Chemistry Champions',
    questionCount: 3,
    timeLimit: 5,
    passingScore: 60,
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

const mockAttempts: TestAttempt[] = [
  {
    id: 'attempt-1',
    testId: 'test-1',
    testName: 'Biology Basics Quiz',
    startedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    completedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000 + 8 * 60 * 1000).toISOString(),
    score: 40,
    totalPoints: 50,
    percentage: 80,
    passed: true,
    answers: [
      { questionId: 'q1', userAnswer: 'Mitochondria', isCorrect: true, points: 10, questionSnapshot: mockQuestions['test-1'][0] },
      { questionId: 'q2', userAnswer: 'True', isCorrect: true, points: 10, questionSnapshot: mockQuestions['test-1'][1] },
      { questionId: 'q3', userAnswer: ['Chloroplast', 'Cell wall', 'Vacuole', 'Mitochondria'], isCorrect: true, points: 10, questionSnapshot: mockQuestions['test-1'][2] },
      { questionId: 'q4', userAnswer: 'Respiration', isCorrect: false, points: 0, questionSnapshot: mockQuestions['test-1'][3] },
      { questionId: 'q5', userAnswer: { Nucleus: 'Contains genetic material', Ribosome: 'Protein synthesis', Mitochondria: 'Energy production', 'Golgi apparatus': 'Packaging proteins' }, isCorrect: true, points: 10, questionSnapshot: mockQuestions['test-1'][4] },
    ],
    timeSpent: 480,
  },
  {
    id: 'attempt-2',
    testId: 'test-2',
    testName: 'Chemistry Fundamentals',
    startedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    completedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000 + 4 * 60 * 1000).toISOString(),
    score: 30,
    totalPoints: 30,
    percentage: 100,
    passed: true,
    answers: [
      { questionId: 'q6', userAnswer: 'H2O', isCorrect: true, points: 10, questionSnapshot: mockQuestions['test-2'][0] },
      { questionId: 'q7', userAnswer: '7', isCorrect: true, points: 10, questionSnapshot: mockQuestions['test-2'][1] },
      { questionId: 'q8', userAnswer: 'False', isCorrect: true, points: 10, questionSnapshot: mockQuestions['test-2'][2] },
    ],
    timeSpent: 240,
  },
];

const getCorrectAnswerForQuestion = (question: TestQuestion): string | string[] | Record<string, string> | undefined => {
  switch (question.type) {
    case 'multiple_choice_single':
    case 'true_false':
    case 'fill_in_blank':
      return resolveCorrectAnswerLabel(question) || question.correctAnswer;
    case 'multiple_choice_multiple':
      return question.correctAnswers?.map(answer =>
        resolveCorrectAnswerLabel({ ...question, type: 'multiple_choice_single', correctAnswer: answer })
      );
    case 'matching':
      return question.matchingPairs?.reduce<Record<string, string>>((result, pair) => {
        result[pair.left] = pair.right;
        return result;
      }, {});
    case 'diagram_labeling':
      return formatCorrectAnswerDisplay(question);
    case 'open_ended':
      return question.sampleAnswer || question.keywords || undefined;
    default:
      return undefined;
  }
};

export const useTestStore = create<TestState>((set, get) => ({
  tests: [],
  attempts: [],
  activeTest: null,
  pausedSessions: [],
  testQuestionsById: {},
  userQuestionStats: {},
  testPresets: [],
  isLoading: false,
  error: null,

  // Load cached data from AsyncStorage
  loadFromStorage: async () => {
    try {
      const [testsJson, attemptsJson, questionsJson] = await Promise.all([
        AsyncStorage.getItem(TESTS_STORAGE_KEY),
        AsyncStorage.getItem(ATTEMPTS_STORAGE_KEY),
        AsyncStorage.getItem(TEST_QUESTIONS_STORAGE_KEY),
      ]);
      
      if (testsJson) {
        set({ tests: JSON.parse(testsJson) });
      }
      if (attemptsJson) {
        set({ attempts: JSON.parse(attemptsJson) });
      }
      if (questionsJson) {
        set({ testQuestionsById: JSON.parse(questionsJson) });
      }
    } catch (error) {
      console.error('Failed to load tests from storage:', error);
    }
  },

  // Save current state to AsyncStorage
  saveToStorage: async () => {
    try {
      const { tests, attempts, testQuestionsById } = get();
      await Promise.all([
        AsyncStorage.setItem(TESTS_STORAGE_KEY, JSON.stringify(tests)),
        AsyncStorage.setItem(ATTEMPTS_STORAGE_KEY, JSON.stringify(attempts)),
        AsyncStorage.setItem(TEST_QUESTIONS_STORAGE_KEY, JSON.stringify(testQuestionsById)),
      ]);
    } catch (error) {
      console.error('Failed to save tests to storage:', error);
    }
  },

  fetchTests: async (userId: string) => {
    set({ isLoading: true, error: null });
    
    // Load from local storage first
    await get().loadFromStorage();
    
    if (DEMO_MODE) {
      await new Promise(resolve => setTimeout(resolve, 300));
      set({ tests: mockTests, isLoading: false });
      return;
    }
    
    try {
      const apiTests = await api.fetchTests(userId);
      const testQuestionsById: Record<string, TestQuestion[]> = { ...get().testQuestionsById };
      const tests: Test[] = apiTests
        .filter((t: any) => {
          const questions = t.questions || [];
          const isCompleted = !!(t.end_time || t.endTime);
          const questionCount = questions.length || t.config?.numberOfQuestions || 0;
          return !isCompleted && questionCount > 0;
        })
        .map((t: any) => {
        const questions = normalizeApiQuestions(t.questions || []);
        if (questions.length > 0) {
          testQuestionsById[t.id] = questions;
        }
        return {
          id: t.id,
          name: t.config?.name || t.config?.testName || 'Untitled Test',
          description: t.config?.description,
          deckId: t.config?.deckId,
          deckName: t.config?.deckName || t.config?.groupName,
          questionCount: questions.length || t.config?.numberOfQuestions || 0,
          // `timerDuration` is SECONDS: reading it straight into `timeLimit`
          // (minutes) turned a 5-minute test into a 300-minute one on the
          // tests list and in any start that did not go through the config
          // sheet. One rule decides the units now.
          timeLimit: resolveAttemptTimeLimitMinutes(t.config),
          passingScore: t.config?.passingScore || 70,
          createdAt: t.created_at,
        };
      });
      set({ tests, testQuestionsById, isLoading: false });
      await get().saveToStorage();
    } catch (error: any) {
      console.warn('Failed to fetch tests from API, using cached:', error);
      set({ isLoading: false });
    }
  },

  /**
   * The results list is fetched lean, so an attempt loaded from history has no
   * per-question detail: Correct/Incorrect read 0, Question Review is empty and
   * the analysis chart has no bars. Pull the full session on demand and rebuild
   * `answers` from it.
   */
  hydrateAttemptDetail: async (attemptId: string) => {
    const existing = get().attempts.find(a => a.id === attemptId);
    if (!existing || existing.answers.length > 0) return;

    try {
      const { normalizeTestResultSession } = await import('@lantern/shared/utils/testHelpers');
      const session: any = await api.fetchTestSessionDetail(attemptId);
      const { questions: normalizedQuestions, userAnswers } =
        normalizeTestResultSession(session);
      const questions = normalizeApiQuestions(normalizedQuestions.length
        ? normalizedQuestions
        : session?.questions || []);

      const orderedQuestions =
        questions.length > 0
          ? [...questions].sort(
              (a: any, b: any) =>
                ((a as any).questionNumber ?? 0) - ((b as any).questionNumber ?? 0)
            )
          : Object.keys(userAnswers).map((id) => ({ id }));

      const answers = orderedQuestions.map((question: any) => {
        const qId = question.id;
        const ans = userAnswers[qId] ?? userAnswers[String(qId)];
        const userAnswer =
          ans?.selectedOptionIds?.length === 1
            ? ans.selectedOptionIds[0]
            : ans?.selectedOptionIds?.length
              ? ans.selectedOptionIds
              : ans?.fillText ??
                ans?.matchingAnswers ??
                ans?.diagramAnswers ??
                (ans as any)?.answer ??
                (ans as any)?.userAnswer ??
                '';
        const resolvedQuestion =
          questions.find((q: any) => q.id === qId) || question;
        const isCorrect = ans?.isCorrect ?? (ans as any)?.is_correct ?? false;
        return {
          questionId: qId,
          userAnswer,
          isCorrect,
          points: isCorrect ? (resolvedQuestion?.points || 10) : 0,
          questionText:
            resolvedQuestion?.question ||
            (normalizedQuestions.find((q) => q.id === qId) as any)?.questionStem,
          questionType: resolvedQuestion?.type,
          correctAnswer: resolvedQuestion
            ? getCorrectAnswerForQuestion(resolvedQuestion)
            : undefined,
          options: resolvedQuestion?.options,
          explanation: resolvedQuestion?.explanation,
          tags: resolvedQuestion?.tags,
          timeSpentSeconds: ans?.timeSpentSeconds ?? (ans as any)?.time_spent_seconds ?? 0,
          questionSnapshot: resolvedQuestion,
        };
      }).filter((row: any) => row.questionId);

      if (!answers.length) return;

      const timeSpent = answers.reduce(
        (sum, a: any) => sum + (a.timeSpentSeconds || 0),
        0
      );

      set(state => ({
        attempts: state.attempts.map(a =>
          a.id === attemptId
            ? ({ ...a, answers, timeSpent: a.timeSpent || timeSpent } as typeof a)
            : a
        ),
      }));
      await get().saveToStorage();
    } catch (error) {
      console.warn('[TestStore] Failed to hydrate attempt detail:', error);
    }
  },

  fetchAttempts: async (userId: string) => {
    set({ isLoading: true, error: null });
    
    if (DEMO_MODE) {
      await new Promise(resolve => setTimeout(resolve, 300));
      set({ attempts: mockAttempts, isLoading: false });
      return;
    }
    
    try {
      const apiResults = await fetchTestResultsCached(userId, api.fetchTestResults, { limit: 500 });
      const attempts: TestAttempt[] = apiResults.map((r: any) => {
        const session = r.session || r;
        const config = session.config || {};
        const questions = normalizeApiQuestions(session.questions || []);
        const userAnswers = session.userAnswers || session.user_answers || {};
        const startTime = session.startTime || session.start_time;
        const endTime = session.endTime || session.end_time;
        const sessionId = session.id || r.id;
        const totalQuestions = r.totalQuestions ?? r.total_questions ?? questions.length;
        const correctAnswersCount = r.correctAnswersCount ?? r.correct_answers_count ?? 0;
        const percentage = Math.round(r.score ?? 0);
        // `undefined` = the attempt never recorded a timer (legacy rows), so a
        // retake may fall back on the test's own limit; 0 = the reader chose
        // "None", which a retake must keep untimed.
        const timeLimitMinutes = hasStoredTimerChoice(config)
          ? resolveAttemptTimeLimitMinutes(config)
          : undefined;
        const originalTestId =
          typeof config.testId === 'string' && config.testId && !String(config.testId).startsWith('custom-')
            ? config.testId
            : undefined;

        const answers = Object.entries(userAnswers).map(([qId, ans]: [string, any]) => {
          const question = questions.find((q) => q.id === qId);
          const userAnswer =
            ans?.userAnswer ??
            ans?.selectedOptionIds ??
            ans?.matchingAnswers ??
            ans?.diagramAnswers ??
            ans?.fillText ??
            ans?.essayText ??
            '';
          return {
            questionId: qId,
            userAnswer,
            isCorrect: ans?.isCorrect || false,
            points: ans?.isCorrect ? (question?.points || 10) : 0,
            questionText: question?.question,
            questionType: question?.type,
            correctAnswer: question ? getCorrectAnswerForQuestion(question) : undefined,
            options: question?.options,
            explanation: question?.explanation,
            tags: question?.tags,
            timeSpentSeconds: ans?.timeSpentSeconds ?? ans?.time_spent_seconds ?? 0,
            questionSnapshot: question,
          };
        });

        const timeSpent = Object.values(userAnswers).reduce((sum: number, ans: any) => {
          return sum + (ans?.timeSpentSeconds ?? ans?.time_spent_seconds ?? 0);
        }, 0);

        return {
          id: sessionId,
          testId: originalTestId || sessionId,
          originalTestId,
          testName: config.name || config.testName || config.groupName || config.deckName || 'Test',
          groupId: config.groupId,
          groupName: config.groupName,
          courseId: session.course_id ?? session.courseId ?? config.courseId ?? null,
          topicId: session.topic_id ?? session.topicId ?? config.topicId ?? null,
          startedAt: startTime ? new Date(startTime).toISOString() : new Date().toISOString(),
          completedAt: endTime ? new Date(endTime).toISOString() : undefined,
          score: correctAnswersCount,
          totalPoints: totalQuestions,
          percentage,
          passed: percentage >= (config.passingScore || 70),
          timeLimitMinutes,
          answers,
          timeSpent,
        };
      });
      const localPending = get().attempts.filter(
        a => a.id.startsWith('attempt-') && !attempts.some(server => server.startedAt === a.startedAt && server.testName === a.testName)
      );
      // The results list is fetched lean, and lean rows omit userAnswers, so
      // `answers` maps to []. Overwriting a locally-built attempt with that
      // wiped its per-question detail: Correct/Incorrect showed 0 and Question
      // Review rendered empty for a test the user had just finished. Keep the
      // richer local copy whenever the server row carries no answers.
      const previous = get().attempts;
      const withLocalDetail = attempts.map(serverAttempt => {
        if (serverAttempt.answers.length > 0) return serverAttempt;
        const local = previous.find(p => p.id === serverAttempt.id);
        if (!local?.answers?.length) return serverAttempt;
        return {
          ...serverAttempt,
          answers: local.answers,
          timeSpent: serverAttempt.timeSpent || local.timeSpent,
        };
      });

      const mergedAttempts = [...withLocalDetail, ...localPending].sort(
        (a, b) =>
          new Date(b.completedAt || b.startedAt).getTime() -
          new Date(a.completedAt || a.startedAt).getTime()
      );
      set({ attempts: mergedAttempts, isLoading: false });
      await get().saveToStorage();
    } catch (error: any) {
      console.warn('Failed to fetch attempts from API, using cached:', error);
      set({ isLoading: false });
    }
  },

  startTest: async (testId: string, mode: TestMode = 'test', config?: StartTestConfig) => {
    const test = get().tests.find(t => t.id === testId);
    if (!test) throw new Error('Test not found');

    let questions = get().testQuestionsById[testId] || mockQuestions[testId] || [];

    if (!questions.length && !DEMO_MODE && config?.userId) {
      try {
        const apiTests = await api.fetchTests(config.userId);
        const session = (apiTests as any[]).find(t => t.id === testId);
        if (session?.questions?.length) {
          questions = normalizeApiQuestions(session.questions);
          set(state => ({
            testQuestionsById: { ...state.testQuestionsById, [testId]: questions },
          }));
        }
      } catch (error) {
        console.warn('Failed to load test questions from API:', error);
      }
    }

    if (!questions.length && test.deckId && !DEMO_MODE) {
      try {
        const flashcards = unwrapFlashcards(await api.fetchFlashcards(test.deckId));
        questions = flashcardsToQuestions(flashcards, test.questionCount || flashcards.length);
        set(state => ({
          testQuestionsById: { ...state.testQuestionsById, [testId]: questions },
        }));
      } catch (error) {
        console.warn('Failed to load deck flashcards for test:', error);
      }
    }

    const hasAdvancedFilters =
      !!config?.questionTypes?.length ||
      !!config?.tags?.length ||
      config?.spacedRepetition ||
      config?.focusOnNew;

    if (hasAdvancedFilters || config?.questionCount) {
      const userQuestionStats = buildQuestionStatsFromAttempts(get().attempts);
      questions = filterTestQuestions(
        questions,
        {
          numberOfQuestions: config?.questionCount || questions.length,
          selectedQuestionTypes: config?.questionTypes,
          selectedTags: config?.tags,
          useSpacedRepetition: config?.spacedRepetition,
          focusOnNew: config?.focusOnNew,
        },
        userQuestionStats
      );
    } else if (config?.questionCount && config.questionCount < questions.length) {
      questions = questions.slice(0, config.questionCount);
    }

    const studySettings = useSettingsStore.getState().settings.study;
    if (studySettings.shuffleQuestions) {
      questions = shuffleArray(questions);
    }
    if (studySettings.shuffleOptions) {
      questions = questions.map(q => {
        if (!q.options?.length) return q;
        return { ...q, options: shuffleArray(q.options) };
      });
    }

    const effectiveTest = {
      ...test,
      timeLimit: config?.timeLimit ?? test.timeLimit,
      questionCount: questions.length,
    };

    const startedAtMs = Date.now();
    const started: ActiveTest = {
      test: effectiveTest,
      questions,
      currentQuestionIndex: 0,
      answers: {},
      answerTimings: {},
      startTime: startedAtMs,
      // A fresh run: nothing banked, and this run began when the session did.
      runStartedAt: startedAtMs,
      bankedSeconds: 0,
      timeRemaining: mode === 'test' && effectiveTest.timeLimit > 0 ? effectiveTest.timeLimit * 60 : 0,
      mode,
      revealedAnswers: new Set(),
      flaggedQuestions: new Set(),
      lockAnswered: mode === 'test' ? (config?.lockAnswered ?? studySettings.lockAnsweredQuestions) : false,
      lockedQuestionIds: new Set(),
      groupId: config?.groupId,
      groupName: config?.groupName,
      courseId: config?.courseId ?? null,
      topicId: config?.courseId ? config?.topicId ?? null : null,
    };
    set({ activeTest: started });
    const drafted = await ensureMobileDraft(started);
    const current = get().activeTest;
    if (current?.test.id === started.test.id) {
      set({
        activeTest: {
          ...current,
          draftId: drafted.draftId || current.draftId,
        },
      });
    }
    await get().saveToStorage();
  },

  startQuestionSet: async (
    testName: string,
    questions: TestQuestion[],
    mode: TestMode = 'study',
    options?: {
      timeLimitMinutes?: number;
      groupId?: string;
      groupName?: string;
      lockAnswered?: boolean;
      courseId?: string | null;
      topicId?: string | null;
    }
  ) => {
    // Do not invent a timer — use the caller's value, or untimed (0).
    const timeLimit =
      options?.timeLimitMinutes !== undefined
        ? Math.max(0, options.timeLimitMinutes)
        : 0;

    const generatedTest: Test = {
      id: `custom-${Date.now()}`,
      name: testName,
      description: `Custom ${mode === 'study' ? 'study' : 'test'} session`,
      questionCount: questions.length,
      timeLimit,
      passingScore: 70,
      createdAt: new Date().toISOString(),
    };

    const startedAtMs = Date.now();
    const started: ActiveTest = {
      test: generatedTest,
      questions,
      currentQuestionIndex: 0,
      answers: {},
      answerTimings: {},
      startTime: startedAtMs,
      // A fresh run: nothing banked, and this run began when the session did.
      runStartedAt: startedAtMs,
      bankedSeconds: 0,
      timeRemaining: mode === 'test' && timeLimit > 0 ? timeLimit * 60 : 0,
      mode,
      revealedAnswers: new Set(),
      flaggedQuestions: new Set(),
      lockAnswered:
        mode === 'test'
          ? (options?.lockAnswered ?? useSettingsStore.getState().settings.study.lockAnsweredQuestions)
          : false,
      lockedQuestionIds: new Set(),
      groupId: options?.groupId,
      groupName: options?.groupName,
      courseId: options?.courseId ?? null,
      topicId: options?.courseId ? options?.topicId ?? null : null,
    };
    set({ activeTest: started });
    void ensureMobileDraft(started).then((drafted) => {
      const current = get().activeTest;
      // Only bind draftId — never replace answers/index chosen during create latency.
      if (current?.test.id === drafted.test.id) {
        set({
          activeTest: {
            ...current,
            draftId: drafted.draftId || current.draftId,
          },
        });
      }
    });
  },

  setActiveTestAttribution: (attribution) => {
    const activeTest = get().activeTest;
    if (!activeTest) return;
    const groupId = attribution.groupId || activeTest.groupId;
    const groupName = attribution.groupName || activeTest.groupName;
    if (groupId === activeTest.groupId && groupName === activeTest.groupName) return;

    const next: ActiveTest = { ...activeTest, groupId, groupName };
    set({ activeTest: next });

    if (next.draftId && !next.draftId.startsWith('local-') && (groupId || groupName)) {
      void patchMobileTestDraft(next.draftId, {
        config: {
          ...(groupId ? { groupId } : {}),
          ...(groupName ? { groupName } : {}),
        },
      }).catch((err) => console.warn('Failed to patch draft group attribution', err));
    }
  },

  answerQuestion: (questionId: string, answer: string | string[] | Record<string, string>, timeSpentSeconds?: number) => {
    const activeTest = get().activeTest;
    if (!activeTest) return;

    const nextTimings = { ...(activeTest.answerTimings || {}) };
    if (timeSpentSeconds !== undefined) {
      nextTimings[questionId] = timeSpentSeconds;
    }

    const next: ActiveTest = {
      ...activeTest,
      answers: {
        ...activeTest.answers,
        [questionId]: answer,
      },
      answerTimings: nextTimings,
    };
    set({ activeTest: next });

    if (next.draftId && !next.draftId.startsWith('local-')) {
      const payload = buildDraftPayloadFromActive(next);
      void patchMobileTestDraft(next.draftId, {
        user_answers: payload.user_answers,
        current_question_index: next.currentQuestionIndex,
        remaining_time_seconds: payload.remaining_time_seconds,
        status: 'in_progress',
      }).catch((err) => console.warn('Draft autosave failed', err));
    }
  },

  // For study mode - reveal the correct answer for a question
  revealAnswer: (questionId: string) => {
    const activeTest = get().activeTest;
    if (!activeTest || activeTest.mode !== 'study') return;
    
    const wasAlreadyRevealed = activeTest.revealedAnswers.has(questionId);
    const newRevealedAnswers = new Set(activeTest.revealedAnswers);
    newRevealedAnswers.add(questionId);
    
    set({
      activeTest: {
        ...activeTest,
        revealedAnswers: newRevealedAnswers,
      },
    });

    if (!wasAlreadyRevealed) {
      trackStudyActivity('study_question', 1);
    }
  },

  // For study mode - check if the current answer is correct
  checkCurrentAnswer: () => {
    const activeTest = get().activeTest;
    if (!activeTest) return null;
    
    const currentQuestion = activeTest.questions[activeTest.currentQuestionIndex];
    const userAnswer = activeTest.answers[currentQuestion.id];
    
    // Helper to check answer correctness
    const isCorrect = (() => {
      if (!userAnswer) return false;
      
      switch (currentQuestion.type) {
        case 'multiple_choice_single':
        case 'true_false':
        case 'fill_in_blank':
          const answerStr = typeof userAnswer === 'string' ? userAnswer : '';
          const correctStr = resolveCorrectAnswerLabel(currentQuestion) || currentQuestion.correctAnswer || '';
          return answerStr.toLowerCase().trim() === correctStr.toLowerCase().trim();
          
        case 'multiple_choice_multiple':
          if (!Array.isArray(userAnswer) || !currentQuestion.correctAnswers) return false;
          const sortedUser = [...userAnswer].sort();
          const sortedCorrect = [...currentQuestion.correctAnswers].sort();
          return JSON.stringify(sortedUser) === JSON.stringify(sortedCorrect);
          
        case 'matching':
          if (typeof userAnswer !== 'object' || !currentQuestion.matchingPairs) return false;
          const matchAnswers = userAnswer as Record<string, string>;
          return currentQuestion.matchingPairs.every(pair => matchAnswers[pair.left] === pair.right);
          
        case 'diagram_labeling':
          if (typeof userAnswer !== 'object' || !currentQuestion.diagramLabels) return false;
          const labelAnswers = userAnswer as Record<string, string>;
          return currentQuestion.diagramLabels.every(label =>
            labelAnswers[label.id] === label.id
          );
          
        case 'open_ended':
          if (typeof userAnswer !== 'string' || !currentQuestion.keywords) return false;
          const lowerAnswer = userAnswer.toLowerCase();
          const matchedKeywords = currentQuestion.keywords.filter(k => lowerAnswer.includes(k.toLowerCase()));
          return matchedKeywords.length >= Math.ceil(currentQuestion.keywords.length / 2);
          
        default:
          return false;
      }
    })();
    
    return {
      isCorrect,
      explanation: currentQuestion.explanation,
    };
  },

  // Exit study/test mode without submitting (abandon session)
  exitStudyMode: () => {
    const active = get().activeTest;
    if (active?.draftId && !active.draftId.startsWith('local-')) {
      void abandonMobileTestDraft(active.draftId).catch(() => undefined);
      set((state) => ({
        pausedSessions: state.pausedSessions.filter((s) => s.id !== active.draftId),
      }));
    }
    set({ activeTest: null });
  },

  pauseActiveTest: async () => {
    const active = get().activeTest;
    if (!active) return;
    const drafted = await ensureMobileDraft(active);
    const payload = buildDraftPayloadFromActive(drafted);
    if (drafted.draftId && !drafted.draftId.startsWith('local-')) {
      try {
        await patchMobileTestDraft(drafted.draftId, {
          user_answers: payload.user_answers,
          current_question_index: drafted.currentQuestionIndex,
          remaining_time_seconds: payload.remaining_time_seconds,
          status: 'paused',
        });
      } catch (error) {
        console.warn('Failed to pause draft', error);
      }
    }
    const summary: PausedSessionSummary = {
      id: drafted.draftId || `local-${Date.now()}`,
      sessionKind: drafted.mode === 'study' ? 'study' : 'test',
      status: 'paused',
      title: drafted.test.name,
      answeredCount: Object.keys(drafted.answers).length,
      totalQuestions: drafted.questions.length,
      currentQuestionIndex: drafted.currentQuestionIndex,
      remainingTimeSeconds: drafted.mode === 'test' ? drafted.timeRemaining : null,
      startTime: new Date(drafted.startTime).toISOString(),
      updatedAt: new Date().toISOString(),
      pausedAt: new Date().toISOString(),
    };
    set((state) => ({
      activeTest: null,
      pausedSessions: [summary, ...state.pausedSessions.filter((s) => s.id !== summary.id)],
    }));
  },

  refreshPausedSessions: async () => {
    try {
      const list = await fetchMobilePausedSessions();
      set({ pausedSessions: list });
    } catch (error) {
      console.warn('Failed to refresh paused sessions', error);
    }
  },

  resumePausedSession: async (sessionId: string) => {
    const draft = await fetchMobileTestDraft(sessionId);
    const rawQuestions: any[] = Array.isArray(draft.questions) ? draft.questions : [];
    const questions = normalizeApiQuestions(rawQuestions);
    const rawQuestionById = new Map<string, any>(
      rawQuestions.map((q: any) => [String(q?.id ?? ''), q]),
    );
    const answersRaw =
      (draft.userAnswers as Record<string, any>) ||
      (draft.user_answers as Record<string, any>) ||
      {};
    const answers: ActiveTest['answers'] = {};
    for (const [qid, record] of Object.entries(answersRaw)) {
      if (record && typeof record === 'object') {
        if (Array.isArray(record.selectedOptionIds)) {
          answers[qid] =
            record.selectedOptionIds.length === 1
              ? record.selectedOptionIds[0]
              : record.selectedOptionIds;
        } else if (typeof record.fillText === 'string') {
          answers[qid] = record.fillText;
        } else if (record.matchingAnswers) {
          // Ids in the draft, prompt/answer TEXT on the board (and in
          // grading). Handing the ids back left every pair unmatched.
          answers[qid] = restoreMatchingAnswerMap(
            rawQuestionById.get(qid),
            record.matchingAnswers,
          );
        } else if (Array.isArray(record.diagramAnswers)) {
          // Same round-trip as matching: pairs in the draft, map in the store.
          // Without this, a paused diagram-labeling answer vanished on resume
          // (and under exam lock the question came back unlocked).
          const map: Record<string, string> = {};
          for (const pair of record.diagramAnswers) {
            if (pair && pair.labelId != null) map[String(pair.labelId)] = String(pair.selectedLabelId);
          }
          answers[qid] = map;
        }
      }
    }
    const remaining =
      typeof draft.remainingTime === 'number'
        ? draft.remainingTime
        : typeof draft.remaining_time_seconds === 'number'
          ? draft.remaining_time_seconds
          : 0;
    const mode = (draft.sessionKind || draft.session_kind) === 'study' ? 'study' : 'test';
    const draftConfig =
      (draft.config as
        | {
            groupId?: string;
            groupName?: string;
            lockAnsweredQuestions?: boolean;
            timerDuration?: number;
            timerDurationMinutes?: number;
            timerDurationSeconds?: number;
          }
        | undefined) || {};
    const title =
      (draft.title as string) ||
      draftConfig.groupName ||
      (mode === 'study' ? 'Study session' : 'Test');
    const currentQuestionIndex =
      (draft.currentQuestionIndex as number) ??
      (draft.current_question_index as number) ??
      0;
    const lockAnswered = mode === 'test' && draftConfig.lockAnsweredQuestions === true;
    // Reconstruct the locked set rather than persisting it: under lock mode a
    // question is locked iff it's answered and not current — you can't have
    // answered a non-current question without leaving it, and goToQuestion
    // locks every answered question on leave. Answers + index are already in
    // the draft, so this survives pause/resume exactly.
    const currentQuestionId = questions[currentQuestionIndex]?.id;
    const lockedQuestionIds = new Set<string>(
      lockAnswered
        ? Object.keys(answers).filter(
            (qid) => qid !== currentQuestionId && isMobileAnswerAnswered(answers[qid]),
          )
        : [],
    );
    // Per-question timings were dropped on resume, which lost the
    // time-per-question chart AND left the duration model with nothing to
    // bank. They are already in the draft's answer records; read them back.
    const restoredTimings = timingsFromDraftAnswers(answersRaw);
    const resumedTimeLimitMinutes = resolveResumeTimeLimitMinutes({
      mode,
      remainingSeconds: remaining,
      config: draftConfig,
    });
    const resumed: ActiveTest = {
      test: {
        id: String(draft.id),
        name: title,
        description: 'Resumed session',
        questionCount: questions.length,
        // An untimed session stays untimed across a resume: the draft's own
        // config is the authority, and no arithmetic on the remaining
        // seconds may put a clock back on a test that never had one.
        timeLimit: resumedTimeLimitMinutes,
        passingScore: 70,
        createdAt: String(draft.startTime || draft.start_time || new Date().toISOString()),
      },
      questions,
      currentQuestionIndex,
      answers,
      answerTimings: restoredTimings,
      // `startTime` stays the session's ORIGINAL start — the draft and the
      // attempt both mean "when this began". How long the reader has actually
      // worked is banked + this run, never `now - startTime`.
      startTime: Date.parse(String(draft.startTime || draft.start_time || Date.now())) || Date.now(),
      runStartedAt: Date.now(),
      bankedSeconds: bankedSecondsFromTimings(restoredTimings),
      // Never a clock without a limit: an untimed resume banks 0 here too, so
      // the header, the countdown and the auto-submit all agree.
      timeRemaining: resumedTimeLimitMinutes > 0 ? remaining : 0,
      mode,
      revealedAnswers: new Set(),
      flaggedQuestions: new Set(),
      lockAnswered,
      lockedQuestionIds,
      draftId: String(draft.id),
      groupId: draftConfig.groupId || (draft.groupId as string | undefined),
      groupName: draftConfig.groupName,
    };
    set((state) => ({
      activeTest: resumed,
      pausedSessions: state.pausedSessions.filter((s) => s.id !== sessionId),
    }));
    if (resumed.draftId) {
      void patchMobileTestDraft(resumed.draftId, { status: 'in_progress' }).catch(() => undefined);
    }
  },

  abandonPausedSession: async (sessionId: string) => {
    if (!sessionId.startsWith('local-')) {
      await abandonMobileTestDraft(sessionId);
    }
    set((state) => ({
      pausedSessions: state.pausedSessions.filter((s) => s.id !== sessionId),
      activeTest: state.activeTest?.draftId === sessionId ? null : state.activeTest,
    }));
  },

  updateTimeRemaining: (seconds: number) => {
    const activeTest = get().activeTest;
    if (!activeTest) return;
    set({
      activeTest: {
        ...activeTest,
        timeRemaining: Math.max(0, seconds),
      },
    });
  },

  toggleFlag: (questionId: string) => {
    const activeTest = get().activeTest;
    if (!activeTest) return;

    const flaggedQuestions = new Set(activeTest.flaggedQuestions);
    if (flaggedQuestions.has(questionId)) {
      flaggedQuestions.delete(questionId);
    } else {
      flaggedQuestions.add(questionId);
    }

    set({
      activeTest: {
        ...activeTest,
        flaggedQuestions,
      },
    });
  },

  goToQuestion: (index: number) => {
    const activeTest = get().activeTest;
    if (!activeTest) return;
    if (index < 0 || index >= activeTest.questions.length) return;

    // Exam lock: refuse navigation to a locked question, and lock the question we
    // leave once it's answered. Centralized here so next/previous/palette all obey it.
    if (activeTest.lockAnswered) {
      const targetId = activeTest.questions[index]?.id;
      if (targetId && activeTest.lockedQuestionIds?.has(targetId)) return;

      const leavingId = activeTest.questions[activeTest.currentQuestionIndex]?.id;
      let lockedQuestionIds = activeTest.lockedQuestionIds ?? new Set<string>();
      if (
        leavingId &&
        !lockedQuestionIds.has(leavingId) &&
        isMobileAnswerAnswered(activeTest.answers[leavingId])
      ) {
        lockedQuestionIds = new Set(lockedQuestionIds);
        lockedQuestionIds.add(leavingId);
      }
      set({
        activeTest: { ...activeTest, currentQuestionIndex: index, lockedQuestionIds },
      });
      return;
    }

    set({
      activeTest: {
        ...activeTest,
        currentQuestionIndex: index,
      },
    });
  },

  nextQuestion: () => {
    const activeTest = get().activeTest;
    if (!activeTest) return;
    if (activeTest.currentQuestionIndex < activeTest.questions.length - 1) {
      get().goToQuestion(activeTest.currentQuestionIndex + 1);
    }
  },

  previousQuestion: () => {
    const activeTest = get().activeTest;
    if (!activeTest) return;
    if (activeTest.lockAnswered) {
      // Skip locked questions to reach the nearest earlier open (skipped) one.
      const target = nearestPreviousUnlockedIndex(
        activeTest.questions.map((q) => q.id),
        activeTest.lockedQuestionIds,
        activeTest.currentQuestionIndex
      );
      if (target >= 0) get().goToQuestion(target);
      return;
    }
    if (activeTest.currentQuestionIndex > 0) {
      get().goToQuestion(activeTest.currentQuestionIndex - 1);
    }
  },

  submitTest: async (userId: string, options?: { isOffline?: boolean; groupName?: string; groupId?: string }) => {
    const activeTest = get().activeTest;
    if (!activeTest) throw new Error('No active test');
    const testMode = activeTest.mode;
    
    // Active time, not wall-clock since the session was created: a paused
    // draft resumed the next morning used to report hundreds of minutes.
    const timeSpent = activeElapsedSeconds({
      bankedSeconds: activeTest.bankedSeconds,
      runStartedAtMs: activeTest.runStartedAt,
      nowMs: Date.now(),
    });
    
    // Helper function to check if answer is correct based on question type
    const checkAnswer = (q: TestQuestion, userAnswer: string | string[] | Record<string, string> | undefined): boolean => {
      if (!userAnswer) return false;
      
      switch (q.type) {
        case 'multiple_choice_single':
        case 'true_false':
        case 'fill_in_blank':
          // Case-insensitive comparison for text answers
          const answerStr = typeof userAnswer === 'string' ? userAnswer : '';
          const correctStr = resolveCorrectAnswerLabel(q) || q.correctAnswer || '';
          return answerStr.toLowerCase().trim() === correctStr.toLowerCase().trim();
          
        case 'multiple_choice_multiple':
          // Check if all correct answers are selected and no incorrect ones
          if (!Array.isArray(userAnswer) || !q.correctAnswers) return false;
          const sortedUser = [...userAnswer].sort();
          const sortedCorrect = [...q.correctAnswers].sort();
          return JSON.stringify(sortedUser) === JSON.stringify(sortedCorrect);
          
        case 'matching':
          // Check if all pairs are correctly matched
          if (typeof userAnswer !== 'object' || !q.matchingPairs) return false;
          const matchAnswers = userAnswer as Record<string, string>;
          return q.matchingPairs.every(pair => matchAnswers[pair.left] === pair.right);
          
        case 'diagram_labeling':
          if (typeof userAnswer !== 'object' || !q.diagramLabels) return false;
          const labelAnswers = userAnswer as Record<string, string>;
          return q.diagramLabels.every(label =>
            labelAnswers[label.id] === label.id
          );
          
        case 'open_ended':
          // For open-ended, check if keywords are present (partial credit possible)
          if (typeof userAnswer !== 'string' || !q.keywords) return false;
          const lowerAnswer = userAnswer.toLowerCase();
          const matchedKeywords = q.keywords.filter(k => lowerAnswer.includes(k.toLowerCase()));
          // Consider correct if at least 50% of keywords are present
          return matchedKeywords.length >= Math.ceil(q.keywords.length / 2);
          
        default:
          return false;
      }
    };
    
    // Calculate score. Unattempted questions must not persist as
    // `{ isCorrect: false }` alone — that made analysis treat skips as
    // incorrect and disagreed with web's isUserAnswerAttempted checks.
    const answers = activeTest.questions.map(q => {
      const userAnswer = activeTest.answers[q.id];
      const attempted =
        userAnswer !== undefined &&
        userAnswer !== null &&
        !(typeof userAnswer === 'string' && userAnswer.trim() === '') &&
        !(Array.isArray(userAnswer) && userAnswer.length === 0);
      const isCorrect = attempted ? checkAnswer(q, userAnswer) : false;
      return {
        questionId: q.id,
        userAnswer: userAnswer || '',
        isCorrect,
        points: isCorrect ? q.points : 0,
        questionText: q.question,
        questionType: q.type,
        correctAnswer: getCorrectAnswerForQuestion(q),
        options: q.options,
        explanation: q.explanation,
        tags: q.tags,
        timeSpentSeconds: activeTest.answerTimings?.[q.id] ?? 0,
        questionSnapshot: q,
      };
    });
    
    const score = answers.reduce((sum, a) => sum + a.points, 0);
    const totalPoints = activeTest.questions.reduce((sum, q) => sum + q.points, 0);
    const percentage = Math.round((score / totalPoints) * 100);
    
    const attempt: TestAttempt = {
      id: `attempt-${Date.now()}`,
      testId: activeTest.test.id,
      originalTestId: activeTest.test.id.startsWith('custom-') ? undefined : activeTest.test.id,
      testName: activeTest.test.name,
      startedAt: new Date(activeTest.startTime).toISOString(),
      completedAt: new Date().toISOString(),
      score,
      totalPoints,
      percentage,
      passed: percentage >= activeTest.test.passingScore,
      timeLimitMinutes: activeTest.test.timeLimit || 0,
      answers,
      timeSpent,
    };
    
    // Add to attempts
    set(state => ({
      attempts: [attempt, ...state.attempts],
      activeTest: null,
    }));
    // Drop the 90s lean-results cache so later list fetches are not stale.
    clearTestResultsCache();
    await get().saveToStorage();

    const correctCount = answers.filter(a => a.isCorrect).length;

    if (!options?.isOffline && userId) {
      const updatedStats = { ...get().userQuestionStats };
      const now = new Date().toISOString();
      for (const answer of answers) {
        const current = updatedStats[answer.questionId] || {
          correctAttempts: 0,
          incorrectAttempts: 0,
          lastAttempted: null,
        };
        const next = {
          correctAttempts: current.correctAttempts + (answer.isCorrect ? 1 : 0),
          incorrectAttempts: current.incorrectAttempts + (answer.isCorrect ? 0 : 1),
          lastAttempted: now,
        };
        updatedStats[answer.questionId] = next;
        if (!DEMO_MODE) {
          void api.upsertUserQuestionStat(userId, answer.questionId, {
            correctAttempts: next.correctAttempts,
            incorrectAttempts: next.incorrectAttempts,
            lastAttempted: now,
          }).catch(err => console.warn('Failed to upsert question stat:', err));
        }
      }
      set({ userQuestionStats: updatedStats });
    }

    const sessionPayload = buildSessionPayload(
      activeTest,
      attempt,
      answers,
      percentage,
      correctCount,
      options
    );

    if (options?.isOffline) {
      // The owning account rides with the result: pending results are stored
      // per user, so an unattributed one would be invisible to its owner and
      // could be adopted by whoever signs in next on this handset.
      await useOfflineStore.getState().savePendingResult(
        {
          testId: activeTest.test.id,
          groupName: options.groupName || activeTest.test.name,
          score: correctCount,
          totalQuestions: activeTest.questions.length,
          percentage,
          completedAt: attempt.completedAt || new Date().toISOString(),
          timeSpent,
          sessionPayload,
        },
        userId || undefined
      );
    } else if (!DEMO_MODE && userId) {
      try {
        let sessionId = activeTest.draftId;
        if (sessionId && !sessionId.startsWith('local-')) {
          await completeMobileTestDraft(sessionId, {
            user_answers: sessionPayload.userAnswers,
            score: percentage,
            correct_answers_count: correctCount,
            total_questions: activeTest.questions.length,
            // Draft create often raced ahead of route params; stamp the real
            // study-group id here so Group Performance can plot the point.
            config: {
              groupId: options?.groupId || activeTest.groupId,
              groupName: options?.groupName || activeTest.groupName || activeTest.test.name,
            },
          });
        } else {
          const savedSession = await api.saveTestResult(userId, sessionPayload);
          sessionId = savedSession.id;
          await api.submitTestResult(sessionId, {
            score: percentage,
            correctAnswersCount: correctCount,
            totalQuestions: activeTest.questions.length,
          });
        }

        set(state => ({
          attempts: state.attempts.map(a =>
            a.id === attempt.id
              ? { ...a, id: sessionId!, testId: sessionId!, groupId: options?.groupId || a.groupId, groupName: options?.groupName || a.groupName }
              : a
          ),
          pausedSessions: state.pausedSessions.filter((s) => s.id !== sessionId),
        }));
        attempt.id = sessionId!;
        attempt.testId = sessionId!;
        await get().saveToStorage();

        // Group Performance chart reads statsStore.leanTestResults (via
        // /dashboard/summary). Refresh after the score row is persisted.
        try {
          const { useStatsStore } = await import('./statsStore');
          const period = useStatsStore.getState().selectedPeriod;
          void useStatsStore.getState().fetchStats(userId, period, { force: true });
        } catch (err) {
          console.warn('Failed to refresh dashboard stats after test submit:', err);
        }
      } catch (error) {
        console.warn('Failed to save test result to API:', error);
        await syncService.queueOperation(
          'test_result',
          attempt.id,
          'create',
          sessionPayload,
          userId
        );
      }
    }

    if (testMode !== 'study') {
      trackStudyActivity('test', 1, { scorePercent: Math.round(percentage) });
    }

    trackTestCompleted({
      score: percentage,
      totalQuestions: activeTest.questions.length,
      offline: options?.isOffline ?? false,
    });

    return attempt;
  },

  loadUserQuestionStats: async (userId: string) => {
    if (!userId || DEMO_MODE) return;
    try {
      const raw = await api.fetchUserQuestionStats(userId);
      set({ userQuestionStats: normalizeUserQuestionStats(raw) });
    } catch (error) {
      console.warn('Failed to load user question stats:', error);
    }
  },

  loadTestPresets: async (userId: string) => {
    if (!userId) {
      set({ testPresets: [] });
      return;
    }
    if (DEMO_MODE) return;
    try {
      const profile = await api.fetchUserProfile(userId);
      const presets = Array.isArray((profile as any)?.testPresets)
        ? ((profile as any).testPresets as TestPreset[])
        : Array.isArray((profile as any)?.test_presets)
          ? ((profile as any).test_presets as TestPreset[])
          : [];
      set({ testPresets: presets });
    } catch (error) {
      console.warn('Failed to load test presets:', error);
    }
  },

  clearTestPresets: () => {
    set({ testPresets: [] });
  },

  saveTestPreset: async (userId: string, name: string, config: TestPresetConfig) => {
    if (!userId) return;
    const previous = get().testPresets;
    const newPreset: TestPreset = {
      id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: name.trim(),
      config,
    };
    const updated = [...previous, newPreset].slice(-5);
    set({ testPresets: updated });
    if (DEMO_MODE) return;
    try {
      await api.updateUserProfile(userId, { test_presets: updated } as any);
    } catch (error) {
      console.warn('Failed to save test preset:', error);
      set({ testPresets: previous });
      throw error;
    }
  },

  deleteTestPreset: async (userId: string, presetId: string) => {
    if (!userId) return;
    const previous = get().testPresets;
    const updated = previous.filter(p => p.id !== presetId);
    set({ testPresets: updated });
    if (DEMO_MODE) return;
    try {
      await api.updateUserProfile(userId, { test_presets: updated } as any);
    } catch (error) {
      console.warn('Failed to delete test preset:', error);
      set({ testPresets: previous });
      throw error;
    }
  },

  deleteAttempt: async (userId: string, sessionId: string) => {
    const isLocalOnly = sessionId.startsWith('attempt-');

    if (!isLocalOnly && !DEMO_MODE && userId) {
      try {
        await api.deleteTestSession(sessionId);
      } catch (error) {
        console.warn('Failed to delete test session from API:', error);
        throw error;
      }
    }

    set(state => ({
      attempts: state.attempts.filter(attempt => attempt.id !== sessionId),
    }));
    clearTestResultsCache();
    await get().saveToStorage();
  },

  clearTestHistory: async (userId: string) => {
    if (!DEMO_MODE && userId) {
      try {
        await api.clearTestHistory();
      } catch (error) {
        console.warn('Failed to clear test history from API:', error);
        throw error;
      }
    }

    clearTestResultsCache();
    set({ attempts: [] });
    await get().saveToStorage();
  },

  createTestFromDeck: async (deckId: string, deckName: string, userId: string, config: { questionCount: number; timeLimit: number; passingScore: number }) => {
    const newTest: Test = {
      id: `test-${Date.now()}`,
      name: `${deckName} Quiz`,
      description: `Auto-generated quiz from ${deckName}`,
      deckId,
      deckName,
      questionCount: config.questionCount,
      timeLimit: config.timeLimit,
      passingScore: config.passingScore,
      createdAt: new Date().toISOString(),
    };
    
    // Optimistic update
    set(state => ({
      tests: [...state.tests, newTest],
    }));
    await get().saveToStorage();
    
    if (DEMO_MODE) {
      // Generate mock questions for the new test
      mockQuestions[newTest.id] = [
        {
          id: `${newTest.id}-q1`,
          type: 'multiple_choice_single',
          question: 'Sample question 1 from your deck',
          options: ['Option A', 'Option B', 'Option C', 'Option D'],
          correctAnswer: 'Option A',
          points: 10,
        },
        {
          id: `${newTest.id}-q2`,
          type: 'true_false',
          question: 'Sample question 2 from your deck',
          options: ['True', 'False'],
          correctAnswer: 'True',
          points: 10,
        },
      ];
      
      return newTest;
    }
    
    try {
      let questions: TestQuestion[] = [];
      try {
        const flashcards = unwrapFlashcards(await api.fetchFlashcards(deckId));
        questions = flashcardsToQuestions(flashcards, config.questionCount);
      } catch (error) {
        console.warn('Failed to fetch deck flashcards for test creation:', error);
      }

      const testSession = await api.createTestSession({
        userId,
        groupId: '',
        config: {
          name: `${deckName} Quiz`,
          description: `Auto-generated quiz from ${deckName}`,
          deckId,
          deckName,
          numberOfQuestions: config.questionCount,
          // Minutes in the minutes field, seconds in the seconds field —
          // this wrote minutes into `timerDuration` (seconds).
          timerDurationMinutes: Math.max(0, config.timeLimit || 0),
          timerDuration: Math.max(0, config.timeLimit || 0) * 60,
          passingScore: config.passingScore,
        },
        questions,
      });
      
      const sessionConfig = testSession.config as { name?: string; description?: string } | undefined;
      const createdTest: Test = {
        id: testSession.id,
        name: sessionConfig?.name || `${deckName} Quiz`,
        description: sessionConfig?.description,
        deckId,
        deckName,
        questionCount: questions.length || config.questionCount,
        timeLimit: config.timeLimit,
        passingScore: config.passingScore,
        createdAt: testSession.created_at || new Date().toISOString(),
      };
      
      set(state => ({
        tests: [...state.tests.filter(t => t.id !== newTest.id), createdTest],
        testQuestionsById: {
          ...state.testQuestionsById,
          [createdTest.id]: questions.length ? questions : state.testQuestionsById[createdTest.id] || [],
        },
      }));
      
      return createdTest;
    } catch (error: any) {
      console.error('Failed to create test from deck:', error);
      // Fall back to local-only test
      set(state => ({
        tests: [...state.tests, newTest],
      }));
      return newTest;
    }
  },
}));
