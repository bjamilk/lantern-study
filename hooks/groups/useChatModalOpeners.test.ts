/**
 * Contract test for `hooks/groups/useChatModalOpeners`.
 *
 * What the hook promises, and what this file pins:
 *  - each opener opens the modal the chat screen's prop name implies,
 *  - the group-info opener BUSTS the roster cache first, so the member sheet is
 *    never showing a stale list — and still opens if that refresh fails, because
 *    a network hiccup must not swallow the tap,
 *  - it refreshes nothing when the open chat is a DM,
 *  - test, study and challenge open the ONE shared config sheet and differ only
 *    in the mode they stamp first; challenge also stamps the opponent.
 *
 * Rendered through `hooks/effects/testing/hookHarness` (the web suite runs in
 * plain Node, with no jsdom).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactMock } from '../effects/testing/hookHarness';

vi.mock('react', () => reactMock);

const { renderHook } = await import('../effects/testing/hookHarness');
const { useChatModalOpeners } = await import('./useChatModalOpeners');

const flush = async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

function mount(selectedChat: any = { id: 'group-1', chatType: 'group' }) {
    const calls = {
        openModal: vi.fn(),
        setActiveTestConfigMode: vi.fn(),
        setChallengeOpponent: vi.fn(),
        refreshGroupMembersInState: vi.fn(async (..._args: unknown[]) => undefined),
    };
    const harness = renderHook(() =>
        useChatModalOpeners({
            selectedChat,
            openModal: calls.openModal as any,
            setActiveTestConfigMode: calls.setActiveTestConfigMode as any,
            setChallengeOpponent: calls.setChallengeOpponent as any,
            refreshGroupMembersInState: calls.refreshGroupMembersInState,
        }),
    );
    return { harness, calls };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('useChatModalOpeners', () => {
    it('returns the five openers', () => {
        expect(Object.keys(mount().harness.result)).toEqual([
            'onOpenQuestionModal',
            'onOpenGroupInfoModal',
            'onOpenTestConfigModal',
            'onOpenStudyConfigModal',
            'handleChallengeUser',
        ]);
    });

    it('opens the question composer', () => {
        const { harness, calls } = mount();
        harness.result.onOpenQuestionModal();
        expect(calls.openModal).toHaveBeenCalledWith('question');
    });

    it('busts the roster cache before showing group info', () => {
        const { harness, calls } = mount();
        harness.result.onOpenGroupInfoModal();

        expect(calls.refreshGroupMembersInState).toHaveBeenCalledWith('group-1');
        expect(calls.openModal).toHaveBeenCalledWith('groupInfo');
    });

    it('still opens group info when the roster refresh fails', async () => {
        const { harness, calls } = mount();
        calls.refreshGroupMembersInState.mockRejectedValue(new Error('offline'));
        harness.result.onOpenGroupInfoModal();
        await flush();

        expect(calls.openModal).toHaveBeenCalledWith('groupInfo');
    });

    it('refreshes no roster when the open chat is a DM', () => {
        const { harness, calls } = mount({ id: 'thread-1', chatType: 'dm' });
        harness.result.onOpenGroupInfoModal();

        expect(calls.refreshGroupMembersInState).not.toHaveBeenCalled();
        expect(calls.openModal).toHaveBeenCalledWith('groupInfo');
    });

    it('stamps the mode before opening the one shared config sheet', () => {
        const { harness, calls } = mount();

        harness.result.onOpenTestConfigModal();
        expect(calls.setActiveTestConfigMode).toHaveBeenLastCalledWith('test');

        harness.result.onOpenStudyConfigModal();
        expect(calls.setActiveTestConfigMode).toHaveBeenLastCalledWith('study');

        harness.result.handleChallengeUser({ id: 'user-9', name: 'Bo' } as any);
        expect(calls.setChallengeOpponent).toHaveBeenCalledWith({ id: 'user-9', name: 'Bo' });
        expect(calls.setActiveTestConfigMode).toHaveBeenLastCalledWith('game');

        expect(calls.openModal.mock.calls.map((call) => call[0])).toEqual([
            'testConfig',
            'testConfig',
            'testConfig',
        ]);
    });
});
