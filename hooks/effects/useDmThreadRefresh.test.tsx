// @vitest-environment jsdom
/**
 * Contract test for `hooks/effects/useDmThreadRefresh`.
 *
 * What the hook promises: it returns one callback; that callback fetches threads
 * and unread counts together, maps them through `mapDmThreadFromApi`, and hands
 * the result to `updateDmThreads` as a SOFT merge — optimistic first-message
 * threads must survive a refresh.
 *
 * The two degradation rules matter more than the happy path: a failed
 * unread-count request must not fail the whole refresh, and a failed thread
 * fetch must leave the list alone rather than emptying the student's chat list.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => ({
    updateDmThreads: vi.fn(),
    fetchDmThreads: vi.fn((..._args: unknown[]) => Promise.resolve([] as unknown)),
    fetchDMUnreadCounts: vi.fn((..._args: unknown[]) => Promise.resolve({} as unknown)),
    mapDmThreadFromApi: vi.fn((row: { id: string }, counts: Record<string, number>) => ({
        id: row.id,
        unreadCount: counts[row.id] ?? 0,
    })),
    mergeDmThreadLists: vi.fn((_prev: unknown, next: unknown, _mode: string) => next),
}));

vi.mock('../../stores/groupStore', () => ({
    useGroupStore: () => ({ updateDmThreads: fx.updateDmThreads }),
}));
vi.mock('../../services/supabase', () => ({
    fetchDmThreads: fx.fetchDmThreads,
    fetchDMUnreadCounts: fx.fetchDMUnreadCounts,
}));
vi.mock('../../utils/dmThreads', () => ({
    mapDmThreadFromApi: fx.mapDmThreadFromApi,
    mergeDmThreadLists: fx.mergeDmThreadLists,
}));

import {
    useDmThreadRefresh,
    mapFetchedDmThreads,
} from './useDmThreadRefresh';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let refreshDmThreadsForUser: (userId: string) => Promise<void>;

function Probe() {
    refreshDmThreadsForUser = useDmThreadRefresh();
    return null;
}

const mount = async () => {
    await act(async () => {
        root.render(<Probe />);
    });
};

/** What `updateDmThreads` was asked to produce, given a previous list. */
const appliedTo = (previous: unknown[]) => {
    const updater = fx.updateDmThreads.mock.calls[0][0] as (prev: unknown[]) => unknown;
    return updater(previous);
};

beforeEach(() => {
    fx.updateDmThreads.mockClear();
    fx.fetchDmThreads.mockClear().mockResolvedValue([]);
    fx.fetchDMUnreadCounts.mockClear().mockResolvedValue({});
    fx.mergeDmThreadLists.mockClear();
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

describe('useDmThreadRefresh', () => {
    it('returns the refresher callback itself', async () => {
        await mount();
        expect(typeof refreshDmThreadsForUser).toBe('function');
    });

    it('fetches threads and unread counts for the user and merges them softly', async () => {
        fx.fetchDmThreads.mockResolvedValue([{ id: 'thread-1' }]);
        fx.fetchDMUnreadCounts.mockResolvedValue({ 'thread-1': 4 });
        await mount();
        await act(async () => {
            await refreshDmThreadsForUser('user-1');
        });
        expect(fx.fetchDmThreads).toHaveBeenCalledWith('user-1');
        expect(fx.fetchDMUnreadCounts).toHaveBeenCalledWith('user-1');
        appliedTo([{ id: 'optimistic' }]);
        expect(fx.mergeDmThreadLists).toHaveBeenCalledWith(
            [{ id: 'optimistic' }],
            [{ id: 'thread-1', unreadCount: 4 }],
            'soft',
        );
    });

    it('still refreshes when the unread-count request fails', async () => {
        fx.fetchDmThreads.mockResolvedValue([{ id: 'thread-1' }]);
        fx.fetchDMUnreadCounts.mockRejectedValue(new Error('counts down'));
        await mount();
        await act(async () => {
            await refreshDmThreadsForUser('user-1');
        });
        appliedTo([]);
        expect(fx.mergeDmThreadLists).toHaveBeenCalledWith(
            [],
            [{ id: 'thread-1', unreadCount: 0 }],
            'soft',
        );
    });

    it('leaves the chat list alone when the thread fetch fails', async () => {
        fx.fetchDmThreads.mockRejectedValue(new Error('threads down'));
        await mount();
        await act(async () => {
            await refreshDmThreadsForUser('user-1');
        });
        expect(fx.updateDmThreads).not.toHaveBeenCalled();
    });
});

describe('mapFetchedDmThreads', () => {
    it('folds unread counts into each mapped thread', () => {
        expect(mapFetchedDmThreads([{ id: 'thread-1' }], { 'thread-1': 2 })).toEqual([
            { id: 'thread-1', unreadCount: 2 },
        ]);
    });

    it('answers with an empty list for a non-array payload', () => {
        expect(mapFetchedDmThreads(null as never, {})).toEqual([]);
    });
});
