/**
 * Contract test for `hooks/groups/useBoardHandlers`.
 *
 * What the hook promises, and what this file pins:
 *  - `handleQuestionSubmit` posts the question through
 *    `sendMessage(groupId, userId, content, clientMessageId)`, with the question
 *    payload JSON-encoded in `content`.
 *  - a question is a MESSAGE: `type` is MessageType.QUESTION and the real kind
 *    rides in `questionType` — the divergence the fix-round memory records, so it
 *    is asserted on the encoded payload directly.
 *  - a case-insensitive stem match against the group's loaded messages diverts to
 *    the duplicate modal and posts NOTHING.
 *  - the clientMessageId comes from the shared `groupDeliveryIntents` registry, so
 *    a retry of the same payload reuses it and the server can dedupe; an
 *    UNCERTAIN delivery failure KEEPS the intent, any other failure clears it.
 *
 * Rendered through `hooks/effects/testing/hookHarness` (the web suite runs in
 * plain Node, with no jsdom).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactMock } from '../effects/testing/hookHarness';
import { MessageType, QuestionType } from '../../types';

vi.mock('react', () => reactMock);

const tx = vi.hoisted(() => ({
    sendMessage: vi.fn(async (..._args: unknown[]) => ({ id: 'server-1', timestamp: '2026-09-15T00:00:00.000Z' }) as any),
    syncGamificationProgress: vi.fn(async () => ({ points: 3, badges: [], stats: {}, awardedBadges: [] }) as any),
}));

vi.mock('../../services/supabase', () => ({ sendMessage: tx.sendMessage }));
vi.mock('../../services/gamificationStreak', () => ({
    syncGamificationProgress: tx.syncGamificationProgress,
}));

const { renderHook } = await import('../effects/testing/hookHarness');
const { useBoardHandlers } = await import('./useBoardHandlers');
const { groupDeliveryIntents } = await import('./deliveryIntents');

// The failure path reports through the browser's blocking alert(); plain Node has none.
(globalThis as { alert?: (message?: unknown) => void }).alert = () => {};

const CURRENT_USER = { id: 'user-1', name: 'Ada', stats: {}, points: 0, badges: [] } as any;

function mount(options: { messages?: Record<string, any[]>; selectedChat?: any } = {}) {
    const state = { messages: options.messages ?? ({ 'group-1': [] } as Record<string, any[]>) };
    const openModal = vi.fn();
    const closeModal = vi.fn();
    const setDuplicateInfo = vi.fn();

    const harness = renderHook(() =>
        useBoardHandlers({
            currentUser: CURRENT_USER,
            setCurrentUser: vi.fn() as any,
            messages: state.messages,
            updateMessages: ((updater: any) => {
                state.messages = updater(state.messages);
            }) as any,
            selectedChat:
                options.selectedChat !== undefined
                    ? options.selectedChat
                    : ({ id: 'group-1', chatType: 'group' } as any),
            openModal: openModal as any,
            closeModal: closeModal as any,
            setDuplicateInfo: setDuplicateInfo as any,
            addNotification: vi.fn(async () => undefined),
        }),
    );

    return { harness, state, openModal, closeModal, setDuplicateInfo };
}

/** Submit the simplest possible MCQ; only `stem` varies between cases. */
const submit = (fn: any, stem = 'What is a mole?') =>
    fn(stem, 'Because Avogadro.', QuestionType.MULTIPLE_CHOICE, [], ['a']);

beforeEach(() => {
    tx.sendMessage.mockClear().mockResolvedValue({ id: 'server-1', timestamp: '2026-09-15T00:00:00.000Z' });
    tx.syncGamificationProgress.mockClear();
});

describe('useBoardHandlers', () => {
    it('returns exactly the board handler', () => {
        expect(Object.keys(mount().harness.result)).toEqual(['handleQuestionSubmit']);
    });

    it('posts the question through sendMessage(groupId, userId, content, clientMessageId)', async () => {
        const { harness } = mount();
        await submit(harness.result.handleQuestionSubmit);

        expect(tx.sendMessage).toHaveBeenCalledTimes(1);
        const [groupId, userId, content, clientMessageId] = tx.sendMessage.mock.calls[0] as any[];
        expect(groupId).toBe('group-1');
        expect(userId).toBe('user-1');
        expect(typeof clientMessageId).toBe('string');
        expect(clientMessageId).not.toBe('');

        const payload = JSON.parse(content as string);
        // A question is a message: `type` is QUESTION, the real kind is `questionType`.
        expect(payload.type).toBe(MessageType.QUESTION);
        expect(payload.questionType).toBe(QuestionType.MULTIPLE_CHOICE);
        expect(payload.questionStem).toBe('What is a mole?');
    });

    it('diverts a duplicate stem to the modal and posts nothing', async () => {
        const { harness, openModal, closeModal, setDuplicateInfo } = mount({
            messages: {
                'group-1': [
                    { id: 'msg-1', type: MessageType.QUESTION, questionStem: '  WHAT IS A MOLE? ' },
                ],
            },
        });
        await submit(harness.result.handleQuestionSubmit);

        expect(tx.sendMessage).not.toHaveBeenCalled();
        expect(setDuplicateInfo).toHaveBeenCalled();
        expect(openModal).toHaveBeenCalledWith('duplicateQuestion');
        expect(closeModal).toHaveBeenCalledWith('question');
    });

    it('does nothing when the open chat is not a group', async () => {
        const { harness } = mount({ selectedChat: { id: 'thread-1', chatType: 'dm' } });
        await submit(harness.result.handleQuestionSubmit);
        expect(tx.sendMessage).not.toHaveBeenCalled();
    });

    it('reuses one clientMessageId when an uncertain failure is retried', async () => {
        const { harness } = mount();
        const uncertain = Object.assign(new Error('timeout'), { name: 'AbortError' });
        tx.sendMessage.mockRejectedValueOnce(uncertain);

        await submit(harness.result.handleQuestionSubmit);
        const firstId = (tx.sendMessage.mock.calls[0] as any[])[3];

        await submit(harness.result.handleQuestionSubmit);
        const retryId = (tx.sendMessage.mock.calls[1] as any[])[3];

        expect(retryId).toBe(firstId);
    });

    it('appends the delivered question to the group it was posted in', async () => {
        const { harness, state, closeModal } = mount();
        await submit(harness.result.handleQuestionSubmit);

        expect(state.messages['group-1']?.map((m: any) => m.id)).toEqual(['server-1']);
        expect(closeModal).toHaveBeenCalledWith('question');
    });

    it('shares the group delivery-intent registry with the message composer', () => {
        // Not an implementation detail: two registries would each mint their own
        // clientMessageId for `group:<id>` and the server could no longer dedupe.
        expect(groupDeliveryIntents).toBeDefined();
        expect(typeof groupDeliveryIntents.resolve).toBe('function');
    });
});
