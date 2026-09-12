/**
 * AI Companion Store
 * Manages conversation state for the Lantern AI companion panel.
 * Threads are server-backed (conversation_id); note-attached chats keep
 * note_context_id so history can list general + note-linked chats.
 */
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  CompanionConversation,
  CompanionMessage,
  CompanionUserContext,
} from '@lantern/shared';
import {
  companionSendMessage,
  companionSendMessageStream,
  fetchCompanionHistory,
  clearCompanionHistory,
  fetchCompanionConversations,
} from '../services/ai';

export type CompanionNoteContext = {
  id: string;
  title: string;
  /**
   * Which room the attachment belongs to (study set id, else course id).
   * Without it the persisted note stayed stapled to every question asked in
   * the next set, since two course-less sets share a course id of none.
   */
  scopeId?: string | null;
};

const NOTE_CONTEXT_STORAGE_KEY = 'lantern_companion_note_context';
const CONVERSATION_STORAGE_KEY = 'lantern_companion_conversation_id';

async function readPersistedNoteContext(): Promise<CompanionNoteContext | null> {
  try {
    const raw = await AsyncStorage.getItem(NOTE_CONTEXT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id?: unknown; title?: unknown; scopeId?: unknown };
    if (typeof parsed.id !== 'string' || !parsed.id.trim()) return null;
    return {
      id: parsed.id.trim(),
      title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : 'Untitled note',
      scopeId: typeof parsed.scopeId === 'string' && parsed.scopeId.trim() ? parsed.scopeId.trim() : null,
    };
  } catch {
    return null;
  }
}

async function persistNoteContext(ctx: CompanionNoteContext | null) {
  try {
    if (!ctx) await AsyncStorage.removeItem(NOTE_CONTEXT_STORAGE_KEY);
    else await AsyncStorage.setItem(NOTE_CONTEXT_STORAGE_KEY, JSON.stringify(ctx));
  } catch {
    /* ignore */
  }
}

async function readPersistedConversationId(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(CONVERSATION_STORAGE_KEY);
    if (!raw || !raw.trim()) return null;
    return raw.trim();
  } catch {
    return null;
  }
}

