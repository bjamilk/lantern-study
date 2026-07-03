import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Group, Message, User, DMThread, ChatItem, MarketplaceInquiry, MarketplaceOffer, MarketplaceOrder } from '../types';
import MessageItem from './MessageItem';
import MessageInputBar from './MessageInputBar';
import GroupListItem from './GroupListItem';
import { summarizeGroupChat } from '../services/ai';
import { Avatar } from './ui';
import { resolveAvatarSrc } from '../utils/avatar';
import { normalizeStorageUrl } from '../utils/storageUrl';
import { useUIStore } from '../stores/uiStore';
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
  fetchOffers,
  respondToOffer,
  updateInquiryStatus,
  fetchOrderForInquiry,
  updateMarketplaceOrder,
  requestOrderPayment,
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
  const dropdownRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(messages.length);

  const [isLoadingMore, setIsLoadingMore] = useState(false);
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

  const handleSummarizeGroup = async () => {
    if (!chat || chat.chatType !== 'group' || isSummarizingChat) return;
    const groupName = (chat as Group).name || 'Group';
    const msgTexts = messages
      .filter(m => !m.isArchived && (m.text || m.questionStem))
      .slice(-50)
      .map(m => m.text || m.questionStem || '');
    if (msgTexts.length === 0) { alert('No messages to summarize.'); return; }
    setIsSummarizingChat(true);
    try {
      const { summary } = await summarizeGroupChat(msgTexts, groupName);
      const companion = useCompanionStore.getState();
      companion.open();
      await companion.sendMessage(`Here's a summary of recent activity in #${groupName}:\n\n${summary}\n\nIs there anything specific from this you'd like help with?`);
    } catch {
      alert('Failed to summarize group chat. Please try again.');
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
      const loadInquiryContext = async () => {
        try {
          const inquiryData = await getInquiryByThread(chat.id);
          if (inquiryData) {
            setInquiry(inquiryData);
            await loadOfferHistory(inquiryData);
            const order = await fetchOrderForInquiry(inquiryData.id);
            if (order) setActiveOrder(order);
          }
        } catch (err) {
          console.error('Error loading inquiry context:', err);
        }
      };
      loadInquiryContext();
    }
  }, [chat?.id]);


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

  // Only auto-scroll when new messages are added, not on vote/status updates
  useEffect(() => {
    if (messages.length !== prevMessageCountRef.current) {
      scrollToBottom();
      prevMessageCountRef.current = messages.length;
    }
  }, [messages]);

  // Scroll to bottom on initial load / chat switch
  useEffect(() => {
    prevMessageCountRef.current = messages.length;
    scrollToBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat?.id]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!chat) {
    // Desktop: show placeholder
    // Mobile: show inline group/DM list for navigation
    const activeDmThreads = dmThreads.filter(t => !t.isArchived);
    const archivedDmThreads = dmThreads.filter(t => t.isArchived);
    const totalArchived = archivedTopLevelGroups.length + archivedDmThreads.length;

    return (
      <div className="flex-1 flex flex-col bg-gradient-to-br from-slate-50 to-indigo-50/30 dark:from-slate-900 dark:to-indigo-950/20">
        {/* Desktop placeholder */}
        <div className="hidden md:flex flex-1 flex-col items-center justify-center p-8 text-center">
          <div className="w-20 h-20 rounded-2xl bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center mb-6">
            <ChatBubbleLeftRightIcon className="w-10 h-10 text-indigo-500" />
          </div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-200 mb-2">Welcome to Lantern Study!</h2>
          <p className="text-slate-500 dark:text-slate-400 max-w-sm">
            Select a conversation from the sidebar to start collaborating, or create a new group.
          </p>
        </div>

        {/* Mobile group list */}
        <div className="md:hidden flex-1 flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
            <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">Chats</h1>
            <div className="flex items-center gap-2">
              {onOpenNewDmModal && (
                <button onClick={onOpenNewDmModal} className="p-2 text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700" title="New message">
                  <ChatBubbleOvalLeftEllipsisIcon className="w-5 h-5" />
                </button>
              )}
              {onCreateGroup && (
                <button onClick={onCreateGroup} className="p-2 text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700" title="New group">
                  <PlusCircleIcon className="w-5 h-5" />
                </button>
              )}
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {activeTopLevelGroups.length === 0 && activeDmThreads.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                <div className="w-16 h-16 rounded-2xl bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center mb-4">
                  <UserGroupIcon className="w-8 h-8 text-indigo-500" />
                </div>
                <h3 className="text-base font-semibold text-slate-700 dark:text-slate-300 mb-1">No conversations yet</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Create a group or start a direct message to begin.</p>
                {onCreateGroup && (
                  <button onClick={onCreateGroup} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors">
                    Create Group
                  </button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
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
                    <div className="px-4 py-2 text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider bg-slate-50 dark:bg-slate-900">
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

  const isGroup = chat.chatType === 'group';
  const group = isGroup ? chat : null;

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

  const visibleMessages = messages.filter(msg => isGroup ? !msg.isArchived : true);
  const questionCount = visibleMessages.filter(m => m.questionType).length;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-slate-50 dark:bg-slate-900">
      {/* Header — fixed at top */}
      <div className="flex-shrink-0 z-20 relative">
        <div className="flex items-center justify-between h-16 px-4 md:px-6 bg-white/90 dark:bg-slate-800/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center min-w-0 gap-3">
            {/* Mobile back button */}
            {onBack && (
              <button type="button" onClick={onBack} className="md:hidden p-1.5 -ml-1 mr-1 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 relative z-20" aria-label="Back to chats">
                <ArrowLeftIcon className="w-5 h-5" />
              </button>
            )}
            <div className="relative flex-shrink-0">
              <Avatar
                name={name}
                src={resolveAvatarSrc(avatarUrl, lowDataMode)}
                size="md"
                localOnly={lowDataMode}
                className="ring-2 ring-white dark:ring-slate-700"
              />
              {isGroup && !isArchived && (
                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-400 border-2 border-white dark:border-slate-800 rounded-full" aria-label="Active group" />
              )}
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold truncate text-slate-900 dark:text-slate-100" title={name}>{name}</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate" title={description}>
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
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-900/30 dark:hover:text-indigo-400 rounded-lg transition-colors duration-150"
                  aria-label="Submit question"
                  title="Submit Question"
                >
                  <PencilSquareIcon className="w-4 h-4" />
                  <span className="hidden lg:inline">Question</span>
                </button>
                <button
                  onClick={onOpenTestConfigModal}
                  className="hidden md:flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-900/30 dark:hover:text-indigo-400 rounded-lg transition-colors duration-150"
                  aria-label="Take a test"
                  title="Take a Test"
                >
                  <ClipboardDocumentCheckIcon className="w-4 h-4" />
                  <span className="hidden lg:inline">Test</span>
                </button>
                <button
                  onClick={onOpenStudyConfigModal}
                  className="hidden md:flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-900/30 dark:hover:text-indigo-400 rounded-lg transition-colors duration-150"
                  aria-label="Study mode"
                  title="Study Mode"
                >
                  <BookOpenIcon className="w-4 h-4" />
                  <span className="hidden lg:inline">Study</span>
                </button>
                <button
                  onClick={handleSummarizeGroup}
                  disabled={isSummarizingChat}
                  className="hidden md:flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-purple-50 hover:text-purple-600 dark:hover:bg-purple-900/30 dark:hover:text-purple-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors duration-150"
                  aria-label="Summarize group chat with AI"
                  title="AI Summary"
                >
                  <SparklesIcon className="w-4 h-4" />
                  <span className="hidden lg:inline">{isSummarizingChat ? 'Summarizing…' : 'Summarize'}</span>
                </button>

              </div>
            )}

            {/* Overflow menu */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="p-2 text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                aria-haspopup="true"
                aria-expanded={isDropdownOpen}
                aria-label="Chat options"
              >
                <EllipsisVerticalIcon className="w-5 h-5" />
              </button>
              {isDropdownOpen && isGroup && group && (
                <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-slate-800 rounded-xl shadow-xl ring-1 ring-slate-200 dark:ring-slate-700 z-20 py-1 animate-in fade-in slide-in-from-top-2 duration-150">
                  <button
                    onClick={() => handleDropdownAction(onOpenGroupInfoModal)}
                    className="w-full text-left px-4 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60 flex items-center gap-2.5 transition-colors duration-150"
                    role="menuitem"
                  >
                    <UserGroupIcon className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                    Group Info & Members
                  </button>
                  {isArchived ? (
                    <button
                      onClick={() => handleDropdownAction(() => onToggleArchiveGroup(group.id))}
                      className="w-full text-left px-4 py-2 text-sm text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 flex items-center gap-2.5 transition-colors duration-150"
                      role="menuitem"
                    >
                      <ArchiveBoxIcon className="w-4 h-4" />
                      Unarchive Group
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => handleDropdownAction(() => onOpenCreateSubGroupModal(group.id))}
                        className="w-full text-left px-4 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60 flex items-center gap-2.5 transition-colors duration-150"
                        role="menuitem"
                      >
                        <PlusCircleIcon className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                        Create Sub-group
                      </button>
                      <div className="border-t border-slate-100 dark:border-slate-700 my-1" />
                      {/* Mobile-only study actions (hidden on md+ where toolbar shows) */}
                      <div className="md:hidden">
                        <button
                          onClick={() => handleDropdownAction(onOpenQuestionModal)}
                          className="w-full text-left px-4 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60 flex items-center gap-2.5 transition-colors duration-150"
                          role="menuitem"
                        >
                          <PencilSquareIcon className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                          Submit New Question
                        </button>
                        <button
                          onClick={() => handleDropdownAction(onOpenTestConfigModal)}
                          className="w-full text-left px-4 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60 flex items-center gap-2.5 transition-colors duration-150"
                          role="menuitem"
                        >
                          <QuestionMarkCircleIcon className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                          Take a Test
                        </button>
                        <button
                          onClick={() => handleDropdownAction(onOpenStudyConfigModal)}
                          className="w-full text-left px-4 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60 flex items-center gap-2.5 transition-colors duration-150"
                          role="menuitem"
                        >
                          <AcademicCapIcon className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                          Study Mode
                        </button>
                      </div>
                      {onOpenAIGenerateModal && (
                        <button
                          onClick={() => handleDropdownAction(onOpenAIGenerateModal)}
                          className="w-full text-left px-4 py-2 text-sm text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 flex items-center gap-2.5 transition-colors duration-150"
                          role="menuitem"
                        >
                          <SparklesIcon className="w-4 h-4" />
                          AI Generate Questions
                        </button>
                      )}
                      <button
                        onClick={() => handleDropdownAction(handleSummarizeGroup)}
                        disabled={isSummarizingChat}
                        className="w-full text-left px-4 py-2 text-sm text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 flex items-center gap-2.5 transition-colors duration-150 disabled:opacity-50"
                        role="menuitem"
                      >
                        <SparklesIcon className="w-4 h-4" />
                        {isSummarizingChat ? 'Summarizing…' : 'Summarize Group Chat'}
                      </button>
                      <div className="border-t border-slate-100 dark:border-slate-700 my-1" />
                      <button
                        onClick={() => handleDropdownAction(() => onToggleArchiveGroup(group.id))}
                        className="w-full text-left px-4 py-2 text-sm text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 flex items-center gap-2.5 transition-colors duration-150"
                        role="menuitem"
                      >
                        <ArchiveBoxIcon className="w-4 h-4" />
                        Archive Group
                      </button>
                    </>
                  )}
                </div>
              )}
              {isDropdownOpen && !isGroup && chat && (
                <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-slate-800 rounded-xl shadow-xl ring-1 ring-slate-200 dark:ring-slate-700 z-20 py-1 animate-in fade-in slide-in-from-top-2 duration-150">
                  {(chat as any).isArchived ? (
                    <button
                      onClick={() => {
                        setIsDropdownOpen(false);
                        onUnarchiveDmThread?.(chat.id);
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 flex items-center gap-2.5 transition-colors duration-150"
                      role="menuitem"
                    >
                      <ArchiveBoxIcon className="w-4 h-4" />
                      Unarchive Conversation
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setIsDropdownOpen(false);
                        onArchiveDmThread?.(chat.id);
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 flex items-center gap-2.5 transition-colors duration-150"
                      role="menuitem"
                    >
                      <ArchiveBoxIcon className="w-4 h-4" />
                      Archive Conversation
                    </button>
                  )}
                  <div className="border-t border-slate-100 dark:border-slate-700 my-1" />
                  {onDeleteDmThread && (
                    <button
                      onClick={() => {
                        setIsDropdownOpen(false);
                        if (window.confirm('Delete this conversation? All messages will be permanently removed.')) {
                          onDeleteDmThread(chat.id);
                        }
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2.5 transition-colors duration-150"
                      role="menuitem"
                    >
                      <TrashIcon className="w-4 h-4" />
                      Delete Conversation
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        {isGroup && !isArchived && (
          <div className="flex items-center gap-4 px-4 md:px-6 py-2 bg-slate-100/80 dark:bg-slate-800/50 border-b border-slate-200/60 dark:border-slate-700/60 text-xs text-slate-500 dark:text-slate-400">
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
        
        {/* Marketplace Sticky Banner */}
        {chat.chatType === 'dm' && inquiry && (
          <div className="flex-shrink-0 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-4 py-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              {inquiry.listing?.images && inquiry.listing.images.length > 0 ? (
                <img
                  src={normalizeStorageUrl(inquiry.listing.images[0])}
                  alt={inquiry.listing.title}
                  className="w-12 h-12 rounded-lg object-cover bg-slate-100 dark:bg-slate-700 flex-shrink-0 border border-slate-200 dark:border-slate-600"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              ) : (
                <div className="w-12 h-12 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0 border border-slate-200 dark:border-slate-600">
                  <ShoppingBagIcon className="w-6 h-6 text-slate-400" />
                </div>
              )}
              <div className="min-w-0">
                <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate leading-snug">
                  {inquiry.listing?.title}
                </h4>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">
                    {inquiry.listing?.price ? `₦${inquiry.listing.price.toLocaleString()}` : 'Free'}
                  </span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${
                    inquiry.status === 'purchased' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' :
                    inquiry.status === 'negotiating' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' :
                    inquiry.status === 'closed' ? 'bg-slate-100 text-slate-800 dark:bg-slate-900/40 dark:text-slate-400' :
                    'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300'
                  }`}>
                    {inquiry.status}
                  </span>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <div className="flex bg-slate-100 dark:bg-slate-900 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700">
                <button
                  onClick={() => setActiveTab('chat')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                    activeTab === 'chat'
                      ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  Chat
                </button>
                <button
                  onClick={() => setActiveTab('offers')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center gap-1 ${
                    activeTab === 'offers'
                      ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  Offers
                  {activeOffer && (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {chat.chatType === 'dm' && inquiry && activeOrder && activeOrder.status !== 'completed' && activeOrder.status !== 'cancelled' && (
          <div className="flex-shrink-0 px-4 py-2 bg-indigo-50 dark:bg-indigo-950/30 border-b border-indigo-100 dark:border-indigo-900 flex flex-wrap gap-2 items-center">
            <span className="text-xs font-medium text-indigo-800 dark:text-indigo-200">
              Order: {activeOrder.status.replace(/_/g, ' ')} · ₦{Number(activeOrder.amount).toLocaleString()}
            </span>
            {currentUser.id === inquiry.seller_id && ['paid', 'pending_payment'].includes(activeOrder.status) && (
              <>
                <button
                  type="button"
                  disabled={orderActionLoading}
                  className="text-xs px-2 py-1 rounded-md bg-indigo-600 text-white"
                  onClick={async () => {
                    setOrderActionLoading(true);
                    try {
                      const updated = await updateMarketplaceOrder(activeOrder.id, { action: 'mark_ready' });
                      setActiveOrder(updated);
                    } catch (e: any) { alert(e.message); }
                    finally { setOrderActionLoading(false); }
                  }}
                >
                  Mark ready
                </button>
                <button
                  type="button"
                  disabled={orderActionLoading}
                  className="text-xs px-2 py-1 rounded-md border border-indigo-600 text-indigo-700 dark:text-indigo-300"
                  onClick={async () => {
                    setOrderActionLoading(true);
                    try {
                      await requestOrderPayment(activeOrder.id);
                      alert('Payment request sent');
                    } catch (e: any) { alert(e.message); }
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
                  } catch (e: any) { alert(e.message); }
                  finally { setOrderActionLoading(false); }
                }}
              >
                Confirm received
              </button>
            )}
          </div>
        )}
      </div>

      {activeTab === 'chat' ? (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {/* Messages area — scrolls independently */}
          <div ref={messagesContainerRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 py-4 space-y-3">
            {visibleMessages.map((msg, idx) => {
              // Date separator logic
              const msgDate = new Date(msg.timestamp);
              const prevMsg = idx > 0 ? visibleMessages[idx - 1] : null;
              const prevDate = prevMsg ? new Date(prevMsg.timestamp) : null;
              const showDateSeparator = !prevDate
                || msgDate.toDateString() !== prevDate.toDateString();

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
                      <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
                      <span className="text-xs font-medium text-slate-400 dark:text-slate-500 whitespace-nowrap px-2">
                        {formatDateLabel(msgDate)}
                      </span>
                      <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
                    </div>
                  )}
                  <MessageItem
                    message={msg}
                    isCurrentUserMessage={msg.sender.id === currentUser.id}
                    currentUserVote={userVotes[msg.id]}
                    onVoteQuestion={onVoteQuestion}
                    onFlagAsSimilar={(messageId) => onFlagAsSimilar(messageId, chat.id)}
                    currentUserFlagged={msg.flaggedAsSimilarUserIds?.includes(currentUser.id)}
                    group={group}
                    currentUser={currentUser}
                  />
                </React.Fragment>
              );
            })}
            <div ref={messagesEndRef} />
            {visibleMessages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                {awaitingMessages ? (
                  <>
                    <div className="w-10 h-10 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4" />
                    <p className="text-sm text-slate-500 dark:text-slate-400">Loading messages…</p>
                  </>
                ) : (
                  <>
                <div className="w-16 h-16 rounded-2xl bg-slate-200/60 dark:bg-slate-800 flex items-center justify-center mb-4">
                  <ChatBubbleLeftRightIcon className="w-8 h-8 text-slate-400 dark:text-slate-500" />
                </div>
                <h3 className="text-base font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {isArchived ? 'This group is archived' : 'No messages yet'}
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xs">
                  {isArchived
                    ? 'Unarchive the group to resume the conversation.'
                    : `Be the first to send a message in ${name}!`}
                </p>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
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
            <div className="flex-shrink-0 pb-16 md:pb-0 bg-white dark:bg-slate-800 relative z-20 border-t border-slate-200 dark:border-slate-700">
              <MessageInputBar
                onSendMessage={onSendMessage}
                onOpenQuestionModal={isGroup ? onOpenQuestionModal : undefined}
                onAIQuery={isGroup ? onAIQuery : undefined}
              />
            </div>
          )}
        </div>
      ) : (
        /* Offers Tab panel */
        inquiry && (
          <div className="flex-1 flex flex-col bg-slate-50 dark:bg-slate-900 overflow-y-auto p-4 md:p-6">
            {/* Listing Card */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-200/60 dark:border-slate-700/60 shadow-sm flex flex-col sm:flex-row gap-4 mb-6">
              {inquiry.listing?.images && inquiry.listing.images.length > 0 ? (
                <img
                  src={normalizeStorageUrl(inquiry.listing.images[0])}
                  alt={inquiry.listing.title}
                  className="w-full sm:w-32 h-32 rounded-xl object-cover bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 flex-shrink-0"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              ) : (
                <div className="w-full sm:w-32 h-32 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center border border-slate-200 dark:border-slate-600 flex-shrink-0">
                  <ShoppingBagIcon className="w-10 h-10 text-slate-400" />
                </div>
              )}
              <div className="flex-1 flex flex-col justify-between min-w-0">
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-base font-bold text-slate-800 dark:text-slate-200 line-clamp-2">
                      {inquiry.listing?.title}
                    </h3>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase flex-shrink-0 ${
                      inquiry.status === 'purchased' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' :
                      inquiry.status === 'negotiating' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' :
                      inquiry.status === 'closed' ? 'bg-slate-100 text-slate-800 dark:bg-slate-900/40 dark:text-slate-400' :
                      'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300'
                    }`}>
                      {inquiry.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 capitalize font-medium">
                    Category: {inquiry.listing?.category || 'academic'}
                  </p>
                </div>
                
                <div className="flex items-baseline gap-2 mt-4">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Asking Price:</span>
                  <span className="text-lg font-extrabold text-indigo-600 dark:text-indigo-400">
                    {inquiry.listing?.price ? `₦${inquiry.listing.price.toLocaleString()}` : 'Free'}
                  </span>
                </div>
              </div>
            </div>

            {/* Active Offer Section */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-200/60 dark:border-slate-700/60 shadow-sm mb-6">
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-4 flex items-center gap-1.5">
                <CurrencyDollarIcon className="w-5 h-5 text-emerald-500" />
                Active Offer
              </h3>
              
              {activeOffer ? (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-4 bg-slate-50 dark:bg-slate-700/40 rounded-xl border border-slate-200/60 dark:border-slate-700/60 gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500 dark:text-slate-400">Offered Amount:</span>
                        <span className="text-lg font-bold text-slate-900 dark:text-slate-100">
                          ₦{activeOffer.amount.toLocaleString()}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 font-medium">
                        Submitted on {new Date(activeOffer.created_at).toLocaleDateString()}
                      </p>
                      {activeOffer.message && (
                        <p className="text-xs italic text-slate-500 dark:text-slate-400 mt-2 bg-white dark:bg-slate-800 p-2 rounded-lg border border-slate-100 dark:border-slate-700/50">
                          "{activeOffer.message}"
                        </p>
                      )}
                    </div>
                    
                    <div className="flex-shrink-0">
                      <span className={`px-2.5 py-1 text-xs font-semibold rounded-full capitalize ${
                        activeOffer.status === 'pending' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' :
                        activeOffer.status === 'countered' ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300' :
                        activeOffer.status === 'accepted' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' :
                        activeOffer.status === 'declined' ? 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300' :
                        'bg-slate-100 text-slate-800 dark:bg-slate-900/40 dark:text-slate-400'
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
                            className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-350 text-white text-xs font-bold rounded-xl transition-colors shadow-sm"
                          >
                            {offerLoading ? 'Withdrawing...' : 'Withdraw Offer'}
                          </button>
                        )}
                        {activeOffer.status === 'countered' && (
                          <>
                            <button
                              disabled={offerLoading}
                              onClick={() => handleRespond('accept')}
                              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-350 text-white text-xs font-bold rounded-xl transition-colors shadow-sm"
                            >
                              Accept Counter
                            </button>
                            <button
                              disabled={offerLoading}
                              onClick={() => handleRespond('decline')}
                              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-350 text-white text-xs font-bold rounded-xl transition-colors shadow-sm"
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
                              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-350 text-white text-xs font-bold rounded-xl transition-colors shadow-sm"
                            >
                              Accept Offer
                            </button>
                            <button
                              disabled={offerLoading}
                              onClick={() => handleRespond('decline')}
                              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-350 text-white text-xs font-bold rounded-xl transition-colors shadow-sm"
                            >
                              Decline Offer
                            </button>
                            <button
                              disabled={offerLoading}
                              onClick={() => { setShowCounterInput(true); setCounterValue(''); }}
                              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-350 text-white text-xs font-bold rounded-xl transition-colors shadow-sm"
                            >
                              Counter Offer
                            </button>
                          </div>
                        )}
                        
                        {showCounterInput && (
                          <div className="flex flex-col gap-2 p-3 bg-slate-50 dark:bg-slate-700/30 rounded-xl border border-slate-200 dark:border-slate-700">
                            <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                              Counter Offer Amount (₦)
                            </label>
                            <div className="flex gap-2">
                              <input
                                type="number"
                                value={counterValue}
                                onChange={(e) => setCounterValue(e.target.value)}
                                placeholder="Enter counter amount"
                                className="flex-1 px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm font-semibold"
                              />
                              <button
                                disabled={offerLoading || !counterValue || parseFloat(counterValue) <= 0}
                                onClick={() => handleRespond('counter', parseFloat(counterValue))}
                                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-xs font-bold rounded-lg transition-colors"
                              >
                                Send Counter
                              </button>
                              <button
                                disabled={offerLoading}
                                onClick={() => setShowCounterInput(false)}
                                className="px-3 py-1.5 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 text-xs font-bold rounded-lg transition-colors hover:bg-slate-50"
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
                  <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 font-medium">
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
            <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-200/60 dark:border-slate-700/60 shadow-sm flex-1">
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-4">
                Negotiation History
              </h3>
              
              {offerHistory.length === 0 ? (
                <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-8">
                  No previous offers or counter-offers recorded.
                </p>
              ) : (
                <div className="relative border-l border-slate-200 dark:border-slate-700 ml-3 pl-5 space-y-6">
                  {offerHistory.map((offer) => {
                    return (
                      <div key={offer.id} className="relative">
                        {/* Dot indicator */}
                        <span className={`absolute -left-[26px] top-1.5 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-slate-800 ${
                          offer.status === 'accepted' ? 'bg-emerald-500' :
                          offer.status === 'declined' ? 'bg-red-500' :
                          offer.status === 'withdrawn' ? 'bg-slate-400' :
                          offer.status === 'countered' ? 'bg-amber-500' :
                          'bg-indigo-500'
                        }`} />
                        
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                              ₦{offer.amount.toLocaleString()}
                            </span>
                            <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
                              {new Date(offer.created_at).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            {offer.buyer_id === currentUser.id ? 'You' : 'Buyer'} offered ₦{offer.amount.toLocaleString()} ({offer.status})
                          </p>
                          {offer.message && (
                            <p className="text-xs italic text-slate-400 dark:text-slate-500 mt-1">
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
          </div>
        )
      )}

      {/* Offer Modal */}
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