/**
 * The signed-in bootstrap fan-out, and the debounced write-back that follows it.
 *
 * Two effects: everything a freshly signed-in session has to load (groups, DMs,
 * notifications, preferences, decks, flashcards, test results, question stats,
 * offline bundles, budget, transactions, wallet), and the 1.5-second trailing
 * save of budget extras once that has landed.
 *
 * Exports: useBootstrapFanout({ currentUser, authTokenReady, isAuthLoading,
 *  dataLoaded, setDataLoaded, setBootstrapLoad, refreshDashboardGamification }) → void.
 * Touches: most of services/supabase, services/budgetApi, services/budgetExtrasSync,
 *  and the group / test / flashcard / budget / notes / toast stores.
 * Gotchas:
 *  - `dataLoaded` is what makes this run once per account; the sign-out paths
 *    reset it, and that is how a second account re-bootstraps.
 *  - The two waves are flattened into one fixed-order `results` array, and the
 *    `results[n]` indices below are POSITIONAL — they must stay in step with
 *    that list.
 *  - Every apply is gated on `shouldApplyBootstrap()` (a cancelled flag plus a
 *    live store id check), so a slow fan-out for user A cannot write into
 *    user B's session after a switch.
 *  - A failed domain degrades that domain only; 'error' still counts as settled,
 *    so one dead endpoint cannot hold the boot spinner open.
 *  - The extras save is gated on `dataLoaded` so bootstrap's own hydration does
 *    not immediately echo back up, and it never writes walletBalance, which is
 *    server-owned.
 *
 * Extracted verbatim from hooks/useAppEffects.ts, comments included; the composer
 * calls this where the effects registered (apps/web/src/useAppEffects.surface.test.ts).
 */
import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { OfflineSessionBundle, Transaction, TransactionType, User } from '../../types';
import { useAuthStore } from '../../stores/authStore';
import { useBudgetStore } from '../../stores/budgetStore';
import { useFlashcardStore } from '../../stores/flashcardStore';
import { useGroupStore } from '../../stores/groupStore';
import { useNotesStore } from '../../stores/notesStore';
import { useTestStore } from '../../stores/testStore';
import { useToastStore } from '../../stores/toastStore';
import { useUIStore } from '../../stores/uiStore';
import {
    ensureAuthTokenReady,
    fetchGroups, fetchGroupUnreadCounts,
    fetchDmThreads, fetchDMUnreadCounts,
    fetchNotifications,
    fetchUserPreferences, saveUserPreferences,
    fetchDecks, fetchAllFlashcards, mapDecksFromApi,
    fetchTestResults, fetchUserQuestionStats,
    fetchDashboardSummary,
    fetchOfflineBundles,
    fetchUserBudget, saveUserBudget,
    syncBudgetTransactionsToCloud,
    syncPendingResultsToCloud,
} from '../../services/supabase';
import { fetchBudgetWalletData } from '../../services/budgetApi';
import { saveBudgetExtras } from '../../services/budgetExtrasSync';
import { normalizeMonthlyPlans, readPlanForMonth } from '@lantern/shared/utils';
import { mergeDmThreadLists } from '../../utils/dmThreads';
import { mergeFetchedGroups } from '../../utils/groupListMerge';
import { mapFetchedDmThreads } from './useDmThreadRefresh';
import {
    INITIAL_BOOTSTRAP_LOAD_STATE,
    type BootstrapLoadState,
} from '../useAuthHandlers';

// 'error' counts as settled — a domain that failed must not hold the boot spinner open.
function allBootstrapDomainsSettled(state: BootstrapLoadState): boolean {
  return Object.values(state).every((status) => status !== 'pending');
}

interface UseBootstrapFanoutParams {
    currentUser: User | null;
    authTokenReady: boolean;
    isAuthLoading: boolean;
    dataLoaded: boolean;
    setDataLoaded: (v: boolean) => void;
    setBootstrapLoad: Dispatch<SetStateAction<BootstrapLoadState>>;
    refreshDashboardGamification: () => Promise<void>;
}

