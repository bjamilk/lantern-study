/**
 * AI Companion Store
 * Manages conversation state for the Lantern AI companion panel.
 * Note-attached chats use a separate server thread keyed by noteId.
 */
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CompanionMessage, CompanionUserContext } from '@lantern/shared';
import {
  companionSendMessage,
  companionSendMessageStream,
  fetchCompanionHistory,
  clearCompanionHistory,
} from '../services/ai';

export type CompanionNoteContext = {
  id: string;
  title: string;
};

const NOTE_CONTEXT_STORAGE_KEY = 'lantern_companion_note_context';

async function readPersistedNoteContext(): Promise<CompanionNoteContext | null> {
  try {
    const raw = await AsyncStorage.getItem(NOTE_CONTEXT_STORAGE_KEY);
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

async function persistNoteContext(ctx: CompanionNoteContext | null) {
  try {
    if (!ctx) await AsyncStorage.removeItem(NOTE_CONTEXT_STORAGE_KEY);
    else await AsyncStorage.setItem(NOTE_CONTEXT_STORAGE_KEY, JSON.stringify(ctx));
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
  openWithMessage: (msg: string) => void;

  activeNoteContext: CompanionNoteContext | null;
  hydrateNoteContext: () => Promise<void>;
  setActiveNoteContext: (ctx: CompanionNoteContext | null) => Promise<void>;

  messages: CompanionMessage[];
  isLoading: boolean;
  isLoadingHistory: boolean;
  historyLoaded: boolean;
  isStreaming: boolean;
  error: string | null;

  loadHistory: () => Promise<void>;
  setMessageFeedback: (messageId: string, rating: 'up' | 'down' | null) => void;
  sendMessage: (text: string, context?: CompanionUserContext) => Promise<void>;
  sendMessageStreaming: (text: string, context?: CompanionUserContext) => Promise<void>;
  clearHistory: () => Promise<void>;
  clearError: () => void;
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
  activeNoteContext: null,

  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  clearError: () => set({ error: null }),
  setPendingMessage: (msg) => set({ pendingMessage: msg }),
  openWithMessage: (msg) => set({ isOpen: true, pendingMessage: msg }),

  hydrateNoteContext: async () => {
    const ctx = await readPersistedNoteContext();
    if (!ctx) return;
    if (get().activeNoteContext?.id === ctx.id) return;
    set({ activeNoteContext: ctx });
  },

  setActiveNoteContext: async (ctx) => {
    const prev = get().activeNoteContext;
    const nextId = ctx?.id ?? null;
    const prevId = prev?.id ?? null;
    if (nextId === prevId && (ctx?.title ?? null) === (prev?.title ?? null)) {
      return;
    }
    await persistNoteContext(ctx);
    set({
      activeNoteContext: ctx,
      messages: [],
      historyLoaded: false,
      error: null,
    });
    await get().loadHistory();
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
    try {
      const { messages } = await fetchCompanionHistory(noteContextId);
      const previousFeedback = new Map(
        get()
          .messages.filter((m) => m.feedback === 'up' || m.feedback === 'down')
          .map((m) => [m.id, m.feedback as 'up' | 'down'])
      );
      if ((get().activeNoteContext?.id ?? null) !== noteContextId) {
        return;
      }
      set({
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          actions: m.actions,
          feedback: m.feedback ?? previousFeedback.get(m.id) ?? null,
          created_at: m.created_at,
        })),
        isLoadingHistory: false,
        historyLoaded: true,
      });
    } catch {
      if ((get().activeNoteContext?.id ?? null) !== noteContextId) {
        return;
      }
      set({ isLoadingHistory: false, historyLoaded: true });
    }
  },

  sendMessage: async (text: string, context?: CompanionUserContext) => {
    const noteCtx = get().activeNoteContext;
    const mergedContext: CompanionUserContext = {
      ...context,
      ...(noteCtx
        ? { noteId: noteCtx.id, noteTitle: noteCtx.title, noteContext: undefined }
        : { noteId: undefined, noteTitle: undefined, noteContext: undefined }),
    };

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
      const { reply, actions } = await companionSendMessage(text, mergedContext);
      const assistantMsg: CompanionMessage = {
        id: `tmp-ai-${Date.now()}`,
        role: 'assistant',
        content: reply,
        actions: actions?.length ? actions : undefined,
        created_at: new Date().toISOString(),
      };
      set((s) => ({ messages: [...s.messages, assistantMsg], isLoading: false }));
    } catch (err: unknown) {
      set((s) => ({
        messages: s.messages.filter((m) => m.id !== tempUserMsg.id),
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to reach Lantern. Please try again.',
      }));
    }
  },

  sendMessageStreaming: async (text: string, context?: CompanionUserContext) => {
    const noteCtx = get().activeNoteContext;
    const mergedContext: CompanionUserContext = {
      ...context,
      ...(noteCtx
        ? { noteId: noteCtx.id, noteTitle: noteCtx.title, noteContext: undefined }
        : { noteId: undefined, noteTitle: undefined, noteContext: undefined }),
    };

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
      ({ actions, messageId, userMessageId }) => {
        set((s) => ({
          messages: s.messages.map((m) => {
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
        }));
      },
      (err) => {
        set((s) => ({
          messages: s.messages.filter((m) => m.id !== tempUserMsg.id && m.id !== tempAiId),
          isStreaming: false,
          error: err.message || 'Failed to reach Lantern. Please try again.',
        }));
      }
    );
  },

  clearHistory: async () => {
    const noteContextId = get().activeNoteContext?.id ?? null;
    try {
      await clearCompanionHistory(noteContextId);
      set({ messages: [] });
    } catch (err: unknown) {
      set({
        error: err instanceof Error ? err.message : 'Failed to clear conversation.',
      });
    }
  },
}));
