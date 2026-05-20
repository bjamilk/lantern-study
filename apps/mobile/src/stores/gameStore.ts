// ===========================================
// Lantern Study Mobile - Game Store
// Manages 1v1 quiz battle game sessions
// ===========================================

import { create } from 'zustand';
// Note: supabase import removed - using mock data for now
// In production, uncomment and use: import { supabase } from '../services/supabase';

// Types
export interface GameUser {
  id: string;
  name: string;
  avatarUrl?: string;
}

export interface QuestionOption {
  id: string;
  text: string;
}

export interface MatchingItem {
  id: string;
  text: string;
}

export interface DiagramLabel {
  id: string;
  text: string;
  x: number;
  y: number;
}

export enum QuestionType {
  MULTIPLE_CHOICE_SINGLE = 'multiple_choice_single',
  MULTIPLE_CHOICE_MULTIPLE = 'multiple_choice_multiple',
  TRUE_FALSE = 'true_false',
  FILL_IN_THE_BLANK = 'fill_in_the_blank',
  MATCHING = 'matching',
  DIAGRAM_LABELING = 'diagram_labeling',
}

export interface GameQuestion {
  id: string;
  text: string;
  questionType: QuestionType;
  options?: QuestionOption[];
  correctOptionIds?: string[];
  correctFillText?: string;
  matchingPromptItems?: MatchingItem[];
  matchingAnswerItems?: MatchingItem[];
  diagramImageUrl?: string;
  diagramLabels?: DiagramLabel[];
}

export interface UserAnswerRecord {
  questionId: string;
  selectedOptionIds?: string[];
  fillText?: string;
  matchingAnswers?: { promptItemId: string; answerItemId: string }[];
  diagramAnswers?: { labelId: string; selectedLabelId: string }[];
  isCorrect: boolean;
  timeSpent: number; // seconds
}

export interface GameSession {
  id: string;
  user: GameUser;
  opponent: GameUser;
  questions: GameQuestion[];
  userAnswers: Record<string, UserAnswerRecord>;
  opponentAnswers: Record<string, UserAnswerRecord>;
  userScore: number;
  opponentScore: number;
  userTime: number;
  opponentTime: number;
  isComplete: boolean;
  winnerId?: string;
}

export interface GameConfig {
  questionCount: number;
  topics?: string[];
  difficulty?: 'easy' | 'medium' | 'hard' | 'mixed';
  timeLimit?: number; // seconds per question
  groupId?: string;
}

interface GameStore {
  // Current game session
  activeSession: GameSession | null;
  setActiveSession: (session: GameSession | null) => void;
  
  // Challenge state
  challengeOpponent: GameUser | null;
  setChallengeOpponent: (user: GameUser | null) => void;
  
  // Loading state
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  
  // Error state
  error: string | null;
  setError: (error: string | null) => void;
  
  // Game actions
  startGame: (config: GameConfig, currentUser: GameUser, opponent: GameUser) => Promise<GameSession>;
  updateAnswer: (questionId: string, answer: Partial<Omit<UserAnswerRecord, 'questionId'>>, timeSpent: number) => void;
  simulateOpponentAnswer: (questionId: string) => void;
  endGame: () => GameSession | null;
  resetGame: () => void;
  
  // Game history
  recentGames: GameSession[];
  addToHistory: (session: GameSession) => void;
  clearHistory: () => void;
}

// Helper to generate a random ID
const generateId = () => Math.random().toString(36).substring(2, 15);

// Helper to shuffle array
const shuffleArray = <T,>(array: T[]): T[] => {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
};

