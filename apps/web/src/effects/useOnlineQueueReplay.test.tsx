// @vitest-environment jsdom
/**
 * Contract test for `hooks/effects/useOnlineQueueReplay`.
 *
 * What the hook promises: it returns nothing; while online with a signed-in
 * user it calls each queue's sync service exactly once per queue that has work;
 * it folds any gamification the test-result sync returns back into the auth
 * store; and it reports `remaining` honestly rather than claiming a full sync.
 *
 * It must also do NOTHING when a queue is empty or the browser is offline —
 * that guard is what keeps a landing page from firing two uploads per render.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => {
    const authState = {
        currentUser: { id: 'user-1' } as Record<string, unknown> | null,
        setCurrentUser: vi.fn(),
    };
    const flashcardState = { pendingFlashcardReviews: [] as unknown[] };
    const testState = { pendingSyncResults: [] as unknown[] };
    const toastState = { showToast: vi.fn() };
    const uiState = { isOnline: true };
    const store = <T extends object>(state: T) => {
        const hook = (() => state) as (() => T) & { getState: () => T };
        hook.getState = () => state;
        return hook;
    };
    return {
        authState,
        flashcardState,
        testState,
        toastState,
        uiState,
        store,
        syncPendingFlashcardReviews: vi.fn(() => Promise.resolve({ synced: 0 })),
        syncPendingTestResults: vi.fn((..._args: unknown[]) =>
            Promise.resolve({ synced: 0, remaining: 0, gamification: null as unknown }),
        ),
    };
});

vi.mock('../../../../stores/authStore', () => ({ useAuthStore: fx.store(fx.authState) }));
vi.mock('../../../../stores/flashcardStore', () => ({
    useFlashcardStore: fx.store(fx.flashcardState),
}));
vi.mock('../../../../stores/testStore', () => ({ useTestStore: fx.store(fx.testState) }));
vi.mock('../../../../stores/toastStore', () => ({ useToastStore: fx.store(fx.toastState) }));
vi.mock('../../../../stores/uiStore', () => ({ useUIStore: fx.store(fx.uiState) }));
vi.mock('../../../../services/offlineFlashcardSync', () => ({
    syncPendingFlashcardReviews: fx.syncPendingFlashcardReviews,
}));
vi.mock('../../../../services/offlineTestSync', () => ({
    syncPendingTestResults: fx.syncPendingTestResults,
}));

import { useOnlineQueueReplay } from '../../../../hooks/effects/useOnlineQueueReplay';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const USER = { id: 'user-1' } as never;

let container: HTMLDivElement;
let root: Root;
let returned: unknown;

function Probe({ currentUser }: { currentUser: unknown }) {
    returned = useOnlineQueueReplay({ currentUser: currentUser as never });
    return null;
}

const mount = async (currentUser: unknown = USER) => {
    await act(async () => {
        root.render(<Probe currentUser={currentUser} />);
    });
};

beforeEach(() => {
    fx.uiState.isOnline = true;
    fx.flashcardState.pendingFlashcardReviews = [];
    fx.testState.pendingSyncResults = [];
    fx.authState.currentUser = { id: 'user-1' };
    fx.syncPendingFlashcardReviews.mockClear().mockResolvedValue({ synced: 0 });
    fx.syncPendingTestResults
        .mockClear()
        .mockResolvedValue({ synced: 0, remaining: 0, gamification: null });
    fx.authState.setCurrentUser.mockClear();
    fx.toastState.showToast.mockClear();
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

describe('useOnlineQueueReplay', () => {
    it('returns nothing — it is a pure side effect', async () => {
        await mount();
        expect(returned).toBeUndefined();
    });

    it('replays each queue that has work, through its own sync service', async () => {
        fx.flashcardState.pendingFlashcardReviews = [{ id: 'review-1' }];
        fx.testState.pendingSyncResults = [{ id: 'result-1' }];
        await mount();
        expect(fx.syncPendingFlashcardReviews).toHaveBeenCalledTimes(1);
        expect(fx.syncPendingTestResults).toHaveBeenCalledWith('user-1');
    });

    it('does nothing at all while offline', async () => {
        fx.uiState.isOnline = false;
        fx.flashcardState.pendingFlashcardReviews = [{ id: 'review-1' }];
        fx.testState.pendingSyncResults = [{ id: 'result-1' }];
        await mount();
        expect(fx.syncPendingFlashcardReviews).not.toHaveBeenCalled();
        expect(fx.syncPendingTestResults).not.toHaveBeenCalled();
    });

    it('does not call a sync service for an empty queue', async () => {
        fx.testState.pendingSyncResults = [{ id: 'result-1' }];
        await mount();
        expect(fx.syncPendingFlashcardReviews).not.toHaveBeenCalled();
        expect(fx.syncPendingTestResults).toHaveBeenCalledTimes(1);
    });

    it('folds returned gamification back into the auth store and reports what is left', async () => {
        fx.testState.pendingSyncResults = [{ id: 'result-1' }, { id: 'result-2' }];
        fx.syncPendingTestResults.mockResolvedValue({
            synced: 1,
            remaining: 1,
            gamification: { points: 40, badges: ['b'], stats: { x: 1 } },
        });
        await mount();
        await act(async () => {});
        expect(fx.authState.setCurrentUser).toHaveBeenCalledWith(
            expect.objectContaining({ points: 40, badges: ['b'] }),
        );
        expect(fx.toastState.showToast).toHaveBeenCalledWith(
            'Synced 1 offline test result(s); 1 still pending.',
            'success',
        );
    });
});
