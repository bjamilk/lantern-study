// ===========================================
// Lantern Study Mobile - Game Store
// Real member-vs-member challenges (no simulation)
// ===========================================

import { create } from 'zustand';
import type { GroupChallenge, TestQuestion, UserAnswerRecord } from '@lantern/shared/types';
import { computeDuelQuestionPoints, checkAnswerIsCorrect } from '@lantern/shared/utils';
import {
  createChallenge,
  fetchChallenge,
  submitChallenge,
  forfeitChallenge,
} from '../services/challenges';
import { trackStudyActivity } from '../services/gamification';
import { useGroupStore } from './groupStore';
import { selectGroupQuestions, webQuestionTypesToMobile } from '../utils/questionHelpers';
import { useAuthStore } from './authStore';

export interface GameUser {
  id: string;
  name: string;
  avatarUrl?: string;
}

export interface GameConfig {
  questionCount: number;
  groupId?: string;
  allowedQuestionTypes?: string[];
  selectedTags?: string[];
}

export interface GameSession {
  id: string;
  challengeId?: string;
  isSoloPractice?: boolean;
  awaitingOpponent?: boolean;
  user: GameUser;
  opponent: GameUser;
  questions: TestQuestion[];
  userAnswers: Record<string, UserAnswerRecord>;
  opponentAnswers: Record<string, UserAnswerRecord>;
  userScore: number;
  opponentScore: number;
  userTime: number;
  opponentTime: number;
  isComplete: boolean;
  winnerId?: string;
  userStreak?: number;
  userCorrectAnswers?: number;
  opponentCorrectAnswers?: number;
}

interface GameStore {
  activeSession: GameSession | null;
  setActiveSession: (session: GameSession | null) => void;
  challengeOpponent: GameUser | null;
  setChallengeOpponent: (user: GameUser | null) => void;
  isLoading: boolean;
  error: string | null;
  sendChallenge: (config: GameConfig, currentUser: GameUser, opponent: GameUser) => Promise<GroupChallenge>;
  startChallengePlay: (challengeId: string, currentUser: GameUser) => Promise<GameSession>;
  refreshChallengeSession: (challengeId: string, currentUser: GameUser) => Promise<GameSession | null>;
  startSoloPractice: (config: GameConfig, currentUser: GameUser) => Promise<GameSession>;
  updateAnswer: (questionId: string, answer: Partial<UserAnswerRecord>, timeSpent: number) => Promise<void>;
  resetGame: () => void;
  quitGame: () => Promise<void>;
  recentChallenges: GroupChallenge[];
  setRecentChallenges: (items: GroupChallenge[]) => void;
}

function mapChallengeToSession(challenge: GroupChallenge, currentUser: GameUser): GameSession {
  const isChallenger = challenge.challengerId === currentUser.id;
  const opponentProfile = isChallenger ? challenge.opponent : challenge.challenger;
  const opponent: GameUser = {
    id: opponentProfile?.id || (isChallenger ? challenge.opponentId : challenge.challengerId),
    name: opponentProfile?.name || 'Opponent',
    avatarUrl: opponentProfile?.avatarUrl,
  };

  const myPart = challenge.myParticipant;
  const oppPart = challenge.opponentParticipant;

  return {
    id: challenge.id,
    challengeId: challenge.id,
    user: currentUser,
    opponent,
    questions: challenge.questions || [],
    userAnswers: myPart?.answers || {},
    opponentAnswers: oppPart?.answers || {},
    userScore: myPart?.score || 0,
    opponentScore: oppPart?.score || 0,
    userTime: myPart?.totalTime || 0,
    opponentTime: oppPart?.totalTime || 0,
    isComplete: challenge.status === 'completed',
    winnerId: challenge.winnerId,
    userStreak: 0,
    userCorrectAnswers: myPart?.correctCount || 0,
    opponentCorrectAnswers: oppPart?.correctCount || 0,
    awaitingOpponent:
      challenge.status === 'accepted' &&
      !!myPart?.finishedAt &&
      !oppPart?.finishedAt,
  };
}

