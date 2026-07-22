import { useCallback, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { AppMode, TestConfig, TestQuestion, UserAnswerRecord, TestSessionData, StudySessionData, TestResult, UserStats, UserQuestionStats, Message } from '../types';
import { useAuthStore } from '../stores/authStore';
import { useCompanionStore } from '../stores/companionStore';
import { useGroupStore } from '../stores/groupStore';
import { useUIStore } from '../stores/uiStore';
import { useTestStore } from '../stores/testStore';
import { useBudgetStore } from '../stores/budgetStore';
import { checkAndAwardBadges, isQuestionTestable, checkAnswerIsCorrect, createShuffledQuestionSet, shuffleArray } from '../utils/helpers';
import { BADGE_DEFINITIONS } from '../gamification';
import {
    createTestSession, createTestResult, upsertUserQuestionStat,
    createNotification
} from '../services/supabase';
import { syncGamificationProgress } from '../services/gamificationStreak';
import { formatActivityLocalDate } from '@lantern/shared/utils';
import { trackQuestProgress } from '../services/questProgress';
import { trackStudyActivity } from '../services/studyActivity';
import { trackTestStarted, trackTestCompleted } from '../services/productAnalytics';
import { normalizeUserSettings } from '@lantern/shared/settings';


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
        closeModal, isOnline
    } = useUIStore();
    const {
        activeTestSession, setActiveTestSession,
        activeStudySession, setActiveStudySession,
        userQuestionStats, setUserQuestionStats, updateTestResults,
        addPendingSyncResult,
    } = useTestStore();

    const isSubmittingTestRef = useRef(false);
    const [isSubmittingTest, setIsSubmittingTest] = useState(false);

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

        const studySettings = normalizeUserSettings(currentUser?.settings).study;
        const testQuestions: TestQuestion[] = studySettings.shuffleQuestions
            ? createShuffledQuestionSet(selectedQuestions)
            : selectedQuestions.map((q, i) => ({ ...q, questionNumber: i + 1 })) as TestQuestion[];
    
        const sessionConfig: TestConfig = {
            ...config,
            groupId: selectedChat.id,
            groupName: selectedChat.name,
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

        trackTestStarted({
            mode,
            questionCount: testQuestions.length,
            groupId: sessionConfig.groupId,
        });

        closeModal('testConfig');
    }, [activeTestSession, activeStudySession, selectedChat, messages, userQuestionStats, setActiveTestSession, setActiveStudySession, setAppMode, closeModal]);
    
    const handleUpdateAnswer = useCallback((questionId: string, answerData: Partial<Omit<UserAnswerRecord, 'questionId'>> & { revealAnswer?: boolean }) => {
        const { revealAnswer, ...answerFields } = answerData;
        const showExplanationsImmediately = normalizeUserSettings(currentUser?.settings).study.showExplanationsImmediately;
        const shouldReveal = revealAnswer === true || showExplanationsImmediately;

        const updateSession = (session: TestSessionData | null): TestSessionData | null => {
            if (!session) return null;
            const existingAnswer = session.userAnswers[questionId] || { questionId };
            const updatedAnswer = { ...existingAnswer, ...answerFields };
            
            if (appMode === AppMode.STUDY_ACTIVE) {
                const question = session.questions.find(q => q.id === questionId);
                if (question) {
                    const hasAnswerData = answerFields.selectedOptionIds || answerFields.fillText || 
                                          answerFields.matchingAnswers || answerFields.diagramAnswers;
                    const alreadyAnswered = existingAnswer.isCorrect !== undefined;

                    if (shouldReveal) {
                        updatedAnswer.isCorrect = checkAnswerIsCorrect(question, updatedAnswer);
                    } else if (!alreadyAnswered) {
                        delete updatedAnswer.isCorrect;
                    }
                    
                    if (shouldReveal && hasAnswerData && !alreadyAnswered && currentUser) {
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
                        trackStudyActivity('study_question', 1);
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
        if (!activeTestSession || !currentUser || isSubmittingTestRef.current) return;
        isSubmittingTestRef.current = true;
        setIsSubmittingTest(true);

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
            if (finalSessionData.isOffline || !isOnline) {
                // ── OFFLINE PATH ──────────────────────────────────────────
                // Store the result locally and sync it to the server later
                // when the user is back online (via "Sync Results" in Offline Mode).
                addPendingSyncResult(result);
                updateTestResults(prev => [result, ...prev]);

                const newUserQuestionStats: UserQuestionStats = { ...userQuestionStats };
                Object.values(finalUserAnswers).forEach((answer: UserAnswerRecord) => {
                    const questionId = answer.questionId;
                    const stats = newUserQuestionStats[questionId] || { correctAttempts: 0, incorrectAttempts: 0, lastAttempted: '' };
                    if (answer.isCorrect) stats.correctAttempts++;
                    else stats.incorrectAttempts++;
                    stats.lastAttempted = new Date().toISOString();
                    newUserQuestionStats[questionId] = stats;
                });
                setUserQuestionStats(newUserQuestionStats);
                setActiveTestResult(result);
                setAppMode(AppMode.TEST_REVIEW);
                setActiveTestSession(null);
                trackQuestProgress('complete_test');
                trackStudyActivity('test', 1);
                trackTestCompleted({ score, totalQuestions: finalSessionData.questions.length, offline: true });
                addNotification(`Offline test complete! Score: ${Math.round(score)}%. Your result will sync when you go online.`);
            } else {
                // ── ONLINE PATH ───────────────────────────────────────────
                const sessionData = {
                    config: finalSessionData.config,
                    questions: finalSessionData.questions,
                    user_answers: finalUserAnswers,
                    start_time: finalSessionData.startTime.toISOString(),
                    end_time: finalSessionData.endTime?.toISOString(),
                    is_offline: false
                };
                const savedSession = await createTestSession(sessionData, currentUser.id);
            
            const resultData = {
                session_id: savedSession.id,
                score,
                correct_answers_count: correctAnswersCount,
                total_questions: finalSessionData.questions.length,
                activityDate: formatActivityLocalDate(new Date()),
            };
            const saved = await createTestResult(resultData);
            
            updateTestResults(prev => [result, ...prev]);

            const walletBalance = (saved as { walletBalance?: number })?.walletBalance;
            if (typeof walletBalance === 'number') {
                useBudgetStore.getState().setWalletBalance(walletBalance);
            }

            const gamification = (saved as { gamification?: { points: number; badges: typeof currentUser.badges; stats: UserStats; awardedBadges?: typeof currentUser.badges } })?.gamification;
            if (gamification) {
                setCurrentUser({
                    ...currentUser,
                    points: gamification.points,
                    badges: gamification.badges,
                    stats: gamification.stats,
                });
                (gamification.awardedBadges || []).forEach(badge => {
                    const badgeDef = BADGE_DEFINITIONS[badge.id];
                    const levelInfo = badgeDef?.levels.find(l => l.level === badge.level);
                    addNotification(`Badge Unlocked: ${badge.name}! You've earned ${levelInfo?.points || 0} points.`);
                });
            } else {
                try {
                    const synced = await syncGamificationProgress();
                    setCurrentUser({
                        ...currentUser,
                        points: synced.points,
                        badges: synced.badges,
                        stats: synced.stats,
                    });
                    (synced.awardedBadges || []).forEach(badge => {
                        const badgeDef = BADGE_DEFINITIONS[badge.id];
                        const levelInfo = badgeDef?.levels.find(l => l.level === badge.level);
                        addNotification(`Badge Unlocked: ${badge.name}! You've earned ${levelInfo?.points || 0} points.`);
                    });
                } catch (error) {
                    console.error('Failed to sync gamification after test:', error);
                }
            }
        
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
                setAppMode(AppMode.TEST_REVIEW);
                setActiveTestSession(null);
                trackQuestProgress('complete_test');
                trackTestCompleted({ score, totalQuestions: finalSessionData.questions.length });
                // Study activity recorded server-side with createTestResult
                // Post-test debrief via Lantern companion
                const __tagStats: Record<string, { correct: number; total: number }> = {};
                finalSessionData.questions.forEach(q => {
                    const isCorrect = finalUserAnswers[q.id]?.isCorrect ?? false;
                    (q.tags?.length ? q.tags : ['General']).forEach(tag => {
                        if (!__tagStats[tag]) __tagStats[tag] = { correct: 0, total: 0 };
                        __tagStats[tag].total++;
                        if (isCorrect) __tagStats[tag].correct++;
                    });
                });
                const __weakTags = Object.entries(__tagStats)
                    .filter(([, s]) => s.total >= 2 && s.correct / s.total < 0.6)
                    .sort((a, b) => a[1].correct / a[1].total - b[1].correct / b[1].total)
                    .map(([tag]) => tag).slice(0, 3);
                const __debriefMsg = `I just finished a test: ${Math.round(score)}% (${correctAnswersCount}/${result.totalQuestions} correct)${__weakTags.length ? `. I struggled with: ${__weakTags.join(', ')}` : ''}. Give me a quick debrief and next steps.`;
                const __companion = useCompanionStore.getState();
                __companion.open();
                __companion.sendMessage(__debriefMsg, { weakTopics: __weakTags, recentTestSummary: `${Math.round(score)}% on ${result.totalQuestions} questions` });

                try {
                    await createNotification({
                        user_id: currentUser.id,
                        message: `Test completed! You scored ${score}% (${correctAnswersCount}/${finalSessionData.questions.length} correct)`,
                        link: `/dashboard`
                    });
                } catch (error) {
                    console.error('Failed to create test completion notification:', error);
                }
            } // end else (online path)
        } catch (error) {
            console.error('Error saving test result:', error);
            alert('Failed to save test result. Please try again.');
        } finally {
            isSubmittingTestRef.current = false;
            setIsSubmittingTest(false);
        }
    }, [activeTestSession, currentUser, userQuestionStats, isOnline, setCurrentUser, updateTestResults, addPendingSyncResult, setUserQuestionStats, setActiveTestResult, setActiveTestSession, setAppMode, addNotification]);
    
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
        isSubmittingTest,
    };
}
