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

/**
 * The streaming reducer itself.
 *
 * The parity brief suspected the web store only rendered at the `done` frame
 * (which is what the mobile store did before its own fix). It does not — it has
 * appended per token all along — so this suite pins that behaviour down rather
 * than changing it: the panel's caret, and the whole point of streaming, rest
 * on each token being visible in the thread the moment it lands.
 */
describe('companion streaming reducer', () => {
  const streamWith = async (
    drive: (
      onToken: (t: string) => void,
      onDone: (r: {
        actions: unknown[];
        citations: unknown;
        messageId?: string;
        userMessageId?: string;
        conversationId?: string;
      }) => void
    ) => void | Promise<void>
  ) => {
    const { companionSendMessageStream } = await import('../services/ai');
    (companionSendMessageStream as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (
        _text: string,
        _ctx: unknown,
        onToken: (t: string) => void,
        onDone: (r: any) => void
      ) => {
        await drive(onToken, onDone);
      }
    );
    await useCompanionStore.getState().sendMessageStreaming('Explain osmosis');
  };

  it('appends each token to the open answer as it arrives', async () => {
    const seen: string[] = [];
    await streamWith((onToken, onDone) => {
      for (const token of ['Osmosis ', 'is ', 'diffusion']) {
        onToken(token);
        const msgs = useCompanionStore.getState().messages;
        // Read the assistant bubble mid-stream: it must already be growing,
        // and `isStreaming` must still be true so the caret is drawn.
        seen.push(msgs[msgs.length - 1].content);
        expect(useCompanionStore.getState().isStreaming).toBe(true);
      }
      onDone({ actions: [], citations: null });
    });

    expect(seen).toEqual(['Osmosis ', 'Osmosis is ', 'Osmosis is diffusion']);
  });

  it('finalises on the done frame: real ids, no duplicate bubble, caret gone', async () => {
    await streamWith((onToken, onDone) => {
      onToken('Osmosis is diffusion');
      onDone({
        actions: [],
        citations: null,
        messageId: '11111111-2222-4333-8444-555555555555',
        userMessageId: '66666666-7777-4888-8999-aaaaaaaaaaaa',
        conversationId: 'conv-9',
      });
    });

    const state = useCompanionStore.getState();
    // One question, one answer — the done frame REPLACES the optimistic
    // bubble's id rather than appending a second copy of the same answer.
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0].id).toBe('66666666-7777-4888-8999-aaaaaaaaaaaa');
    expect(state.messages[1].id).toBe('11111111-2222-4333-8444-555555555555');
    expect(state.messages[1].content).toBe('Osmosis is diffusion');
    expect(state.isStreaming).toBe(false);
    expect(state.activeConversationId).toBe('conv-9');
  });
});

/**
 * Source chips, the whole way through.
 *
 * Live, an answer in the rail rendered "(Excerpt 1)" as ordinary prose and the
 * DOM held no chip element at all. The streaming reducer was never the break —
 * it is pinned here — the break was the server, which had nowhere to store the
 * citation, so every thread came back from `/history` without one. Both halves
 * are covered: the done frame writes citations onto the stored message, and a
 * reloaded thread keeps them.
 */
describe('companion citations', () => {
  const CITATION = {
    noteId: '99999999-8888-4777-8666-555555555555',
    noteTitle: 'Pancreatitis PPT Student',
    excerpts: [1, 3],
  };

  const streamDone = async (frame: Record<string, unknown>) => {
    const { companionSendMessageStream } = await import('../services/ai');
    (companionSendMessageStream as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (
        _text: string,
        _ctx: unknown,
        onToken: (t: string) => void,
        onDone: (r: any) => void
      ) => {
        onToken('Pancreatitis is pancreatic inflammation. (Excerpt 1)');
        onDone(frame);
      }
    );
    await useCompanionStore.getState().sendMessageStreaming('Summarise this material');
  };

  it('writes the done frame citations onto the stored answer', async () => {
    await streamDone({
      actions: [],
      citations: CITATION,
      messageId: '11111111-2222-4333-8444-555555555555',
    });

    const answer = useCompanionStore.getState().messages.at(-1)!;
    expect(answer.citations).toEqual(CITATION);
    // The panel gates the chips on exactly this, so a truthy object is the
    // whole contract: `{!isStreaming && message.citations && …}`.
    expect(useCompanionStore.getState().isStreaming).toBe(false);
  });

  it('leaves an ungrounded answer with no citations rather than an empty chip', async () => {
    await streamDone({ actions: [], citations: null });
    expect(useCompanionStore.getState().messages.at(-1)!.citations).toBeNull();
  });

  it('restores citations when the thread is reloaded from the server', async () => {
    const { fetchCompanionHistory } = await import('../services/ai');
    (fetchCompanionHistory as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      messages: [
        { id: 'm1', role: 'user', content: 'Summarise this material', created_at: 'a' },
        {
          id: 'm2',
          role: 'assistant',
          content: 'Pancreatitis is pancreatic inflammation. (Excerpt 1)',
          citations: CITATION,
          created_at: 'b',
        },
      ],
      conversationId: null,
      noteContextId: null,
    });

    await useCompanionStore.getState().loadHistory();

    expect(useCompanionStore.getState().messages[1].citations).toEqual(CITATION);
  });

  it('drops a malformed stored citation instead of rendering a chip that goes nowhere', async () => {
    const { fetchCompanionHistory } = await import('../services/ai');
    (fetchCompanionHistory as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      messages: [
        {
          id: 'm2',
          role: 'assistant',
          content: 'An answer',
          citations: { noteId: '', noteTitle: 'x', excerpts: [] },
          created_at: 'b',
        },
      ],
      conversationId: null,
      noteContextId: null,
    });

    await useCompanionStore.getState().loadHistory();

    expect(useCompanionStore.getState().messages[0].citations).toBeNull();
  });
});
