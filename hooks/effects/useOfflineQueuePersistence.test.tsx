// @vitest-environment jsdom
/**
 * Contract test for `hooks/effects/useOfflineQueuePersistence`.
 *
 * What the hook promises: it returns nothing, it mirrors both offline stores to
 * localStorage, and it backs the test-result queue up through
 * `savePendingSyncResult` — but only for the queue's owner.
 *
 * The case worth having a test for is the one the banner spends fifteen lines
 * on: both effects must read the LIVE store, never the array their deps carry.
 * The test renders with a render-time snapshot that differs from the live store
 * and asserts the LIVE value is what gets written — the exact shape of the bug
 * where a signed-out student's queue was re-uploaded under the next account.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { liveTestStore, renderSnapshot } = vi.hoisted(() => ({
    liveTestStore: { offlineBundles: [] as unknown[], pendingSyncResults: [] as Array<{ id: string }> },
    /** What the render sees, which the effects must deliberately ignore. */
    renderSnapshot: { offlineBundles: [] as unknown[], pendingSyncResults: [] as unknown[] },
}));

vi.mock('../../stores/testStore', () => {
    const useTestStore = () => renderSnapshot;
    useTestStore.getState = () => liveTestStore;
    return { useTestStore };
});

const { savePendingSyncResult, isOfflineQueueOwner } = vi.hoisted(() => ({
    savePendingSyncResult: vi.fn((..._args: unknown[]) => Promise.resolve()),
    isOfflineQueueOwner: vi.fn((..._args: unknown[]) => true),
}));
vi.mock('../../services/supabase', () => ({ savePendingSyncResult }));
vi.mock('../../services/offlineQueueOwner', () => ({ isOfflineQueueOwner }));

import { useOfflineQueuePersistence } from './useOfflineQueuePersistence';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const USER = { id: 'user-1' } as never;

let container: HTMLDivElement;
let root: Root;
let returned: unknown;

function Probe({ currentUser }: { currentUser: unknown }) {
    returned = useOfflineQueuePersistence({ currentUser: currentUser as never });
    return null;
}

const mount = async (currentUser: unknown) => {
    await act(async () => {
        root.render(<Probe currentUser={currentUser} />);
    });
};

beforeEach(() => {
    liveTestStore.offlineBundles = [];
    liveTestStore.pendingSyncResults = [];
    renderSnapshot.offlineBundles = [];
    renderSnapshot.pendingSyncResults = [];
    savePendingSyncResult.mockClear();
    isOfflineQueueOwner.mockReturnValue(true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    localStorage.clear();
});

afterEach(async () => {
    await act(async () => {
        root.unmount();
    });
    container.remove();
});

describe('useOfflineQueuePersistence', () => {
    it('returns nothing — it is a pure side effect', async () => {
        await mount(USER);
        expect(returned).toBeUndefined();
    });

    it('writes the LIVE bundles, not the stale array the render closed over', async () => {
        renderSnapshot.offlineBundles = [{ id: 'previous-students-bundle' }];
        liveTestStore.offlineBundles = [{ id: 'this-students-bundle' }];
        await mount(USER);
        expect(localStorage.getItem('offlineBundles')).toBe(
            JSON.stringify([{ id: 'this-students-bundle' }]),
        );
    });

    it('does not write bundles for a signed-out visitor', async () => {
        liveTestStore.offlineBundles = [{ id: 'bundle-1' }];
        await mount(null);
        expect(localStorage.getItem('offlineBundles')).toBeNull();
    });

    it('persists the live queue and backs each entry up for its owner', async () => {
        liveTestStore.pendingSyncResults = [{ id: 'result-1' }, { id: 'result-2' }];
        await mount(USER);
        expect(localStorage.getItem('pendingSyncResults')).toBe(
            JSON.stringify([{ id: 'result-1' }, { id: 'result-2' }]),
        );
        expect(savePendingSyncResult).toHaveBeenCalledTimes(2);
        expect(savePendingSyncResult.mock.calls[0][0]).toBe('user-1');
        expect(savePendingSyncResult.mock.calls[0][1]).toMatchObject({
            id: 'result-1',
            synced: false,
        });
    });

    it('still persists locally, but uploads nothing, when this browser is not the queue owner', async () => {
        isOfflineQueueOwner.mockReturnValue(false);
        liveTestStore.pendingSyncResults = [{ id: 'result-1' }];
        await mount(USER);
        expect(localStorage.getItem('pendingSyncResults')).toBe(
            JSON.stringify([{ id: 'result-1' }]),
        );
        expect(savePendingSyncResult).not.toHaveBeenCalled();
    });
});
