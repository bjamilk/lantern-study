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
