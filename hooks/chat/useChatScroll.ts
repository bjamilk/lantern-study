/**
 * Everything the conversation's scroll position knows: where the reader is,
 * where the unread divider goes, when to auto-scroll, and when to page in older
 * history instead.
 *
 * Moved out of `components/ChatWindow.tsx` verbatim (lane M8b, step 4).
 *
 * Touches: the DOM only — `scrollIntoView`, `scrollTop`, `scrollHeight` — plus
 * the two `onLoadMore*` callbacks the caller passes for older history. No
 * network, no storage.
 *
 * ## Effect order (the argument, as lane M8 wrote one for useMessageActions)
 *
 * This hook carries six effects, and it is called at ONE point in the shell:
 * immediately after the shell's own chat-reset effect. That placement is not
 * cosmetic, and two things about it were checked rather than assumed.
 *
 * 1. It must come AFTER the shell's chat-reset effect. On a conversation
 *    change the reset clears the composer and the thread; the anchor effect
 *    here re-arms the opening position. Registering this hook earlier would run
 *    the anchor against the outgoing conversation's state.
 * 2. Two of its effects — "first messages arrived" and the 10s loading backstop
 *    — sat a few lines lower inline, on either side of the shell's overflow-menu
 *    effect, and the other three sat ~340 lines lower, after the typing,
 *    read-receipt, thread and marketplace effects. Collapsing all six to one
 *    point moves them relative to those five. That is safe because NONE of
 *    those five reads or writes anything this hook owns: they drive menu
 *    submenus, two broadcast channels, the thread fetch and focus, and the
 *    marketplace inquiry. The only ordering pairs that matter are internal —
 *    `firstUnreadId` is computed before the anchor effect reads it, and the
 *    anchor seeds `lastMessageIdRef` before the live-update effect compares
 *    against it — and those are preserved exactly, in source order.
 *
 * The chat-reset is the one piece that is not a verbatim move: the shell's
 * single reset effect was split, and the five scroll lines in it became this
 * hook's own `chat?.id` effect, registered directly after the shell's. Both run
 * in the same commit on the same dependency and write disjoint state, so the
 * result is identical — but it is a split, not a move, and this is where that
 * is recorded.
 *
 * ## Gotchas
 *  - the four bookkeeping values are REFS, not state, because the scroll
 *    handler and the live-message effect read them during the same commit that
 *    would be setting them; a state round-trip would act on stale values.
 *  - `initialAnchorDoneRef` holds the chat id whose opening position has already
 *    been decided, which is what makes the anchor once-per-conversation.
 *  - the initial anchor WAITS for `unreadAnchorAt !== undefined`. That is the
 *    "mark-as-read has reported" signal; `null` means fully read, `undefined`
 *    means not reported yet, and the two must not be conflated.
 *  - every computation here works on `visibleMessages`, never on the raw
 *    `messages`: the divider has to sit at the first unread row the reader can
 *    actually SEE.
 */
import React, { useEffect, useRef, useState } from 'react';
import type { ChatItem, Message } from '../../types';

const NEAR_BOTTOM_PX = 120;

interface UseChatScrollOptions {
  chat: ChatItem | null;
  currentUserId: string;
  /** `messages.length` — seeds the count ref and drops the loading state. */
  messagesLength: number;
  /** The filtered list the conversation actually renders. */
  visibleMessages: Message[];
  /**
   * The read watermark: a timestamp, `null` for fully read, `undefined` for
   * "mark-as-read has not reported yet" — which the anchor must wait for.
   */
  unreadAnchorAt?: string | null;
  onLoadMoreMessages?: (chatId: string) => Promise<number>;
  onLoadMoreDirectMessages?: (chatId: string) => Promise<number>;
}

