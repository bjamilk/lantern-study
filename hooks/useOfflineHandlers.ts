import { useCallback } from 'react';
import {
    AppMode, TestConfig, TestQuestion, TestSessionData, StudySessionData,
    Message, QuestionType, OfflineQuestion, OfflineSessionBundle, UserAnswerRecord,
    UserQuestionStats, ChatItem
} from '../types';
import { useAuthStore } from '../stores/authStore';
import { useGroupStore } from '../stores/groupStore';
import { useTestStore } from '../stores/testStore';
import { useUIStore } from '../stores/uiStore';
import { shuffleArray, checkAndAwardBadges, isQuestionTestable, createShuffledQuestionSet } from '../utils/helpers';
import { BADGE_DEFINITIONS } from '../gamification';
import {
    createTestSession, createTestResult, upsertUserQuestionStat,
    updateUserProfile, saveOfflineBundle, deleteOfflineBundle
} from '../services/supabase';
import { v4 as uuidv4 } from 'uuid';

interface UseOfflineHandlersParams {
    addNotification: (message: string) => void;
}

export function useOfflineHandlers({ addNotification }: UseOfflineHandlersParams) {
    const { currentUser, setCurrentUser } = useAuthStore();
    const { messages } = useGroupStore();
    const {
        offlineBundles, updateOfflineBundles,
        pendingSyncResults, setPendingSyncResults,
        userQuestionStats, setUserQuestionStats,
        updateTestResults,
        activeTestSession, setActiveTestSession,
        activeStudySession, setActiveStudySession,
    } = useTestStore();
    const {
        setAppMode, isOnline, selectedChat,
        closeModal
    } = useUIStore();

    const handleDownloadForOffline = useCallback((
        config: Omit<TestConfig, 'questionIds' | 'groupId'>,
        useSpacedRepetition: boolean,
        selectedSubgroupIDs: string[]
    ) => {
        console.log('[Offline] download requested', config, useSpacedRepetition, selectedSubgroupIDs);
        if (!selectedChat || selectedChat.chatType !== 'group') return;
        
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
                alert(`Only found ${selectedQuestions.length} questions matching your criteria. A bundle will be created with these questions.`);
            }
        } else {
            if (candidateQuestions.length < config.numberOfQuestions) {
                alert(`Not enough questions matching your criteria. Found ${candidateQuestions.length}, but you requested ${config.numberOfQuestions}.`);
                return;
            }
            const shuffled = shuffleArray(candidateQuestions);
            selectedQuestions = shuffled.slice(0, config.numberOfQuestions);
        }
        
        if (selectedQuestions.length === 0) {
            alert(`No questions found to download.`);
            return;
        }
        
        const sessionConfig: TestConfig = {
            ...config,
            groupId: selectedChat.id,
            questionIds: selectedQuestions.map(q => q.id),
        };

        const questionsForBundle: OfflineQuestion[] = shuffleArray(selectedQuestions).map(q => {
            const questionWithOptions: Message = { ...q };
            if (
                (q.questionType === QuestionType.MULTIPLE_CHOICE_SINGLE ||
                 q.questionType === QuestionType.MULTIPLE_CHOICE_MULTIPLE ||
                 q.questionType === QuestionType.TRUE_FALSE) &&
                q.options
            ) {
                questionWithOptions.options = shuffleArray(q.options);
            }
            return questionWithOptions as OfflineQuestion;
        });

        const newBundle: OfflineSessionBundle = {
            bundleId: uuidv4(),
            config: sessionConfig,
            questions: questionsForBundle,
            downloadedAt: new Date(),
            groupName: selectedChat.name,
        };

        console.log('[Offline] new bundle', newBundle);
        updateOfflineBundles(prev => [...prev, newBundle]);
        
        if (currentUser) {
            saveOfflineBundle(currentUser.id, newBundle).then(() => {
                console.log('[Offline Sync] Bundle saved to cloud:', newBundle.bundleId);
            }).catch(error => {
                console.error('[Offline Sync] Failed to save bundle to cloud:', error);
            });
        }
        
        alert(`Test bundle "${selectedChat.name}" with ${selectedQuestions.length} questions has been downloaded!`);
        closeModal('testConfig');
    }, [selectedChat, messages, userQuestionStats, currentUser, updateOfflineBundles, closeModal]);

    const handleStartOfflineSession = useCallback((bundleId: string, mode: 'test' | 'study') => {
        console.log('[Offline] start session bundleId=', bundleId, 'mode=', mode);
        alert(`[Offline] starting bundle ${bundleId} mode ${mode}`);
        const bundle = offlineBundles.find(b => b.bundleId === bundleId);
        if (!bundle) {
            alert("Error: Could not find the offline test bundle.");
            console.warn('[Offline] missing bundle', bundleId, offlineBundles);
            return;
        }
        console.log('[Offline] launching bundle', bundle);

        const testQuestions: TestQuestion[] = createShuffledQuestionSet(bundle.questions);

        const startTime = new Date();
        const endTime = bundle.config.timerDuration ? new Date(startTime.getTime() + bundle.config.timerDuration * 1000) : undefined;
        
        const sessionData: TestSessionData = {
            config: bundle.config,
            questions: testQuestions,
            userAnswers: {},
            currentQuestionIndex: 0,
            startTime,
            endTime,
            isOffline: true,
        };

        if (mode === 'test') {
            setActiveTestSession(sessionData);
            console.log('[Offline] activeTestSession set', sessionData);
            // schedule mode change after state update flush to avoid reset guard
            setTimeout(() => {
                setAppMode(AppMode.TEST_ACTIVE);
                console.log('[Offline] appMode set to TEST_ACTIVE (delayed)');
            }, 0);
        } else {
            const studySessionData: StudySessionData = {
                config: bundle.config,
                questions: testQuestions,
                userAnswers: {},
                currentQuestionIndex: 0,
                startTime,
                isOffline: true,
            };
            setActiveStudySession(studySessionData);
            setTimeout(() => {
                setAppMode(AppMode.STUDY_ACTIVE);
            }, 0);
        }
    }, [offlineBundles, setActiveTestSession, setActiveStudySession, setAppMode]);

    const handleDeleteBundle = useCallback((bundleId: string) => {
        if (window.confirm("Are you sure you want to delete this downloaded test bundle?")) {
            updateOfflineBundles(prev => prev.filter(b => b.bundleId !== bundleId));
            
            if (currentUser) {
                deleteOfflineBundle(currentUser.id, bundleId).then(() => {
                    console.log('[Offline Sync] Bundle deleted from cloud:', bundleId);
                }).catch(error => {
                    console.error('[Offline Sync] Failed to delete bundle from cloud:', error);
                });
            }
        }
    }, [currentUser, updateOfflineBundles]);

    const handleSyncResults = useCallback(async () => {
        if (!isOnline) {
            alert("You must be online to sync results.");
            return;
        }
        if (pendingSyncResults.length === 0 || !currentUser) return;
        
        try {
            for (const result of pendingSyncResults) {
                const sessionData = {
                    config: result.session.config,
                    questions: result.session.questions,
                    user_answers: result.session.userAnswers,
                    start_time: result.session.startTime.toISOString(),
                    end_time: result.session.endTime?.toISOString(),
                    is_offline: result.session.isOffline || false
                };
                const savedSession = await createTestSession(sessionData, currentUser.id);
                
                const resultData = {
                    session_id: savedSession.id,
                    score: result.score,
                    correct_answers_count: result.correctAnswersCount,
                    total_questions: result.totalQuestions
                };
                await createTestResult(resultData);
            }
            
            updateTestResults(prev => [...prev, ...pendingSyncResults]);
            
            const newUserQuestionStats = { ...userQuestionStats };
            
            if (currentUser) {
                const updatedStats = { ...currentUser.stats };
                pendingSyncResults.forEach(result => {
                    updatedStats.testsCompleted = (updatedStats.testsCompleted || 0) + 1;
                    if (result.score >= 80) updatedStats.highScoreTests = (updatedStats.highScoreTests || 0) + 1;
                    if (result.score === 100) updatedStats.perfectScoreTests = (updatedStats.perfectScoreTests || 0) + 1;
                    
                    Object.values(result.session.userAnswers).forEach((answer: UserAnswerRecord) => {
                        const questionId = answer.questionId;
                        const stats = newUserQuestionStats[questionId] || { correctAttempts: 0, incorrectAttempts: 0, lastAttempted: '' };
                        if (answer.isCorrect) stats.correctAttempts++;
                        else stats.incorrectAttempts++;
                        stats.lastAttempted = result.session.endTime?.toISOString() || new Date().toISOString();
                        newUserQuestionStats[questionId] = stats;

                        upsertUserQuestionStat(currentUser.id, questionId, stats).catch(error => {
                            console.error('Error saving user question stat during sync:', error);
                        });
                    });
                });

                const userWithStats = { ...currentUser, stats: updatedStats };
                const { updatedUser, awardedBadges } = checkAndAwardBadges(userWithStats);

                updateUserProfile(currentUser.id, {
                    points: updatedUser.points,
                    stats: updatedUser.stats,
                    badges: updatedUser.badges
                }).catch(error => console.error('Failed to update user profile during sync:', error));

                awardedBadges.forEach(badge => {
                    const badgeDef = BADGE_DEFINITIONS[badge.id];
                    const levelInfo = badgeDef.levels.find(l => l.level === badge.level);
                    addNotification(`Badge Unlocked: ${badge.name}! You've earned ${levelInfo?.points || 0} points.`);
                });
                
                setCurrentUser(updatedUser);
            }
            
            setUserQuestionStats(newUserQuestionStats);

            addNotification(`${pendingSyncResults.length} offline result(s) synced successfully!`);
            setPendingSyncResults([]);
        } catch (error) {
            console.error('Error syncing results:', error);
            alert('Failed to sync results. Please try again.');
        }
    }, [isOnline, pendingSyncResults, currentUser, userQuestionStats, updateTestResults, setPendingSyncResults, setUserQuestionStats, setCurrentUser, addNotification]);

    return {
        handleDownloadForOffline,
        handleStartOfflineSession,
        handleDeleteBundle,
        handleSyncResults,
    };
}
