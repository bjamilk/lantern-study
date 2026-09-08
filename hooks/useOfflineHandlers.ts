import { useCallback, useState } from 'react';
import {
    AppMode, TestConfig, TestQuestion, TestSessionData, StudySessionData,
    Message, QuestionType, OfflineQuestion, OfflineSessionBundle,
} from '../types';
import { useAuthStore } from '../stores/authStore';
import { useGroupStore } from '../stores/groupStore';
import { useTestStore } from '../stores/testStore';
import { useUIStore } from '../stores/uiStore';
import { useToastStore } from '../stores/toastStore';
import { shuffleArray, isQuestionTestable, createShuffledQuestionSet } from '../utils/helpers';
import { BADGE_DEFINITIONS } from '../gamification';
import { saveOfflineBundle, deleteOfflineBundle } from '../services/supabase';
import { syncPendingFlashcardReviews } from '../services/offlineFlashcardSync';
import { syncPendingTestResults } from '../services/offlineTestSync';
import { useFlashcardStore } from '../stores/flashcardStore';
import { confirmDialog } from '../stores/confirmStore';
import { planDeleteOfflineBundleConfirm } from '../utils/destructiveConfirm';
import { v4 as uuidv4 } from 'uuid';

interface UseOfflineHandlersParams {
    addNotification: (message: string) => void;
}

export function useOfflineHandlers({ addNotification }: UseOfflineHandlersParams) {
    const { currentUser, setCurrentUser } = useAuthStore();
    const { messages } = useGroupStore();
    const {
        offlineBundles, updateOfflineBundles,
        pendingSyncResults,
        userQuestionStats,
        setActiveTestSession,
        setActiveStudySession,
    } = useTestStore();
    const {
        setAppMode, isOnline, selectedChat,
        closeModal
    } = useUIStore();

    // Busy state so the modal's spinner (already wired for a prop nobody
    // passed) actually shows, and a double-click can't create two bundles.
    const [isDownloadingBundle, setIsDownloadingBundle] = useState(false);

    const handleDownloadForOffline = useCallback(async (
        config: Omit<TestConfig, 'questionIds' | 'groupId'>,
        useSpacedRepetition: boolean,
        selectedSubgroupIDs: string[]
    ) => {
        console.log('[Offline] download requested', config, useSpacedRepetition, selectedSubgroupIDs);
        if (!selectedChat || selectedChat.chatType !== 'group') return;
        if (isDownloadingBundle) return;
        setIsDownloadingBundle(true);
        try {
        
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
                useToastStore.getState().showToast(`Only ${selectedQuestions.length} questions matched — creating the bundle with those.`, 'info');
            }
        } else {
            if (candidateQuestions.length < config.numberOfQuestions) {
                useToastStore.getState().showToast(`Not enough questions: found ${candidateQuestions.length} of the ${config.numberOfQuestions} requested.`, 'error');
                return;
            }
            const shuffled = shuffleArray(candidateQuestions);
            selectedQuestions = shuffled.slice(0, config.numberOfQuestions);
        }
        
        if (selectedQuestions.length === 0) {
            useToastStore.getState().showToast('No questions found to download.', 'error');
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
        
        useToastStore.getState().showToast(
            `Bundle "${selectedChat.name}" saved with ${selectedQuestions.length} questions — find it under Offline Activity.`,
            'success'
        );
        closeModal('testConfig');
        } finally {
            setIsDownloadingBundle(false);
        }
    }, [selectedChat, messages, userQuestionStats, currentUser, updateOfflineBundles, closeModal, isDownloadingBundle]);

    const handleStartOfflineSession = useCallback((bundleId: string, mode: 'test' | 'study') => {
        console.log('[Offline] start session bundleId=', bundleId, 'mode=', mode);
        const bundle = offlineBundles.find(b => b.bundleId === bundleId);
        if (!bundle) {
            console.warn('[Offline] missing bundle', bundleId, offlineBundles);
            addNotification('Could not find the offline test bundle.');
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
                // Carried so completion can attribute the score to a marketplace
                // question bank (bundleId is "qbank-<listingId>" for purchases).
                bundleId: bundle.bundleId,
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
    }, [offlineBundles, setActiveTestSession, setActiveStudySession, setAppMode, addNotification]);

    const handleSyncFlashcardReviews = useCallback(async () => {
        if (!isOnline) {
            useToastStore.getState().showToast('You must be online to sync flashcard reviews.', 'info');
            return;
        }
        const pendingCount = useFlashcardStore.getState().pendingFlashcardReviews.length;
        if (pendingCount === 0) return;

        try {
            const { synced, remaining } = await syncPendingFlashcardReviews();
            if (synced === 0 && remaining > 0) {
                useToastStore.getState().showToast('Failed to sync flashcard reviews. Please try again.', 'error');
                return;
            }
            if (remaining === 0) {
                addNotification(`${synced} flashcard review(s) synced successfully!`);
            } else if (synced > 0) {
                addNotification(`Synced ${synced} of ${synced + remaining} flashcard review(s). Retry to sync the rest.`);
            }
        } catch (error) {
            console.error('Error syncing flashcard reviews:', error);
            useToastStore.getState().showToast('Failed to sync flashcard reviews. Please try again.', 'error');
        }
    }, [isOnline, addNotification]);

    const handleDeleteBundle = useCallback(async (bundleId: string) => {
        const bundle = offlineBundles.find(b => b.bundleId === bundleId);
        const bundleName = bundle?.displayName || bundle?.groupName;
        if (!(await confirmDialog(planDeleteOfflineBundleConfirm({ name: bundleName })))) return;

        updateOfflineBundles(prev => prev.filter(b => b.bundleId !== bundleId));

        if (currentUser) {
            deleteOfflineBundle(currentUser.id, bundleId).then(() => {
                console.log('[Offline Sync] Bundle deleted from cloud:', bundleId);
            }).catch(error => {
                console.error('[Offline Sync] Failed to delete bundle from cloud:', error);
            });
        }
    }, [currentUser, offlineBundles, updateOfflineBundles]);

    const handleSyncResults = useCallback(async () => {
        if (!isOnline) {
            useToastStore.getState().showToast('You must be online to sync results.', 'info');
            return;
        }
        if (pendingSyncResults.length === 0 || !currentUser) return;

        const total = pendingSyncResults.length;
        const { synced, remaining, gamification } = await syncPendingTestResults(currentUser.id);

        if (synced === 0) {
            useToastStore.getState().showToast('Failed to sync results. Please try again.', 'error');
            return;
        }

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
        }

        if (remaining === 0) {
            addNotification(`${synced} offline result(s) synced successfully!`);
        } else {
            addNotification(`Synced ${synced} of ${total} result(s). Retry to sync the rest.`);
        }
    }, [isOnline, pendingSyncResults, currentUser, setCurrentUser, addNotification]);

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
            useToastStore.getState().showToast(`A bundle for "${imported.groupName}" with ${imported.questions.length} questions already exists.`, 'info');
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
        isDownloadingBundle,
        handleDownloadForOffline,
        handleStartOfflineSession,
        handleDeleteBundle,
        handleSyncResults,
        handleSyncFlashcardReviews,
        handleImportBundle,
        handleRenameBundle,
    };
}