export function useBootstrapFanout({
    currentUser,
    authTokenReady,
    isAuthLoading,
    dataLoaded,
    setDataLoaded,
    setBootstrapLoad,
    refreshDashboardGamification,
}: UseBootstrapFanoutParams): void {
    const { updateGroups, updateDmThreads, setNotifications } = useGroupStore();
    const {
        setOfflineBundles,
        setPendingSyncResults,
        setTestResults, setUserQuestionStats,
    } = useTestStore();
    const { setDecks, setFlashcards } = useFlashcardStore();
    const {
        setTransactions,
        budget, setBudget,
        savingsGoals, expenseSplits,
        setSavingsGoals, setExpenseSplits, setWalletBalance,
    } = useBudgetStore();
    const { setTheme, lowDataMode, setLowDataMode } = useUIStore();

    // --- Data loading ---
    // The signed-in bootstrap fan-out. Re-runs on currentUser.id / dataLoaded / isAuthLoading
    // / authTokenReady; `dataLoaded` is what makes it run once per account (handleLogout and
    // the sign-out paths reset it, which is how a second account re-bootstraps).
    // Two waves: a critical phase for first paint, then the heavy deferred loads. Results are
    // re-indexed into a flat `results` array, and each slot is applied independently so one
    // failed domain degrades that domain only. Every apply is gated on shouldApplyBootstrap()
    // — cancelled flag plus a live store id check — so a slow fan-out for user A cannot write
    // into user B's session after a switch.
    useEffect(() => {
        if (!currentUser || dataLoaded || isAuthLoading || !authTokenReady) return;

        let cancelled = false;

        (async () => {
            const tokenReady = await ensureAuthTokenReady();
            if (!tokenReady) {
                console.warn('[Data Loading] Deferred — auth token not ready');
                return;
            }
            if (cancelled) return;

            console.log('[Data Loading] Starting PARALLEL data fetch for user:', currentUser.id);
            setBootstrapLoad(INITIAL_BOOTSTRAP_LOAD_STATE);
            const userId = currentUser.id;
            const currentMonthYear = new Date().toISOString().slice(0, 7);

            // Owner-stamp the budget store first: ensureOwner drops another user's cached
            // transactions, and only the surviving (owned) rows are pushed to the cloud below.
            useBudgetStore.getState().ensureOwner(userId);
            const scopedTransactions = useBudgetStore.getState().transactions;

            void refreshDashboardGamification();

            // Phase 1: critical path for first paint (groups, DMs, notifications, prefs)
            const criticalResults = await Promise.allSettled([
                fetchGroups(userId),
                fetchGroupUnreadCounts(userId),
                fetchDmThreads(userId),
                fetchDMUnreadCounts(userId),
                fetchNotifications(userId),
                fetchUserPreferences(userId),
            ]);

            // One aggregate round trip for test results + question stats,
            // falling back to the individual requests when the summary
            // endpoint is unavailable (e.g. older API deployments).
            const dashboardInputsPromise = (async () => {
                const summary = await fetchDashboardSummary();
                if (summary) return summary;
                const [testResults, userQuestionStats] = await Promise.all([
                    fetchTestResults(userId, { limit: 500, lean: true }),
                    fetchUserQuestionStats(userId),
                ]);
                return { testResults, userQuestionStats };
            })();

            // Phase 2: deferred heavy loads (paginated / background)
            const deferredResults = await Promise.allSettled([
                fetchDecks(userId, { includeShared: true }),
                fetchAllFlashcards(undefined, userId),
                dashboardInputsPromise.then(inputs => inputs.testResults),
                dashboardInputsPromise.then(inputs => inputs.userQuestionStats),
                fetchOfflineBundles(userId),
                fetchUserBudget(userId, currentMonthYear),
                syncBudgetTransactionsToCloud(userId, scopedTransactions),
            ]);

            // Flatten both waves into one fixed-order array; the `results[n]` indices below
            // are positional and must stay in step with this list.
            const results = [
                criticalResults[0], criticalResults[1], criticalResults[2], criticalResults[3],
                deferredResults[0], deferredResults[1], deferredResults[2], deferredResults[3],
                criticalResults[4],
                deferredResults[4],
                criticalResults[5],
                deferredResults[5],
                deferredResults[6],
            ];

            if (cancelled) return;

            const shouldApplyBootstrap = () =>
                !cancelled && useAuthStore.getState().currentUser?.id === userId;

            console.log('[Data Loading] All parallel fetches settled');

            const nextBootstrap: BootstrapLoadState = {
                groups: criticalResults[0].status === 'fulfilled' ? 'loaded' : 'error',
                dms: criticalResults[2].status === 'fulfilled' ? 'loaded' : 'error',
                notifications: criticalResults[4].status === 'fulfilled' ? 'loaded' : 'error',
                preferences: criticalResults[5].status === 'fulfilled' ? 'loaded' : 'error',
                decks: deferredResults[0].status === 'fulfilled' ? 'loaded' : 'error',
                flashcards: deferredResults[1].status === 'fulfilled' ? 'loaded' : 'error',
                tests:
                    deferredResults[2].status === 'fulfilled' && deferredResults[3].status === 'fulfilled'
                        ? 'loaded'
                        : 'error',
                offline: deferredResults[4].status === 'fulfilled' ? 'loaded' : 'error',
                budget:
                    deferredResults[5].status === 'fulfilled' && deferredResults[6].status === 'fulfilled'
                        ? 'loaded'
                        : 'error',
            };
            if (!shouldApplyBootstrap()) return;
            setBootstrapLoad(nextBootstrap);

            if (nextBootstrap.groups === 'error') {
                useToastStore.getState().showToast(
                    'Could not load your groups. Some features may be unavailable until you refresh.',
                    'error'
                );
            } else if (nextBootstrap.decks === 'error' || nextBootstrap.flashcards === 'error') {
                useToastStore.getState().showToast(
                    'Some study library data failed to load. Try refreshing the page.',
                    'error'
                );
            }

                if (!shouldApplyBootstrap()) return;

                // --- [0] Groups + [1] Unread counts ---
                const groupsResult = results[0];
                const unreadResult = results[1];
                // Remaps the API rows (mixed camel/snake case) and folds unread counts in,
                // preserving locally-loaded roster/pending-member data that the list endpoint
                // does not return — so an @mention roster is not blanked by a refresh.
                if (groupsResult.status === 'fulfilled') {
                    const fetchedGroups = groupsResult.value;
                    const unreadCounts = unreadResult.status === 'fulfilled' ? unreadResult.value : {};
                    updateGroups((prev) => mergeFetchedGroups(fetchedGroups, prev, unreadCounts));
                } else {
                    console.error('[Data Loading] Groups fetch failed:', groupsResult.reason);
                }

                // --- [2] DM threads + [3] DM unread counts ---
                const dmResult = results[2];
                const dmUnreadResult = results[3];
                if (dmResult.status === 'fulfilled') {
                    const fetchedDmThreads = dmResult.value;
                    const dmUnreadCounts = dmUnreadResult.status === 'fulfilled' ? dmUnreadResult.value : {};
                    const mapped = mapFetchedDmThreads(
                        Array.isArray(fetchedDmThreads) ? fetchedDmThreads : [],
                        dmUnreadCounts,
                    );
                    // Server-authoritative merge keeps only optimistic locals, so a real
                    // empty inbox clears stale threads without wiping in-flight creates.
                    updateDmThreads((prev) => mergeDmThreadLists(prev, mapped, 'server'));
                }

                // --- [4] Decks + [5] Flashcards ---
                const decksResult = results[4];
                const flashcardsResult = results[5];
                if (decksResult.status === 'fulfilled') {
                    // Full mapping (userId/isShared included) so shared-deck
                    // affordances survive the bootstrap load.
                    setDecks(mapDecksFromApi(decksResult.value || []));
                }
                // A failed deck/card load must render as an error with Retry,
                // never as the "No flashcard decks yet" empty state.
                {
                    const flashcardStore = useFlashcardStore.getState();
                    const loadFailure =
                        decksResult.status === 'rejected'
                            ? decksResult.reason
                            : flashcardsResult.status === 'rejected'
                              ? flashcardsResult.reason
                              : null;
                    flashcardStore.setDeckLoadError(
                        loadFailure
                            ? (loadFailure instanceof Error && loadFailure.message) ||
                                  "Couldn't load your decks — check your connection."
                            : null
                    );
                    flashcardStore.setRetryDeckBootstrap(() => {
                        void (async () => {
                            const store = useFlashcardStore.getState();
                            try {
                                const [freshDecks, freshCards] = await Promise.all([
                                    fetchDecks(userId, { includeShared: true }),
                                    fetchAllFlashcards(undefined, userId),
                                ]);
                                store.setDecks(mapDecksFromApi(freshDecks || []));
                                store.setFlashcards(freshCards);
                                store.setDeckLoadError(null);
                            } catch (retryErr) {
                                store.setDeckLoadError(
                                    (retryErr instanceof Error && retryErr.message) ||
                                        "Couldn't load your decks — check your connection."
                                );
                            }
                        })();
                    });
                }
                void useNotesStore.getState().loadFolders();
                void useNotesStore.getState().loadNotes();

                if (flashcardsResult.status === 'fulfilled') {
                    // Already normalized via fetchAllFlashcards → mapFlashcardsFromApi
                    setFlashcards(flashcardsResult.value);
                }

                // --- [6] Test results ---
                // Cloud history plus any still-unsynced offline results. Dedupe is by id AND
                // by session start time, because a result synced by another device comes back
                // with a server id that the local pending copy never saw.
                if (results[6].status === 'fulfilled') {
                    const cloudResults = results[6].value;
                    // Re-read pendingSyncResults from the store at merge time (localStorage-backed)
                    const currentPending = useTestStore.getState().pendingSyncResults;
                    if (currentPending.length > 0) {
                        const cloudIds = new Set(cloudResults.map((r: any) => r.id).filter(Boolean));
                        const cloudStartTimes = new Set(cloudResults.map((r: any) => new Date(r.session?.startTime).getTime()));
                        const pendingNotYetSynced = currentPending.filter(r =>
                            !cloudIds.has(r.id) && !cloudStartTimes.has(new Date(r.session?.startTime).getTime())
                        );
                        setTestResults([...pendingNotYetSynced, ...cloudResults]);
                    } else {
                        setTestResults(cloudResults);
                    }
                }

                // --- [7] User question stats ---
                if (results[7].status === 'fulfilled') {
                    let fetchedStats = results[7].value;
                    // Summary/bootstrap may return {} when the aggregate path
                    // failed open. Retry the dedicated endpoint so "Questions
                    // to review" can still populate.
                    if (
                        !fetchedStats ||
                        typeof fetchedStats !== 'object' ||
                        Array.isArray(fetchedStats) ||
                        Object.keys(fetchedStats).length === 0
                    ) {
                        try {
                            fetchedStats = await fetchUserQuestionStats(userId);
                        } catch {
                            // keep prior empty/failed value
                        }
                    }
                    if (
                        fetchedStats &&
                        typeof fetchedStats === 'object' &&
                        !Array.isArray(fetchedStats)
                    ) {
                        setUserQuestionStats(fetchedStats);
                    }
                } else {
                    try {
                        const retryStats = await fetchUserQuestionStats(userId);
                        if (retryStats && typeof retryStats === 'object' && !Array.isArray(retryStats)) {
                            setUserQuestionStats(retryStats);
                        }
                    } catch {
                        // leave store as-is
                    }
                }

                // Both the fulfilled-but-empty and the rejected case retry the dedicated
                // stats endpoint once; either way the store is left untouched on failure
                // rather than being overwritten with {}.

                // --- [8] Notifications ---
                if (results[8].status === 'fulfilled') {
                    const fetchedNotifications = results[8].value;
                    setNotifications(Array.isArray(fetchedNotifications) ? fetchedNotifications : []);
                }

                // --- [9] Offline bundles ---
                if (results[9].status === 'fulfilled') {
                    const cloudBundles: OfflineSessionBundle[] = results[9].value;
                    // Cloud is the authoritative source filtered by user_id.
                    // Replace the store entirely to prevent cross-user contamination
                    // from the shared localStorage key and to eliminate duplicates.
                    setOfflineBundles(cloudBundles);
                }

                // --- [10] User preferences ---
                // Legacy slim prefs row. It only stores a RESOLVED light/dark theme, so it is
                // never allowed to overwrite a 'system' preference held in full settings.
                // Also rehydrates budget extras (goals, splits, per-month plans) and, when
                // there is no cloud row at all, seeds one from local state.
                if (results[10].status === 'fulfilled') {
                    const cloudPrefs = results[10].value;
                    if (cloudPrefs) {
                        // Theme comes from full UserSettings (supports system). Slim prefs
                        // only carry a resolved light/dark column — do not overwrite system.
                        const themePreference = cloudPrefs.preferences?.themePreference;
                        const fullTheme = useAuthStore.getState().currentUser?.settings?.appearance?.theme;
                        if (
                            fullTheme !== 'system' &&
                            themePreference !== 'system' &&
                            (cloudPrefs.theme === 'light' || cloudPrefs.theme === 'dark')
                        ) {
                            setTheme(cloudPrefs.theme);
                            localStorage.setItem('theme', cloudPrefs.theme);
                        }
                        if (typeof cloudPrefs.lowDataMode === 'boolean') {
                            setLowDataMode(cloudPrefs.lowDataMode === true);
                        } else if (typeof cloudPrefs.preferences?.lowDataMode === 'boolean') {
                            setLowDataMode(cloudPrefs.preferences.lowDataMode === true);
                        }
                        const extras = cloudPrefs.preferences?.budgetExtras;
                        if (extras && typeof extras === 'object') {
                            if (Array.isArray(extras.savingsGoals)) setSavingsGoals(extras.savingsGoals);
                            if (Array.isArray(extras.expenseSplits)) setExpenseSplits(extras.expenseSplits);
                            useBudgetStore.getState().setPlansByMonth(
                                normalizeMonthlyPlans(extras.plansByMonth)
                            );
                            // Read the CURRENT month's plan through the per-month
                            // store (with the legacy flat fields as fallback).
                            // Hydration used to restore only categoryBudgets, so
                            // plannedIncome/plannedSavings vanished on reload.
                            const monthPlan = readPlanForMonth(
                                extras,
                                currentMonthYear,
                                currentMonthYear
                            );
                            if (monthPlan) {
                                const currentBudget = useBudgetStore.getState().budget;
                                setBudget({
                                    monthlyLimit: currentBudget?.monthlyLimit ?? 0,
                                    monthYear: currentBudget?.monthYear ?? currentMonthYear,
                                    userId,
                                    categoryBudgets: monthPlan.plannedExpenses,
                                    plannedIncome: monthPlan.plannedIncome,
                                    plannedSavings: monthPlan.plannedSavings,
                                });
                            }
                        }
                    } else {
                        const localTheme = localStorage.getItem('theme') as 'light' | 'dark' || 'light';
                        const settingsTheme =
                            useAuthStore.getState().currentUser?.settings?.appearance?.theme;
                        saveUserPreferences(userId, {
                            theme: localTheme,
                            lowDataMode,
                            themePreference:
                                settingsTheme === 'system' || settingsTheme === 'light' || settingsTheme === 'dark'
                                    ? settingsTheme
                                    : localTheme,
                        }).catch(console.error);
                    }
                }

                // --- [11] User budget ---
                // Cloud row wins; otherwise the legacy 'monthlyBudget' localStorage blob is
                // adopted and written up once. categoryBudgets always come from the store,
                // since slot [10] above already hydrated them from the plans payload.
                if (results[11].status === 'fulfilled') {
                    const cloudBudget = results[11].value;
                    const existing = useBudgetStore.getState().budget;
                    if (cloudBudget) {
                        setBudget({
                            monthlyLimit: cloudBudget.monthlyLimit,
                            monthYear: currentMonthYear,
                            userId,
                            categoryBudgets: existing?.categoryBudgets,
                        });
                    } else {
                        const localBudgetStr = localStorage.getItem('monthlyBudget');
                        if (localBudgetStr) {
                            const localBudget = JSON.parse(localBudgetStr);
                            setBudget({
                                monthlyLimit: localBudget.monthlyLimit || 0,
                                monthYear: currentMonthYear,
                                userId,
                                categoryBudgets: existing?.categoryBudgets ?? localBudget.categoryBudgets,
                            });
                            saveUserBudget(userId, {
                                monthlyLimit: localBudget.monthlyLimit || 0,
                                monthYear: currentMonthYear
                            }).catch(console.error);
                        }
                    }
                }

                // --- [12] Transactions sync ---
                // syncBudgetTransactionsToCloud returns the merged local+cloud set; every row
                // is re-stamped with this userId so nothing unowned survives the merge.
                if (results[12].status === 'fulfilled') {
                    const mergedTransactions = results[12].value;
                    const transactionsWithUserId: Transaction[] = mergedTransactions.map((t: any) => ({
                        ...t,
                        userId: userId,
                        type: t.type as TransactionType,
                        category: t.category || '',
                        description: t.description || ''
                    }));
                    setTransactions(transactionsWithUserId);
                }

                // Authoritative wallet balance (never from preferences cache / localStorage)
                if (!cancelled) {
                    try {
                        const wallet = await fetchBudgetWalletData();
                        setWalletBalance(wallet.walletBalance);
                        if (Array.isArray(wallet.savingsGoals)) setSavingsGoals(wallet.savingsGoals);
                        if (Array.isArray(wallet.expenseSplits)) setExpenseSplits(wallet.expenseSplits);
                    } catch (err) {
                        console.error('[Budget Sync] Failed to load wallet:', err);
                    }
                }

                // Mark bootstrap settled — per-domain status tracks individual failures
                if (shouldApplyBootstrap() && allBootstrapDomainsSettled(nextBootstrap)) {
                    setDataLoaded(true);
                }

            // Sync pending results (non-critical, fire-and-forget).
            // Gate on live store state (the render-scope array can be a stale
            // pre-purge snapshot of another user's queue).
            if (!cancelled && useTestStore.getState().pendingSyncResults.length > 0) {
                const localPending = useTestStore.getState().pendingSyncResults;
                const cloudFormatted = localPending.map(result => ({
                    id: result.id,
                    resultData: result,
                    createdAt: result.session?.endTime
                        ? new Date(result.session.endTime).toISOString()
                        : new Date().toISOString(),
                    synced: false,
                }));
                syncPendingResultsToCloud(currentUser.id, cloudFormatted).then((merged) => {
                    if (cancelled) return;
                    const mergedResults = merged
                        .filter(row => !row.synced)
                        .map(row => row.resultData);
                    setPendingSyncResults(mergedResults);
                    console.log('[Pending Results Sync] Synced');
                }).catch(error => {
                    console.error('[Pending Results Sync] Error:', error);
                });
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [currentUser?.id, dataLoaded, isAuthLoading, authTokenReady, refreshDashboardGamification, setBootstrapLoad]);

    // Sync budget extras (goals, splits, category budgets) — never walletBalance (server-owned)
    // Re-runs whenever any of those three collections changes identity; the 1.5s timer is a
    // trailing debounce, so dragging a category slider produces one write, not one per frame.
    // Gated on dataLoaded so bootstrap's own hydration does not immediately echo back up.
    useEffect(() => {
        if (!currentUser?.id || !dataLoaded) return;
        const timer = setTimeout(() => {
            saveBudgetExtras(currentUser.id, {
                savingsGoals,
                expenseSplits,
                categoryBudgets: budget?.categoryBudgets,
            }).catch(console.error);
        }, 1500);
        return () => clearTimeout(timer);
    }, [currentUser?.id, dataLoaded, savingsGoals, expenseSplits, budget?.categoryBudgets]);
}
