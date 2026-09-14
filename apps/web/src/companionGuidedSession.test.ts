/**
 * The Guided lesson, on the wire.
 *
 * Guided's first turn always worked: the seed sentence named the topic and the
 * note, so the model taught step 1 from the material. Every turn after it sent
 * `mode: 'guided'` and nothing else — no topic, no source, no step, no
 * standing question. On a CORRECT answer to step 1 the model re-read the
 * thread, found the seed's words ("Imported Notes"), and replied "Step 1 –
 * Locate your Imported Notes … Check: Where would you go first to find the
 * list of your imported notes?" — off the material, about the app, and back at
 * step 1 (production faeaf324).
 *
 * The fix is state the STORE holds, because the store is what builds the
 * context for every send. So what is pinned here is the wire: what actually
 * leaves the browser on turn 2, and what the reply does to the lesson.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const memoryStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();
vi.stubGlobal('localStorage', memoryStorage);

const companionSendMessage = vi.fn();
vi.mock('../../../services/ai', () => ({
  companionSendMessage: (...args: unknown[]) => companionSendMessage(...args),
  companionSendMessageStream: vi.fn(),
  fetchCompanionHistory: vi.fn(async () => ({
    messages: [],
    conversationId: null,
    noteContextId: null,
  })),
  clearCompanionHistory: vi.fn(),
  fetchCompanionConversations: vi.fn(async () => ({ conversations: [] })),
  uploadCompanionImage: vi.fn(),
}));

import { useCompanionStore } from '../../../stores/companionStore';

/** The context the store actually put on the wire for send number `n`. */
const sentContext = (n = 0) => companionSendMessage.mock.calls[n]?.[1] as Record<string, unknown>;

function replyWith(reply: string, guidedStep: number | null = null) {
  companionSendMessage.mockResolvedValue({
    reply,
    actions: [],
    citations: null,
    conversationId: 'conv-1',
    guidedStep,
  });
}

beforeEach(() => {
  companionSendMessage.mockReset();
  replyWith('Step 1: water follows salt.\n\nCheck: which way does water move?');
  useCompanionStore.setState({
    messages: [],
    activeNoteContext: null,
    activeConversationId: null,
    pendingNewConversation: true,
    pendingMessageContext: null,
    guidedSession: null,
    isLoading: false,
    isStreaming: false,
    pendingImages: [],
    error: null,
  });
  useCompanionStore.setState({ loadConversations: async () => {} } as never);
});

describe('the guided session reaches every turn', () => {
  it('starts at step 1 with the topic and the note the goal named', () => {
    useCompanionStore.getState().startGuided({
      topic: 'Osmosis',
      sourceNoteId: 'note-1',
      sourceTitle: 'Cell transport',
    });

    expect(useCompanionStore.getState().guidedSession).toEqual({
      topic: 'Osmosis',
      sourceNoteId: 'note-1',
      sourceTitle: 'Cell transport',
      step: 1,
      lastCheck: null,
    });
  });

  it('sends the session AND the material on the seed turn', async () => {
    useCompanionStore.getState().startGuided({
      topic: 'Osmosis',
      sourceNoteId: 'note-1',
      sourceTitle: 'Cell transport',
    });

    await useCompanionStore.getState().sendMessage('Guide me through "Osmosis"');

    expect(sentContext()?.mode).toBe('guided');
    expect(sentContext()?.guided).toMatchObject({ topic: 'Osmosis', step: 1 });
    expect(sentContext()?.noteId).toBe('note-1');
  });

  it('sends them again on the NEXT turn — the turn that used to arrive bare', async () => {
    useCompanionStore.getState().startGuided({
      topic: 'Osmosis',
      sourceNoteId: 'note-1',
      sourceTitle: 'Cell transport',
    });
    await useCompanionStore.getState().sendMessage('Guide me through "Osmosis"');

    replyWith('Correct.\n\nStep 2: tonicity.\n\nCheck: what is hypertonic?');
    await useCompanionStore.getState().sendMessage('water moves toward the saltier side');

    // The whole defect, in three assertions.
    expect(sentContext(1)?.mode).toBe('guided');
    expect(sentContext(1)?.guided).toMatchObject({
      topic: 'Osmosis',
      step: 1,
      lastCheck: 'which way does water move?',
    });
    expect(sentContext(1)?.noteId).toBe('note-1');
  });

  it('advances the step when the reply asks a new check question', async () => {
    useCompanionStore.getState().startGuided({ topic: 'Osmosis', sourceNoteId: 'note-1' });
    await useCompanionStore.getState().sendMessage('Guide me through "Osmosis"');
    expect(useCompanionStore.getState().guidedSession?.step).toBe(1);

    replyWith('Correct.\n\nStep 2: tonicity.\n\nCheck: what is hypertonic?');
    await useCompanionStore.getState().sendMessage('toward the saltier side');

    expect(useCompanionStore.getState().guidedSession).toMatchObject({
      step: 2,
      lastCheck: 'what is hypertonic?',
    });
  });

  it('stays on the step when the same check comes back — that is a re-teach', async () => {
    useCompanionStore.getState().startGuided({ topic: 'Osmosis' });
    await useCompanionStore.getState().sendMessage('Guide me through "Osmosis"');

    replyWith('Not quite. Think of it as chasing salt.\n\nCheck: which way does water move?');
    await useCompanionStore.getState().sendMessage('away from the salt');

    expect(useCompanionStore.getState().guidedSession?.step).toBe(1);
  });

  it('takes the server step over its own guess', async () => {
    useCompanionStore.getState().startGuided({ topic: 'Osmosis' });
    await useCompanionStore.getState().sendMessage('Guide me through "Osmosis"');

    replyWith('Correct.\n\nCheck: what is hypertonic?', 4);
    await useCompanionStore.getState().sendMessage('toward the saltier side');

    expect(useCompanionStore.getState().guidedSession?.step).toBe(4);
  });

  it('lets a real attachment outrank the lesson note, as it always did', async () => {
    useCompanionStore.setState({
      activeNoteContext: { id: 'attached-note', title: 'Lecture 4' },
    });
    useCompanionStore.getState().startGuided({ topic: 'Osmosis', sourceNoteId: 'note-1' });

    await useCompanionStore.getState().sendMessage('Guide me through "Osmosis"');

    expect(sentContext()?.noteId).toBe('attached-note');
  });
});

describe('leaving Guided ends the lesson', () => {
  it('clears the session, and later turns carry no guided metadata', async () => {
    useCompanionStore.getState().startGuided({ topic: 'Osmosis', sourceNoteId: 'note-1' });
    useCompanionStore.getState().clearGuided();

    await useCompanionStore.getState().sendMessage('What is osmosis?');

    expect(useCompanionStore.getState().guidedSession).toBeNull();
    expect(sentContext()?.guided).toBeUndefined();
    // Mode is the panel's to state again — the store stops forcing 'guided'.
    expect(sentContext()?.mode).toBeUndefined();
    expect(sentContext()?.noteId).toBeUndefined();
  });

  it('does not carry one thread’s lesson into a new chat', () => {
    useCompanionStore.getState().startGuided({ topic: 'Osmosis' });
    useCompanionStore.getState().startNewChat();

    expect(useCompanionStore.getState().guidedSession).toBeNull();
  });

  it('leaves a non-guided thread completely untouched', async () => {
    await useCompanionStore.getState().sendMessage('What is osmosis?');

    expect(sentContext()?.guided).toBeUndefined();
    expect(useCompanionStore.getState().guidedSession).toBeNull();
  });
});
