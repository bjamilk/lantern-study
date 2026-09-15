/**
 * The whole conversation surface: header, message list, thread side panel,
 * composer, and — for a DM that is a marketplace inquiry — the Offers tab.
 *
 * Exports: default `ChatWindow`. With `chat === null` it renders the chat home /
 * mobile conversation list instead of a conversation.
 *
 * Touches:
 *  - PROPS for the message data. `messages` is owned by the app shell; this
 *    component never merges or caches it (the server-vs-cache merge lives in
 *    `hooks/useAppEffects.ts` and `hooks/useGroupHandlers.ts`). It writes back only
 *    through the `onSendMessage` / `onEditMessage` / `onRemoveMessage` callbacks and
 *    `groupStore.updateMessageInState` (reaction counts).
 *  - services/supabase: reactions (`addMessageReaction` / `removeMessageReaction` /
 *    `fetchUserReactionsFor*`), threads (`fetchGroupThread` / `fetchDmThread`), DM
 *    request accept/decline, block + mute status, presence (`fetchUserProfile`), and
 *    the marketplace set (`getInquiryByThread`, `fetchOffers`, `respondToOffer`,
 *    `fetchOrderForInquiry`, `updateMarketplaceOrder`, `resumeMarketplaceOrderCheckout`).
 *  - supabase realtime BROADCAST channels: `typing:<chatId>` and `chat-read:<chatId>`.
 *  - stores: `uiStore.lowDataMode`, `communityStore.myCommunities`, `toastStore`,
 *    `confirmStore.confirmDialog`, `useBudgetHandlers`.
 *  - localStorage: starred ids and the pinned message id, per user + scope + chat
 *    (`chatStarredStorageKey` / `chatPinnedMessageStorageKey`) — device-local, best effort.
 * Gotchas:
 *  - EVERY hook must stay above the `if (!chat)` early return. Opening a chat from the
 *    empty state otherwise changes the hook count (React error #310).
 *  - Reaction writes go through the BFF endpoints. Do NOT move them back to a PostgREST
 *    `.upsert({ onConflict })`: the unique index is PARTIAL and every write 500s (42P10).
 *  - Auto-scroll is conditional on `isNearBottomRef` / own-message; the initial position
 *    is decided once per chat id by `initialAnchorDoneRef` and must wait for
 *    `unreadAnchorAt !== undefined`, which is the "mark-as-read has reported" signal.
 *  - Colours are `lantern-*` tokens plus Tailwind palette steps with explicit `dark:`
 *    pairs; there is no JS theme branch here and none should be added.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyReactionLocally,
  buildChatHome,
  chatPinnedMessageStorageKey,
  chatStarredStorageKey,
  collectChatGalleryItems,
  formatChatPresenceLine,
  parseStoredIdSet,
  serializeIdSet,
  type ChatHomeLounge,
} from '@lantern/shared/chat';
import { ChatGalleryModal } from './chat/ChatGalleryModal';
import { ForwardChatModal } from './chat/ForwardChatModal';
import { COMMUNITY_COPY } from '@lantern/shared/network';
import { ChatHomePane } from './chat/ChatHomePane';
import {
  addMessageReaction,
  removeMessageReaction,
  fetchUserReactionsForGroup,
  fetchUserReactionsForThread,
} from '../services/supabase';
import { useGroupStore } from '../stores/groupStore';
import { useCommunityStore } from '../stores/communityStore';
import { fetchMyInquiries, fetchUserProfile } from '../services/supabase';
import { useToastStore } from '../stores/toastStore';
import { confirmDialog } from '../stores/confirmStore';
import { Group, Message, User, DMThread, ChatItem, MarketplaceInquiry, MarketplaceOffer, MarketplaceOrder, MessageReplyPreview } from '../types';
import MessageItem from './MessageItem';
import ReportContentModal from './moderation/ReportContentModal';
import type { ContentReportTargetType } from '@lantern/shared';
import MessageInputBar, { type SendMessageOptions } from './MessageInputBar';
import GroupListItem from './GroupListItem';
import { Avatar, Menu, MenuTrigger, MenuContent, MenuItem, MenuSubmenu, MenuSeparator, Tabs, TabList, Tab, TabPanel } from './ui';
import { resolveAvatarSrc } from '../utils/avatar';
import { normalizeStorageUrl } from '../utils/storageUrl';
import { useUIStore } from '../stores/uiStore';
import {
  canRespondToOffer,
  canWithdrawOffer,
  getOfferProposedBy,
  resolveGroupChatSenderLabel,
  shouldRenderRemovedMessage,
} from '@lantern/shared/utils';
import {
  CHAT_MUTE_DURATIONS,
  formatMuteUntilLabel,
  type ChatMuteDurationId,
} from '@lantern/shared';
import { isCommunityBoard } from '@lantern/shared/network';
import {
  getInquiryByThread,
  fetchOffers,
  respondToOffer,
  updateInquiryStatus,
  fetchOrderForInquiry,
  updateMarketplaceOrder,
  resumeMarketplaceOrderCheckout,
  supabase,
  fetchGroupThread,
  fetchDmThread,
  acceptDmMessageRequest,
  declineDmMessageRequest,
  getDmBlockStatus,
  blockUser,
  unblockUser,
  getDmMuteStatus,
  muteDmThread,
  unmuteDmThread,
  getGroupMuteStatus,
  muteGroupChat,
  unmuteGroupChat,
} from '../services/supabase';
import MakeOfferModal from './MakeOfferModal';
import { useBudgetHandlers } from '../hooks/useBudgetHandlers';
import {
  mapMessagesFromApi,
  QUESTION_VISIBILITY_MODE_OPTIONS,
  messagePassesQuestionVisibility,
  type QuestionVisibilityMode,
} from '@lantern/shared/utils';
import { useQuestionVisibilityMode } from '../hooks/useQuestionVisibilityMode';
import { AppIcon } from './ui/AppIcon';


interface ChatWindowProps {
  chat: ChatItem | null;
  messages: Message[];
  currentUser: User;
  userVotes: Record<string, 'up' | 'down' | undefined>;
  onSendMessage: (text: string, options?: SendMessageOptions) => void | Promise<void>;
  onEditMessage: (messageId: string, content: string) => Promise<unknown>;
  onRemoveMessage: (messageId: string) => Promise<unknown>;
  /** Apply peer read watermark updates to local own-message receipts. */
  onPeerChatRead?: (payload: { userId: string; lastReadAt: string }) => void;
  onOpenQuestionModal: () => void;
  onOpenGroupInfoModal: () => void;
  onOpenTestConfigModal: () => void;
  onOpenStudyConfigModal: () => void;
  onVoteQuestion: (messageId: string, voteType: 'up' | 'down') => void;
  onFlagAsSimilar: (messageId: string, groupId: string) => void;
  onOpenCreateSubGroupModal: (parentId: string) => void;
  groups: Group[];
  onToggleArchiveGroup: (groupId: string) => void;
  onOpenAIGenerateModal?: () => void;
  onAIQuery?: (question: string) => Promise<string | null>;
  // Mobile group navigation
  dmThreads?: DMThread[];
  onSelectChat?: (chat: ChatItem) => void;
  onBack?: () => void;
  onCreateGroup?: () => void;
  onOpenNewDmModal?: () => void;
  onDeleteDmThread?: (threadId: string) => void;
  onArchiveDmThread?: (threadId: string) => void;
  onUnarchiveDmThread?: (threadId: string) => void;
  onDmThreadStatusChange?: (
    threadId: string,
    patch: { status: 'open' | 'pending' | 'declined'; requestedBy?: string | null }
  ) => void;
  onLoadMoreMessages?: (groupId: string) => Promise<number>;
  onLoadMoreDirectMessages?: (threadId: string) => Promise<number>;
  /**
   * Prior last_read_at for the open group or DM chat.
   * - undefined: mark-as-read still pending (wait before anchoring)
   * - null: no prior marker / fully read → open at bottom
   * - string: scroll to first message after this timestamp
   */
  unreadAnchorAt?: string | null;
  /**
   * Set when the open group is a community channel: the header subtitle
   * becomes the `in <Community>` link (no "Active group" dot) and the small-
   * screen back button reads "Back to community". Nothing else changes.
   */
  communityContext?: { name: string; onOpen: () => void };
  chatHomeCommunities?: Array<{ id: string; slug: string; name: string; lounge_group_id?: string | null }>;
  chatHomeInquiries?: Array<{ id: string; dm_thread_id?: string | null; status?: string | null; listing?: { title?: string | null } | null }>;
  onOpenLounge?: (lounge: ChatHomeLounge) => void;
  onOpenInquiries?: () => void;
  peerPresence?: { settings?: unknown; lastSeenAt?: string | null } | null;
}

// How close to the bottom still counts as "following the conversation": inside
// this band a new message scrolls you down, outside it the "N new messages"
// pill appears instead.
const NEAR_BOTTOM_PX = 120;

