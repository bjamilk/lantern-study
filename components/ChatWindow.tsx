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
 *  - services/supabase: threads (`fetchGroupThread` / `fetchDmThread`) and
 *    presence (`fetchUserProfile`). The marketplace set moved with the Offers
 *    tab (`hooks/chat/useMarketplaceOffers.ts`), the DM request/block/mute set
 *    with `hooks/chat/useDmRelationship.ts`.
 *  - supabase realtime BROADCAST channels, through `hooks/chat/useChatRealtime.ts`.
 *  - stores: `uiStore.lowDataMode`, `communityStore.myCommunities`, `toastStore`,
 *    `useBudgetHandlers`.
 *  - `hooks/chat/useMessageActions.ts` for reactions, stars, pins and copy —
 *    which is where the reaction endpoints and the device-local localStorage
 *    marks now live.
 *
 * What this file still owns, after lanes M8 and M8b: the props, the thread
 * panel's fetch and focus, the composer/thread reset, and the wiring that hands
 * every other concern to a module. The map:
 *
 *   components/chat/ChatHeader.tsx        the header bar
 *   components/chat/ChatHeaderMenu.tsx    its overflow menu
 *   components/chat/MessageList.tsx       the scrolling list
 *   components/chat/MessageRow.tsx        one row of it
 *   components/chat/ConversationPane.tsx  the banners and the composer slot
 *   components/chat/ThreadPanel.tsx       the thread side panel
 *   components/chat/ChatHomeScreen.tsx    the `chat === null` screen
 *   components/chat/OffersPanel.tsx       the marketplace Offers tab
 *   hooks/chat/useChatComposer.ts         reply / edit / mention state
 *   hooks/chat/useMessageActions.ts       reactions, stars, pins, copy
 *   hooks/chat/useChatScroll.ts           anchor, auto-scroll, paging
 *   hooks/chat/useChatRealtime.ts         typing and read broadcasts
 *   hooks/chat/useDmRelationship.ts       request, block, mute
 *   hooks/chat/useMarketplaceOffers.ts    inquiry, offers, order
 *
 * Gotchas:
 *  - EVERY hook must stay above the `if (!chat)` early return. Opening a chat from the
 *    empty state otherwise changes the hook count (React error #310).
 *  - The hook CALL ORDER here is load-bearing, and three of the hooks argue for
 *    their own position in their banners. `useChatScroll` in particular must be
 *    called after the chat-reset effect below, never before it.
 *  - Colours are `lantern-*` tokens plus Tailwind palette steps with explicit `dark:`
 *    pairs; there is no JS theme branch here and none should be added.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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
import { OffersPanel } from './chat/OffersPanel';
import { ThreadPanel } from './chat/ThreadPanel';
import { ChatHomeScreen } from './chat/ChatHomeScreen';
import { ConversationPane } from './chat/ConversationPane';
import { useMarketplaceOffers } from '../hooks/chat/useMarketplaceOffers';
import { useChatScroll } from '../hooks/chat/useChatScroll';
import { useChatRealtime } from '../hooks/chat/useChatRealtime';
import { useDmRelationship } from '../hooks/chat/useDmRelationship';
import { useGroupStore } from '../stores/groupStore';
import { useCommunityStore } from '../stores/communityStore';
import { fetchMyInquiries, fetchUserProfile } from '../services/supabase';
import { useToastStore } from '../stores/toastStore';
import { Group, Message, User, DMThread, ChatItem } from '../types';
import ReportContentModal from './moderation/ReportContentModal';
import type { ContentReportTargetType } from '@lantern/shared';
import { type SendMessageOptions } from './MessageInputBar';
import { useUIStore } from '../stores/uiStore';
import { resolveGroupChatSenderLabel } from '@lantern/shared/utils';
import { isCommunityBoard } from '@lantern/shared/network';
import { supabase, fetchGroupThread, fetchDmThread } from '../services/supabase';
import MakeOfferModal from './MakeOfferModal';
import { useBudgetHandlers } from '../hooks/useBudgetHandlers';
import {
  mapMessagesFromApi,
  type QuestionVisibilityMode,
} from '@lantern/shared/utils';
import { useQuestionVisibilityMode } from '../hooks/useQuestionVisibilityMode';


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
  // --- Conversation view state. All of it is per-chat and reset by the
  // `chat?.id` effect below; none of it is persisted except starred/pinned,
  // which are device-local localStorage marks.
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
  // Declared here, above the chat-reset effect, because `useChatScroll` below
  // takes it — and that hook has to be called AFTER the reset effect, never
  // before it. Moving a pure `useMemo` earlier changes no behaviour: every one
  // of its inputs is already declared above this point.

  // Reset composer and thread state when the chat changes. The scroll half of
  // this effect moved to `hooks/chat/useChatScroll.ts`, which registers its own
  // `chat?.id` effect directly after this one — see that file's banner.
  // Driven by `chat?.id` alone — a re-render of the same conversation must not
  // clear a reply draft, close an open thread or re-arm the scroll anchor.
  useEffect(() => {
    setReplyTo(null);
    setEditingMessage(null);
    setThreadRootId(null);
    setThreadMessages([]);
    setThreadReplyTo(null);
    setThreadEditingMessage(null);
    messageNodeRefs.current = {};
  }, [chat?.id]);

  /**
   * The conversation's scroll position: the unread anchor, auto-scroll, the
   * "N new messages" pill and older-history paging. Called directly after the
   * reset effect above, which is the placement its banner argues for.
   */
  const {
    messagesEndRef,
    messagesContainerRef,
    firstUnreadRef,
    isLoadingMore,
    awaitingMessages,
    newMessagesBelow,
    firstUnreadId,
    scrollToBottom,
    handleScroll,
  } = useChatScroll({
    chat,
    currentUserId: currentUser.id,
    messagesLength: messages.length,
    visibleMessages,
    unreadAnchorAt,
    onLoadMoreMessages,
    onLoadMoreDirectMessages,
  });

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

  /**
   * Typing and read-receipt broadcasts. Called exactly where `typingChannelRef`
   * was declared, so both of its effects keep their position in the effect
   * order; `typingUserIds` and its timeout map moved down here with them.
   */
  const { typingUserIds, broadcastTyping } = useChatRealtime({
    chatId: chat?.id,
    currentUserId: currentUser.id,
    lowDataMode,
    onPeerChatRead,
  });

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

  /**
   * Request / block / mute: the three server-backed facts about the other side
   * of this conversation, and the five actions that change them. Called exactly
   * where `dmThreadForHooks` used to be declared, so its three effects keep
   * their position in the shell's effect order.
   */
  const {
    dmThread,
    dmPeerId,
    dmRequestStatus,
    dmRequestBusy,
    dmBlocked,
    iBlockedThem,
    dmBlockBusy,
    chatMuted,
    muteBusy,
    muteUntilLabel,
    handleMuteFor,
    handleUnmute,
    handleAcceptDmRequest,
    handleDeclineDmRequest,
    handleToggleDmBlock,
  } = useDmRelationship({ chat, currentUser, isGroup, onDmThreadStatusChange });
  const scrollToMessageId = (messageId: string) => {
    messageNodeRefs.current[messageId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const galleryItems = useMemo(() => collectChatGalleryItems(messages), [messages]);
  const pinnedMessage = pinnedMessageId ? messages.find((m) => m.id === pinnedMessageId) : undefined;

  // No conversation selected. NOTHING below this line may call a hook — see the
  // file header (React #310). Desktop gets the chat-home pane; small screens get
  // the full conversation list, since there is no sidebar there to hold it.
  if (!chat) {
    return (
      <ChatHomeScreen
        currentUser={currentUser}
        groups={groups}
        dmThreads={dmThreads}
        communities={chatHomeCommunities || myCommunities}
        inquiries={buyerInquiries}
        expandedParentGroups={expandedParentGroups}
        setExpandedParentGroups={setExpandedParentGroups}
        onSelectChat={onSelectChat}
        onCreateGroup={onCreateGroup}
        onOpenNewDmModal={onOpenNewDmModal}
        onOpenLounge={onOpenLounge}
        onOpenInquiries={onOpenInquiries}
      />
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


  // The conversation itself, built here and rendered either bare or inside the
  // marketplace Tabs without duplicating the list, composer and all of their
  // handlers. The list stays in the shell, which owns its twenty-odd props;
  // `ConversationPane` wraps it with the banners and the composer slot.
  const messageList = (
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
  );

  const chatPanelContent = (
    <ConversationPane
      chat={chat}
      isGroup={isGroup}
      isArchived={isArchived}
      communityHost={communityHost}
      group={group}
      messageList={messageList}
      visibleMessagesCount={visibleMessages.length}
      threadSearchOpen={threadSearchOpen}
      threadSearch={threadSearch}
      setThreadSearch={setThreadSearch}
      setThreadSearchOpen={setThreadSearchOpen}
      starredOnly={starredOnly}
      setStarredOnly={setStarredOnly}
      pinnedMessage={pinnedMessage}
      scrollToMessageId={scrollToMessageId}
      onToggleArchiveGroup={onToggleArchiveGroup}
      dmBlocked={dmBlocked}
      iBlockedThem={iBlockedThem}
      dmBlockBusy={dmBlockBusy}
      handleToggleDmBlock={() => handleToggleDmBlock(name)}
      isDmRequestRecipient={isDmRequestRecipient}
      isDmRequestSender={isDmRequestSender}
      isDmRequestDeclinedForRecipient={isDmRequestDeclinedForRecipient}
      dmRequestBusy={dmRequestBusy}
      handleAcceptDmRequest={handleAcceptDmRequest}
      handleDeclineDmRequest={handleDeclineDmRequest}
      typingLabels={typingLabels}
      handleComposerSend={handleComposerSend}
      onOpenQuestionModal={onOpenQuestionModal}
      onAIQuery={onAIQuery}
      broadcastTyping={broadcastTyping}
      mentionCandidates={mentionCandidates}
      seedMentionUsername={seedMentionUsername}
      setSeedMentionUsername={setSeedMentionUsername}
      replyTo={replyTo}
      setReplyTo={setReplyTo}
      editingMessage={editingMessage}
      setEditingMessage={setEditingMessage}
    />
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
        handleToggleDmBlock={() => handleToggleDmBlock(name)}
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