// Generate mock questions for demonstration
const generateMockQuestions = (count: number): GameQuestion[] => {
  const questions: GameQuestion[] = [];
  
  const questionTemplates = [
    {
      text: 'What is the capital of France?',
      questionType: QuestionType.MULTIPLE_CHOICE_SINGLE,
      options: [
        { id: 'a', text: 'London' },
        { id: 'b', text: 'Paris' },
        { id: 'c', text: 'Berlin' },
        { id: 'd', text: 'Madrid' },
      ],
      correctOptionIds: ['b'],
    },
    {
      text: 'Which of the following are programming languages?',
      questionType: QuestionType.MULTIPLE_CHOICE_MULTIPLE,
      options: [
        { id: 'a', text: 'Python' },
        { id: 'b', text: 'HTML' },
        { id: 'c', text: 'JavaScript' },
        { id: 'd', text: 'CSS' },
      ],
      correctOptionIds: ['a', 'c'],
    },
    {
      text: 'The Earth is flat.',
      questionType: QuestionType.TRUE_FALSE,
      options: [
        { id: 'true', text: 'True' },
        { id: 'false', text: 'False' },
      ],
      correctOptionIds: ['false'],
    },
    {
      text: 'The chemical symbol for water is ___.',
      questionType: QuestionType.FILL_IN_THE_BLANK,
      correctFillText: 'H2O',
    },
    {
      text: 'What is 2 + 2?',
      questionType: QuestionType.MULTIPLE_CHOICE_SINGLE,
      options: [
        { id: 'a', text: '3' },
        { id: 'b', text: '4' },
        { id: 'c', text: '5' },
        { id: 'd', text: '22' },
      ],
      correctOptionIds: ['b'],
    },
    {
      text: 'Which planet is known as the Red Planet?',
      questionType: QuestionType.MULTIPLE_CHOICE_SINGLE,
      options: [
        { id: 'a', text: 'Venus' },
        { id: 'b', text: 'Mars' },
        { id: 'c', text: 'Jupiter' },
        { id: 'd', text: 'Saturn' },
      ],
      correctOptionIds: ['b'],
    },
    {
      text: 'DNA stands for Deoxyribonucleic Acid.',
      questionType: QuestionType.TRUE_FALSE,
      options: [
        { id: 'true', text: 'True' },
        { id: 'false', text: 'False' },
      ],
      correctOptionIds: ['true'],
    },
    {
      text: 'The speed of light is approximately ___ meters per second.',
      questionType: QuestionType.FILL_IN_THE_BLANK,
      correctFillText: '300000000',
    },
  ];

  for (let i = 0; i < count; i++) {
    const template = questionTemplates[i % questionTemplates.length];
    questions.push({
      ...template,
      id: generateId(),
    });
  }

  return shuffleArray(questions);
};

// Helper to check if answer is correct
const checkAnswer = (question: GameQuestion, answer: Partial<Omit<UserAnswerRecord, 'questionId'>>): boolean => {
  switch (question.questionType) {
    case QuestionType.MULTIPLE_CHOICE_SINGLE:
    case QuestionType.MULTIPLE_CHOICE_MULTIPLE:
    case QuestionType.TRUE_FALSE:
      if (!answer.selectedOptionIds || !question.correctOptionIds) return false;
      const sortedSelected = [...answer.selectedOptionIds].sort();
      const sortedCorrect = [...question.correctOptionIds].sort();
      return JSON.stringify(sortedSelected) === JSON.stringify(sortedCorrect);
    
    case QuestionType.FILL_IN_THE_BLANK:
      if (!answer.fillText || !question.correctFillText) return false;
      return answer.fillText.toLowerCase().trim() === question.correctFillText.toLowerCase().trim();
    
    case QuestionType.MATCHING:
      if (!answer.matchingAnswers || !question.matchingPromptItems) return false;
      // For matching, each prompt should match its corresponding answer (same index)
      return answer.matchingAnswers.every(
        (ma) => ma.promptItemId === ma.answerItemId
      );
    
    case QuestionType.DIAGRAM_LABELING:
      if (!answer.diagramAnswers || !question.diagramLabels) return false;
      return answer.diagramAnswers.every(
        (da) => da.labelId === da.selectedLabelId
      );
    
    default:
      return false;
  }
};

