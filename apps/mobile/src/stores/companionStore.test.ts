/**
 * The note attached to the companion belongs to the room it was attached in.
 *
 * It is persisted, so before `resetForScope` a note attached in one study set
 * stayed stapled to every question asked in the next one — and survived both
 * "New chat" and an app restart. Two course-less sets share the same (absent)
 * course id, which is why a course-only check never caught this.
 */
jest.mock('../services/ai', () => ({
  companionSendMessage: jest.fn(),
  companionSendMessageStream: jest.fn(),
  fetchCompanionHistory: jest.fn(async () => ({
    messages: [],
    conversationId: null,
    noteContextId: null,
  })),
  clearCompanionHistory: jest.fn(),
  fetchCompanionConversations: jest.fn(async () => ({ conversations: [] })),
}));

const store: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (k: string) => store[k] ?? null),
  setItem: jest.fn(async (k: string, v: string) => {
    store[k] = v;
  }),
  removeItem: jest.fn(async (k: string) => {
    delete store[k];
  }),
}));

import { useCompanionStore } from './companionStore';

const NOTE_KEY = 'lantern_companion_note_context';

const attach = (scopeId: string | null) =>
  useCompanionStore.getState().setActiveNoteContext({
    id: 'note-1',
    title: 'Cell respiration',
    scopeId,
  });

describe('companion note attachment scope', () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    useCompanionStore.setState({
      activeNoteContext: null,
      activeConversationId: null,
      pendingNewConversation: false,
      messages: [],
      historyLoaded: false,
      error: null,
    });
  });

  it('drops the attachment, and its persisted copy, in a different room', async () => {
    await attach('set-a');
    expect(useCompanionStore.getState().activeNoteContext?.id).toBe('note-1');
    expect(store[NOTE_KEY]).toBeTruthy();

    useCompanionStore.getState().resetForScope('set-b');
    // The persist call is fire-and-forget; let it land.
    await Promise.resolve();

    expect(useCompanionStore.getState().activeNoteContext).toBeNull();
    expect(store[NOTE_KEY]).toBeUndefined();
  });

  it('keeps the attachment on returning to the same room', async () => {
    await attach('set-a');

    useCompanionStore.getState().resetForScope('set-a');

    expect(useCompanionStore.getState().activeNoteContext?.id).toBe('note-1');
    expect(store[NOTE_KEY]).toBeTruthy();
  });

  it('never clears on a scopeless screen', async () => {
    await attach('set-a');

    useCompanionStore.getState().resetForScope(null);

    expect(useCompanionStore.getState().activeNoteContext?.id).toBe('note-1');
  });

  it('adopts a scopeless attachment left by an older build', async () => {
    useCompanionStore.setState({
      activeNoteContext: { id: 'note-legacy', title: 'Old note' },
    });

    useCompanionStore.getState().resetForScope('set-a');

    expect(useCompanionStore.getState().activeNoteContext?.scopeId).toBe('set-a');

    useCompanionStore.getState().resetForScope('set-b');
    expect(useCompanionStore.getState().activeNoteContext).toBeNull();
  });

  it('clears the attachment on New chat', async () => {
    await attach('set-a');

    useCompanionStore.getState().startNewChat();
    await Promise.resolve();

    expect(useCompanionStore.getState().activeNoteContext).toBeNull();
    expect(store[NOTE_KEY]).toBeUndefined();
  });
});
