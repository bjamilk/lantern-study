/**
 * Deleting ONE past chat from the history list.
 *
 * `clearHistory` only ever deleted the thread you were looking at, so a chat
 * you never reopened could not be removed from the phone at all. Deleting the
 * ACTIVE thread additionally has to leave the panel somewhere valid — a fresh
 * chat — rather than holding a conversation id the server no longer answers
 * for, which is what made the next question 404 instead of starting a thread.
 */
const clearCompanionHistory = jest.fn(async () => ({
  success: true,
  conversationId: null,
  noteContextId: null,
}));

jest.mock('../services/ai', () => ({
  companionSendMessage: jest.fn(),
  companionSendMessageStream: jest.fn(),
  fetchCompanionHistory: jest.fn(async () => ({
    messages: [],
    conversationId: null,
    noteContextId: null,
  })),
  clearCompanionHistory: (...args: unknown[]) => clearCompanionHistory(...(args as [])),
  fetchCompanionConversations: jest.fn(async () => ({ conversations: [] })),
}));

const storage: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (k: string) => storage[k] ?? null),
  setItem: jest.fn(async (k: string, v: string) => {
    storage[k] = v;
  }),
  removeItem: jest.fn(async (k: string) => {
    delete storage[k];
  }),
}));

import { useCompanionStore } from './companionStore';

const CONVERSATION_KEY = 'lantern_companion_conversation_id';
const NOTE_KEY = 'lantern_companion_note_context';

const rows = [
  { id: 'c1', title: 'Mitosis', updatedAt: '2026-09-01T00:00:00.000Z' },
  { id: 'c2', title: 'Meiosis', updatedAt: '2026-09-02T00:00:00.000Z' },
] as unknown as ReturnType<typeof useCompanionStore.getState>['conversations'];

describe('deleteConversation', () => {
  beforeEach(() => {
    for (const k of Object.keys(storage)) delete storage[k];
    clearCompanionHistory.mockClear();
    clearCompanionHistory.mockResolvedValue({
      success: true,
      conversationId: null,
      noteContextId: null,
    });
    useCompanionStore.setState({
      conversations: [...rows],
      activeConversationId: null,
      activeNoteContext: null,
      pendingNewConversation: false,
      messages: [],
      historyLoaded: false,
      error: null,
    });
  });

  it('removes an inactive chat from the list without disturbing the open one', async () => {
    useCompanionStore.setState({ activeConversationId: 'c1' });
    await useCompanionStore.getState().deleteConversation('c2');

    expect(clearCompanionHistory).toHaveBeenCalledWith({ conversationId: 'c2' });
    expect(useCompanionStore.getState().conversations.map((c) => c.id)).toEqual(['c1']);
    // The thread on screen is untouched.
    expect(useCompanionStore.getState().activeConversationId).toBe('c1');
    expect(useCompanionStore.getState().pendingNewConversation).toBe(false);
  });

  it('lands on a fresh chat when the deleted thread was the open one', async () => {
    storage[CONVERSATION_KEY] = 'c1';
    storage[NOTE_KEY] = JSON.stringify({ id: 'n1', title: 'Cell cycle' });
    useCompanionStore.setState({
      activeConversationId: 'c1',
      activeNoteContext: { id: 'n1', title: 'Cell cycle' },
      messages: [{ id: 'm1', role: 'user', content: 'hi', created_at: '' }] as never,
    });

    await useCompanionStore.getState().deleteConversation('c1');

    const state = useCompanionStore.getState();
    expect(state.conversations.map((c) => c.id)).toEqual(['c2']);
    expect(state.activeConversationId).toBeNull();
    expect(state.activeNoteContext).toBeNull();
    expect(state.pendingNewConversation).toBe(true);
    expect(state.messages).toEqual([]);
    // The persisted copies go too, or the next launch rehydrates a dead thread.
    expect(storage[CONVERSATION_KEY]).toBeUndefined();
    expect(storage[NOTE_KEY]).toBeUndefined();
  });

  it('keeps the row when the server refuses, and surfaces why', async () => {
    clearCompanionHistory.mockRejectedValueOnce(new Error('Network request failed'));

    await useCompanionStore.getState().deleteConversation('c2');

    const state = useCompanionStore.getState();
    expect(state.conversations.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(state.error).toBe('Network request failed');
  });
});