export function useChatScroll({
  chat,
  currentUserId,
  messagesLength,
  visibleMessages,
  unreadAnchorAt,
  onLoadMoreMessages,
  onLoadMoreDirectMessages,
}: UseChatScrollOptions) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const firstUnreadRef = useRef<HTMLDivElement>(null);

  // --- Scroll bookkeeping. These are refs, not state, because the scroll
  // handler and the live-message effect read them during the same commit that
  // would be setting them; a state round-trip would act on stale values.
  // `initialAnchorDoneRef` holds the chat id whose opening position has already
  // been decided, which is what makes the anchor once-per-conversation.
  const prevMessageCountRef = useRef(messagesLength);
  const lastMessageIdRef = useRef<string | null>(null);
  const isNearBottomRef = useRef(true);
  const initialAnchorDoneRef = useRef<string | null>(null);

  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [awaitingMessages, setAwaitingMessages] = useState(false);
  const [newMessagesBelow, setNewMessagesBelow] = useState(0);
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);

  // The scroll half of the shell's chat-reset effect. See the effect-order note
  // in this file's banner: the shell keeps the composer and thread half, this
  // runs directly after it on the same dependency, and the two write disjoint
  // state.
  useEffect(() => {
    setHasMore(true);
    setIsLoadingMore(false);
    setNewMessagesBelow(0);
    setFirstUnreadId(null);
    isNearBottomRef.current = true;
    initialAnchorDoneRef.current = null;
    if (chat) {
      setAwaitingMessages(true);
    }
  }, [chat?.id]);


  // First messages have arrived → drop the "Loading messages…" state.
  useEffect(() => {
    if (messagesLength > 0) {
      setAwaitingMessages(false);
    }
  }, [messagesLength, chat?.id]);

  // Backstop for the loading state: an empty conversation never sets
  // `messages.length > 0`, so without this the spinner would run forever
  // instead of settling into "No messages yet".
  useEffect(() => {
    if (!chat) return;
    const timer = window.setTimeout(() => setAwaitingMessages(false), 10_000);
    return () => window.clearTimeout(timer);
  }, [chat?.id]);

  // Scrolling to the end also clears the pill and re-arms "near bottom", so the
  // two never disagree about where the reader is.
  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
    setNewMessagesBelow(0);
    isNearBottomRef.current = true;
  };

  // Scroll handler, two jobs: track "am I near the bottom" (which decides
  // whether a new message scrolls or only bumps the pill), and page in older
  // history at the very top. The scroll position is restored by height delta
  // after a page loads, so the list does not jump under the reader; `hasMore`
  // latches false on an empty page or a chat type with no pager.
  const handleScroll = async (e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    const nearBottom = distanceFromBottom <= NEAR_BOTTOM_PX;
    isNearBottomRef.current = nearBottom;
    if (nearBottom && newMessagesBelow > 0) {
      setNewMessagesBelow(0);
    }

    // Load more when scrolled to the top (groups and DMs both page older history)
    if (container.scrollTop === 0 && !isLoadingMore && hasMore && chat) {
      const loadOlder =
        chat.chatType === 'group'
          ? onLoadMoreMessages
          : chat.chatType === 'dm'
            ? onLoadMoreDirectMessages
            : undefined;
      if (!loadOlder) {
        // No pager for this chat type — stop implying more history exists.
        setHasMore(false);
        return;
      }
      setIsLoadingMore(true);
      const prevScrollHeight = container.scrollHeight;

      try {
        const count = await loadOlder(chat.id);
        if (count === 0) {
          setHasMore(false);
        } else {
          // Restore scroll position to prevent jumping
          requestAnimationFrame(() => {
            if (container) {
              container.scrollTop = container.scrollHeight - prevScrollHeight;
            }
          });
        }
      } catch (err) {
        console.error('Error loading older messages:', err);
      } finally {
        setIsLoadingMore(false);
      }
    }
  };

  // Compute first unread once the prior marker and messages are available (group + DM).
  // `unreadAnchorAt === undefined` means "not reported yet" and must WAIT;
  // `null` means fully read. Own messages can never be the first unread.
  useEffect(() => {
    if (!chat?.id) {
      setFirstUnreadId(null);
      return;
    }
    if (unreadAnchorAt === undefined) return;
    if (visibleMessages.length === 0) return;

    if (unreadAnchorAt == null) {
      setFirstUnreadId(null);
      return;
    }

    const anchorMs = new Date(unreadAnchorAt).getTime();
    if (Number.isNaN(anchorMs)) {
      setFirstUnreadId(null);
      return;
    }

    const first = visibleMessages.find((msg) => {
      const senderId = msg.sender?.id;
      if (senderId && senderId === currentUserId) return false;
      const ts = new Date(msg.timestamp).getTime();
      return !Number.isNaN(ts) && ts > anchorMs;
    });
    setFirstUnreadId(first?.id ?? null);
  }, [chat?.id, unreadAnchorAt, visibleMessages, currentUserId]);

  // Initial open: scroll to first unread (or bottom when fully read).
  // Runs at most once per chat id (`initialAnchorDoneRef`), and it also seeds
  // `lastMessageIdRef`/`prevMessageCountRef` so the live-update effect below can
  // tell "the list just mounted" from "a new message arrived".
  useEffect(() => {
    if (!chat?.id) return;
    if (visibleMessages.length === 0) return;
    if (initialAnchorDoneRef.current === chat.id) return;

    // Wait until mark-as-read has reported a marker (null = none / fully read).
    if (unreadAnchorAt === undefined) return;
    // Wait a tick so the unread divider DOM node exists when needed.
    const timer = window.setTimeout(() => {
      if (initialAnchorDoneRef.current === chat.id) return;
      initialAnchorDoneRef.current = chat.id;
      lastMessageIdRef.current =
        visibleMessages.length > 0 ? visibleMessages[visibleMessages.length - 1].id : null;
      prevMessageCountRef.current = visibleMessages.length;

      if (firstUnreadId && firstUnreadRef.current) {
        firstUnreadRef.current.scrollIntoView({ behavior: 'auto', block: 'start' });
        isNearBottomRef.current = false;
      } else {
        scrollToBottom('auto');
      }
    }, 50);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat?.id, visibleMessages.length, firstUnreadId, unreadAnchorAt]);

  // Live updates: only auto-scroll when near bottom or the new message is ours.
  // Driven by the identity of the LAST id in `visibleMessages`: an edit, a
  // reaction or a filter change re-runs this effect but exits at the first guard,
  // so only a genuinely new tail message scrolls or increments the pill.
  useEffect(() => {
    const last = visibleMessages.length > 0 ? visibleMessages[visibleMessages.length - 1] : null;
    const lastId = last?.id ?? null;
    if (!lastId || lastId === lastMessageIdRef.current) {
      lastMessageIdRef.current = lastId;
      prevMessageCountRef.current = visibleMessages.length;
      return;
    }

    // Skip the very first paint for a chat — handled by the initial-anchor effect.
    if (initialAnchorDoneRef.current !== chat?.id) {
      lastMessageIdRef.current = lastId;
      prevMessageCountRef.current = visibleMessages.length;
      return;
    }

    const isOwn = last?.sender?.id === currentUserId;
    if (isOwn || isNearBottomRef.current) {
      scrollToBottom('smooth');
    } else {
      const added = Math.max(1, visibleMessages.length - prevMessageCountRef.current);
      setNewMessagesBelow((n) => n + added);
    }
    lastMessageIdRef.current = lastId;
    prevMessageCountRef.current = visibleMessages.length;
  }, [visibleMessages, currentUserId, chat?.id]);

  return {
    messagesEndRef,
    messagesContainerRef,
    firstUnreadRef,
    isLoadingMore,
    awaitingMessages,
    newMessagesBelow,
    firstUnreadId,
    scrollToBottom,
    handleScroll,
  };
}
