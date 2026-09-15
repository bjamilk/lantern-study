/**
 * Handler barrel for the test/study session lifecycle on web: building a session from a
 * group's question messages, answering and navigating, submitting (online and offline),
 * pausing/resuming/abandoning drafts, and retakes.
 *
 * Exports: useTestHandlers({ addNotification }) — handlers wired into App.tsx and the
 *  test runner / review screens, plus `isSubmittingTest` for button disabling.
 * Touches: testStore (activeTestSession, activeStudySession, userQuestionStats, testResults,
 *  pendingSyncResults, pausedSessions), uiStore (appMode, selectedChat, activeTestResult,
 *  isOnline), authStore, groupStore (messages = the question pool), budgetStore (wallet),
 *  companionStore (post-test debrief); services/supabase (createTestSession,
 *  createTestResult, upsertUserQuestionStat, createNotification, fetchDashboardSummary,
 *  fetchTestResults), services/testDrafts (fetch/complete/abandon/fetchPaused),
 *  utils/sessionDraftSync (autosave), localStorage via loadQuestionVisibilityMode.
 * Gotchas:
 *  - Questions are chat Messages: `type` is the MessageType ('QUESTION'), the real kind is in
 *    `questionType`. Every filter here reads `questionType` — never `type`.
 *  - `config.timerDuration` is SECONDS. The end time is `start + timerDuration * 1000`, and
 *    the "only a graded test gets a clock" rule is re-implemented in each launch path
 *    (handleTestSubmit here, buildRetakeSession for retakes, the config sheet, deep links).
 *  - Graded tests draw only from the verified bank (`isQuestionTestable`); study mode honours
 *    the per-device question-visibility preference instead.
 *  - Handlers that can run in the same tick as another store write (answer, navigate) read
 *    `useTestStore.getState()` rather than the closed-over session.
 *  - Draft ids: a session created offline keeps a `local-` id; every server call is guarded
 *    by a `startsWith('local-')` check.
 */
