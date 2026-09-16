/**
 * Contract test for `hooks/groups/useMessageHandlers`.
 *
 * What the hook promises, and what this file pins:
 *  - `onSendMessage` posts a group message through
 *    `sendMessage(groupId, userId, text, clientMessageId)` and forwards a DM
 *    selection to `handleSendDm` instead — the reason useDmHandlers has to be
 *    composed before this hook.
 *  - a second concurrent send for the same group THROWS `MessageSendBusyError`
 *    rather than returning silently (E3 H16).
 *  - `handleEditChatMessage` / `handleRemoveChatMessage` are server-first, read
 *    the chat kind from the LIVE selection, route to the group or DM endpoint
 *    accordingly, and RETHROW so the menu can surface the failure.
 *  - `applyChatMutation` rewrites reply PREVIEWS that quote the mutated message,
 *    not just the message itself.
 *  - `handleLoadMoreMessages` pages from the oldest NON-optimistic message.
 *
 * Rendered through `hooks/effects/testing/hookHarness` (the web suite runs in
 * plain Node, with no jsdom).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactMock } from '../effects/testing/hookHarness';
import { MessageType } from '../../types';

vi.mock('react', () => reactMock);

const tx = vi.hoisted(() => ({
    sendMessage: vi.fn(async (..._args: unknown[]) => ({ id: 'server-1', timestamp: '2026-09-15T00:00:00.000Z' }) as any),
    fetchMessages: vi.fn(async (..._args: unknown[]) => [] as any),
    editGroupMessage: vi.fn(async (id: unknown, content: unknown) => ({ id, text: content, editedAt: 'now' }) as any),
    removeGroupMessage: vi.fn(async (id: unknown) => ({ id, isRemoved: true, removedAt: 'now' }) as any),
    editDirectMessage: vi.fn(async (id: unknown, content: unknown) => ({ id, text: content, editedAt: 'now' }) as any),
    removeDirectMessage: vi.fn(async (id: unknown) => ({ id, isRemoved: true, removedAt: 'now' }) as any),
}));

const ui = vi.hoisted(() => {
    const state = { selectedChat: null as any };
    const hook = (() => state) as (() => typeof state) & { getState: () => typeof state };
    hook.getState = () => state;
    return { state, hook };
});

// onSendMessage re-reads the group store through getState() to find the parent of a
// reply — the stale-closure rule these handlers are built around.
const groupStore = vi.hoisted(() => {
    const state = { messages: {} as Record<string, any[]> };
    const hook = (() => state) as (() => typeof state) & { getState: () => typeof state };
    hook.getState = () => state;
    return { state, hook };
});

vi.mock('../../services/supabase', () => ({ ...tx }));
vi.mock('../../stores/uiStore', () => ({ useUIStore: ui.hook }));
vi.mock('../../stores/groupStore', () => ({ useGroupStore: groupStore.hook }));

const { renderHook } = await import('../effects/testing/hookHarness');
const { useMessageHandlers } = await import('./useMessageHandlers');
const { MessageSendBusyError, sendingGroupIds } = await import('./deliveryIntents');

const CURRENT_USER = { id: 'user-1', name: 'Ada', avatarUrl: null } as any;
const GROUP_CHAT = { id: 'group-1', chatType: 'group' } as any;

function mount(options: { messages?: Record<string, any[]>; selectedChat?: any } = {}) {
    const state = {
        messages: options.messages ?? ({ 'group-1': [] } as Record<string, any[]>),
        groups: [{ id: 'group-1', members: [{ id: 'user-1' }, { id: 'user-2' }] }] as any[],
    };
    const handleSendDm = vi.fn(async () => undefined);
    groupStore.state.messages = state.messages;
    ui.state.selectedChat = options.selectedChat !== undefined ? options.selectedChat : GROUP_CHAT;

    const harness = renderHook(() =>
        useMessageHandlers({
            currentUser: CURRENT_USER,
            groups: state.groups as any,
            messages: state.messages,
            updateMessages: ((updater: any) => {
                state.messages = updater(state.messages);
                groupStore.state.messages = state.messages;
            }) as any,
            updateGroups: ((updater: any) => {
                state.groups = updater(state.groups);
            }) as any,
            updateDmThreads: (() => {}) as any,
            updateDirectMessages: (() => {}) as any,
            selectedChat: ui.state.selectedChat,
            lowDataMode: false,
            addNotification: vi.fn(async () => undefined),
            handleSendDm: handleSendDm as any,
        }),
    );

    return { harness, state, handleSendDm };
}

beforeEach(() => {
    for (const fn of Object.values(tx)) fn.mockClear();
    tx.sendMessage.mockResolvedValue({ id: 'server-1', timestamp: '2026-09-15T00:00:00.000Z' });
    sendingGroupIds.clear();
});

describe('useMessageHandlers', () => {
    it('returns exactly the message handlers, in order', () => {
        expect(Object.keys(mount().harness.result)).toEqual([
            'applyChatMutation',
            'handleEditChatMessage',
            'handleRemoveChatMessage',
            'onPeerChatRead',
            'onSendMessage',
            'handleLoadMoreMessages',
        ]);
    });

    it('posts a group message through sendMessage(groupId, userId, text, clientMessageId)', async () => {
        const { harness } = mount();
        await harness.result.onSendMessage('hello everyone');

        expect(tx.sendMessage).toHaveBeenCalledTimes(1);
        const [groupId, userId, text, clientMessageId] = tx.sendMessage.mock.calls[0] as any[];
        expect(groupId).toBe('group-1');
        expect(userId).toBe('user-1');
        expect(text).toBe('hello everyone');
        expect(typeof clientMessageId).toBe('string');
    });

    it('forwards a DM selection to handleSendDm instead of sendMessage', async () => {
        const { harness, handleSendDm } = mount({
            selectedChat: { id: 'thread-1', chatType: 'dm' },
        });
        await harness.result.onSendMessage('hi', { replyToMessageId: 'msg-9' });

        expect(tx.sendMessage).not.toHaveBeenCalled();
        expect(handleSendDm).toHaveBeenCalledWith('thread-1', 'hi', { replyToMessageId: 'msg-9' });
    });

    it('THROWS MessageSendBusyError rather than returning while a send is in flight', async () => {
        const { harness } = mount();
        let release: (value: unknown) => void = () => {};
        tx.sendMessage.mockImplementationOnce(
            () => new Promise((resolve) => { release = resolve; }) as any,
        );

        const first = harness.result.onSendMessage('first');
        await expect(harness.result.onSendMessage('second')).rejects.toBeInstanceOf(
            MessageSendBusyError,
        );

        release({ id: 'server-1', timestamp: '2026-09-15T00:00:00.000Z' });
        await first;
    });

    it('routes edit and remove by the LIVE selection and rethrows a failure', async () => {
        const { harness } = mount();
        await harness.result.handleEditChatMessage('msg-1', 'fixed typo');
        expect(tx.editGroupMessage).toHaveBeenCalledWith('msg-1', 'fixed typo');

        ui.state.selectedChat = { id: 'thread-1', chatType: 'dm' };
        await harness.result.handleRemoveChatMessage('msg-2');
        expect(tx.removeDirectMessage).toHaveBeenCalledWith('msg-2');

        tx.removeDirectMessage.mockRejectedValueOnce(new Error('offline'));
        await expect(harness.result.handleRemoveChatMessage('msg-3')).rejects.toThrow('offline');
    });

    it('refuses to edit with no conversation selected', async () => {
        const { harness } = mount({ selectedChat: null });
        await expect(harness.result.handleEditChatMessage('msg-1', 'x')).rejects.toThrow(
            'No conversation selected',
        );
        expect(tx.editGroupMessage).not.toHaveBeenCalled();
    });

    it('rewrites reply previews that quote an edited message, not just the message', () => {
        const { harness, state } = mount({
            messages: {
                'group-1': [
                    { id: 'msg-1', text: 'original', type: MessageType.TEXT, sender: CURRENT_USER },
                    {
                        id: 'msg-2',
                        text: 'agreed',
                        type: MessageType.TEXT,
                        sender: CURRENT_USER,
                        replyTo: { id: 'msg-1', text: 'original' },
                    },
                ],
            },
        });

        harness.result.applyChatMutation(GROUP_CHAT, {
            id: 'msg-1',
            text: 'corrected',
            editedAt: '2026-09-15T00:00:00.000Z',
        } as any);

        const list = state.messages['group-1'] ?? [];
        expect(list[0]?.text).toBe('corrected');
        expect(list[1]?.replyTo?.text).toBe('corrected');
    });

    it('pages group history from the oldest non-optimistic message', async () => {
        const { harness } = mount({
            messages: {
                'group-1': [
                    { id: 'temp-99', timestamp: new Date('2026-01-01T00:00:00.000Z') },
                    { id: 'server-5', timestamp: new Date('2026-02-01T00:00:00.000Z') },
                ],
            },
        });
        await harness.result.handleLoadMoreMessages('group-1');

        expect(tx.fetchMessages).toHaveBeenCalledTimes(1);
        const [groupId, , , beforeCursor] = tx.fetchMessages.mock.calls[0] as any[];
        expect(groupId).toBe('group-1');
        // The optimistic row is older, but the cursor comes from the server row.
        expect(String(beforeCursor)).toContain('2026-02-01');
    });

    it('does not page a group with no loaded history', async () => {
        const { harness } = mount();
        expect(await harness.result.handleLoadMoreMessages('group-1')).toBe(0);
        expect(tx.fetchMessages).not.toHaveBeenCalled();
    });
});
