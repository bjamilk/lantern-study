// @vitest-environment jsdom
/**
 * Contract test for `hooks/effects/useBootstrapFanout`.
 *
 * What the hook promises:
 *  - it returns nothing, and it runs ONCE per signed-in account: not before the
 *    auth token is ready, not while auth is still loading, and not again once
 *    `dataLoaded` is true (the sign-out paths reset that flag, and that is how a
 *    second account re-bootstraps),
 *  - one failed domain degrades that domain only — every other slot still
 *    applies, the failure is recorded in the bootstrap state, and 'error' counts
 *    as settled so a dead endpoint cannot hold the boot spinner open,
 *  - nothing is applied to a session that has since switched accounts,
 *  - the budget-extras write-back is a trailing debounce, gated on dataLoaded,
 *    and never writes the server-owned wallet balance.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => {
    const authState = { currentUser: { id: 'user-1' } as Record<string, unknown> | null };
    const groupState = {
        updateGroups: vi.fn(),
        updateDmThreads: vi.fn(),
        setNotifications: vi.fn(),
    };
    const testState = {
        offlineBundles: [] as unknown[],
        setOfflineBundles: vi.fn(),
        pendingSyncResults: [] as unknown[],
        setPendingSyncResults: vi.fn(),
        setTestResults: vi.fn(),
        setUserQuestionStats: vi.fn(),
    };
    const flashcardState = {
        setDecks: vi.fn(),
        setFlashcards: vi.fn(),
        setDeckLoadError: vi.fn(),
        setRetryDeckBootstrap: vi.fn(),
    };
    const budgetState = {
        transactions: [] as unknown[],
        setTransactions: vi.fn(),
        budget: null as unknown,
        setBudget: vi.fn(),
        savingsGoals: [] as unknown[],
        expenseSplits: [] as unknown[],
        setSavingsGoals: vi.fn(),
        setExpenseSplits: vi.fn(),
        setWalletBalance: vi.fn(),
        setPlansByMonth: vi.fn(),
        ensureOwner: vi.fn(),
    };
    const uiState = { setTheme: vi.fn(), lowDataMode: false, setLowDataMode: vi.fn() };
    const notesState = {
        loadFolders: vi.fn(() => Promise.resolve()),
        loadNotes: vi.fn(() => Promise.resolve()),
    };
    const toastState = { showToast: vi.fn() };
    const store = <T extends object>(state: T) => {
        const hook = (() => state) as (() => T) & { getState: () => T };
        hook.getState = () => state;
        return hook;
    };
    const resolved = <T,>(value: T) => vi.fn((..._args: unknown[]) => Promise.resolve(value));
    return {
        authState,
        groupState,
        testState,
        flashcardState,
        budgetState,
        uiState,
        notesState,
        toastState,
        store,
        ensureAuthTokenReady: vi.fn(() => Promise.resolve(true)),
        fetchGroups: resolved<unknown>([{ id: 'group-1' }]),
        fetchGroupUnreadCounts: resolved<unknown>({}),
        fetchDmThreads: resolved<unknown>([]),
        fetchDMUnreadCounts: resolved<unknown>({}),
        fetchNotifications: resolved<unknown>([{ id: 'n1' }]),
        fetchUserPreferences: resolved<unknown>(null),
        saveUserPreferences: resolved<unknown>(undefined),
        fetchDecks: resolved<unknown>([{ id: 'deck-1' }]),
        fetchAllFlashcards: resolved<unknown>([{ id: 'card-1' }]),
        fetchTestResults: resolved<unknown>([]),
        fetchUserQuestionStats: resolved<unknown>({ q1: {} }),
        fetchDashboardSummary: resolved<unknown>({ testResults: [], userQuestionStats: { q1: {} } }),
        fetchOfflineBundles: resolved<unknown>([{ id: 'bundle-1' }]),
        fetchUserBudget: resolved<unknown>(null),
        saveUserBudget: resolved<unknown>(undefined),
        syncBudgetTransactionsToCloud: resolved<unknown>([]),
        syncPendingResultsToCloud: resolved<unknown>([]),
        mapDecksFromApi: vi.fn((decks: unknown) => decks),
        fetchBudgetWalletData: vi.fn(() => Promise.resolve({ walletBalance: 12 })),
        saveBudgetExtras: vi.fn((..._args: unknown[]) => Promise.resolve()),
        mergeFetchedGroups: vi.fn((fetched: unknown) => fetched),
        mergeDmThreadLists: vi.fn((_prev: unknown, next: unknown) => next),
    };
});

vi.mock('../../stores/authStore', () => ({ useAuthStore: fx.store(fx.authState) }));
vi.mock('../../stores/groupStore', () => ({ useGroupStore: fx.store(fx.groupState) }));
vi.mock('../../stores/testStore', () => ({ useTestStore: fx.store(fx.testState) }));
vi.mock('../../stores/flashcardStore', () => ({
    useFlashcardStore: fx.store(fx.flashcardState),
}));
vi.mock('../../stores/budgetStore', () => ({ useBudgetStore: fx.store(fx.budgetState) }));
vi.mock('../../stores/uiStore', () => ({ useUIStore: fx.store(fx.uiState) }));
vi.mock('../../stores/notesStore', () => ({ useNotesStore: fx.store(fx.notesState) }));
vi.mock('../../stores/toastStore', () => ({ useToastStore: fx.store(fx.toastState) }));
vi.mock('../../services/supabase', () => ({
    ensureAuthTokenReady: fx.ensureAuthTokenReady,
    fetchGroups: fx.fetchGroups,
    fetchGroupUnreadCounts: fx.fetchGroupUnreadCounts,
    fetchDmThreads: fx.fetchDmThreads,
    fetchDMUnreadCounts: fx.fetchDMUnreadCounts,
    fetchNotifications: fx.fetchNotifications,
    fetchUserPreferences: fx.fetchUserPreferences,
    saveUserPreferences: fx.saveUserPreferences,
    fetchDecks: fx.fetchDecks,
    fetchAllFlashcards: fx.fetchAllFlashcards,
    mapDecksFromApi: fx.mapDecksFromApi,
    fetchTestResults: fx.fetchTestResults,
    fetchUserQuestionStats: fx.fetchUserQuestionStats,
    fetchDashboardSummary: fx.fetchDashboardSummary,
    fetchOfflineBundles: fx.fetchOfflineBundles,
    fetchUserBudget: fx.fetchUserBudget,
    saveUserBudget: fx.saveUserBudget,
    syncBudgetTransactionsToCloud: fx.syncBudgetTransactionsToCloud,
    syncPendingResultsToCloud: fx.syncPendingResultsToCloud,
}));
vi.mock('../../services/budgetApi', () => ({
    fetchBudgetWalletData: fx.fetchBudgetWalletData,
}));
vi.mock('../../services/budgetExtrasSync', () => ({ saveBudgetExtras: fx.saveBudgetExtras }));
vi.mock('../../utils/groupListMerge', () => ({ mergeFetchedGroups: fx.mergeFetchedGroups }));
vi.mock('../../utils/dmThreads', () => ({
    mapDmThreadFromApi: (row: unknown) => row,
    mergeDmThreadLists: fx.mergeDmThreadLists,
}));

import { useBootstrapFanout } from './useBootstrapFanout';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const USER = { id: 'user-1' } as never;
const setDataLoaded = vi.fn();
const setBootstrapLoad = vi.fn();
const refreshDashboardGamification = vi.fn(() => Promise.resolve());

interface ProbeProps {
    currentUser?: unknown;
    authTokenReady?: boolean;
    isAuthLoading?: boolean;
    dataLoaded?: boolean;
}

let container: HTMLDivElement;
let root: Root;
let returned: unknown;

function Probe({
    currentUser = USER,
    authTokenReady = true,
    isAuthLoading = false,
    dataLoaded = false,
}: ProbeProps) {
    returned = useBootstrapFanout({
        currentUser: currentUser as never,
        authTokenReady,
        isAuthLoading,
        dataLoaded,
        setDataLoaded,
        setBootstrapLoad,
        refreshDashboardGamification,
    });
    return null;
}

/** Mount and let both fan-out waves settle. */
const mount = async (props: ProbeProps = {}) => {
    await act(async () => {
        root.render(<Probe {...props} />);
    });
    await act(async () => {
        for (let i = 0; i < 12; i += 1) await Promise.resolve();
    });
};

