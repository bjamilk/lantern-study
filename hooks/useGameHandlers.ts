import { useCallback, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { AppMode, TestConfig, TestQuestion, UserAnswerRecord, GameSession, User } from '../types';
import { useAuthStore } from '../stores/authStore';
import { useGroupStore } from '../stores/groupStore';
import { useUIStore } from '../stores/uiStore';
import { checkAndAwardBadges, isQuestionTestable, checkAnswerIsCorrect, createShuffledQuestionSet, shuffleArray } from '../utils/helpers';
import { BADGE_DEFINITIONS } from '../gamification';
import { updateUserProfile } from '../services/supabase';

interface UseGameHandlersParams {
    addNotification: (message: string) => Promise<void>;
    handleChallengeUser: (opponent: User) => void;
}

export function useGameHandlers({ addNotification, handleChallengeUser }: UseGameHandlersParams) {
    const { currentUser, setCurrentUser } = useAuthStore();
    const { messages } = useGroupStore();
    const {
        setAppMode, selectedChat,
        activeGameSession, setActiveGameSession,
        challengeOpponent, closeModal
    } = useUIStore();

    const handleEndGame = useCallback((finalSession: GameSession) => {
        if (!currentUser) return;
        let winnerId: string | undefined = undefined;
        if (finalSession.userScore > finalSession.opponentScore) {
            winnerId = finalSession.user.id;
        } else if (finalSession.opponentScore > finalSession.userScore) {
            winnerId = finalSession.opponent.id;
        } else {
            if (finalSession.userTime < finalSession.opponentTime) {
                winnerId = finalSession.user.id;
            } else if (finalSession.opponentTime < finalSession.userTime) {
                winnerId = finalSession.opponent.id;
            }
        }
    
        const completedSession = { ...finalSession, isComplete: true, winnerId };
        setActiveGameSession(completedSession);
    
        if (winnerId === currentUser.id) {
            const updatedStats = { ...currentUser.stats, gamesWon: (currentUser.stats.gamesWon || 0) + 1 };
            const userWithStats = { ...currentUser, stats: updatedStats };
            const { updatedUser, awardedBadges } = checkAndAwardBadges(userWithStats);

            updateUserProfile(currentUser.id, {
                points: updatedUser.points,
                stats: updatedUser.stats,
                badges: updatedUser.badges
            }).catch(error => console.error('Failed to update user profile after game:', error));

            awardedBadges.forEach(badge => {
                if (badge.id === 'DUELIST') {
                    addNotification(`Badge Unlocked: ${badge.name}! You've shown your mettle.`);
                }
            });

            setCurrentUser(updatedUser);
        }
        
        setAppMode(AppMode.GAME_RESULTS);
    }, [currentUser, setCurrentUser, setActiveGameSession, setAppMode, addNotification]);

    // Auto-complete game when both players have answered all questions
    useEffect(() => {
        if (activeGameSession && !activeGameSession.isComplete) {
            const totalQuestions = activeGameSession.questions.length;
            if (totalQuestions === 0) return;

            const userAnswersCount = Object.keys(activeGameSession.userAnswers).length;
            const opponentAnswersCount = Object.keys(activeGameSession.opponentAnswers).length;

            if (userAnswersCount === totalQuestions && opponentAnswersCount === totalQuestions) {
                setTimeout(() => {
                    handleEndGame(activeGameSession);
                }, 1000);
            }
        }
    }, [activeGameSession, handleEndGame]);

    const handleStartGame = useCallback((config: Omit<TestConfig, 'questionIds' | 'groupId'>, useSpacedRepetition: boolean) => {
        if (!currentUser || !challengeOpponent || !selectedChat || selectedChat.chatType !== 'group') return;
        
        const candidateQuestions = (messages[selectedChat.id] || []).filter(msg =>
            isQuestionTestable(msg) &&
            (config.allowedQuestionTypes.length === 0 || config.allowedQuestionTypes.includes(msg.questionType!)) &&
            (!config.selectedTags || config.selectedTags.length === 0 || msg.tags?.some(tag => config.selectedTags!.includes(tag)))
        );

        if (candidateQuestions.length < config.numberOfQuestions) {
            alert(`Not enough questions for a duel. Found ${candidateQuestions.length}, requested ${config.numberOfQuestions}.`);
            return;
        }

        const selectedQuestions = shuffleArray(candidateQuestions).slice(0, config.numberOfQuestions);
        const gameQuestions: TestQuestion[] = createShuffledQuestionSet(selectedQuestions);

        const gameSession: GameSession = {
            id: uuidv4(),
            user: currentUser,
            opponent: challengeOpponent,
            questions: gameQuestions,
            userAnswers: {},
            opponentAnswers: {},
            userScore: 0,
            opponentScore: 0,
            userTime: 0,
            opponentTime: 0,
            isComplete: false,
        };

        setActiveGameSession(gameSession);
        setAppMode(AppMode.GAME_ACTIVE);
        closeModal('testConfig');
    }, [currentUser, challengeOpponent, selectedChat, messages, setActiveGameSession, setAppMode, closeModal]);

    const handleGameAnswer = useCallback((questionId: string, answerData: Partial<Omit<UserAnswerRecord, 'questionId'>>, timeTaken: number) => {
        if (!activeGameSession) return;
    
        const question = activeGameSession.questions.find(q => q.id === questionId);
        const isCorrect = question ? checkAnswerIsCorrect(question, { ...answerData, questionId }) : false;
        
        const updatedUserAnswers = {
            ...activeGameSession.userAnswers,
            [questionId]: { questionId, ...answerData, isCorrect, timeSpentSeconds: timeTaken }
        };

        const updatedSession: GameSession = {
            ...activeGameSession,
            userAnswers: updatedUserAnswers,
            userScore: activeGameSession.userScore + (isCorrect ? 1 : 0),
            userTime: activeGameSession.userTime + timeTaken
        };
        
        setActiveGameSession(updatedSession);

        const opponentAnswerDelay = Math.random() * 2000 + 1000;
        setTimeout(() => {
            const opponentIsCorrect = Math.random() < 0.8;
            const opponentTime = timeTaken + (Math.random() * 2 - 1);
            
            const opponentAnswer: UserAnswerRecord = {
                questionId,
                isCorrect: opponentIsCorrect,
                timeSpentSeconds: Math.max(0.5, opponentTime)
            };

            const currentSession = useUIStore.getState().activeGameSession;
            if (!currentSession || currentSession.id !== updatedSession.id) return;
            
            const updatedOpponentAnswers = { ...currentSession.opponentAnswers, [questionId]: opponentAnswer };
            setActiveGameSession({
                ...currentSession,
                opponentAnswers: updatedOpponentAnswers,
                opponentScore: currentSession.opponentScore + (opponentIsCorrect ? 1 : 0),
                opponentTime: currentSession.opponentTime + opponentAnswer.timeSpentSeconds!
            });
        }, opponentAnswerDelay);
    }, [activeGameSession, setActiveGameSession]);
    
    const handleRematch = useCallback((opponent: User) => {
        setActiveGameSession(null);
        handleChallengeUser(opponent);
    }, [setActiveGameSession, handleChallengeUser]);

    return {
        handleStartGame,
        handleGameAnswer,
        handleEndGame,
        handleRematch,
    };
}
