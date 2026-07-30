import React from 'react';
import { Group, DMThread, User, ChatItem } from '../types';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/solid';
import { ArchiveBoxIcon, UserCircleIcon } from '@heroicons/react/24/outline';
import { Avatar } from './ui';
import { resolveAvatarSrc } from '../utils/avatar';
import { useUIStore } from '../stores/uiStore';
import { featureAccents } from '@lantern/shared/design';
import { formatUnreadBadgeCount } from '../utils/chatUnread';

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
  const isMessageRequest =
    !isGroup &&
    (chat as DMThread).status === 'pending' &&
    typeof (chat as DMThread).requestedBy === 'string' &&
    (chat as DMThread).requestedBy !== currentUser.id;
  
  const baseClasses = `flex items-center w-full p-3 md:p-3 py-3.5 md:py-3 border-l-4 transition-colors duration-200 min-h-[52px]`;
  const accentBorder = isSubGroup || nestingLevel > 0 ? featureAccents.groups : undefined;
  const selectedClasses = isSelected
    ? `bg-lantern-primary-background ${accentBorder ? '' : 'border-lantern-primary'}`
    : 'border-transparent hover:bg-lantern-background-secondary';
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
      className={`${baseClasses} ${selectedClasses} ${archivedClasses} ${collapsedClasses}`}
      style={{
        paddingLeft: indentPadding,
        ...(accentBorder && isSelected ? { borderLeftColor: accentBorder } : {}),
        ...(accentBorder && !isSelected && nestingLevel > 0
          ? { borderLeftColor: `${accentBorder}40` }
          : {}),
      }}
      title={!showText ? name : undefined}
    >
      {hasSubGroups && onToggleExpand && showText && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand();
          }}
          onKeyDown={handleToggleKeyDown}
          className="expand-toggle-button p-0.5 mr-1.5 rounded-sm text-lantern-text-tertiary hover:text-lantern-text focus:outline-none focus:ring-1 focus:ring-lantern-primary shrink-0"
          aria-expanded={isExpanded}
          aria-label={isExpanded ? `Collapse ${name}` : `Expand ${name}`}
        >
          {isExpanded ? <ChevronDownIcon className="w-4 h-4" /> : <ChevronRightIcon className="w-4 h-4" />}
        </button>
      )}
      {!hasSubGroups && !isSubGroup && showText && <div className="w-[1.375rem] mr-1.5 flex-shrink-0"></div>}

      <div
        className={`flex items-center flex-1 min-w-0 ${disabledClasses}`}
        onClick={handleItemClick}
        aria-disabled={isDisabled}
        role="button"
        tabIndex={isDisabled ? -1 : 0}
        onKeyDown={handleItemKeyDown}
      >
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
                <p className="font-semibold truncate text-lantern-text">{name}</p>
                {isMessageRequest && (
                  <p className="text-xs text-amber-700 dark:text-amber-300 truncate">Message request</p>
                )}
            </div>
            {isArchived && <ArchiveBoxIcon className="w-4 h-4 text-lantern-text-tertiary ml-2 flex-shrink-0" title="Archived"/>}
            {unreadCount > 0 && !isArchived && (
                <span className="ml-2 bg-lantern-error text-white text-xs font-bold min-w-[1.25rem] h-5 px-1 flex items-center justify-center rounded-full flex-shrink-0">
                    {formatUnreadBadgeCount(unreadCount)}
                </span>
            )}
        </>
      )}
      </div>
    </div>
  );
};

export default GroupListItem;