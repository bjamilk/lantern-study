/**
 * The second safety net for the `hooks/useGroupHandlers.ts` decomposition, and
 * the one that guards the part `hooks/useGroupHandlers.surface.test.ts` cannot
 * see: the ~185-line effect that loads a selected chat's data.
 *
 * The surface test proves the composed hook still RETURNS the right members. It
 * says nothing about the effects the hook registers, so the chat-data effect
 * could be dropped entirely and the surface would still be green. This file
 * pins that effect's observable behaviour instead — which transport functions it
 * calls when a chat becomes selected, with what arguments, in what order, and
 * what it does on unmount — against the UNTOUCHED composer, so the move into
 * `hooks/groups/useChatDataSync` is provably behaviour-preserving.
 *
 * What it pins:
 *  - nothing is fetched before `ensureAuthTokenReady()` answers true (a deep link
 *    can land before session bootstrap finishes),
 *  - GROUP selection → `fetchMessages(chatId, undefined, limit)` with the
 *    low-data page size, `fetchUserVotesForGroup(chatId, userId)` and ONE
 *    `markGroupAsRead(chatId, userId)` per chat — the second render of the same
 *    chat must not re-mark it, or the "new messages" divider is lost,
 *  - the mark-as-read answer becomes `unreadAnchorAt`, and switching chats
 *    clears it back to the pending tri-state,
 *  - DM selection → `markDMAsRead(threadId, userId)` plus
 *    `fetchDirectMessages(userId, peerId)`, with the peer resolved from the
 *    selection, then the store row, then the composite `<idA>-<idB>` thread id,
 *  - an unresolvable peer refreshes the threads list (`fetchDmThreads`) rather
 *    than fetching nothing,
 *  - unmount cancels: a response that lands after the cleanup ran writes neither
 *    the unread anchor nor the message cache.
 *
 * Rendered through `hooks/effects/testing/hookHarness` (the web suite runs in
 * plain Node, with no jsdom), exactly as the surface test renders it.
 *
 * Reading order for a reviewer: `hooks/useGroupHandlers.surface.test.ts` first,
 * then this file, then the composer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactMock } from './effects/testing/hookHarness';
import { storeMock } from './effects/testing/storeFixtures';

vi.mock('react', () => reactMock);

/**
 * The transport surface the chat-data effect reaches for. Spied individually so
 * an assertion can name the call; every other `services/supabase` export the
 * composer imports is a silent stub, because importing the real module pulls in
 * the Supabase client and the cookie-mode fetch interceptor at module load.
 */
const tx = vi.hoisted(() => ({
    ensureAuthTokenReady: vi.fn(async () => true),
    fetchMessages: vi.fn(async (..._args: unknown[]) => [] as any[]),
    fetchUserVotesForGroup: vi.fn(async (..._args: unknown[]) => ({}) as any),
    markGroupAsRead: vi.fn(async (..._args: unknown[]) => ({ previousLastReadAt: null }) as any),
    markDMAsRead: vi.fn(async (..._args: unknown[]) => ({ previousLastReadAt: null }) as any),
    fetchDirectMessages: vi.fn(async (..._args: unknown[]) => [] as any[]),
    fetchDmThreads: vi.fn(async (..._args: unknown[]) => [] as any[]),
    fetchGroupMembers: vi.fn(async (..._args: unknown[]) => [] as any[]),
}));

const SILENT_TRANSPORT_NAMES = [
    'createGroup', 'fetchGroups', 'addGroupMember', 'addGroupMembersBatch',
    'uploadGroupAvatar', 'acceptGroupInvite', 'declineGroupInvite',
    'sendMessage', 'voteQuestion', 'removeVote', 'updateMessage', 'updateQuestionStatus',
    'createNotification', 'updateUserProfile', 'deleteGroup', 'updateGroup',
    'promoteGroupAdmin', 'demoteGroupAdmin', 'sendDirectMessage',
    'markNotificationAsRead', 'markAllNotificationsAsRead', 'deleteAllNotifications',
    'deleteDmThread', 'archiveDmThread', 'unarchiveDmThread', 'fetchUserProfile',
    'editGroupMessage', 'removeGroupMessage', 'editDirectMessage',
    'removeDirectMessage', 'removeGroupMember', 'leaveGroup',
] as const;

vi.mock('../services/supabase', () => {
    const module: Record<string, unknown> = { ...tx };
    for (const name of SILENT_TRANSPORT_NAMES) module[name] = vi.fn(async () => undefined);
    return module;
});

