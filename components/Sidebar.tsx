import React, { useRef, useState, useMemo } from 'react';
import { useToastStore } from '../stores/toastStore';
import { Group, AppMode, User, Badge, DMThread, TestSessionData, StudySessionData, ChatItem, GameSession } from '../types';
import GroupListItem from './GroupListItem';
import AIUsageBadge from './AIUsageBadge';
import { Avatar, ConnectionBadge, LanternIcon } from './ui';
import { compressImage } from '../utils/imageCompression';
import { resolveAvatarSrc } from '../utils/avatar';
import { PlusIcon, Squares2X2Icon, CameraIcon, CloudArrowDownIcon, ArrowLeftOnRectangleIcon, ArchiveBoxIcon, ChevronDownIcon, ChevronRightIcon, SparklesIcon, Cog6ToothIcon, BookOpenIcon, ChatBubbleLeftRightIcon, LightBulbIcon, UsersIcon, BellAlertIcon, BanknotesIcon, Bars3Icon, ShoppingBagIcon, PlusCircleIcon, PlayIcon, XCircleIcon, XMarkIcon, SunIcon, MoonIcon, SignalIcon, SignalSlashIcon, GlobeAltIcon, GiftIcon } from '@heroicons/react/24/outline';
import { useLowDataModeToggle } from '../hooks/useLowDataModeToggle';
import { usePlatformAdmin } from '../hooks/usePlatformAdmin';
import { useUIStore } from '../stores/uiStore';
import { formatUnreadBadgeCount, getTotalActiveUnreadChatCount } from '../utils/chatUnread';
import { isInboundDmMessageRequest } from '../utils/dmThreads';
import { resolveSideColumn } from '../utils/sideColumn';
import CommunityColumn, { type CommunityNavigate } from './community/CommunityColumn';

interface SidebarProps {
  currentUser: User;
  groups: Group[];
  dmThreads: DMThread[];
  selectedChatId: string | undefined;
  onSelectChat: (chat: ChatItem) => void;
  onNavigateToCreateGroup: () => void;
  onNavigateToDashboard: () => void;
  onNavigateToOfflineMode: () => void;
  onNavigateToLibrary?: () => void;
  onNavigateToBudgetTracker: () => void;
  onNavigateToMarketplace: () => void;
  /** Phase 3 L / D12: Discover replaces Explore; the marketplace nests inside it. */
  onNavigateToDiscover?: () => void;
  /** Phase 4 Q — invite friends / referrals. */
  onNavigateToInvite?: () => void;
  onNavigateToAdmin?: () => void;
  pendingSyncCount: number;
  isOnline: boolean;
  onSyncPendingResults: () => void;
  onUpdateCurrentUserAvatar: (avatarUrl: string) => void;
  onOpenSettingsModal: () => void;
  currentAppMode: AppMode;
  onLogout: () => void;
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
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  dueCardsCount: number;
  onToggleCompanion: () => void;
  isCompanionOpen?: boolean;
  /** Community server view: the column's rows all go through App's one handler. */
  onCommunityNavigate?: CommunityNavigate;
}

