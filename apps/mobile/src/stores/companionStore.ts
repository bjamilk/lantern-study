/**
 * AI Companion Store
 * Manages conversation state for the Lantern AI companion panel
 */
import { create } from 'zustand';
import type { CompanionMessage, CompanionUserContext } from '@lantern/shared';
import {
  companionSendMessage,
  companionSendMessageStream,
  fetchCompanionHistory,
  clearCompanionHistory,
} from '../services/ai';

interface CompanionState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  pendingMessage: string | null;
  setPendingMessage: (msg: string | null) => void;
  openWithMessage: (msg: string) => void;

  messages: CompanionMessage[];
  isLoading: boolean;
  isStreaming: boolean;
  error: string | null;

  loadHistory: () => Promise<void>;
  sendMessage: (text: string, context?: CompanionUserContext) => Promise<void>;
  sendMessageStreaming: (text: string, context?: CompanionUserContext) => Promise<void>;
  clearHistory: () => Promise<void>;
  clearError: () => void;
}

export const useCompanionStore = create<CompanionState>()((set, get) => ({
  isOpen: false,
  messages: [],
  isLoading: false,
  isStreaming: false,
  error: null,
  pendingMessage: null,

  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  clearError: () => set({ error: null }),
  setPendingMessage: (msg) => set({ pendingMessage: msg }),
  openWithMessage: (msg) => set({ isOpen: true, pendingMessage: msg }),

  loadHistory: async () => {
    try {
      const { messages } = await fetchCompanionHistory();
      set({
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          actions: m.actions,
          created_at: m.created_at,
        })),
      });
    } catch {
      // Non-critical — start with empty history if fetch fails
    }
  },

  sendMessage: async (text: string, context?: CompanionUserContext) => {
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
      const { reply, actions } = await companionSendMessage(text, context);
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
      context,
      (token) => {
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === tempAiId ? { ...m, content: m.content + token } : m
          ),
        }));
      },
      (actions) => {
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === tempAiId
              ? { ...m, actions: actions.length ? actions : undefined }
              : m
          ),
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
    try {
      await clearCompanionHistory();
      set({ messages: [] });
    } catch (err: unknown) {
      set({
        error: err instanceof Error ? err.message : 'Failed to clear conversation.',
      });
    }
  },
}));
