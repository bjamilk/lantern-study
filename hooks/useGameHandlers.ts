import { useCallback, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { AppMode, TestConfig, TestQuestion, UserAnswerRecord, GameSession, User, GroupChallenge } from '../types';
import { useAuthStore } from '../stores/authStore';
import { useGroupStore } from '../stores/groupStore';
import { useUIStore } from '../stores/uiStore';
import { useTestStore } from '../stores/testStore';
import {
  isQuestionTestable,
  checkAnswerIsCorrect,
  createShuffledQuestionSet,
  shuffleArray,
  computeDuelQuestionPoints,
} from '../utils/helpers';
import {
  createChallenge,
  fetchChallenge,
  submitChallenge,
} from '../services/challenges';
import { hasValidSession } from '../services/supabase';
import { trackStudyActivity } from '../services/studyActivity';

interface UseGameHandlersParams {
  addNotification: (message: string) => Promise<void>;
  handleChallengeUser: (opponent: User) => void;
}

function buildOpponentUser(challenge: GroupChallenge, currentUserId: string): User {
  const isChallenger = challenge.challengerId === currentUserId;
  const other = isChallenger ? challenge.opponent : challenge.challenger;
  return {
    id: other?.id || (isChallenger ? challenge.opponentId : challenge.challengerId),
    name: other?.name || 'Opponent',
    avatarUrl: other?.avatarUrl,
    points: 0,
    badges: [],
    stats: {},
  };
}

function challengeToGameSession(
  challenge: GroupChallenge,
  currentUser: User,
  questions: TestQuestion[],
  opts?: { isSoloPractice?: boolean }
): GameSession {
  const opponent = opts?.isSoloPractice
    ? { id: 'solo', name: 'Solo Practice', points: 0, badges: [], stats: {} }
    : buildOpponentUser(challenge, currentUser.id);

  const myPart = challenge.myParticipant;
  const oppPart = challenge.opponentParticipant;

  return {
    id: challenge.id,
    challengeId: opts?.isSoloPractice ? undefined : challenge.id,
    isSoloPractice: opts?.isSoloPractice,
    user: currentUser,
    opponent,
    questions,
    userAnswers: myPart?.answers || {},
    opponentAnswers: oppPart?.answers || {},
    userScore: myPart?.score || 0,
    opponentScore: oppPart?.score || 0,
    userTime: myPart?.totalTime || 0,
    opponentTime: oppPart?.totalTime || 0,
    isComplete: challenge.status === 'completed' || !!opts?.isSoloPractice,
    winnerId: challenge.winnerId,
    userStreak: 0,
    opponentStreak: 0,
    userStreakMax: myPart?.maxStreak || 0,
    opponentStreakMax: oppPart?.maxStreak || 0,
    userCorrectAnswers: myPart?.correctCount || 0,
    opponentCorrectAnswers: oppPart?.correctCount || 0,
    awaitingOpponent:
      !opts?.isSoloPractice &&
      challenge.status === 'accepted' &&
      !!myPart?.finishedAt &&
      !oppPart?.finishedAt,
  };
}

export function useGameHandlers({ addNotification, handleChallengeUser }: UseGameHandlersParams) {
  const { currentUser, setCurrentUser } = useAuthStore();
  const { messages } = useGroupStore();
  const { setAppMode, selectedChat, challengeOpponent, closeModal, openModal } = useUIStore();
  const { activeGameSession, setActiveGameSession } = useTestStore();

  const finalizeSoloGame = useCallback((finalSession: GameSession) => {
    trackStudyActivity('game', 1);
    setActiveGameSession({ ...finalSession, isComplete: true });
    setAppMode(AppMode.GAME_RESULTS);
  }, [setActiveGameSession, setAppMode]);

  const finalizeChallengeSubmit = useCallback(async (
    session: GameSession,
    answers: Record<string, UserAnswerRecord>
  ) => {
    if (!session.challengeId || !currentUser) return;

    try {
      const updated = await submitChallenge(session.challengeId, answers);
      const opponent = buildOpponentUser(updated, currentUser.id);
      const completedSession: GameSession = {
        ...session,
        opponent,
        userAnswers: answers,
        isComplete: updated.status === 'completed',
        winnerId: updated.winnerId,
        opponentScore: updated.opponentParticipant?.score || 0,
        opponentTime: updated.opponentParticipant?.totalTime || 0,
        opponentAnswers: updated.opponentParticipant?.answers || {},
        opponentCorrectAnswers: updated.opponentParticipant?.correctCount || 0,
        awaitingOpponent: updated.status === 'accepted' && !!updated.myParticipant?.finishedAt && !updated.opponentParticipant?.finishedAt,
      };
      setActiveGameSession(completedSession);
      trackStudyActivity('game', 1);

      if (updated.status === 'completed') {
        setAppMode(AppMode.GAME_RESULTS);
      } else {
        setAppMode(AppMode.GAME_RESULTS);
        addNotification('Your duel answers were submitted. Waiting for your opponent to finish.');
      }
    } catch (error) {
      console.error('Failed to submit challenge:', error);
      alert('Failed to submit your duel answers. Please try again.');
    }
  }, [currentUser, setActiveGameSession, setAppMode, addNotification, setCurrentUser]);

  const handleSendChallenge = useCallback(async (
    config: Omit<TestConfig, 'questionIds' | 'groupId'>,
  ) => {
    if (!currentUser || !challengeOpponent || !selectedChat || selectedChat.chatType !== 'group') return;

    try {
      await createChallenge({
        groupId: selectedChat.id,
        opponentId: challengeOpponent.id,
        config: {
          numberOfQuestions: config.numberOfQuestions,
          allowedQuestionTypes: config.allowedQuestionTypes,
          selectedTags: config.selectedTags,
        },
      });
      closeModal('testConfig');
      openModal('challenges');
      addNotification(`Challenge sent to ${challengeOpponent.name}! Waiting for them to accept.`);
    } catch (error: any) {
      alert(error.message || 'Failed to send challenge');
    }
  }, [currentUser, challengeOpponent, selectedChat, closeModal, openModal, addNotification]);

  const handleStartSoloPractice = useCallback((
    config: Omit<TestConfig, 'questionIds' | 'groupId'>,
  ) => {
    if (!currentUser || !selectedChat || selectedChat.chatType !== 'group') return;

    const candidateQuestions = (messages[selectedChat.id] || []).filter(msg =>
      isQuestionTestable(msg) &&
      (config.allowedQuestionTypes.length === 0 || config.allowedQuestionTypes.includes(msg.questionType!)) &&
      (!config.selectedTags || config.selectedTags.length === 0 || msg.tags?.some(tag => config.selectedTags!.includes(tag)))
    );

    if (candidateQuestions.length < config.numberOfQuestions) {
      alert(`Not enough questions. Found ${candidateQuestions.length}, requested ${config.numberOfQuestions}.`);
      return;
    }

    const selectedQuestions = shuffleArray(candidateQuestions).slice(0, config.numberOfQuestions);
    const gameQuestions = createShuffledQuestionSet(selectedQuestions);

    const gameSession: GameSession = {
      id: uuidv4(),
      isSoloPractice: true,
      user: currentUser,
      opponent: { id: 'solo', name: 'Solo Practice', points: 0, badges: [], stats: {} },
      questions: gameQuestions,
      userAnswers: {},
      opponentAnswers: {},
      userScore: 0,
      opponentScore: 0,
      userTime: 0,
      opponentTime: 0,
      isComplete: false,
      userStreak: 0,
      opponentStreak: 0,
      userStreakMax: 0,
      opponentStreakMax: 0,
      userCorrectAnswers: 0,
      opponentCorrectAnswers: 0,
    };

    setActiveGameSession(gameSession);
    setAppMode(AppMode.GAME_ACTIVE);
    closeModal('testConfig');
  }, [currentUser, selectedChat, messages, setActiveGameSession, setAppMode, closeModal]);

  const handleStartChallengePlay = useCallback(async (challengeId: string) => {
    if (!currentUser) return;

    try {
      const challenge = await fetchChallenge(challengeId);
      if (challenge.status !== 'accepted' && challenge.status !== 'completed') {
        alert('This challenge is not ready to play yet.');
        return;
      }

      const questions = challenge.questions || [];

      if (challenge.status === 'completed') {
        const session = challengeToGameSession(challenge, currentUser, questions);
        setActiveGameSession({ ...session, isComplete: true, awaitingOpponent: false });
        setAppMode(AppMode.GAME_RESULTS);
        return;
      }

      if (challenge.myParticipant?.finishedAt) {
        const session = challengeToGameSession(challenge, currentUser, questions);
        setActiveGameSession({ ...session, awaitingOpponent: true, isComplete: false });
        setAppMode(AppMode.GAME_RESULTS);
        return;
      }

      if (!questions.length) {
        alert('Could not load challenge questions.');
        return;
      }

      const session = challengeToGameSession(challenge, currentUser, questions);
      setActiveGameSession(session);
      setAppMode(AppMode.GAME_ACTIVE);
    } catch (error: any) {
      alert(error.message || 'Failed to start challenge');
    }
  }, [currentUser, setActiveGameSession, setAppMode]);

  // Poll while waiting for opponent — flips to full results when duel completes.
  useEffect(() => {
    if (!currentUser || !activeGameSession?.awaitingOpponent || !activeGameSession.challengeId) {
      return;
    }

    const challengeId = activeGameSession.challengeId;
    let cancelled = false;

    const poll = async () => {
      if (!(await hasValidSession())) return;
      try {
        const challenge = await fetchChallenge(challengeId);
        if (cancelled || challenge.status !== 'completed') return;

        const questions = challenge.questions || activeGameSession.questions;
        const session = challengeToGameSession(challenge, currentUser, questions);
        setActiveGameSession({
          ...session,
          isComplete: true,
          awaitingOpponent: false,
        });
        setAppMode(AppMode.GAME_RESULTS);
      } catch (error) {
        console.error('Failed to poll challenge status:', error);
      }
    };

    void poll();
    const intervalId = window.setInterval(() => void poll(), 6000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    currentUser,
    activeGameSession?.awaitingOpponent,
    activeGameSession?.challengeId,
    activeGameSession?.questions,
    setActiveGameSession,
    setAppMode,
  ]);

  const handleGameAnswer = useCallback((
    questionId: string,
    answerData: Partial<Omit<UserAnswerRecord, 'questionId'>>,
    timeTaken: number
  ) => {
    if (!activeGameSession || !currentUser) return;

    const question = activeGameSession.questions.find(q => q.id === questionId);
    const isCorrect = question ? checkAnswerIsCorrect(question, { ...answerData, questionId }) : false;

    let newStreak = activeGameSession.userStreak || 0;
    let questionPoints = 0;
    if (isCorrect) {
      const result = computeDuelQuestionPoints(true, timeTaken, newStreak);
      questionPoints = result.points;
      newStreak = result.newStreak;
    } else {
      newStreak = 0;
    }

    const updatedUserAnswers = {
      ...activeGameSession.userAnswers,
      [questionId]: { questionId, ...answerData, isCorrect, timeSpentSeconds: timeTaken },
    };

    const updatedSession: GameSession = {
      ...activeGameSession,
      userAnswers: updatedUserAnswers,
      userScore: activeGameSession.userScore + questionPoints,
      userTime: activeGameSession.userTime + timeTaken,
      userStreak: newStreak,
      userStreakMax: Math.max(activeGameSession.userStreakMax || 0, newStreak),
      userCorrectAnswers: (activeGameSession.userCorrectAnswers || 0) + (isCorrect ? 1 : 0),
    };

    setActiveGameSession(updatedSession);

    const totalQuestions = updatedSession.questions.length;
    const answeredCount = Object.keys(updatedUserAnswers).length;

    if (answeredCount === totalQuestions) {
      if (updatedSession.isSoloPractice) {
        finalizeSoloGame(updatedSession);
      } else if (updatedSession.challengeId) {
        void finalizeChallengeSubmit(updatedSession, updatedUserAnswers);
      }
    }
  }, [activeGameSession, currentUser, setActiveGameSession, finalizeSoloGame, finalizeChallengeSubmit]);

  const handleRematch = useCallback((opponent: User) => {
    setActiveGameSession(null);
    handleChallengeUser(opponent);
  }, [setActiveGameSession, handleChallengeUser]);

  return {
    handleSendChallenge,
    handleStartSoloPractice,
    handleStartChallengePlay,
    handleGameAnswer,
    handleRematch,
  };
}
