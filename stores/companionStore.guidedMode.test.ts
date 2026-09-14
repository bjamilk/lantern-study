// @vitest-environment jsdom
/**
 * Guided is only real if `mode` survives the trip to the server.
 *
 * The store merges the caller's context with the thread's own state (the
 * attached note, the conversation id, pending images) on every send. That merge
 * is where a mode is easiest to lose: a lesson that silently dropped back to
 * `explain` halfway through looks identical in the UI and teaches nothing
 * differently. So this drives the store's real send paths and reads `mode` off
 * the context that actually leaves it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompanionUserContext } from '@lantern/shared/types';

const companionSendMessage = vi.fn(async () => ({
  reply: 'Step one: osmosis moves water, not solute.',
  actions: [],
  provider: 'groq',
  citations: null,
  conversationId: 'conv-1',
}));

const companionSendMessageStream = vi.fn(
  async (
    _text: string,
    _context: CompanionUserContext | undefined,
    _onToken: (t: string) => void,
    onDone: (r: Record<string, unknown>) => void
  ) => {
    onDone({ actions: [], citations: null, messageId: 'm1', userMessageId: 'u1', conversationId: 'conv-1' });
  }
);

vi.mock('../services/ai', () => ({
  companionSendMessage: (...args: unknown[]) => companionSendMessage(...(args as [])),
  companionSendMessageStream: (...args: unknown[]) =>
    companionSendMessageStream(...(args as [Parameters<typeof companionSendMessageStream>[0]])),
  fetchCompanionHistory: vi.fn(async () => ({
    messages: [],
    conversationId: null,
    noteContextId: null,
  })),
  clearCompanionHistory: vi.fn(async () => ({})),
  fetchCompanionConversations: vi.fn(async () => ({ conversations: [] })),
  uploadCompanionImage: vi.fn(),
}));

import { useCompanionStore } from './companionStore';

beforeEach(() => {
  localStorage.clear();
  companionSendMessage.mockClear();
  companionSendMessageStream.mockClear();
  useCompanionStore.setState({
    activeNoteContext: null,
    activeConversationId: null,
    pendingNewConversation: false,
    pendingMessageContext: null,
    messages: [],
    historyLoaded: false,
    error: null,
    pendingImages: [],
    isUploadingImage: false,
    imageError: null,
    isLoading: false,
    isStreaming: false,
  });
});

describe('the web store carries the companion mode', () => {
  it('sends mode:guided on the streaming path', async () => {
    await useCompanionStore
      .getState()
      .sendMessageStreaming('Guide me through osmosis', { mode: 'guided' });

    const context = companionSendMessageStream.mock.calls[0][1] as CompanionUserContext;
    expect(context.mode).toBe('guided');
  });

  it('sends mode:guided on the JSON path', async () => {
    await useCompanionStore
      .getState()
      .sendMessage('Guide me through osmosis', { mode: 'guided' });

    const context = companionSendMessage.mock.calls[0][1] as CompanionUserContext;
    expect(context.mode).toBe('guided');
  });

  it('keeps the mode when the thread merges its own note scope in', async () => {
    // The merge rewrites noteId / conversationId on every send — the mode must
    // ride through it rather than being overwritten alongside them.
    useCompanionStore.setState({
      activeNoteContext: { id: 'note-1', title: 'Cell transport' },
      activeConversationId: 'conv-9',
    });

    await useCompanionStore
      .getState()
      .sendMessageStreaming('Next step please', { mode: 'guided' });

    const context = companionSendMessageStream.mock.calls[0][1] as CompanionUserContext;
    expect(context.mode).toBe('guided');
    expect(context.noteId).toBe('note-1');
    expect(context.conversationId).toBe('conv-9');
  });

  it('sends no mode at all when Guided is off, so the server default stands', async () => {
    await useCompanionStore.getState().sendMessageStreaming('What is osmosis?');

    const context = companionSendMessageStream.mock.calls[0][1] as CompanionUserContext;
    expect(context.mode).toBeUndefined();
  });
});
