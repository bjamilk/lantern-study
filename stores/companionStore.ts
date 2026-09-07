/**
 * AI Companion Store
 * Manages conversation state for the Lantern AI companion panel.
 * Threads are server-backed (conversation_id); note-attached chats keep
 * note_context_id so history can list general + note-linked chats.
 */
import { create } from 'zustand';
import { CompanionConversation, CompanionMessage, CompanionUserContext } from '../types';
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
};

const NOTE_CONTEXT_STORAGE_KEY = 'lantern_companion_note_context';
const CONVERSATION_STORAGE_KEY = 'lantern_companion_conversation_id';

function readPersistedNoteContext(): CompanionNoteContext | null {
  try {
    const raw = localStorage.getItem(NOTE_CONTEXT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id?: unknown; title?: unknown };
    if (typeof parsed.id !== 'string' || !parsed.id.trim()) return null;
    return {
      id: parsed.id.trim(),
      title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : 'Untitled note',
    };
  } catch {
    return null;
  }
}

function persistNoteContext(ctx: CompanionNoteContext | null) {
  try {
    if (!ctx) localStorage.removeItem(NOTE_CONTEXT_STORAGE_KEY);
    else localStorage.setItem(NOTE_CONTEXT_STORAGE_KEY, JSON.stringify(ctx));
  } catch {
    /* ignore quota / private mode */
  }
}

function readPersistedConversationId(): string | null {
  try {
    const raw = localStorage.getItem(CONVERSATION_STORAGE_KEY);
    if (!raw || !raw.trim()) return null;
    return raw.trim();
  } catch {
    return null;
  }
}

function persistConversationId(id: string | null) {
  try {
    if (!id) localStorage.removeItem(CONVERSATION_STORAGE_KEY);
    else localStorage.setItem(CONVERSATION_STORAGE_KEY, id);
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
   * Open the drawer and queue one message. `context` rides with THAT send
   * only (a walk-through's page scope, say) and is dropped afterwards, so the
   * next question the student types is not silently scoped to page 7.
   */
  openWithMessage: (msg: string, context?: Partial<CompanionUserContext>) => void;
  /** One-shot context for the queued message. Consumed by the next send. */
  pendingMessageContext: Partial<CompanionUserContext> | null;
  pendingAssistantMessage: string | null;
  setPendingAssistantMessage: (msg: string | null) => void;
  openWithAssistantMessage: (msg: string) => void;
  injectAssistantMessage: (content: string) => void;

  activeNoteContext: CompanionNoteContext | null;
  setActiveNoteContext: (ctx: CompanionNoteContext | null) => Promise<void>;

  activeConversationId: string | null;
  /** True after "New chat" until the first message creates a server thread. */
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
  /** Delete one conversation from Past chats (the API always supported this;
      the UI only offered deleting the active chat). */
  deleteConversation: (conversationId: string) => Promise<void>;
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
  pendingAssistantMessage: null,
  activeNoteContext: typeof localStorage !== 'undefined' ? readPersistedNoteContext() : null,
  activeConversationId: typeof localStorage !== 'undefined' ? readPersistedConversationId() : null,
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
    set(s =>
      s.isOpen
        ? { isOpen: false, pendingMessage: null, pendingMessageContext: null }
        : { isOpen: true }
    ),
  clearError: () => set({ error: null }),
  deleteConversation: async (conversationId: string) => {
    try {
      await clearCompanionHistory({ conversationId });
      const wasActive = get().activeConversationId === conversationId;
      set(s => ({ conversations: s.conversations.filter(c => c.id !== conversationId) }));
      if (wasActive) {
        persistConversationId(null);
        set({ messages: [], activeConversationId: null, pendingNewConversation: true });
      }
    } catch (err: any) {
      set({ error: err.message || 'Failed to delete chat.' });
    }
  },
  failedMessage: null,
  consumeFailedMessage: () => {
    const msg = get().failedMessage;
    if (msg !== null) set({ failedMessage: null });
    return msg;
  },
  setPendingMessage: (msg) => set({ pendingMessage: msg }),
  openWithMessage: (msg, context) =>
    set({ isOpen: true, pendingMessage: msg, pendingMessageContext: context ?? null }),
  setPendingAssistantMessage: (msg) => set({ pendingAssistantMessage: msg }),
  openWithAssistantMessage: (msg) => set({ isOpen: true, pendingAssistantMessage: msg }),
  injectAssistantMessage: (content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    const assistantMsg: CompanionMessage = {
      id: `assistant-local-${Date.now()}`,
      role: 'assistant',
      content: trimmed,
      created_at: new Date().toISOString(),
    };
    set((s) => ({ messages: [...s.messages, assistantMsg], error: null }));
  },

  setActiveNoteContext: async (ctx) => {
    const prev = get().activeNoteContext;
    const nextId = ctx?.id ?? null;
    const prevId = prev?.id ?? null;
    if (nextId === prevId && (ctx?.title ?? null) === (prev?.title ?? null)) {
      return;
    }
    persistNoteContext(ctx);
    persistConversationId(null);
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
    persistConversationId(conversationId);
    if (target?.noteContextId) {
      persistNoteContext({
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
      // Opening a general chat clears note attach so sends stay on that thread.
      if (target && !target.noteContextId) {
        persistNoteContext(null);
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
    persistConversationId(null);
    set({
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
        conversationId
          ? { conversationId }
          : { noteContextId }
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
        persistConversationId(result.conversationId);
      }
      set({
        messages: result.messages.map(m => ({
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

    set(s => ({
      messages: [...s.messages, tempUserMsg],
      isLoading: true,
      error: null,
    }));

    try {
      const { reply, actions, conversationId } = await companionSendMessage(text, mergedContext);
      if (conversationId) {
        persistConversationId(conversationId);
      }
      const assistantMsg: CompanionMessage = {
        id: `tmp-ai-${Date.now()}`,
        role: 'assistant',
        content: reply,
        actions: actions?.length ? actions : undefined,
        created_at: new Date().toISOString(),
      };
      set(s => ({
        messages: [...s.messages, assistantMsg],
        isLoading: false,
        activeConversationId: conversationId || s.activeConversationId,
        pendingNewConversation: false,
      }));
      void get().loadConversations();
    } catch (err: any) {
      set(s => ({
        messages: s.messages.filter(m => m.id !== tempUserMsg.id),
        isLoading: false,
        error: err.message || 'Failed to reach Lantern. Please try again.',
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

    set(s => ({
      messages: [...s.messages, tempUserMsg, tempAiMsg],
      isStreaming: true,
      isLoading: false,
      error: null,
    }));

    await companionSendMessageStream(
      text,
      mergedContext,
      (token) => {
        set(s => ({
          messages: s.messages.map(m =>
            m.id === tempAiId ? { ...m, content: m.content + token } : m
          ),
        }));
      },
      ({ actions, messageId, userMessageId, conversationId }) => {
        if (conversationId) {
          persistConversationId(conversationId);
        }
        set(s => ({
          messages: s.messages.map(m => {
            if (m.id === tempAiId) {
              return {
                ...m,
                id: messageId || m.id,
                actions: actions.length ? actions : undefined,
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
        set(s => ({
          messages: s.messages.filter(m => m.id !== tempUserMsg.id && m.id !== tempAiId),
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
      persistConversationId(null);
      set({
        messages: [],
        activeConversationId: null,
        pendingNewConversation: true,
      });
      void get().loadConversations();
    } catch (err: any) {
      set({ error: err.message || 'Failed to clear conversation.' });
    }
  },
}));
