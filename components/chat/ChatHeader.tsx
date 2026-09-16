/**
 * The conversation header bar: avatar, title, subtitle, the group quick-action
 * toolbar, the overflow menu (both the group and the DM variant) and the
 * "Notifications muted" strip under it.
 *
 * Extracted verbatim from `components/ChatWindow.tsx` (lane M8, step 1 of 6).
 * It is presentational: every piece of state it shows and every mutation it
 * triggers still lives in ChatWindow and arrives through props, so the extraction
 * changed no render timing.
 *
 * Touches: nothing directly. `confirmDialog` (the Delete Conversation prompt) is
 * the one store it reaches for, because the confirmation is part of the menu
 * item rather than of the caller.
 *
 * Gotchas:
 *  - Each affordance sits in exactly ONE place per breakpoint: Question/Test/Study
 *    are toolbar buttons at lg+ and menu items below it, which is why the menu
 *    carries a `lg:hidden` block. Adding an action to both duplicates it at some
 *    width.
 *  - A community's chat is never archivable by a member and loses the whole
 *    STUDY/TEST apparatus (§5.4 / §6) — that is what every `communityHost`
 *    branch is doing, not a styling choice.
 *  - Colours are `lantern-*` tokens plus Tailwind steps with explicit `dark:`
 *    pairs; there is no JS theme branch here and none should be added.
 */
import React from 'react';
import { type ChatMuteDurationId } from '@lantern/shared';
import { COMMUNITY_COPY } from '@lantern/shared/network';
import { formatChatPresenceLine } from '@lantern/shared/chat';
import { type QuestionVisibilityMode } from '@lantern/shared/utils';
import type { ContentReportTargetType } from '@lantern/shared';
import { Avatar } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { ChatHeaderMenu } from './ChatHeaderMenu';
import { resolveAvatarSrc } from '../../utils/avatar';
import type { ChatItem, Group, Message } from '../../types';

export interface ChatHeaderProps {
  /** The open conversation. Never null: the shell returns early without one. */
  chat: ChatItem;
  /** The group behind `chat` when it is a group chat, else null. */
  group: (Group & { members: unknown[] }) | null;
  isGroup: boolean;
  isGroupAdmin: boolean;
  isArchived: boolean;
  /** True when the group is a community board — see the §5.4 gotcha above. */
  communityHost: boolean;
  name: string;
  avatarUrl?: string | null;
  /** Member count for a group, presence/request line for a DM. */
  description: string;
  memberCountText: string;
  dmPeerId?: string;
  lowDataMode: boolean;
  resolvedPeerPresence: { settings?: unknown; lastSeenAt?: string | null } | null;
  communityContext?: { name: string; onOpen: () => void };
  /** The messages currently on screen — only the question count is read. */
  visibleMessages: Message[];
  onBack?: () => void;

  // --- Menus and the view state they toggle -------------------------------
  isDropdownOpen: boolean;
  setIsDropdownOpen: React.Dispatch<React.SetStateAction<boolean>>;
  questionFiltersOpen: boolean;
  setQuestionFiltersOpen: React.Dispatch<React.SetStateAction<boolean>>;
  questionVisibilityMode: QuestionVisibilityMode;
  setQuestionVisibilityMode: (mode: QuestionVisibilityMode) => void;
  starredOnly: boolean;
  setStarredOnly: React.Dispatch<React.SetStateAction<boolean>>;
  starredIds: Set<string>;
  setGalleryOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setThreadSearchOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setReportTarget: (target: { type: ContentReportTargetType; id: string; label?: string } | null) => void;

  // --- Mute ----------------------------------------------------------------
  chatMuted: boolean;
  muteBusy: boolean;
  muteUntilLabel: string | null;
  muteDurationsOpen: boolean;
  setMuteDurationsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleMuteFor: (duration: ChatMuteDurationId) => Promise<void> | void;
  handleUnmute: () => Promise<void> | void;

