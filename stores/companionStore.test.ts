// @vitest-environment jsdom
// The point of these tests is what survives in localStorage across a room
// change, so they need a DOM environment rather than the default node one.
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The store reaches the network on `setActiveNoteContext` (it reloads history
// for the newly attached note). These tests are about what survives a room
// change, so the network is stubbed out entirely.
vi.mock('../services/ai', () => ({
  companionSendMessage: vi.fn(),
  companionSendMessageStream: vi.fn(),
  fetchCompanionHistory: vi.fn(async () => ({
    messages: [],
    conversationId: null,
    noteContextId: null,
  })),
  clearCompanionHistory: vi.fn(async () => ({})),
  fetchCompanionConversations: vi.fn(async () => ({ conversations: [] })),
}));

import { useCompanionStore } from './companionStore';

const NOTE_KEY = 'lantern_companion_note_context';

const attach = (scopeId: string | null) =>
  useCompanionStore.getState().setActiveNoteContext({
    id: 'note-1',
    title: 'Cell respiration',
    scopeId,
  });

beforeEach(() => {
  localStorage.clear();
  useCompanionStore.setState({
    activeNoteContext: null,
    activeConversationId: null,
    pendingNewConversation: false,
    messages: [],
    historyLoaded: false,
    error: null,
  });
});

describe('companion note attachment scope', () => {
  it('drops the attachment, and its persisted copy, on a different room', async () => {
    await attach('set-a');
    expect(useCompanionStore.getState().activeNoteContext?.id).toBe('note-1');
    expect(localStorage.getItem(NOTE_KEY)).toBeTruthy();

    useCompanionStore.getState().resetForScope('set-b');

    expect(useCompanionStore.getState().activeNoteContext).toBeNull();
    // Persisted too, or the next reload re-attaches the note in set B — the
    // original bug, which survived a refresh.
    expect(localStorage.getItem(NOTE_KEY)).toBeNull();
  });

  it('keeps the attachment when the student comes back to the same room', async () => {
    await attach('set-a');

    useCompanionStore.getState().resetForScope('set-a');

    expect(useCompanionStore.getState().activeNoteContext?.id).toBe('note-1');
    expect(localStorage.getItem(NOTE_KEY)).toBeTruthy();
  });

  it('never clears on a scopeless screen', async () => {
    await attach('set-a');

    // The dashboard is "nowhere in particular": opening the companion there
    // must not detach the note the student is mid-question about.
    useCompanionStore.getState().resetForScope(null);

    expect(useCompanionStore.getState().activeNoteContext?.id).toBe('note-1');
  });

  it('adopts a scopeless attachment left by an older build', async () => {
    localStorage.setItem(
      NOTE_KEY,
      JSON.stringify({ id: 'note-legacy', title: 'Old note' })
    );
    useCompanionStore.setState({
      activeNoteContext: { id: 'note-legacy', title: 'Old note' },
    });

    useCompanionStore.getState().resetForScope('set-a');

    const ctx = useCompanionStore.getState().activeNoteContext;
    expect(ctx?.id).toBe('note-legacy');
    expect(ctx?.scopeId).toBe('set-a');

    // ...and it is scoped from then on, so the next room does clear it.
    useCompanionStore.getState().resetForScope('set-b');
    expect(useCompanionStore.getState().activeNoteContext).toBeNull();
  });

  it('clears the attachment on New chat', async () => {
    await attach('set-a');

    useCompanionStore.getState().startNewChat();

    expect(useCompanionStore.getState().activeNoteContext).toBeNull();
    expect(localStorage.getItem(NOTE_KEY)).toBeNull();
  });
});

/**
 * The "a send that appeared to fail still billed a credit" family.
 *
 * The store used to delete both optimistic bubbles on ANY error from the
 * stream. When the failure happened after the server had already charged —
 * an `error` event mid-stream, a dropped connection, a 500 on a request the
 * server had accepted — the thread ended up looking exactly as it did before
 * the send, the typed text was handed back to the composer, and the only trace
 * was the credit counter going down. That reads as "nothing happened, try
 * again", which spends a second credit.
 */
describe('companion send failures stay visible', () => {
  const send = async (
    fail: (onError: (err: unknown) => void) => void
  ) => {
    const { companionSendMessageStream } = await import('../services/ai');
    (companionSendMessageStream as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (
        _text: string,
        _ctx: unknown,
        _onToken: (t: string) => void,
        _onDone: unknown,
        onError: (err: unknown) => void
      ) => {
        fail(onError);
      }
    );
    await useCompanionStore.getState().sendMessageStreaming('Explain osmosis');
  };

  it('keeps the exchange and shows the error when the server was reached', async () => {
    await send((onError) =>
      onError({ message: 'Model timed out', reachedServer: true, phase: 'stream' })
    );

    const state = useCompanionStore.getState();
    // The question is still on screen — it was asked, and it was paid for.
    expect(state.messages.map((m) => m.content)).toContain('Explain osmosis');
    // The failure is IN the thread, not only in a toast.
    expect(state.messages.some((m) => m.content.includes('Model timed out'))).toBe(true);
    expect(state.error).toBe('Model timed out');
    // The composer is re-enabled (nothing streaming) and is NOT re-seeded with
    // the text, which is what used to invite the duplicate charge.
    expect(state.isStreaming).toBe(false);
    expect(state.isLoading).toBe(false);
    expect(state.failedMessage).toBeNull();
  });

  it('keeps whatever tokens did arrive before the stream died', async () => {
    await send((onError) => {
      const store = useCompanionStore.getState();
      const partialId = store.messages[store.messages.length - 1]?.id;
      expect(partialId).toBeTruthy();
      useCompanionStore.setState((s) => ({
        messages: s.messages.map((m) =>
          m.id === partialId ? { ...m, content: 'Osmosis is the' } : m
        ),
      }));
      onError({ message: 'Stream read error', reachedServer: true, phase: 'stream' });
    });

    const contents = useCompanionStore.getState().messages.map((m) => m.content);
    expect(contents.some((c) => c.startsWith('Osmosis is the'))).toBe(true);
    expect(contents.some((c) => c.includes('Stream read error'))).toBe(true);
  });

  it('withdraws the exchange and returns the draft when nothing was sent', async () => {
    await send((onError) =>
      onError({ message: 'Network error', reachedServer: false, phase: 'unsent' })
    );

    const state = useCompanionStore.getState();
    // Nothing reached the server, so nothing was charged: no orphan bubbles,
    // and the typed text goes back to the composer to retype-free retry.
    expect(state.messages).toHaveLength(0);
    expect(state.failedMessage).toBe('Explain osmosis');
    expect(state.isStreaming).toBe(false);
    expect(state.error).toBe('Network error');
  });
});