const ChatWindow: React.FC<ChatWindowProps> = ({
  chat, messages: messagesProp, currentUser, userVotes,
  onSendMessage, onEditMessage, onRemoveMessage, onOpenQuestionModal, onOpenGroupInfoModal,
  onOpenTestConfigModal, onOpenStudyConfigModal, onVoteQuestion,
  onFlagAsSimilar,
  onOpenCreateSubGroupModal, groups, onToggleArchiveGroup,
  onOpenAIGenerateModal,
  onAIQuery,
  dmThreads = [],
  onSelectChat,
  onBack,
  onCreateGroup,
  onOpenNewDmModal,
  unreadAnchorAt,
  communityContext,
  onDeleteDmThread,
  onArchiveDmThread,
  onUnarchiveDmThread,
  onDmThreadStatusChange,
  onLoadMoreMessages,
  onLoadMoreDirectMessages,
  onPeerChatRead,
  chatHomeCommunities,
  chatHomeInquiries,
  onOpenLounge,
  onOpenInquiries,
  peerPresence,
}) => {
  const messages = Array.isArray(messagesProp) ? messagesProp : [];
  const { lowDataMode } = useUIStore();
  const myCommunities = useCommunityStore((s) => s.myCommunities);
  const [resolvedPeerPresence, setResolvedPeerPresence] = useState<{
    settings?: unknown;
    lastSeenAt?: string | null;
  } | null>(peerPresence || null);
  const [buyerInquiries, setBuyerInquiries] = useState<
    Array<{ id: string; dm_thread_id?: string | null; status?: string | null; listing?: { title?: string | null } | null }>
  >(chatHomeInquiries || []);
  // Buyer inquiries for the chat-home pane. Driven by `chatHomeInquiries`: when
  // the shell supplies them this is a pure mirror, and only an unsupplied prop
  // makes this component fetch for itself.
  useEffect(() => {
    if (chatHomeInquiries) {
      setBuyerInquiries(chatHomeInquiries);
      return;
    }
    let cancelled = false;
    void fetchMyInquiries('buyer')
      .then((rows) => {
        if (!cancelled && Array.isArray(rows)) setBuyerInquiries(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [chatHomeInquiries]);
  // Peer presence for a DM header. Same shape: the prop wins; otherwise the peer
  // profile is fetched once per `chat.id`. A peer whose status is 'hidden' is
  // stored as an explicit privacy object rather than as "no data", so the header
  // says nothing instead of guessing "offline".
  useEffect(() => {
    if (peerPresence) {
      setResolvedPeerPresence(peerPresence);
      return;
    }
    if (!chat || chat.chatType === 'group') {
      setResolvedPeerPresence(null);
      return;
    }
    const otherId = chat.participantIds?.find((id) => id !== currentUser.id);
    if (!otherId) {
      setResolvedPeerPresence(null);
      return;
    }
    let cancelled = false;
    void fetchUserProfile(otherId)
      .then((user) => {
        if (cancelled || !user) return;
        if (user.onlineStatus === 'hidden') {
          setResolvedPeerPresence({ settings: { privacy: { showOnlineStatus: false } }, lastSeenAt: null });
          return;
        }
        setResolvedPeerPresence({ settings: user.settings, lastSeenAt: user.lastSeenAt ?? null });
      })
      .catch(() => {
        if (!cancelled) setResolvedPeerPresence(null);
      });
    return () => {
      cancelled = true;
    };
  }, [chat, currentUser.id, peerPresence]);
  const { refreshBudgetTransactions } = useBudgetHandlers();
  const [questionVisibilityMode, setQuestionVisibilityMode] = useQuestionVisibilityMode();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const firstUnreadRef = useRef<HTMLDivElement>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  /**
   * The viewer's OWN reactions per message: { messageId: ['👍'] }. Counts live
   * on the message itself (server-owned, realtime-delivered); this map only
   * decides which chips render as "mine". Kept local to the chat window rather
   * than threaded through App state — nothing else needs it.
   */
  const updateMessageInState = useGroupStore((state) => state.updateMessageInState);
  const showToast = useToastStore((state) => state.showToast);
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
  const [questionFiltersOpen, setQuestionFiltersOpen] = useState(false);
  const [muteDurationsOpen, setMuteDurationsOpen] = useState(false);
  // "Report…" target: a group message (hover bar) or the DM peer (header menu).
  const [reportTarget, setReportTarget] = useState<{
    type: ContentReportTargetType;
    id: string;
    label?: string;
  } | null>(null);
  // --- Scroll bookkeeping. These are refs, not state, because the scroll
  // handler and the live-message effect read them during the same commit that
  // would be setting them; a state round-trip would act on stale values.
  // `initialAnchorDoneRef` holds the chat id whose opening position has already
  // been decided, which is what makes the anchor once-per-conversation.
  const prevMessageCountRef = useRef(messages.length);
  const lastMessageIdRef = useRef<string | null>(null);
  const isNearBottomRef = useRef(true);
  const initialAnchorDoneRef = useRef<string | null>(null);

  // --- Conversation view state. All of it is per-chat and reset by the
  // `chat?.id` effect below; none of it is persisted except starred/pinned,
  // which are device-local localStorage marks.
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [typingUserIds, setTypingUserIds] = useState<string[]>([]);
  const typingTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [hasMore, setHasMore] = useState(true);
  const [awaitingMessages, setAwaitingMessages] = useState(false);
  const [newMessagesBelow, setNewMessagesBelow] = useState(0);
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<MessageReplyPreview | null>(null);
  const [seedMentionUsername, setSeedMentionUsername] = useState<string | null>(null);
  const [editingMessage, setEditingMessage] = useState<{ id: string; text: string } | null>(null);
  const [threadRootId, setThreadRootId] = useState<string | null>(null);
  const [threadMessages, setThreadMessages] = useState<Message[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadReplyTo, setThreadReplyTo] = useState<MessageReplyPreview | null>(null);
  const [threadEditingMessage, setThreadEditingMessage] = useState<{ id: string; text: string } | null>(null);
  // Separate mention seed for the thread composer so tapping an author's name
  // seeds only the visible composer (main vs thread), not both at once.
  const [threadSeedMentionUsername, setThreadSeedMentionUsername] = useState<string | null>(null);
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());
  const [starredOnly, setStarredOnly] = useState(false);
  const [pinnedMessageId, setPinnedMessageId] = useState<string | null>(null);
  const [threadSearchOpen, setThreadSearchOpen] = useState(false);
  const [threadSearch, setThreadSearch] = useState('');
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [forwardMessage, setForwardMessage] = useState<Message | null>(null);
  const messageNodeRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // Thread panel scroll: its own node map (so a reply-quote click scrolls within
  // the thread, not to the hidden main-list copy) plus a container + bottom sentinel.
  const threadMessageNodeRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const threadScrollRef = useRef<HTMLDivElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const threadCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const threadReturnFocusRef = useRef<HTMLElement | null>(null);

  // Reset loading/hasMore/scroll state when the chat changes
  // Driven by `chat?.id` alone — a re-render of the same conversation must not
  // clear a reply draft, close an open thread or re-arm the scroll anchor.
  useEffect(() => {
    setHasMore(true);
    setIsLoadingMore(false);
    setNewMessagesBelow(0);
    setFirstUnreadId(null);
    setReplyTo(null);
    setEditingMessage(null);
    setThreadRootId(null);
    setThreadMessages([]);
    setThreadReplyTo(null);
    setThreadEditingMessage(null);
    messageNodeRefs.current = {};
    isNearBottomRef.current = true;
    initialAnchorDoneRef.current = null;
    if (chat) {
      setAwaitingMessages(true);
    }
  }, [chat?.id]);

  // First messages have arrived → drop the "Loading messages…" state.
  useEffect(() => {
    if (messages.length > 0) {
      setAwaitingMessages(false);
    }
  }, [messages.length, chat?.id]);

  // Overflow menu closes → collapse its submenus, so reopening it starts at the
  // top level. Opening pre-expands the question filter only when a non-default
  // filter is active, so the current state is visible without a click.
  useEffect(() => {
    if (!isDropdownOpen) {
      setQuestionFiltersOpen(false);
      setMuteDurationsOpen(false);
      return;
    }
    setQuestionFiltersOpen(questionVisibilityMode !== 'all');
  }, [isDropdownOpen, questionVisibilityMode]);

  // Backstop for the loading state: an empty conversation never sets
  // `messages.length > 0`, so without this the spinner would run forever
  // instead of settling into "No messages yet".
  useEffect(() => {
    if (!chat) return;
    const timer = window.setTimeout(() => setAwaitingMessages(false), 10_000);
    return () => window.clearTimeout(timer);
  }, [chat?.id]);

  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Typing indicators via Supabase broadcast
  // Subscription setup/teardown, keyed on `chat.id`: one broadcast channel per
  // conversation. Each peer's id is held for 3s by a per-user timer that a fresh
  // broadcast resets. TEARDOWN must clear every timer, empty the id list and
  // remove the channel — otherwise a stale "X is typing…" follows you into the
  // next conversation.
  useEffect(() => {
    if (!chat?.id) return;
    const channel = supabase.channel(`typing:${chat.id}`);
    typingChannelRef.current = channel;
    channel
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const userId = payload?.userId as string | undefined;
        if (!userId || userId === currentUser.id) return;
        setTypingUserIds((prev) => (prev.includes(userId) ? prev : [...prev, userId]));
        if (typingTimeoutsRef.current[userId]) clearTimeout(typingTimeoutsRef.current[userId]);
        typingTimeoutsRef.current[userId] = setTimeout(() => {
          setTypingUserIds((prev) => prev.filter((id) => id !== userId));
          delete typingTimeoutsRef.current[userId];
        }, 3000);
      })
      .subscribe();
    return () => {
      Object.values(typingTimeoutsRef.current).forEach(clearTimeout);
      typingTimeoutsRef.current = {};
      setTypingUserIds([]);
      typingChannelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [chat?.id, currentUser.id]);

  const broadcastTyping = () => {
    void typingChannelRef.current?.send({
      type: 'broadcast',
      event: 'typing',
      payload: { userId: currentUser.id },
    });
  };

  // Peer mark-read broadcasts → refresh blue ticks on own messages
  // A second channel per conversation, skipped entirely in low-data mode
  // (`lowDataMode` is a dep, so toggling it subscribes/unsubscribes). Own
  // broadcasts are ignored; the shell applies the watermark via `onPeerChatRead`.
  useEffect(() => {
    if (!chat?.id || lowDataMode) return;
    const channel = supabase.channel(`chat-read:${chat.id}`);
    channel
      .on('broadcast', { event: 'read' }, ({ payload }) => {
        const userId = payload?.userId as string | undefined;
        const lastReadAt = payload?.lastReadAt as string | undefined;
        if (!userId || !lastReadAt || userId === currentUser.id) return;
        onPeerChatRead?.({ userId, lastReadAt });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [chat?.id, currentUser.id, lowDataMode, onPeerChatRead]);

  // --- Thread side panel. Threads are NOT part of `messages`: they are fetched
  // whole per root id and kept in `threadMessages`, so every mutation inside the
  // panel (send, edit, remove) has to re-run `loadThread` to see itself.
  // Opening a thread pre-seeds the reply target with the root, so a reply with no
  // explicit target still lands in the thread rather than in the main list.
  const loadThread = async (rootId: string) => {
    if (!chat) return;
    setThreadLoading(true);
    try {
      const raw =
        chat.chatType === 'group'
          ? await fetchGroupThread(chat.id, rootId)
          : await fetchDmThread(chat.id, rootId);
      const mapped = mapMessagesFromApi(raw);
      setThreadMessages(mapped);
      const root = mapped.find((m) => m.id === rootId) || mapped[0];
      if (root && !root.isRemoved && !root.removedAt) {
        setThreadReplyTo({
          id: root.id,
          senderId: root.sender?.id,
          senderName: root.sender?.name || root.sender?.username,
          type: root.type,
          text: root.text,
          questionStem: root.questionStem,
        });
      } else {
        setThreadReplyTo(null);
      }
    } catch (err) {
      console.error('Failed to load thread', err);
      useToastStore.getState().showToast('Could not load thread', 'error');
      setThreadRootId(null);
    } finally {
      setThreadLoading(false);
    }
  };

  useEffect(() => {
    if (!threadRootId) {
      setThreadMessages([]);
      setThreadReplyTo(null);
      setThreadEditingMessage(null);
      return;
    }
    void loadThread(threadRootId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when root/chat changes
  }, [threadRootId, chat?.id]);

  // Focus handling for the thread panel, driven by `threadRootId`:
  // remember what had focus → move focus to the panel's close button →
  // Escape closes → on teardown, focus returns to where it came from.
  // Note this is initial-focus + Escape only; focus is NOT trapped inside the
  // panel even though it is marked `aria-modal`.
  useEffect(() => {
    if (!threadRootId) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    threadReturnFocusRef.current = previous;
    const focusTimer = window.setTimeout(() => {
      threadCloseButtonRef.current?.focus();
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setThreadRootId(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKeyDown);
      const restore = threadReturnFocusRef.current;
      threadReturnFocusRef.current = null;
      if (restore && typeof restore.focus === 'function') {
        restore.focus();
      }
    };
  }, [threadRootId]);

  const handleOpenThread = (rootId: string) => {
    setThreadRootId(rootId);
  };

  // One composer serves both send and edit: an active `editingMessage` turns the
  // submit into an edit. The optimistic message row and its failure handling
  // belong to `onSendMessage` in the shell, not to this component.
  const handleComposerSend = async (text: string, options?: SendMessageOptions) => {
    if (!editingMessage) {
      await onSendMessage(text, options);
      return;
    }
    await onEditMessage(editingMessage.id, text);
    useToastStore.getState().showToast('Message updated', 'success');
    if (threadRootId) void loadThread(threadRootId);
  };

  const handleThreadSend = async (text: string, options?: SendMessageOptions) => {
    if (threadEditingMessage) {
      await onEditMessage(threadEditingMessage.id, text);
      useToastStore.getState().showToast('Message updated', 'success');
      if (threadRootId) await loadThread(threadRootId);
      return;
    }
    // Reply target, most specific first. The `|| threadRootId` fallback is what
    // guarantees a thread reply never escapes into the main conversation.
    const replyId = options?.replyToMessageId || threadReplyTo?.id || threadRootId || undefined;
    await onSendMessage(text, { ...options, replyToMessageId: replyId });
    if (threadRootId) {
      // Brief delay so the new message is queryable, then refresh panel + bump feed counts
      window.setTimeout(() => void loadThread(threadRootId), 350);
    }
  };

  const beginEditingMessage = (message: Message, inThread = false) => {
    if (!message.text) return;
    if (inThread) {
      setThreadReplyTo(null);
      setThreadEditingMessage({ id: message.id, text: message.text });
      return;
    }
    setReplyTo(null);
    setEditingMessage({ id: message.id, text: message.text });
  };

  const handleRemoveMessage = async (message: Message, inThread = false) => {
    const confirmed = await confirmDialog({
      title: 'Remove message?',
      message:
        'This will remove the message for everyone. It cannot be restored in chat, but an audit record will be retained.',
      danger: true,
      confirmLabel: 'Remove',
    });
    if (!confirmed) return;

    try {
      await onRemoveMessage(message.id);
      if (editingMessage?.id === message.id) setEditingMessage(null);
      if (threadEditingMessage?.id === message.id) setThreadEditingMessage(null);
      if (inThread && threadRootId) await loadThread(threadRootId);
      useToastStore.getState().showToast('Message removed', 'success');
    } catch (error) {
      useToastStore.getState().showToast(
        error instanceof Error ? error.message : 'Could not remove message',
        'error'
      );
    }
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

  // tree state used for mobile grouping
  const [expandedParentGroups, setExpandedParentGroups] = useState<Record<string, boolean>>({});

  // Marketplace Inquiry & Offers states
  const [inquiry, setInquiry] = useState<MarketplaceInquiry | null>(null);
  const [activeOffer, setActiveOffer] = useState<MarketplaceOffer | null>(null);
  const [offerHistory, setOfferHistory] = useState<MarketplaceOffer[]>([]);
  const [activeTab, setActiveTab] = useState<'chat' | 'offers'>('chat');
  const [showMakeOfferModal, setShowMakeOfferModal] = useState(false);
  const [showCounterInput, setShowCounterInput] = useState(false);
  const [counterValue, setCounterValue] = useState('');
  const [offerLoading, setOfferLoading] = useState(false);
  const [offerError, setOfferError] = useState('');
  const [activeOrder, setActiveOrder] = useState<MarketplaceOrder | null>(null);
  const [orderActionLoading, setOrderActionLoading] = useState(false);

  // --- Marketplace negotiation. Offers are fetched for the viewer's ROLE and
  // then narrowed to this listing/pair client-side; the "active" offer is the
  // newest still-pending one, everything else is history.
  const loadOfferHistory = async (inquiryData: MarketplaceInquiry) => {
    try {
      const role = currentUser.id === inquiryData.buyer_id ? 'buyer' : 'seller';
      const offers = await fetchOffers(role);
      const filtered = offers.filter(
        (o: MarketplaceOffer) =>
          o.listing_id === inquiryData.listing_id &&
          (o.buyer_id === inquiryData.buyer_id || o.seller_id === inquiryData.seller_id)
      );
      // History oldest → newest; active offer is latest pending only
      filtered.sort(
        (a: MarketplaceOffer, b: MarketplaceOffer) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      setOfferHistory(filtered);

      const pending = filtered.filter((o: MarketplaceOffer) => o.status === 'pending');
      const active = pending.length > 0 ? pending[pending.length - 1] : null;
      setActiveOffer(active);
    } catch (err) {
      console.error('Error loading offer history:', err);
    }
  };

  // Accept / decline / counter / withdraw. Order of effects matters:
  //  1. the server call (money side),
  //  2. a plain chat message so the negotiation leaves a visible trail — fired
  //     without awaiting, and a failure here is logged only: a lost narration
  //     line must never look like a failed offer response,
  //  3. accept-as-buyer leaves the app for Paystack and returns early; every
  //     other path re-reads the inquiry from the server rather than assuming a
  //     status (forcing 'negotiating' once left the pill amber over a live order).
  const handleRespond = async (action: 'accept' | 'decline' | 'counter' | 'withdraw', counterAmount?: number) => {
    if (!activeOffer || !inquiry) return;
    setOfferLoading(true);
    setOfferError('');
    try {
      const acceptResult = await respondToOffer(activeOffer.id, action, counterAmount);
      
      // Send DM notification for visual history
      let dmContent = '';
      if (action === 'accept') {
        const payUrl =
          (acceptResult as { authorizationUrl?: string })?.authorizationUrl ||
          (acceptResult as { checkout?: { authorizationUrl?: string } })?.checkout?.authorizationUrl;
        dmContent = payUrl
          ? `[Offer] I accepted your offer of ₦${activeOffer.amount.toLocaleString()}! Complete Paystack checkout to pay — you pay the offer amount, nothing added.`
          : `[Offer] I accepted your offer of ₦${activeOffer.amount.toLocaleString()}! An order has been created — arrange pickup or delivery in Orders.`;
      } else if (action === 'decline') {
        dmContent = `[Offer] I declined the offer of ₦${activeOffer.amount.toLocaleString()}.`;
      } else if (action === 'withdraw') {
        dmContent = `[Offer] I withdrew my offer of ₦${activeOffer.amount.toLocaleString()}.`;
      } else if (action === 'counter' && counterAmount) {
        dmContent = `[Offer] I countered your offer with a counter-offer of ₦${counterAmount.toLocaleString()}.`;
      }

      if (dmContent) {
        // FIXED (F1): `onSendMessage` may return a promise, and a bare try/catch
        // cannot see its rejection — a failed narration message escaped as an
        // unhandled rejection. It now goes through Promise.resolve().catch, which
        // also matters because onSendMessage REJECTS on a busy send lock since
        // E3 H16 (see MessageSendBusyError in hooks/useGroupHandlers). This is a
        // fire-and-forget narration line: log it, never surface it.
        void Promise.resolve()
          .then(() => onSendMessage(dmContent))
          .catch((msgErr) => {
            console.error('Failed to send status update message to chat:', msgErr);
          });
      }

      if (action === 'accept') {
        const payUrl =
          (acceptResult as { authorizationUrl?: string })?.authorizationUrl ||
          (acceptResult as { checkout?: { authorizationUrl?: string } })?.checkout?.authorizationUrl;
        const isBuyer = currentUser?.id === activeOffer.buyer_id;
        if (payUrl && isBuyer) {
          window.location.assign(payUrl);
          return;
        }
        try {
          // The server sets the inquiry status when an offer is accepted; re-fetch it
          // as the source of truth instead of forcing 'negotiating' (which left the
          // status pill stuck on amber even though a live order already existed).
          const refreshedInquiry = await getInquiryByThread(chat.id);
          if (refreshedInquiry) setInquiry(refreshedInquiry);
          const order = await fetchOrderForInquiry(inquiry.id);
          if (order) setActiveOrder(order);
          await refreshBudgetTransactions(currentUser.id);
          if (payUrl && !isBuyer) {
            useToastStore.getState().showToast(
              'Offer accepted. The buyer will complete Paystack checkout.',
              'info'
            );
          }
        } catch (err) {
          console.error('Failed to load order after offer acceptance:', err);
        }
      } else if (action === 'counter') {
        try {
          await updateInquiryStatus(inquiry.id, 'negotiating');
          const updated = await getInquiryByThread(chat.id);
          if (updated) setInquiry(updated);
        } catch (err) {
          console.error('Failed to update inquiry status to negotiating:', err);
        }
      }

      await loadOfferHistory(inquiry);
      setShowCounterInput(false);
    } catch (err: any) {
      setOfferError(err.message || `Failed to ${action} offer`);
    } finally {
      setOfferLoading(false);
    }
  };

  // Reset offer/order UI only when the conversation itself changes.
  useEffect(() => {
    setActiveTab('chat');
    setInquiry(null);
    setActiveOffer(null);
    setOfferHistory([]);
    setShowCounterInput(false);
    setCounterValue('');
    setOfferError('');
    setActiveOrder(null);
  }, [chat?.id]);

  // Resolve marketplace inquiry context durably: ask the server whether THIS thread
  // is an inquiry (source of truth) rather than substring-matching a fragile "[Offer]"
  // marker in message text, which false-negatives on seed drift and false-positives on
  // a literally typed "[Offer]". Depends only on the chat id, so it never re-fires on an
  // unrelated parent re-render (which used to bounce the user off the Offers tab).
  useEffect(() => {
    if (!chat || chat.chatType !== 'dm') return;
    let cancelled = false;
    const loadInquiryContext = async () => {
      try {
        const inquiryData = await getInquiryByThread(chat.id);
        if (cancelled) return;
        if (inquiryData) {
          setInquiry(inquiryData);
          await loadOfferHistory(inquiryData);
          if (cancelled) return;
          const order = await fetchOrderForInquiry(inquiryData.id);
          if (!cancelled && order) setActiveOrder(order);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Error loading inquiry context:', err);
        }
      }
    };
    void loadInquiryContext();
    return () => { cancelled = true; };
  }, [chat?.id, chat?.chatType]);


  // build top‑level vs subgroup map once
  const { activeTopLevelGroups, archivedTopLevelGroups, subGroupsMap } = React.useMemo(() => {
    const activeTop: Group[] = [];
    const archivedTop: Group[] = [];
    const map: Record<string, Group[]> = {};

    (groups ?? []).forEach(g => {
      if (g.parentId) {
        if (!map[g.parentId]) map[g.parentId] = [];
        map[g.parentId].push(g);
      } else {
        if (g.isArchived) archivedTop.push(g);
        else activeTop.push(g);
      }
    });

    const sortFn = (a: Group, b: Group) => a.name.localeCompare(b.name);
    activeTop.sort(sortFn);
    archivedTop.sort(sortFn);
    Object.values(map).forEach(arr => arr.sort(sortFn));

    return { activeTopLevelGroups: activeTop, archivedTopLevelGroups: archivedTop, subGroupsMap: map };
  }, [groups]);

  // recursive renderer for mobile list entries
  const renderGroupWithSubgroups = (group: Group, nestingLevel: number = 0): React.ReactNode => {
    const subGroups = subGroupsMap[group.id] || [];
    const isExpanded = !!expandedParentGroups[group.id];

    return (
      <React.Fragment key={group.id}>
        <GroupListItem
          chat={{ ...group, chatType: 'group' as const }}
          currentUser={currentUser}
          isSelected={false}
          onClick={() => onSelectChat?.({ ...group, chatType: 'group' as const })}
          showText={true}
          hasSubGroups={subGroups.length > 0}
          isExpanded={isExpanded}
          onToggleExpand={subGroups.length > 0 ? () => setExpandedParentGroups(prev => ({ ...prev, [group.id]: !prev[group.id] })) : undefined}
          nestingLevel={nestingLevel}
        />
        {isExpanded && subGroups.map(sg => renderGroupWithSubgroups(sg, nestingLevel + 1))}
      </React.Fragment>
    );
  };

  // Scrolling to the end also clears the pill and re-arms "near bottom", so the
  // two never disagree about where the reader is.
  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
    setNewMessagesBelow(0);
    isNearBottomRef.current = true;
  };

  // What the list actually renders, in filter order: archived-out, removed
  // tombstone policy (a removed message still renders when something replies to
  // it), the group question-visibility mode, the starred-only view, then the
  // in-chat search (2+ chars). EVERY scroll and unread computation below works on
  // this array, not on `messages` — the divider must sit at the first unread row
  // the reader can actually see.
  const isGroupChat = chat?.chatType === 'group';
  const visibleMessages = useMemo(
    () =>
      messages.filter((msg) => {
        if (isGroupChat && msg.isArchived) return false;
        if (!shouldRenderRemovedMessage(msg, messages)) return false;
        if (isGroupChat && !messagePassesQuestionVisibility(msg, questionVisibilityMode)) {
          return false;
        }
        if (starredOnly && !starredIds.has(msg.id)) return false;
        const query = threadSearch.trim().toLowerCase();
        if (query.length >= 2) {
          const hay = `${msg.text || ''} ${msg.questionStem || ''}`.toLowerCase();
          if (!hay.includes(query)) return false;
        }
        return true;
      }),
    [messages, isGroupChat, questionVisibilityMode, starredOnly, starredIds, threadSearch]
  );
  const visibleThreadMessages = useMemo(
    () =>
      threadMessages.filter(
        (message) =>
          !(isGroupChat && message.isArchived) &&
          shouldRenderRemovedMessage(message, threadMessages)
      ),
    [isGroupChat, threadMessages]
  );
  const threadRootMessage =
    threadMessages.find((message) => message.id === threadRootId) || threadMessages[0];
  const isThreadRootRemoved =
    !!threadRootMessage?.isRemoved || !!threadRootMessage?.removedAt;

  // Keep the thread panel pinned to the newest reply: scroll to the bottom
  // sentinel when the thread opens and whenever it grows, but only if the reader
  // is already near the bottom so an incoming peer reply never yanks them away.
  useEffect(() => {
    if (!threadRootId || threadLoading) return;
    const container = threadScrollRef.current;
    const end = threadEndRef.current;
    if (!end) return;
    const nearBottom =
      !container || container.scrollHeight - container.scrollTop - container.clientHeight < 160;
    if (nearBottom) end.scrollIntoView({ block: 'end' });
  }, [threadRootId, threadLoading, visibleThreadMessages.length]);

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
      if (senderId && senderId === currentUser.id) return false;
      const ts = new Date(msg.timestamp).getTime();
      return !Number.isNaN(ts) && ts > anchorMs;
    });
    setFirstUnreadId(first?.id ?? null);
  }, [chat?.id, unreadAnchorAt, visibleMessages, currentUser.id]);

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

    const isOwn = last?.sender?.id === currentUser.id;
    if (isOwn || isNearBottomRef.current) {
      scrollToBottom('smooth');
    } else {
      const added = Math.max(1, visibleMessages.length - prevMessageCountRef.current);
      setNewMessagesBelow((n) => n + added);
    }
    lastMessageIdRef.current = lastId;
    prevMessageCountRef.current = visibleMessages.length;
  }, [visibleMessages, currentUser.id, chat?.id]);

  // All hooks below must stay above the `if (!chat)` return — opening a chat
  // from the empty state must not change hook count (React #310).
  const isGroup = isGroupChat;
  const groupMemberListForMentions = useMemo(() => {
    if (!chat || chat.chatType !== 'group') return [];
    const fromChat = Array.isArray(chat.members) ? chat.members : [];
    if (fromChat.length > 0) return fromChat;
    const fromGroups = groups.find((g) => g.id === chat.id)?.members;
    return Array.isArray(fromGroups) && fromGroups.length > 0 ? fromGroups : [];
  }, [chat, groups]);

  const isGroupAdminForMentions = Boolean(
    isGroup &&
      chat &&
      chat.chatType === 'group' &&
      ((chat as Group).ownerId === currentUser.id ||
        (Array.isArray((chat as Group).adminIds) &&
          (chat as Group).adminIds.includes(currentUser.id)))
  );

  const mentionCandidates = useMemo(() => {
    if (!isGroup) return [];
    const members = groupMemberListForMentions
      .filter((m) => m.id !== currentUser.id && m.username)
      .map((m) => ({ id: m.id, username: m.username!, name: m.name }));
    if (isGroupAdminForMentions) {
      return [{ id: '__all__', username: 'all', name: 'Everyone in this group' }, ...members];
    }
    return members;
  }, [isGroup, isGroupAdminForMentions, groupMemberListForMentions, currentUser.id]);

  const dmThreadForHooks =
    chat && chat.chatType !== 'group' ? (chat as DMThread & { chatType?: 'dm' }) : null;
  const [dmRequestStatus, setDmRequestStatus] = useState<'open' | 'pending' | 'declined'>('open');
  const [dmRequestBusy, setDmRequestBusy] = useState(false);
  const [dmBlocked, setDmBlocked] = useState(false);
  const [iBlockedThem, setIBlockedThem] = useState(false);
  const [dmBlockBusy, setDmBlockBusy] = useState(false);
  const [chatMuted, setChatMuted] = useState(false);
  const [chatMutedUntil, setChatMutedUntil] = useState<string | null>(null);
  const [muteBusy, setMuteBusy] = useState(false);

  const dmPeerId =
    dmThreadForHooks && Array.isArray(dmThreadForHooks.participantIds)
      ? dmThreadForHooks.participantIds.find((id) => id !== currentUser.id)
      : undefined;

  useEffect(() => {
    setDmRequestStatus(dmThreadForHooks?.status || 'open');
  }, [dmThreadForHooks?.id, dmThreadForHooks?.status]);

  useEffect(() => {
    let cancelled = false;
    if (!dmPeerId || isGroup || !chat) {
      setDmBlocked(false);
      setIBlockedThem(false);
      return;
    }
    void getDmBlockStatus(currentUser.id, dmPeerId)
      .then((status) => {
        if (cancelled) return;
        setDmBlocked(!!status.blocked);
        setIBlockedThem(!!status.iBlockedThem);
      })
      .catch(() => {
        if (cancelled) return;
        setDmBlocked(false);
        setIBlockedThem(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser.id, dmPeerId, isGroup, chat?.id]);

  useEffect(() => {
    let cancelled = false;
    if (!chat) {
      setChatMuted(false);
      setChatMutedUntil(null);
      return;
    }
    const load = isGroup
      ? getGroupMuteStatus(chat.id)
      : getDmMuteStatus(chat.id);
    void load
      .then((status) => {
        if (cancelled) return;
        setChatMuted(!!status?.muted);
        setChatMutedUntil(status?.mutedUntil ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setChatMuted(false);
        setChatMutedUntil(null);
      });
    return () => {
      cancelled = true;
    };
  }, [chat?.id, isGroup]);

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

  const scrollToMessageId = (messageId: string) => {
    messageNodeRefs.current[messageId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const galleryItems = useMemo(() => collectChatGalleryItems(messages), [messages]);
  const pinnedMessage = pinnedMessageId ? messages.find((m) => m.id === pinnedMessageId) : undefined;

  const handleMuteFor = async (duration: ChatMuteDurationId) => {
    if (!chat || muteBusy) return;
    setMuteBusy(true);
    try {
      const status = isGroup
        ? await muteGroupChat(chat.id, duration)
        : await muteDmThread(chat.id, duration);
      if (!status?.muted) {
        useToastStore.getState().showToast('Could not mute notifications.', 'error');
        return;
      }
      setChatMuted(true);
      setChatMutedUntil(status.mutedUntil);
      const untilLabel = formatMuteUntilLabel(status.mutedUntil);
      useToastStore.getState().showToast(
        untilLabel ? `Notifications muted until ${untilLabel}.` : 'Notifications muted.',
        'success'
      );
    } finally {
      setMuteBusy(false);
    }
  };

  const handleUnmute = async () => {
    if (!chat || muteBusy) return;
    setMuteBusy(true);
    try {
      const status = isGroup
        ? await unmuteGroupChat(chat.id)
        : await unmuteDmThread(chat.id);
      if (!status || status.muted) {
        useToastStore.getState().showToast('Could not unmute notifications.', 'error');
        return;
      }
      setChatMuted(false);
      setChatMutedUntil(null);
      useToastStore.getState().showToast('Notifications unmuted.', 'success');
    } finally {
      setMuteBusy(false);
    }
  };

  const muteUntilLabel = formatMuteUntilLabel(chatMutedUntil);

  // No conversation selected. NOTHING below this line may call a hook — see the
  // file header (React #310). Desktop gets the chat-home pane; small screens get
  // the full conversation list, since there is no sidebar there to hold it.
  if (!chat) {
    // Desktop: show placeholder
    // Mobile: show inline group/DM list for navigation
    const inboundRequestThreads = dmThreads.filter(
      (t) =>
        !t.isArchived &&
        t.status === 'pending' &&
        typeof t.requestedBy === 'string' &&
        t.requestedBy !== currentUser.id,
    );
    const activeDmThreads = dmThreads.filter(
      (t) =>
        !t.isArchived &&
        !(
          t.status === 'pending' &&
          typeof t.requestedBy === 'string' &&
          t.requestedBy !== currentUser.id
        ),
    );
    const archivedDmThreads = dmThreads.filter(t => t.isArchived);
    const totalArchived = archivedTopLevelGroups.length + archivedDmThreads.length;
    const chatHome = buildChatHome({
      currentUserId: currentUser.id,
      groups,
      dmThreads,
      communities: chatHomeCommunities || myCommunities,
      inquiries: buyerInquiries,
    });

    return (
      <div className="flex-1 flex flex-col bg-lantern-background">
        <div className="hidden md:flex flex-1">
          <ChatHomePane
            model={chatHome}
            onMessageSomeone={onOpenNewDmModal}
            onNewGroup={onCreateGroup}
            onSelectRecent={(recent) => {
              if (recent.chatType === 'dm') {
                const thread = dmThreads.find((t) => t.id === recent.id);
                if (thread) onSelectChat?.({ ...thread, chatType: 'dm' });
                return;
              }
              const group = groups.find((g) => g.id === recent.id);
              if (group) onSelectChat?.({ ...group, chatType: 'group' });
            }}
            onOpenLounge={onOpenLounge}
            onOpenInquiries={onOpenInquiries}
          />
        </div>

        {/* Mobile group list */}
        <div className="md:hidden flex-1 flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-lantern-surface border-b border-lantern-border">
            <h1 className="text-lg font-bold text-lantern-text">Chats</h1>
            <div className="flex items-center gap-2">
              {onOpenNewDmModal && (
                <button onClick={onOpenNewDmModal} className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-lantern-text-secondary hover:text-lantern-primary rounded-lantern hover:bg-lantern-background-secondary" title="New message">
                  <AppIcon name="chatbubble-ellipses" size={20} />
                </button>
              )}
              {onCreateGroup && (
                <button onClick={onCreateGroup} className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-lantern-text-secondary hover:text-lantern-primary rounded-lantern hover:bg-lantern-background-secondary" title="New group">
                  <AppIcon name="add-circle" size={20} />
                </button>
              )}
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {activeTopLevelGroups.length === 0 &&
            activeDmThreads.length === 0 &&
            inboundRequestThreads.length === 0 ? (
              <ChatHomePane
                compact
                model={chatHome}
                onMessageSomeone={onOpenNewDmModal}
                onNewGroup={onCreateGroup}
                onOpenLounge={onOpenLounge}
                onOpenInquiries={onOpenInquiries}
              />
            ) : (
              <div className="divide-y divide-lantern-border">
                {inboundRequestThreads.length > 0 && (
                  <>
                    <div className="px-4 py-2 text-xs font-semibold text-amber-700 dark:text-amber-300 uppercase tracking-wider bg-amber-50 dark:bg-amber-950/30">
                      Message requests ({inboundRequestThreads.length})
                    </div>
                    {inboundRequestThreads.map((thread) => (
                      <GroupListItem
                        key={thread.id}
                        chat={{ ...thread, chatType: 'dm' as const }}
                        currentUser={currentUser}
                        isSelected={false}
                        onClick={() => onSelectChat?.({ ...thread, chatType: 'dm' as const })}
                        showText={true}
                      />
                    ))}
                  </>
                )}

                {/* DM threads */}
                {activeDmThreads.map(thread => (
                  <GroupListItem
                    key={thread.id}
                    chat={{ ...thread, chatType: 'dm' as const }}
                    currentUser={currentUser}
                    isSelected={false}
                    onClick={() => onSelectChat?.({ ...thread, chatType: 'dm' as const })}
                    showText={true}
                  />
                ))}

                {/* Active groups */}
                {activeTopLevelGroups.map(group => renderGroupWithSubgroups(group, 0))}

                {/* Archived section (groups + DMs) */}
                {totalArchived > 0 && (
                  <>
                    <div className="px-4 py-2 text-xs font-semibold text-lantern-text-tertiary uppercase tracking-wider bg-lantern-background-secondary">
                      Archived ({totalArchived})
                    </div>
                    {archivedDmThreads.map(thread => (
                      <GroupListItem
                        key={thread.id}
                        chat={{ ...thread, chatType: 'dm' as const }}
                        currentUser={currentUser}
                        isSelected={false}
                        onClick={() => onSelectChat?.({ ...thread, chatType: 'dm' as const })}
                        showText={true}
                      />
                    ))}
                    {archivedTopLevelGroups.map(group => (
                      <GroupListItem
                        key={group.id}
                        chat={{ ...group, chatType: 'group' as const }}
                        currentUser={currentUser}
                        isSelected={false}
                        onClick={() => onSelectChat?.({ ...group, chatType: 'group' as const })}
                        showText={true}
                      />
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Prefer the selected chat roster; group-list refreshes often reset groups[].members to [].
  // Empty arrays are truthy for ?? so we must not treat them as "missing".
  const groupMemberList = groupMemberListForMentions;
  const group = isGroup ? { ...chat, members: groupMemberList } : null;
  const isGroupAdmin = isGroupAdminForMentions;
  /**
   * The community's ONE live chat ("General", founder decision 1). Boards never
   * mount ChatWindow at all — they render `CommunityBoard` — so the only group
   * that reaches here with a communityId and no `study_group` surface is the
   * lounge. It keeps the chat, and loses the STUDY/TEST apparatus: questions,
   * tests, study mode, AI generation, the question-visibility filter and
   * sub-group creation all live in a study group now (§0a.1, §6).
   */
  const communityHost = !!group && isCommunityBoard(group);

  const typingLabels = typingUserIds.map((userId) =>
    resolveGroupChatSenderLabel({ id: userId }, groupMemberList)
  );

  const otherParticipant = !isGroup
    ? (() => {
        const participantIds = (chat as DMThread).participantIds;
        const otherId = Array.isArray(participantIds)
          ? participantIds.find((id) => id !== currentUser.id)
          : undefined;
        return otherId && chat.participants ? chat.participants[otherId] : null;
      })()
    : null;

  const name = isGroup ? chat.name : otherParticipant?.name || 'Chat';
  const avatarUrl = isGroup ? chat.avatarUrl : otherParticipant?.avatarUrl;

  const memberList = Array.isArray(group?.members) ? group!.members : [];
  const memberEmailList = Array.isArray(group?.memberEmails) ? group!.memberEmails : [];
  const rosterCount = memberList.length || Number(group?.memberCount) || 0;
  const memberCountText = rosterCount
    ? `${rosterCount} member${rosterCount === 1 ? '' : 's'}` +
      (memberEmailList.length > memberList.length
        ? ` (+${memberEmailList.length - memberList.length} invited)`
        : '')
    : '';

  const isArchived = isGroup ? group.isArchived : (chat as any).isArchived;
  const dmThread = dmThreadForHooks;

  const dmPresenceLabel = !isGroup && resolvedPeerPresence
    ? formatChatPresenceLine(resolvedPeerPresence.settings, resolvedPeerPresence.lastSeenAt).label
    : null;
  const description = isGroup
    ? memberCountText || group.description || ''
    : dmRequestStatus === 'pending'
      ? 'Message request'
      : dmRequestStatus === 'declined'
        ? 'Declined request'
        : dmPresenceLabel || '';

  const isDmRequestRecipient =
    !!dmThread &&
    dmRequestStatus === 'pending' &&
    dmThread.requestedBy &&
    dmThread.requestedBy !== currentUser.id;
  const isDmRequestSender =
    !!dmThread &&
    dmRequestStatus === 'pending' &&
    dmThread.requestedBy === currentUser.id;
  const isDmRequestDeclinedForRecipient =
    !!dmThread &&
    dmRequestStatus === 'declined' &&
    dmThread.requestedBy &&
    dmThread.requestedBy !== currentUser.id;

  const handleAcceptDmRequest = async () => {
    if (!dmThread?.id || dmRequestBusy) return;
    setDmRequestBusy(true);
    try {
      await acceptDmMessageRequest(dmThread.id);
      setDmRequestStatus('open');
      onDmThreadStatusChange?.(dmThread.id, { status: 'open', requestedBy: null });
      useToastStore.getState().showToast('Message request accepted', 'success');
    } catch (err: any) {
      useToastStore.getState().showToast(err?.message || 'Could not accept request', 'error');
    } finally {
      setDmRequestBusy(false);
    }
  };

  const handleDeclineDmRequest = async () => {
    if (!dmThread?.id || dmRequestBusy) return;
    setDmRequestBusy(true);
    try {
      await declineDmMessageRequest(dmThread.id);
      setDmRequestStatus('declined');
      onDmThreadStatusChange?.(dmThread.id, {
        status: 'declined',
        requestedBy: dmThread.requestedBy ?? null,
      });
      useToastStore.getState().showToast('Message request declined', 'success');
    } catch (err: any) {
      useToastStore.getState().showToast(err?.message || 'Could not decline request', 'error');
    } finally {
      setDmRequestBusy(false);
    }
  };

  const handleToggleDmBlock = async () => {
    if (!dmPeerId || dmBlockBusy) return;
    if (!iBlockedThem) {
      const ok = await confirmDialog({
        title: 'Block user',
        message: `Block ${name}? They won’t be able to message you, and you won’t be able to message them until you unblock.`,
        confirmLabel: 'Block',
        danger: true,
      });
      if (!ok) return;
    }
    setDmBlockBusy(true);
    try {
      if (iBlockedThem) {
        await unblockUser(currentUser.id, dmPeerId);
        setIBlockedThem(false);
        const status = await getDmBlockStatus(currentUser.id, dmPeerId);
        setDmBlocked(!!status.blocked);
        useToastStore.getState().showToast('User unblocked', 'success');
      } else {
        await blockUser(currentUser.id, dmPeerId);
        setIBlockedThem(true);
        setDmBlocked(true);
        useToastStore.getState().showToast('User blocked', 'success');
      }
    } catch (err: any) {
      useToastStore.getState().showToast(err?.message || 'Could not update block', 'error');
    } finally {
      setDmBlockBusy(false);
    }
  };

  const handleDropdownAction = (action: () => void) => {
    action();
    setIsDropdownOpen(false);
  };

  const muteOverflowMenu = chatMuted ? (
    <MenuItem
      onSelect={() => handleDropdownAction(() => void handleUnmute())}
      icon={<AppIcon name="notifications-alert" size={16} className="text-lantern-text-tertiary" />}
      disabled={muteBusy}
    >
      Unmute{muteUntilLabel ? ` (until ${muteUntilLabel})` : ''}
    </MenuItem>
  ) : (
    <MenuSubmenu
      label="Mute"
      icon={<AppIcon name="notifications-off" size={16} className="text-lantern-text-tertiary" />}
      open={muteDurationsOpen}
      onOpenChange={setMuteDurationsOpen}
    >
      {CHAT_MUTE_DURATIONS.map((opt) => (
        <MenuItem
          key={opt.id}
          onSelect={() => handleDropdownAction(() => void handleMuteFor(opt.id))}
          className="pl-8"
          disabled={muteBusy}
        >
          {opt.label}
        </MenuItem>
      ))}
    </MenuSubmenu>
  );

  const questionCount = visibleMessages.filter(m => m.questionType).length;
  // Fold the question count into the header subtitle so we can drop the separate
  // stats strip row (member count already backs `description` when unset).
  const headerSubtitle = isGroup && !isArchived && questionCount > 0
    ? `${description} · ${questionCount} question${questionCount !== 1 ? 's' : ''}`
    : description;

  // The conversation itself, extracted so it can be rendered either bare or
  // inside the marketplace Tabs without duplicating the list, composer and all
  // of their handlers.
  const chatPanelContent = (
    <>
      {threadSearchOpen && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-lantern-border bg-lantern-surface">
          <AppIcon name="search" size={16} className="text-lantern-text-tertiary" />
          <input
            type="search"
            value={threadSearch}
            onChange={(e) => setThreadSearch(e.target.value)}
            placeholder="Search this chat"
            aria-label="Search this chat"
            className="flex-1 bg-transparent text-body text-lantern-text outline-none"
            autoFocus
          />
          <button
            type="button"
            onClick={() => {
              setThreadSearch('');
              setThreadSearchOpen(false);
            }}
            className="text-caption font-semibold text-lantern-primary"
          >
            Close
          </button>
        </div>
      )}
      {starredOnly && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200/70 dark:border-amber-900/40">
          <AppIcon name="star" size={14} className="text-amber-500" />
          <p className="flex-1 text-caption font-semibold text-amber-800 dark:text-amber-300">
            Starred messages ({visibleMessages.length})
          </p>
          <button type="button" onClick={() => setStarredOnly(false)} className="text-caption font-semibold text-amber-800">
            Show all
          </button>
        </div>
      )}
      {pinnedMessage && (
        <button
          type="button"
          onClick={() => scrollToMessageId(pinnedMessage.id)}
          className="flex items-center gap-2 w-full px-4 py-2 text-left border-b border-lantern-border bg-lantern-background-secondary"
        >
          <AppIcon name="pin" size={14} className="text-lantern-text-tertiary" />
          <span className="flex-1 text-caption truncate text-lantern-text">
            {pinnedMessage.questionStem || pinnedMessage.text || 'Pinned message'}
          </span>
        </button>
      )}
      {/* `relative` anchors the "N new messages" pill over the list. The scroller
          needs both `flex-1` and `min-h-0`: without `min-h-0` its automatic
          minimum height is the full message list, so the pane grows instead of
          scrolling and the composer is pushed off-screen. */}
      <div className="relative flex-1 min-h-0 flex flex-col">
      <div ref={messagesContainerRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 py-4 space-y-3">
        {isLoadingMore && (
          <div className="flex justify-center py-2" aria-live="polite">
            <div className="w-5 h-5 border-2 border-lantern-primary/30 border-t-lantern-primary rounded-full animate-spin" />
            <span className="sr-only">Loading older messages</span>
          </div>
        )}
        {/* Per-row derivations: a date separator whenever the calendar day
            changes, and "grouped with previous" (no repeated avatar/name) for a
            same-sender message within 5 minutes. A row carrying the unread
            divider is never grouped, so the divider cannot land mid-cluster. */}
        {visibleMessages.map((msg, idx) => {
          const msgDate = new Date(msg.timestamp);
          const prevMsg = idx > 0 ? visibleMessages[idx - 1] : null;
          const prevDate = prevMsg ? new Date(prevMsg.timestamp) : null;
          const showDateSeparator = !prevDate
            || msgDate.toDateString() !== prevDate.toDateString();
          const isGroupedWithPrevious =
            !!prevMsg &&
            !showDateSeparator &&
            !!prevMsg.sender?.id &&
            !!msg.sender?.id &&
            prevMsg.sender.id === msg.sender.id &&
            msgDate.getTime() - prevDate!.getTime() < 5 * 60 * 1000;

          const formatDateLabel = (d: Date) => {
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
            const diffDays = Math.round((today.getTime() - target.getTime()) / 86400000);
            if (diffDays === 0) return 'Today';
            if (diffDays === 1) return 'Yesterday';
            if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
            return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
          };

          return (
            <React.Fragment key={msg.id}>
              {showDateSeparator && (
                <div className="flex items-center gap-3 py-2">
                  <div className="flex-1 h-px bg-lantern-background-secondary" />
                  <span className="text-xs font-medium text-lantern-text-tertiary whitespace-nowrap px-2">
                    {formatDateLabel(msgDate)}
                  </span>
                  <div className="flex-1 h-px bg-lantern-background-secondary" />
                </div>
              )}
              {firstUnreadId === msg.id && (
                <div
                  ref={firstUnreadRef}
                  className="flex items-center gap-3 py-2"
                  data-testid="unread-divider"
                >
                  <div className="flex-1 h-px bg-lantern-primary/40" />
                  <span className="text-xs font-semibold text-lantern-primary whitespace-nowrap px-2">
                    New messages
                  </span>
                  <div className="flex-1 h-px bg-lantern-primary/40" />
                </div>
              )}
              <div
                ref={(el) => {
                  messageNodeRefs.current[msg.id] = el;
                }}
              >
                <MessageItem
                  message={msg}
                  isCurrentUserMessage={msg.sender?.id === currentUser.id}
                  currentUserVote={userVotes[msg.id]}
                  myReactions={myReactions[msg.id]}
                  onToggleReaction={handleToggleReaction}
                  onVoteQuestion={communityHost ? undefined : onVoteQuestion}
                  onFlagAsSimilar={
                    communityHost ? undefined : (messageId) => onFlagAsSimilar(messageId, chat.id)
                  }
                  currentUserFlagged={msg.flaggedAsSimilarUserIds?.includes(currentUser.id)}
                  group={group}
                  currentUser={currentUser}
                  isGroupedWithPrevious={isGroupedWithPrevious && firstUnreadId !== msg.id}
                  isGroupChat={isGroup}
                  onOpenThread={handleOpenThread}
                  onEditMessage={(m) => beginEditingMessage(m)}
                  onRemoveMessage={(m) => void handleRemoveMessage(m)}
                  onReportMessage={
                    isGroup
                      ? (m) =>
                          setReportTarget({
                            type: 'message',
                            id: m.id,
                            label: m.sender?.name || m.sender?.username || 'this message',
                          })
                      : undefined
                  }
                  onReply={(m) => {
                    setEditingMessage(null);
                    setReplyTo({
                      id: m.id,
                      senderId: m.sender?.id,
                      senderName: m.sender?.name || m.sender?.username,
                      type: m.type,
                      text: m.text,
                      questionStem: m.questionStem,
                    });
                  }}
                  onForward={(m) => setForwardMessage(m)}
                  onCopy={(m) => void handleCopyMessage(m)}
                  onStar={handleToggleStar}
                  onPin={handleTogglePin}
                  starred={starredIds.has(msg.id)}
                  pinned={pinnedMessageId === msg.id}
                  onMentionUser={(username) => setSeedMentionUsername(username)}
                  onScrollToMessage={(messageId) => {
                    messageNodeRefs.current[messageId]?.scrollIntoView({
                      behavior: 'smooth',
                      block: 'center',
                    });
                  }}
                />
              </div>
            </React.Fragment>
          );
        })}
        <div ref={messagesEndRef} />
        {visibleMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            {awaitingMessages ? (
              <>
                <div className="w-10 h-10 border-2 border-lantern-primary/30 border-t-lantern-primary rounded-full animate-spin mb-4" />
                <p className="text-sm text-lantern-text-secondary">Loading messages…</p>
              </>
            ) : (
              <>
                <div className="w-16 h-16 rounded-2xl bg-lantern-background-secondary/60 dark:bg-lantern-surface flex items-center justify-center mb-4">
                  <AppIcon name="chatbubbles" size={32} className="text-lantern-text-tertiary" />
                </div>
                <h3 className="text-base font-semibold text-lantern-text mb-1">
                  {isArchived
                    ? 'This group is archived'
                    : starredOnly
                      ? 'No starred messages yet'
                      : threadSearch.trim().length >= 2
                        ? 'No matches'
                        : 'No messages yet'}
                </h3>
                <p className="text-sm text-lantern-text-secondary max-w-xs">
                  {isArchived
                    ? 'Unarchive the group to resume the conversation.'
                    : starredOnly
                      ? 'Long-press or open a message menu and tap Star to keep it here.'
                      : threadSearch.trim().length >= 2
                        ? 'Try a different search.'
                        : isGroup
                          ? `Be the first to write in ${name}.`
                          : `Say hi to ${name}.`}
                </p>
              </>
            )}
          </div>
        )}
      </div>
      {newMessagesBelow > 0 && (
        <button
          type="button"
          onClick={() => scrollToBottom('smooth')}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 rounded-full bg-lantern-primary text-white text-xs font-semibold shadow-lg hover:bg-lantern-primary-dark transition-colors"
        >
          ↓ {newMessagesBelow} new message{newMessagesBelow === 1 ? '' : 's'}
        </button>
      )}
      </div>

      {/* Composer slot — mutually exclusive states, in precedence order:
          archived group → blocked DM → declined request → the real composer
          (which may itself be preceded by the accept/decline request banner).
          `flex-shrink-0` keeps every one of them at full height beside the
          scrolling list; `pb-16 md:pb-0` clears the mobile bottom nav. */}
      {isArchived ? (
        <div className="flex items-center justify-center gap-3 p-4 pb-20 md:pb-4 bg-amber-50 dark:bg-amber-900/20 border-t border-amber-200 dark:border-amber-800/40 flex-shrink-0">
          <AppIcon name="archive" size={16} className="text-amber-600 dark:text-amber-400" />
          <p className="text-sm text-amber-800 dark:text-amber-300">
            This group is archived.
          </p>
          <button
            onClick={() => onToggleArchiveGroup(group!.id)}
            className="text-sm font-semibold text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 underline underline-offset-2 transition-colors duration-150"
          >
            Unarchive
          </button>
        </div>
      ) : dmBlocked ? (
        <div className="flex flex-col items-center justify-center gap-2 p-4 pb-20 md:pb-4 bg-lantern-background-secondary border-t border-lantern-border flex-shrink-0">
          <p className="text-sm text-lantern-text-secondary text-center">
            {iBlockedThem
              ? 'You blocked this user. Messaging is disabled until you unblock them.'
              : 'You can’t message this user.'}
          </p>
          {iBlockedThem && (
            <button
              type="button"
              disabled={dmBlockBusy}
              onClick={() => void handleToggleDmBlock()}
              className="px-3 py-1.5 rounded-lg text-sm font-semibold border border-lantern-border text-lantern-text hover:bg-lantern-surface disabled:opacity-60"
            >
              Unblock
            </button>
          )}
        </div>
      ) : isDmRequestDeclinedForRecipient ? (
        <div className="flex items-center justify-center gap-3 p-4 pb-20 md:pb-4 bg-lantern-background-secondary border-t border-lantern-border flex-shrink-0">
          <p className="text-sm text-lantern-text-secondary">
            You declined this message request. It stays one-way unless they send again.
          </p>
        </div>
      ) : (
        <div className="flex-shrink-0 pb-16 md:pb-0 bg-lantern-surface relative z-20 border-t border-lantern-border">
          {isDmRequestRecipient && (
            <div className="px-4 py-3 border-b border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/30">
              <p className="text-sm text-amber-900 dark:text-amber-200 mb-2">
                Message request — reply or accept to open a two-way chat. Decline to keep it one-way.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={dmRequestBusy}
                  onClick={() => void handleAcceptDmRequest()}
                  className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-lantern-primary text-white hover:bg-lantern-primary-dark disabled:opacity-60"
                >
                  Accept
                </button>
                <button
                  type="button"
                  disabled={dmRequestBusy}
                  onClick={() => void handleDeclineDmRequest()}
                  className="px-3 py-1.5 rounded-lg text-sm font-semibold border border-lantern-border text-lantern-text hover:bg-lantern-background-secondary disabled:opacity-60"
                >
                  Decline
                </button>
              </div>
            </div>
          )}
          {isDmRequestSender && (
            <p className="px-4 py-2 text-xs text-lantern-text-secondary border-b border-lantern-border bg-lantern-background-secondary">
              Message request sent — they can see your messages. Two-way chat opens when they accept or reply.
            </p>
          )}
          {typingLabels.length > 0 && (
            <p className="px-4 py-1 text-xs text-lantern-text-tertiary" aria-live="polite">
              {typingLabels.length === 1
                ? `${typingLabels[0]} is typing…`
                : `${typingLabels.slice(0, 2).join(' and ')} are typing…`}
            </p>
          )}
          <MessageInputBar
            onSendMessage={handleComposerSend}
            onOpenQuestionModal={isGroup && !communityHost ? onOpenQuestionModal : undefined}
            onAIQuery={isGroup && !communityHost ? onAIQuery : undefined}
            onTyping={broadcastTyping}
            mentionCandidates={mentionCandidates}
            seedMentionUsername={seedMentionUsername}
            onSeedMentionConsumed={() => setSeedMentionUsername(null)}
            replyTo={replyTo}
            onClearReply={() => setReplyTo(null)}
            editingMessage={editingMessage}
            onClearEdit={() => setEditingMessage(null)}
            groupId={isGroup ? chat.id : undefined}
            threadId={!isGroup ? chat.id : undefined}
          />
        </div>
      )}
    </>
  );

  // Thread overlay. It is absolutely positioned inside this component's own
  // `relative` root rather than portalled, so it covers the conversation but not
  // the app chrome. The backdrop click closes it; `stopPropagation` on the panel
  // keeps clicks inside from doing the same. The thread composer disappears when
  // the root message has been removed — a closed thread takes no new replies.
  const threadPanel = threadRootId && chat ? (
    <div
      className="absolute inset-0 z-30 flex justify-end bg-black/30"
      onClick={() => setThreadRootId(null)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-thread-title"
        className="w-full max-w-md h-full bg-lantern-surface border-l border-lantern-border flex flex-col shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between h-14 px-4 border-b border-lantern-border flex-shrink-0">
          <div>
            <p id="chat-thread-title" className="text-sm font-semibold text-lantern-text">Thread</p>
            <p className="text-[11px] text-lantern-text-tertiary">
              {Math.max(0, visibleThreadMessages.length - 1)}{' '}
              {visibleThreadMessages.length - 1 === 1 ? 'reply' : 'replies'}
            </p>
          </div>
          <button
            ref={threadCloseButtonRef}
            type="button"
            onClick={() => setThreadRootId(null)}
            className="p-1.5 rounded-lg text-lantern-text-secondary hover:bg-lantern-background-secondary"
            aria-label="Close thread"
          >
            <AppIcon name="close" size={20} />
          </button>
        </div>
        <div ref={threadScrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
          {threadLoading ? (
            <div className="flex justify-center py-10">
              <div className="w-8 h-8 border-2 border-lantern-primary/30 border-t-lantern-primary rounded-full animate-spin" />
            </div>
          ) : (
            visibleThreadMessages.map((msg) => (
              <div
                key={msg.id}
                ref={(el) => {
                  threadMessageNodeRefs.current[msg.id] = el;
                }}
              >
                <MessageItem
                  message={msg}
                  isCurrentUserMessage={msg.sender?.id === currentUser.id}
                  currentUserVote={userVotes[msg.id]}
                  myReactions={myReactions[msg.id]}
                  onToggleReaction={handleToggleReaction}
                  onVoteQuestion={communityHost ? undefined : onVoteQuestion}
                  onFlagAsSimilar={
                    communityHost ? undefined : (messageId) => onFlagAsSimilar(messageId, chat.id)
                  }
                  currentUserFlagged={msg.flaggedAsSimilarUserIds?.includes(currentUser.id)}
                  group={group}
                  currentUser={currentUser}
                  isGroupChat={chat.chatType === 'group'}
                  onEditMessage={(m) => beginEditingMessage(m, true)}
                  onRemoveMessage={(m) => void handleRemoveMessage(m, true)}
                  onReportMessage={
                    chat.chatType === 'group'
                      ? (m) =>
                          setReportTarget({
                            type: 'message',
                            id: m.id,
                            label: m.sender?.name || m.sender?.username || 'this message',
                          })
                      : undefined
                  }
                  onReply={(m) => {
                    setThreadEditingMessage(null);
                    setThreadReplyTo({
                      id: m.id,
                      senderId: m.sender?.id,
                      senderName: m.sender?.name || m.sender?.username,
                      type: m.type,
                      text: m.text,
                      questionStem: m.questionStem,
                    });
                  }}
                  onForward={(m) => setForwardMessage(m)}
                  onCopy={(m) => void handleCopyMessage(m)}
                  onStar={handleToggleStar}
                  onPin={handleTogglePin}
                  starred={starredIds.has(msg.id)}
                  pinned={pinnedMessageId === msg.id}
                  onMentionUser={(username) => setThreadSeedMentionUsername(username)}
                  onScrollToMessage={(messageId) => {
                    threadMessageNodeRefs.current[messageId]?.scrollIntoView({
                      behavior: 'smooth',
                      block: 'center',
                    });
                  }}
                />
              </div>
            ))
          )}
          <div ref={threadEndRef} />
        </div>
        {!isArchived && !isThreadRootRemoved && (
          <div className="flex-shrink-0 border-t border-lantern-border">
            <MessageInputBar
              onSendMessage={handleThreadSend}
              onAIQuery={chat.chatType === 'group' && !communityHost ? onAIQuery : undefined}
              mentionCandidates={mentionCandidates}
              seedMentionUsername={threadSeedMentionUsername}
              onSeedMentionConsumed={() => setThreadSeedMentionUsername(null)}
              replyTo={threadReplyTo}
              // Clearing a reply inside a thread falls BACK to the root rather
              // than to nothing — there is no such thing as a thread message
              // with no thread.
              onClearReply={() => {
                const root = threadMessages.find((m) => m.id === threadRootId) || threadMessages[0];
                if (root) {
                  setThreadReplyTo({
                    id: root.id,
                    senderId: root.sender?.id,
                    senderName: root.sender?.name || root.sender?.username,
                    type: root.type,
                    text: root.text,
                    questionStem: root.questionStem,
                  });
                }
              }}
              editingMessage={threadEditingMessage}
              onClearEdit={() => setThreadEditingMessage(null)}
              groupId={chat.chatType === 'group' ? chat.id : undefined}
              threadId={chat.chatType === 'dm' ? chat.id : undefined}
            />
          </div>
        )}
        {!isArchived && isThreadRootRemoved && (
          <div className="border-t border-lantern-border px-4 py-3 text-center text-xs text-lantern-text-secondary">
            This thread is closed because its original message was removed.
          </div>
        )}
      </div>
    </div>
  ) : null;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-lantern-background relative">
      {threadPanel}
      {/* Header — fixed at top */}
      <div className="flex-shrink-0 z-20 relative">
        <div className="flex items-center justify-between h-16 px-4 md:px-6 bg-lantern-surface/90 backdrop-blur-md border-b border-lantern-border">
          <div className="flex items-center min-w-0 gap-3">
            {/* Mobile back button */}
            {onBack && (
              <button type="button" onClick={onBack} className="md:hidden p-1.5 -ml-1 mr-1 text-lantern-text-secondary hover:text-lantern-text rounded-lantern hover:bg-lantern-background-secondary relative z-20" aria-label={communityContext ? 'Back to community' : 'Back to chats'}>
                <AppIcon name="arrow-back" size={20} />
              </button>
            )}
            <div className="relative flex-shrink-0">
              <Avatar
                name={name}
                id={isGroup ? chat.id : dmPeerId}
                src={resolveAvatarSrc(avatarUrl, lowDataMode)}
                size="md"
                localOnly={lowDataMode}
                className="ring-2 ring-white dark:ring-lantern-border"
              />
              {!isGroup && !isArchived && resolvedPeerPresence && formatChatPresenceLine(resolvedPeerPresence.settings, resolvedPeerPresence.lastSeenAt).status === 'online' && (
                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-400 border-2 border-white dark:border-lantern-border rounded-full" aria-label="Online" />
              )}
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold truncate text-lantern-text" title={name}>{name}</h2>
              <p className="text-xs text-lantern-text-secondary truncate" title={communityContext && !isArchived ? undefined : headerSubtitle}>
                {isArchived ? (
                  <span className="font-semibold text-amber-600 dark:text-amber-400">Archived</span>
                ) : communityContext ? (
                  <>
                    {memberCountText ? `${memberCountText} · ` : ''}
                    <button
                      type="button"
                      onClick={communityContext.onOpen}
                      aria-label="Open community"
                      className="text-xs text-lantern-primary hover:underline"
                    >
                      {COMMUNITY_COPY.inCommunity(communityContext.name)}
                    </button>
                    {isGroup && !communityHost && questionCount > 0 ? ` · ${questionCount} question${questionCount !== 1 ? 's' : ''}` : ''}
                  </>
                ) : headerSubtitle}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setThreadSearchOpen((open) => !open)}
              className="p-2 text-lantern-text-secondary hover:text-lantern-primary hover:bg-lantern-background-secondary rounded-lantern"
              aria-label="Search in chat"
              title="Search in chat"
            >
              <AppIcon name="search" size={18} />
            </button>
            {/* Quick-action toolbar for groups. Only the primary action (Question)
                stays exposed on small screens; Test/Study fan out at lg+, and
                everything else (visibility, mute) lives in the overflow menu
                so each action sits in exactly one place per breakpoint. */}
            {isGroup && group && !isArchived && !communityHost && (
              <div className="flex items-center gap-1 mr-2">
                <button
                  onClick={onOpenQuestionModal}
                  data-tip-id="chat.question"
                  className="flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] text-xs font-medium text-lantern-text-secondary bg-lantern-background-secondary hover:bg-lantern-primary-background hover:text-lantern-primary rounded-lantern transition-colors duration-200"
                  aria-label="Submit question"
                  title="Submit Question"
                >
                  <AppIcon name="create" size={16} />
                  <span className="hidden lg:inline">Question</span>
                </button>
                <button
                  onClick={onOpenTestConfigModal}
                  data-tip-id="chat.test"
                  className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-lantern-text-secondary bg-lantern-background-secondary hover:bg-lantern-primary-background hover:text-lantern-primary rounded-lantern transition-colors duration-200"
                  aria-label="Take a test"
                  title="Take a Test"
                >
                  <AppIcon name="clipboard-check" size={16} />
                  <span className="hidden lg:inline">Test</span>
                </button>
                <button
                  onClick={onOpenStudyConfigModal}
                  data-tip-id="chat.study"
                  className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-lantern-text-secondary bg-lantern-background-secondary hover:bg-lantern-primary-background hover:text-lantern-primary rounded-lantern transition-colors duration-200"
                  aria-label="Study mode"
                  title="Study Mode"
                >
                  <AppIcon name="book-open" size={16} />
                  <span className="hidden lg:inline">Study</span>
                </button>
              </div>
            )}

            {/* Overflow menu */}
            <Menu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
            <div className="relative">
              <MenuTrigger
                className="p-2 text-lantern-text-secondary hover:text-lantern-primary hover:bg-lantern-background-secondary rounded-lantern transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
                aria-label="Chat options"
                data-tip-id={isGroupAdmin ? 'chat.aiGenerate' : undefined}
              >
                <AppIcon name="ellipsis-vertical" size={20} />
              </MenuTrigger>
              {isGroup && group && (
                <MenuContent align="end" className="w-56">
                  <MenuItem onSelect={() => handleDropdownAction(() => setThreadSearchOpen(true))} icon={<AppIcon name="search" size={16} className="text-lantern-text-tertiary" />}>
                    Search messages
                  </MenuItem>
                  <MenuItem
                    onSelect={() => handleDropdownAction(() => setStarredOnly((on) => !on))}
                    icon={<AppIcon name="star" size={16} className="text-lantern-text-tertiary" />}
                    disabled={!starredOnly && starredIds.size === 0}
                  >
                    {starredOnly ? 'Show all messages' : `Starred messages${starredIds.size > 0 ? ` (${starredIds.size})` : ''}`}
                  </MenuItem>
                  <MenuItem onSelect={() => handleDropdownAction(() => setGalleryOpen(true))} icon={<AppIcon name="image" size={16} className="text-lantern-text-tertiary" />}>
                    Photos and voice
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem onSelect={() => handleDropdownAction(onOpenGroupInfoModal)} icon={<AppIcon name="people" size={16} className="text-lantern-text-tertiary" />}>
                    Group Info & Members
                  </MenuItem>
                  <MenuSeparator />
                  {communityHost ? null : (
                    <>
                      <MenuSubmenu
                        label="All questions"
                        open={questionFiltersOpen}
                        onOpenChange={setQuestionFiltersOpen}
                      >
                        {QUESTION_VISIBILITY_MODE_OPTIONS.map((opt) => (
                          <MenuItem
                            key={opt.value}
                            onSelect={() =>
                              handleDropdownAction(() => setQuestionVisibilityMode(opt.value))
                            }
                            className={`pl-8 ${
                              questionVisibilityMode === opt.value
                                ? 'text-lantern-primary font-medium'
                                : ''
                            }`}
                          >
                            {opt.label}
                            {questionVisibilityMode === opt.value ? ' ✓' : ''}
                          </MenuItem>
                        ))}
                      </MenuSubmenu>
                      <MenuSeparator />
                    </>
                  )}
                  <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-lantern-text-tertiary">
                    Notifications
                  </div>
                  {muteOverflowMenu}
                  <MenuSeparator />
                  {isArchived ? (
                    <MenuItem
                      onSelect={() => handleDropdownAction(() => onToggleArchiveGroup(group.id))}
                      icon={<AppIcon name="archive" size={16} />}
                      className="text-amber-700 dark:text-amber-400"
                    >
                      Unarchive Group
                    </MenuItem>
                  ) : (
                    <>
                      {/* Every study affordance below belongs to a study group
                          now, and a community's chat is never archivable by a
                          member (§5.4 / §6). */}
                      {communityHost ? null : (
                        <>
                          <MenuItem
                            onSelect={() => handleDropdownAction(() => onOpenCreateSubGroupModal(group.id))}
                            icon={<AppIcon name="add-circle" size={16} className="text-lantern-text-tertiary" />}
                          >
                            Create Sub-group
                          </MenuItem>
                          <MenuSeparator />
                          <div className="lg:hidden">
                            <MenuItem onSelect={() => handleDropdownAction(onOpenTestConfigModal)} icon={<AppIcon name="clipboard-check" size={16} className="text-lantern-text-tertiary" />}>
                              Take a Test
                            </MenuItem>
                            <MenuItem onSelect={() => handleDropdownAction(onOpenStudyConfigModal)} icon={<AppIcon name="book-open" size={16} className="text-lantern-text-tertiary" />}>
                              Study Mode
                            </MenuItem>
                          </div>
                          {onOpenAIGenerateModal && isGroupAdmin && (
                            <MenuItem
                              onSelect={() => handleDropdownAction(onOpenAIGenerateModal)}
                              icon={<AppIcon name="sparkles" size={16} />}
                              className="text-lantern-primary"
                            >
                              AI Generate Questions
                            </MenuItem>
                          )}
                          <MenuSeparator />
                          <MenuItem
                            onSelect={() => handleDropdownAction(() => onToggleArchiveGroup(group.id))}
                            icon={<AppIcon name="archive" size={16} />}
                            className="text-amber-600 dark:text-amber-400"
                          >
                            Archive Group
                          </MenuItem>
                        </>
                      )}
                    </>
                  )}
                </MenuContent>
              )}
              {!isGroup && chat && (
                <MenuContent align="end" className="w-56">
                  <MenuItem onSelect={() => handleDropdownAction(() => setThreadSearchOpen(true))} icon={<AppIcon name="search" size={16} className="text-lantern-text-tertiary" />}>
                    Search messages
                  </MenuItem>
                  <MenuItem
                    onSelect={() => handleDropdownAction(() => setStarredOnly((on) => !on))}
                    icon={<AppIcon name="star" size={16} className="text-lantern-text-tertiary" />}
                    disabled={!starredOnly && starredIds.size === 0}
                  >
                    {starredOnly ? 'Show all messages' : `Starred messages${starredIds.size > 0 ? ` (${starredIds.size})` : ''}`}
                  </MenuItem>
                  <MenuItem onSelect={() => handleDropdownAction(() => setGalleryOpen(true))} icon={<AppIcon name="image" size={16} className="text-lantern-text-tertiary" />}>
                    Photos and voice
                  </MenuItem>
                  <MenuSeparator />
                  <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-lantern-text-tertiary">
                    Notifications
                  </div>
                  {muteOverflowMenu}
                  <MenuSeparator />
                  {(chat as any).isArchived ? (
                    <MenuItem
                      onSelect={() => {
                        setIsDropdownOpen(false);
                        onUnarchiveDmThread?.(chat.id);
                      }}
                      icon={<AppIcon name="archive" size={16} />}
                      className="text-amber-700 dark:text-amber-400"
                    >
                      Unarchive Conversation
                    </MenuItem>
                  ) : (
                    <MenuItem
                      onSelect={() => {
                        setIsDropdownOpen(false);
                        onArchiveDmThread?.(chat.id);
                      }}
                      icon={<AppIcon name="archive" size={16} />}
                      className="text-amber-600 dark:text-amber-400"
                    >
                      Archive Conversation
                    </MenuItem>
                  )}
                  {dmPeerId && (
                    <MenuItem
                      onSelect={() => {
                        setIsDropdownOpen(false);
                        void handleToggleDmBlock();
                      }}
                      icon={<AppIcon name="ban" size={16} />}
                      className="text-red-600 dark:text-red-400"
                    >
                      {iBlockedThem ? 'Unblock User' : 'Block User'}
                    </MenuItem>
                  )}
                  {dmPeerId && (
                    <MenuItem
                      onSelect={() => {
                        setIsDropdownOpen(false);
                        setReportTarget({ type: 'user', id: dmPeerId, label: name });
                      }}
                      icon={<AppIcon name="flag" size={16} />}
                      className="text-red-600 dark:text-red-400"
                    >
                      Report User…
                    </MenuItem>
                  )}
                  <MenuSeparator />
                  {onDeleteDmThread && (
                    <MenuItem
                      destructive
                      onSelect={() => {
                        setIsDropdownOpen(false);
                        void confirmDialog({
                          title: 'Delete conversation?',
                          message: 'Delete this conversation? All messages will be permanently removed.',
                          danger: true,
                          confirmLabel: 'Delete',
                        }).then((ok) => {
                          if (ok) onDeleteDmThread(chat.id);
                        });
                      }}
                      icon={<AppIcon name="trash" size={16} />}
                    >
                      Delete Conversation
                    </MenuItem>
                  )}
                </MenuContent>
              )}
            </div>
            </Menu>
          </div>
        </div>
        {chatMuted && (
          <div className="flex items-center justify-between gap-2 px-4 md:px-6 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200/70 dark:border-amber-900/40 text-xs text-amber-800 dark:text-amber-300">
            <span className="inline-flex items-center gap-1.5 min-w-0">
              <AppIcon name="notifications-off" size={14} className="shrink-0" aria-hidden />
              <span className="truncate">
                Notifications muted{muteUntilLabel ? ` until ${muteUntilLabel}` : ''}
              </span>
            </span>
            <button
              type="button"
              onClick={() => void handleUnmute()}
              disabled={muteBusy}
              className="shrink-0 font-semibold underline-offset-2 hover:underline disabled:opacity-50"
            >
              Unmute
            </button>
          </div>
        )}
      </div>

      {/* A DM that the server says is a marketplace inquiry gets the Chat/Offers
          tabs, the listing strip, the sticky deal bar and the order bar wrapped
          around the SAME `chatPanelContent`. Any other conversation renders it
          bare. The deal bar is hidden once an order exists — the order bar owns
          those states — so the two can never offer contradictory actions. */}
      {chat.chatType === 'dm' && inquiry ? (
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as 'chat' | 'offers')}
          variant="segmented"
          aria-label="Marketplace conversation"
          className="flex flex-col flex-1 min-h-0"
        >
          <div className="flex-shrink-0 bg-lantern-surface border-b border-lantern-border px-4 py-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              {inquiry.listing?.images && inquiry.listing.images.length > 0 ? (
                <img
                  src={normalizeStorageUrl(inquiry.listing.images[0])}
                  alt={inquiry.listing.title}
                  className="w-12 h-12 rounded-lg object-cover bg-lantern-background-secondary dark:bg-lantern-surface-secondary flex-shrink-0 border border-lantern-border"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              ) : (
                <div className="w-12 h-12 rounded-lg bg-lantern-background-secondary dark:bg-lantern-surface-secondary flex items-center justify-center flex-shrink-0 border border-lantern-border">
                  <AppIcon name="bag" size={24} className="text-lantern-text-tertiary" />
                </div>
              )}
              <div className="min-w-0">
                <h4 className="text-sm font-semibold text-lantern-text truncate leading-snug">
                  {inquiry.listing?.title}
                </h4>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-sm font-bold text-lantern-primary">
                    {inquiry.listing?.price ? `₦${inquiry.listing.price.toLocaleString()}` : 'Free'}
                  </span>
                  <span className={`text-label tracking-normal font-semibold px-2 py-0.5 rounded-full capitalize ${
                    inquiry.status === 'purchased' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' :
                    inquiry.status === 'negotiating' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' :
                    inquiry.status === 'closed' ? 'bg-lantern-background-secondary text-lantern-text dark:bg-lantern-background-secondary/40 dark:text-lantern-text-tertiary' :
                    'bg-lantern-primary-background text-lantern-primary-dark dark:bg-lantern-primary-background dark:text-lantern-primary-light'
                  }`}>
                    {inquiry.status}
                  </span>
                </div>
              </div>
            </div>
            <TabList className="bg-lantern-background p-0.5 rounded-lg border border-lantern-border !border-solid">
              <Tab value="chat" index={0} className="!text-xs !font-semibold !px-3 !py-2 !rounded-md">
                Chat
              </Tab>
              <Tab
                value="offers"
                index={1}
                className="!text-xs !font-semibold !px-3 !py-2 !rounded-md"
                badge={activeOffer ? <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> : undefined}
              >
                Offers
              </Tab>
            </TabList>
          </div>

          {/* Sticky deal bar — surfaces the ONE primary action in the chat view so a
              buyer/seller never has to hunt in the Offers tab. Hidden once an order
              exists (the order bar below drives those states). */}
          {!activeOrder && (() => {
            const pending = activeOffer && activeOffer.status === 'pending' ? activeOffer : null;
            const canRespond = pending ? canRespondToOffer(pending, currentUser.id) : false;
            const canWithdraw = pending ? canWithdrawOffer(pending, currentUser.id) : false;
            const isBuyer = currentUser.id === inquiry.buyer_id;
            if (inquiry.status === 'purchased' || inquiry.status === 'closed') return null;
            return (
              <div className="flex-shrink-0 px-4 py-2.5 bg-lantern-surface border-b border-lantern-border flex flex-wrap items-center gap-x-3 gap-y-1.5">
                {pending ? (
                  <>
                    <span className="text-xs font-semibold text-lantern-text">
                      {getOfferProposedBy(pending) === 'seller' ? 'Counter-offer' : 'Offer'}: ₦{pending.amount.toLocaleString()}
                    </span>
                    {canRespond ? (
                      <div className="flex items-center gap-1.5">
                        <button type="button" disabled={offerLoading} onClick={() => void handleRespond('accept')} className="text-xs font-semibold px-3 py-1.5 rounded-lantern bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">Accept</button>
                        <button type="button" disabled={offerLoading} onClick={() => void handleRespond('decline')} className="text-xs font-semibold px-3 py-1.5 rounded-lantern border border-lantern-border text-lantern-text-secondary hover:bg-lantern-background-secondary disabled:opacity-50">Decline</button>
                        <button type="button" onClick={() => setActiveTab('offers')} className="text-xs font-medium px-2 py-1.5 text-lantern-primary hover:underline">Counter</button>
                      </div>
                    ) : canWithdraw ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-lantern-text-secondary">Waiting for a response</span>
                        <button type="button" disabled={offerLoading} onClick={() => void handleRespond('withdraw')} className="text-xs font-medium px-2 py-1.5 text-lantern-text-secondary hover:text-red-600 hover:underline disabled:opacity-50">Withdraw</button>
                      </div>
                    ) : (
                      <span className="text-xs text-lantern-text-secondary">Awaiting a response</span>
                    )}
                  </>
                ) : isBuyer ? (
                  <>
                    <span className="text-xs text-lantern-text-secondary">No active offer.</span>
                    <button type="button" onClick={() => setShowMakeOfferModal(true)} className="text-xs font-semibold px-3 py-1.5 rounded-lantern bg-emerald-600 text-white hover:bg-emerald-700 inline-flex items-center gap-1.5">
                      <AppIcon name="currency" size={14} /> Make an offer
                    </button>
                  </>
                ) : (
                  <span className="text-xs text-lantern-text-secondary">Waiting for the buyer to make an offer.</span>
                )}
                <button type="button" onClick={() => setActiveTab(activeTab === 'offers' ? 'chat' : 'offers')} className="ml-auto text-[11px] font-medium text-lantern-primary hover:underline">
                  {activeTab === 'offers' ? 'View chat' : 'View details'}
                </button>
                <span className="basis-full text-label tracking-normal text-lantern-text-tertiary">Paystack-protected · you pay the listed price</span>
              </div>
            );
          })()}

          {activeOrder && activeOrder.status !== 'completed' && activeOrder.status !== 'cancelled' && (
            <div className="flex-shrink-0 px-4 py-2 bg-lantern-primary-background dark:bg-lantern-primary-background border-b border-lantern-primary/20 dark:border-lantern-primary/30 flex flex-wrap gap-2 items-center">
              <span className="text-xs font-medium text-lantern-primary-dark dark:text-lantern-primary-light">
                Order: {activeOrder.status.replace(/_/g, ' ')} · ₦{Number(activeOrder.amount).toLocaleString()}
              </span>
              {currentUser.id === inquiry.seller_id && activeOrder.status === 'paid' && (
                <button
                  type="button"
                  disabled={orderActionLoading}
                  className="text-xs px-2 py-1 rounded-md bg-lantern-primary text-white disabled:opacity-50"
                  onClick={async () => {
                    setOrderActionLoading(true);
                    try {
                      const updated = await updateMarketplaceOrder(activeOrder.id, { action: 'mark_ready' });
                      setActiveOrder(updated);
                    } catch (e: any) { useToastStore.getState().showToast(e.message || 'Something went wrong', 'error'); }
                    finally { setOrderActionLoading(false); }
                  }}
                >
                  Mark ready
                </button>
              )}
              {currentUser.id === inquiry.seller_id && ['pending_payment', 'awaiting_payment'].includes(activeOrder.status) && (
                <span className="text-xs text-lantern-text-secondary">Awaiting buyer payment</span>
              )}
              {currentUser.id === inquiry.buyer_id && ['pending_payment', 'awaiting_payment'].includes(activeOrder.status) && (
                <button
                  type="button"
                  disabled={orderActionLoading}
                  className="text-xs px-2 py-1 rounded-md bg-emerald-600 text-white disabled:opacity-50"
                  onClick={async () => {
                    setOrderActionLoading(true);
                    try {
                      // Resume the Paystack checkout for an unpaid order (buyers pay in-app).
                      const res = await resumeMarketplaceOrderCheckout(activeOrder.id);
                      if (res?.authorizationUrl) {
                        window.location.assign(res.authorizationUrl);
                        return;
                      }
                      useToastStore.getState().showToast('Could not start checkout. Please try again.', 'error');
                    } catch (e: any) { useToastStore.getState().showToast(e.message || 'Could not start checkout', 'error'); }
                    finally { setOrderActionLoading(false); }
                  }}
                >
                  Pay now · ₦{Number(activeOrder.amount).toLocaleString()}
                </button>
              )}
              {currentUser.id === inquiry.buyer_id && ['paid', 'ready_for_pickup'].includes(activeOrder.status) && (
                <button
                  type="button"
                  disabled={orderActionLoading}
                  className="text-xs px-2 py-1 rounded-md bg-emerald-600 text-white"
                  onClick={async () => {
                    setOrderActionLoading(true);
                    try {
                      const updated = await updateMarketplaceOrder(activeOrder.id, { action: 'confirm_received' });
                      setActiveOrder(updated);
                    } catch (e: any) { useToastStore.getState().showToast(e.message || 'Something went wrong', 'error'); }
                    finally { setOrderActionLoading(false); }
                  }}
                >
                  Confirm received
                </button>
              )}
            </div>
          )}

          <TabPanel value="chat" className="flex flex-col flex-1 min-h-0 overflow-hidden">
            {chatPanelContent}
          </TabPanel>

          <TabPanel value="offers" className="flex-1 flex flex-col bg-lantern-background overflow-y-auto p-4 md:p-6 min-h-0">
            {/* Listing Card */}
            <div className="bg-lantern-surface rounded-2xl p-4 border border-lantern-border/60 dark:border-lantern-border/60 shadow-sm flex flex-col sm:flex-row gap-4 mb-6">
              {inquiry.listing?.images && inquiry.listing.images.length > 0 ? (
                <img
                  src={normalizeStorageUrl(inquiry.listing.images[0])}
                  alt={inquiry.listing.title}
                  className="w-full sm:w-32 h-32 rounded-xl object-cover bg-lantern-background-secondary dark:bg-lantern-surface-secondary border border-lantern-border flex-shrink-0"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              ) : (
                <div className="w-full sm:w-32 h-32 rounded-xl bg-lantern-background-secondary dark:bg-lantern-surface-secondary flex items-center justify-center border border-lantern-border flex-shrink-0">
                  <AppIcon name="bag" size={40} className="text-lantern-text-tertiary" />
                </div>
              )}
              <div className="flex-1 flex flex-col justify-between min-w-0">
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-base font-bold text-lantern-text line-clamp-2">
                      {inquiry.listing?.title}
                    </h3>
                    <span className={`text-label font-bold px-2 py-0.5 rounded-md uppercase flex-shrink-0 ${
                      inquiry.status === 'purchased' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' :
                      inquiry.status === 'negotiating' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' :
                      inquiry.status === 'closed' ? 'bg-lantern-background-secondary text-lantern-text dark:bg-lantern-background-secondary/40 dark:text-lantern-text-tertiary' :
                      'bg-lantern-primary-background text-lantern-primary-dark dark:bg-lantern-primary-background dark:text-lantern-primary-light'
                    }`}>
                      {inquiry.status}
                    </span>
                  </div>
                  <p className="text-xs text-lantern-text-secondary mt-1 capitalize font-medium">
                    Category: {inquiry.listing?.category || 'academic'}
                  </p>
                </div>
                
                <div className="flex items-baseline gap-2 mt-4">
                  <span className="text-xs text-lantern-text-secondary">Asking Price:</span>
                  <span className="text-lg font-extrabold text-lantern-primary">
                    {inquiry.listing?.price ? `₦${inquiry.listing.price.toLocaleString()}` : 'Free'}
                  </span>
                </div>
              </div>
            </div>

            {/* Active Offer Section */}
            <div className="bg-lantern-surface rounded-2xl p-5 border border-lantern-border/60 dark:border-lantern-border/60 shadow-sm mb-6">
              <h3 className="text-sm font-bold text-lantern-text mb-4 flex items-center gap-1.5">
                <AppIcon name="currency" size={20} className="text-emerald-500" />
                Active Offer
              </h3>
              
              {activeOffer ? (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-4 bg-lantern-background dark:bg-lantern-surface-secondary/40 rounded-xl border border-lantern-border/60 dark:border-lantern-border/60 gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-lantern-text-secondary">Offered Amount:</span>
                        <span className="text-lg font-bold text-lantern-text">
                          ₦{activeOffer.amount.toLocaleString()}
                        </span>
                      </div>
                      <p className="text-[11px] text-lantern-text-tertiary mt-0.5 font-medium">
                        Submitted on {new Date(activeOffer.created_at).toLocaleDateString()}
                      </p>
                      {activeOffer.message && (
                        <p className="text-xs italic text-lantern-text-secondary mt-2 bg-lantern-surface p-2 rounded-lg border border-lantern-border/50">
                          "{activeOffer.message}"
                        </p>
                      )}
                    </div>
                    
                    <div className="flex-shrink-0">
                      <span className={`px-2.5 py-1 text-xs font-semibold rounded-full capitalize ${
                        activeOffer.status === 'pending' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' :
                        activeOffer.status === 'countered' ? 'bg-lantern-primary-background text-lantern-primary-dark dark:bg-lantern-primary-background dark:text-lantern-primary-light' :
                        activeOffer.status === 'accepted' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' :
                        activeOffer.status === 'declined' ? 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300' :
                        'bg-lantern-background-secondary text-lantern-text dark:bg-lantern-background-secondary/40 dark:text-lantern-text-tertiary'
                      }`}>
                        Offer {activeOffer.status}
                      </span>
                    </div>
                  </div>

                  {/* `canRespondToOffer` and `canWithdrawOffer` are shared helpers,
                      so web and mobile cannot disagree about whose turn it is; the
                      Accept/Decline labels flip to "Counter" from the same source. */}
                  {/* Action Controls — turn-based on proposed_by */}
                  <div className="pt-2">
                    {offerError && <p className="text-xs text-red-500 mb-3 font-semibold">{offerError}</p>}

                    {(() => {
                      const proposedBy = getOfferProposedBy(activeOffer);
                      const canRespond = canRespondToOffer(activeOffer, currentUser.id);
                      const canWithdraw = canWithdrawOffer(activeOffer, currentUser.id);
                      const isBuyerView = currentUser.id === activeOffer.buyer_id;
                      const acceptLabel = proposedBy === 'seller' ? 'Accept Counter' : 'Accept Offer';
                      const declineLabel = proposedBy === 'seller' ? 'Decline Counter' : 'Decline Offer';

                      if (canWithdraw && !canRespond) {
                        return (
                          <div className="flex flex-wrap gap-2">
                            <button
                              disabled={offerLoading}
                              onClick={() => handleRespond('withdraw')}
                              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-lantern-border text-white text-xs font-bold rounded-xl transition-colors shadow-sm"
                            >
                              {offerLoading ? 'Withdrawing...' : 'Withdraw Offer'}
                            </button>
                          </div>
                        );
                      }

                      if (!canRespond) {
                        return (
                          <p className="text-xs text-lantern-text-secondary font-medium">
                            {isBuyerView
                              ? 'Waiting for the seller to respond…'
                              : 'Waiting for the buyer to respond…'}
                          </p>
                        );
                      }

                      return (
                        <div className="flex flex-col gap-3">
                          {!showCounterInput && (
                            <div className="flex flex-wrap gap-2">
                              <button
                                disabled={offerLoading}
                                onClick={() => handleRespond('accept')}
                                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-lantern-border text-white text-xs font-bold rounded-xl transition-colors shadow-sm"
                              >
                                {acceptLabel}
                              </button>
                              <button
                                disabled={offerLoading}
                                onClick={() => handleRespond('decline')}
                                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-lantern-border text-white text-xs font-bold rounded-xl transition-colors shadow-sm"
                              >
                                {declineLabel}
                              </button>
                              <button
                                disabled={offerLoading}
                                onClick={() => { setShowCounterInput(true); setCounterValue(''); }}
                                className="px-4 py-2 bg-lantern-primary hover:bg-lantern-primary-dark disabled:bg-lantern-border text-white text-xs font-bold rounded-xl transition-colors shadow-sm"
                              >
                                Counter Offer
                              </button>
                              {canWithdraw && (
                                <button
                                  disabled={offerLoading}
                                  onClick={() => handleRespond('withdraw')}
                                  className="px-4 py-2 border border-lantern-border text-lantern-text-secondary hover:bg-lantern-background dark:hover:bg-lantern-surface-secondary text-xs font-bold rounded-xl transition-colors"
                                >
                                  Withdraw
                                </button>
                              )}
                            </div>
                          )}

                          {showCounterInput && (
                            <div className="flex flex-col gap-2 p-3 bg-lantern-background dark:bg-lantern-surface-secondary/30 rounded-xl border border-lantern-border">
                              <label className="text-xs font-bold text-lantern-text">
                                Counter Offer Amount (₦)
                              </label>
                              <div className="flex gap-2">
                                <input
                                  type="number"
                                  value={counterValue}
                                  onChange={(e) => setCounterValue(e.target.value)}
                                  placeholder="Enter counter amount"
                                  className="flex-1 px-3 py-1.5 border border-lantern-border rounded-lg focus:ring-2 focus:ring-lantern-primary bg-lantern-surface text-lantern-text text-sm font-semibold"
                                />
                                <button
                                  disabled={offerLoading || !counterValue || parseFloat(counterValue) <= 0}
                                  onClick={() => handleRespond('counter', parseFloat(counterValue))}
                                  className="px-4 py-1.5 bg-lantern-primary hover:bg-lantern-primary-dark disabled:bg-lantern-border text-white text-xs font-bold rounded-lg transition-colors"
                                >
                                  Send Counter
                                </button>
                                <button
                                  disabled={offerLoading}
                                  onClick={() => setShowCounterInput(false)}
                                  className="px-3 py-1.5 bg-lantern-surface text-lantern-text border border-lantern-border text-xs font-bold rounded-lg transition-colors hover:bg-lantern-background"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center py-6 text-center">
                  {(() => {
                    const dealDone = inquiry.status === 'purchased' || inquiry.status === 'closed';
                    const hasLiveOrder = !!activeOrder && activeOrder.status !== 'cancelled';
                    if (dealDone || hasLiveOrder) {
                      // A deal is struck — don't re-offer to buy an item already ordered.
                      return (
                        <p className="text-sm text-lantern-text-secondary font-medium">
                          {activeOrder
                            ? `This deal is confirmed — order ${activeOrder.status.replace(/_/g, ' ')}.`
                            : 'This listing has been purchased or the inquiry is closed.'}
                        </p>
                      );
                    }
                    return (
                      <>
                        <p className="text-sm text-lantern-text-secondary mb-4 font-medium">
                          There are no active offers in negotiation.
                        </p>
                        {currentUser.id === inquiry.buyer_id && (
                          <button
                            onClick={() => setShowMakeOfferModal(true)}
                            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition-colors shadow-sm flex items-center gap-1.5"
                          >
                            <AppIcon name="currency" size={16} />
                            Make an Offer
                          </button>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* Negotiation History Timeline */}
            <div className="bg-lantern-surface rounded-2xl p-5 border border-lantern-border/60 dark:border-lantern-border/60 shadow-sm flex-1">
              <h3 className="text-sm font-bold text-lantern-text mb-4">
                Negotiation History
              </h3>
              
              {offerHistory.length === 0 ? (
                <p className="text-xs text-lantern-text-tertiary text-center py-8">
                  No previous offers or counter-offers recorded.
                </p>
              ) : (
                <div className="relative border-l border-lantern-border ml-3 pl-5 space-y-6">
                  {offerHistory.map((offer) => {
                    return (
                      <div key={offer.id} className="relative">
                        {/* Dot indicator */}
                        <span className={`absolute -left-[26px] top-1.5 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-lantern-border ${
                          offer.status === 'accepted' ? 'bg-emerald-500' :
                          offer.status === 'declined' ? 'bg-red-500' :
                          offer.status === 'withdrawn' ? 'bg-lantern-border' :
                          offer.status === 'countered' ? 'bg-amber-500' :
                          'bg-lantern-primary'
                        }`} />
                        
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-bold text-lantern-text">
                              ₦{offer.amount.toLocaleString()}
                            </span>
                            <span className="text-label tracking-normal text-lantern-text-tertiary font-medium">
                              {new Date(offer.created_at).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-xs text-lantern-text-secondary mt-1">
                            {getOfferProposedBy(offer) === 'seller'
                              ? `${offer.seller_id === currentUser.id ? 'You' : 'Seller'} countered ₦${offer.amount.toLocaleString()} (${offer.status})`
                              : `${offer.buyer_id === currentUser.id ? 'You' : 'Buyer'} offered ₦${offer.amount.toLocaleString()} (${offer.status})`}
                          </p>
                          {offer.message && (
                            <p className="text-xs italic text-lantern-text-tertiary mt-1">
                              "{offer.message}"
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </TabPanel>
        </Tabs>
      ) : (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {chatPanelContent}
        </div>
      )}

      {showMakeOfferModal && inquiry && inquiry.listing && (
        <MakeOfferModal
          isOpen={showMakeOfferModal}
          onClose={() => setShowMakeOfferModal(false)}
          listing={inquiry.listing}
          onSuccess={(amount) => {
            if (amount) {
              // FIXED (F1): same fire-and-forget narration as the offer-status
              // path above — a rejection (including the H16 busy lock) must be
              // caught on the promise, not by a synchronous try/catch.
              void Promise.resolve()
                .then(() => onSendMessage(`[Offer] I submitted a new offer of ₦${amount.toLocaleString()}!`))
                .catch((msgErr) => {
                  console.error('Failed to send status update message to chat:', msgErr);
                });
            }
            loadOfferHistory(inquiry);
          }}
        />
      )}

      <ForwardChatModal
        isOpen={!!forwardMessage}
        onClose={() => setForwardMessage(null)}
        messageText={(forwardMessage?.questionStem || forwardMessage?.text || '').trim()}
        currentUser={currentUser}
        groups={groups}
        dmThreads={dmThreads}
      />
      <ChatGalleryModal
        isOpen={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        items={galleryItems}
        onOpenItem={scrollToMessageId}
      />

      {reportTarget ? (
        <ReportContentModal
          isOpen={!!reportTarget}
          onClose={() => setReportTarget(null)}
          targetType={reportTarget.type}
          targetId={reportTarget.id}
          targetLabel={reportTarget.label}
        />
      ) : null}

    </div>
  );
};

export default ChatWindow;