vi.mock('../services/gamificationStreak', () => ({
    syncGamificationProgress: vi.fn(async () => null),
}));

vi.mock('../utils/appNavigation', () => ({ navigateForAppMode: vi.fn() }));

vi.mock('../stores/confirmStore', () => ({ confirmDialog: vi.fn(async () => false) }));

const CURRENT_USER = { id: 'user-1', name: 'Ada', stats: {}, settings: {} } as any;

const storeState = {
    auth: { currentUser: CURRENT_USER, setCurrentUser: vi.fn() },
    group: {
        groups: [] as any[],
        updateGroups: vi.fn(),
        messages: {} as Record<string, any[]>,
        updateMessages: vi.fn(),
        dmThreads: [] as any[],
        updateDmThreads: vi.fn(),
        directMessages: {} as Record<string, any[]>,
        updateDirectMessages: vi.fn(),
        userVotes: {} as Record<string, unknown>,
        updateUserVotes: vi.fn(),
        notifications: [] as any[],
        updateNotifications: vi.fn(),
        setNotifications: vi.fn(),
    },
    ui: {
        appMode: 'CHAT',
        setAppMode: vi.fn(),
        selectedChat: null as any,
        setSelectedChat: vi.fn(),
        setActiveCommunity: vi.fn(),
        modals: {} as Record<string, boolean>,
        openModal: vi.fn(),
        closeModal: vi.fn(),
        setSubgroupParentId: vi.fn(),
        setDuplicateInfo: vi.fn(),
        setActiveTestConfigMode: vi.fn(),
        setChallengeOpponent: vi.fn(),
        lowDataMode: false,
    },
    toast: { showToast: vi.fn() },
};

vi.mock('../stores/authStore', () => ({ useAuthStore: storeMock(storeState.auth) }));
vi.mock('../stores/groupStore', () => ({ useGroupStore: storeMock(storeState.group) }));
vi.mock('../stores/uiStore', () => ({ useUIStore: storeMock(storeState.ui) }));
vi.mock('../stores/toastStore', () => ({ useToastStore: storeMock(storeState.toast) }));

const { renderHook } = await import('./effects/testing/hookHarness');
const { useGroupHandlers } = await import('./useGroupHandlers');

/** Drain the microtask queue; the load is a chain of awaits, not a timer. */
const flush = async () => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
};

/** Render the composer with `chat` selected and let the load effect settle. */
async function mountWith(chat: any, options: { lowDataMode?: boolean } = {}) {
    storeState.ui.selectedChat = chat;
    storeState.ui.lowDataMode = options.lowDataMode ?? false;
    const harness = renderHook(() => useGroupHandlers({ users: [] }));
    harness.runEffects();
    await flush();
    return harness;
}

/** Move the selection and re-run the effects, as a chat switch does. */
async function selectInstead(harness: { render: () => unknown; runEffects: () => void }, chat: any) {
    storeState.ui.selectedChat = chat;
    harness.render();
    harness.runEffects();
    await flush();
}

const GROUP_CHAT = { id: 'group-1', chatType: 'group', name: 'Chem 101' } as any;

beforeEach(() => {
    vi.clearAllMocks();
    tx.ensureAuthTokenReady.mockResolvedValue(true);
    tx.fetchMessages.mockResolvedValue([]);
    tx.fetchUserVotesForGroup.mockResolvedValue({});
    tx.markGroupAsRead.mockResolvedValue({ previousLastReadAt: null });
    tx.markDMAsRead.mockResolvedValue({ previousLastReadAt: null });
    tx.fetchDirectMessages.mockResolvedValue([]);
    tx.fetchDmThreads.mockResolvedValue([]);
    tx.fetchGroupMembers.mockResolvedValue([]);
    storeState.group.dmThreads = [];
    storeState.group.messages = {};
    storeState.ui.selectedChat = null;
    storeState.ui.lowDataMode = false;
});