/** The last bootstrap state the fan-out published. */
const lastBootstrapState = () =>
    setBootstrapLoad.mock.calls.map(([value]) => value).filter((value) => value?.groups).pop();

beforeEach(() => {
    vi.clearAllMocks();
    fx.authState.currentUser = { id: 'user-1' };
    fx.testState.pendingSyncResults = [];
    fx.ensureAuthTokenReady.mockResolvedValue(true);
    fx.fetchGroups.mockResolvedValue([{ id: 'group-1' }]);
    fx.fetchDecks.mockResolvedValue([{ id: 'deck-1' }]);
    fx.fetchAllFlashcards.mockResolvedValue([{ id: 'card-1' }]);
    fx.fetchNotifications.mockResolvedValue([{ id: 'n1' }]);
    fx.fetchOfflineBundles.mockResolvedValue([{ id: 'bundle-1' }]);
    fx.fetchDashboardSummary.mockResolvedValue({
        testResults: [],
        userQuestionStats: { q1: {} },
    });
    fx.mapDecksFromApi.mockImplementation((decks: unknown) => decks);
    fx.mergeFetchedGroups.mockImplementation((fetched: unknown) => fetched);
    fx.fetchBudgetWalletData.mockResolvedValue({ walletBalance: 12 });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => {
        root.unmount();
    });
    container.remove();
});