import { useCallback, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { AppMode, TestConfig, TestQuestion, UserAnswerRecord, TestSessionData, StudySessionData, TestResult, UserStats, UserQuestionStats, Message } from '../types';
import { useAuthStore } from '../stores/authStore';
import { useCompanionStore } from '../stores/companionStore';
import { useGroupStore } from '../stores/groupStore';
import { useUIStore } from '../stores/uiStore';
import { useTestStore } from '../stores/testStore';
import { useBudgetStore } from '../stores/budgetStore';
import { checkAndAwardBadges, isQuestionTestable, checkAnswerIsCorrect, createShuffledQuestionSet, shuffleQuestionOptionsOnly, shuffleArray, lockedIdsAfterLeaving } from '../utils/helpers';
import { BADGE_DEFINITIONS } from '../gamification';
import {
    createTestSession, createTestResult, upsertUserQuestionStat,
    createNotification, fetchDashboardSummary, fetchTestResults,
} from '../services/supabase';
import {
    abandonTestDraft,
    completeTestDraft,
    fetchPausedSessions,
    fetchTestDraft,
} from '../services/testDrafts';
import { syncGamificationProgress } from '../services/gamificationStreak';
import { confirmDialog } from '../stores/confirmStore';
import {
    planCancelSessionConfirm,
    planDiscardActiveSessionConfirm,
    planDiscardSavedSessionConfirm,
} from '../utils/destructiveConfirm';
import {
    formatActivityLocalDate,
    loadQuestionVisibilityMode,
    messagePassesStudyQuestionPool,
} from '@lantern/shared/utils';
import { trackQuestProgress } from '../services/questProgress';
import { trackStudyActivity } from '../services/studyActivity';
import { trackTestStarted, trackTestCompleted } from '../services/productAnalytics';
import { normalizeUserSettings } from '@lantern/shared/settings';
import { buildRetakeSession, retakeTitle } from '../utils/testRetake';
import { appNavigate } from '../utils/appNavigation';
import {
    bindDraftIdToActiveSession,
    cancelScheduledSessionDraftAutosave,
    ensureSessionDraft,
    flushActiveSessionDraft,
    scheduleSessionDraftAutosave,
} from '../utils/sessionDraftSync';


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
        userQuestionStats, setUserQuestionStats, updateTestResults, setTestResults,
        addPendingSyncResult,
        setPausedSessions, removePausedSession,
    } = useTestStore();

    const isSubmittingTestRef = useRef(false);
    const [isSubmittingTest, setIsSubmittingTest] = useState(false);
    // Guards the "discard active session?" confirm so a second Start tap while the
    // dialog is open cannot open a second dialog or race session construction.
    const startConfirmPendingRef = useRef(false);

    // ── Launch: build a session from the selected group's question messages ────
    // Triggered by the test-config sheet's Start. Gathers messages from the group plus any
    // selected subgroups, filters them into a candidate pool, shuffles per the user's study
    // settings, and pushes the session into the store + appMode. Game mode is not handled
    // here (useGameHandlers owns it).
    const handleTestSubmit = useCallback(async (config: Omit<TestConfig, 'questionIds' | 'groupId'>, mode: 'test' | 'study' | 'game', useSpacedRepetition: boolean, selectedSubgroupIDs: string[]) => {
        // Only block when a session is already open in the runner (not merely paused in the list).
        if (
            (appMode === AppMode.TEST_ACTIVE && activeTestSession) ||
            (appMode === AppMode.STUDY_ACTIVE && activeStudySession)
        ) {
            if (startConfirmPendingRef.current) return;
            startConfirmPendingRef.current = true;
            let discard: boolean;
            try {
                discard = await confirmDialog(planDiscardActiveSessionConfirm());
            } finally {
                startConfirmPendingRef.current = false;
            }
            if (!discard) return;
            setActiveTestSession(null);
            setActiveStudySession(null);
        }

        if (!selectedChat || selectedChat.chatType !== 'group') return;

        // game mode is handled in useGameHandlers
        if (mode === 'game') return;
    
        const sourceGroupIds = [selectedChat.id, ...selectedSubgroupIDs];
        let candidateQuestions: Message[] = [];
        let finalSelectedQuestions: Message[] = [];
        const allSourceMessages = [...new Set(sourceGroupIds)].flatMap(id => messages[id] || []);
        const visibilityMode =
            typeof localStorage !== 'undefined'
                ? loadQuestionVisibilityMode((key) => localStorage.getItem(key))
                : 'all';
        // Graded tests always use verified bank; study respects visibility preference.
        const allTestableQuestions =
            mode === 'study'
                ? allSourceMessages.filter((msg) =>
                      messagePassesStudyQuestionPool(msg, visibilityMode)
                  )
                : allSourceMessages.filter(isQuestionTestable);
    
        // The type/tag filter the student picked in the config sheet. One
        // predicate, applied by every selection strategy below.
        // FIXED (F9): the spaced-repetition branch used to skip this entirely,
        // so ticking "spaced repetition" silently discarded the question types
        // and tags chosen in the same sheet — the session came back full of
        // types the student had just unticked.
        const matchesConfigFilters = (msg: Message) =>
            (config.allowedQuestionTypes.length === 0 ||
                config.allowedQuestionTypes.includes(msg.questionType!)) &&
            (!config.selectedTags ||
                config.selectedTags.length === 0 ||
                !!msg.tags?.some(tag => config.selectedTags!.includes(tag)));

        // Three mutually exclusive selection strategies, all of them filtered first:
        //  1. spaced repetition — only questions never attempted, or whose incorrect attempts
        //     are non-zero and at least equal to the correct ones.
        //  2. focusOnNew — unattempted questions, recent (7 days) first, never falling back
        //     to already-answered ones even if that leaves the session short.
        //  3. default — a shuffled slice.
        if (useSpacedRepetition) {
            candidateQuestions = allTestableQuestions.filter((q: Message) => {
                if (!matchesConfigFilters(q)) return false;
                const stats = userQuestionStats[q.id];
                if (!stats) return true; // Never attempted = needs study
                return stats.incorrectAttempts > 0 && stats.incorrectAttempts >= stats.correctAttempts;
            });
        } else if (config.focusOnNew) {
            const addedIds = new Set<string>();
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

            const baseFilteredQuestions = allTestableQuestions.filter(matchesConfigFilters);
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
            candidateQuestions = allTestableQuestions.filter(matchesConfigFilters);
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

        // Shuffle policy comes from user settings: whole-set shuffle (optionally also
        // shuffling each question's options), options-only, or neither — in which case the
        // questions are only stamped with a 1-based questionNumber.
        const studySettings = normalizeUserSettings(currentUser?.settings).study;
        const testQuestions: TestQuestion[] = studySettings.shuffleQuestions
            ? createShuffledQuestionSet(selectedQuestions, { shuffleOptions: studySettings.shuffleOptions })
            : studySettings.shuffleOptions
                ? shuffleQuestionOptionsOnly(selectedQuestions)
                : selectedQuestions.map((q, i) => ({ ...q, questionNumber: i + 1 })) as TestQuestion[];
    
        const sessionConfig: TestConfig = {
            ...config,
            groupId: selectedChat.id,
            groupName: selectedChat.name,
            questionIds: selectedQuestions.map(q => q.id),
        };
    
        // Time-limit rule (duplicated in buildRetakeSession and the other launchers):
        // only a graded test gets a clock, and timerDuration is SECONDS — hence * 1000.
        const startTime = new Date();
        let endTime: Date | undefined = undefined;
        if (mode === 'test' && config.timerDuration) {
            endTime = new Date(startTime.getTime() + config.timerDuration * 1000);
        }
    
        const sessionKind = mode === 'study' ? 'study' as const : 'test' as const;
        const sessionData: TestSessionData = {
            config: sessionConfig,
            questions: testQuestions,
            userAnswers: {},
            currentQuestionIndex: 0,
            startTime,
            endTime,
            sessionKind,
            status: 'in_progress',
            title: sessionConfig.groupName || (sessionKind === 'study' ? 'Study session' : 'Test'),
            lockedQuestionIds: [],
        };

        if (mode === 'test') {
            setActiveTestSession(sessionData);
            setAppMode(AppMode.TEST_ACTIVE);
        } else {
            setActiveStudySession(sessionData);
            setAppMode(AppMode.STUDY_ACTIVE);
        }

        // The server draft is created AFTER the session is already on screen, so the user can
        // start answering during the round trip; the id is then merged onto the latest store
        // session. Offline, ensureSessionDraft yields a `local-` id instead.
        void ensureSessionDraft(sessionData, sessionKind).then((drafted) => {
            // Merge onto latest store state — never clobber answers/index chosen during create latency.
            const bound = bindDraftIdToActiveSession(sessionKind, drafted);
            if (!bound) return;
            if (sessionKind === 'test') setActiveTestSession(bound);
            else setActiveStudySession(bound);
        });

        trackTestStarted({
            mode,
            questionCount: testQuestions.length,
            groupId: sessionConfig.groupId,
        });

        closeModal('testConfig');
    }, [appMode, activeTestSession, activeStudySession, selectedChat, messages, userQuestionStats, currentUser, setActiveTestSession, setActiveStudySession, setAppMode, closeModal]);
    
    // ── In-session: answering, navigation, bookmarks ──────────────────────────
    // Records an answer for the active session. In a graded test it only stores the answer
    // (grading happens at submit); in study mode, when the answer is revealed (explicitly or
    // via showExplanationsImmediately) it grades immediately and — once per question, first
    // attempt only — increments the per-question stats locally and upserts them.
    const handleUpdateAnswer = useCallback((questionId: string, answerData: Partial<Omit<UserAnswerRecord, 'questionId'>> & { revealAnswer?: boolean }) => {
        const { revealAnswer, ...answerFields } = answerData;
        const showExplanationsImmediately = normalizeUserSettings(currentUser?.settings).study.showExplanationsImmediately;
        const shouldReveal = revealAnswer === true || showExplanationsImmediately;

        // Read latest store state so answer + Next in the same tick cannot clobber each other.
        const store = useTestStore.getState();
        const session =
            appMode === AppMode.TEST_ACTIVE
                ? store.activeTestSession
                : appMode === AppMode.STUDY_ACTIVE
                    ? store.activeStudySession
                    : null;
        if (!session) return;

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
                    const latestStats = useTestStore.getState().userQuestionStats;
                    const currentStats = latestStats[questionId] || {
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
                        ...latestStats,
                        [questionId]: newStats
                    });

                    upsertUserQuestionStat(currentUser.id, questionId, newStats).catch(error => {
                        console.error('Error saving study mode question stat:', error);
                    });
                    trackStudyActivity('study_question', 1);
                }
            }
        }

        const updated: TestSessionData = {
            ...session,
            userAnswers: {
                ...session.userAnswers,
                [questionId]: updatedAnswer,
            },
        };

        if (appMode === AppMode.TEST_ACTIVE) {
            setActiveTestSession(updated);
            scheduleSessionDraftAutosave();
        } else if (appMode === AppMode.STUDY_ACTIVE) {
            setActiveStudySession(updated as StudySessionData);
            scheduleSessionDraftAutosave();
        }
    }, [appMode, currentUser, setActiveTestSession, setActiveStudySession, setUserQuestionStats]);
    
    const handleChangeQuestion = useCallback((newIndex: number) => {
        // Always base navigation on the latest store session (answers may have just been written).
        const store = useTestStore.getState();
        if (appMode === AppMode.TEST_ACTIVE && store.activeTestSession) {
            const session = store.activeTestSession;
            if (newIndex < 0 || newIndex >= session.questions.length) return;

            // Exam lock: refuse navigation to a locked question, and lock the question we
            // leave once it has been answered. This is the single choke point for every
            // navigation path (Previous, arrows, palette), so it cannot be bypassed.
            if (session.config.lockAnsweredQuestions) {
                const targetId = session.questions[newIndex]?.id;
                if (targetId && (session.lockedQuestionIds ?? []).includes(targetId)) return;

                const leavingId = session.questions[session.currentQuestionIndex]?.id;
                const nextLocked = lockedIdsAfterLeaving({
                    lockEnabled: true,
                    lockedIds: session.lockedQuestionIds,
                    leavingQuestionId: leavingId,
                    leavingAnswer: leavingId ? session.userAnswers[leavingId] : undefined,
                });
                setActiveTestSession({ ...session, currentQuestionIndex: newIndex, lockedQuestionIds: nextLocked });
                scheduleSessionDraftAutosave();
                return;
            }

            setActiveTestSession({ ...session, currentQuestionIndex: newIndex });
            scheduleSessionDraftAutosave();
        } else if (appMode === AppMode.STUDY_ACTIVE && store.activeStudySession) {
            const session = store.activeStudySession;
            if (newIndex >= 0 && newIndex < session.questions.length) {
                setActiveStudySession({ ...session, currentQuestionIndex: newIndex });
                scheduleSessionDraftAutosave();
            }
        }
    }, [appMode, setActiveTestSession, setActiveStudySession]);
    
    // Flips the bookmark flag on the answer record for the current session.
    // FIXED (F9): this used to read the closed-over `activeTestSession` /
    // `activeStudySession` instead of `useTestStore.getState()`, so a bookmark
    // tapped in the same tick as an answer or a page change wrote a stale
    // session back and silently dropped that answer or index change. It now
    // reads the live store like handleUpdateAnswer/handleChangeQuestion, and
    // schedules the same draft autosave they do so the flag survives a resume.
    const handleToggleBookmark = useCallback((questionId: string) => {
        const store = useTestStore.getState();
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

        if (appMode === AppMode.TEST_ACTIVE && store.activeTestSession) {
            const updated = toggleBookmark(store.activeTestSession);
            if (updated) {
                setActiveTestSession(updated);
                scheduleSessionDraftAutosave();
            }
        } else if (appMode === AppMode.STUDY_ACTIVE && store.activeStudySession) {
            const updated = toggleBookmark(store.activeStudySession);
            if (updated) {
                setActiveStudySession(updated as StudySessionData);
                scheduleSessionDraftAutosave();
            }
        }
    }, [appMode, setActiveTestSession, setActiveStudySession]);

    // ── Submit ────────────────────────────────────────────────────────────────
    // Grades every question locally (unanswered counts as incorrect), then forks:
    //  - OFFLINE (session flagged offline, or isOnline false): the result is pushed to the
    //    pending-sync queue and into the local history; nothing is sent.
    //  - ONLINE: an existing server draft is completed, otherwise a session+result pair is
    //    created; the local history is updated optimistically and then reconciled against
    //    the dashboard summary. Any throw here leaves the active session intact so the
    //    user can retry without losing answers.
    // The ref guard (not the state flag) is what actually blocks a double submit — state
    // updates are async and would let a second tap through.
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

        // Marketplace question bank: queue the attempt for its leaderboard.
        // These sessions are usually finished offline, so the post is deferred
        // to the pending-results sync rather than attempted here.
        void import('../services/pendingQuestionBankScores').then(
            ({ enqueueScoreForBundle, flushPendingQuestionBankScores }) => {
                enqueueScoreForBundle(
                    finalSessionData.config?.bundleId,
                    correctAnswersCount,
                    finalSessionData.questions.length
                );
                // Opportunistic: if the device happens to be online, don't make
                // the user wait for a sync to see themselves on the board.
                if (isOnline) void flushPendingQuestionBankScores();
            }
        );

        try {
            if (finalSessionData.isOffline || !isOnline) {
                // ── OFFLINE PATH ──────────────────────────────────────────
                // Store the result locally and sync it to the server later
                // when the user is back online (via "Sync Results" in Offline Mode).
                addPendingSyncResult(result);
                updateTestResults(prev => [result, ...prev]);

                // FIXED (F9): `{ ...userQuestionStats }` is a SHALLOW copy, so
                // `stats.correctAttempts++` used to mutate the per-question
                // objects already held in the store — consumers comparing by
                // reference saw no change and showed stale counters until some
                // other render, and there was no pre-submit snapshot to roll
                // back to. Each touched entry is now replaced with a NEW object.
                // Same fix in the online path below.
                const newUserQuestionStats: UserQuestionStats = { ...userQuestionStats };
                Object.values(finalUserAnswers).forEach((answer: UserAnswerRecord) => {
                    const questionId = answer.questionId;
                    const previous = newUserQuestionStats[questionId] || { correctAttempts: 0, incorrectAttempts: 0, lastAttempted: '' };
                    const stats = { ...previous };
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
                trackStudyActivity('test', 1, { scorePercent: Math.round(score) });
                trackTestCompleted({ score, totalQuestions: finalSessionData.questions.length, offline: true });
                addNotification(`Offline test complete! Score: ${Math.round(score)}%. Your result will sync when you go online.`);
            } else {
                // ── ONLINE PATH ───────────────────────────────────────────
                cancelScheduledSessionDraftAutosave();
                let savedSessionId = finalSessionData.id;
                let saved: any;

                // A real (non-`local-`) draft id means the session already exists server-side,
                // so complete it in place; otherwise create the session and its result now.
                if (savedSessionId && !String(savedSessionId).startsWith('local-')) {
                    saved = await completeTestDraft(savedSessionId, {
                        userAnswers: finalUserAnswers,
                        score,
                        correctAnswersCount,
                        totalQuestions: finalSessionData.questions.length,
                        activityDate: formatActivityLocalDate(new Date()),
                        config: {
                            groupId: finalSessionData.config?.groupId,
                            groupName: finalSessionData.config?.groupName,
                        },
                    });
                    savedSessionId = saved?.session?.id || savedSessionId;
                } else {
                    const sessionData = {
                        config: finalSessionData.config,
                        questions: finalSessionData.questions,
                        user_answers: finalUserAnswers,
                        start_time: finalSessionData.startTime.toISOString(),
                        end_time: finalSessionData.endTime?.toISOString(),
                        is_offline: false,
                        session_kind: 'test' as const,
                        status: 'completed' as const,
                    };
                    const created = await createTestSession(sessionData, currentUser.id);
                    savedSessionId = created.id;
                    saved = await createTestResult({
                        session_id: created.id,
                        score,
                        correct_answers_count: correctAnswersCount,
                        total_questions: finalSessionData.questions.length,
                        activityDate: formatActivityLocalDate(new Date()),
                    });
                }

                if (savedSessionId) removePausedSession(savedSessionId);

            // Optimistic chart update, then refresh lean history so Group
            // Performance matches the server after cache invalidation.
            const persistedResult: TestResult = {
                ...result,
                id: savedSessionId || result.id,
                session: {
                    ...result.session,
                    id: savedSessionId || result.session.id,
                },
            };
            updateTestResults(prev => {
                const withoutDup = prev.filter(
                    (r) => r.id !== persistedResult.id && r.session?.id !== persistedResult.session.id
                );
                return [persistedResult, ...withoutDup];
            });
            void (async () => {
                try {
                    const summary = await fetchDashboardSummary();
                    const cloudResults = Array.isArray(summary?.testResults)
                        ? summary.testResults
                        : await fetchTestResults(currentUser.id, { limit: 500, lean: true });
                    if (!Array.isArray(cloudResults) || cloudResults.length === 0) return;
                    const cloudIds = new Set(
                        cloudResults.map((r: TestResult) => r.id || r.session?.id).filter(Boolean)
                    );
                    if (!cloudIds.has(persistedResult.id) && !cloudIds.has(persistedResult.session.id)) {
                        setTestResults([persistedResult, ...cloudResults]);
                    } else {
                        setTestResults(cloudResults as TestResult[]);
                    }
                } catch (err) {
                    console.warn('Failed to refresh dashboard test results after submit:', err);
                }
            })();

            const walletBalance = (saved as { walletBalance?: number })?.walletBalance;
            if (typeof walletBalance === 'number') {
                useBudgetStore.getState().setWalletBalance(walletBalance);
            }

            // Points/badges/stats normally come back on the save response. Only when the
            // server omitted them do we pay for a separate sync round trip; a failure there
            // is logged and ignored (the submit itself already succeeded).
            const gamification = (saved as { gamification?: { points: number; badges: typeof currentUser.badges; stats: UserStats; awardedBadges?: typeof currentUser.badges } })?.gamification
                || (saved as { result?: { gamification?: { points: number; badges: typeof currentUser.badges; stats: UserStats; awardedBadges?: typeof currentUser.badges } } })?.result?.gamification;
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
        
            // FIXED (F9): see the offline path above — the per-question stat
            // object is cloned before it is incremented, so the store's copy is
            // never mutated in place.
            const newUserQuestionStats: UserQuestionStats = { ...userQuestionStats };
            Object.values(finalUserAnswers).forEach((answer: UserAnswerRecord) => {
                const questionId = answer.questionId;
                const previous = newUserQuestionStats[questionId] || { correctAttempts: 0, incorrectAttempts: 0, lastAttempted: '' };
                const stats = { ...previous };
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
            
                // FIXED (F9): the review screen used to be handed `result` (the
                // local uuid) rather than `persistedResult` (the server session
                // id just written into the history list), so the reviewed
                // result carried an id that existed nowhere server-side and did
                // not match its own row in `testResults`.
                setActiveTestResult(persistedResult);
                setAppMode(AppMode.TEST_REVIEW);
                setActiveTestSession(null);
                trackQuestProgress('complete_test');
                trackTestCompleted({ score, totalQuestions: finalSessionData.questions.length });
                // Study activity recorded server-side with createTestResult
                // Post-test debrief via Lantern companion
                // Weak-tag extraction for the companion debrief: per-tag accuracy over the
                // just-finished test, keeping tags with >=2 questions and <60% correct,
                // worst three first. Untagged questions are bucketed as 'General'.
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
                        // Typed so the notification list colour-codes it into
                        // the blue Test family instead of the generic bell.
                        type: 'test_result',
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
        }, [activeTestSession, currentUser, userQuestionStats, isOnline, setCurrentUser, updateTestResults, setTestResults, addPendingSyncResult, setUserQuestionStats, setActiveTestResult, setActiveTestSession, setAppMode, addNotification, removePausedSession]);
    
    // ── Session lifecycle: end / cancel / pause / resume ──────────────────────
    // Study sessions are not graded, so ending one just marks the server draft complete
    // (best effort — offline or a `local-` id skips the call) and returns to chat.
    const handleEndStudySession = useCallback(async () => {
        cancelScheduledSessionDraftAutosave();
        const session = activeStudySession;
        if (session?.id && !String(session.id).startsWith('local-') && isOnline) {
            try {
                await completeTestDraft(session.id, {
                    userAnswers: session.userAnswers,
                    activityDate: formatActivityLocalDate(new Date()),
                });
                removePausedSession(session.id);
            } catch (error) {
                console.error('Failed to complete study draft', error);
            }
        }
        setActiveStudySession(null);
        setAppMode(AppMode.CHAT);
    }, [activeStudySession, isOnline, setActiveStudySession, setAppMode, removePausedSession]);

    // Destructive discard of the in-progress session, behind a confirm that is itself
    // re-entrancy guarded. The server draft is abandoned (fire-and-forget) and removed from
    // the paused list. A session launched from a note returns to that note, not to chat.
    const cancelConfirmPendingRef = useRef(false);
    const handleCancelActiveSession = useCallback(async () => {
        if (cancelConfirmPendingRef.current) return;
        cancelConfirmPendingRef.current = true;
        let cancel: boolean;
        try {
            cancel = await confirmDialog(planCancelSessionConfirm());
        } finally {
            cancelConfirmPendingRef.current = false;
        }
        if (!cancel) return;
        cancelScheduledSessionDraftAutosave();
        const session = activeTestSession || activeStudySession;
        if (session?.id && !String(session.id).startsWith('local-')) {
            void abandonTestDraft(session.id).then(() => removePausedSession(session.id!));
        } else if (session?.id) {
            removePausedSession(session.id);
        }
        setActiveTestSession(null);
        setActiveStudySession(null);
        const noteId = session?.config?.sourceNoteId;
        if (typeof noteId === 'string' && noteId) {
            appNavigate(`/notes/${noteId}`);
            return;
        }
        setAppMode(AppMode.CHAT);
    }, [activeTestSession, activeStudySession, setActiveTestSession, setActiveStudySession, setAppMode, removePausedSession]);

    // Pause freezes the clock by converting the absolute endTime into `remainingTime`
    // SECONDS (never negative), flips status to 'paused', and flushes the draft before
    // navigating away. Study sessions have no clock, so only the status changes.
    const handlePauseSession = useCallback(() => {
        cancelScheduledSessionDraftAutosave();
        let remaining: number | undefined;
        if (appMode === AppMode.TEST_ACTIVE && activeTestSession?.endTime) {
            const now = new Date().getTime();
            const endTimeMs = new Date(activeTestSession.endTime).getTime();
            remaining = Math.max(0, Math.round((endTimeMs - now) / 1000));
            setActiveTestSession({ ...activeTestSession, remainingTime: remaining, status: 'paused' });
        } else if (activeStudySession) {
            setActiveStudySession({ ...activeStudySession, status: 'paused' });
        }
        void flushActiveSessionDraft({ status: 'paused', remainingTime: remaining }).finally(() => {
            setAppMode(AppMode.CHAT);
        });
    }, [appMode, activeTestSession, activeStudySession, setActiveTestSession, setActiveStudySession, setAppMode]);

    // Resume re-arms the clock as `now + remainingTime * 1000` (the inverse of pause) and
    // clears remainingTime so the runner goes back to reading endTime.
    // FIXED (F9): the test branch was gated on `remainingTime != null`, so an
    // UNTIMED paused test matched neither branch — its status stayed 'paused'
    // and its paused-list entry was never removed, while appMode still switched
    // into the runner. The branch is now gated on the SESSION, and only the
    // clock re-arm is conditional on there being a clock to re-arm.
    const handleResumeSession = useCallback((mode: AppMode) => {
        if (mode === AppMode.TEST_ACTIVE && activeTestSession) {
            const hasClock = activeTestSession.remainingTime != null;
            setActiveTestSession({
                ...activeTestSession,
                ...(hasClock
                    ? {
                        endTime: new Date(Date.now() + activeTestSession.remainingTime! * 1000),
                        remainingTime: undefined,
                    }
                    : {}),
                status: 'in_progress',
            });
            if (activeTestSession.id) removePausedSession(activeTestSession.id);
        } else if (mode === AppMode.STUDY_ACTIVE && activeStudySession) {
            setActiveStudySession({ ...activeStudySession, status: 'in_progress' });
            if (activeStudySession.id) removePausedSession(activeStudySession.id);
        }
        setAppMode(mode);
        void flushActiveSessionDraft({ status: 'in_progress' });
    }, [activeTestSession, activeStudySession, setActiveTestSession, setActiveStudySession, setAppMode, removePausedSession]);

    // ── Paused-session list (server drafts) ───────────────────────────────────
    // Offline is a silent no-op: the list is server-owned, so there is nothing to show and
    // no reason to clear what is already cached.
    const refreshPausedSessions = useCallback(async () => {
        if (!currentUser?.id || !isOnline) return;
        try {
            const list = await fetchPausedSessions({ limit: 100 });
            setPausedSessions(list);
        } catch (error) {
            console.error('Failed to load paused sessions', error);
        }
    }, [currentUser?.id, isOnline, setPausedSessions]);

    // Resumes from the list rather than from memory: refetch the draft, re-arm the clock
    // from remainingTime (tests only), and clear whichever session slot is not in use so the
    // two runners can never both be populated. A failed fetch means the draft was completed
    // or discarded elsewhere, so the list is refreshed instead of retried.
    const handleResumePausedSession = useCallback(async (sessionId: string) => {
        try {
            let session = await fetchTestDraft(sessionId);
            const kind = session.sessionKind === 'study' ? 'study' : 'test';
            if (typeof session.remainingTime === 'number' && kind === 'test') {
                session = {
                    ...session,
                    endTime: new Date(Date.now() + session.remainingTime * 1000),
                    remainingTime: undefined,
                    status: 'in_progress',
                };
            } else {
                session = { ...session, status: 'in_progress' };
            }
            if (kind === 'test') {
                setActiveTestSession(session);
                setActiveStudySession(null);
                setAppMode(AppMode.TEST_ACTIVE);
            } else {
                setActiveStudySession(session);
                setActiveTestSession(null);
                setAppMode(AppMode.STUDY_ACTIVE);
            }
            removePausedSession(sessionId);
            void flushActiveSessionDraft({ status: 'in_progress' });
        } catch (error) {
            console.error('Failed to resume session', error);
            alert('Could not resume that session. It may have been completed or discarded.');
            void refreshPausedSessions();
        }
    }, [setActiveTestSession, setActiveStudySession, setAppMode, removePausedSession, refreshPausedSessions]);

    // Discards a saved draft from the list; also clears the active session if the discarded
    // id happens to be the one currently loaded. `local-` drafts never existed server-side.
    const handleAbandonPausedSession = useCallback(async (sessionId: string) => {
        if (!(await confirmDialog(planDiscardSavedSessionConfirm()))) return;
        try {
            if (!String(sessionId).startsWith('local-')) {
                await abandonTestDraft(sessionId);
            }
            removePausedSession(sessionId);
            if (activeTestSession?.id === sessionId) setActiveTestSession(null);
            if (activeStudySession?.id === sessionId) setActiveStudySession(null);
        } catch (error) {
            console.error('Failed to abandon session', error);
            alert('Could not discard that session. Please try again.');
        }
    }, [removePausedSession, activeTestSession, activeStudySession, setActiveTestSession, setActiveStudySession]);

    // ── Relaunch paths ────────────────────────────────────────────────────────
    const handleRetakeTest = useCallback((sessionData: TestSessionData) => {
        // One rule for every launch: `buildRetakeSession` re-shuffles, re-arms
        // the clock from the config and reads the attempt kind back off it —
        // so a test built as practice is sat as practice from Retake too, not
        // only from its `/study/tests/:testId` link. Hardcoding 'test' here was
        // how the review's Retake turned a practice test into an untimed exam.
        const newSession: TestSessionData = {
            ...buildRetakeSession(
                {
                    kind: 'ready',
                    questions: sessionData.questions,
                    config: sessionData.config,
                    title: retakeTitle(sessionData),
                },
                { shuffle: (questions) => createShuffledQuestionSet(questions) }
            ),
            isOffline: sessionData.isOffline,
        };
        setActiveTestResult(null);
        if (newSession.sessionKind === 'study') {
            setActiveStudySession(newSession as StudySessionData);
            setAppMode(AppMode.STUDY_ACTIVE);
            void ensureSessionDraft(newSession, 'study').then((drafted) => {
                const bound = bindDraftIdToActiveSession('study', drafted);
                if (bound) setActiveStudySession(bound as StudySessionData);
            });
            return;
        }
        setActiveTestSession(newSession);
        setAppMode(AppMode.TEST_ACTIVE);
        void ensureSessionDraft(newSession, 'test').then((drafted) => {
            const bound = bindDraftIdToActiveSession('test', drafted);
            if (bound) setActiveTestSession(bound);
        });
    }, [setActiveTestSession, setActiveStudySession, setActiveTestResult, setAppMode]);
    
    // "Practice the ones you missed" from the review screen. Always a STUDY session — the
    // config it synthesises carries no timerDuration and no type filter, so the time-limit
    // rule above never applies to it.
    const handlePracticeFailedQuestions = useCallback((failedQuestions: TestQuestion[]) => {
        if (!selectedChat || selectedChat.chatType !== 'group' || failedQuestions.length === 0) return;
    
        const sessionConfig: TestConfig = {
            groupId: selectedChat.id,
            numberOfQuestions: failedQuestions.length,
            questionIds: failedQuestions.map(q => q.id),
            allowedQuestionTypes: [],
            groupName: selectedChat.name,
        };
    
        const shuffledFailedQuestions = createShuffledQuestionSet(failedQuestions);

        const sessionData: StudySessionData = {
            config: sessionConfig,
            questions: shuffledFailedQuestions,
            userAnswers: {},
            currentQuestionIndex: 0,
            startTime: new Date(),
            sessionKind: 'study',
            status: 'in_progress',
            title: selectedChat.name || 'Study session',
        };
    
        setActiveStudySession(sessionData);
        setActiveTestResult(null);
        setAppMode(AppMode.STUDY_ACTIVE);
        void ensureSessionDraft(sessionData, 'study').then((drafted) => {
            const bound = bindDraftIdToActiveSession('study', drafted);
            if (bound) setActiveStudySession(bound);
        });
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
        handleResumePausedSession,
        handleAbandonPausedSession,
        refreshPausedSessions,
        flushActiveSessionDraft,
        handleRetakeTest,
        handlePracticeFailedQuestions,
        isSubmittingTest,
    };
}