export const useGameStore = create<GameStore>((set, get) => ({
  activeSession: null,
  setActiveSession: (session) => set({ activeSession: session }),

  challengeOpponent: null,
  setChallengeOpponent: (user) => set({ challengeOpponent: user }),

  isLoading: false,
  error: null,

  recentChallenges: [],
  setRecentChallenges: (items) => set({ recentChallenges: items }),

  sendChallenge: async (config, currentUser, opponent) => {
    set({ isLoading: true, error: null });
    try {
      if (!config.groupId) throw new Error('Group is required');
      const challenge = await createChallenge({
        groupId: config.groupId,
        opponentId: opponent.id,
        config: {
          numberOfQuestions: config.questionCount,
          allowedQuestionTypes: config.allowedQuestionTypes,
          selectedTags: config.selectedTags,
        },
      });
      set({ isLoading: false });
      return challenge;
    } catch (e: any) {
      set({ error: e.message || 'Failed to send challenge', isLoading: false });
      throw e;
    }
  },

  startChallengePlay: async (challengeId, currentUser) => {
    set({ isLoading: true, error: null });
    try {
      const challenge = await fetchChallenge(challengeId);
      if (challenge.status !== 'accepted' && challenge.status !== 'completed') {
        throw new Error('Challenge is not ready to play');
      }

      const session = mapChallengeToSession(challenge, currentUser);

      if (challenge.status === 'completed') {
        const completed = { ...session, isComplete: true, awaitingOpponent: false };
        set({ activeSession: completed, isLoading: false });
        return completed;
      }

      if (challenge.myParticipant?.finishedAt) {
        const waiting = {
          ...session,
          awaitingOpponent: true,
          isComplete: false,
        };
        set({ activeSession: waiting, isLoading: false });
        return waiting;
      }

      if (!session.questions.length) {
        throw new Error('No questions loaded for this challenge');
      }
      set({ activeSession: session, isLoading: false });
      return session;
    } catch (e: any) {
      set({ error: e.message, isLoading: false });
      throw e;
    }
  },

  refreshChallengeSession: async (challengeId, currentUser) => {
    try {
      const challenge = await fetchChallenge(challengeId);
      if (challenge.status !== 'completed') return null;
      const session = mapChallengeToSession(challenge, currentUser);
      const completed = { ...session, isComplete: true, awaitingOpponent: false };
      set({ activeSession: completed });
      return completed;
    } catch {
      return null;
    }
  },

  startSoloPractice: async (config, currentUser) => {
    set({ isLoading: true, error: null });
    try {
      const groupMessages =
        useGroupStore.getState().messagesCache[config.groupId || ''] ||
        useGroupStore.getState().messages;

      const mobileTypes = config.allowedQuestionTypes?.length
        ? webQuestionTypesToMobile(config.allowedQuestionTypes)
        : undefined;

      const fromGroup = selectGroupQuestions(groupMessages as any, {
        numberOfQuestions: config.questionCount,
        selectedQuestionTypes: mobileTypes,
        selectedTags: config.selectedTags,
      });

      if (!fromGroup.length) {
        throw new Error('No testable questions found in this group');
      }

      const session: GameSession = {
        id: `solo-${Date.now()}`,
        isSoloPractice: true,
        user: currentUser,
        opponent: { id: 'solo', name: 'Solo Practice' },
        questions: fromGroup as TestQuestion[],
        userAnswers: {},
        opponentAnswers: {},
        userScore: 0,
        opponentScore: 0,
        userTime: 0,
        opponentTime: 0,
        isComplete: false,
        userStreak: 0,
        userCorrectAnswers: 0,
        opponentCorrectAnswers: 0,
      };

      set({ activeSession: session, isLoading: false });
      return session;
    } catch (e: any) {
      set({ error: e.message, isLoading: false });
      throw e;
    }
  },

  updateAnswer: async (questionId, answer, timeSpent) => {
    const { activeSession } = get();
    if (!activeSession) return;

    const question = activeSession.questions.find((q) => q.id === questionId);
    if (!question) return;

    const record: UserAnswerRecord = {
      questionId,
      ...answer,
      timeSpentSeconds: timeSpent,
    };
    record.isCorrect = checkAnswerIsCorrect(question, record);

    let streak = activeSession.userStreak || 0;
    let points = 0;
    if (record.isCorrect) {
      const r = computeDuelQuestionPoints(true, timeSpent, streak);
      points = r.points;
      streak = r.newStreak;
    } else {
      streak = 0;
    }

    const userAnswers = { ...activeSession.userAnswers, [questionId]: record };
    const updated: GameSession = {
      ...activeSession,
      userAnswers,
      userScore: activeSession.userScore + points,
      userTime: activeSession.userTime + timeSpent,
      userStreak: streak,
      userCorrectAnswers: (activeSession.userCorrectAnswers || 0) + (record.isCorrect ? 1 : 0),
    };

    set({ activeSession: updated });

    const total = updated.questions.length;
    if (Object.keys(userAnswers).length < total) return;

    if (updated.isSoloPractice) {
      trackStudyActivity('game', 1);
      set({
        activeSession: {
          ...updated,
          isComplete: true,
          winnerId: updated.user.id,
        },
      });
      return;
    }

    if (updated.challengeId) {
      try {
        const result = await submitChallenge(updated.challengeId, userAnswers);
        trackStudyActivity('game', 1);
        const completed = mapChallengeToSession(result, updated.user);
        set({
          activeSession: {
            ...completed,
            userAnswers,
            userScore: updated.userScore,
            userTime: updated.userTime,
            userCorrectAnswers: updated.userCorrectAnswers,
            awaitingOpponent: result.status === 'accepted' && !!result.myParticipant?.finishedAt && !result.opponentParticipant?.finishedAt,
            isComplete: result.status === 'completed',
          },
        });

        if (result.status === 'completed' && result.winnerId === updated.user.id) {
          const authUser = useAuthStore.getState().user;
          if (authUser) {
            // Profile stats updated server-side; refresh local user if needed
          }
        }
      } catch (e: any) {
        set({ error: e.message || 'Failed to submit answers' });
      }
    }
  },

  resetGame: () => {
    set({ activeSession: null, challengeOpponent: null, error: null });
  },

  quitGame: async () => {
    const session = get().activeSession;
    if (session?.challengeId && !session.isSoloPractice) {
      try {
        await forfeitChallenge(session.challengeId);
      } catch (e) {
        console.error('Failed to forfeit challenge:', e);
      }
    }
    set({ activeSession: null, challengeOpponent: null, error: null });
  },
}));

export default useGameStore;
