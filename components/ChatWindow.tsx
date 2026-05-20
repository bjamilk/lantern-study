import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Group, Message, User, DMThread, ChatItem } from '../types';
import MessageItem from './MessageItem';
import MessageInputBar from './MessageInputBar';
import GroupListItem from './GroupListItem';
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
} from '@heroicons/react/24/outline';

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
}

const ChatWindow: React.FC<ChatWindowProps> = ({
  chat, messages, currentUser, userVotes,
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
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(messages.length);

  // tree state used for mobile grouping
  const [expandedParentGroups, setExpandedParentGroups] = useState<Record<string, boolean>>({});

  // build top‑level vs subgroup map once
  const { activeTopLevelGroups, archivedTopLevelGroups, subGroupsMap } = React.useMemo(() => {
    const activeTop: Group[] = [];
    const archivedTop: Group[] = [];
    const map: Record<string, Group[]> = {};

    groups.forEach(g => {
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
    ? chat.participants[chat.participantIds.find(id => id !== currentUser.id)!]
    : null;

  const name = isGroup ? chat.name : otherParticipant?.name || 'Chat';
  const avatarUrl = isGroup ? chat.avatarUrl : otherParticipant?.avatarUrl;

  const memberCountText = group?.members ? `${group.members.length} member${group.members.length === 1 ? '' : 's'}` +
    (group?.memberEmails && group.memberEmails.length > group.members.length ?
      ` (+${group.memberEmails.length - group.members.length} invited)` : '') : '';

  const description = isGroup ? group.description || memberCountText : 'Direct Message';
  const isArchived = isGroup ? group.isArchived : (chat as any).isArchived;

  const handleDropdownAction = (action: () => void) => {
    action();
    setIsDropdownOpen(false);
  };

  const visibleMessages = messages.filter(msg => isGroup ? !msg.isArchived : true);
  const questionCount = visibleMessages.filter(m => m.questionType).length;

  return (
    <div className="flex-1 flex flex-col bg-slate-50 dark:bg-slate-900 max-h-screen">
      {/* Header */}
      <div className="flex-shrink-0 sticky top-0 z-10">
        <div className="flex items-center justify-between h-16 px-4 md:px-6 bg-white/90 dark:bg-slate-800/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center min-w-0 gap-3">
            {/* Mobile back button */}
            {onBack && (
              <button onClick={onBack} className="md:hidden p-1.5 -ml-1 mr-1 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700" aria-label="Back to chats">
                <ArrowLeftIcon className="w-5 h-5" />
              </button>
            )}
            <div className="relative flex-shrink-0">
              {isGroup || avatarUrl ? (
                <img
                  src={avatarUrl || `https://ui-avatars.com/api/?name=${name.replace(/\s/g, '+')}&background=6366f1&color=fff&size=40`}
                  alt={name}
                  className="w-10 h-10 rounded-full object-cover ring-2 ring-white dark:ring-slate-700"
                  onError={(e) => { e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='%239ca3af' viewBox='0 0 24 24'%3E%3Cpath d='M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z'/%3E%3C/svg%3E"; }}
                />
              ) : (
                <UserCircleIcon className="w-10 h-10 text-slate-400 dark:text-slate-500" />
              )}
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
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-3">
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
          </div>
        )}
      </div>

      {/* Footer */}
      {isArchived ? (
        <div className="flex items-center justify-center gap-3 p-4 bg-amber-50 dark:bg-amber-900/20 border-t border-amber-200 dark:border-amber-800/40 flex-shrink-0">
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
        <div className="flex-shrink-0">
          <MessageInputBar
            onSendMessage={onSendMessage}
            onOpenQuestionModal={isGroup ? onOpenQuestionModal : undefined}
            onAIQuery={isGroup ? onAIQuery : undefined}
          />
        </div>
      )}
    </div>
  );
};

export default ChatWindow;