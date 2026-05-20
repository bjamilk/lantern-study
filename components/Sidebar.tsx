import React, { useRef, useState, useMemo } from 'react';
import { Group, AppMode, User, Badge, DMThread, TestSessionData, StudySessionData, ChatItem } from '../types';
import GroupListItem from './GroupListItem';
import AIUsageBadge from './AIUsageBadge';
import { PlusIcon, Squares2X2Icon, CameraIcon, CloudArrowDownIcon, ArrowLeftOnRectangleIcon, ArchiveBoxIcon, ChevronDownIcon, ChevronRightIcon, SparklesIcon, Cog6ToothIcon, BookOpenIcon, ChatBubbleLeftRightIcon, LightBulbIcon, UsersIcon, BellAlertIcon, BanknotesIcon, Bars3Icon, ShoppingBagIcon, PlusCircleIcon, PlayIcon, XCircleIcon, SunIcon, MoonIcon } from '@heroicons/react/24/outline';

interface SidebarProps {
  currentUser: User;
  groups: Group[];
  dmThreads: DMThread[];
  selectedChatId: string | undefined;
  onSelectChat: (chat: ChatItem) => void;
  onNavigateToCreateGroup: () => void;
  onNavigateToDashboard: () => void;
  onNavigateToOfflineMode: () => void;
  onNavigateToFlashcards: () => void;
  onNavigateToBudgetTracker: () => void;
  onNavigateToMarketplace: () => void;
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
  onResumeSession: (mode: AppMode) => void;
  onCancelSession: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  dueCardsCount: number;
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
  onNavigateToFlashcards,
  onNavigateToBudgetTracker,
  onNavigateToMarketplace,
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
  onResumeSession,
  onCancelSession,
  theme,
  onToggleTheme,
  dueCardsCount,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [expandedParentGroups, setExpandedParentGroups] = useState<Record<string, boolean>>({});
  const [isArchivedExpanded, setIsArchivedExpanded] = useState(false);
  
  const canInteractWithChats = ![AppMode.TEST_ACTIVE, AppMode.STUDY_ACTIVE].includes(currentAppMode);
  
  const activeSession = activeTestSession || activeStudySession;
  const sessionAppMode = activeTestSession ? AppMode.TEST_ACTIVE : AppMode.STUDY_ACTIVE;
  const isSessionPaused = activeSession && currentAppMode !== sessionAppMode;

