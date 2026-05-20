// ===========================================
// Lantern Study Mobile - Test Store
// ===========================================

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as api from '../services/api';
import { syncService } from '../services/syncService';

const DEMO_MODE = false;

// Storage keys
const TESTS_STORAGE_KEY = 'lantern_tests';
const ATTEMPTS_STORAGE_KEY = 'lantern_test_attempts';

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
  startTime: number;
  timeRemaining: number; // in seconds
  mode: TestMode; // 'test' = timed, no feedback | 'study' = untimed, immediate feedback
  // For study mode - track which questions have been answered and revealed
  revealedAnswers: Set<string>;
}

interface TestState {
  tests: Test[];
  attempts: TestAttempt[];
  activeTest: ActiveTest | null;
  isLoading: boolean;
  error: string | null;
  
  // Local storage helpers
  loadFromStorage: () => Promise<void>;
  saveToStorage: () => Promise<void>;
  
  // Actions
  fetchTests: (userId: string) => Promise<void>;
  fetchAttempts: (userId: string) => Promise<void>;
  startTest: (testId: string, mode?: TestMode) => Promise<void>;
  answerQuestion: (questionId: string, answer: string | string[] | Record<string, string>) => void;
  revealAnswer: (questionId: string) => void; // For study mode
  checkCurrentAnswer: () => { isCorrect: boolean; explanation?: string } | null; // For study mode
  nextQuestion: () => void;
  previousQuestion: () => void;
  submitTest: (userId: string) => Promise<TestAttempt>;
  exitStudyMode: () => void; // Exit without submitting
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
      { questionId: 'q1', userAnswer: 'Mitochondria', isCorrect: true, points: 10 },
      { questionId: 'q2', userAnswer: 'True', isCorrect: true, points: 10 },
      { questionId: 'q3', userAnswer: 'Ribosome', isCorrect: true, points: 10 },
      { questionId: 'q4', userAnswer: 'Respiration', isCorrect: false, points: 0 },
      { questionId: 'q5', userAnswer: 'True', isCorrect: true, points: 10 },
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
      { questionId: 'q6', userAnswer: 'H2O', isCorrect: true, points: 10 },
      { questionId: 'q7', userAnswer: 'Hydrogen bond', isCorrect: true, points: 10 },
      { questionId: 'q8', userAnswer: 'False', isCorrect: true, points: 10 },
    ],
    timeSpent: 240,
  },
];

export const useTestStore = create<TestState>((set, get) => ({
  tests: [],
  attempts: [],
  activeTest: null,
  isLoading: false,
  error: null,

  // Load cached data from AsyncStorage
  loadFromStorage: async () => {
    try {
      const [testsJson, attemptsJson] = await Promise.all([
        AsyncStorage.getItem(TESTS_STORAGE_KEY),
        AsyncStorage.getItem(ATTEMPTS_STORAGE_KEY),
      ]);
      
      if (testsJson) {
        set({ tests: JSON.parse(testsJson) });
      }
      if (attemptsJson) {
        set({ attempts: JSON.parse(attemptsJson) });
      }
    } catch (error) {
      console.error('Failed to load tests from storage:', error);
    }
  },

  // Save current state to AsyncStorage
  saveToStorage: async () => {
    try {
      const { tests, attempts } = get();
      await Promise.all([
        AsyncStorage.setItem(TESTS_STORAGE_KEY, JSON.stringify(tests)),
        AsyncStorage.setItem(ATTEMPTS_STORAGE_KEY, JSON.stringify(attempts)),
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
      // Map API response to store format
      const tests: Test[] = apiTests.map((t: any) => ({
        id: t.id,
        name: t.config?.name || 'Untitled Test',
        description: t.config?.description,
        deckId: t.config?.deckId,
        deckName: t.config?.deckName,
        questionCount: t.questions?.length || t.config?.numberOfQuestions || 0,
        timeLimit: t.config?.timerDuration || 0,
        passingScore: t.config?.passingScore || 70,
        createdAt: t.created_at,
      }));
      set({ tests, isLoading: false });
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
      const apiResults = await api.fetchTestResults(userId);
      // Map API response to store format
      const attempts: TestAttempt[] = apiResults.map((r: any) => ({
        id: r.id,
        testId: r.id,
        testName: r.config?.name || 'Test',
        startedAt: r.start_time,
        completedAt: r.end_time,
        score: r.score || 0,
        totalPoints: r.questions?.reduce((sum: number, q: any) => sum + (q.points || 10), 0) || 0,
        percentage: r.score || 0,
        passed: (r.score || 0) >= (r.config?.passingScore || 70),
        answers: Object.entries(r.user_answers || {}).map(([qId, ans]: [string, any]) => ({
          questionId: qId,
          userAnswer: ans?.selectedOptionIds?.[0] || ans?.fillText || '',
          isCorrect: ans?.isCorrect || false,
          points: ans?.isCorrect ? 10 : 0,
        })),
        timeSpent: r.time_spent || 0,
      }));
      set({ attempts, isLoading: false });
      await get().saveToStorage();
    } catch (error: any) {
      console.warn('Failed to fetch attempts from API, using cached:', error);
      set({ isLoading: false });
    }
  },

  startTest: async (testId: string, mode: TestMode = 'test') => {
    const test = get().tests.find(t => t.id === testId);
    if (!test) throw new Error('Test not found');
    
    const questions = mockQuestions[testId] || [];
    
    set({
      activeTest: {
        test,
        questions,
        currentQuestionIndex: 0,
        answers: {},
        startTime: Date.now(),
        timeRemaining: mode === 'test' ? test.timeLimit * 60 : 0, // No time limit in study mode
        mode,
        revealedAnswers: new Set(),
      },
    });
  },

  answerQuestion: (questionId: string, answer: string | string[] | Record<string, string>) => {
    const activeTest = get().activeTest;
    if (!activeTest) return;
    
    set({
      activeTest: {
        ...activeTest,
        answers: {
          ...activeTest.answers,
          [questionId]: answer,
        },
      },
    });
  },

  // For study mode - reveal the correct answer for a question
  revealAnswer: (questionId: string) => {
    const activeTest = get().activeTest;
    if (!activeTest || activeTest.mode !== 'study') return;
    
    const newRevealedAnswers = new Set(activeTest.revealedAnswers);
    newRevealedAnswers.add(questionId);
    
    set({
      activeTest: {
        ...activeTest,
        revealedAnswers: newRevealedAnswers,
      },
    });
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
          const correctStr = currentQuestion.correctAnswer || '';
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
            labelAnswers[label.id]?.toLowerCase().trim() === label.label.toLowerCase().trim()
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

  submitTest: async () => {
    const activeTest = get().activeTest;
    if (!activeTest) throw new Error('No active test');
    
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
          const correctStr = q.correctAnswer || '';
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
          // Check if all labels are correctly placed
          if (typeof userAnswer !== 'object' || !q.diagramLabels) return false;
          const labelAnswers = userAnswer as Record<string, string>;
          return q.diagramLabels.every(label => 
            labelAnswers[label.id]?.toLowerCase().trim() === label.label.toLowerCase().trim()
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
    
    return attempt;
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
        questions: [],
      });
      
      const createdTest: Test = {
        id: testSession.id,
        name: testSession.config?.name || `${deckName} Quiz`,
        description: testSession.config?.description,
        deckId,
        deckName,
        questionCount: config.questionCount,
        timeLimit: config.timeLimit,
        passingScore: config.passingScore,
        createdAt: testSession.created_at || new Date().toISOString(),
      };
      
      set(state => ({
        tests: [...state.tests, createdTest],
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
