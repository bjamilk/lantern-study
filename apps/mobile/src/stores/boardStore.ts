import { create } from 'zustand';
import { COMMUNITY_BOARD_COPY, boardPageSize } from '@lantern/shared/network';
import * as api from '../services/api';
import { mapApiMessage, useGroupStore, type Message } from './groupStore';

/**
 * Community boards — the thin slice of state a board needs on top of the chat
 * store (spec §4.3).
 *
 * It deliberately does NOT fork `messagesCache`: posts and comments are the
 * same `messages` rows the group store already holds, so the existing realtime
 * subscription, the optimistic send and `Not sent · Retry` all keep working
 * unchanged. What lives here is only what a chat has no concept of — the one
 * server-side pinned post, and its degrade before the boards migration lands.
 */
interface BoardState {
  /** groupId → the board's one pinned post (null = none / not loaded). */
  pinnedByGroup: Record<string, Message | null>;
  pinBusyByGroup: Record<string, boolean>;
  /** e.g. `Pinning is not available yet` before the migration is applied. */
  pinErrorByGroup: Record<string, string | null>;
  /**
   * Per-board first-page spinner. The group store's `isLoadingMessages` is
   * cleared only for the ACTIVE chat group, and a board never becomes one, so
   * a board that read it would spin forever on an empty board.
   */
  postsLoadingByGroup: Record<string, boolean>;

  loadPinned: (groupId: string) => Promise<void>;
  /** Drop the strip when the post behind it is deleted, edited away or unpinned elsewhere. */
  clearPinned: (groupId: string) => void;
  setPin: (groupId: string, messageId: string, pinned: boolean) => Promise<boolean>;
  clearPinError: (groupId: string) => void;

  loadPosts: (
    groupId: string,
    options?: { refresh?: boolean; lowDataMode?: boolean }
  ) => Promise<void>;
  loadOlderPosts: (groupId: string, options?: { lowDataMode?: boolean }) => Promise<number>;

  postToBoard: (
    groupId: string,
    input: { text: string; subject?: string | null; senderId: string; mentionedUserIds?: string[] }
  ) => Promise<void>;
  commentOnPost: (
    groupId: string,
    input: { rootId: string; text: string; senderId: string; mentionedUserIds?: string[] }
  ) => Promise<void>;
}

const statusOf = (error: unknown): number | undefined =>
  (error as { status?: number } | null)?.status;

const messageOf = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

/** Names on a pinned row come from the same roster the chat cache uses. */
const rosterFor = (groupId: string) =>
  useGroupStore.getState().groups.find((g) => g.id === groupId)?.members;

export const useBoardStore = create<BoardState>((set, get) => ({
  pinnedByGroup: {},
  pinBusyByGroup: {},
  pinErrorByGroup: {},
  postsLoadingByGroup: {},

  clearPinned: (groupId) => {
    set((state) => ({ pinnedByGroup: { ...state.pinnedByGroup, [groupId]: null } }));
  },

  clearPinError: (groupId) => {
    set((state) => ({ pinErrorByGroup: { ...state.pinErrorByGroup, [groupId]: null } }));
  },

  loadPinned: async (groupId) => {
    try {
      const result = await api.fetchPinnedMessage(groupId);
      const raw = result?.message ?? null;
      const mapped = raw ? mapApiMessage(raw, groupId, rosterFor(groupId)) : null;
      set((state) => ({
        pinnedByGroup: {
          ...state.pinnedByGroup,
          // A pin can outlive the post it points at; a tombstone is never the
          // PINNED strip. The server filters these too — this is the client
          // half, so a row already in hand cannot resurrect one.
          [groupId]: mapped && !mapped.removedAt ? mapped : null,
        },
      }));
    } catch {
      // A board whose pin cannot be read still renders every post: leave the
      // strip absent rather than blocking the screen on it.
      set((state) => ({ pinnedByGroup: { ...state.pinnedByGroup, [groupId]: null } }));
    }
  },

  setPin: async (groupId, messageId, pinned) => {
    if (get().pinBusyByGroup[groupId]) return false;
    set((state) => ({
      pinBusyByGroup: { ...state.pinBusyByGroup, [groupId]: true },
      pinErrorByGroup: { ...state.pinErrorByGroup, [groupId]: null },
    }));
    try {
      const raw = await api.setMessagePin(messageId, pinned);
      const mapped = raw ? mapApiMessage(raw, groupId, rosterFor(groupId)) : null;
      set((state) => ({
        pinnedByGroup: { ...state.pinnedByGroup, [groupId]: pinned ? mapped : null },
      }));
      // The card's own row carries the pin state too, so the ⋯ menu flips
      // without waiting for a refetch.
      useGroupStore.getState().patchMessageInState(messageId, {
        pinnedAt: pinned ? (mapped?.pinnedAt ?? new Date().toISOString()) : null,
      });
      return true;
    } catch (error) {
      set((state) => ({
        pinErrorByGroup: {
          ...state.pinErrorByGroup,
          [groupId]:
            statusOf(error) === 503
              ? COMMUNITY_BOARD_COPY.pinUnavailable
              : messageOf(error, COMMUNITY_BOARD_COPY.pinUnavailable),
        },
      }));
      return false;
    } finally {
      set((state) => ({ pinBusyByGroup: { ...state.pinBusyByGroup, [groupId]: false } }));
    }
  },

  loadPosts: async (groupId, options) => {
    set((state) => ({ postsLoadingByGroup: { ...state.postsLoadingByGroup, [groupId]: true } }));
    try {
      await useGroupStore.getState().fetchMessages(groupId, {
        page: 1,
        refresh: options?.refresh ?? true,
        limit: boardPageSize(!!options?.lowDataMode),
        rootsOnly: true,
      });
    } finally {
      set((state) => ({
        postsLoadingByGroup: { ...state.postsLoadingByGroup, [groupId]: false },
      }));
    }
  },

  loadOlderPosts: async (groupId, options) =>
    useGroupStore.getState().loadMoreMessages(groupId, {
      limit: boardPageSize(!!options?.lowDataMode),
      rootsOnly: true,
    }),

  postToBoard: async (groupId, input) => {
    await useGroupStore.getState().sendMessage(groupId, input.text, input.senderId, undefined, {
      subject: input.subject ?? null,
      mentionedUserIds: input.mentionedUserIds,
      // A board post is never a question, even when the body starts with `{`
      // (§3.4): the same guarantee the API makes, made on the client too.
      plainText: true,
    });
  },

  commentOnPost: async (groupId, input) => {
    await useGroupStore.getState().sendMessage(groupId, input.text, input.senderId, undefined, {
      replyToMessageId: input.rootId,
      mentionedUserIds: input.mentionedUserIds,
      plainText: true,
    });
  },
}));

export default useBoardStore;
