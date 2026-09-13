import React, { useEffect, useMemo, useState } from 'react';
import { Group, AppMode, User, Badge, DMThread, TestSessionData, StudySessionData, ChatItem, GameSession } from '../types';
import {
  buildChatHome,
  chatMatchesInboxFilter,
  parseStoredIdSet,
  PINNED_CHATS_STORAGE_KEY,
  type ChatHomeLounge,
  type ChatInboxFilter,
} from '@lantern/shared/chat';
import { fetchMyInquiries } from '../services/supabase';
import { useCommunityStore } from '../stores/communityStore';
import GroupListItem from './GroupListItem';
import { ChatHomePane } from './chat/ChatHomePane';
import { Avatar, ConnectionBadge, LanternIcon } from './ui';
import { resolveAvatarSrc } from '../utils/avatar';
import { AppIcon, type AppIconName } from './ui/AppIcon';
import { useLowDataModeToggle } from '../hooks/useLowDataModeToggle';
import { useUIStore } from '../stores/uiStore';
import { formatUnreadBadgeCount, getTotalActiveUnreadChatCount } from '../utils/chatUnread';
import { isInboundDmMessageRequest } from '../utils/dmThreads';
import { resolveShellSideColumn, isSideColumnPinned } from './layout/shellSideColumn';
import { DESTINATION_LABELS, resolveActiveDestination, type DestinationId } from './layout/destinations';
import { useAiCredits } from './layout/useAiCredits';
import CommunityColumn, { type CommunityNavigate } from './community/CommunityColumn';

