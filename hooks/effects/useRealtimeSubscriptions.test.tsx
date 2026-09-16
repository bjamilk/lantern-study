// @vitest-environment jsdom
/**
 * Contract test for `hooks/effects/useRealtimeSubscriptions`.
 *
 * What the hook promises:
 *  - it returns nothing, and it opens NO channel until `authTokenReady` — a
 *    channel subscribed without a live JWT passes RLS filters that silently drop
 *    every event, which is indistinguishable from "realtime is broken",
 *  - low-data mode keeps only the notifications channel, because duel and
 *    challenge alerts have to work even there,
 *  - every channel name carries the realtime epoch, and a CHANNEL_ERROR bumps
 *    that epoch so the channel is recreated with a fresh token,
 *  - a challenge notification reaches `onChallengeNotification`, a DM-ish one
 *    refreshes the thread list, and a duplicate INSERT is ignored,
 *  - every channel is removed on unmount.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Handler {
    (payload: Record<string, unknown>): void;
}

const fx = vi.hoisted(() => {
    interface FakeChannel {
        name: string;
        handlers: Array<{ filter: Record<string, string>; handler: Handler }>;
        status?: (status: string) => void;
        on: (kind: string, filter: Record<string, string>, handler: Handler) => FakeChannel;
        subscribe: (onStatus: (status: string) => void) => FakeChannel;
    }
    const channels: FakeChannel[] = [];
    const removed: FakeChannel[] = [];
    const supabase = {
        channel(name: string) {
            const channel: FakeChannel = {
                name,
                handlers: [],
                on(_kind, filter, handler) {
                    channel.handlers.push({ filter, handler });
                    return channel;
                },
                subscribe(onStatus) {
                    channel.status = onStatus;
                    return channel;
                },
            };
            channels.push(channel);
            return channel;
        },
        removeChannel: vi.fn((channel: FakeChannel) => {
            removed.push(channel);
            return Promise.resolve('ok');
        }),
    };

    const groupState = {
        groups: [{ id: 'group-1', members: [] }] as unknown[],
        updateGroups: vi.fn(),
        dmThreads: [{ id: 'thread-1' }] as unknown[],
        updateDmThreads: vi.fn(),
        updateMessages: vi.fn(),
        updateDirectMessages: vi.fn(),
        updateNotifications: vi.fn(),
        messages: {} as Record<string, unknown[]>,
    };
    const uiState = { openModal: vi.fn(), lowDataMode: false, selectedChat: null as unknown };
    const authState = { currentUser: { id: 'user-1' } as unknown, setCurrentUser: vi.fn() };
    const notesState = {
        selectedNote: null as unknown,
        loadNotes: vi.fn(() => Promise.resolve()),
        loadNote: vi.fn(() => Promise.resolve()),
        loadComments: vi.fn(() => Promise.resolve()),
    };
    const store = <T extends object>(state: T) => {
        const hook = (() => state) as (() => T) & { getState: () => T };
        hook.getState = () => state;
        return hook;
    };

    return {
        channels,
        removed,
        supabase,
        groupState,
        uiState,
        authState,
        notesState,
        store,
        fetchGroups: vi.fn((..._args: unknown[]) => Promise.resolve([] as unknown)),
        fetchGroupUnreadCounts: vi.fn((..._args: unknown[]) => Promise.resolve({} as unknown)),
        fetchMessages: vi.fn((..._args: unknown[]) => Promise.resolve([] as unknown)),
        fetchDirectMessages: vi.fn((..._args: unknown[]) => Promise.resolve([] as unknown)),
        mergeFetchedGroups: vi.fn((fetched: unknown) => fetched),
    };
});

vi.mock('../../stores/groupStore', () => ({ useGroupStore: fx.store(fx.groupState) }));
vi.mock('../../stores/uiStore', () => ({ useUIStore: fx.store(fx.uiState) }));
vi.mock('../../stores/authStore', () => ({ useAuthStore: fx.store(fx.authState) }));
vi.mock('../../stores/notesStore', () => ({ useNotesStore: fx.store(fx.notesState) }));
vi.mock('../../services/supabase', () => ({
    supabase: fx.supabase,
    fetchGroups: fx.fetchGroups,
    fetchGroupUnreadCounts: fx.fetchGroupUnreadCounts,
    fetchMessages: fx.fetchMessages,
    fetchDirectMessages: fx.fetchDirectMessages,
}));
vi.mock('../../utils/groupListMerge', () => ({ mergeFetchedGroups: fx.mergeFetchedGroups }));

import { useRealtimeSubscriptions } from './useRealtimeSubscriptions';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const USER = { id: 'user-1' } as never;
const refreshDmThreadsForUser = vi.fn(() => Promise.resolve());
const onChallengeNotification = vi.fn();

let container: HTMLDivElement;
let root: Root;
let returned: unknown;

function Probe({ currentUser, authTokenReady }: { currentUser: unknown; authTokenReady: boolean }) {
    returned = useRealtimeSubscriptions({
        currentUser: currentUser as never,
        authTokenReady,
        refreshDmThreadsForUser,
        onChallengeNotification,
    });
    return null;
}

const mount = async (currentUser: unknown = USER, authTokenReady = true) => {
    await act(async () => {
        root.render(<Probe currentUser={currentUser} authTokenReady={authTokenReady} />);
    });
};

/** The channel whose name starts with `prefix`, most recently created. */
const channelFor = (prefix: string) =>
    [...fx.channels].reverse().find((channel) => channel.name.startsWith(prefix));

