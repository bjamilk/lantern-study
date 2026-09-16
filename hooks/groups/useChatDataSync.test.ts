/**
 * Contract test for `hooks/groups/useChatDataSync`.
 *
 * `hooks/useGroupHandlers.chatData.test.ts` already pins what this load DOES,
 * through the composed hook — that is the behaviour lock, and it was written
 * against the untouched composer. This file pins what the extracted module is:
 *
 *  - it returns exactly `unreadAnchorAt`, nothing else, so the composer has one
 *    thing to forward,
 *  - it registers exactly TWO effects, the anchor-clear before the load, in that
 *    order, with the dependency lists they had in the composer — the order the
 *    banner's effect-order argument rests on,
 *  - it bumps the `dmFetchSeqRef` it was PASSED rather than one of its own, which
 *    is what lets a list tap in `./useChatSelection` and a deep-link load here
 *    cancel each other,
 *  - a chat with no mark-as-read answer yet reads `undefined`, not `null`: the
 *    tri-state the divider depends on.
 *
 * Rendered through `hooks/effects/testing/hookHarness` (the web suite runs in
 * plain Node, with no jsdom).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactMock } from '../effects/testing/hookHarness';

vi.mock('react', () => reactMock);

const tx = vi.hoisted(() => ({
    ensureAuthTokenReady: vi.fn(async () => true),
    fetchMessages: vi.fn(async (..._args: unknown[]) => [] as any[]),
    fetchUserVotesForGroup: vi.fn(async (..._args: unknown[]) => ({}) as any),
    markGroupAsRead: vi.fn(async (..._args: unknown[]) => ({ previousLastReadAt: null }) as any),
    markDMAsRead: vi.fn(async (..._args: unknown[]) => ({ previousLastReadAt: null }) as any),
    fetchDirectMessages: vi.fn(async (..._args: unknown[]) => [] as any[]),
    fetchDmThreads: vi.fn(async (..._args: unknown[]) => [] as any[]),
}));

vi.mock('../../services/supabase', () => ({ ...tx }));

const groupState = vi.hoisted(() => ({ dmThreads: [] as any[] }));
vi.mock('../../stores/groupStore', () => {
    const hook = (() => groupState) as any;
    hook.getState = () => groupState;
    return { useGroupStore: hook };
});

const uiState = vi.hoisted(() => ({ selectedChat: null as any }));
vi.mock('../../stores/uiStore', () => {
    const hook = (() => uiState) as any;
    hook.getState = () => uiState;
    return { useUIStore: hook };
});

const { renderHook } = await import('../effects/testing/hookHarness');
const { useChatDataSync } = await import('./useChatDataSync');

const CURRENT_USER = { id: 'user-1', name: 'Ada' } as any;
const GROUP = { id: 'group-1', chatType: 'group' } as any;

const flush = async () => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
};

function mount(chat: any) {
    uiState.selectedChat = chat;
    const dmFetchSeqRef = { current: 0 };
    const harness = renderHook(() =>
        useChatDataSync({
            currentUser: CURRENT_USER,
            updateMessages: vi.fn() as any,
            updateUserVotes: vi.fn() as any,
            updateGroups: vi.fn() as any,
            updateDmThreads: vi.fn() as any,
            updateDirectMessages: vi.fn() as any,
            selectedChat: chat,
            lowDataMode: false,
            dmFetchSeqRef,
        }),
    );
    return { harness, dmFetchSeqRef };
}

beforeEach(() => {
    vi.clearAllMocks();
    tx.ensureAuthTokenReady.mockResolvedValue(true);
    tx.fetchMessages.mockResolvedValue([]);
    tx.fetchUserVotesForGroup.mockResolvedValue({});
    tx.markGroupAsRead.mockResolvedValue({ previousLastReadAt: null });
    tx.markDMAsRead.mockResolvedValue({ previousLastReadAt: null });
    tx.fetchDirectMessages.mockResolvedValue([]);
    tx.fetchDmThreads.mockResolvedValue([]);
    groupState.dmThreads = [];
    uiState.selectedChat = null;
});

describe('useChatDataSync', () => {
    it('returns only the unread anchor', () => {
        const { harness } = mount(null);
        expect(Object.keys(harness.result)).toEqual(['unreadAnchorAt']);
    });

    it('registers the anchor-clear effect before the load effect, and only those two', () => {
        const { harness } = mount(GROUP);
        expect(harness.effectSignatures).toEqual([
            '["group-1", "group"]',
            '["group-1", "group", "user-1", false, fn:spy, fn:spy, fn:spy, fn:spy, fn:spy]',
        ]);
    });

    it('bumps the DM sequence counter it was passed, not one of its own', async () => {
        const { harness, dmFetchSeqRef } = mount({
            id: 'thread-1',
            chatType: 'dm',
            participantIds: ['user-1', 'user-9'],
        });
        harness.runEffects();
        await flush();

        expect(tx.fetchDirectMessages).toHaveBeenCalledWith('user-1', 'user-9');
        expect(dmFetchSeqRef.current).toBe(1);
    });

    it('reads undefined — not null — while the mark-as-read round trip is unanswered', async () => {
        tx.markGroupAsRead.mockImplementation(() => new Promise(() => {}) as any);
        const { harness } = mount(GROUP);
        harness.runEffects();
        await flush();

        expect(harness.result.unreadAnchorAt).toBeUndefined();
    });

    it('reads null when no chat is open', () => {
        const { harness } = mount(null);
        expect(harness.result.unreadAnchorAt).toBeNull();
    });
});
