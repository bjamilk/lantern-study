import { create } from 'zustand';
import {
  COMMUNITY_BOARD_COPY,
  boardPageSize,
  boardQuoteSnippet,
  boardRepostRefusalCopy,
  type BoardQuotedPost,
} from '@lantern/shared/network';
import * as api from '../services/api';
import * as boardApi from '../services/boardActions';
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

  /**
   * Which posts the viewer has bookmarked, per board, and whether the server
   * can answer at all. `bookmarksSupported[groupId] === false` means
   * `message_bookmarks` is not applied yet: the clients hide the Bookmark
   * control and keep today's device-local save working (§2 degrade).
   */
  bookmarkedByGroup: Record<string, string[]>;
  bookmarksSupported: Record<string, boolean>;

  loadBookmarks: (groupId: string) => Promise<void>;
  /** Optimistic; reverts and returns false when the server refuses. */
  toggleBookmark: (groupId: string, messageId: string, next: boolean) => Promise<boolean>;

  /**
   * Repost a post onto its OWN board. Resolves the refusal copy to show, or
   * null on success. The client hides the control on a refusal it can see
   * (`canRepostBoardPost`); the server re-checks every rule regardless.
   */
  repost: (groupId: string, originalId: string, quote?: string | null) => Promise<string | null>;
  undoRepost: (groupId: string, originalId: string) => Promise<string | null>;

  postToBoard: (
    groupId: string,
    input: {
      text: string;
      subject?: string | null;
      senderId: string;
      mentionedUserIds?: string[];
      /** One photo, carried on `messages.image_url` — the post is ONE row (§5.2). */
      imageUrl?: string | null;
    }
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

/**
 * The text-only embed a repost points at, built from the row the board already
 * holds. Mirrors the server's `toQuotedPost`: `boardQuoteSnippet` strips image
 * and audio markdown, so a signed media URL can never ride inside a repost
 * card — the embed reports that media EXISTS and nothing more.
 */
function quotedFrom(original: Message): BoardQuotedPost {
  const text = original.removedAt || original.isRemoved ? '' : (original.text ?? '');
  return {
    id: original.id,
    senderName: original.senderName || 'Someone',
    timestamp: original.createdAt,
    subject: original.subject ?? null,
    snippet: boardQuoteSnippet(text),
    hasImage: !!original.imageUrl || /!\[[^\]]*\]\(https?:\/\//i.test(text),
    hasAudio: /\[audio\]\(https?:\/\//i.test(text),
    removedAt: original.removedAt ?? null,
  };
}

/** Names on a pinned row come from the same roster the chat cache uses. */
const rosterFor = (groupId: string) =>
  useGroupStore.getState().groups.find((g) => g.id === groupId)?.members;

export const useBoardStore = create<BoardState>((set, get) => ({
  pinnedByGroup: {},
  pinBusyByGroup: {},
  pinErrorByGroup: {},
  postsLoadingByGroup: {},
  bookmarkedByGroup: {},
  bookmarksSupported: {},

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

  loadBookmarks: async (groupId) => {
    try {
      const result = await boardApi.fetchGroupBookmarks(groupId);
      set((state) => ({
        bookmarkedByGroup: {
          ...state.bookmarkedByGroup,
          [groupId]: result?.messageIds ?? [],
        },
        bookmarksSupported: {
          ...state.bookmarksSupported,
          [groupId]: result?.serverBacked !== false,
        },
      }));
    } catch {
      // A board whose bookmarks cannot be read still renders every post. The
      // control is hidden rather than shown broken — an icon that silently
      // does nothing is worse than an absent one.
      set((state) => ({
        bookmarksSupported: { ...state.bookmarksSupported, [groupId]: false },
      }));
    }
  },

  toggleBookmark: async (groupId, messageId, next) => {
    const previous = get().bookmarkedByGroup[groupId] ?? [];
    const optimistic = next
      ? [...new Set([...previous, messageId])]
      : previous.filter((id) => id !== messageId);
    set((state) => ({
      bookmarkedByGroup: { ...state.bookmarkedByGroup, [groupId]: optimistic },
    }));
    // The card also reads `message.bookmarked` off the row (that is what the
    // board page hydration fills in), so both copies have to move together or
    // the icon flips back on the next re-render.
    useGroupStore.getState().patchMessageInState(messageId, { bookmarked: next });
    try {
      await boardApi.setMessageBookmark(messageId, next);
      return true;
    } catch (error) {
      set((state) => ({
        bookmarkedByGroup: { ...state.bookmarkedByGroup, [groupId]: previous },
        ...(statusOf(error) === 503
          ? { bookmarksSupported: { ...state.bookmarksSupported, [groupId]: false } }
          : {}),
      }));
      useGroupStore.getState().patchMessageInState(messageId, { bookmarked: !next });
      return false;
    }
  },

  repost: async (groupId, originalId, quote) => {
    const original = useGroupStore
      .getState()
      .messagesCache[groupId]?.find((m) => m.id === originalId);
    try {
      const raw = await boardApi.createBoardRepost(originalId, quote);
      if (raw) {
        /**
         * The 201 is a bare INSERT ... RETURNING *: it carries no `repostOf`,
         * because hydration is a page-level query the write path never runs.
         * Appending it raw would put a card on the board reading "This post is
         * no longer available" one tap after a successful repost. The embed is
         * synthesised from the original the board already holds instead, using
         * the same `boardQuoteSnippet` the server would have used — so it is
         * the same text, and still text only, never a media URL.
         */
        useGroupStore.getState().appendGroupMessage(groupId, {
          ...(raw as Record<string, unknown>),
          repostOf: original ? quotedFrom(original) : null,
          repostCount: 0,
        });
      }
      useGroupStore.getState().patchMessageInState(originalId, {
        repostedByMe: true,
        repostCount: (original?.repostCount ?? 0) + 1,
      });
      return null;
    } catch (error) {
      const reason = boardApi.repostRefusalFrom(error);
      if (reason) return boardRepostRefusalCopy(reason);
      return error instanceof Error && error.message
        ? error.message
        : COMMUNITY_BOARD_COPY.repostUnavailable;
    }
  },

  undoRepost: async (groupId, originalId) => {
    try {
      const result = await boardApi.undoBoardRepost(originalId);
      const cache = useGroupStore.getState().messagesCache[groupId] || [];
      const current = cache.find((m) => m.id === originalId)?.repostCount ?? 1;
      useGroupStore.getState().patchMessageInState(originalId, {
        repostedByMe: false,
        repostCount: Math.max(0, current - 1),
      });
      /**
       * DROP the repost row rather than tombstoning it. The server hard-deletes
       * it when nothing hangs off it, so `Post removed` would be a card
       * standing in for a row that no longer exists — and an undo the student
       * asked for should leave nothing behind, not a marker saying something
       * was taken down.
       */
      const repostId = result?.repostId;
      if (repostId) {
        useGroupStore.setState((state) => {
          const list = state.messagesCache[groupId];
          if (!list?.some((m) => m.id === repostId)) return state;
          const pruned = list.filter((m) => m.id !== repostId);
          return {
            messagesCache: { ...state.messagesCache, [groupId]: pruned },
            messages:
              state.activeGroupId === groupId
                ? state.messages.filter((m) => m.id !== repostId)
                : state.messages,
          };
        });
      }
      return null;
    } catch (error) {
      return error instanceof Error && error.message
        ? error.message
        : COMMUNITY_BOARD_COPY.repostUnavailable;
    }
  },

  postToBoard: async (groupId, input) => {
    await useGroupStore.getState().sendMessage(groupId, input.text, input.senderId, undefined, {
      subject: input.subject ?? null,
      mentionedUserIds: input.mentionedUserIds,
      imageUrl: input.imageUrl ?? null,
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