  // --- Actions owned by the app shell --------------------------------------
  onOpenQuestionModal: () => void;
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

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  chat,
  group,
  isGroup,
  isGroupAdmin,
  isArchived,
  communityHost,
  name,
  avatarUrl,
  description,
  memberCountText,
  dmPeerId,
  lowDataMode,
  resolvedPeerPresence,
  communityContext,
  visibleMessages,
  onBack,
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
  onOpenQuestionModal,
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

  const questionCount = visibleMessages.filter(m => m.questionType).length;
  // Fold the question count into the header subtitle so we can drop the separate
  // stats strip row (member count already backs `description` when unset).
  const headerSubtitle = isGroup && !isArchived && questionCount > 0
    ? `${description} · ${questionCount} question${questionCount !== 1 ? 's' : ''}`
    : description;

  return (
    <div className="flex-shrink-0 z-20 relative">
      <div className="flex items-center justify-between h-16 px-4 md:px-6 bg-lantern-surface/90 backdrop-blur-md border-b border-lantern-border">
        <div className="flex items-center min-w-0 gap-3">
          {/* Mobile back button */}
          {onBack && (
            <button type="button" onClick={onBack} className="md:hidden p-1.5 -ml-1 mr-1 text-lantern-text-secondary hover:text-lantern-text rounded-lantern hover:bg-lantern-background-secondary relative z-20" aria-label={communityContext ? 'Back to community' : 'Back to chats'}>
              <AppIcon name="arrow-back" size={20} />
            </button>
          )}
          <div className="relative flex-shrink-0">
            <Avatar
              name={name}
              id={isGroup ? chat.id : dmPeerId}
              src={resolveAvatarSrc(avatarUrl, lowDataMode)}
              size="md"
              localOnly={lowDataMode}
              className="ring-2 ring-white dark:ring-lantern-border"
            />
            {!isGroup && !isArchived && resolvedPeerPresence && formatChatPresenceLine(resolvedPeerPresence.settings, resolvedPeerPresence.lastSeenAt).status === 'online' && (
              <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-400 border-2 border-white dark:border-lantern-border rounded-full" aria-label="Online" />
            )}
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold truncate text-lantern-text" title={name}>{name}</h2>
            <p className="text-xs text-lantern-text-secondary truncate" title={communityContext && !isArchived ? undefined : headerSubtitle}>
              {isArchived ? (
                <span className="font-semibold text-amber-600 dark:text-amber-400">Archived</span>
              ) : communityContext ? (
                <>
                  {memberCountText ? `${memberCountText} · ` : ''}
                  <button
                    type="button"
                    onClick={communityContext.onOpen}
                    aria-label="Open community"
                    className="text-xs text-lantern-primary hover:underline"
                  >
                    {COMMUNITY_COPY.inCommunity(communityContext.name)}
                  </button>
                  {isGroup && !communityHost && questionCount > 0 ? ` · ${questionCount} question${questionCount !== 1 ? 's' : ''}` : ''}
                </>
              ) : headerSubtitle}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setThreadSearchOpen((open) => !open)}
            className="p-2 text-lantern-text-secondary hover:text-lantern-primary hover:bg-lantern-background-secondary rounded-lantern"
            aria-label="Search in chat"
            title="Search in chat"
          >
            <AppIcon name="search" size={18} />
          </button>
          {/* Quick-action toolbar for groups. Only the primary action (Question)
              stays exposed on small screens; Test/Study fan out at lg+, and
              everything else (visibility, mute) lives in the overflow menu
              so each action sits in exactly one place per breakpoint. */}
          {isGroup && group && !isArchived && !communityHost && (
            <div className="flex items-center gap-1 mr-2">
              <button
                onClick={onOpenQuestionModal}
                data-tip-id="chat.question"
                className="flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] text-xs font-medium text-lantern-text-secondary bg-lantern-background-secondary hover:bg-lantern-primary-background hover:text-lantern-primary rounded-lantern transition-colors duration-200"
                aria-label="Submit question"
                title="Submit Question"
              >
                <AppIcon name="create" size={16} />
                <span className="hidden lg:inline">Question</span>
              </button>
              <button
                onClick={onOpenTestConfigModal}
                data-tip-id="chat.test"
                className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-lantern-text-secondary bg-lantern-background-secondary hover:bg-lantern-primary-background hover:text-lantern-primary rounded-lantern transition-colors duration-200"
                aria-label="Take a test"
                title="Take a Test"
              >
                <AppIcon name="clipboard-check" size={16} />
                <span className="hidden lg:inline">Test</span>
              </button>
              <button
                onClick={onOpenStudyConfigModal}
                data-tip-id="chat.study"
                className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-lantern-text-secondary bg-lantern-background-secondary hover:bg-lantern-primary-background hover:text-lantern-primary rounded-lantern transition-colors duration-200"
                aria-label="Study mode"
                title="Study Mode"
              >
                <AppIcon name="book-open" size={16} />
                <span className="hidden lg:inline">Study</span>
              </button>
            </div>
          )}