const Sidebar: React.FC<SidebarProps> = ({ 
  currentUser,
  groups, 
  dmThreads,
  selectedChatId, 
  onSelectChat,
  onNavigateToCreateGroup, 
  onNavigateToDashboard,
  onNavigateToOfflineMode,
  onNavigateToLibrary,
  onNavigateToBudgetTracker,
  onNavigateToMarketplace,
  onNavigateToDiscover,
  onNavigateToInvite,
  onNavigateToAdmin,
  pendingSyncCount,
  isOnline,
  onSyncPendingResults,
  onUpdateCurrentUserAvatar,
  onOpenSettingsModal,
  currentAppMode,
  onLogout,
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
  theme,
  onToggleTheme,
  dueCardsCount,
  onToggleCompanion,
  isCompanionOpen,
  onCommunityNavigate,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [expandedParentGroups, setExpandedParentGroups] = useState<Record<string, boolean>>({});
  const [isArchivedExpanded, setIsArchivedExpanded] = useState(false);
  const { lowDataMode, toggleLowDataMode } = useLowDataModeToggle();
  const isPlatformAdmin = usePlatformAdmin();
  const { isChatsSectionExpanded, toggleChatsSection, activeCommunity } = useUIStore();
  
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

    return {
      topLevelChats: topLevel,
      messageRequestChats: messageRequests,
      subGroupsMap: subMap,
      archivedGroups: archived,
    };
  }, [groups, dmThreads, currentUser.id]);

  const totalUnreadChatCount = useMemo(
    () => getTotalActiveUnreadChatCount(groups, dmThreads),
    [groups, dmThreads],
  );
  const showChatsHeaderBadge = !isChatsSectionExpanded && totalUnreadChatCount > 0;
  
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
        />
        {isGroupExpanded && subGroups.map(subGroup =>
          renderGroupWithSubgroups(subGroup, nestingLevel + 1)
        )}
      </React.Fragment>
    );
  };

  const handleAvatarClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      try {
        if (file.size > 2 * 1024 * 1024) { 
          useToastStore.getState().showToast("Image is too large. Please select an image under 2MB.", 'error');
          return;
        }
        const base64 = await compressImage(file, {
          maxWidth: 150,
          maxHeight: 150,
          quality: 0.7,
          outputType: 'base64',
        }) as string;
        const base64Data = base64.includes(',') ? base64.split(',')[1]! : base64;
        const { uploadProfileAvatar } = await import('../services/supabase');
        const mimeMatch = base64.match(/^data:([^;]+);/);
        const contentType = mimeMatch?.[1] || 'image/webp';
        const uploaded = await uploadProfileAvatar(
          currentUser.id,
          contentType === 'image/png' ? 'avatar.png' : 'avatar.webp',
          base64Data,
          contentType
        );
        // Canonical storage URL persists; Avatar component re-signs for display.
        onUpdateCurrentUserAvatar(uploaded.avatarUrl);
      } catch (error) {
        console.error("Error uploading avatar:", error);
        useToastStore.getState().showToast("Error uploading avatar. Please try another one.", 'error');
      } finally {
        if (event.target) {
            event.target.value = "";
        }
      }
    }
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
  const sideColumn = resolveSideColumn({
    isChatsSectionExpanded,
    appMode: currentAppMode,
    activeCommunity,
  });
  const chatsFlyoutOpen = sideColumn === 'chats';
  const communityColumnOpen = sideColumn === 'community';
  const columnOpen = sideColumn !== null;
  // Width budget (Discord-style): while a column is out, the sidebar renders
  // as its icon rail. Derived only — the user's persisted expanded preference
  // is untouched and comes back the moment the column closes.
  const effectiveExpanded = isExpanded && !columnOpen;
  const showText = effectiveExpanded;

  const handleSidebarToggle = () => {
    if (chatsFlyoutOpen) {
      // "Expand the sidebar" while the chats column is out means: retract the
      // column and show the full sidebar.
      toggleChatsSection();
      if (!isExpanded) onToggleExpand();
      return;
    }
    onToggleExpand();
  };

  const NavButton = ({ navFunc, icon: Icon, label, appMode, activeModes, badgeCount, tipId }: { navFunc: () => void, icon: React.ElementType, label: string, appMode?: AppMode, activeModes?: AppMode[], badgeCount?: number, tipId?: string }) => {
    const isActive = currentAppMode === appMode || (activeModes?.includes(currentAppMode) ?? false);
    return (
    <button
      onClick={navFunc}
      data-tip-id={tipId}
      className={`w-full flex items-center p-3 rounded-xl text-lantern-text-secondary hover:bg-lantern-surface hover:text-lantern-text focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary/40 transition-all duration-150 relative ${
          isActive
            ? 'bg-lantern-primary-background text-lantern-primary font-semibold shadow-lantern'
            : ''
      } ${!canInteractWithChats ? 'opacity-50 cursor-not-allowed' : ''} ${!showText && 'justify-center'}`}
      disabled={!canInteractWithChats && !isSessionPaused}
      title={label}
    >
      <Icon className={`w-5 h-5 flex-shrink-0 ${showText && 'mr-3'} ${isActive ? 'text-lantern-primary' : ''}`} />
      {showText && <span className="flex-grow text-left text-[15px] tracking-tight">{label}</span>}
      {(badgeCount !== undefined && badgeCount > 0) && (
          <span className={`absolute top-1.5 right-1.5 bg-lantern-error text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${!showText && 'px-1.5'}`}>
              {badgeCount}
          </span>
      )}
    </button>
    );
  };

  const SectionHeader = ({ title }: { title: string }) => (
    <div className={`px-3 pt-5 pb-2 ${!showText && 'hidden'}`}>
      <h3 className="text-[11px] font-semibold uppercase text-lantern-text-tertiary tracking-[0.14em]">{title}</h3>
    </div>
  );


  return (
    <>
    <div className={`fixed inset-y-0 left-0 z-40 flex flex-col bg-lantern-background-secondary/90 backdrop-blur-md text-lantern-text border-r border-lantern-border transition-all duration-300 ease-in-out ${effectiveExpanded ? 'w-72' : 'w-20'}`} data-expanded={effectiveExpanded}>
      <div className="flex items-center justify-between h-16 p-4 border-b border-lantern-border flex-shrink-0">
        {showText && (
          <div className="flex items-center gap-2.5">
              <LanternIcon size={28} />
              <h1 className="font-display text-xl font-semibold tracking-tight text-lantern-text">Lantern Study</h1>
          </div>
        )}
        <div className={`flex items-center space-x-1 ${!showText && 'w-full justify-center'}`}>
            <button
              onClick={handleSidebarToggle}
              className="p-2 text-lantern-text-tertiary hover:text-lantern-text hover:bg-lantern-surface rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary/40"
              aria-label={effectiveExpanded ? "Collapse sidebar" : "Expand sidebar"}
            >
              <Bars3Icon className={`w-6 h-6 transition-transform duration-300`} />
            </button>
        </div>
      </div>
      
      <div className="flex-grow overflow-y-auto" data-testid="desktop-sidebar-scroll">
        {isSessionPaused && (
            <div className="p-2 space-y-1">
                <button onClick={() => onResumeSession(sessionAppMode)} className={`w-full flex items-center p-3 rounded-md text-white bg-yellow-500 hover:bg-yellow-600 animate-pulse ${!showText && 'justify-center'}`} title={`Resume ${pausedSessionLabel}`}>
                    <PlayIcon className={`w-6 h-6 ${showText && 'mr-2'}`} />
                    {showText && <span className="font-semibold text-sm">Resume Session</span>}
                </button>
                <button 
                    onClick={onCancelSession} 
                    className={`w-full flex items-center p-2 rounded-md text-red-700 bg-red-100 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-300 dark:hover:bg-red-900/60 ${!showText && 'justify-center'}`} 
                    title="Cancel Session"
                >
                    <XCircleIcon className={`w-5 h-5 ${showText && 'mr-2'}`} />
                    {showText && <span className="font-semibold text-xs">Cancel Session</span>}
                </button>
            </div>
        )}
        <nav aria-label="Primary">
          <SectionHeader title="Library" />
          <div className="px-2 space-y-1">
            <NavButton navFunc={onNavigateToDashboard} icon={Squares2X2Icon} label="Dashboard" appMode={AppMode.DASHBOARD} />
            {onNavigateToLibrary && (
              <NavButton navFunc={onNavigateToLibrary} icon={BookOpenIcon} label="Library" appMode={AppMode.LIBRARY} badgeCount={dueCardsCount > 0 ? dueCardsCount : undefined} tipId="nav.library" />
            )}
          </div>

          <SectionHeader title="Social" />
          <div className="px-2 space-y-1">
            <NavButton navFunc={onOpenNotificationModal} icon={BellAlertIcon} label="Notifications" badgeCount={unreadNotificationCount} />
            <NavButton
              navFunc={onNavigateToDiscover ?? onNavigateToMarketplace}
              icon={GlobeAltIcon}
              label="Discover"
              appMode={onNavigateToDiscover ? AppMode.DISCOVER : AppMode.MARKETPLACE}
              // A community (and its channels) is a Discover destination: the
              // entry stays lit there, Chat does not (founder rule §0a).
              activeModes={onNavigateToDiscover ? [AppMode.COMMUNITY_DETAIL] : undefined}
              tipId="nav.marketplace"
            />
          </div>

          <SectionHeader title="Tools" />
          <div className="px-2 space-y-1">
            <NavButton navFunc={onNavigateToBudgetTracker} icon={BanknotesIcon} label="Budget" appMode={AppMode.BUDGET_TRACKER} tipId="nav.budget" />
            {onNavigateToInvite && (
              <NavButton navFunc={onNavigateToInvite} icon={GiftIcon} label="Invite friends" appMode={AppMode.INVITE_FRIENDS} />
            )}
            <NavButton navFunc={onNavigateToOfflineMode} icon={CloudArrowDownIcon} label="Offline Activity" appMode={AppMode.OFFLINE_MODE} badgeCount={pendingSyncCount} tipId="nav.offline" />
            {isPlatformAdmin && onNavigateToAdmin && (
              <NavButton navFunc={onNavigateToAdmin} icon={UsersIcon} label="Admin" appMode={AppMode.ADMIN} />
            )}
          </div>
        </nav>

        {effectiveExpanded ? (
          <div className="px-3 pt-4 pb-2">
            <button
              type="button"
              onClick={toggleChatsSection}
              data-tip-id="nav.chat"
              className={`w-full flex items-center gap-1.5 min-w-0 text-left rounded-md hover:bg-lantern-background-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary px-1 py-0.5 -ml-1 ${isChatsSectionExpanded ? 'bg-lantern-background-secondary/70' : ''}`}
              aria-expanded={isChatsSectionExpanded}
              title={isChatsSectionExpanded ? 'Close the chats panel' : 'Open chats in a side panel'}
            >
              {/* emerald-700/400 instead of the inline featureAccents.groups
                  (#10b981): that read at 2.34:1 on the light background and,
                  being an inline style, could never adapt to dark mode. */}
              <h3 className="text-xs font-semibold uppercase text-emerald-700 dark:text-emerald-400 tracking-wider truncate">Chats</h3>
              {showChatsHeaderBadge && (
                <span className="bg-lantern-error text-white text-[10px] font-bold min-w-[1.25rem] h-5 px-1 flex items-center justify-center rounded-full flex-shrink-0">
                  {formatUnreadBadgeCount(totalUnreadChatCount)}
                </span>
              )}
              <ChevronRightIcon
                className={`w-4 h-4 text-lantern-text-tertiary flex-shrink-0 ml-auto transition-transform duration-300 ${isChatsSectionExpanded ? 'rotate-180' : ''}`}
              />
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-2 flex flex-col items-center px-2">
            <button
              onClick={toggleChatsSection}
              className={`relative group w-14 h-14 flex items-center justify-center rounded-2xl hover:bg-lantern-background-secondary/60 dark:hover:bg-lantern-surface/60 ${isChatsSectionExpanded ? 'bg-lantern-background-secondary/70' : ''}`}
              title={isChatsSectionExpanded ? 'Close the chats panel' : 'Open chats in a side panel'}
              aria-expanded={isChatsSectionExpanded}
            >
              <ChatBubbleLeftRightIcon className={`w-8 h-8 ${isChatsSectionExpanded ? 'text-lantern-primary' : 'text-lantern-text-secondary'}`} />
              {showChatsHeaderBadge && (
                <span className="absolute top-0 right-0 bg-red-500 text-white text-xs font-bold w-5 h-5 flex items-center justify-center rounded-full border-2 border-lantern-border dark:border-lantern-border">
                  {formatUnreadBadgeCount(totalUnreadChatCount)}
                </span>
              )}
            </button>
          </div>
        )}
      </div>

      <div className="mt-auto p-2 border-t border-lantern-border">
        {showText && (
          <div className="px-2 pb-2">
            <ConnectionBadge
              isOnline={isOnline}
              lowDataMode={lowDataMode}
              pendingSyncCount={pendingSyncCount}
              compact
              className="w-full justify-center"
            />
          </div>
        )}
        {/* AI Usage Badge */}
        {showText ? (
          <AIUsageBadge className="mb-2 mx-1" />
        ) : (
          <AIUsageBadge compact className="mb-2 mx-1 px-1" />
        )}
        {/* Profile row */}
        <div className={`flex items-center ${showText ? 'p-2 pb-1' : 'p-0 flex-col'}`}>
            <div className={`relative group ${showText ? 'mr-3 flex-shrink-0' : 'mb-2'}`} title={showText ? "Change profile picture" : currentUser.name}>
                <Avatar
                  name={currentUser.name}
                  src={resolveAvatarSrc(currentUser.avatarUrl, lowDataMode)}
                  size="md"
                  localOnly={lowDataMode}
                />
                <div 
                  className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-0 group-hover:bg-opacity-50 transition-opacity rounded-full cursor-pointer"
                  onClick={handleAvatarClick}
                >
                  <CameraIcon className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileChange} />
            </div>
            {showText && (
              <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-lantern-text truncate block">{currentUser.name}</span>
                  {/* yellow-400 on the light background was 1.41:1 — amber-800
                      clears AA at this 12px size; yellow-400 back in dark
                      where it reads fine. */}
                  <div className="flex items-center text-xs text-amber-800 dark:text-yellow-400" title={`${currentUser.points} Points`}>
                      <SparklesIcon className="w-4 h-4 mr-1 text-amber-700 dark:text-yellow-500"/>
                      {currentUser.points}
                  </div>
              </div>
            )}
        </div>
        {/* Action buttons row */}
        <div className={`${showText ? 'flex flex-wrap gap-0.5 px-2 pb-1' : 'grid grid-cols-2 gap-0.5 mt-1'}`}>
              <button
                  onClick={onToggleTheme}
                  className="p-2 text-lantern-text-secondary hover:text-lantern-text dark:hover:text-white rounded-full focus:outline-none focus:ring-2 focus:ring-lantern-primary"
                  title="Toggle Theme"
              >
                  {theme === 'light' ? <MoonIcon className="w-6 h-6" /> : <SunIcon className="w-6 h-6" />}
              </button>
              <button
                  onClick={toggleLowDataMode}
                  className={`p-2 rounded-full focus:outline-none focus:ring-2 focus:ring-lantern-primary transition-colors ${
                    lowDataMode
                      ? 'text-amber-500 dark:text-amber-400 hover:text-amber-600 dark:hover:text-amber-300'
                      : 'text-lantern-text-secondary hover:text-lantern-text dark:hover:text-white'
                  }`}
                  title={lowDataMode ? 'Low-Data Mode: ON — click to disable' : 'Low-Data Mode: OFF — click to enable'}
              >
                  {lowDataMode ? <SignalSlashIcon className="w-6 h-6" /> : <SignalIcon className="w-6 h-6" />}
              </button>
              <button
                  onClick={onToggleCompanion}
                  data-tip-id="nav.companion"
                  className={`p-2 rounded-full focus:outline-none focus:ring-2 focus:ring-lantern-primary transition-colors ${
                    isCompanionOpen
                      ? 'text-lantern-primary bg-lantern-primary-background dark:bg-lantern-primary-dark/50'
                      : 'text-lantern-text-secondary hover:text-lantern-primary'
                  }`}
                  title="Lantern AI"
              >
                  <SparklesIcon className="w-6 h-6" />
              </button>
              <button
                  onClick={onOpenSettingsModal}
                  className="p-2 text-lantern-text-secondary hover:text-lantern-text dark:hover:text-white rounded-full focus:outline-none focus:ring-2 focus:ring-lantern-primary"
                  title="Settings"
              >
                  <Cog6ToothIcon className="w-6 h-6" />
              </button>
              <button
                  onClick={onLogout}
                  className="p-2 text-lantern-text-secondary hover:text-red-500 dark:hover:text-red-400 rounded-full focus:outline-none focus:ring-2 focus:ring-red-500"
                  title="Logout"
              >
                  <ArrowLeftOnRectangleIcon className="w-6 h-6" />
              </button>
            </div>
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
      className={`fixed inset-y-0 z-30 bg-lantern-background-secondary/95 backdrop-blur-md border-r border-lantern-border overflow-hidden transition-all duration-300 ease-in-out ${effectiveExpanded ? 'left-72' : 'left-20'} ${columnOpen ? 'w-80' : 'w-0 border-r-0'}`}
    >
      {communityColumnOpen && onCommunityNavigate && (
        <CommunityColumn onNavigate={onCommunityNavigate} />
      )}
      {chatsFlyoutOpen && (
        <div className="w-80 h-full flex flex-col">
          <div className="flex items-center justify-between gap-2 h-16 px-4 border-b border-lantern-border flex-shrink-0">
            <h2 className="text-sm font-bold text-lantern-text flex items-center gap-2 min-w-0">
              <span className="truncate">Chats</span>
              {totalUnreadChatCount > 0 && (
                <span className="bg-lantern-error text-white text-[10px] font-bold min-w-[1.25rem] h-5 px-1 flex items-center justify-center rounded-full flex-shrink-0">
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
                <PlusIcon className="w-4 h-4" />
              </button>
              <button
                onClick={onOpenNewDmModal}
                className={`p-1.5 rounded-md text-lantern-text-secondary hover:text-lantern-primary hover:bg-lantern-background-secondary focus:outline-none focus:ring-2 focus:ring-lantern-primary transition-colors ${!canInteractWithChats ? 'opacity-50 cursor-not-allowed' : ''}`}
                disabled={!canInteractWithChats}
                title="New DM"
              >
                <ChatBubbleLeftRightIcon className="w-4 h-4" />
              </button>
              <button
                onClick={toggleChatsSection}
                className="p-1.5 rounded-md text-lantern-text-secondary hover:text-lantern-text hover:bg-lantern-background-secondary focus:outline-none focus:ring-2 focus:ring-lantern-primary transition-colors"
                title="Close chats panel"
                aria-label="Close chats panel"
              >
                <XMarkIcon className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto py-1">
            {messageRequestChats.length > 0 && (
              <div className="mb-1">
                <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                  Message requests ({messageRequestChats.length})
                </p>
                {messageRequestChats.map((chat) => (
                  <GroupListItem
                    key={chat.id}
                    chat={chat}
                    currentUser={currentUser}
                    // The flyout never renders on the chat screen, so no row
                    // is ever the "current" conversation here.
                    isSelected={false}
                    onClick={canInteractWithChats ? () => onSelectChat(chat) : () => {}}
                    isDisabled={!canInteractWithChats}
                    showText={true}
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
                  isSelected={false}
                  onClick={canInteractWithChats ? () => onSelectChat(chat) : () => {}}
                  isDisabled={!canInteractWithChats}
                  showText={true}
                />
              );
            })}
            {topLevelChats.length === 0 && messageRequestChats.length === 0 && (
              <p className="px-3 py-2 text-sm text-lantern-text-secondary">No active chats.</p>
            )}
            {archivedGroups.length > 0 && (
              <div className="mt-2 pt-2 border-t border-lantern-border">
                <button
                  onClick={() => setIsArchivedExpanded(!isArchivedExpanded)}
                  className="w-full flex items-center justify-between p-3 text-xs font-semibold text-lantern-text-secondary uppercase hover:text-lantern-text focus:outline-none"
                  aria-expanded={isArchivedExpanded}
                >
                  <span className="flex items-center"><ArchiveBoxIcon className="w-4 h-4 mr-2"/> Archived</span>
                  {isArchivedExpanded ? <ChevronDownIcon className="w-5 h-5" /> : <ChevronRightIcon className="w-5 h-5" />}
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