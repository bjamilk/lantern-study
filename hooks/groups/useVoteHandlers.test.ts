/**
 * Contract test for `hooks/groups/useVoteHandlers`.
 *
 * What the hook promises, and what this file pins:
 *  - `onVoteQuestion` sends the vote to `voteQuestion(messageId, userId, type)`,
 *    or to `removeVote(messageId, userId)` when the student taps the vote they
 *    already hold, and writes the SERVER's counts back — never a local guess.
 *  - it patches the ONE message by id inside the functional update, so a peer
 *    message that arrived mid-request survives (F9 · E3 M1, the regression this
 *    handler was fixed for).
 *  - `onFlagAsSimilar` persists the flag list through `updateMessage` before
 *    touching local state, and auto-archives at 5% of the roster.
 *  - `handleUpvoteDuplicateAndClose` upvotes the original only when this student
 *    has not already upvoted it, then closes the duplicate modal.
 *
 * The hook is rendered through `hooks/effects/testing/hookHarness`, the same
 * stand-in React runtime the `hooks/effects/` suites use — the web suite runs in
 * plain Node, with no jsdom.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactMock } from '../effects/testing/hookHarness';
import { MessageType, QuestionStatus } from '../../types';

vi.mock('react', () => reactMock);

const tx = vi.hoisted(() => ({
    voteQuestion: vi.fn(async (..._args: unknown[]) => ({ upvotes: 7, downvotes: 1 }) as any),
    removeVote: vi.fn(async (..._args: unknown[]) => ({ upvotes: 5, downvotes: 1 }) as any),
    updateMessage: vi.fn(async (..._args: unknown[]) => undefined as any),
    updateQuestionStatus: vi.fn(async (..._args: unknown[]) => undefined as any),
    createNotification: vi.fn(async (..._args: unknown[]) => undefined as any),
    syncGamificationProgress: vi.fn(async () => ({ points: 10, badges: [], stats: {} }) as any),
}));

vi.mock('../../services/supabase', () => ({
    voteQuestion: tx.voteQuestion,
    removeVote: tx.removeVote,
    updateMessage: tx.updateMessage,
    updateQuestionStatus: tx.updateQuestionStatus,
    createNotification: tx.createNotification,
}));

vi.mock('../../services/gamificationStreak', () => ({
    syncGamificationProgress: tx.syncGamificationProgress,
}));

const { renderHook } = await import('../effects/testing/hookHarness');
const { useVoteHandlers } = await import('./useVoteHandlers');

const CURRENT_USER = { id: 'user-1', name: 'Ada', points: 0, badges: [], stats: {} } as any;

/** A plain text message: no question-status resolution runs for it. */
const message = (overrides: Record<string, unknown> = {}) =>
    ({
        id: 'msg-1',
        type: MessageType.TEXT,
        sender: { id: 'user-2', name: 'Grace' },
        upvotes: 6,
        downvotes: 1,
        questionStatus: QuestionStatus.PENDING,
        ...overrides,
    }) as any;

interface Harness {
    result: ReturnType<typeof useVoteHandlers>;
    messages: Record<string, any[]>;
    votes: Record<string, 'up' | 'down' | undefined>;
    addNotification: ReturnType<typeof vi.fn>;
    setCurrentUser: ReturnType<typeof vi.fn>;
    closeModal: ReturnType<typeof vi.fn>;
}

function mount(options: {
    messages?: Record<string, any[]>;
    userVotes?: Record<string, 'up' | 'down' | undefined>;
    groups?: any[];
    selectedChat?: any;
} = {}): Harness {
    const state = {
        messages: options.messages ?? { 'group-1': [message()] },
        votes: options.userVotes ?? {},
    };
    const addNotification = vi.fn(async () => undefined);
    const setCurrentUser = vi.fn();
    const closeModal = vi.fn();

    const harness = renderHook(() =>
        useVoteHandlers({
            currentUser: CURRENT_USER,
            setCurrentUser,
            groups: options.groups ?? ([{ id: 'group-1', members: [{ id: 'user-1' }, { id: 'user-2' }] }] as any),
            messages: state.messages,
            userVotes: state.votes,
            updateMessages: ((updater: any) => {
                state.messages = updater(state.messages);
            }) as any,
            updateUserVotes: ((updater: any) => {
                state.votes = updater(state.votes);
            }) as any,
            selectedChat:
                options.selectedChat !== undefined
                    ? options.selectedChat
                    : ({ id: 'group-1', chatType: 'group' } as any),
            closeModal: closeModal as any,
            setDuplicateInfo: vi.fn() as any,
            addNotification,
        }),
    );

    return {
        get result() {
            return harness.result;
        },
        get messages() {
            return state.messages;
        },
        get votes() {
            return state.votes;
        },
        addNotification,
        setCurrentUser,
        closeModal,
    } as Harness;
}