          {/* Overflow menu */}
          <ChatHeaderMenu
            chat={chat}
            group={group}
            isGroup={isGroup}
            isGroupAdmin={isGroupAdmin}
            isArchived={isArchived}
            communityHost={communityHost}
            name={name}
            dmPeerId={dmPeerId}
            isDropdownOpen={isDropdownOpen}
            setIsDropdownOpen={setIsDropdownOpen}
            questionFiltersOpen={questionFiltersOpen}
            setQuestionFiltersOpen={setQuestionFiltersOpen}
            questionVisibilityMode={questionVisibilityMode}
            setQuestionVisibilityMode={setQuestionVisibilityMode}
            starredOnly={starredOnly}
            setStarredOnly={setStarredOnly}
            starredIds={starredIds}
            setGalleryOpen={setGalleryOpen}
            setThreadSearchOpen={setThreadSearchOpen}
            setReportTarget={setReportTarget}
            chatMuted={chatMuted}
            muteBusy={muteBusy}
            muteUntilLabel={muteUntilLabel}
            muteDurationsOpen={muteDurationsOpen}
            setMuteDurationsOpen={setMuteDurationsOpen}
            handleMuteFor={handleMuteFor}
            handleUnmute={handleUnmute}
            onOpenTestConfigModal={onOpenTestConfigModal}
            onOpenStudyConfigModal={onOpenStudyConfigModal}
            onOpenGroupInfoModal={onOpenGroupInfoModal}
            onOpenCreateSubGroupModal={onOpenCreateSubGroupModal}
            onOpenAIGenerateModal={onOpenAIGenerateModal}
            onToggleArchiveGroup={onToggleArchiveGroup}
            onArchiveDmThread={onArchiveDmThread}
            onUnarchiveDmThread={onUnarchiveDmThread}
            onDeleteDmThread={onDeleteDmThread}
            handleToggleDmBlock={handleToggleDmBlock}
            iBlockedThem={iBlockedThem}
          />
        </div>
      </div>
      {chatMuted && (
        <div className="flex items-center justify-between gap-2 px-4 md:px-6 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200/70 dark:border-amber-900/40 text-xs text-amber-800 dark:text-amber-300">
          <span className="inline-flex items-center gap-1.5 min-w-0">
            <AppIcon name="notifications-off" size={14} className="shrink-0" aria-hidden />
            <span className="truncate">
              Notifications muted{muteUntilLabel ? ` until ${muteUntilLabel}` : ''}
            </span>
          </span>
          <button
            type="button"
            onClick={() => void handleUnmute()}
            disabled={muteBusy}
            className="shrink-0 font-semibold underline-offset-2 hover:underline disabled:opacity-50"
          >
            Unmute
          </button>
        </div>
      )}
    </div>
  );
};

export default ChatHeader;
