import React, { useEffect, useMemo, useRef, useState } from 'react';
import { confirmDialog } from '../stores/confirmStore';
import { useToastStore } from '../stores/toastStore';
import { Group, Message, User, DMThread, ChatItem, MarketplaceInquiry, MarketplaceOffer, MarketplaceOrder } from '../types';
import MessageItem from './MessageItem';
import MessageInputBar from './MessageInputBar';
import GroupListItem from './GroupListItem';
import { summarizeGroupChat } from '../services/ai';
import { useCompanionStore } from '../stores/companionStore';
import { Avatar, Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator, Tabs, TabList, Tab, TabPanel } from './ui';
import { resolveAvatarSrc } from '../utils/avatar';
import { normalizeStorageUrl } from '../utils/storageUrl';
import { useUIStore } from '../stores/uiStore';
import { resolveGroupChatSenderLabel } from '@lantern/shared/utils';
import {
  EllipsisVerticalIcon,
  UserGroupIcon,
  PencilSquareIcon,
  QuestionMarkCircleIcon,
  AcademicCapIcon,
  PlusCircleIcon,
  ArchiveBoxIcon,
  ChatBubbleLeftRightIcon,
  BookOpenIcon,
  ClipboardDocumentCheckIcon,
  SparklesIcon,
  ArrowLeftIcon,
  ChatBubbleOvalLeftEllipsisIcon,
  TrashIcon,
  UserCircleIcon,
  ShoppingBagIcon,
  CurrencyDollarIcon,
} from '@heroicons/react/24/outline';
import {
  getInquiryByThread,
  threadMayHaveMarketplaceInquiry,
  fetchOffers,
  respondToOffer,
  updateInquiryStatus,
  fetchOrderForInquiry,
  updateMarketplaceOrder,
  requestOrderPayment,
  supabase,
} from '../services/supabase';
import MakeOfferModal from './MakeOfferModal';
import { useBudgetHandlers } from '../hooks/useBudgetHandlers';


interface ChatWindowProps {
  chat: ChatItem | null;
  messages: Message[];
  currentUser: User;
  userVotes: Record<string, 'up' | 'down' | undefined>;
  onSendMessage: (text: string) => void;
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
  onLoadMoreMessages?: (groupId: string) => Promise<number>;
}

