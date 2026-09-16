/**
 * Mocked zustand stores for the `hooks/effects/` suites.
 *
 * Every store is a plain object behind a `useX()` / `useX.getState()` pair, so
 * an effect that deliberately re-reads `useX.getState()` (the stale-closure
 * rule these effects are built around) sees the same object the render did.
 *
 * Exports: `createStoreFixtures()` → the state objects plus the module mocks a
 *  test hands to `vi.mock`. Call it inside `vi.hoisted` so the objects exist
 *  before the mocked imports are evaluated.
 * Gotchas:
 *  - Every callback is NAMED. The order lock reads `fn:<name>` out of each
 *    dependency array, so an anonymous stub would make two different setters
 *    look identical.
 */

export const named = <T extends (...args: any[]) => any>(name: string, fn: T): T => {
    Object.defineProperty(fn, 'name', { value: name });
    return fn;
};

export const noop = (name: string) => named(name, (..._args: any[]) => undefined);

export const storeMock = <T extends object>(state: T) => {
    const hook = (() => state) as (() => T) & { getState: () => T };
    hook.getState = () => state;
    return hook;
};

export function createStoreFixtures() {
    const currentUser = {
        id: 'user-1',
        name: 'Ada',
        email: 'ada@example.com',
        username: 'ada',
        institutionId: 'inst-1',
        settings: { appearance: { theme: 'dark' }, accessibility: {} },
    } as any;

    const auth = {
        currentUser,
        setCurrentUser: noop('setCurrentUser'),
        setAuthLoading: noop('setAuthLoading'),
        isAuthLoading: false,
        setPasswordRecovery: noop('setPasswordRecovery'),
        isPasswordRecovery: false,
    };
    const group = {
        groups: [{ id: 'group-1', members: [] }] as any[],
        setGroups: noop('setGroups'),
        updateGroups: noop('updateGroups'),
        dmThreads: [{ id: 'thread-1' }] as any[],
        updateDmThreads: noop('updateDmThreads'),
        setAllMessages: noop('setAllMessages'),
        updateMessages: noop('updateMessages'),
        updateDirectMessages: noop('updateDirectMessages'),
        setNotifications: noop('setNotifications'),
        updateNotifications: noop('updateNotifications'),
        notifications: [] as any[],
        messages: {} as Record<string, any[]>,
    };
    const test = {
        offlineBundles: [] as any[],
        setOfflineBundles: noop('setOfflineBundles'),
        pendingSyncResults: [] as any[],
        setPendingSyncResults: noop('setPendingSyncResults'),
        setTestResults: noop('setTestResults'),
        setUserQuestionStats: noop('setUserQuestionStats'),
        setStudyActivityDays: noop('setStudyActivityDays'),
    };
    const flashcard = {
        decks: [] as any[],
        setDecks: noop('setDecks'),
        flashcards: [] as any[],
        setFlashcards: noop('setFlashcards'),
        dueCardsCount: 0,
        setDueCardsCount: noop('setDueCardsCount'),
        pendingFlashcardReviews: [] as any[],
        clearPendingReviews: noop('clearPendingReviews'),
        setDeckLoadError: noop('setDeckLoadError'),
        setRetryDeckBootstrap: noop('setRetryDeckBootstrap'),
    };
    const budget = {
        transactions: [] as any[],
        setTransactions: noop('setTransactions'),
        budget: { categoryBudgets: {} } as any,
        setBudget: noop('setBudget'),
        savingsGoals: [] as any[],
        expenseSplits: [] as any[],
        walletBalance: 0,
        setSavingsGoals: noop('setSavingsGoals'),
        setExpenseSplits: noop('setExpenseSplits'),
        setWalletBalance: noop('setWalletBalance'),
        setPlansByMonth: noop('setPlansByMonth'),
        ensureOwner: noop('ensureOwner'),
    };
    const ui = {
        theme: 'dark' as 'light' | 'dark',
        setTheme: noop('setTheme'),
        setAppMode: noop('setAppMode'),
        openModal: noop('openModal'),
        lowDataMode: false,
        setLowDataMode: noop('setLowDataMode'),
        selectedChat: null as any,
        isOnline: true,
    };
    const notes = {
        selectedNote: null as any,
        loadNotes: named('loadNotes', async () => undefined),
        loadNote: named('loadNote', async () => undefined),
        loadFolders: named('loadFolders', async () => undefined),
        loadComments: named('loadComments', async () => undefined),
    };
    const toast = { showToast: noop('showToast') };

    return {
        auth,
        group,
        test,
        flashcard,
        budget,
        ui,
        notes,
        toast,
        currentUser,
        modules: {
            authStore: { useAuthStore: storeMock(auth) },
            groupStore: { useGroupStore: storeMock(group) },
            testStore: { useTestStore: storeMock(test) },
            flashcardStore: { useFlashcardStore: storeMock(flashcard) },
            budgetStore: { useBudgetStore: storeMock(budget) },
            uiStore: { useUIStore: storeMock(ui) },
            notesStore: { useNotesStore: storeMock(notes) },
            toastStore: { useToastStore: storeMock(toast) },
        },
    };
}

export type StoreFixtures = ReturnType<typeof createStoreFixtures>;
