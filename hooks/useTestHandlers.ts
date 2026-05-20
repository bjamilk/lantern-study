import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { AppMode, TestConfig, TestQuestion, UserAnswerRecord, TestSessionData, StudySessionData, TestResult, UserStats, UserQuestionStats, Message } from '../types';
import { useAuthStore } from '../stores/authStore';
import { useGroupStore } from '../stores/groupStore';
import { useUIStore } from '../stores/uiStore';
import { useTestStore } from '../stores/testStore';
import { checkAndAwardBadges, isQuestionTestable, checkAnswerIsCorrect, createShuffledQuestionSet, shuffleArray } from '../utils/helpers';
import { BADGE_DEFINITIONS } from '../gamification';
import {
    createTestSession, createTestResult, upsertUserQuestionStat,
    updateUserProfile, createNotification
} from '../services/supabase';

interface UseTestHandlersParams {
    addNotification: (message: string) => Promise<void>;
}

export function useTestHandlers({ addNotification }: UseTestHandlersParams) {
    const { currentUser, setCurrentUser } = useAuthStore();
    const { messages } = useGroupStore();
    const {
        appMode, setAppMode, selectedChat,
        activeTestResult, setActiveTestResult,
        setAnalyzingResult,
        closeModal
    } = useUIStore();
    const {
        activeTestSession, setActiveTestSession,
        activeStudySession, setActiveStudySession,
        userQuestionStats, setUserQuestionStats, updateTestResults
    } = useTestStore();

    const handleTestSubmit = useCallback((config: Omit<TestConfig, 'questionIds' | 'groupId'>, mode: 'test' | 'study' | 'game', useSpacedRepetition: boolean, selectedSubgroupIDs: string[]) => {
        if (activeTestSession || activeStudySession) {
            if (window.confirm("You have a paused session. Would you like to resume it instead of starting a new one?")) {
                const pausedMode = activeTestSession ? AppMode.TEST_ACTIVE : AppMode.STUDY_ACTIVE;
                setAppMode(pausedMode);
                if (activeTestSession?.remainingTime) {
                    const newEndTime = new Date(Date.now() + activeTestSession.remainingTime * 1000);
                    setActiveTestSession({ ...activeTestSession, endTime: newEndTime, remainingTime: undefined });
                }
            }
            return;
        }

        if (!selectedChat || selectedChat.chatType !== 'group') return;

        // game mode is handled in useGameHandlers
        if (mode === 'game') return;
    
        const sourceGroupIds = [selectedChat.id, ...selectedSubgroupIDs];
        let candidateQuestions: Message[] = [];
        let finalSelectedQuestions: Message[] = [];
        const allSourceMessages = [...new Set(sourceGroupIds)].flatMap(id => messages[id] || []);
        const allTestableQuestions = allSourceMessages.filter(isQuestionTestable);
    
        if (useSpacedRepetition) {
            candidateQuestions = allTestableQuestions.filter((q: Message) => {
                const stats = userQuestionStats[q.id];
                if (!stats) return true; // Never attempted = needs study
                return stats.incorrectAttempts > 0 && stats.incorrectAttempts >= stats.correctAttempts;
            });
        } else if (config.focusOnNew) {
            const addedIds = new Set<string>();
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
            const baseFilteredQuestions = allTestableQuestions.filter(q =>
                (config.allowedQuestionTypes.length === 0 || config.allowedQuestionTypes.includes(q.questionType!)) &&
                (!config.selectedTags || config.selectedTags.length === 0 || q.tags?.some(tag => config.selectedTags!.includes(tag)))
            );
            const shuffledBase = shuffleArray(baseFilteredQuestions);
    
            const recent = shuffledBase.filter(q => new Date(q.timestamp) >= sevenDaysAgo && !userQuestionStats[q.id]);
            recent.forEach(q => {
                if (finalSelectedQuestions.length < config.numberOfQuestions) {
                    finalSelectedQuestions.push(q);
                    addedIds.add(q.id);
                }
            });
    
            if (finalSelectedQuestions.length < config.numberOfQuestions) {
                const unattempted = shuffledBase.filter(q => !userQuestionStats[q.id] && !addedIds.has(q.id));
                unattempted.forEach(q => {
                    if (finalSelectedQuestions.length < config.numberOfQuestions) {
                        finalSelectedQuestions.push(q);
                        addedIds.add(q.id);
                    }
                });
            }
    
            // Do NOT fall back to already-answered questions when focusOnNew is enabled
        } else {
            candidateQuestions = allTestableQuestions.filter(msg =>
                (config.allowedQuestionTypes.length === 0 || config.allowedQuestionTypes.includes(msg.questionType!)) &&
                (!config.selectedTags || config.selectedTags.length === 0 || msg.tags?.some(tag => config.selectedTags!.includes(tag)))
            );
        }

        let selectedQuestions: Message[];

        if (config.focusOnNew) {
            selectedQuestions = finalSelectedQuestions;
            if (selectedQuestions.length < config.numberOfQuestions && selectedQuestions.length > 0) {
                alert(`Only found ${selectedQuestions.length} questions matching your criteria. A session will be created with these questions.`);
            }
        } else {
            if (candidateQuestions.length < config.numberOfQuestions) {
                alert(`Not enough questions matching your criteria. Found ${candidateQuestions.length}, but you requested ${config.numberOfQuestions}. Please broaden your filters or wait for more questions to be verified.`);
                return;
            }
            const shuffled = shuffleArray(candidateQuestions);
            selectedQuestions = shuffled.slice(0, config.numberOfQuestions);
        }
        
        if (selectedQuestions.length === 0) {
            alert(`No questions found matching your criteria. Please broaden your filters.`);
            return;
        }

        const testQuestions: TestQuestion[] = createShuffledQuestionSet(selectedQuestions);
    
        const sessionConfig: TestConfig = {
            ...config,
            groupId: selectedChat.id,
            questionIds: selectedQuestions.map(q => q.id),
        };
    
        const startTime = new Date();
        let endTime: Date | undefined = undefined;
        if (mode === 'test' && config.timerDuration) {
            endTime = new Date(startTime.getTime() + config.timerDuration * 1000);
        }
    
        const sessionData: TestSessionData = {
            config: sessionConfig,
            questions: testQuestions,
            userAnswers: {},
            currentQuestionIndex: 0,
            startTime,
            endTime,
        };
    
        if (mode === 'test') {
            setActiveTestSession(sessionData);
            setAppMode(AppMode.TEST_ACTIVE);
        } else {
            setActiveStudySession(sessionData);
            setAppMode(AppMode.STUDY_ACTIVE);
        }
    
        closeModal('testConfig');
    }, [activeTestSession, activeStudySession, selectedChat, messages, userQuestionStats, setActiveTestSession, setActiveStudySession, setAppMode, closeModal]);
    
    const handleUpdateAnswer = useCallback((questionId: string, answerData: Partial<Omit<UserAnswerRecord, 'questionId'>>) => {
        const updateSession = (session: TestSessionData | null): TestSessionData | null => {
            if (!session) return null;
            const existingAnswer = session.userAnswers[questionId] || { questionId };
            const updatedAnswer = { ...existingAnswer, ...answerData };
            
            if (appMode === AppMode.STUDY_ACTIVE) {
                const question = session.questions.find(q => q.id === questionId);
                if (question) {
                    updatedAnswer.isCorrect = checkAnswerIsCorrect(question, updatedAnswer);
                    
                    const hasAnswerData = answerData.selectedOptionIds || answerData.fillText || 
                                          answerData.matchingAnswers || answerData.diagramAnswers;
                    const alreadyAnswered = existingAnswer.isCorrect !== undefined;
                    
                    if (hasAnswerData && !alreadyAnswered && currentUser) {
                        const currentStats = userQuestionStats[questionId] || { 
                            correctAttempts: 0, 
                            incorrectAttempts: 0, 
                            lastAttempted: '' 
                        };
                        const newStats = {
                            correctAttempts: updatedAnswer.isCorrect ? currentStats.correctAttempts + 1 : currentStats.correctAttempts,
                            incorrectAttempts: !updatedAnswer.isCorrect ? currentStats.incorrectAttempts + 1 : currentStats.incorrectAttempts,
                            lastAttempted: new Date().toISOString()
                        };
                        
                        setUserQuestionStats({
                            ...userQuestionStats,
                            [questionId]: newStats
                        });
                        
                        upsertUserQuestionStat(currentUser.id, questionId, newStats).catch(error => {
                            console.error('Error saving study mode question stat:', error);
                        });
                    }
                }
            }

            return {
                ...session,
                userAnswers: {
                    ...session.userAnswers,
                    [questionId]: updatedAnswer,
                },
            };
        };
    
        if (appMode === AppMode.TEST_ACTIVE && activeTestSession) {
            const updated = updateSession(activeTestSession);
            if (updated) setActiveTestSession(updated);
        } else if (appMode === AppMode.STUDY_ACTIVE && activeStudySession) {
            const updated = updateSession(activeStudySession);
            if (updated) setActiveStudySession(updated as StudySessionData);
        }
    }, [appMode, activeTestSession, activeStudySession, currentUser, userQuestionStats, setActiveTestSession, setActiveStudySession, setUserQuestionStats]);
    
    const handleChangeQuestion = useCallback((newIndex: number) => {
        console.log('[TestHandlers] handleChangeQuestion', { newIndex, appMode, activeTestSession });
        if (appMode === AppMode.TEST_ACTIVE && activeTestSession) {
            if (newIndex >= 0 && newIndex < activeTestSession.questions.length) {
                const updated = { ...activeTestSession, currentQuestionIndex: newIndex };
                console.log('[TestHandlers] updating session index to', newIndex);
                setActiveTestSession(updated);
            }
        } else if (appMode === AppMode.STUDY_ACTIVE && activeStudySession) {
            if (newIndex >= 0 && newIndex < activeStudySession.questions.length) {
                const updated = { ...activeStudySession, currentQuestionIndex: newIndex };
                setActiveStudySession(updated);
            }
        }
    }, [appMode, activeTestSession, activeStudySession, setActiveTestSession, setActiveStudySession]);
    
    const handleToggleBookmark = useCallback((questionId: string) => {
        const toggleBookmark = (session: TestSessionData | null): TestSessionData | null => {
            if (!session) return null;
            const existingAnswer = session.userAnswers[questionId] || { questionId };
            return {
                ...session,
                userAnswers: {
                    ...session.userAnswers,
                    [questionId]: { ...existingAnswer, isBookmarked: !existingAnswer.isBookmarked },
                },
            };
        };

        if (appMode === AppMode.TEST_ACTIVE && activeTestSession) {
            const updated = toggleBookmark(activeTestSession);
            if (updated) {
                setActiveTestSession(updated);
            }
        } else if (appMode === AppMode.STUDY_ACTIVE && activeStudySession) {
            const updated = toggleBookmark(activeStudySession);
            if (updated) {
                setActiveStudySession(updated as StudySessionData);
            }
        }
    }, [appMode, activeTestSession, activeStudySession, setActiveTestSession, setActiveStudySession]);

    const handleSubmitTest = useCallback(async () => {
        if (!activeTestSession || !currentUser) return;
    
        const finalUserAnswers: Record<string, UserAnswerRecord> = {};
        let correctAnswersCount = 0;
        
        activeTestSession.questions.forEach(q => {
            const userAnswer = activeTestSession.userAnswers[q.id] || { questionId: q.id };
            const isCorrect = checkAnswerIsCorrect(q, userAnswer);
            if (isCorrect) correctAnswersCount++;
            finalUserAnswers[q.id] = { ...userAnswer, isCorrect };
        });
        
        const finalSessionData: TestSessionData = {
            ...activeTestSession,
            userAnswers: finalUserAnswers,
            endTime: new Date(),
        };
    
        const score = (correctAnswersCount / finalSessionData.questions.length) * 100;
        
        const result: TestResult = {
            id: uuidv4(),
            session: finalSessionData,
            score,
            totalQuestions: finalSessionData.questions.length,
            correctAnswersCount,
        };
    
        try {
            const sessionData = {
                config: finalSessionData.config,
                questions: finalSessionData.questions,
                user_answers: finalUserAnswers,
                start_time: finalSessionData.startTime.toISOString(),
                end_time: finalSessionData.endTime?.toISOString(),
                is_offline: finalSessionData.isOffline || false
            };
            const savedSession = await createTestSession(sessionData, currentUser.id);
            
            const resultData = {
                session_id: savedSession.id,
                score,
                correct_answers_count: correctAnswersCount,
                total_questions: finalSessionData.questions.length
            };
            await createTestResult(resultData);
            
            updateTestResults(prev => [result, ...prev]);
            
            const updatedStats: UserStats = { ...currentUser.stats };
            updatedStats.testsCompleted = (updatedStats.testsCompleted || 0) + 1;
            if (score >= 80) {
                updatedStats.highScoreTests = (updatedStats.highScoreTests || 0) + 1;
            }
            if (score === 100) {
                updatedStats.perfectScoreTests = (updatedStats.perfectScoreTests || 0) + 1;
            }

            const userWithStats = { ...currentUser, stats: updatedStats };
            const { updatedUser, awardedBadges } = checkAndAwardBadges(userWithStats);

            updateUserProfile(currentUser.id, {
                points: updatedUser.points,
                stats: updatedUser.stats,
                badges: updatedUser.badges
            }).catch(error => console.error('Failed to update user profile:', error));

            awardedBadges.forEach(badge => {
                const badgeDef = BADGE_DEFINITIONS[badge.id];
                const levelInfo = badgeDef.levels.find(l => l.level === badge.level);
                addNotification(`Badge Unlocked: ${badge.name}! You've earned ${levelInfo?.points || 0} points.`);
            });
            
            setCurrentUser(updatedUser);
        
            const newUserQuestionStats: UserQuestionStats = { ...userQuestionStats };
            Object.values(finalUserAnswers).forEach((answer: UserAnswerRecord) => {
                const questionId = answer.questionId;
                const stats = newUserQuestionStats[questionId] || { correctAttempts: 0, incorrectAttempts: 0, lastAttempted: '' };
                if (answer.isCorrect) {
                    stats.correctAttempts++;
                } else {
                    stats.incorrectAttempts++;
                }
                stats.lastAttempted = new Date().toISOString();
                newUserQuestionStats[questionId] = stats;

                upsertUserQuestionStat(currentUser.id, questionId, stats).catch(error => {
                    console.error('Error saving user question stat:', error);
                });
            });
            setUserQuestionStats(newUserQuestionStats);
            
            setActiveTestResult(result);
            setActiveTestSession(null);
            setAppMode(AppMode.TEST_REVIEW);

            try {
                await createNotification({
                    user_id: currentUser.id,
                    message: `Test completed! You scored ${score}% (${correctAnswersCount}/${finalSessionData.questions.length} correct)`,
                    link: `/dashboard`
                });
            } catch (error) {
                console.error('Failed to create test completion notification:', error);
            }
        } catch (error) {
            console.error('Error saving test result:', error);
            alert('Failed to save test result. Please try again.');
        }
    }, [activeTestSession, currentUser, userQuestionStats, setCurrentUser, updateTestResults, setUserQuestionStats, setActiveTestResult, setActiveTestSession, setAppMode, addNotification]);
    
    const handleEndStudySession = useCallback(() => {
        setActiveStudySession(null);
        setAppMode(AppMode.CHAT);
    }, [setActiveStudySession, setAppMode]);

    const handleCancelActiveSession = useCallback(() => {
        if (window.confirm("Are you sure you want to cancel this session? Your progress will be lost and this session will not be recorded.")) {
            setActiveTestSession(null);
            setActiveStudySession(null);
            setAppMode(AppMode.CHAT);
        }
    }, [setActiveTestSession, setActiveStudySession, setAppMode]);

    const handlePauseSession = useCallback(() => {
        if (appMode === AppMode.TEST_ACTIVE && activeTestSession?.endTime) {
            const now = new Date().getTime();
            const endTimeMs = new Date(activeTestSession.endTime).getTime();
            const remaining = Math.round((endTimeMs - now) / 1000);
            setActiveTestSession({ ...activeTestSession, remainingTime: remaining > 0 ? remaining : 0 });
        }
        setAppMode(AppMode.CHAT);
    }, [appMode, activeTestSession, setActiveTestSession, setAppMode]);

    const handleResumeSession = useCallback((mode: AppMode) => {
        if (mode === AppMode.TEST_ACTIVE && activeTestSession?.remainingTime) {
            const newEndTime = new Date(Date.now() + activeTestSession.remainingTime * 1000);
            setActiveTestSession({ ...activeTestSession, endTime: newEndTime, remainingTime: undefined });
        }
        setAppMode(mode);
    }, [activeTestSession, setActiveTestSession, setAppMode]);

    const handleRetakeTest = useCallback((sessionData: TestSessionData) => {
        const shuffledQuestions = createShuffledQuestionSet(sessionData.questions);
        
        const newSession: TestSessionData = {
            config: sessionData.config,
            questions: shuffledQuestions,
            isOffline: sessionData.isOffline,
            userAnswers: {},
            currentQuestionIndex: 0,
            startTime: new Date(),
            endTime: sessionData.config.timerDuration 
                ? new Date(Date.now() + sessionData.config.timerDuration * 1000) 
                : undefined,
        };
        setActiveTestSession(newSession);
        setActiveTestResult(null);
        setAppMode(AppMode.TEST_ACTIVE);
    }, [setActiveTestSession, setActiveTestResult, setAppMode]);
    
    const handlePracticeFailedQuestions = useCallback((failedQuestions: TestQuestion[]) => {
        if (!selectedChat || selectedChat.chatType !== 'group' || failedQuestions.length === 0) return;
    
        const sessionConfig: TestConfig = {
            groupId: selectedChat.id,
            numberOfQuestions: failedQuestions.length,
            questionIds: failedQuestions.map(q => q.id),
            allowedQuestionTypes: [],
        };
    
        const shuffledFailedQuestions = createShuffledQuestionSet(failedQuestions);

        const sessionData: StudySessionData = {
            config: sessionConfig,
            questions: shuffledFailedQuestions,
            userAnswers: {},
            currentQuestionIndex: 0,
            startTime: new Date(),
        };
    
        setActiveStudySession(sessionData);
        setActiveTestResult(null);
        setAppMode(AppMode.STUDY_ACTIVE);
    }, [selectedChat, setActiveStudySession, setActiveTestResult, setAppMode]);

    return {
        handleTestSubmit,
        handleUpdateAnswer,
        handleChangeQuestion,
        handleToggleBookmark,
        handleSubmitTest,
        handleEndStudySession,
        handleCancelActiveSession,
        handlePauseSession,
        handleResumeSession,
        handleRetakeTest,
        handlePracticeFailedQuestions,
    };
}