/** Fire one postgres_changes handler on a channel, picked by table + event. */
const emit = (prefix: string, table: string, event: string, payload: Record<string, unknown>) => {
    const channel = channelFor(prefix)!;
    const entry = channel.handlers.find(
        (candidate) => candidate.filter.table === table && candidate.filter.event === event,
    )!;
    entry.handler(payload);
};

beforeEach(() => {
    fx.channels.length = 0;
    fx.removed.length = 0;
    fx.supabase.removeChannel.mockClear();
    fx.uiState.lowDataMode = false;
    fx.uiState.openModal.mockClear();
    fx.groupState.updateNotifications.mockClear();
    fx.groupState.updateGroups.mockClear();
    fx.fetchGroups.mockClear().mockResolvedValue([{ id: 'group-1' }]);
    fx.fetchGroupUnreadCounts.mockClear().mockResolvedValue({});
    fx.mergeFetchedGroups.mockClear();
    refreshDmThreadsForUser.mockClear();
    onChallengeNotification.mockClear();
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

describe('useRealtimeSubscriptions', () => {
    it('returns nothing — it is a pure side effect', async () => {
        await mount();
        expect(returned).toBeUndefined();
    });

    it('opens no channel at all before the auth token is ready', async () => {
        await mount(USER, false);
        expect(fx.channels).toHaveLength(0);
    });

    it('opens no channel for a signed-out visitor', async () => {
        await mount(null, false);
        expect(fx.channels).toHaveLength(0);
    });

    it('opens every channel once signed in, each stamped with the realtime epoch', async () => {
        await mount();
        const names = fx.channels.map((channel) => channel.name);
        expect(names).toEqual([
            'notifications:user-1:e0',
            'dm-threads:user-1:e0',
            'dm-messages-all:user-1:e0',
            'group-messages-all:user-1:e0',
            'notes-access:user-1:e0',
            'profile:user-1:e0',
            'group_members:user-1:e0',
        ]);
    });

    it('keeps only the notifications channel in low-data mode', async () => {
        fx.uiState.lowDataMode = true;
        await mount();
        expect(fx.channels.map((channel) => channel.name)).toEqual(['notifications:user-1:e0']);
    });

    it('recreates its channels with a fresh epoch after a CHANNEL_ERROR', async () => {
        await mount();
        await act(async () => {
            channelFor('notifications')!.status!('CHANNEL_ERROR');
        });
        expect(channelFor('notifications')!.name).toBe('notifications:user-1:e1');
        expect(fx.supabase.removeChannel).toHaveBeenCalled();
    });

    it('routes a challenge notification to the challenge handler', async () => {
        await mount();
        emit('notifications', 'notifications', 'INSERT', {
            new: { id: 'n1', type: 'challenge_received', data: { challengeId: 'c1' } },
        });
        expect(onChallengeNotification).toHaveBeenCalledWith('challenge_received', 'c1');
        expect(fx.uiState.openModal).not.toHaveBeenCalled();
    });

    it('opens the challenges modal when a challenge arrives with no id to route on', async () => {
        await mount();
        emit('notifications', 'notifications', 'INSERT', {
            new: { id: 'n1', type: 'challenge_received', data: {} },
        });
        expect(fx.uiState.openModal).toHaveBeenCalledWith('challenges');
    });

    it('refreshes the chat list when a DM notification arrives', async () => {
        await mount();
        emit('notifications', 'notifications', 'INSERT', {
            new: { id: 'n1', type: 'dm_message', data: {} },
        });
        expect(refreshDmThreadsForUser).toHaveBeenCalledWith('user-1');
    });

    it('ignores a notification it has already stored (duplicate delivery)', async () => {
        await mount();
        emit('notifications', 'notifications', 'INSERT', { new: { id: 'n1', data: {} } });
        const updater = fx.groupState.updateNotifications.mock.calls[0][0] as (
            prev: unknown[],
        ) => unknown[];
        const previous = [{ id: 'n1' }];
        expect(updater(previous)).toBe(previous);
    });

    it('refetches the whole groups list when membership changes', async () => {
        await mount();
        emit('group_members', 'group_members', '*', { new: {} });
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(fx.fetchGroups).toHaveBeenCalledWith('user-1');
        const updater = fx.groupState.updateGroups.mock.calls[0][0] as (prev: unknown) => unknown;
        updater([{ id: 'group-1', communitySurface: 'kept' }]);
        expect(fx.mergeFetchedGroups).toHaveBeenCalledWith(
            [{ id: 'group-1' }],
            [{ id: 'group-1', communitySurface: 'kept' }],
            {},
        );
    });

    it('removes every channel on unmount', async () => {
        await mount();
        const opened = fx.channels.length;
        await act(async () => {
            root.unmount();
        });
        expect(fx.supabase.removeChannel).toHaveBeenCalledTimes(opened);
        root = createRoot(container);
    });
});
