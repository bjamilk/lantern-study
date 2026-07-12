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
import { shuffleArray, isQuestionTestable, createShuffledQuestionSet } from '../utils/helpers';
import { BADGE_DEFINITIONS } from '../gamification';
import {
    createTestSession, createTestResult, upsertUserQuestionStat,
    saveOfflineBundle, deleteOfflineBundle,
    markPendingSyncResultAsSynced,
} from '../services/supabase';
import { formatActivityLocalDate } from '@lantern/shared/utils';
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

    const handleDownloadForOffline = useCallback(async (
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
            groupName: selectedChat.name,
            questionIds: selectedQuestions.map(q => q.id),
        };

        const questionsForBundle: OfflineQuestion[] = await Promise.all(
            shuffleArray(selectedQuestions).map(async (q) => {
                const questionWithOptions: Message = { ...q };
                if (
                    (q.questionType === QuestionType.MULTIPLE_CHOICE_SINGLE ||
                     q.questionType === QuestionType.MULTIPLE_CHOICE_MULTIPLE ||
                     q.questionType === QuestionType.TRUE_FALSE) &&
                    q.options
                ) {
                    questionWithOptions.options = shuffleArray(q.options);
                }
                // Convert remote imageUrl to base64 so it works offline and in imports
                if (q.imageUrl && !q.imageUrl.startsWith('data:')) {
                    try {
                        const imgResp = await fetch(q.imageUrl);
                        const blob = await imgResp.blob();
                        const base64 = await new Promise<string>((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = () => resolve(reader.result as string);
                            reader.onerror = reject;
                            reader.readAsDataURL(blob);
                        });
                        questionWithOptions.imageUrl = base64;
                    } catch (err) {
                        console.warn('[Offline] Failed to convert image to base64, keeping URL:', q.imageUrl, err);
                    }
                }
                return questionWithOptions as OfflineQuestion;
            })
        );

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
            config: {
                ...bundle.config,
                // Prefer user-set displayName, then the original group name from config/bundle
                groupName: bundle.displayName || bundle.config.groupName || bundle.groupName,
            },
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
                config: {
                    ...bundle.config,
                    groupName: bundle.config.groupName || bundle.groupName,
                },
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
        
        const syncedIds: string[] = [];
        let lastGamification: {
            points: number;
            badges: typeof currentUser.badges;
            stats: typeof currentUser.stats;
            awardedBadges?: typeof currentUser.badges;
        } | undefined;

        try {
            for (const result of pendingSyncResults) {
                const sessionData = {
                    config: result.session.config,
                    questions: result.session.questions,
                    user_answers: result.session.userAnswers,
                    start_time: new Date(result.session.startTime).toISOString(),
                    end_time: result.session.endTime ? new Date(result.session.endTime).toISOString() : undefined,
                    is_offline: result.session.isOffline || false
                };
                const savedSession = await createTestSession(sessionData, currentUser.id);
                
                const resultData = {
                    session_id: savedSession.id,
                    score: result.score,
                    correct_answers_count: result.correctAnswersCount,
                    total_questions: result.totalQuestions,
                    activityDate: result.session.endTime
                        ? formatActivityLocalDate(new Date(result.session.endTime))
                        : formatActivityLocalDate(new Date()),
                };
                const saved = await createTestResult(resultData);
                if ((saved as { gamification?: typeof lastGamification })?.gamification) {
                    lastGamification = (saved as { gamification: typeof lastGamification }).gamification;
                }
                await markPendingSyncResultAsSynced(result.id);
                syncedIds.push(result.id);
            }
        } catch (error) {
            console.error('Error syncing results:', error);
            if (syncedIds.length === 0) {
                alert('Failed to sync results. Please try again.');
                return;
            }
            addNotification(`Synced ${syncedIds.length} of ${pendingSyncResults.length} result(s). Retry to sync the rest.`);
        }

        if (syncedIds.length === 0) return;

        const syncedResults = pendingSyncResults.filter(r => syncedIds.includes(r.id));
        const remaining = pendingSyncResults.filter(r => !syncedIds.includes(r.id));

        updateTestResults(prev => {
            const existingIds = new Set(prev.map(r => r.id));
            const toAdd = syncedResults.filter(r => !existingIds.has(r.id));
            return [...toAdd, ...prev];
        });
        
        const newUserQuestionStats = { ...userQuestionStats };
        
        syncedResults.forEach(result => {
            Object.values(result.session.userAnswers).forEach((answer: UserAnswerRecord) => {
                const questionId = answer.questionId;
                const stats = newUserQuestionStats[questionId] || { correctAttempts: 0, incorrectAttempts: 0, lastAttempted: '' };
                if (answer.isCorrect) stats.correctAttempts++;
                else stats.incorrectAttempts++;
                stats.lastAttempted = result.session.endTime ? new Date(result.session.endTime).toISOString() : new Date().toISOString();
                newUserQuestionStats[questionId] = stats;

                upsertUserQuestionStat(currentUser.id, questionId, stats).catch(error => {
                    console.error('Error saving user question stat during sync:', error);
                });
            });
        });

        if (lastGamification) {
            setCurrentUser({
                ...currentUser,
                points: lastGamification.points,
                badges: lastGamification.badges,
                stats: lastGamification.stats,
            });
            (lastGamification.awardedBadges || []).forEach(badge => {
                const badgeDef = BADGE_DEFINITIONS[badge.id];
                const levelInfo = badgeDef?.levels.find(l => l.level === badge.level);
                addNotification(`Badge Unlocked: ${badge.name}! You've earned ${levelInfo?.points || 0} points.`);
            });
        }
        
        setUserQuestionStats(newUserQuestionStats);
        setPendingSyncResults(remaining);

        if (remaining.length === 0) {
            addNotification(`${syncedIds.length} offline result(s) synced successfully!`);
        }
    }, [isOnline, pendingSyncResults, currentUser, userQuestionStats, updateTestResults, setPendingSyncResults, setUserQuestionStats, setCurrentUser, addNotification]);

    const handleImportBundle = useCallback((bundle: OfflineSessionBundle): string | null => {
        // Assign a fresh bundleId so it never collides with an existing one
        const imported: OfflineSessionBundle = {
            ...bundle,
            bundleId: uuidv4(),
            downloadedAt: new Date(),
        };

        // Guard: reject if there's already a bundle with the same questions
        const isDuplicate = offlineBundles.some(
            b => b.groupName === imported.groupName &&
                 b.questions.length === imported.questions.length &&
                 b.config.numberOfQuestions === imported.config.numberOfQuestions
        );
        if (isDuplicate) {
            alert(`A bundle for "${imported.groupName}" with ${imported.questions.length} questions already exists.`);
            return null;
        }

        updateOfflineBundles(prev => [...prev, imported]);

        if (currentUser) {
            saveOfflineBundle(currentUser.id, imported).catch(err =>
                console.error('[Offline] Failed to save imported bundle to cloud:', err)
            );
        }

        addNotification(`Bundle "${imported.groupName}" imported with ${imported.questions.length} questions. Ready to start!`);
        return imported.bundleId;
    }, [offlineBundles, currentUser, updateOfflineBundles, addNotification]);

    const handleRenameBundle = useCallback((bundleId: string, newName: string) => {
        const trimmed = newName.trim();
        updateOfflineBundles(prev => {
            const updated = prev.map(b =>
                b.bundleId === bundleId ? { ...b, displayName: trimmed || undefined } : b
            );
            // Persist the rename to the server so it survives device switches
            if (currentUser) {
                const renamedBundle = updated.find(b => b.bundleId === bundleId);
                if (renamedBundle) {
                    saveOfflineBundle(currentUser.id, renamedBundle).catch(err =>
                        console.error('[Offline] Failed to persist bundle rename to server:', err)
                    );
                }
            }
            return updated;
        });
    }, [updateOfflineBundles, currentUser]);

    return {
        handleDownloadForOffline,
        handleStartOfflineSession,
        handleDeleteBundle,
        handleSyncResults,
        handleImportBundle,
        handleRenameBundle,
    };
}