const ChatWindow: React.FC<ChatWindowProps> = ({
  chat, messages: messagesProp, currentUser, userVotes,
  onSendMessage, onOpenQuestionModal, onOpenGroupInfoModal,
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
  onDeleteDmThread,
  onArchiveDmThread,
  onUnarchiveDmThread,
  onLoadMoreMessages,
}) => {
  const messages = Array.isArray(messagesProp) ? messagesProp : [];
  const { lowDataMode } = useUIStore();
  const { refreshBudgetTransactions } = useBudgetHandlers();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const prevMessageCountRef = useRef(messages.length);
  const lastMessageIdRef = useRef<string | null>(null);

  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [typingUserIds, setTypingUserIds] = useState<string[]>([]);
  const typingTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [hasMore, setHasMore] = useState(true);
  const [isSummarizingChat, setIsSummarizingChat] = useState(false);
  const [awaitingMessages, setAwaitingMessages] = useState(false);

  // Reset loading/hasMore states when the chat changes
  useEffect(() => {
    setHasMore(true);
    setIsLoadingMore(false);
    if (chat) {
      setAwaitingMessages(true);
    }
  }, [chat?.id]);

  useEffect(() => {
    if (messages.length > 0) {
      setAwaitingMessages(false);
    }
  }, [messages.length, chat?.id]);

  useEffect(() => {
    if (!chat) return;
    const timer = window.setTimeout(() => setAwaitingMessages(false), 10_000);
    return () => window.clearTimeout(timer);
  }, [chat?.id]);

  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Typing indicators via Supabase broadcast
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

  const handleSummarizeGroup = async () => {
    if (!chat || chat.chatType !== 'group' || isSummarizingChat) return;
    const groupName = (chat as Group).name || 'Group';
    const msgTexts = messages
      .filter(m => !m.isArchived && (m.text || m.questionStem))
      .slice(-50)
      .map(m => m.text || m.questionStem || '');
    if (msgTexts.length === 0) { useToastStore.getState().showToast('No messages to summarize.', 'info'); return; }
    setIsSummarizingChat(true);
    try {
      const { summary } = await summarizeGroupChat(chat.id, groupName);
      if (!summary?.trim()) {
        throw new Error('Summary was empty. Please try again.');
      }
      // Inject as assistant message after history loads — do not re-send to the AI
      // (avoids a race with loadHistory wiping the panel and a second failed AI call).
      useCompanionStore.getState().openWithAssistantMessage(
        `Here's a summary of recent activity in #${groupName}:\n\n${summary.trim()}\n\nIs there anything specific from this you'd like help with?`
      );
      useToastStore.getState().showToast('Group chat summary ready in Lantern.', 'success');
    } catch (err: unknown) {
      const message = err instanceof Error && err.message
        ? err.message
        : 'Failed to summarize group chat. Please try again.';
      useToastStore.getState().showToast(message, 'error');
    } finally {
      setIsSummarizingChat(false);
    }
  };

  const handleScroll = async (e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    // Load more when scrolled to the top
    if (container.scrollTop === 0 && !isLoadingMore && hasMore && chat && chat.chatType === 'group') {
      setIsLoadingMore(true);
      const prevScrollHeight = container.scrollHeight;
      
      try {
        if (onLoadMoreMessages) {
          const count = await onLoadMoreMessages(chat.id);
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

  const loadOfferHistory = async (inquiryData: MarketplaceInquiry) => {
    try {
      const role = currentUser.id === inquiryData.buyer_id ? 'buyer' : 'seller';
      const offers = await fetchOffers(role);
      const filtered = offers.filter(
        (o: MarketplaceOffer) =>
          o.listing_id === inquiryData.listing_id &&
          (o.buyer_id === inquiryData.buyer_id || o.seller_id === inquiryData.seller_id)
      );
      // Sort by date created_at ascending
      filtered.sort(
        (a: MarketplaceOffer, b: MarketplaceOffer) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      setOfferHistory(filtered);

      // Set active offer (the latest pending or countered offer)
      const active = filtered.find(
        (o: MarketplaceOffer) => o.status === 'pending' || o.status === 'countered'
      );
      setActiveOffer(active || null);
    } catch (err) {
      console.error('Error loading offer history:', err);
    }
  };

  const handleRespond = async (action: 'accept' | 'decline' | 'counter' | 'withdraw', counterAmount?: number) => {
    if (!activeOffer || !inquiry) return;
    setOfferLoading(true);
    setOfferError('');
    try {
      await respondToOffer(activeOffer.id, action, counterAmount);
      
      // Send DM notification for visual history
      let dmContent = '';
      if (action === 'accept') {
        dmContent = `[Offer] I accepted your offer of ₦${activeOffer.amount.toLocaleString()}! An order has been created — arrange pickup in Orders.`;
      } else if (action === 'decline') {
        dmContent = `[Offer] I declined the offer of ₦${activeOffer.amount.toLocaleString()}.`;
      } else if (action === 'withdraw') {
        dmContent = `[Offer] I withdrew my offer of ₦${activeOffer.amount.toLocaleString()}.`;
      } else if (action === 'counter' && counterAmount) {
        dmContent = `[Offer] I countered your offer with a counter-offer of ₦${counterAmount.toLocaleString()}.`;
      }

      if (dmContent) {
        try {
          onSendMessage(dmContent);
        } catch (msgErr) {
          console.error('Failed to send status update message to chat:', msgErr);
        }
      }

      if (action === 'accept') {
        try {
          await updateInquiryStatus(inquiry.id, 'negotiating');
          const order = await fetchOrderForInquiry(inquiry.id);
          if (order) setActiveOrder(order);
          await refreshBudgetTransactions(currentUser.id);
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

  useEffect(() => {
    setActiveTab('chat');
    setInquiry(null);
    setActiveOffer(null);
    setOfferHistory([]);
    setShowCounterInput(false);
    setCounterValue('');
    setOfferError('');
    setActiveOrder(null);

    if (chat && chat.chatType === 'dm') {
      const dmTexts = messages.map((message) => message.text);
      if (!threadMayHaveMarketplaceInquiry(dmTexts)) {
        return;
      }

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
    }
  }, [chat?.id, chat?.chatType, messages]);


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

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Only auto-scroll when a new message is appended at the end, not when older messages are prepended
  useEffect(() => {
    const lastId = messages.length > 0 ? messages[messages.length - 1].id : null;
    if (lastId && lastId !== lastMessageIdRef.current) {
      scrollToBottom();
    }
    lastMessageIdRef.current = lastId;
    prevMessageCountRef.current = messages.length;
  }, [messages]);

  // Scroll to bottom on initial load / chat switch
  useEffect(() => {
    lastMessageIdRef.current = messages.length > 0 ? messages[messages.length - 1].id : null;
    prevMessageCountRef.current = messages.length;
    scrollToBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat?.id]);

  const isGroupChat = chat?.chatType === 'group';
  const visibleMessages = useMemo(
    () => messages.filter((msg) => !isGroupChat || !msg.isArchived),
    [messages, isGroupChat]
  );

  if (!chat) {
    // Desktop: show placeholder
    // Mobile: show inline group/DM list for navigation
    const activeDmThreads = dmThreads.filter(t => !t.isArchived);
    const archivedDmThreads = dmThreads.filter(t => t.isArchived);
    const totalArchived = archivedTopLevelGroups.length + archivedDmThreads.length;

    return (
      <div className="flex-1 flex flex-col bg-lantern-background">
        {/* Desktop placeholder */}
        <div className="hidden md:flex flex-1 flex-col items-center justify-center p-8 text-center">
          <div className="w-20 h-20 rounded-2xl bg-lantern-primary-background flex items-center justify-center mb-6">
            <ChatBubbleLeftRightIcon className="w-10 h-10 text-lantern-primary" />
          </div>
          <h2 className="text-xl font-bold text-lantern-text mb-2">Welcome to Lantern Study!</h2>
          <p className="text-lantern-text-secondary max-w-sm">
            Select a conversation from the sidebar to start collaborating, or create a new group.
          </p>
        </div>

        {/* Mobile group list */}
        <div className="md:hidden flex-1 flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-lantern-surface border-b border-lantern-border">
            <h1 className="text-lg font-bold text-lantern-text">Chats</h1>
            <div className="flex items-center gap-2">
              {onOpenNewDmModal && (
                <button onClick={onOpenNewDmModal} className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-lantern-text-secondary hover:text-lantern-primary rounded-lantern hover:bg-lantern-background-secondary" title="New message">
                  <ChatBubbleOvalLeftEllipsisIcon className="w-5 h-5" />
                </button>
              )}
              {onCreateGroup && (
                <button onClick={onCreateGroup} className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-lantern-text-secondary hover:text-lantern-primary rounded-lantern hover:bg-lantern-background-secondary" title="New group">
                  <PlusCircleIcon className="w-5 h-5" />
                </button>
              )}
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {activeTopLevelGroups.length === 0 && activeDmThreads.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                <div className="w-16 h-16 rounded-2xl bg-lantern-primary-background flex items-center justify-center mb-4">
                  <UserGroupIcon className="w-8 h-8 text-lantern-primary" />
                </div>
                <h3 className="text-base font-semibold text-lantern-text mb-1">No conversations yet</h3>
                <p className="text-sm text-lantern-text-secondary mb-4">Create a group or start a direct message to begin.</p>
                {onCreateGroup && (
                  <button onClick={onCreateGroup} className="px-4 py-2 min-h-[44px] bg-lantern-primary text-white rounded-lantern text-sm font-medium hover:bg-lantern-primary-dark transition-colors">
                    Create Group
                  </button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-lantern-border">
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

  const isGroup = isGroupChat;
  const groupMemberList = isGroup
    ? (groups.find((g) => g.id === chat.id)?.members ?? chat.members ?? [])
    : [];
  const group = isGroup ? { ...chat, members: groupMemberList } : null;
  const isGroupAdmin = Boolean(
    isGroup &&
      group &&
      Array.isArray((group as Group).adminIds) &&
      (group as Group).adminIds.includes(currentUser.id)
  );

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
  const memberCountText = memberList.length
    ? `${memberList.length} member${memberList.length === 1 ? '' : 's'}` +
      (memberEmailList.length > memberList.length
        ? ` (+${memberEmailList.length - memberList.length} invited)`
        : '')
    : '';

  const description = isGroup ? group.description || memberCountText : 'Direct Message';
  const isArchived = isGroup ? group.isArchived : (chat as any).isArchived;

  const handleDropdownAction = (action: () => void) => {
    action();
    setIsDropdownOpen(false);
  };

  const questionCount = visibleMessages.filter(m => m.questionType).length;

  const chatPanelContent = (
    <>
      <div ref={messagesContainerRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 py-4 space-y-3">
        {isLoadingMore && (
          <div className="flex justify-center py-2" aria-live="polite">
            <div className="w-5 h-5 border-2 border-lantern-primary/30 border-t-lantern-primary rounded-full animate-spin" />
            <span className="sr-only">Loading older messages</span>
          </div>
        )}
        {visibleMessages.map((msg, idx) => {
          const msgDate = new Date(msg.timestamp);
          const prevMsg = idx > 0 ? visibleMessages[idx - 1] : null;
          const prevDate = prevMsg ? new Date(prevMsg.timestamp) : null;
          const showDateSeparator = !prevDate
            || msgDate.toDateString() !== prevDate.toDateString();
          const isGroupedWithPrevious =
            !!prevMsg &&
            !showDateSeparator &&
            prevMsg.sender?.id === msg.sender?.id &&
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
              <MessageItem
                message={msg}
                isCurrentUserMessage={msg.sender?.id === currentUser.id}
                currentUserVote={userVotes[msg.id]}
                onVoteQuestion={onVoteQuestion}
                onFlagAsSimilar={(messageId) => onFlagAsSimilar(messageId, chat.id)}
                currentUserFlagged={msg.flaggedAsSimilarUserIds?.includes(currentUser.id)}
                group={group}
                currentUser={currentUser}
                isGroupedWithPrevious={isGroupedWithPrevious}
              />
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
                  <ChatBubbleLeftRightIcon className="w-8 h-8 text-lantern-text-tertiary" />
                </div>
                <h3 className="text-base font-semibold text-lantern-text mb-1">
                  {isArchived ? 'This group is archived' : 'No messages yet'}
                </h3>
                <p className="text-sm text-lantern-text-secondary max-w-xs">
                  {isArchived
                    ? 'Unarchive the group to resume the conversation.'
                    : `Be the first to send a message in ${name}!`}
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {isArchived ? (
        <div className="flex items-center justify-center gap-3 p-4 pb-20 md:pb-4 bg-amber-50 dark:bg-amber-900/20 border-t border-amber-200 dark:border-amber-800/40 flex-shrink-0">
          <ArchiveBoxIcon className="w-4 h-4 text-amber-600 dark:text-amber-400" />
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
      ) : (
        <div className="flex-shrink-0 pb-16 md:pb-0 bg-lantern-surface relative z-20 border-t border-lantern-border">
          {typingLabels.length > 0 && (
            <p className="px-4 py-1 text-xs text-lantern-text-tertiary" aria-live="polite">
              {typingLabels.length === 1
                ? `${typingLabels[0]} is typing…`
                : `${typingLabels.slice(0, 2).join(' and ')} are typing…`}
            </p>
          )}
          <MessageInputBar
            onSendMessage={onSendMessage}
            onOpenQuestionModal={isGroup ? onOpenQuestionModal : undefined}
            onAIQuery={isGroup ? onAIQuery : undefined}
            onTyping={broadcastTyping}
          />
        </div>
      )}
    </>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-lantern-background">
      {/* Header — fixed at top */}
      <div className="flex-shrink-0 z-20 relative">
        <div className="flex items-center justify-between h-16 px-4 md:px-6 bg-lantern-surface/90 backdrop-blur-md border-b border-lantern-border">
          <div className="flex items-center min-w-0 gap-3">
            {/* Mobile back button */}
            {onBack && (
              <button type="button" onClick={onBack} className="md:hidden p-1.5 -ml-1 mr-1 text-lantern-text-secondary hover:text-lantern-text rounded-lantern hover:bg-lantern-background-secondary relative z-20" aria-label="Back to chats">
                <ArrowLeftIcon className="w-5 h-5" />
              </button>
            )}
            <div className="relative flex-shrink-0">
              <Avatar
                name={name}
                src={resolveAvatarSrc(avatarUrl, lowDataMode)}
                size="md"
                localOnly={lowDataMode}
                className="ring-2 ring-white dark:ring-lantern-border"
              />
              {isGroup && !isArchived && (
                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-400 border-2 border-white dark:border-lantern-border rounded-full" aria-label="Active group" />
              )}
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold truncate text-lantern-text" title={name}>{name}</h2>
              <p className="text-xs text-lantern-text-secondary truncate" title={description}>
                {isArchived ? <span className="font-semibold text-amber-600 dark:text-amber-400">Archived</span> : description}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {/* Quick-action toolbar for groups (visible on md+) */}
            {isGroup && group && !isArchived && (
              <div className="flex items-center gap-1 mr-2">
                <button
                  onClick={onOpenQuestionModal}
                  data-tip-id="chat.question"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-lantern-text-secondary bg-lantern-background-secondary hover:bg-lantern-primary-background hover:text-lantern-primary rounded-lantern transition-colors duration-200"
                  aria-label="Submit question"
                  title="Submit Question"
                >
                  <PencilSquareIcon className="w-4 h-4" />
                  <span className="hidden lg:inline">Question</span>
                </button>
                <button
                  onClick={onOpenTestConfigModal}
                  data-tip-id="chat.test"
                  className="hidden md:flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-lantern-text-secondary bg-lantern-background-secondary hover:bg-lantern-primary-background hover:text-lantern-primary rounded-lantern transition-colors duration-200"
                  aria-label="Take a test"
                  title="Take a Test"
                >
                  <ClipboardDocumentCheckIcon className="w-4 h-4" />
                  <span className="hidden lg:inline">Test</span>
                </button>
                <button
                  onClick={onOpenStudyConfigModal}
                  data-tip-id="chat.study"
                  className="hidden md:flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-lantern-text-secondary bg-lantern-background-secondary hover:bg-lantern-primary-background hover:text-lantern-primary rounded-lantern transition-colors duration-200"
                  aria-label="Study mode"
                  title="Study Mode"
                >
                  <BookOpenIcon className="w-4 h-4" />
                  <span className="hidden lg:inline">Study</span>
                </button>
                <button
                  onClick={handleSummarizeGroup}
                  disabled={isSummarizingChat}
                  data-tip-id="chat.summarize"
                  className="hidden md:flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-lantern-text-secondary bg-lantern-background-secondary hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-900/30 dark:hover:text-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-lantern transition-colors duration-200"
                  aria-label="Summarize group chat with AI"
                  title="AI Summary"
                >
                  <SparklesIcon className="w-4 h-4" />
                  <span className="hidden lg:inline">{isSummarizingChat ? 'Summarizing…' : 'Summarize'}</span>
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
                <EllipsisVerticalIcon className="w-5 h-5" />
              </MenuTrigger>
              {isGroup && group && (
                <MenuContent align="end" className="w-56">
                  <MenuItem onSelect={() => handleDropdownAction(onOpenGroupInfoModal)} icon={<UserGroupIcon className="w-4 h-4 text-lantern-text-tertiary" />}>
                    Group Info & Members
                  </MenuItem>
                  {isArchived ? (
                    <MenuItem
                      onSelect={() => handleDropdownAction(() => onToggleArchiveGroup(group.id))}
                      icon={<ArchiveBoxIcon className="w-4 h-4" />}
                      className="text-amber-700 dark:text-amber-400"
                    >
                      Unarchive Group
                    </MenuItem>
                  ) : (
                    <>
                      <MenuItem
                        onSelect={() => handleDropdownAction(() => onOpenCreateSubGroupModal(group.id))}
                        icon={<PlusCircleIcon className="w-4 h-4 text-lantern-text-tertiary" />}
                      >
                        Create Sub-group
                      </MenuItem>
                      <MenuSeparator />
                      <div className="md:hidden">
                        <MenuItem onSelect={() => handleDropdownAction(onOpenQuestionModal)} icon={<PencilSquareIcon className="w-4 h-4 text-lantern-text-tertiary" />}>
                          Submit New Question
                        </MenuItem>
                        <MenuItem onSelect={() => handleDropdownAction(onOpenTestConfigModal)} icon={<QuestionMarkCircleIcon className="w-4 h-4 text-lantern-text-tertiary" />}>
                          Take a Test
                        </MenuItem>
                        <MenuItem onSelect={() => handleDropdownAction(onOpenStudyConfigModal)} icon={<AcademicCapIcon className="w-4 h-4 text-lantern-text-tertiary" />}>
                          Study Mode
                        </MenuItem>
                      </div>
                      {onOpenAIGenerateModal && isGroupAdmin && (
                        <MenuItem
                          onSelect={() => handleDropdownAction(onOpenAIGenerateModal)}
                          icon={<SparklesIcon className="w-4 h-4" />}
                          className="text-lantern-primary"
                        >
                          AI Generate Questions
                        </MenuItem>
                      )}
                      <MenuItem
                        onSelect={() => handleDropdownAction(handleSummarizeGroup)}
                        icon={<SparklesIcon className="w-4 h-4" />}
                        className="text-lantern-primary"
                      >
                        {isSummarizingChat ? 'Summarizing…' : 'Summarize Group Chat'}
                      </MenuItem>
                      <MenuSeparator />
                      <MenuItem
                        onSelect={() => handleDropdownAction(() => onToggleArchiveGroup(group.id))}
                        icon={<ArchiveBoxIcon className="w-4 h-4" />}
                        className="text-amber-600 dark:text-amber-400"
                      >
                        Archive Group
                      </MenuItem>
                    </>
                  )}
                </MenuContent>
              )}
              {!isGroup && chat && (
                <MenuContent align="end" className="w-56">
                  {(chat as any).isArchived ? (
                    <MenuItem
                      onSelect={() => {
                        setIsDropdownOpen(false);
                        onUnarchiveDmThread?.(chat.id);
                      }}
                      icon={<ArchiveBoxIcon className="w-4 h-4" />}
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
                      icon={<ArchiveBoxIcon className="w-4 h-4" />}
                      className="text-amber-600 dark:text-amber-400"
                    >
                      Archive Conversation
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
                      icon={<TrashIcon className="w-4 h-4" />}
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
        {isGroup && !isArchived && (
          <div className="flex items-center gap-4 px-4 md:px-6 py-2 bg-lantern-background-secondary/80 dark:bg-lantern-surface-secondary/50 border-b border-lantern-border/60 dark:border-lantern-border/60 text-xs text-lantern-text-secondary">
            <span className="flex items-center gap-1">
              <UserGroupIcon className="w-3.5 h-3.5" />
              {memberCountText || 'Group'}
            </span>
            <span className="flex items-center gap-1">
              <ChatBubbleLeftRightIcon className="w-3.5 h-3.5" />
              {visibleMessages.length} message{visibleMessages.length !== 1 ? 's' : ''}
            </span>
            {questionCount > 0 && (
              <span className="flex items-center gap-1">
                <QuestionMarkCircleIcon className="w-3.5 h-3.5" />
                {questionCount} question{questionCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        )}
      </div>

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
                  <ShoppingBagIcon className="w-6 h-6 text-lantern-text-tertiary" />
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
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${
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

          {activeOrder && activeOrder.status !== 'completed' && activeOrder.status !== 'cancelled' && (
            <div className="flex-shrink-0 px-4 py-2 bg-lantern-primary-background dark:bg-lantern-primary-background border-b border-lantern-primary/20 dark:border-lantern-primary/30 flex flex-wrap gap-2 items-center">
              <span className="text-xs font-medium text-lantern-primary-dark dark:text-lantern-primary-light">
                Order: {activeOrder.status.replace(/_/g, ' ')} · ₦{Number(activeOrder.amount).toLocaleString()}
              </span>
              {currentUser.id === inquiry.seller_id && ['paid', 'pending_payment'].includes(activeOrder.status) && (
                <>
                  <button
                    type="button"
                    disabled={orderActionLoading}
                    className="text-xs px-2 py-1 rounded-md bg-lantern-primary text-white"
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
                  <button
                    type="button"
                    disabled={orderActionLoading}
                    className="text-xs px-2 py-1 rounded-md border border-lantern-primary text-lantern-primary"
                    onClick={async () => {
                      setOrderActionLoading(true);
                      try {
                        await requestOrderPayment(activeOrder.id);
                        useToastStore.getState().showToast('Payment request sent', 'success');
                      } catch (e: any) { useToastStore.getState().showToast(e.message || 'Something went wrong', 'error'); }
                      finally { setOrderActionLoading(false); }
                    }}
                  >
                    Request payment
                  </button>
                </>
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
                  <ShoppingBagIcon className="w-10 h-10 text-lantern-text-tertiary" />
                </div>
              )}
              <div className="flex-1 flex flex-col justify-between min-w-0">
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-base font-bold text-lantern-text line-clamp-2">
                      {inquiry.listing?.title}
                    </h3>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase flex-shrink-0 ${
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
                <CurrencyDollarIcon className="w-5 h-5 text-emerald-500" />
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

                  {/* Action Controls */}
                  <div className="pt-2">
                    {offerError && <p className="text-xs text-red-500 mb-3 font-semibold">{offerError}</p>}
                    
                    {currentUser.id === activeOffer.buyer_id ? (
                      // Buyer controls
                      <div className="flex flex-wrap gap-2">
                        {activeOffer.status === 'pending' && (
                          <button
                            disabled={offerLoading}
                            onClick={() => handleRespond('withdraw')}
                            className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-lantern-border text-white text-xs font-bold rounded-xl transition-colors shadow-sm"
                          >
                            {offerLoading ? 'Withdrawing...' : 'Withdraw Offer'}
                          </button>
                        )}
                        {activeOffer.status === 'countered' && (
                          <>
                            <button
                              disabled={offerLoading}
                              onClick={() => handleRespond('accept')}
                              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-lantern-border text-white text-xs font-bold rounded-xl transition-colors shadow-sm"
                            >
                              Accept Counter
                            </button>
                            <button
                              disabled={offerLoading}
                              onClick={() => handleRespond('decline')}
                              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-lantern-border text-white text-xs font-bold rounded-xl transition-colors shadow-sm"
                            >
                              Decline Counter
                            </button>
                          </>
                        )}
                      </div>
                    ) : (
                      // Seller controls
                      <div className="flex flex-col gap-3">
                        {activeOffer.status === 'pending' && !showCounterInput && (
                          <div className="flex flex-wrap gap-2">
                            <button
                              disabled={offerLoading}
                              onClick={() => handleRespond('accept')}
                              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-lantern-border text-white text-xs font-bold rounded-xl transition-colors shadow-sm"
                            >
                              Accept Offer
                            </button>
                            <button
                              disabled={offerLoading}
                              onClick={() => handleRespond('decline')}
                              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-lantern-border text-white text-xs font-bold rounded-xl transition-colors shadow-sm"
                            >
                              Decline Offer
                            </button>
                            <button
                              disabled={offerLoading}
                              onClick={() => { setShowCounterInput(true); setCounterValue(''); }}
                              className="px-4 py-2 bg-lantern-primary hover:bg-lantern-primary-dark disabled:bg-lantern-border text-white text-xs font-bold rounded-xl transition-colors shadow-sm"
                            >
                              Counter Offer
                            </button>
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
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center py-6 text-center">
                  <p className="text-sm text-lantern-text-secondary mb-4 font-medium">
                    There are no active offers in negotiation.
                  </p>
                  {currentUser.id === inquiry.buyer_id && (
                    <button
                      onClick={() => setShowMakeOfferModal(true)}
                      className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition-colors shadow-sm flex items-center gap-1.5"
                    >
                      <CurrencyDollarIcon className="w-4 h-4" />
                      Make an Offer
                    </button>
                  )}
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
                            <span className="text-[10px] text-lantern-text-tertiary font-medium">
                              {new Date(offer.created_at).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-xs text-lantern-text-secondary mt-1">
                            {offer.buyer_id === currentUser.id ? 'You' : 'Buyer'} offered ₦{offer.amount.toLocaleString()} ({offer.status})
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
              try {
                onSendMessage(`[Offer] I submitted a new offer of ₦${amount.toLocaleString()}!`);
              } catch (msgErr) {
                console.error('Failed to send status update message to chat:', msgErr);
              }
            }
            loadOfferHistory(inquiry);
          }}
        />
      )}

    </div>
  );
};

export default ChatWindow;