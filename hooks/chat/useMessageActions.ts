/**
 * Everything a reader can DO to a message in an open conversation: react to it,
 * star it, pin it, copy it — plus the state each of those needs.
 *
 * Extracted verbatim from `components/ChatWindow.tsx` (lane M8, step 5). Three
 * pieces of state (`myReactions`, `starredIds`, `pinnedMessageId`) and two
 * effects (the reaction hydration and the device-local star/pin re-read) moved
 * with the callbacks that own them.
 *
 * Touches:
 *  - services/supabase: `fetchUserReactionsForGroup` / `fetchUserReactionsForThread`
 *    to hydrate, `addMessageReaction` / `removeMessageReaction` to write.
 *  - `groupStore.updateMessageInState`, for the optimistic reaction COUNT.
 *  - localStorage, for the starred set and the pinned id (`chatStarredStorageKey` /
 *    `chatPinnedMessageStorageKey`), per user + scope + chat.
 *  - `navigator.clipboard`, and `toastStore` for the result of both writes.
 *
 * Gotchas:
 *  - Reaction writes go through the BFF endpoints. Do NOT move them back to a
 *    PostgREST `.upsert({ onConflict })`: the unique index is PARTIAL and every
 *    write 500s (42P10).
 *  - EFFECT ORDER: in the untouched file the reaction effect was ChatWindow's
 *    3rd and the star/pin effect its ~17th; both now run at this hook's call
 *    site. Both only enqueue state (one from a promise, one from a synchronous
 *    localStorage read) and nothing registered between the two old positions
 *    reads that state inside an effect, so the batched result of a commit is
 *    the same either way. Keep the call ABOVE every effect that renders from
 *    `starredIds` if that ever stops being true.
 *  - Star and pin are device-local and deliberately unsynced: another device
 *    shows different stars. Every storage access is wrapped because it throws
 *    in private mode.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  applyReactionLocally,
  chatPinnedMessageStorageKey,
  chatStarredStorageKey,
  parseStoredIdSet,
  serializeIdSet,
} from '@lantern/shared/chat';
import {
  addMessageReaction,
  removeMessageReaction,
  fetchUserReactionsForGroup,
  fetchUserReactionsForThread,
} from '../../services/supabase';
import type { ChatItem, Message, User } from '../../types';

export interface UseMessageActionsParams {
  chat: ChatItem | null;
  currentUser: User;
  isGroup: boolean;
  /** The RAW `messages` prop, not the array-guarded copy — see the call site. */
  messagesProp: Message[];
  /** `groupStore.updateMessageInState`, for the optimistic reaction count. */
  updateMessageInState: (messageId: string, patch: Record<string, unknown>) => void;
  showToast: (message: string, kind: 'success' | 'error') => void;
  /** Closing a conversation clears the list views these marks drive. */
  setStarredOnly: (on: boolean) => void;
  setThreadSearch: (query: string) => void;
  setThreadSearchOpen: (open: boolean) => void;
}

export interface MessageActions {
  /** The viewer's OWN reactions per message: { messageId: ['👍'] }. */
  myReactions: Record<string, string[]>;
  handleToggleReaction: (messageId: string, emoji: string, added: boolean) => Promise<void>;
  starredIds: Set<string>;
  pinnedMessageId: string | null;
  handleToggleStar: (message: Message) => void;
  handleTogglePin: (message: Message) => void;
  handleCopyMessage: (message: Message) => Promise<void>;
}

