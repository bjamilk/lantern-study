import React from 'react';
import { Group, DMThread, User, ChatItem } from '../types';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/solid';
import { ArchiveBoxIcon, UserCircleIcon } from '@heroicons/react/24/outline';
import { Avatar } from './ui';
import { resolveAvatarSrc } from '../utils/avatar';
import { useUIStore } from '../stores/uiStore';

interface GroupListItemProps {
  chat: ChatItem;
  currentUser: User;
  isSelected: boolean;
  onClick: () => void;
  isDisabled?: boolean;
  isSubGroup?: boolean;
  nestingLevel?: number; // 0 = top level, 1 = first level subgroup, 2 = second level, etc.
  hasSubGroups?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  showText?: boolean;
}

const GroupListItem: React.FC<GroupListItemProps> = ({ 
  chat, 
  currentUser,
  isSelected, 
  onClick, 
  isDisabled,
  isSubGroup = false,
  nestingLevel = 0,
  hasSubGroups = false,
  isExpanded = false,
  onToggleExpand,
  showText = true,
}) => {
  const { lowDataMode } = useUIStore();
  const isGroup = chat.chatType === 'group';
  const name = isGroup ? chat.name : (chat.participantIds.find(id => id !== currentUser.id) ? chat.participants[chat.participantIds.find(id => id !== currentUser.id)!].name : 'Unknown');
  const avatarUrl = isGroup ? chat.avatarUrl : (chat.participantIds.find(id => id !== currentUser.id) ? chat.participants[chat.participantIds.find(id => id !== currentUser.id)!].avatarUrl : undefined);
  const unreadCount = chat.unreadCount || 0;
  const isArchived = isGroup ? chat.isArchived : (chat as any).isArchived;
  
  const baseClasses = `flex items-center w-full p-3 md:p-3 py-3.5 md:py-3 border-l-4 transition-colors duration-150 min-h-[52px]`;
  const selectedClasses = isSelected ? 'bg-indigo-100 dark:bg-indigo-900/40 border-indigo-500' : 'border-transparent hover:bg-slate-200/60 dark:hover:bg-slate-800/60';
  const disabledClasses = isDisabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer';
  // Calculate indentation based on nesting level: 12px base + 16px per level
  const indentPadding = showText ? `${12 + (nestingLevel * 16)}px` : '12px';
  const archivedClasses = isArchived ? 'opacity-60' : '';
  const collapsedClasses = !showText ? 'justify-center' : '';

  const handleItemClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (onToggleExpand && (e.target as HTMLElement).closest('.expand-toggle-button')) {
      return;
    }
    if (!isDisabled) {
      onClick();
    }
  };
  
  const handleToggleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if ((e.key === 'Enter' || e.key === ' ') && onToggleExpand) {
      e.preventDefault();
      onToggleExpand();
    }
  };

  const handleItemKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.key === 'Enter' || e.key === ' ') && !isDisabled && !onToggleExpand) {
        onClick();
    }
  };


  return (
    <div
      className={`${baseClasses} ${selectedClasses} ${disabledClasses} ${archivedClasses} ${collapsedClasses}`}
      style={{ paddingLeft: indentPadding }}
      onClick={handleItemClick}
      aria-disabled={isDisabled}
      role="button"
      tabIndex={isDisabled ? -1 : 0}
      onKeyDown={handleItemKeyDown}
      title={!showText ? name : undefined}
    >
      {hasSubGroups && onToggleExpand && showText && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand();
          }}
          onKeyDown={handleToggleKeyDown}
          className="expand-toggle-button p-0.5 mr-1.5 rounded-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-500"
          aria-expanded={isExpanded}
          aria-label={isExpanded ? `Collapse ${name}` : `Expand ${name}`}
        >
          {isExpanded ? <ChevronDownIcon className="w-4 h-4" /> : <ChevronRightIcon className="w-4 h-4" />}
        </button>
      )}
      {!hasSubGroups && !isSubGroup && showText && <div className="w-[1.375rem] mr-1.5 flex-shrink-0"></div>}
      
      {isGroup ? (
        <Avatar
          name={name}
          src={resolveAvatarSrc(avatarUrl, lowDataMode)}
          size="md"
          localOnly={lowDataMode}
          className="flex-shrink-0"
        />
      ) : (
        <Avatar
          name={name}
          src={resolveAvatarSrc(avatarUrl, lowDataMode)}
          size="md"
          localOnly={lowDataMode}
          className="flex-shrink-0"
        />
      )}
      {showText && (
        <>
            <div className="flex-1 min-w-0 ml-2.5">
                <p className="font-semibold truncate text-slate-800 dark:text-slate-100">{name}</p>
            </div>
            {isArchived && <ArchiveBoxIcon className="w-4 h-4 text-slate-500 ml-2 flex-shrink-0" title="Archived"/>}
            {unreadCount > 0 && !isArchived && (
                <span className="ml-2 bg-red-500 text-white text-xs font-bold w-5 h-5 flex items-center justify-center rounded-full flex-shrink-0">
                    {unreadCount > 9 ? '9+' : unreadCount}
                </span>
            )}
        </>
      )}
    </div>
  );
};

export default GroupListItem;