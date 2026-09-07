import React from 'react';
import { Group, DMThread, User, ChatItem } from '../types';
import { Avatar } from './ui';
import { resolveAvatarSrc } from '../utils/avatar';
import { useUIStore } from '../stores/uiStore';
import { chatMessagePreview } from '@lantern/shared/utils';
import { formatUnreadBadgeCount } from '../utils/chatUnread';
import { AppIcon } from './ui/AppIcon';

// Compact recency label for a conversation row (WhatsApp-style: now / 5m / 3h / 2d / Aug 8).
const formatRowTime = (input?: string | Date | null): string => {
  if (!input) return '';
  const d = typeof input === 'string' ? new Date(input) : input;
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (Number.isNaN(secs)) return '';
  if (secs < 60) return 'now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  if (secs < 604800) return `${Math.floor(secs / 86400)}d`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

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
  // DM threads can list a peer id before (or without) a hydrated participants map entry.
  const otherParticipantId = !isGroup
    ? chat.participantIds?.find((id) => id !== currentUser.id)
    : undefined;
  const otherParticipant = otherParticipantId
    ? chat.participants?.[otherParticipantId]
    : undefined;
  const name = isGroup
    ? chat.name
    : (otherParticipant?.name || otherParticipant?.username || 'Direct message');
  const avatarUrl = isGroup ? chat.avatarUrl : otherParticipant?.avatarUrl;
  const unreadCount = chat.unreadCount || 0;
  const isArchived = isGroup ? chat.isArchived : (chat as any).isArchived;
  const isMessageRequest =
    !isGroup &&
    (chat as DMThread).status === 'pending' &&
    typeof (chat as DMThread).requestedBy === 'string' &&
    (chat as DMThread).requestedBy !== currentUser.id;
  // Last-message preview + recency for the row's second line. `chatMessagePreview`
  // renders "Photo"/"Voice note" rather than raw ![image](url)/audio markdown.
  const lastMessageRaw = (chat as Group | DMThread).lastMessage;
  const lastMessageAt = isGroup
    ? (chat as Group).lastMessageTime
    : (chat as DMThread).lastMessageTimestamp;
  const preview = lastMessageRaw ? chatMessagePreview(lastMessageRaw, '') : '';
  const timeLabel = formatRowTime(lastMessageAt);
  
  const baseClasses = `flex items-center w-full p-3 md:p-3 py-3.5 md:py-3 border-l-4 transition-colors duration-200 min-h-[52px]`;
  // The left border marks the SELECTED chat only. Sub-groups are shown by
  // indentation, not by a coloured edge.
  const accentBorder = undefined;
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
          {isExpanded ? <AppIcon name="chevron-down" size={16} /> : <AppIcon name="chevron-forward" size={16} />}
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
                <div className="flex items-center gap-2">
                  <p className="font-semibold truncate text-lantern-text flex-1 min-w-0">{name}</p>
                  {timeLabel && !isMessageRequest && (
                    <span className="text-label tracking-normal font-medium text-lantern-text-tertiary shrink-0">{timeLabel}</span>
                  )}
                </div>
                {isMessageRequest ? (
                  <p className="text-xs text-amber-700 dark:text-amber-300 truncate">Message request</p>
                ) : preview ? (
                  <p className="text-xs text-lantern-text-secondary truncate">{preview}</p>
                ) : null}
            </div>
            {isArchived && <AppIcon name="archive" size={16} className="text-lantern-text-tertiary ml-2 flex-shrink-0" title="Archived" />}
            {unreadCount > 0 && !isArchived && (
                <span className="ml-2 bg-lantern-error-strong text-white text-xs font-bold min-w-[1.25rem] h-5 px-1 flex items-center justify-center rounded-full flex-shrink-0">
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