export function useMessageActions({
  chat,
  currentUser,
  isGroup,
  messagesProp,
  updateMessageInState,
  showToast,
  setStarredOnly,
  setThreadSearch,
  setThreadSearchOpen,
}: UseMessageActionsParams): MessageActions {
  /**
   * The viewer's OWN reactions per message: { messageId: ['👍'] }. Counts live
   * on the message itself (server-owned, realtime-delivered); this map only
   * decides which chips render as "mine". Kept local to the chat window rather
   * than threaded through App state — nothing else needs it.
   */
  const [myReactions, setMyReactions] = useState<Record<string, string[]>>({});

  // Hydrate the viewer's own reactions whenever the open conversation changes.
  // Driven by `chat.id` (+ type, which picks the group or DM endpoint). Failure
  // is swallowed: counts still render, only the "mine" highlight is missing.
  useEffect(() => {
    if (!chat?.id) {
      setMyReactions({});
      return;
    }
    let cancelled = false;
    const load = chat.chatType === 'group'
      ? fetchUserReactionsForGroup(chat.id)
      : fetchUserReactionsForThread(chat.id);
    void load
      .then((map) => {
        if (!cancelled) setMyReactions(map || {});
      })
      .catch(() => {
        // Best effort: chips just render unselected until the next open.
      });
    return () => {
      cancelled = true;
    };
  }, [chat?.id, chat?.chatType]);

  /**
   * Toggle one emoji. Optimistic on both halves — the viewer's own chip and the
   * visible count — then reconciled with the authoritative counts the server
   * returns. Everyone else sees it via the existing realtime message UPDATE.
   *
   * Failure path: BOTH optimistic halves are rolled back to the values captured
   * before the write (`previousMine`, `previousCounts`) and the error surfaces as
   * a toast. The write goes to the BFF reactions endpoint — see the file header
   * on why it must never become a PostgREST upsert again.
   */
  const handleToggleReaction = useCallback(
    async (messageId: string, emoji: string, added: boolean) => {
      const previousMine = myReactions[messageId] ? [...myReactions[messageId]] : [];
      const message = messagesProp.find((m) => m.id === messageId);
      const previousCounts = message?.reactions;

      setMyReactions((prev) => {
        const mine = new Set(prev[messageId] || []);
        if (added) mine.add(emoji);
        else mine.delete(emoji);
        return { ...prev, [messageId]: [...mine] };
      });
      updateMessageInState(messageId, {
        reactions: applyReactionLocally(previousCounts, emoji, added),
      });

      try {
        const reactions = added
          ? await addMessageReaction(messageId, emoji)
          : await removeMessageReaction(messageId, emoji);
        updateMessageInState(messageId, { reactions });
      } catch (error) {
        setMyReactions((prev) => ({ ...prev, [messageId]: previousMine }));
        updateMessageInState(messageId, { reactions: previousCounts });
        showToast(
          error instanceof Error ? error.message : 'Could not save that reaction',
          'error'
        );
      }
    },
    [myReactions, messagesProp, updateMessageInState, showToast]
  );

  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());
  const [pinnedMessageId, setPinnedMessageId] = useState<string | null>(null);

  // Device-local marks: starred ids + the one pinned message, re-read per
  // user/scope/chat. Nothing here is synced, so another device shows different
  // stars; every write is wrapped because storage can throw in private mode.
  useEffect(() => {
    if (!chat) {
      setStarredIds(new Set());
      setPinnedMessageId(null);
      setStarredOnly(false);
      setThreadSearch('');
      setThreadSearchOpen(false);
      return;
    }
    const scope = isGroup ? 'group' : 'dm';
    try {
      setStarredIds(parseStoredIdSet(localStorage.getItem(chatStarredStorageKey(currentUser.id, scope, chat.id))));
      setPinnedMessageId(localStorage.getItem(chatPinnedMessageStorageKey(currentUser.id, scope, chat.id)));
    } catch {
      setStarredIds(new Set());
      setPinnedMessageId(null);
    }
  }, [chat?.id, currentUser.id, isGroup]);

  const persistStarredIds = (next: Set<string>) => {
    if (!chat) return;
    const scope = isGroup ? 'group' : 'dm';
    try {
      localStorage.setItem(chatStarredStorageKey(currentUser.id, scope, chat.id), serializeIdSet(next));
    } catch {
      // Device-local marks are best-effort.
    }
  };

  const handleToggleStar = (message: Message) => {
    setStarredIds((prev) => {
      const next = new Set(prev);
      if (next.has(message.id)) next.delete(message.id);
      else next.add(message.id);
      persistStarredIds(next);
      return next;
    });
  };

  const handleTogglePin = (message: Message) => {
    if (!chat) return;
    const scope = isGroup ? 'group' : 'dm';
    const key = chatPinnedMessageStorageKey(currentUser.id, scope, chat.id);
    const next = pinnedMessageId === message.id ? null : message.id;
    setPinnedMessageId(next);
    try {
      if (next) localStorage.setItem(key, next);
      else localStorage.removeItem(key);
    } catch {
      // Device-local marks are best-effort.
    }
  };

  const handleCopyMessage = async (message: Message) => {
    const text = (message.questionStem || message.text || '').trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copied', 'success');
    } catch {
      showToast('Could not copy', 'error');
    }
  };

  return {
    myReactions,
    handleToggleReaction,
    starredIds,
    pinnedMessageId,
    handleToggleStar,
    handleTogglePin,
    handleCopyMessage,
  };
}
