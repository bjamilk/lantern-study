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
 *  - services/supabase: threads (`fetchGroupThread` / `fetchDmThread`), DM
 *    request accept/decline, block + mute status, presence (`fetchUserProfile`).
 *    The marketplace set moved with the Offers tab — see
 *    `hooks/chat/useMarketplaceOffers.ts` and `components/chat/OffersPanel.tsx`.
 *  - supabase realtime BROADCAST channels: `typing:<chatId>` and `chat-read:<chatId>`.
 *  - stores: `uiStore.lowDataMode`, `communityStore.myCommunities`, `toastStore`,
 *    `confirmStore.confirmDialog`, `useBudgetHandlers`.
 *  - `hooks/chat/useMessageActions.ts` for reactions, stars, pins and copy —
 *    which is where the reaction endpoints and the device-local localStorage
 *    marks now live.
 * Gotchas:
 *  - EVERY hook must stay above the `if (!chat)` early return. Opening a chat from the
 *    empty state otherwise changes the hook count (React error #310).
 *  - Auto-scroll is conditional on `isNearBottomRef` / own-message; the initial position
 *    is decided once per chat id by `initialAnchorDoneRef` and must wait for
 *    `unreadAnchorAt !== undefined`, which is the "mark-as-read has reported" signal.
 *  - Colours are `lantern-*` tokens plus Tailwind palette steps with explicit `dark:`
 *    pairs; there is no JS theme branch here and none should be added.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildChatHome,
  collectChatGalleryItems,
  formatChatPresenceLine,
  type ChatHomeLounge,
} from '@lantern/shared/chat';
import { ChatGalleryModal } from './chat/ChatGalleryModal';
import { ChatHeader } from './chat/ChatHeader';
import { MessageList } from './chat/MessageList';
import { selectVisibleMessages, selectVisibleThreadMessages } from './chat/visibleMessages';
import { useMessageActions } from '../hooks/chat/useMessageActions';
import { useChatComposer } from '../hooks/chat/useChatComposer';
import { ForwardChatModal } from './chat/ForwardChatModal';
import { COMMUNITY_COPY } from '@lantern/shared/network';
import { ChatHomePane } from './chat/ChatHomePane';
import { OffersPanel } from './chat/OffersPanel';
import { ThreadPanel } from './chat/ThreadPanel';
import { useMarketplaceOffers } from '../hooks/chat/useMarketplaceOffers';
import { useGroupStore } from '../stores/groupStore';
import { useCommunityStore } from '../stores/communityStore';
import { fetchMyInquiries, fetchUserProfile } from '../services/supabase';
import { useToastStore } from '../stores/toastStore';
import { confirmDialog } from '../stores/confirmStore';
import { Group, Message, User, DMThread, ChatItem, MessageReplyPreview } from '../types';
import ReportContentModal from './moderation/ReportContentModal';
import type { ContentReportTargetType } from '@lantern/shared';
import MessageInputBar, { type SendMessageOptions } from './MessageInputBar';
import GroupListItem from './GroupListItem';
import { Avatar, Menu, MenuTrigger, MenuContent, MenuItem, MenuSubmenu, MenuSeparator } from './ui';
import { resolveAvatarSrc } from '../utils/avatar';
import { useUIStore } from '../stores/uiStore';
import { resolveGroupChatSenderLabel } from '@lantern/shared/utils';
import {
  formatMuteUntilLabel,
  type ChatMuteDurationId,
} from '@lantern/shared';
import { isCommunityBoard } from '@lantern/shared/network';
import {
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
  const updateMessageInState = useGroupStore((state) => state.updateMessageInState);
  const showToast = useToastStore((state) => state.showToast);
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
  const [threadRootId, setThreadRootId] = useState<string | null>(null);
  const [threadMessages, setThreadMessages] = useState<Message[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [starredOnly, setStarredOnly] = useState(false);
  const [threadSearchOpen, setThreadSearchOpen] = useState(false);
  const [threadSearch, setThreadSearch] = useState('');
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [forwardMessage, setForwardMessage] = useState<Message | null>(null);

  /**
   * Reactions, stars, pins and copy — with the three pieces of state and the
   * two effects they need. Called here rather than where the reaction block
   * used to sit, because the three list-view setters it clears on close are
   * declared just above.
   */
  const {
    myReactions,
    handleToggleReaction,
    starredIds,
    pinnedMessageId,
    handleToggleStar,
    handleTogglePin,
    handleCopyMessage,
  } = useMessageActions({
    chat,
    currentUser,
    isGroup: chat?.chatType === 'group',
    messagesProp,
    updateMessageInState,
    showToast,
    setStarredOnly,
    setThreadSearch,
    setThreadSearchOpen,
  });
  const messageNodeRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // The two ways the main list touches that node map, named so MessageRow can
  // take them as props instead of closing over the ref. Both are exactly what
  // the inline versions did before the list was extracted.
  const registerMessageNode = useCallback((messageId: string, node: HTMLDivElement | null) => {
    messageNodeRefs.current[messageId] = node;
  }, []);
  const scrollToMessageNode = useCallback((messageId: string) => {
    messageNodeRefs.current[messageId]?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  }, []);
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

  /**
   * The main and thread composers: reply/edit/mention-seed state, and the four
   * handlers that act on it. Called exactly where its state used to be declared
   * — it registers no effect, so nothing about effect order moved.
   */
  const {
    replyTo,
    setReplyTo,
    seedMentionUsername,
    setSeedMentionUsername,
    editingMessage,
    setEditingMessage,
    threadReplyTo,
    setThreadReplyTo,
    threadEditingMessage,
    setThreadEditingMessage,
    threadSeedMentionUsername,
    setThreadSeedMentionUsername,
    handleComposerSend,
    handleThreadSend,
    beginEditingMessage,
    handleRemoveMessage,
  } = useChatComposer({
    onSendMessage,
    onEditMessage,
    onRemoveMessage,
    threadRootId,
    loadThread,
  });

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

  /**
   * The marketplace half of a DM: inquiry, offers, order, and the four money
   * actions. Called exactly where its ten pieces of state used to be declared,
   * so the two effects it carries keep their position in the shell's effect
   * order (nothing else calls a hook between here and where they used to sit).
   */
  const {
    inquiry,
    setInquiry,
    activeOffer,
    offerHistory,
    activeTab,
    setActiveTab,
    showMakeOfferModal,
    setShowMakeOfferModal,
    showCounterInput,
    setShowCounterInput,
    counterValue,
    setCounterValue,
    offerLoading,
    offerError,
    activeOrder,
    setActiveOrder,
    orderActionLoading,
    setOrderActionLoading,
    loadOfferHistory,
    handleRespond,
  } = useMarketplaceOffers({
    chat,
    currentUser,
    onSendMessage,
    refreshBudgetTransactions,
  });


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
      selectVisibleMessages({
        messages,
        isGroupChat,
        questionVisibilityMode,
        starredOnly,
        starredIds,
        threadSearch,
      }),
    [messages, isGroupChat, questionVisibilityMode, starredOnly, starredIds, threadSearch]
  );
  const visibleThreadMessages = useMemo(
    () => selectVisibleThreadMessages(threadMessages, isGroupChat),
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
      <MessageList
        visibleMessages={visibleMessages}
        messagesContainerRef={messagesContainerRef}
        messagesEndRef={messagesEndRef}
        firstUnreadRef={firstUnreadRef}
        handleScroll={handleScroll}
        isLoadingMore={isLoadingMore}
        awaitingMessages={awaitingMessages}
        newMessagesBelow={newMessagesBelow}
        scrollToBottom={scrollToBottom}
        firstUnreadId={firstUnreadId}
        isArchived={isArchived}
        isGroup={isGroup}
        starredOnly={starredOnly}
        threadSearch={threadSearch}
        name={name}
        userVotes={userVotes}
        myReactions={myReactions}
        starredIds={starredIds}
        pinnedMessageId={pinnedMessageId}
        registerNode={registerMessageNode}
        onScrollToMessage={scrollToMessageNode}
        rowProps={{
          currentUser,
          chatId: chat.id,
          isGroup,
          group,
          communityHost,
          handleToggleReaction,
          onVoteQuestion,
          onFlagAsSimilar,
          handleOpenThread,
          beginEditingMessage,
          handleRemoveMessage,
          handleCopyMessage,
          handleToggleStar,
          handleTogglePin,
          setReportTarget,
          setEditingMessage,
          setReplyTo,
          setForwardMessage,
          setSeedMentionUsername,
        }}
      />
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


  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-lantern-background relative">
      {/* Thread overlay — see components/chat/ThreadPanel.tsx for why it is
          positioned inside this component's root rather than portalled. */}
      <ThreadPanel
        threadRootId={threadRootId}
        chat={chat}
        currentUser={currentUser}
        group={group}
        communityHost={communityHost}
        isArchived={isArchived}
        isThreadRootRemoved={isThreadRootRemoved}
        threadLoading={threadLoading}
        visibleThreadMessages={visibleThreadMessages}
        threadMessages={threadMessages}
        threadReplyTo={threadReplyTo}
        threadEditingMessage={threadEditingMessage}
        threadSeedMentionUsername={threadSeedMentionUsername}
        threadScrollRef={threadScrollRef}
        threadEndRef={threadEndRef}
        threadCloseButtonRef={threadCloseButtonRef}
        threadMessageNodeRefs={threadMessageNodeRefs}
        userVotes={userVotes}
        myReactions={myReactions}
        starredIds={starredIds}
        pinnedMessageId={pinnedMessageId}
        mentionCandidates={mentionCandidates}
        setThreadRootId={setThreadRootId}
        setThreadReplyTo={setThreadReplyTo}
        setThreadEditingMessage={setThreadEditingMessage}
        setThreadSeedMentionUsername={setThreadSeedMentionUsername}
        setForwardMessage={setForwardMessage}
        setReportTarget={setReportTarget}
        handleThreadSend={handleThreadSend}
        handleToggleReaction={handleToggleReaction}
        handleCopyMessage={handleCopyMessage}
        handleToggleStar={handleToggleStar}
        handleTogglePin={handleTogglePin}
        beginEditingMessage={beginEditingMessage}
        handleRemoveMessage={handleRemoveMessage}
        onVoteQuestion={onVoteQuestion}
        onFlagAsSimilar={onFlagAsSimilar}
        onAIQuery={onAIQuery}
      />
      {/* Header — fixed at top */}
      <ChatHeader
        chat={chat}
        group={group}
        isGroup={isGroup}
        isGroupAdmin={isGroupAdmin}
        isArchived={isArchived}
        communityHost={communityHost}
        name={name}
        avatarUrl={avatarUrl}
        description={description}
        memberCountText={memberCountText}
        dmPeerId={dmPeerId}
        lowDataMode={lowDataMode}
        resolvedPeerPresence={resolvedPeerPresence}
        communityContext={communityContext}
        visibleMessages={visibleMessages}
        onBack={onBack}
        isDropdownOpen={isDropdownOpen}
        setIsDropdownOpen={setIsDropdownOpen}
        questionFiltersOpen={questionFiltersOpen}
        setQuestionFiltersOpen={setQuestionFiltersOpen}
        questionVisibilityMode={questionVisibilityMode}
        setQuestionVisibilityMode={setQuestionVisibilityMode}
        starredOnly={starredOnly}
        setStarredOnly={setStarredOnly}
        starredIds={starredIds}
        setGalleryOpen={setGalleryOpen}
        setThreadSearchOpen={setThreadSearchOpen}
        setReportTarget={setReportTarget}
        chatMuted={chatMuted}
        muteBusy={muteBusy}
        muteUntilLabel={muteUntilLabel}
        muteDurationsOpen={muteDurationsOpen}
        setMuteDurationsOpen={setMuteDurationsOpen}
        handleMuteFor={handleMuteFor}
        handleUnmute={handleUnmute}
        onOpenQuestionModal={onOpenQuestionModal}
        onOpenTestConfigModal={onOpenTestConfigModal}
        onOpenStudyConfigModal={onOpenStudyConfigModal}
        onOpenGroupInfoModal={onOpenGroupInfoModal}
        onOpenCreateSubGroupModal={onOpenCreateSubGroupModal}
        onOpenAIGenerateModal={onOpenAIGenerateModal}
        onToggleArchiveGroup={onToggleArchiveGroup}
        onArchiveDmThread={onArchiveDmThread}
        onUnarchiveDmThread={onUnarchiveDmThread}
        onDeleteDmThread={onDeleteDmThread}
        handleToggleDmBlock={handleToggleDmBlock}
        iBlockedThem={iBlockedThem}
      />

      {/* A DM that the server says is a marketplace inquiry gets the Chat/Offers
          tabs, the listing strip, the sticky deal bar and the order bar wrapped
          around the SAME `chatPanelContent`. Any other conversation renders it
          bare. The deal bar is hidden once an order exists — the order bar owns
          those states — so the two can never offer contradictory actions. */}
      {chat.chatType === 'dm' && inquiry ? (
        <OffersPanel
          inquiry={inquiry}
          activeOffer={activeOffer}
          offerHistory={offerHistory}
          activeOrder={activeOrder}
          currentUser={currentUser}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          offerError={offerError}
          offerLoading={offerLoading}
          showCounterInput={showCounterInput}
          setShowCounterInput={setShowCounterInput}
          counterValue={counterValue}
          setCounterValue={setCounterValue}
          setShowMakeOfferModal={setShowMakeOfferModal}
          orderActionLoading={orderActionLoading}
          setOrderActionLoading={setOrderActionLoading}
          setActiveOrder={setActiveOrder}
          handleRespond={handleRespond}
          chatPanel={chatPanelContent}
        />
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