async function persistConversationId(id: string | null) {
  try {
    if (!id) await AsyncStorage.removeItem(CONVERSATION_STORAGE_KEY);
    else await AsyncStorage.setItem(CONVERSATION_STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}

interface CompanionState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  pendingMessage: string | null;
  setPendingMessage: (msg: string | null) => void;
  /**
   * Open the sheet and queue one message. `context` rides with THAT send
   * only (a walk-through's page scope, say) and is dropped afterwards, so the
   * next question the student types is not silently scoped to page 7.
   */
  openWithMessage: (msg: string, context?: Partial<CompanionUserContext>) => void;
  /** One-shot context for the queued message. Consumed by the next send. */
  pendingMessageContext: Partial<CompanionUserContext> | null;

  activeNoteContext: CompanionNoteContext | null;
  hydrateNoteContext: () => Promise<void>;
  setActiveNoteContext: (ctx: CompanionNoteContext | null) => Promise<void>;
  /**
   * Drop the attachment when the student moves to a different room. A null
   * scope means "nowhere in particular" and never clears.
   */
  resetForScope: (scopeId: string | null) => void;

  activeConversationId: string | null;
  pendingNewConversation: boolean;
  conversations: CompanionConversation[];
  isLoadingConversations: boolean;
  loadConversations: () => Promise<void>;
  openConversation: (conversationId: string) => Promise<void>;
  startNewChat: () => void;

  messages: CompanionMessage[];
  isLoading: boolean;
  isLoadingHistory: boolean;
  historyLoaded: boolean;
  isStreaming: boolean;
  error: string | null;
  /** The text of a send that failed — the panel restores it into the composer
      so a network blip can't destroy what the user typed. */
  failedMessage: string | null;
  consumeFailedMessage: () => string | null;

  loadHistory: () => Promise<void>;
  setMessageFeedback: (messageId: string, rating: 'up' | 'down' | null) => void;
  sendMessage: (text: string, context?: CompanionUserContext) => Promise<void>;
  sendMessageStreaming: (text: string, context?: CompanionUserContext) => Promise<void>;
  clearHistory: () => Promise<void>;
  clearError: () => void;
}

function mergeThreadContext(
  get: () => CompanionState,
  context?: CompanionUserContext
): CompanionUserContext {
  const noteCtx = get().activeNoteContext;
  const conversationId = get().activeConversationId;
  const pendingNew = get().pendingNewConversation;
  return {
    ...context,
    ...(noteCtx
      ? { noteId: noteCtx.id, noteTitle: noteCtx.title, noteContext: undefined }
      : { noteId: undefined, noteTitle: undefined, noteContext: undefined }),
    ...(conversationId ? { conversationId } : { conversationId: undefined }),
    ...(pendingNew && !conversationId ? { newConversation: true } : {}),
  };
}

export const useCompanionStore = create<CompanionState>()((set, get) => ({
  isOpen: false,
  messages: [],
  isLoading: false,
  isLoadingHistory: false,
  historyLoaded: false,
  isStreaming: false,
  error: null,
  pendingMessage: null,
  pendingMessageContext: null,
  activeNoteContext: null,
  activeConversationId: null,
  pendingNewConversation: false,
  conversations: [],
  isLoadingConversations: false,

  open: () => set({ isOpen: true }),
  /**
   * A queued send belongs to the open that queued it. Leaving `pendingMessage`
   * set on close meant the next open auto-fired it the moment history was
   * already loaded — spending an AI credit while the panel was still loading,
   * without the user typing anything.
   */
  close: () => set({ isOpen: false, pendingMessage: null, pendingMessageContext: null }),
  toggle: () =>
    set((s) =>
      s.isOpen
        ? { isOpen: false, pendingMessage: null, pendingMessageContext: null }
        : { isOpen: true }
    ),
  clearError: () => set({ error: null }),
  failedMessage: null,
  consumeFailedMessage: () => {
    const msg = get().failedMessage;
    if (msg !== null) set({ failedMessage: null });
    return msg;
  },
  setPendingMessage: (msg) => set({ pendingMessage: msg }),
  openWithMessage: (msg, context) =>
    set({ isOpen: true, pendingMessage: msg, pendingMessageContext: context ?? null }),

  hydrateNoteContext: async () => {
    const [ctx, conversationId] = await Promise.all([
      readPersistedNoteContext(),
      readPersistedConversationId(),
    ]);
    if (conversationId && get().activeConversationId !== conversationId) {
      set({ activeConversationId: conversationId });
    }
    if (!ctx) return;
    if (get().activeNoteContext?.id === ctx.id) return;
    set({ activeNoteContext: ctx });
  },

  resetForScope: (scopeId) => {
    if (!scopeId) return;
    const current = get().activeNoteContext;
    if (!current) return;
    // An attachment with no recorded scope predates this field: adopt it into
    // the room it is first seen in rather than clearing it blind.
    if (current.scopeId == null) {
      const adopted = { ...current, scopeId };
      void persistNoteContext(adopted);
      set({ activeNoteContext: adopted });
      return;
    }
    if (current.scopeId === scopeId) return;
    void persistNoteContext(null);
    void persistConversationId(null);
    set({
      activeNoteContext: null,
      activeConversationId: null,
      pendingNewConversation: true,
      messages: [],
      historyLoaded: true,
      error: null,
    });
  },

  setActiveNoteContext: async (ctx) => {
    const prev = get().activeNoteContext;
    const nextId = ctx?.id ?? null;
    const prevId = prev?.id ?? null;
    if (nextId === prevId && (ctx?.title ?? null) === (prev?.title ?? null)) {
      return;
    }
    await persistNoteContext(ctx);
    await persistConversationId(null);
    set({
      activeNoteContext: ctx,
      activeConversationId: null,
      pendingNewConversation: false,
      messages: [],
      historyLoaded: false,
      error: null,
    });
    await get().loadHistory();
  },

  loadConversations: async () => {
    set({ isLoadingConversations: true });
    try {
      const { conversations } = await fetchCompanionConversations();
      set({ conversations, isLoadingConversations: false });
    } catch {
      set({ isLoadingConversations: false });
    }
  },

  openConversation: async (conversationId) => {
    const target = get().conversations.find((c) => c.id === conversationId);
    await persistConversationId(conversationId);
    if (target?.noteContextId) {
      await persistNoteContext({
        id: target.noteContextId,
        title: target.noteTitle || 'Untitled note',
      });
      set({
        activeConversationId: conversationId,
        pendingNewConversation: false,
        activeNoteContext: {
          id: target.noteContextId,
          title: target.noteTitle || 'Untitled note',
        },
        messages: [],
        historyLoaded: false,
        error: null,
      });
    } else {
      if (target && !target.noteContextId) {
        await persistNoteContext(null);
      }
      set({
        activeConversationId: conversationId,
        pendingNewConversation: false,
        ...(target && !target.noteContextId ? { activeNoteContext: null } : {}),
        messages: [],
        historyLoaded: false,
        error: null,
      });
    }
    await get().loadHistory();
  },

  startNewChat: () => {
    void persistConversationId(null);
    // A new chat is a new chat: on the phone the attachment survived this too,
    // silently scoping the next question to a note the student had left.
    void persistNoteContext(null);
    set({
      activeNoteContext: null,
      activeConversationId: null,
      pendingNewConversation: true,
      messages: [],
      historyLoaded: true,
      error: null,
    });
  },

  setMessageFeedback: (messageId, rating) => {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId ? { ...m, feedback: rating } : m
      ),
    }));
  },

  loadHistory: async () => {
    set({ isLoadingHistory: true, error: null });
    const noteContextId = get().activeNoteContext?.id ?? null;
    const conversationId = get().activeConversationId;
    const pendingNew = get().pendingNewConversation;
    if (pendingNew && !conversationId) {
      set({ isLoadingHistory: false, historyLoaded: true, messages: [] });
      return;
    }
    try {
      const result = await fetchCompanionHistory(
        conversationId ? { conversationId } : { noteContextId }
      );
      const previousFeedback = new Map(
        get()
          .messages.filter((m) => m.feedback === 'up' || m.feedback === 'down')
          .map((m) => [m.id, m.feedback as 'up' | 'down'])
      );
      if (conversationId && (get().activeConversationId ?? null) !== conversationId) {
        return;
      }
      if (!conversationId && (get().activeNoteContext?.id ?? null) !== noteContextId) {
        return;
      }
      if (result.conversationId) {
        await persistConversationId(result.conversationId);
      }
      set({
        messages: result.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          actions: m.actions,
          feedback: m.feedback ?? previousFeedback.get(m.id) ?? null,
          created_at: m.created_at,
        })),
        activeConversationId: result.conversationId ?? get().activeConversationId,
        pendingNewConversation: false,
        isLoadingHistory: false,
        historyLoaded: true,
      });
    } catch {
      if (conversationId && (get().activeConversationId ?? null) !== conversationId) {
        return;
      }
      if (!conversationId && (get().activeNoteContext?.id ?? null) !== noteContextId) {
        return;
      }
      set({ isLoadingHistory: false, historyLoaded: true });
    }
  },

  sendMessage: async (text: string, context?: CompanionUserContext) => {
    const oneShot = get().pendingMessageContext;
    if (oneShot) set({ pendingMessageContext: null });
    const mergedContext = mergeThreadContext(get, oneShot ? { ...oneShot, ...context } : context);

    const tempUserMsg: CompanionMessage = {
      id: `tmp-user-${Date.now()}`,
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    };

    set((s) => ({
      messages: [...s.messages, tempUserMsg],
      isLoading: true,
      error: null,
    }));

    try {
      const { reply, actions, citations, conversationId } = await companionSendMessage(text, mergedContext);
      if (conversationId) {
        await persistConversationId(conversationId);
      }
      const assistantMsg: CompanionMessage = {
        id: `tmp-ai-${Date.now()}`,
        role: 'assistant',
        content: reply,
        actions: actions?.length ? actions : undefined,
        citations: citations ?? null,
        created_at: new Date().toISOString(),
      };
      set((s) => ({
        messages: [...s.messages, assistantMsg],
        isLoading: false,
        activeConversationId: conversationId || s.activeConversationId,
        pendingNewConversation: false,
      }));
      void get().loadConversations();
    } catch (err: unknown) {
      set((s) => ({
        messages: s.messages.filter((m) => m.id !== tempUserMsg.id),
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to reach Lantern. Please try again.',
      }));
    }
  },

  sendMessageStreaming: async (text: string, context?: CompanionUserContext) => {
    const oneShot = get().pendingMessageContext;
    if (oneShot) set({ pendingMessageContext: null });
    const mergedContext = mergeThreadContext(get, oneShot ? { ...oneShot, ...context } : context);

    const tempUserMsg: CompanionMessage = {
      id: `tmp-user-${Date.now()}`,
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    };
    const tempAiId = `tmp-ai-${Date.now()}`;
    const tempAiMsg: CompanionMessage = {
      id: tempAiId,
      role: 'assistant',
      content: '',
      created_at: new Date().toISOString(),
    };

    set((s) => ({
      messages: [...s.messages, tempUserMsg, tempAiMsg],
      isStreaming: true,
      isLoading: false,
      error: null,
    }));

    await companionSendMessageStream(
      text,
      mergedContext,
      (token) => {
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === tempAiId ? { ...m, content: m.content + token } : m
          ),
        }));
      },
      ({ actions, citations, messageId, userMessageId, conversationId }) => {
        if (conversationId) {
          void persistConversationId(conversationId);
        }
        set((s) => ({
          messages: s.messages.map((m) => {
            if (m.id === tempAiId) {
              return {
                ...m,
                id: messageId || m.id,
                actions: actions.length ? actions : undefined,
                citations: citations ?? null,
              };
            }
            if (userMessageId && m.id === tempUserMsg.id) {
              return { ...m, id: userMessageId };
            }
            return m;
          }),
          isStreaming: false,
          activeConversationId: conversationId || s.activeConversationId,
          pendingNewConversation: false,
        }));
        void get().loadConversations();
      },
      (err) => {
        set((s) => ({
          messages: s.messages.filter((m) => m.id !== tempUserMsg.id && m.id !== tempAiId),
          isStreaming: false,
          error: err.message || 'Failed to reach Lantern. Please try again.',
          // Hand the typed text back to the composer instead of destroying it.
          failedMessage: text,
        }));
      }
    );
  },

  clearHistory: async () => {
    const conversationId = get().activeConversationId;
    const noteContextId = get().activeNoteContext?.id ?? null;
    try {
      await clearCompanionHistory(
        conversationId ? { conversationId } : { noteContextId }
      );
      await persistConversationId(null);
      set({
        messages: [],
        activeConversationId: null,
        pendingNewConversation: true,
      });
      void get().loadConversations();
    } catch (err: unknown) {
      set({
        error: err instanceof Error ? err.message : 'Failed to clear conversation.',
      });
    }
  },
}));
