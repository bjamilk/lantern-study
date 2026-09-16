/**
 * The chat header's overflow (⋮) menu — both variants: the group menu (search,
 * starred, photos, group info, the question-visibility submenu, mute, sub-group,
 * test/study at small widths, AI generate, archive) and the DM menu (search,
 * starred, photos, mute, archive, block, report, delete).
 *
 * Extracted verbatim from `components/chat/ChatHeader.tsx` (lane M8, step 1),
 * which had itself just come out of `components/ChatWindow.tsx`. Splitting the
 * menu off is what brings both files to a JSX nesting of 6 or less; it owns no
 * state of its own.
 *
 * Touches: `confirmStore.confirmDialog`, for the Delete Conversation prompt —
 * the confirmation belongs to the menu item, not to the caller.
 *
 * Gotchas:
 *  - `handleDropdownAction` closes the menu AFTER running the action. Calling an
 *    action without it leaves the menu open over the thing it just opened.
 *  - The `lg:hidden` block holds Test and Study because the header toolbar shows
 *    them at lg+; each affordance must appear in exactly one place per breakpoint.
 *  - `communityHost` removes the entire study apparatus and the archive action —
 *    a community's chat is not a study group and is not a member's to archive
 *    (§5.4 / §6).
 */
import React from 'react';
import {
  CHAT_MUTE_DURATIONS,
  type ChatMuteDurationId,
} from '@lantern/shared';
import { QUESTION_VISIBILITY_MODE_OPTIONS, type QuestionVisibilityMode } from '@lantern/shared/utils';
import type { ContentReportTargetType } from '@lantern/shared';
import { Menu, MenuTrigger, MenuContent, MenuItem, MenuSubmenu, MenuSeparator } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { confirmDialog } from '../../stores/confirmStore';
import type { ChatItem, Group } from '../../types';

export interface ChatHeaderMenuProps {
  chat: ChatItem;
  group: (Group & { members: unknown[] }) | null;
  isGroup: boolean;
  isGroupAdmin: boolean;
  isArchived: boolean;
  communityHost: boolean;
  /** Conversation title — used as the label on a "Report User…" report. */
  name: string;
  dmPeerId?: string;

  isDropdownOpen: boolean;
  setIsDropdownOpen: (open: boolean) => void;
  questionFiltersOpen: boolean;
  setQuestionFiltersOpen: (open: boolean) => void;
  questionVisibilityMode: QuestionVisibilityMode;
  setQuestionVisibilityMode: (mode: QuestionVisibilityMode) => void;
  starredOnly: boolean;
  setStarredOnly: React.Dispatch<React.SetStateAction<boolean>>;
  starredIds: Set<string>;
  setGalleryOpen: (open: boolean) => void;
  setThreadSearchOpen: (open: boolean) => void;
  setReportTarget: (target: { type: ContentReportTargetType; id: string; label?: string } | null) => void;

  chatMuted: boolean;
  muteBusy: boolean;
  muteUntilLabel: string | null;
  muteDurationsOpen: boolean;
  setMuteDurationsOpen: (open: boolean) => void;
  handleMuteFor: (duration: ChatMuteDurationId) => Promise<void> | void;
  handleUnmute: () => Promise<void> | void;

  onOpenTestConfigModal: () => void;
  onOpenStudyConfigModal: () => void;
  onOpenGroupInfoModal: () => void;
  onOpenCreateSubGroupModal: (parentId: string) => void;
  onOpenAIGenerateModal?: () => void;
  onToggleArchiveGroup: (groupId: string) => void;
  onArchiveDmThread?: (threadId: string) => void;
  onUnarchiveDmThread?: (threadId: string) => void;
  onDeleteDmThread?: (threadId: string) => void;
  handleToggleDmBlock: () => Promise<void> | void;
  iBlockedThem: boolean;
}

