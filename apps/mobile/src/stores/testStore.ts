// ===========================================
// Lantern Study Mobile - Test Store
// ===========================================

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as api from '../services/api';
import { trackStudyActivity } from '../services/gamification';
import { syncService } from '../services/syncService';
import { fetchTestResultsCached, clearTestResultsCache } from '../services/dashboardCache';
import { normalizeApiQuestions, flashcardsToQuestions, filterTestQuestions, formatCorrectAnswerDisplay, resolveCorrectAnswerLabel } from '../utils/questionHelpers';
import { normalizeUserQuestionStats } from '../utils/buildDashboardStats';
import { useOfflineStore } from './offlineStore';
import {
  normalizeTestQuestionForSession,
  toUserAnswerRecord,
  shuffleArray,
} from '@lantern/shared/utils';
import { useSettingsStore } from './settingsStore';

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
    userAnswers[answer.questionId] = toUserAnswerRecord(
      question as unknown as Record<string, unknown>,
      activeTest.answers[answer.questionId],
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
      passingScore: activeTest.test.passingScore,
      mode: activeTest.mode,
    },
  };
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
  testName: string;
  groupId?: string;
  groupName?: string;
  startedAt: string;
  completedAt?: string;
  score: number;
  totalPoints: number;
  percentage: number;
  passed: boolean;
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
  startTime: number;
  timeRemaining: number; // in seconds
  mode: TestMode; // 'test' = timed, no feedback | 'study' = untimed, immediate feedback
  // For study mode - track which questions have been answered and revealed
  revealedAnswers: Set<string>;
  flaggedQuestions: Set<string>;
}

export interface StartTestConfig {
  timeLimit?: number;
  questionCount?: number;
  userId?: string;
  questionTypes?: QuestionType[];
  tags?: string[];
  spacedRepetition?: boolean;
  focusOnNew?: boolean;
}

export interface UserQuestionStatEntry {
  correctAttempts: number;
  incorrectAttempts: number;
  lastAttempted?: string | null;
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
  startTest: (testId: string, mode?: TestMode, config?: StartTestConfig) => Promise<void>;
  startQuestionSet: (testName: string, questions: TestQuestion[], mode?: TestMode, options?: { timeLimitMinutes?: number }) => Promise<void>;
  answerQuestion: (questionId: string, answer: string | string[] | Record<string, string>, timeSpentSeconds?: number) => void;
  revealAnswer: (questionId: string) => void; // For study mode
  checkCurrentAnswer: () => { isCorrect: boolean; explanation?: string } | null; // For study mode
  toggleFlag: (questionId: string) => void;
  goToQuestion: (index: number) => void;
  nextQuestion: () => void;
  previousQuestion: () => void;
  submitTest: (userId: string, options?: { isOffline?: boolean; groupName?: string; groupId?: string }) => Promise<TestAttempt>;
  exitStudyMode: () => void; // Exit without submitting
  loadUserQuestionStats: (userId: string) => Promise<void>;
  loadTestPresets: (userId: string) => Promise<void>;
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
          timeLimit: t.config?.timerDuration || 0,
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