describe('useBootstrapFanout', () => {
    it('returns nothing — it is a pure side effect', async () => {
        await mount();
        expect(returned).toBeUndefined();
    });

    it('loads every domain and marks the boot settled', async () => {
        await mount();
        expect(fx.budgetState.ensureOwner).toHaveBeenCalledWith('user-1');
        expect(refreshDashboardGamification).toHaveBeenCalled();
        expect(fx.fetchGroups).toHaveBeenCalledWith('user-1');
        expect(fx.flashcardState.setDecks).toHaveBeenCalledWith([{ id: 'deck-1' }]);
        expect(fx.flashcardState.setFlashcards).toHaveBeenCalledWith([{ id: 'card-1' }]);
        expect(fx.groupState.setNotifications).toHaveBeenCalledWith([{ id: 'n1' }]);
        expect(fx.testState.setOfflineBundles).toHaveBeenCalledWith([{ id: 'bundle-1' }]);
        expect(fx.budgetState.setWalletBalance).toHaveBeenCalledWith(12);
        expect(lastBootstrapState()).toMatchObject({ groups: 'loaded', decks: 'loaded' });
        expect(setDataLoaded).toHaveBeenCalledWith(true);
    });

    it('waits for the auth token rather than firing 401s', async () => {
        await mount({ authTokenReady: false });
        expect(fx.fetchGroups).not.toHaveBeenCalled();
    });

    it('does not re-run for an account that is already loaded', async () => {
        await mount({ dataLoaded: true });
        expect(fx.fetchGroups).not.toHaveBeenCalled();
    });

    it('does nothing while auth is still loading, or for a signed-out visitor', async () => {
        await mount({ isAuthLoading: true });
        expect(fx.fetchGroups).not.toHaveBeenCalled();
        await mount({ currentUser: null });
        expect(fx.fetchGroups).not.toHaveBeenCalled();
    });

    it('degrades one failed domain only, and still settles the boot', async () => {
        fx.fetchDecks.mockRejectedValue(new Error('decks down'));
        await mount();
        expect(lastBootstrapState()).toMatchObject({ decks: 'error', groups: 'loaded' });
        // An error is a settled state: the spinner must not stay up.
        expect(setDataLoaded).toHaveBeenCalledWith(true);
        // And it renders as an error with Retry, not as "no decks yet".
        expect(fx.flashcardState.setDeckLoadError).toHaveBeenCalledWith('decks down');
        expect(fx.flashcardState.setRetryDeckBootstrap).toHaveBeenCalled();
        expect(fx.toastState.showToast).toHaveBeenCalled();
    });

    it('applies nothing once the session has switched accounts mid-flight', async () => {
        fx.fetchGroups.mockImplementation(async () => {
            fx.authState.currentUser = { id: 'user-2' };
            return [{ id: 'group-1' }];
        });
        await mount();
        expect(fx.groupState.updateGroups).not.toHaveBeenCalled();
        expect(setDataLoaded).not.toHaveBeenCalledWith(true);
    });

    it('saves budget extras on a trailing debounce, and never the wallet balance', async () => {
        vi.useFakeTimers();
        await act(async () => {
            root.render(<Probe dataLoaded />);
        });
        expect(fx.saveBudgetExtras).not.toHaveBeenCalled();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1500);
        });
        expect(fx.saveBudgetExtras).toHaveBeenCalledTimes(1);
        expect(fx.saveBudgetExtras.mock.calls[0][1]).toEqual({
            savingsGoals: [],
            expenseSplits: [],
            categoryBudgets: undefined,
        });
        vi.useRealTimers();
    });

    it('does not save extras before the bootstrap has landed', async () => {
        vi.useFakeTimers();
        await act(async () => {
            root.render(<Probe />);
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(5000);
        });
        expect(fx.saveBudgetExtras).not.toHaveBeenCalled();
        vi.useRealTimers();
    });
});