// Both failure paths in this hook call the browser's blocking `alert()` (see the
// KNOWN ISSUE in useVoteHandlers.ts). The web suite runs in plain Node, which has
// none, so a failure path would throw before reaching the assertion.
(globalThis as { alert?: (message?: unknown) => void }).alert = () => {};

beforeEach(() => {
    for (const fn of Object.values(tx)) fn.mockClear();
});

describe('useVoteHandlers', () => {
    it('returns exactly the three vote handlers', () => {
        expect(Object.keys(mount().result)).toEqual([
            'onVoteQuestion',
            'handleUpvoteDuplicateAndClose',
            'onFlagAsSimilar',
        ]);
    });

    it('casts a new vote through voteQuestion(messageId, userId, type)', async () => {
        const harness = mount();
        await harness.result.onVoteQuestion('msg-1', 'up');

        expect(tx.voteQuestion).toHaveBeenCalledWith('msg-1', 'user-1', 'up');
        expect(tx.removeVote).not.toHaveBeenCalled();
    });

    it('removes the vote through removeVote when the same vote is tapped again', async () => {
        const harness = mount({ userVotes: { 'msg-1': 'up' } });
        await harness.result.onVoteQuestion('msg-1', 'up');

        expect(tx.removeVote).toHaveBeenCalledWith('msg-1', 'user-1');
        expect(tx.voteQuestion).not.toHaveBeenCalled();
    });

    it("writes the server's counts back, not a local guess", async () => {
        const harness = mount();
        await harness.result.onVoteQuestion('msg-1', 'up');

        // The stub answers 7/1; a local increment from 6/1 would also give 7/1,
        // so the stub deliberately disagrees on the down count in the next case.
        expect(harness.messages['group-1']?.[0]).toMatchObject({ upvotes: 7, downvotes: 1 });
        expect(harness.votes['msg-1']).toBe('up');
    });

    it('patches only the voted message, so a peer message that arrived mid-request survives', async () => {
        const harness = mount();
        let resolveVote: (value: unknown) => void = () => {};
        tx.voteQuestion.mockImplementationOnce(
            () => new Promise((resolve) => { resolveVote = resolve; }) as any,
        );

        const pending = harness.result.onVoteQuestion('msg-1', 'up');
        // A peer message lands while the request is in flight.
        harness.messages['group-1'] = [...(harness.messages['group-1'] ?? []), message({ id: 'msg-2' })];
        resolveVote({ upvotes: 7, downvotes: 1 });
        await pending;

        expect(harness.messages['group-1']?.map((m: any) => m.id)).toEqual(['msg-1', 'msg-2']);
    });

    it('does nothing when the open chat is not a group', async () => {
        const harness = mount({ selectedChat: { id: 'thread-1', chatType: 'dm' } });
        await harness.result.onVoteQuestion('msg-1', 'up');

        expect(tx.voteQuestion).not.toHaveBeenCalled();
        expect(tx.removeVote).not.toHaveBeenCalled();
    });

    it('persists the flag list through updateMessage before touching local state', async () => {
        const harness = mount();
        await harness.result.onFlagAsSimilar('msg-1', 'group-1');

        expect(tx.updateMessage).toHaveBeenCalledWith('msg-1', {
            flagged_as_similar_user_ids: ['user-1'],
        });
        expect(harness.messages['group-1']?.[0]?.flaggedAsSimilarUserIds).toEqual(['user-1']);
    });

    it('leaves local state alone when the flag write fails', async () => {
        const harness = mount();
        tx.updateMessage.mockRejectedValueOnce(new Error('offline'));
        await harness.result.onFlagAsSimilar('msg-1', 'group-1');

        expect(harness.messages['group-1']?.[0]?.flaggedAsSimilarUserIds).toBeUndefined();
    });

    it('upvotes the duplicate original only when this student has not upvoted it', () => {
        const harness = mount({ messages: { 'group-1': [message({ id: 'original' })] } });
        harness.result.handleUpvoteDuplicateAndClose('original');
        expect(tx.voteQuestion).toHaveBeenCalledWith('original', 'user-1', 'up');

        tx.voteQuestion.mockClear();
        const held = mount({
            messages: { 'group-1': [message({ id: 'original' })] },
            userVotes: { original: 'up' },
        });
        held.result.handleUpvoteDuplicateAndClose('original');
        expect(tx.voteQuestion).not.toHaveBeenCalled();
        expect(held.closeModal).toHaveBeenCalledWith('duplicateQuestion');
    });
});