  fetchAttempts: async (userId: string) => {
    set({ isLoading: true, error: null });
    
    if (DEMO_MODE) {
      await new Promise(resolve => setTimeout(resolve, 300));
      set({ attempts: mockAttempts, isLoading: false });
      return;
    }
    
    try {
      const apiResults = await fetchTestResultsCached(userId, api.fetchTestResults, { limit: 50 });
      const attempts: TestAttempt[] = apiResults.map((r: any) => {
        const session = r.session || r;
        const config = session.config || {};
        const questions = session.questions || [];
        const userAnswers = session.userAnswers || session.user_answers || {};
        const startTime = session.startTime || session.start_time;
        const endTime = session.endTime || session.end_time;
        const sessionId = session.id || r.id;
        const totalQuestions = r.totalQuestions ?? r.total_questions ?? questions.length;
        const correctAnswersCount = r.correctAnswersCount ?? r.correct_answers_count ?? 0;
        const percentage = Math.round(r.score ?? 0);

        const answers = Object.entries(userAnswers).map(([qId, ans]: [string, any]) => {
          const question = questions.find((q: any) => q.id === qId);
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
            questionText: question?.question || question?.questionStem,
            questionType: question?.type || question?.questionType,
            correctAnswer: question ? getCorrectAnswerForQuestion(question) : undefined,
            options: question?.options,
            explanation: question?.explanation,
            tags: question?.tags,
            questionSnapshot: question,
          };
        });

        const timeSpent = Object.values(userAnswers).reduce((sum: number, ans: any) => {
          return sum + (ans?.timeSpentSeconds ?? ans?.time_spent_seconds ?? 0);
        }, 0);

        return {
          id: sessionId,
          testId: sessionId,
          testName: config.name || config.groupName || 'Test',
          groupId: config.groupId,
          groupName: config.groupName,
          startedAt: startTime ? new Date(startTime).toISOString() : new Date().toISOString(),
          completedAt: endTime ? new Date(endTime).toISOString() : undefined,
          score: correctAnswersCount,
          totalPoints: totalQuestions,
          percentage,
          passed: percentage >= (config.passingScore || 70),
          answers,
          timeSpent,
        };
      });
      const localPending = get().attempts.filter(
        a => a.id.startsWith('attempt-') && !attempts.some(server => server.startedAt === a.startedAt && server.testName === a.testName)
      );
      const mergedAttempts = [...attempts, ...localPending].sort(
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

    set({
      activeTest: {
        test: effectiveTest,
        questions,
        currentQuestionIndex: 0,
        answers: {},
        answerTimings: {},
        startTime: Date.now(),
        timeRemaining: mode === 'test' && effectiveTest.timeLimit > 0 ? effectiveTest.timeLimit * 60 : 0,
        mode,
        revealedAnswers: new Set(),
        flaggedQuestions: new Set(),
      },
    });
    await get().saveToStorage();
  },

  startQuestionSet: async (
    testName: string,
    questions: TestQuestion[],
    mode: TestMode = 'study',
    options?: { timeLimitMinutes?: number }
  ) => {
    const timeLimit =
      options?.timeLimitMinutes ??
      (mode === 'test' ? Math.max(questions.length * 2, 5) : 0);

    const generatedTest: Test = {
      id: `custom-${Date.now()}`,
      name: testName,
      description: `Custom ${mode === 'study' ? 'study' : 'test'} session`,
      questionCount: questions.length,
      timeLimit,
      passingScore: 70,
      createdAt: new Date().toISOString(),
    };

    set({
      activeTest: {
        test: generatedTest,
        questions,
        currentQuestionIndex: 0,
        answers: {},
        answerTimings: {},
        startTime: Date.now(),
        timeRemaining: mode === 'test' && timeLimit > 0 ? timeLimit * 60 : 0,
        mode,
        revealedAnswers: new Set(),
        flaggedQuestions: new Set(),
      },
    });
  },

  answerQuestion: (questionId: string, answer: string | string[] | Record<string, string>, timeSpentSeconds?: number) => {
    const activeTest = get().activeTest;
    if (!activeTest) return;

    const nextTimings = { ...(activeTest.answerTimings || {}) };
    if (timeSpentSeconds !== undefined) {
      nextTimings[questionId] = timeSpentSeconds;
    }
    
    set({
      activeTest: {
        ...activeTest,
        answers: {
          ...activeTest.answers,
          [questionId]: answer,
        },
        answerTimings: nextTimings,
      },
    });
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

  // Exit study mode without submitting
  exitStudyMode: () => {
    set({ activeTest: null });
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
      set({
        activeTest: {
          ...activeTest,
          currentQuestionIndex: activeTest.currentQuestionIndex + 1,
        },
      });
    }
  },

  previousQuestion: () => {
    const activeTest = get().activeTest;
    if (!activeTest) return;
    
    if (activeTest.currentQuestionIndex > 0) {
      set({
        activeTest: {
          ...activeTest,
          currentQuestionIndex: activeTest.currentQuestionIndex - 1,
        },
      });
    }
  },

  submitTest: async (userId: string, options?: { isOffline?: boolean; groupName?: string; groupId?: string }) => {
    const activeTest = get().activeTest;
    if (!activeTest) throw new Error('No active test');
    const testMode = activeTest.mode;
    
    const timeSpent = Math.round((Date.now() - activeTest.startTime) / 1000);
    
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
    
    // Calculate score
    const answers = activeTest.questions.map(q => {
      const userAnswer = activeTest.answers[q.id];
      const isCorrect = checkAnswer(q, userAnswer);
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
        questionSnapshot: q,
      };
    });
    
    const score = answers.reduce((sum, a) => sum + a.points, 0);
    const totalPoints = activeTest.questions.reduce((sum, q) => sum + q.points, 0);
    const percentage = Math.round((score / totalPoints) * 100);
    
    const attempt: TestAttempt = {
      id: `attempt-${Date.now()}`,
      testId: activeTest.test.id,
      testName: activeTest.test.name,
      startedAt: new Date(activeTest.startTime).toISOString(),
      completedAt: new Date().toISOString(),
      score,
      totalPoints,
      percentage,
      passed: percentage >= activeTest.test.passingScore,
      answers,
      timeSpent,
    };
    
    // Add to attempts
    set(state => ({
      attempts: [attempt, ...state.attempts],
      activeTest: null,
    }));
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
      await useOfflineStore.getState().savePendingResult({
        testId: activeTest.test.id,
        groupName: options.groupName || activeTest.test.name,
        score: correctCount,
        totalQuestions: activeTest.questions.length,
        percentage,
        completedAt: attempt.completedAt || new Date().toISOString(),
        timeSpent,
        sessionPayload,
      });
    } else if (!DEMO_MODE && userId) {
      try {
        const savedSession = await api.saveTestResult(userId, sessionPayload);
        const sessionId = savedSession.id;
        await api.submitTestResult(sessionId, {
          score: percentage,
          correctAnswersCount: correctCount,
          totalQuestions: activeTest.questions.length,
        });

        set(state => ({
          attempts: state.attempts.map(a =>
            a.id === attempt.id
              ? { ...a, id: sessionId, testId: sessionId, groupName: options?.groupName || a.groupName, groupId: options?.groupId || a.groupId }
              : a
          ),
        }));
        attempt.id = sessionId;
        attempt.testId = sessionId;
        await get().saveToStorage();
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
      trackStudyActivity('test', 1);
    }
    
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
    if (!userId || DEMO_MODE) return;
    try {
      const profile = await api.fetchUserProfile(userId);
      const presets = ((profile as any).test_presets || (profile as any).testPresets || []) as TestPreset[];
      set({ testPresets: Array.isArray(presets) ? presets : [] });
    } catch (error) {
      console.warn('Failed to load test presets:', error);
    }
  },

  saveTestPreset: async (userId: string, name: string, config: TestPresetConfig) => {
    if (!userId) return;
    const newPreset: TestPreset = {
      id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: name.trim(),
      config,
    };
    const updated = [...get().testPresets, newPreset].slice(-5);
    set({ testPresets: updated });
    if (DEMO_MODE) return;
    try {
      await api.updateUserProfile(userId, { test_presets: updated } as any);
    } catch (error) {
      console.warn('Failed to save test preset:', error);
      throw error;
    }
  },

  deleteTestPreset: async (userId: string, presetId: string) => {
    if (!userId) return;
    const updated = get().testPresets.filter(p => p.id !== presetId);
    set({ testPresets: updated });
    if (DEMO_MODE) return;
    try {
      await api.updateUserProfile(userId, { test_presets: updated } as any);
    } catch (error) {
      console.warn('Failed to delete test preset:', error);
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

    set({ attempts: [] });
    clearTestResultsCache();
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
          timerDuration: config.timeLimit,
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