export const useGameStore = create<GameStore>((set, get) => ({
  activeSession: null,
  setActiveSession: (session) => set({ activeSession: session }),
  
  challengeOpponent: null,
  setChallengeOpponent: (user) => set({ challengeOpponent: user }),
  
  isLoading: false,
  setIsLoading: (loading) => set({ isLoading: loading }),
  
  error: null,
  setError: (error) => set({ error }),
  
  startGame: async (config, currentUser, opponent) => {
    set({ isLoading: true, error: null });
    
    try {
      // In a real implementation, fetch questions from the database
      // For now, use mock questions
      const questions = generateMockQuestions(config.questionCount);
      
      const session: GameSession = {
        id: generateId(),
        user: currentUser,
        opponent,
        questions,
        userAnswers: {},
        opponentAnswers: {},
        userScore: 0,
        opponentScore: 0,
        userTime: 0,
        opponentTime: 0,
        isComplete: false,
      };
      
      set({ activeSession: session, isLoading: false });
      return session;
    } catch (error) {
      set({ error: 'Failed to start game', isLoading: false });
      throw error;
    }
  },
  
  updateAnswer: (questionId, answer, timeSpent) => {
    const { activeSession } = get();
    if (!activeSession) return;
    
    const question = activeSession.questions.find((q) => q.id === questionId);
    if (!question) return;
    
    const isCorrect = checkAnswer(question, answer);
    
    const answerRecord: UserAnswerRecord = {
      questionId,
      ...answer,
      isCorrect,
      timeSpent,
    };
    
    const newUserAnswers = {
      ...activeSession.userAnswers,
      [questionId]: answerRecord,
    };
    
    const newScore = Object.values(newUserAnswers).filter((a) => a.isCorrect).length;
    const newTime = Object.values(newUserAnswers).reduce((sum, a) => sum + a.timeSpent, 0);
    
    set({
      activeSession: {
        ...activeSession,
        userAnswers: newUserAnswers,
        userScore: newScore,
        userTime: newTime,
      },
    });
    
    // Simulate opponent answering after user answers
    get().simulateOpponentAnswer(questionId);
  },
  
  simulateOpponentAnswer: (questionId) => {
    const { activeSession } = get();
    if (!activeSession) return;
    
    const question = activeSession.questions.find((q) => q.id === questionId);
    if (!question) return;
    
    // Simulate opponent with 60-80% accuracy and 3-8 seconds per question
    const isOpponentCorrect = Math.random() > 0.3;
    const opponentTime = 3 + Math.floor(Math.random() * 5);
    
    // Generate a plausible answer
    let opponentAnswer: Partial<Omit<UserAnswerRecord, 'questionId'>> = {};
    
    if (question.options) {
      if (isOpponentCorrect && question.correctOptionIds) {
        opponentAnswer.selectedOptionIds = question.correctOptionIds;
      } else {
        // Pick random wrong answers
        const wrongOptions = question.options
          .filter((o) => !question.correctOptionIds?.includes(o.id))
          .map((o) => o.id);
        opponentAnswer.selectedOptionIds = wrongOptions.length > 0 
          ? [wrongOptions[Math.floor(Math.random() * wrongOptions.length)]]
          : [];
      }
    } else if (question.questionType === QuestionType.FILL_IN_THE_BLANK) {
      opponentAnswer.fillText = isOpponentCorrect ? question.correctFillText : 'wrong answer';
    }
    
    const opponentAnswerRecord: UserAnswerRecord = {
      questionId,
      ...opponentAnswer,
      isCorrect: isOpponentCorrect,
      timeSpent: opponentTime,
    };
    
    const newOpponentAnswers = {
      ...activeSession.opponentAnswers,
      [questionId]: opponentAnswerRecord,
    };
    
    const newOpponentScore = Object.values(newOpponentAnswers).filter((a) => a.isCorrect).length;
    const newOpponentTime = Object.values(newOpponentAnswers).reduce((sum, a) => sum + a.timeSpent, 0);
    
    set({
      activeSession: {
        ...activeSession,
        opponentAnswers: newOpponentAnswers,
        opponentScore: newOpponentScore,
        opponentTime: newOpponentTime,
      },
    });
  },
  
  endGame: () => {
    const { activeSession, addToHistory } = get();
    if (!activeSession) return null;
    
    let winnerId: string | undefined;
    
    if (activeSession.userScore > activeSession.opponentScore) {
      winnerId = activeSession.user.id;
    } else if (activeSession.opponentScore > activeSession.userScore) {
      winnerId = activeSession.opponent.id;
    } else {
      // Tie - winner determined by time
      if (activeSession.userTime < activeSession.opponentTime) {
        winnerId = activeSession.user.id;
      } else if (activeSession.opponentTime < activeSession.userTime) {
        winnerId = activeSession.opponent.id;
      }
      // If still tied, winnerId remains undefined (draw)
    }
    
    const completedSession: GameSession = {
      ...activeSession,
      isComplete: true,
      winnerId,
    };
    
    set({ activeSession: completedSession });
    addToHistory(completedSession);
    
    return completedSession;
  },
  
  resetGame: () => {
    set({
      activeSession: null,
      challengeOpponent: null,
      error: null,
    });
  },
  
  recentGames: [],
  
  addToHistory: (session) => {
    set((state) => ({
      recentGames: [session, ...state.recentGames].slice(0, 20), // Keep last 20 games
    }));
  },
  
  clearHistory: () => {
    set({ recentGames: [] });
  },
}));

export default useGameStore;