describe('useGroupHandlers chat-data load', () => {
    it('fetches nothing until the auth token is ready', async () => {
        tx.ensureAuthTokenReady.mockResolvedValue(false);
        await mountWith(GROUP_CHAT);

        expect(tx.ensureAuthTokenReady).toHaveBeenCalled();
        expect(tx.fetchMessages).not.toHaveBeenCalled();
        expect(tx.markGroupAsRead).not.toHaveBeenCalled();
    });

    it('loads a selected group: messages, votes and one mark-as-read', async () => {
        await mountWith(GROUP_CHAT);

        expect(tx.fetchMessages).toHaveBeenCalledWith('group-1', undefined, 50);
        expect(tx.fetchUserVotesForGroup).toHaveBeenCalledWith('group-1', 'user-1');
        expect(tx.markGroupAsRead).toHaveBeenCalledWith('group-1', 'user-1');
    });

    it('uses the low-data page size when low-data mode is on', async () => {
        await mountWith(GROUP_CHAT, { lowDataMode: true });
        expect(tx.fetchMessages).toHaveBeenCalledWith('group-1', undefined, 20);
    });

    it('merges the fetched page into the message cache under the chat id', async () => {
        tx.fetchMessages.mockResolvedValue([
            { id: 'msg-1', group_id: 'group-1', user_id: 'user-2', content: 'hi', created_at: '2026-09-15T00:00:00.000Z' },
        ] as any);
        const written: Array<Record<string, any[]>> = [];
        storeState.group.updateMessages = vi.fn((updater: any) => {
            written.push(updater(storeState.group.messages));
        });

        await mountWith(GROUP_CHAT);

        expect(written.length).toBeGreaterThan(0);
        const last = written[written.length - 1];
        expect(Object.keys(last)).toContain('group-1');
        expect(last['group-1'].map((m: any) => m.id)).toEqual(['msg-1']);
    });

    it('does not re-mark the same group as read on a second render', async () => {
        const harness = await mountWith(GROUP_CHAT);
        harness.render();
        harness.runEffects();
        await flush();

        expect(tx.markGroupAsRead).toHaveBeenCalledTimes(1);
    });

    it('publishes the mark-as-read answer as the unread anchor, and clears it on a switch', async () => {
        tx.markGroupAsRead.mockResolvedValue({ previousLastReadAt: '2026-09-14T12:00:00.000Z' });
        const harness = await mountWith(GROUP_CHAT);

        expect((harness.result as any).unreadAnchorAt).toBe('2026-09-14T12:00:00.000Z');

        // A different chat has no answer yet: `undefined`, the pending tri-state
        // — the divider must be neither drawn nor ruled out.
        tx.markGroupAsRead.mockImplementation(() => new Promise(() => {}) as any);
        await selectInstead(harness, { id: 'group-2', chatType: 'group' });

        expect((harness.result as any).unreadAnchorAt).toBeUndefined();
    });

    it('loads a selected DM: mark-as-read plus the thread history for the peer', async () => {
        await mountWith({ id: 'thread-1', chatType: 'dm', participantIds: ['user-1', 'user-9'] });

        expect(tx.markDMAsRead).toHaveBeenCalledWith('thread-1', 'user-1');
        expect(tx.fetchDirectMessages).toHaveBeenCalledWith('user-1', 'user-9');
    });

    it('falls back to the store row for the peer when the selection carries none', async () => {
        storeState.group.dmThreads = [{ id: 'thread-1', participantIds: ['user-1', 'user-7'] }] as any[];
        await mountWith({ id: 'thread-1', chatType: 'dm', participantIds: [] });

        expect(tx.fetchDirectMessages).toHaveBeenCalledWith('user-1', 'user-7');
    });

    it('derives the peer from the composite thread id when the threads list has not loaded', async () => {
        await mountWith({ id: 'user-1-user-5', chatType: 'dm', participantIds: [] });

        expect(tx.fetchDirectMessages).toHaveBeenCalledWith('user-1', 'user-5');
    });

    it('refreshes the threads list when the peer cannot be resolved at all', async () => {
        await mountWith({ id: 'opaque-thread', chatType: 'dm', participantIds: [] });

        expect(tx.fetchDmThreads).toHaveBeenCalledWith('user-1');
        expect(tx.fetchDirectMessages).not.toHaveBeenCalled();
    });

    it('cancels on unmount: a late mark-as-read writes no anchor', async () => {
        let resolveMark: (value: any) => void = () => {};
        tx.markGroupAsRead.mockImplementation(
            () => new Promise((resolve) => { resolveMark = resolve; }) as any,
        );

        const harness = await mountWith(GROUP_CHAT);
        harness.unmount();
        resolveMark({ previousLastReadAt: '2026-09-14T12:00:00.000Z' });
        await flush();

        // Still the pending tri-state, not the answer that arrived after cleanup.
        expect((harness.result as any).unreadAnchorAt).toBeUndefined();
    });
});