export const ChatHeaderMenu: React.FC<ChatHeaderMenuProps> = ({
  chat,
  group,
  isGroup,
  isGroupAdmin,
  isArchived,
  communityHost,
  name,
  dmPeerId,
  isDropdownOpen,
  setIsDropdownOpen,
  questionFiltersOpen,
  setQuestionFiltersOpen,
  questionVisibilityMode,
  setQuestionVisibilityMode,
  starredOnly,
  setStarredOnly,
  starredIds,
  setGalleryOpen,
  setThreadSearchOpen,
  setReportTarget,
  chatMuted,
  muteBusy,
  muteUntilLabel,
  muteDurationsOpen,
  setMuteDurationsOpen,
  handleMuteFor,
  handleUnmute,
  onOpenTestConfigModal,
  onOpenStudyConfigModal,
  onOpenGroupInfoModal,
  onOpenCreateSubGroupModal,
  onOpenAIGenerateModal,
  onToggleArchiveGroup,
  onArchiveDmThread,
  onUnarchiveDmThread,
  onDeleteDmThread,
  handleToggleDmBlock,
  iBlockedThem,
}) => {
  const handleDropdownAction = (action: () => void) => {
    action();
    setIsDropdownOpen(false);
  };

  const muteOverflowMenu = chatMuted ? (
    <MenuItem
      onSelect={() => handleDropdownAction(() => void handleUnmute())}
      icon={<AppIcon name="notifications-alert" size={16} className="text-lantern-text-tertiary" />}
      disabled={muteBusy}
    >
      Unmute{muteUntilLabel ? ` (until ${muteUntilLabel})` : ''}
    </MenuItem>
  ) : (
    <MenuSubmenu
      label="Mute"
      icon={<AppIcon name="notifications-off" size={16} className="text-lantern-text-tertiary" />}
      open={muteDurationsOpen}
      onOpenChange={setMuteDurationsOpen}
    >
      {CHAT_MUTE_DURATIONS.map((opt) => (
        <MenuItem
          key={opt.id}
          onSelect={() => handleDropdownAction(() => void handleMuteFor(opt.id))}
          className="pl-8"
          disabled={muteBusy}
        >
          {opt.label}
        </MenuItem>
      ))}
    </MenuSubmenu>
  );

  return (
    <Menu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
    <div className="relative">
      <MenuTrigger
        className="p-2 text-lantern-text-secondary hover:text-lantern-primary hover:bg-lantern-background-secondary rounded-lantern transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
        aria-label="Chat options"
        data-tip-id={isGroupAdmin ? 'chat.aiGenerate' : undefined}
      >
        <AppIcon name="ellipsis-vertical" size={20} />
      </MenuTrigger>
      {isGroup && group && (
        <MenuContent align="end" className="w-56">
          <MenuItem onSelect={() => handleDropdownAction(() => setThreadSearchOpen(true))} icon={<AppIcon name="search" size={16} className="text-lantern-text-tertiary" />}>
            Search messages
          </MenuItem>
          <MenuItem
            onSelect={() => handleDropdownAction(() => setStarredOnly((on) => !on))}
            icon={<AppIcon name="star" size={16} className="text-lantern-text-tertiary" />}
            disabled={!starredOnly && starredIds.size === 0}
          >
            {starredOnly ? 'Show all messages' : `Starred messages${starredIds.size > 0 ? ` (${starredIds.size})` : ''}`}
          </MenuItem>
          <MenuItem onSelect={() => handleDropdownAction(() => setGalleryOpen(true))} icon={<AppIcon name="image" size={16} className="text-lantern-text-tertiary" />}>
            Photos and voice
          </MenuItem>
          <MenuSeparator />
          <MenuItem onSelect={() => handleDropdownAction(onOpenGroupInfoModal)} icon={<AppIcon name="people" size={16} className="text-lantern-text-tertiary" />}>
            Group Info & Members
          </MenuItem>
          <MenuSeparator />
          {communityHost ? null : (
            <>
              <MenuSubmenu
                label="All questions"
                open={questionFiltersOpen}
                onOpenChange={setQuestionFiltersOpen}
              >
                {QUESTION_VISIBILITY_MODE_OPTIONS.map((opt) => (
                  <MenuItem
                    key={opt.value}
                    onSelect={() =>
                      handleDropdownAction(() => setQuestionVisibilityMode(opt.value))
                    }
                    className={`pl-8 ${
                      questionVisibilityMode === opt.value
                        ? 'text-lantern-primary font-medium'
                        : ''
                    }`}
                  >
                    {opt.label}
                    {questionVisibilityMode === opt.value ? ' ✓' : ''}
                  </MenuItem>
                ))}
              </MenuSubmenu>
              <MenuSeparator />
            </>
          )}
          <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-lantern-text-tertiary">
            Notifications
          </div>
          {muteOverflowMenu}
          <MenuSeparator />
          {isArchived ? (
            <MenuItem
              onSelect={() => handleDropdownAction(() => onToggleArchiveGroup(group.id))}
              icon={<AppIcon name="archive" size={16} />}
              className="text-amber-700 dark:text-amber-400"
            >
              Unarchive Group
            </MenuItem>
          ) : (
            <>
              {/* Every study affordance below belongs to a study group
                  now, and a community's chat is never archivable by a
                  member (§5.4 / §6). */}
              {communityHost ? null : (
                <>
                  <MenuItem
                    onSelect={() => handleDropdownAction(() => onOpenCreateSubGroupModal(group.id))}
                    icon={<AppIcon name="add-circle" size={16} className="text-lantern-text-tertiary" />}
                  >
                    Create Sub-group
                  </MenuItem>
                  <MenuSeparator />
                  <div className="lg:hidden">
                    <MenuItem onSelect={() => handleDropdownAction(onOpenTestConfigModal)} icon={<AppIcon name="clipboard-check" size={16} className="text-lantern-text-tertiary" />}>
                      Take a Test
                    </MenuItem>
                    <MenuItem onSelect={() => handleDropdownAction(onOpenStudyConfigModal)} icon={<AppIcon name="book-open" size={16} className="text-lantern-text-tertiary" />}>
                      Study Mode
                    </MenuItem>
                  </div>
                  {onOpenAIGenerateModal && isGroupAdmin && (
                    <MenuItem
                      onSelect={() => handleDropdownAction(onOpenAIGenerateModal)}
                      icon={<AppIcon name="sparkles" size={16} />}
                      className="text-lantern-primary"
                    >
                      AI Generate Questions
                    </MenuItem>
                  )}
                  <MenuSeparator />
                  <MenuItem
                    onSelect={() => handleDropdownAction(() => onToggleArchiveGroup(group.id))}
                    icon={<AppIcon name="archive" size={16} />}
                    className="text-amber-600 dark:text-amber-400"
                  >
                    Archive Group
                  </MenuItem>
                </>
              )}
            </>
          )}
        </MenuContent>
      )}
      {!isGroup && chat && (
        <MenuContent align="end" className="w-56">
          <MenuItem onSelect={() => handleDropdownAction(() => setThreadSearchOpen(true))} icon={<AppIcon name="search" size={16} className="text-lantern-text-tertiary" />}>
            Search messages
          </MenuItem>
          <MenuItem
            onSelect={() => handleDropdownAction(() => setStarredOnly((on) => !on))}
            icon={<AppIcon name="star" size={16} className="text-lantern-text-tertiary" />}
            disabled={!starredOnly && starredIds.size === 0}
          >
            {starredOnly ? 'Show all messages' : `Starred messages${starredIds.size > 0 ? ` (${starredIds.size})` : ''}`}
          </MenuItem>
          <MenuItem onSelect={() => handleDropdownAction(() => setGalleryOpen(true))} icon={<AppIcon name="image" size={16} className="text-lantern-text-tertiary" />}>
            Photos and voice
          </MenuItem>
          <MenuSeparator />
          <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-lantern-text-tertiary">
            Notifications
          </div>
          {muteOverflowMenu}
          <MenuSeparator />
          {(chat as any).isArchived ? (
            <MenuItem
              onSelect={() => {
                setIsDropdownOpen(false);
                onUnarchiveDmThread?.(chat.id);
              }}
              icon={<AppIcon name="archive" size={16} />}
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
              icon={<AppIcon name="archive" size={16} />}
              className="text-amber-600 dark:text-amber-400"
            >
              Archive Conversation
            </MenuItem>
          )}
          {dmPeerId && (
            <MenuItem
              onSelect={() => {
                setIsDropdownOpen(false);
                void handleToggleDmBlock();
              }}
              icon={<AppIcon name="ban" size={16} />}
              className="text-red-600 dark:text-red-400"
            >
              {iBlockedThem ? 'Unblock User' : 'Block User'}
            </MenuItem>
          )}
          {dmPeerId && (
            <MenuItem
              onSelect={() => {
                setIsDropdownOpen(false);
                setReportTarget({ type: 'user', id: dmPeerId, label: name });
              }}
              icon={<AppIcon name="flag" size={16} />}
              className="text-red-600 dark:text-red-400"
            >
              Report User…
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
              icon={<AppIcon name="trash" size={16} />}
            >
              Delete Conversation
            </MenuItem>
          )}
        </MenuContent>
      )}
    </div>
    </Menu>
  );
};

export default ChatHeaderMenu;