  const { topLevelChats, subGroupsMap, archivedGroups } = useMemo(() => {
    const allChats: ChatItem[] = [
      ...groups.map(g => ({ ...g, chatType: 'group' as const })),
      ...dmThreads.map(t => ({ ...t, chatType: 'dm' as const }))
    ];

    allChats.sort((a, b) => {
        const timeA = a.chatType === 'group' ? (a.lastMessageTime ? new Date(a.lastMessageTime).getTime() : 0) : (a.lastMessageTimestamp ? new Date(a.lastMessageTimestamp).getTime() : 0);
        const timeB = b.chatType === 'group' ? (b.lastMessageTime ? new Date(b.lastMessageTime).getTime() : 0) : (b.lastMessageTimestamp ? new Date(b.lastMessageTimestamp).getTime() : 0);
        return timeB - timeA;
    });

    const topLevel: ChatItem[] = [];
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
        } else {
          topLevel.push(chat);
        }
      }
    });

    for (const parentId in subMap) {
        subMap[parentId].sort((a, b) => a.name.localeCompare(b.name));
    }

    return { topLevelChats: topLevel, subGroupsMap: subMap, archivedGroups: archived };
  }, [groups, dmThreads]);
  
  const toggleParentGroupExpansion = (groupId: string) => {
    setExpandedParentGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  // Recursive function to render a group and its subgroups
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
          showText={showText}
        />
        {isExpanded && showText && isGroupExpanded && subGroups.map(subGroup => 
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

  const convertFileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      try {
        if (file.size > 2 * 1024 * 1024) { 
          alert("Image is too large. Please select an image under 2MB.");
          return;
        }
        const base64 = await convertFileToBase64(file);
        onUpdateCurrentUserAvatar(base64);
      } catch (error) {
        console.error("Error converting file to base64:", error);
        alert("Error processing image. Please try another one.");
      } finally {
        if (event.target) {
            event.target.value = "";
        }
      }
    }
  };
  
  const showText = isExpanded;

  const NavButton = ({ navFunc, icon: Icon, label, appMode, badgeCount }: { navFunc: () => void, icon: React.ElementType, label: string, appMode?: AppMode, badgeCount?: number }) => (
    <button
      onClick={navFunc}
      className={`w-full flex items-center p-3 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors duration-150 relative ${
          currentAppMode === appMode ? 'bg-slate-200 dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 font-semibold' : ''
      } ${!canInteractWithChats ? 'opacity-50 cursor-not-allowed' : ''} ${!showText && 'justify-center'}`}
      disabled={!canInteractWithChats && !isSessionPaused}
      title={label}
    >
      <Icon className={`w-5 h-5 flex-shrink-0 ${showText && 'mr-3'}`} />
      {showText && <span className="flex-grow text-left">{label}</span>}
      {(badgeCount !== undefined && badgeCount > 0) && (
          <span className={`absolute top-1.5 right-1.5 bg-red-500 text-white text-xs font-semibold px-2 py-0.5 rounded-full ${!showText && 'px-1.5'}`}>
              {badgeCount}
          </span>
      )}
    </button>
  );

  const SectionHeader = ({ title }: { title: string }) => (
    <div className={`px-3 pt-4 pb-2 ${!showText && 'hidden'}`}>
      <h3 className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 tracking-wider">{title}</h3>
    </div>
  );


  return (
    <div className={`fixed inset-y-0 left-0 z-40 flex flex-col bg-slate-100 dark:bg-slate-900 text-slate-800 dark:text-slate-200 border-r border-slate-200 dark:border-slate-700 transition-all duration-300 ease-in-out ${isExpanded ? 'w-64' : 'w-20'}`} data-expanded={isExpanded}>
      <div className="flex items-center justify-between h-16 p-4 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
        {showText && (
          <div className="flex items-center">
              <LightBulbIcon className="w-7 h-7 mr-2 text-yellow-300"/>
              <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Lantern Study</h1>
          </div>
        )}
        <div className={`flex items-center space-x-1 ${!showText && 'w-full justify-center'}`}>
            <button
              onClick={onToggleExpand}
              className="p-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-full focus:outline-none focus:ring-2 focus:ring-indigo-500"
              aria-label={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
            >
              <Bars3Icon className={`w-6 h-6 transition-transform duration-300`} />
            </button>
        </div>
      </div>
      
      <div className="flex-grow overflow-y-auto">
        {isSessionPaused && (
            <div className="p-2 space-y-1">
                <button onClick={() => onResumeSession(sessionAppMode)} className={`w-full flex items-center p-3 rounded-md text-white bg-yellow-500 hover:bg-yellow-600 animate-pulse ${!showText && 'justify-center'}`} title={`Resume ${activeTestSession ? 'Test' : 'Study'}`}>
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
        <SectionHeader title="Study" />
        <div className="px-2 space-y-1">
          <NavButton navFunc={onNavigateToDashboard} icon={Squares2X2Icon} label="Dashboard" appMode={AppMode.DASHBOARD} />
          <NavButton navFunc={onNavigateToFlashcards} icon={BookOpenIcon} label="Flashcards" appMode={AppMode.FLASHCARDS} badgeCount={dueCardsCount} />
        </div>

        <SectionHeader title="Social" />
        <div className="px-2 space-y-1">
          <NavButton navFunc={onOpenNotificationModal} icon={BellAlertIcon} label="Notifications" badgeCount={unreadNotificationCount} />
          <NavButton navFunc={onNavigateToMarketplace} icon={ShoppingBagIcon} label="Marketplace" appMode={AppMode.MARKETPLACE} />
        </div>

        <SectionHeader title="Tools" />
        <div className="px-2 space-y-1">
          <NavButton navFunc={onNavigateToBudgetTracker} icon={BanknotesIcon} label="Budget Tracker" appMode={AppMode.BUDGET_TRACKER} />
          <NavButton navFunc={onNavigateToOfflineMode} icon={CloudArrowDownIcon} label="Offline Activity" appMode={AppMode.OFFLINE_MODE} badgeCount={pendingSyncCount} />
        </div>

        {isExpanded ? (
          <>
            <div className={`px-3 pt-4 pb-2 flex items-center justify-between`}>
              <h3 className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 tracking-wider">Chats</h3>
              <div className="flex gap-1">
                <button
                  onClick={onNavigateToCreateGroup}
                  className={`p-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-200 dark:hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-colors ${!canInteractWithChats ? 'opacity-50 cursor-not-allowed' : ''}`}
                  disabled={!canInteractWithChats}
                  title="New Group"
                >
                  <PlusIcon className="w-4 h-4" />
                </button>
                <button
                  onClick={onOpenNewDmModal}
                  className={`p-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-200 dark:hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-colors ${!canInteractWithChats ? 'opacity-50 cursor-not-allowed' : ''}`}
                  disabled={!canInteractWithChats}
                  title="New DM"
                >
                  <ChatBubbleLeftRightIcon className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div>
              {topLevelChats.map((chat) => {
                  if (chat.chatType === 'group') {
                    // Use recursive render for groups
                    return renderGroupWithSubgroups(chat, 0);
                  } else {
                    // Render DM threads normally
                    return (
                      <GroupListItem
                        key={chat.id}
                        chat={chat}
                        currentUser={currentUser}
                        isSelected={selectedChatId === chat.id && currentAppMode === AppMode.CHAT}
                        onClick={canInteractWithChats ? () => onSelectChat(chat) : () => {}}
                        isDisabled={!canInteractWithChats}
                        showText={showText}
                      />
                    );
                  }
              })}
              {topLevelChats.length === 0 && showText && <p className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">No active chats.</p>}
              {archivedGroups.length > 0 && showText && (
                <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                    <button
                        onClick={() => setIsArchivedExpanded(!isArchivedExpanded)}
                        className="w-full flex items-center justify-between p-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase hover:text-slate-900 dark:hover:text-white focus:outline-none"
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
                                    showText={showText}
                                />
                            ))}
                        </div>
                    )}
                </div>
              )}
            </div>
          </>
        ) : (
             <div className="mt-4 space-y-2 flex flex-col items-center px-2">
                {groups.filter(g => !g.isArchived).map(group => {
                    const hasSubgroups = subGroupsMap[group.id] && subGroupsMap[group.id].length > 0;
                    return (
                    <button
                        key={group.id}
                        onClick={() => {
                            onSelectChat({...group, chatType: 'group'});
                            // when the sidebar is collapsed on a narrow/mobile viewport,
                            // automatically expand it and also expand the tapped parent group
                            // so that any subgroups are revealed immediately. This makes it
                            // much easier to navigate into nested groups from mobile mode.
                            if (!isExpanded) {
                                onToggleExpand();
                                setExpandedParentGroups(prev => ({ ...prev, [group.id]: true }));
                            }
                        }}
                        className="relative group w-14 h-14 flex items-center justify-center"
                        title={group.name}
                        >
                        <img
                            src={group.avatarUrl || `https://ui-avatars.com/api/?name=${group.name.replace(/\s/g, '+')}&background=random&color=fff&size=50`}
                            alt={group.name}
                            className={`w-12 h-12 rounded-full object-cover transition-all duration-200 group-hover:rounded-2xl ${selectedChatId === group.id ? 'ring-4 ring-indigo-500 rounded-2xl' : ''}`}
                            onError={(e) => { e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='%239ca3af' viewBox='0 0 24 24'%3E%3Cpath d='M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z'/%3E%3C/svg%3E"; }}
                        />
                        {(group.unreadCount ?? 0) > 0 && (
                            <span className="absolute top-0 right-0 bg-red-500 text-white text-xs font-bold w-5 h-5 flex items-center justify-center rounded-full border-2 border-slate-100 dark:border-slate-900">
                            {(group.unreadCount ?? 0) > 9 ? '9+' : group.unreadCount}
                            </span>
                        )}
                        {hasSubgroups && (
                          <span className="absolute bottom-1 right-1 w-2 h-2 bg-indigo-500 rounded-full" />
                        )}
                    </button>
                    );
                })}
             </div>
        )}
      </div>

      <div className="mt-auto p-2 border-t border-slate-200 dark:border-slate-700">
        {/* AI Usage Badge */}
        {showText ? (
          <AIUsageBadge className="mb-2 mx-1" />
        ) : (
          <AIUsageBadge compact className="mb-2 mx-1 px-1" />
        )}
        <div className={`flex items-center ${showText ? 'p-2' : 'p-0 flex-col'}`}>
            <div className={`relative group ${showText ? 'mr-3' : 'mb-2'}`} title={showText ? "Change profile picture" : currentUser.name}>
                <img 
                src={currentUser.avatarUrl || `https://ui-avatars.com/api/?name=${currentUser.name.replace(/\s/g, '+')}&background=random&color=fff&size=40`}
                alt={currentUser.name} 
                className="w-10 h-10 rounded-full object-cover border-2 border-transparent group-hover:border-indigo-400 transition-colors"
                onError={(e) => { e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='%239ca3af' viewBox='0 0 24 24'%3E%3Cpath d='M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z'/%3E%3C/svg%3E"; }}
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
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate block">{currentUser.name}</span>
                  <div className="flex items-center text-xs text-yellow-400" title={`${currentUser.points} Points`}>
                      <SparklesIcon className="w-4 h-4 mr-1 text-yellow-500"/>
                      {currentUser.points}
                  </div>
              </div>
            )}
            <div className={`flex ${showText ? 'space-x-1' : 'flex-col space-y-1 mt-1'}`}>
              <button
                  onClick={onToggleTheme}
                  className="p-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-full focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  title="Toggle Theme"
              >
                  {theme === 'light' ? <MoonIcon className="w-6 h-6" /> : <SunIcon className="w-6 h-6" />}
              </button>
              <button
                  onClick={onOpenSettingsModal}
                  className="p-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-full focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  title="Settings"
              >
                  <Cog6ToothIcon className="w-6 h-6" />
              </button>
              <button
                  onClick={onLogout}
                  className="p-2 text-slate-500 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 rounded-full focus:outline-none focus:ring-2 focus:ring-red-500"
                  title="Logout"
              >
                  <ArrowLeftOnRectangleIcon className="w-6 h-6" />
              </button>
            </div>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;