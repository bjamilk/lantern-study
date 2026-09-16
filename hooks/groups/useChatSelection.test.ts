/**
 * Contract test for `hooks/groups/useChatSelection`.
 *
 * What the hook promises, and what this file pins:
 *  - selecting a chat sets it as the selection, clears the active community and
 *    navigates to the chat surface — unless `keepSurface` is passed, which is the
 *    community-channel path: same selection, same fetches, no navigation and no
 *    community teardown (the founder rule that a community owns its chat),
 *  - a GROUP selection fetches the user's votes and BUSTS the roster cache
 *    (`fetchGroupMembers(id, { bustCache: true })`), writing the mapped roster
 *    into both the selection and the groups list — and does NOT mark the group
 *    read, because the chat-data sync owns that single path,
 *  - a DM selection marks the thread read, zeroes its unread count, and loads the
 *    peer's history,
 *  - the DM load is sequence-guarded through the returned `dmFetchSeqRef` and
 *    re-checked against the LIVE selection, so a slow response for a chat the
 *    student has left never writes into the chat now on screen. The ref is
 *    returned, not private, because the chat-data sync bumps the same counter.
 *
 * Rendered through `hooks/effects/testing/hookHarness` (the web suite runs in
 * plain Node, with no jsdom).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactMock } from '../effects/testing/hookHarness';
import { AppMode } from '../../types';

vi.mock('react', () => reactMock);

const tx = vi.hoisted(() => ({
    fetchUserVotesForGroup: vi.fn(async (..._args: unknown[]) => ({ 'msg-1': 'up' }) as any),
    fetchGroupMembers: vi.fn(async (..._args: unknown[]) => [] as any[]),
    markDMAsRead: vi.fn(async (..._args: unknown[]) => ({ previousLastReadAt: null }) as any),
    fetchDirectMessages: vi.fn(async (..._args: unknown[]) => [] as any[]),
    navigateForAppMode: vi.fn(),
}));

vi.mock('../../services/supabase', () => ({
    fetchUserVotesForGroup: tx.fetchUserVotesForGroup,
    fetchGroupMembers: tx.fetchGroupMembers,
    markDMAsRead: tx.markDMAsRead,
    fetchDirectMessages: tx.fetchDirectMessages,
}));
vi.mock('../../utils/appNavigation', () => ({ navigateForAppMode: tx.navigateForAppMode }));

const uiState = vi.hoisted(() => ({
    selectedChat: null as any,
    setActiveCommunity: vi.fn(),
}));
vi.mock('../../stores/uiStore', () => {
    const hook = (() => uiState) as any;
    hook.getState = () => uiState;
    return { useUIStore: hook };
});

const { renderHook } = await import('../effects/testing/hookHarness');
const { useChatSelection } = await import('./useChatSelection');

const CURRENT_USER = { id: 'user-1', name: 'Ada' } as any;

const flush = async () => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
};

function mount() {
    const calls = {
        setSelectedChat: vi.fn(),
        updateMessages: vi.fn(),
        updateUserVotes: vi.fn(),
        updateGroups: vi.fn(),
        updateDmThreads: vi.fn(),
        updateDirectMessages: vi.fn(),
    };
    const harness = renderHook(() =>
        useChatSelection({
            currentUser: CURRENT_USER,
            updateMessages: calls.updateMessages as any,
            updateUserVotes: calls.updateUserVotes as any,
            updateGroups: calls.updateGroups as any,
            updateDmThreads: calls.updateDmThreads as any,
            updateDirectMessages: calls.updateDirectMessages as any,
            setSelectedChat: calls.setSelectedChat as any,
            lowDataMode: false,
        }),
    );
    return { harness, calls };
}

const GROUP = { id: 'group-1', chatType: 'group', name: 'Chem 101' } as any;
const THREAD = { id: 'thread-1', chatType: 'dm', participantIds: ['user-1', 'user-9'] } as any;

beforeEach(() => {
    vi.clearAllMocks();
    tx.fetchUserVotesForGroup.mockResolvedValue({ 'msg-1': 'up' });
    tx.fetchGroupMembers.mockResolvedValue([]);
    tx.markDMAsRead.mockResolvedValue({ previousLastReadAt: null });
    tx.fetchDirectMessages.mockResolvedValue([]);
    uiState.selectedChat = null;
});

describe('useChatSelection', () => {
    it('returns the selection path, the back action and the shared DM sequence ref', () => {
        const { harness } = mount();
        expect(Object.keys(harness.result)).toEqual([
            'handleSelectChat',
            'handleChatBack',
            'dmFetchSeqRef',
        ]);
        expect(harness.result.dmFetchSeqRef.current).toBe(0);
    });

    it('selects a group, clears the community column and navigates to the chat', async () => {
        const { harness, calls } = mount();
        harness.result.handleSelectChat(GROUP);
        await flush();

        expect(calls.setSelectedChat).toHaveBeenCalledWith(GROUP);
        expect(uiState.setActiveCommunity).toHaveBeenCalledWith(null);
        expect(tx.navigateForAppMode).toHaveBeenCalledWith(AppMode.CHAT, { groupId: 'group-1' });
    });

    it('keepSurface selects the group without navigating or closing the community', async () => {
        const { harness, calls } = mount();
        harness.result.handleSelectChat(GROUP, { keepSurface: true });
        await flush();

        expect(calls.setSelectedChat).toHaveBeenCalledWith(GROUP);
        expect(uiState.setActiveCommunity).not.toHaveBeenCalled();
        expect(tx.navigateForAppMode).not.toHaveBeenCalled();
        // Same fetches as the chats-list path — that is the whole point of the flag.
        expect(tx.fetchUserVotesForGroup).toHaveBeenCalledWith('group-1', 'user-1');
        expect(tx.fetchGroupMembers).toHaveBeenCalledWith('group-1', { bustCache: true });
    });

    it('busts the roster cache and writes the roster into the selection and the group', async () => {
        tx.fetchGroupMembers.mockResolvedValue([
            { user_id: 'user-9', role: 'member', profiles: { id: 'user-9', name: 'Bo' } },
        ] as any);
        const { harness, calls } = mount();
        harness.result.handleSelectChat(GROUP);
        await flush();

        expect(tx.fetchGroupMembers).toHaveBeenCalledWith('group-1', { bustCache: true });
        expect(calls.updateGroups).toHaveBeenCalled();
        const updater = (calls.updateGroups.mock.calls[0] as any[])[0] as any;
        expect(updater([{ id: 'group-1', members: [] }])[0].members).toHaveLength(1);
    });

    it('does not mark a group read — the chat-data sync owns that single path', async () => {
        const { harness } = mount();
        harness.result.handleSelectChat(GROUP);
        await flush();

        expect(tx.markDMAsRead).not.toHaveBeenCalled();
    });

    it('selects a DM: marks it read, zeroes its unread count and loads the peer history', async () => {
        uiState.selectedChat = THREAD;
        const { harness, calls } = mount();
        harness.result.handleSelectChat(THREAD);
        await flush();

        expect(tx.navigateForAppMode).toHaveBeenCalledWith(AppMode.CHAT, { threadId: 'thread-1' });
        expect(tx.markDMAsRead).toHaveBeenCalledWith('thread-1', 'user-1');
        const zeroed = ((calls.updateDmThreads.mock.calls[0] as any[])[0] as any)([
            { id: 'thread-1', unreadCount: 4 },
        ]);
        expect(zeroed[0].unreadCount).toBe(0);
        expect(tx.fetchDirectMessages).toHaveBeenCalledWith('user-1', 'user-9');
        expect(calls.updateDirectMessages).toHaveBeenCalled();
    });

    it('drops a DM page that lands after the student moved to another chat', async () => {
        uiState.selectedChat = { id: 'thread-2', chatType: 'dm' };
        const { harness, calls } = mount();
        harness.result.handleSelectChat(THREAD);
        await flush();

        expect(tx.fetchDirectMessages).toHaveBeenCalled();
        expect(calls.updateDirectMessages).not.toHaveBeenCalled();
    });

    it('drops a DM page superseded by a newer request on the shared sequence ref', async () => {
        uiState.selectedChat = THREAD;
        const { harness, calls } = mount();
        harness.result.handleSelectChat(THREAD);
        // The chat-data sync bumping the SAME counter is what invalidates this page.
        harness.result.dmFetchSeqRef.current += 1;
        await flush();

        expect(calls.updateDirectMessages).not.toHaveBeenCalled();
    });

    it('handleChatBack replaces the URL with the chat list', () => {
        const { harness } = mount();
        harness.result.handleChatBack();
        expect(tx.navigateForAppMode).toHaveBeenCalledWith(AppMode.CHAT, {}, { replace: true });
    });
});