interface SidebarProps {
  currentUser: User;
  groups: Group[];
  dmThreads: DMThread[];
  selectedChatId: string | undefined;
  onSelectChat: (chat: ChatItem) => void;
  onNavigateToCreateGroup: () => void;
  /** The five destinations. One name, one door, same order as the phone bar. */
  onNavigateToDashboard: () => void;
  onNavigateToStudy: () => void;
  onNavigateToChat: () => void;
  onNavigateToCampus: () => void;
  onNavigateToMe: () => void;
  /** Current pathname — the only way to know Me is open (it has no AppMode). */
  currentPath: string;
  pendingSyncCount: number;
  isOnline: boolean;
  currentAppMode: AppMode;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onOpenNewDmModal: () => void;
  unreadNotificationCount: number;
  onOpenNotificationModal: () => void;
  activeTestSession: TestSessionData | null;
  activeStudySession: StudySessionData | null;
  activeGameSession?: GameSession | null;
  onResumeSession: (mode: AppMode) => void;
  onCancelSession: () => void;
  dueCardsCount: number;
  onToggleCompanion: () => void;
  isCompanionOpen?: boolean;
  /** Community server view: the column's rows all go through App's one handler. */
  onCommunityNavigate?: CommunityNavigate;
  onOpenLounge?: (lounge: ChatHomeLounge) => void;
  onOpenInquiries?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ 
  currentUser,
  groups, 
  dmThreads,
  selectedChatId, 
  onSelectChat,
  onNavigateToCreateGroup, 
  onNavigateToDashboard,
  onNavigateToStudy,
  onNavigateToChat,
  onNavigateToCampus,
  onNavigateToMe,
  currentPath,
  pendingSyncCount,
  isOnline,
  currentAppMode,
  isExpanded,
  onToggleExpand,
  onOpenNewDmModal,
  unreadNotificationCount,
  onOpenNotificationModal,
  activeTestSession,
  activeStudySession,
  activeGameSession,
  onResumeSession,
  onCancelSession,
  dueCardsCount,
  onToggleCompanion,
  isCompanionOpen,
  onCommunityNavigate,
  onOpenLounge,
  onOpenInquiries,
}) => {
  const [expandedParentGroups, setExpandedParentGroups] = useState<Record<string, boolean>>({});
  const [isArchivedExpanded, setIsArchivedExpanded] = useState(false);
  const [inboxQuery, setInboxQuery] = useState('');
  const [inboxFilter, setInboxFilter] = useState<ChatInboxFilter>('all');
  const [pinnedChatIds, setPinnedChatIds] = useState<Set<string>>(() => {
    try {
      return parseStoredIdSet(localStorage.getItem(PINNED_CHATS_STORAGE_KEY));
    } catch {
      return new Set();
    }
  });
  const [listingTitlesByThread, setListingTitlesByThread] = useState<Record<string, string>>({});
  const myCommunities = useCommunityStore((s) => s.myCommunities);
  const communityNameById = useMemo(
    () => Object.fromEntries(myCommunities.map((community) => [community.id, community.name])),
    [myCommunities],
  );

  useEffect(() => {
    try {
      setPinnedChatIds(parseStoredIdSet(localStorage.getItem(PINNED_CHATS_STORAGE_KEY)));
    } catch {
      setPinnedChatIds(new Set());
    }
  }, [selectedChatId]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchMyInquiries('buyer'), fetchMyInquiries('seller')])
      .then(([buyer, seller]) => {
        if (cancelled) return;
        const next: Record<string, string> = {};
        for (const row of [...(buyer || []), ...(seller || [])]) {
          const threadId = row?.dm_thread_id;
          const title = row?.listing?.title;
          if (threadId && title) next[threadId] = title;
        }
        setListingTitlesByThread(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const { lowDataMode } = useLowDataModeToggle();
  const { isChatsSectionExpanded, toggleChatsSection, activeCommunity } = useUIStore();
  const aiCredits = useAiCredits();
  const activeDestination = resolveActiveDestination(currentAppMode, currentPath);
  
  const canInteractWithChats = ![AppMode.TEST_ACTIVE, AppMode.STUDY_ACTIVE, AppMode.GAME_ACTIVE].includes(currentAppMode);
  
  const pausedTest = activeTestSession && currentAppMode !== AppMode.TEST_ACTIVE;
  const pausedStudy = activeStudySession && currentAppMode !== AppMode.STUDY_ACTIVE;
  const pausedGame = !!(
    activeGameSession
    && !activeGameSession.isComplete
    && !activeGameSession.awaitingOpponent
    && currentAppMode !== AppMode.GAME_ACTIVE
  );
  const isSessionPaused = pausedTest || pausedStudy || pausedGame;
  const sessionAppMode = pausedTest
    ? AppMode.TEST_ACTIVE
    : pausedStudy
      ? AppMode.STUDY_ACTIVE
      : AppMode.GAME_ACTIVE;
  const pausedSessionLabel = pausedTest ? 'Test' : pausedStudy ? 'Study' : 'Game';

  const { topLevelChats, messageRequestChats, subGroupsMap, archivedGroups } = useMemo(() => {
    // Defensive alongside the store's own coercion: this list is the whole
    // chat navigation, so a bad value here costs the user every conversation.
    const allChats: ChatItem[] = [
      ...(Array.isArray(groups) ? groups : []).map(g => ({ ...g, chatType: 'group' as const })),
      ...(Array.isArray(dmThreads) ? dmThreads : []).map(t => ({ ...t, chatType: 'dm' as const }))
    ];

    allChats.sort((a, b) => {
        const timeA = a.chatType === 'group' ? (a.lastMessageTime ? new Date(a.lastMessageTime).getTime() : 0) : (a.lastMessageTimestamp ? new Date(a.lastMessageTimestamp).getTime() : 0);
        const timeB = b.chatType === 'group' ? (b.lastMessageTime ? new Date(b.lastMessageTime).getTime() : 0) : (b.lastMessageTimestamp ? new Date(b.lastMessageTimestamp).getTime() : 0);
        return timeB - timeA;
    });

    const topLevel: ChatItem[] = [];
    const messageRequests: ChatItem[] = [];
    const subMap: Record<string, Group[]> = {};
    const archived: ChatItem[] = [];
    
    allChats.forEach(chat => {
      if (chat.chatType === 'group') {
        if (chat.isArchived) {
          archived.push(chat);
        } else if (chat.parentId) {
          if (!subMap[chat.parentId]) {
            subMap[chat.parentId] = [];
          }
          subMap[chat.parentId].push(chat);
        } else {
          topLevel.push(chat);
        }
      } else {
        if ((chat as any).isArchived) {
          archived.push(chat);
        } else if (isInboundDmMessageRequest(chat, currentUser.id)) {
          messageRequests.push(chat);
        } else {
          topLevel.push(chat);
        }
      }
    });

    for (const parentId in subMap) {
        subMap[parentId].sort((a, b) => a.name.localeCompare(b.name));
    }

    const q = inboxQuery.trim().toLowerCase();
    const matchesQuery = (chat: ChatItem) => {
      if (!q) return true;
      if (chat.chatType === 'group') return chat.name.toLowerCase().includes(q);
      const otherId = chat.participantIds?.find((id) => id !== currentUser.id);
      const name = (otherId && chat.participants?.[otherId]?.name) || '';
      return name.toLowerCase().includes(q);
    };
    const matchesFilter = (chat: ChatItem) => chatMatchesInboxFilter(chat.unreadCount, inboxFilter);

    return {
      topLevelChats: topLevel.filter((c) => matchesQuery(c) && matchesFilter(c)),
      messageRequestChats: messageRequests.filter(matchesQuery),
      subGroupsMap: subMap,
      archivedGroups: archived.filter(matchesQuery),
    };
  }, [groups, dmThreads, currentUser.id, inboxQuery, inboxFilter]);

  const totalUnreadChatCount = useMemo(
    () => getTotalActiveUnreadChatCount(groups, dmThreads),
    [groups, dmThreads],
  );
  
  const toggleParentGroupExpansion = (groupId: string) => {
    setExpandedParentGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  // Recursive renderer for a group and its subgroups. Rendered inside the
  // chats flyout column, which always has full width — so text always shows,
  // whatever state the sidebar itself is in.
  const renderGroupWithSubgroups = (group: Group, nestingLevel: number = 0): React.ReactNode => {
    const subGroups = subGroupsMap[group.id] || [];
    const isGroupExpanded = !!expandedParentGroups[group.id];

    return (
      <React.Fragment key={group.id}>
        <GroupListItem
          chat={{...group, chatType: 'group'}}
          currentUser={currentUser}
          isSelected={selectedChatId === group.id && currentAppMode === AppMode.CHAT}
          onClick={canInteractWithChats ? () => onSelectChat({...group, chatType: 'group'}) : () => {}}
          isDisabled={!canInteractWithChats}
          hasSubGroups={subGroups.length > 0}
          isExpanded={isGroupExpanded}
          onToggleExpand={subGroups.length > 0 ? () => toggleParentGroupExpansion(group.id) : undefined}
          isSubGroup={nestingLevel > 0}
          nestingLevel={nestingLevel}
          showText={true}
          pinned={pinnedChatIds.has(group.id)}
          communityName={group.communityId ? communityNameById[group.communityId] : undefined}
        />
        {isGroupExpanded && subGroups.map(subGroup =>
          renderGroupWithSubgroups(subGroup, nestingLevel + 1)
        )}
      </React.Fragment>
    );
  };

  // The chats flyout column replaces the old in-sidebar vertical accordion:
  // expanding Chats slides out a dedicated column beside the sidebar instead
  // of unfolding the list downward. On the chat screen itself ChatWindow
  // already renders the conversation list, so the flyout yields there rather
  // than doubling it; the persisted flag survives and the column returns on
  // any other screen.
  // While a community is open the same aside is its channel column instead
  // (spec §5.3). One shared predicate decides which — AppShell offsets
  // <main> from the very same call, so the two can never disagree.
  const sideColumn = resolveShellSideColumn({
    isChatsSectionExpanded,
    appMode: currentAppMode,
    activeCommunity,
  });
  const chatsFlyoutOpen = sideColumn === 'chats';
  const communityColumnOpen = sideColumn === 'community';
  const columnOpen = sideColumn !== null;
  // The column no longer forces the sidebar down to unlabelled icons. Opening a
  // second column used to strip every label, so the destination you were
  // standing in stopped having a name — the width was borrowed from the one
  // part of the screen that has to stay readable. The persisted preference is
  // now the only thing that decides.
  const effectiveExpanded = isExpanded;
  const showText = effectiveExpanded;
  // On Chat the column IS the screen's conversation list, so it has no close.
  const columnPinned = isSideColumnPinned(currentAppMode, sideColumn);

  const handleSidebarToggle = () => {
    onToggleExpand();
  };

  // The Me entry wears the student's own face: a destination that is "me" is
  // recognised faster than any icon of a person.
  const MeAvatarIcon = ({ className = '' }: { className?: string }) => (
    <span className={`inline-flex items-center justify-center ${className}`} aria-hidden="true">
      <Avatar
        name={currentUser.name}
        id={currentUser.id}
        src={resolveAvatarSrc(currentUser.avatarUrl, lowDataMode)}
        size="xs"
        localOnly={lowDataMode}
        className="!w-5 !h-5"
      />
    </span>
  );

  const NavButton = ({
    navFunc,
    icon,
    renderIcon,
    label,
    isActive = false,
    badgeCount,
    badgeSuffix = 'unread',
    countLabel,
    tipId,
  }: {
    navFunc: () => void;
    icon?: AppIconName;
    /** The Me row's "icon" is the student's own face, not a glyph. */
    renderIcon?: (className: string) => React.ReactNode;
    label: string;
    isActive?: boolean;
    badgeCount?: number;
    badgeSuffix?: string;
    /** A plain count under the label (AI credits), not an alert. */
    countLabel?: string;
    tipId?: string;
  }) => {
    const showBadge = badgeCount !== undefined && badgeCount > 0;
    const accessibleName = showBadge
      ? `${label}, ${formatUnreadBadgeCount(badgeCount!)} ${badgeSuffix}`
      : countLabel
        ? `${label}, ${countLabel}`
        : label;
    return (
    <button
      onClick={navFunc}
      data-tip-id={tipId}
      aria-label={accessibleName}
      aria-current={isActive ? 'page' : undefined}
      className={`w-full flex ${showText && countLabel ? 'items-start' : 'items-center'} p-2.5 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 transition-all duration-150 relative ${
          isActive
            // 2026-09-11: a GREY pill, not an indigo fill. The reference's rail
            // carries no hue at all — the lit item is the same outline glyph
            // turned white inside a grey pill, so the rail never competes with
            // the pastels on the page beside it. The glyph stays the same
            // shape and the label gains weight, so "lit" is never colour alone.
            ? 'bg-lantern-nav-column-active text-lantern-nav-column-text font-semibold'
            : 'text-lantern-nav-column-text-secondary hover:bg-white/10 hover:text-lantern-nav-column-text'
      } ${!canInteractWithChats ? 'opacity-50 cursor-not-allowed' : ''} ${!showText && 'justify-center'}`}
      disabled={!canInteractWithChats && !isSessionPaused}
      title={label}
    >
      {renderIcon ? (
        renderIcon(`flex-shrink-0 ${showText ? 'mr-3' : ''}`)
      ) : icon ? (
        <AppIcon
          // 16 px outline glyphs: the reference's rail marks are small and
          // quiet, and the label is what you read. `currentColor` carries the
          // light grey (or the lit white) down from the button, so the glyph
          // has no colour of its own to keep in step.
          name={icon}
          size={16}
          className={`flex-shrink-0 ${showText ? 'mr-3' : ''}`}
        />
      ) : null}
      {showText && (
        <span className="min-w-0 flex-1 flex flex-col items-start text-left leading-tight">
          <span className="text-body tracking-tight">{label}</span>
          {countLabel ? (
            <span aria-hidden="true" className="mt-0.5 text-label tracking-normal text-lantern-nav-column-text-secondary">
              {countLabel}
            </span>
          ) : null}
        </span>
      )}
      {showBadge && (
          <span aria-hidden="true" className={`absolute top-1.5 right-1.5 bg-lantern-error-strong text-white text-label tracking-normal px-1.5 py-0.5 rounded-full`}>
              {formatUnreadBadgeCount(badgeCount!)}
          </span>
      )}
    </button>
    );
  };

  const destinationActive = (id: DestinationId) => activeDestination === id;


  return (
    <>
    <div className={`fixed inset-y-0 left-0 z-40 flex flex-col bg-lantern-nav-column backdrop-blur-md text-lantern-nav-column-text border-r border-white/10 transition-all duration-300 ease-in-out ${effectiveExpanded ? 'w-56' : 'w-16'}`} data-expanded={effectiveExpanded}>
      <div className={`flex items-center h-16 px-3 border-b border-white/10 flex-shrink-0 ${showText ? 'justify-between' : 'justify-center'}`}>
        {showText && (
          <button
            type="button"
            onClick={onNavigateToDashboard}
            disabled={!canInteractWithChats && !isSessionPaused}
            className={`flex items-center gap-2.5 min-w-0 rounded-lg px-1 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary/40 ${
              !canInteractWithChats && !isSessionPaused
                ? 'opacity-50 cursor-not-allowed'
                : 'hover:bg-white/10'
            }`}
            aria-label={DESTINATION_LABELS.home}
            title={DESTINATION_LABELS.home}
          >
            <LanternIcon size={28} />
            <span className="font-display text-heading font-semibold tracking-tight whitespace-nowrap text-lantern-nav-column-text">
              Lantern Study
            </span>
          </button>
        )}
        <button
          type="button"
          onClick={handleSidebarToggle}
          className="p-2 text-lantern-nav-column-text-secondary hover:text-lantern-nav-column-text hover:bg-white/10 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary/40"
          aria-label={effectiveExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
          title={effectiveExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          <AppIcon
            name={effectiveExpanded ? 'panel-left-close' : 'panel-left-open'}
            size={20}
          />
        </button>
      </div>
      
      <div className="flex-grow overflow-y-auto" data-testid="desktop-sidebar-scroll">
        {isSessionPaused && (
            <div className="p-2 space-y-1">
                <button onClick={() => onResumeSession(sessionAppMode)} className={`w-full flex items-center p-3 rounded-md text-white bg-yellow-500 hover:bg-yellow-600 animate-pulse ${!showText && 'justify-center'}`} title={`Resume ${pausedSessionLabel}`}>
                    <AppIcon name="play" size={24} className={showText ? 'mr-2' : ''} />
                    {showText && <span className="font-semibold text-body">Resume Session</span>}
                </button>
                <button 
                    onClick={onCancelSession} 
                    className={`w-full flex items-center p-2 rounded-md text-red-700 bg-red-100 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-300 dark:hover:bg-red-900/60 ${!showText && 'justify-center'}`} 
                    title="Cancel Session"
                >
                    <AppIcon name="close-circle" size={20} className={showText ? 'mr-2' : ''} />
                    {showText && <span className="font-semibold text-caption">Cancel Session</span>}
                </button>
            </div>
        )}
        <nav aria-label="Primary">
          {/* The five destinations, in the same order as the phone bar and as
              mobile's bottom tabs. Nothing else goes in this list: Budget and
              Downloads are Me, a marketplace listing is Campus, a running test
              is Study. */}
          <div className="px-2 pt-2 space-y-1">
            <NavButton
              navFunc={onNavigateToDashboard}
              icon="home"
              label={DESTINATION_LABELS.home}
              isActive={destinationActive('home')}
            />
            <NavButton
              navFunc={onNavigateToStudy}
              icon="school"
              label={DESTINATION_LABELS.study}
              isActive={destinationActive('study')}
              badgeCount={dueCardsCount > 0 ? dueCardsCount : undefined}
              badgeSuffix="due"
              tipId="nav.library"
            />
            <NavButton
              navFunc={onNavigateToChat}
              icon="chatbubbles"
              label={DESTINATION_LABELS.chat}
              isActive={destinationActive('chat')}
              badgeCount={totalUnreadChatCount > 0 ? totalUnreadChatCount : undefined}
              tipId="nav.chat"
            />
            <NavButton
              navFunc={onNavigateToCampus}
              // `business` — the reference's own mark for a campus/org
              // destination, and the glyph mobile's bottom bar already uses for
              // Campus. `institution` was a second drawing of the same idea.
              icon="business"
              label={DESTINATION_LABELS.campus}
              isActive={destinationActive('campus')}
              tipId="nav.marketplace"
            />
            <NavButton
              navFunc={onNavigateToMe}
              renderIcon={(className) => <MeAvatarIcon className={className} />}
              label={DESTINATION_LABELS.me}
              isActive={destinationActive('me')}
            />
          </div>

          {/* The two things that FOLLOW you. They are not places, so they sit
              apart from the five — but they are labelled, because an unnamed
              icon is a guess. */}
          <div className="mt-3 border-t border-white/10 px-2 pt-3 space-y-1">
            {currentAppMode !== AppMode.COURSE_WORKSPACE ? (
            <NavButton
              navFunc={onToggleCompanion}
              icon="sparkles"
              label="Lantern AI"
              isActive={!!isCompanionOpen}
              countLabel={aiCredits != null ? `${aiCredits} AI credits` : undefined}
              tipId="nav.companion"
            />
            ) : null}
            <NavButton
              navFunc={onOpenNotificationModal}
              icon="notifications-alert"
              label="Notifications"
              badgeCount={unreadNotificationCount > 0 ? unreadNotificationCount : undefined}
            />
          </div>
        </nav>
      </div>

      <div className="mt-auto p-2 border-t border-white/10">
        {/* Everything that used to live down here — theme, low-data, settings,
            logout, the points row — is Me now. What stays is the one thing that
            is about the app rather than about the student: whether it can reach
            the server. */}
        <ConnectionBadge
          isOnline={isOnline}
          lowDataMode={lowDataMode}
          pendingSyncCount={pendingSyncCount}
          compact
          iconOnly={!showText}
          className={showText ? 'w-full justify-center' : 'w-full justify-center px-1'}
        />
      </div>
    </div>

    {/* Chats flyout column — the horizontal expansion that replaced the
        vertical in-sidebar accordion. The outer aside animates its width
        (0 ↔ 20rem) while the inner wrapper keeps a fixed width, so rows
        slide into view instead of reflowing mid-animation. AppShell shifts
        <main> by the same 20rem (see its md:ml-* classes). */}
    <aside
      aria-label={communityColumnOpen ? (activeCommunity?.name || 'Community') : 'Chats'}
      aria-hidden={!columnOpen}
      className={`fixed inset-y-0 z-30 bg-lantern-background-secondary/95 backdrop-blur-md border-r border-lantern-border overflow-hidden transition-all duration-300 ease-in-out ${effectiveExpanded ? 'left-56' : 'left-16'} ${columnOpen ? 'w-80' : 'w-0 border-r-0'}`}
    >
      {communityColumnOpen && onCommunityNavigate && (
        <CommunityColumn onNavigate={onCommunityNavigate} />
      )}
      {chatsFlyoutOpen && (
        <div className="w-80 h-full flex flex-col">
          <div className="flex items-center justify-between gap-2 h-16 px-4 border-b border-lantern-border flex-shrink-0">
            <h2 className="text-heading font-bold text-lantern-text flex items-center gap-2 min-w-0">
              <span className="truncate">Chats</span>
              {totalUnreadChatCount > 0 && (
                <span className="bg-lantern-error-strong text-white text-label tracking-normal font-bold min-w-[1.25rem] h-5 px-1 flex items-center justify-center rounded-full flex-shrink-0">
                  {formatUnreadBadgeCount(totalUnreadChatCount)}
                </span>
              )}
            </h2>
            <div className="flex gap-1 flex-shrink-0">
              <button
                onClick={onNavigateToCreateGroup}
                className={`p-1.5 rounded-md text-lantern-text-secondary hover:text-lantern-primary hover:bg-lantern-background-secondary focus:outline-none focus:ring-2 focus:ring-lantern-primary transition-colors ${!canInteractWithChats ? 'opacity-50 cursor-not-allowed' : ''}`}
                disabled={!canInteractWithChats}
                title="New Group"
              >
                <AppIcon name="add" size={16} />
              </button>
              <button
                onClick={onOpenNewDmModal}
                className={`p-1.5 rounded-md text-lantern-text-secondary hover:text-lantern-primary hover:bg-lantern-background-secondary focus:outline-none focus:ring-2 focus:ring-lantern-primary transition-colors ${!canInteractWithChats ? 'opacity-50 cursor-not-allowed' : ''}`}
                disabled={!canInteractWithChats}
                title="New DM"
              >
                <AppIcon name="chatbubbles" size={16} />
              </button>
              {!columnPinned && (
                <button
                  onClick={toggleChatsSection}
                  className="p-1.5 rounded-md text-lantern-text-secondary hover:text-lantern-text hover:bg-lantern-background-secondary focus:outline-none focus:ring-2 focus:ring-lantern-primary transition-colors"
                  title="Close chats panel"
                  aria-label="Close chats panel"
                >
                  <AppIcon name="close" size={16} />
                </button>
              )}
            </div>
          </div>
          <div className="px-3 pt-2 pb-1 flex-shrink-0 space-y-2">
            <label className="sr-only" htmlFor="chats-inbox-search">Search chats</label>
            <input
              id="chats-inbox-search"
              value={inboxQuery}
              onChange={(e) => setInboxQuery(e.target.value)}
              placeholder="Search chats"
              className="w-full rounded-xl border border-lantern-border bg-lantern-surface px-3 py-2 text-sm text-lantern-text placeholder:text-lantern-text-tertiary"
            />
            <div className="flex gap-1">
              {(['all', 'unread'] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setInboxFilter(id)}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold min-h-[32px] ${
                    inboxFilter === id
                      ? 'bg-lantern-ink text-lantern-surface'
                      : 'bg-lantern-background-secondary text-lantern-text-secondary'
                  }`}
                >
                  {id === 'all' ? 'All' : 'Unread'}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto py-1">
            {messageRequestChats.length > 0 && (
              <div className="mb-1">
                <p className="px-3 py-2 text-label uppercase text-amber-700 dark:text-amber-300">
                  Message requests ({messageRequestChats.length})
                </p>
                {messageRequestChats.map((chat) => (
                  <GroupListItem
                    key={chat.id}
                    chat={chat}
                    currentUser={currentUser}
                    isSelected={selectedChatId === chat.id}
                    onClick={canInteractWithChats ? () => onSelectChat(chat) : () => {}}
                    isDisabled={!canInteractWithChats}
                    showText={true}
                    listingTitle={listingTitlesByThread[chat.id]}
                  />
                ))}
              </div>
            )}
            {topLevelChats.map((chat) => {
              if (chat.chatType === 'group') {
                return renderGroupWithSubgroups(chat, 0);
              }
              return (
                <GroupListItem
                  key={chat.id}
                  chat={chat}
                  currentUser={currentUser}
                  isSelected={selectedChatId === chat.id}
                  onClick={canInteractWithChats ? () => onSelectChat(chat) : () => {}}
                  isDisabled={!canInteractWithChats}
                  showText={true}
                  pinned={pinnedChatIds.has(chat.id)}
                  listingTitle={listingTitlesByThread[chat.id]}
                />
              );
            })}
            {topLevelChats.length === 0 && messageRequestChats.length === 0 && (
              inboxQuery.trim() || inboxFilter === 'unread' ? (
                <p className="px-3 py-2 text-body text-lantern-text-secondary">
                  {inboxFilter === 'unread' && !inboxQuery.trim() ? 'No unread chats.' : 'No chats match that search.'}
                </p>
              ) : (
                <ChatHomePane
                  compact
                  model={buildChatHome({
                    currentUserId: currentUser.id,
                    groups,
                    dmThreads,
                    communities: myCommunities,
                  })}
                  onMessageSomeone={onOpenNewDmModal}
                  onNewGroup={onNavigateToCreateGroup}
                  onOpenLounge={onOpenLounge}
                  onOpenInquiries={onOpenInquiries}
                />
              )
            )}
            {archivedGroups.length > 0 && (
              <div className="mt-2 pt-2 border-t border-lantern-border">
                <button
                  onClick={() => setIsArchivedExpanded(!isArchivedExpanded)}
                  className="w-full flex items-center justify-between p-3 text-label text-lantern-text-secondary uppercase hover:text-lantern-text focus:outline-none"
                  aria-expanded={isArchivedExpanded}
                >
                  <span className="flex items-center"><AppIcon name="archive" size={16} className="mr-2" /> Archived</span>
                  {isArchivedExpanded ? <AppIcon name="chevron-down" size={20} /> : <AppIcon name="chevron-forward" size={20} />}
                </button>
                {isArchivedExpanded && (
                  <div className="mt-1">
                    {archivedGroups.map(chat => (
                      <GroupListItem
                        key={chat.id}
                        chat={chat}
                        currentUser={currentUser}
                        isSelected={selectedChatId === chat.id}
                        onClick={canInteractWithChats ? () => onSelectChat(chat) : () => {}}
                        isDisabled={!canInteractWithChats}
                        showText={true}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
    </>
  );
};

export default Sidebar;