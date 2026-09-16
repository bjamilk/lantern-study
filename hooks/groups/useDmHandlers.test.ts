/**
 * Contract test for `hooks/groups/useDmHandlers`.
 *
 * What the hook promises, and what this file pins:
 *  - `handleInitiateDm` derives the thread id from the two user ids SORTED and
 *    joined, so both sides reach the same conversation without a round trip, and
 *    invents a `clientPending` thread locally rather than writing a server row.
 *  - `handleSendDm` posts through `sendDirectMessage(...)` and THROWS
 *    `MessageSendBusyError` while a send for the same thread is in flight — it
 *    must never return silently, because the composer clears the student's text
 *    before awaiting and restores it only from a rejection (F1 · E3 H16).
 *  - `handleDeleteDmThread` / `handleArchiveDmThread` / `handleUnarchiveDmThread`
 *    each hit their own endpoint with `(threadId, userId)`, after waiting on
 *    `ensureAuthTokenReady`.
 *  - `handleLoadMoreDirectMessages` pages by the count of SERVER messages only —
 *    counting optimistic rows would inflate the offset and skip older history.
 *
 * Rendered through `hooks/effects/testing/hookHarness` (the web suite runs in
 * plain Node, with no jsdom).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactMock } from '../effects/testing/hookHarness';

vi.mock('react', () => reactMock);

const tx = vi.hoisted(() => ({
    fetchUserProfile: vi.fn(async (..._args: unknown[]) => null as any),
    fetchDmThreads: vi.fn(async (..._args: unknown[]) => [] as any),
    sendDirectMessage: vi.fn(async (..._args: unknown[]) => ({ id: 'dm-server-1', timestamp: '2026-09-15T00:00:00.000Z' }) as any),
    fetchDirectMessages: vi.fn(async (..._args: unknown[]) => [] as any),
    deleteDmThread: vi.fn(async (..._args: unknown[]) => true as any),
    archiveDmThread: vi.fn(async (..._args: unknown[]) => true as any),
    unarchiveDmThread: vi.fn(async (..._args: unknown[]) => true as any),
    ensureAuthTokenReady: vi.fn(async () => undefined as any),
}));

const stores = vi.hoisted(() => {
    const group = {
        directMessages: {} as Record<string, any[]>,
        dmThreads: [] as any[],
        dmHistoryClearedAtByThread: {} as Record<string, string>,
        removeDmThread: vi.fn(),
        markDmHistoryCleared: vi.fn(),
        archiveDmThread: vi.fn(),
        unarchiveDmThread: vi.fn(),
    };
    const ui = { selectedChat: null as any };
    const toast = { showToast: vi.fn() };
    // The real bound store also carries `setState`: handleSendDm uses it to clear
    // the delete-for-me cutoff for a thread the student has just messaged again.
    const bind = <T extends object>(state: T) => {
        const hook = (() => state) as (() => T) & {
            getState: () => T;
            setState: (patch: Partial<T> | ((prev: T) => Partial<T>)) => void;
        };
        hook.getState = () => state;
        hook.setState = (patch) => {
            Object.assign(state, typeof patch === 'function' ? patch(state) : patch);
        };
        return hook;
    };
    return { group, ui, toast, bind };
});

vi.mock('../../services/supabase', () => ({ ...tx }));
vi.mock('../../stores/groupStore', () => ({ useGroupStore: stores.bind(stores.group) }));
vi.mock('../../stores/uiStore', () => ({ useUIStore: stores.bind(stores.ui) }));
vi.mock('../../stores/toastStore', () => ({ useToastStore: stores.bind(stores.toast) }));

const { renderHook } = await import('../effects/testing/hookHarness');
const { useDmHandlers } = await import('./useDmHandlers');
const { MessageSendBusyError, sendingThreadIds } = await import('./deliveryIntents');

const CURRENT_USER = { id: 'user-b', name: 'Ada', avatarUrl: null } as any;

function mount(options: { dmThreads?: any[]; users?: any[] } = {}) {
    const state = {
        threads: options.dmThreads ?? ([] as any[]),
        directMessages: {} as Record<string, any[]>,
    };
    const handleSelectChat = vi.fn();
    const setSelectedChat = vi.fn();

    const harness = renderHook(() =>
        useDmHandlers({
            currentUser: CURRENT_USER,
            users: options.users ?? ([{ id: 'user-a', name: 'Grace', avatarUrl: null }] as any),
            groups: [] as any,
            dmThreads: state.threads as any,
            updateDmThreads: ((updater: any) => {
                state.threads = updater(state.threads);
                stores.group.dmThreads = state.threads;
            }) as any,
            updateDirectMessages: ((updater: any) => {
                state.directMessages = updater(state.directMessages);
                stores.group.directMessages = state.directMessages;
            }) as any,
            setSelectedChat: setSelectedChat as any,
            lowDataMode: false,
            handleSelectChat,
        }),
    );

    return { harness, state, handleSelectChat, setSelectedChat };
}

beforeEach(() => {
    for (const fn of Object.values(tx)) fn.mockClear();
    stores.group.directMessages = {};
    stores.group.dmThreads = [];
    stores.group.dmHistoryClearedAtByThread = {};
    stores.ui.selectedChat = null;
    sendingThreadIds.clear();
});

describe('useDmHandlers', () => {
    it('returns exactly the seven DM handlers, in order', () => {
        expect(Object.keys(mount().harness.result)).toEqual([
            'handleInitiateDm',
            'handleSendDm',
            'handleDmThreadStatusChange',
            'handleDeleteDmThread',
            'handleArchiveDmThread',
            'handleUnarchiveDmThread',
            'handleLoadMoreDirectMessages',
        ]);
    });

    it('derives the thread id from the sorted user ids and opens it locally', async () => {
        const { harness, state, handleSelectChat } = mount();
        await harness.result.handleInitiateDm('user-a');

        // 'user-a' sorts before 'user-b' even though the current user is second.
        expect(state.threads.map((t: any) => t.id)).toEqual(['user-a-user-b']);
        expect(state.threads[0]).toMatchObject({ clientPending: true });
        expect(handleSelectChat).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'user-a-user-b', chatType: 'dm' }),
        );
    });

    it('refuses to open a conversation with yourself', async () => {
        const { harness, handleSelectChat } = mount();
        await harness.result.handleInitiateDm('user-b');
        expect(handleSelectChat).not.toHaveBeenCalled();
        expect(tx.fetchDmThreads).not.toHaveBeenCalled();
    });

    it('sends through sendDirectMessage with a minted clientMessageId', async () => {
        const { harness } = mount({
            dmThreads: [{ id: 'user-a-user-b', participantIds: ['user-a', 'user-b'], participants: {} }],
        });
        await harness.result.handleSendDm('user-a-user-b', 'hello');

        expect(tx.sendDirectMessage).toHaveBeenCalledTimes(1);
        const args = tx.sendDirectMessage.mock.calls[0] as any[];
        expect(args).toContain('hello');
        // The recipient and a non-empty clientMessageId both travel with the send.
        expect(args).toContain('user-a');
        expect(args.some((a) => typeof a === 'string' && a.length > 10)).toBe(true);
    });

    it('THROWS MessageSendBusyError rather than returning while a send is in flight', async () => {
        const { harness } = mount({
            dmThreads: [{ id: 'user-a-user-b', participantIds: ['user-a', 'user-b'], participants: {} }],
        });
        let release: (value: unknown) => void = () => {};
        tx.sendDirectMessage.mockImplementationOnce(
            () => new Promise((resolve) => { release = resolve; }) as any,
        );

        const first = harness.result.handleSendDm('user-a-user-b', 'first');
        await expect(harness.result.handleSendDm('user-a-user-b', 'second')).rejects.toBeInstanceOf(
            MessageSendBusyError,
        );

        release({ id: 'dm-server-1', timestamp: '2026-09-15T00:00:00.000Z' });
        await first;
    });

    it('deletes, archives and unarchives through their own endpoints', async () => {
        const { harness } = mount();
        await harness.result.handleDeleteDmThread('thread-1');
        await harness.result.handleArchiveDmThread('thread-1');
        await harness.result.handleUnarchiveDmThread('thread-1');

        expect(tx.deleteDmThread).toHaveBeenCalledWith('thread-1', 'user-b');
        expect(tx.archiveDmThread).toHaveBeenCalledWith('thread-1', 'user-b');
        expect(tx.unarchiveDmThread).toHaveBeenCalledWith('thread-1', 'user-b');
        expect(tx.ensureAuthTokenReady).toHaveBeenCalledTimes(3);
    });

    it('reports a failed delete by toast and does NOT roll the removal back', async () => {
        const { harness } = mount();
        tx.deleteDmThread.mockResolvedValueOnce(false);
        await harness.result.handleDeleteDmThread('thread-1');

        expect(stores.group.removeDmThread).toHaveBeenCalledWith('thread-1');
        expect(stores.toast.showToast).toHaveBeenCalledWith(expect.stringContaining('delete'), 'error');
    });

    it('pages DM history by the count of SERVER messages, ignoring optimistic rows', async () => {
        const { harness } = mount();
        stores.group.dmThreads = [{ id: 'user-a-user-b', participantIds: ['user-a', 'user-b'] }];
        // 50 server rows plus one optimistic row: the next page is 2, not 3.
        stores.group.directMessages = {
            'user-a-user-b': [
                ...Array.from({ length: 50 }, (_, i) => ({ id: `server-${i}` })),
                { id: 'temp-1' },
            ],
        };

        await harness.result.handleLoadMoreDirectMessages('user-a-user-b');

        expect(tx.fetchDirectMessages).toHaveBeenCalledWith('user-b', 'user-a', { page: 2, limit: 50 });
    });

    it('does not page a thread with no loaded history', async () => {
        const { harness } = mount();
        expect(await harness.result.handleLoadMoreDirectMessages('user-a-user-b')).toBe(0);
        expect(tx.fetchDirectMessages).not.toHaveBeenCalled();
    });

    it('patches the thread status locally without a round trip', () => {
        const { harness, state } = mount({ dmThreads: [{ id: 'thread-1', status: 'pending' }] });
        harness.result.handleDmThreadStatusChange('thread-1', { status: 'open' });

        expect(state.threads[0]).toMatchObject({ status: 'open' });
        expect(tx.sendDirectMessage).not.toHaveBeenCalled();
    });
});
