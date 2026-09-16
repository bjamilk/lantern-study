/**
 * The conversation itself: the search / starred / pinned banners above the
 * message list, and the composer slot below it.
 *
 * Moved out of `components/ChatWindow.tsx` verbatim (lane M8b, step 6). The
 * message list arrives as the `messageList` node rather than being built here,
 * for the same reason `OffersPanel` takes the whole pane as `chatPanel`: the
 * shell owns the list's twenty-odd props, and passing the built element keeps
 * exactly one copy of them.
 *
 * Touches: nothing. Every callback is the caller's; this module holds no state
 * and performs no I/O.
 *
 * Gotchas:
 *  - the composer slot is FOUR mutually exclusive states in a fixed precedence:
 *    archived group → blocked DM → declined request → the real composer (which
 *    may itself be preceded by the accept/decline request banner). Reordering
 *    those ternaries would, for instance, offer a composer inside an archived
 *    group. The order is the behaviour.
 *  - `flex-shrink-0` keeps every one of those states at full height beside the
 *    scrolling list; `pb-16 md:pb-0` clears the mobile bottom nav.
 *  - the pane renders the same way bare and inside the marketplace Tabs, which
 *    is what stops the two from drifting apart.
 */
import React from 'react';
import MessageInputBar, { type SendMessageOptions } from '../MessageInputBar';
import { AppIcon } from '../ui/AppIcon';
import type { ChatItem, Group, Message, MessageReplyPreview } from '../../types';

export interface ConversationPaneProps {
  chat: ChatItem;
  isGroup: boolean;
  isArchived: boolean;
  /** True when the group is a community board: no questions, no AI. */
  communityHost: boolean;
  group: (Group & { members: unknown[] }) | null;
  /** The scrolling list, built by the shell. */
  messageList: React.ReactNode;
  /** `visibleMessages.length` — the count the starred banner reports. */
  visibleMessagesCount: number;

  threadSearchOpen: boolean;
  threadSearch: string;
  setThreadSearch: (value: string) => void;
  setThreadSearchOpen: (open: boolean) => void;
  starredOnly: boolean;
  setStarredOnly: (only: boolean) => void;
  pinnedMessage?: Message;
  scrollToMessageId: (messageId: string) => void;

  onToggleArchiveGroup: (groupId: string) => void;
  dmBlocked: boolean;
  iBlockedThem: boolean;
  dmBlockBusy: boolean;
  handleToggleDmBlock: () => Promise<void> | void;
  isDmRequestRecipient: boolean | string | null | undefined;
  isDmRequestSender: boolean;
  isDmRequestDeclinedForRecipient: boolean | string | null | undefined;
  dmRequestBusy: boolean;
  handleAcceptDmRequest: () => Promise<void> | void;
  handleDeclineDmRequest: () => Promise<void> | void;

  typingLabels: string[];
  handleComposerSend: (text: string, options?: SendMessageOptions) => void | Promise<void>;
  onOpenQuestionModal: () => void;
  onAIQuery?: (question: string) => Promise<string | null>;
  broadcastTyping: () => void;
  mentionCandidates: Array<{ id: string; username: string; name?: string }>;
  seedMentionUsername: string | null;
  setSeedMentionUsername: (username: string | null) => void;
  replyTo: MessageReplyPreview | null;
  setReplyTo: (reply: MessageReplyPreview | null) => void;
  editingMessage: { id: string; text: string } | null;
  setEditingMessage: (editing: { id: string; text: string } | null) => void;
}

export const ConversationPane: React.FC<ConversationPaneProps> = ({
  chat,
  isGroup,
  isArchived,
  communityHost,
  group,
  messageList,
  visibleMessagesCount,
  threadSearchOpen,
  threadSearch,
  setThreadSearch,
  setThreadSearchOpen,
  starredOnly,
  setStarredOnly,
  pinnedMessage,
  scrollToMessageId,
  onToggleArchiveGroup,
  dmBlocked,
  iBlockedThem,
  dmBlockBusy,
  handleToggleDmBlock,
  isDmRequestRecipient,
  isDmRequestSender,
  isDmRequestDeclinedForRecipient,
  dmRequestBusy,
  handleAcceptDmRequest,
  handleDeclineDmRequest,
  typingLabels,
  handleComposerSend,
  onOpenQuestionModal,
  onAIQuery,
  broadcastTyping,
  mentionCandidates,
  seedMentionUsername,
  setSeedMentionUsername,
  replyTo,
  setReplyTo,
  editingMessage,
  setEditingMessage,
}) => (
  <>
    {threadSearchOpen && (
      <div className="flex items-center gap-2 px-4 py-2 border-b border-lantern-border bg-lantern-surface">
        <AppIcon name="search" size={16} className="text-lantern-text-tertiary" />
        <input
          type="search"
          value={threadSearch}
          onChange={(e) => setThreadSearch(e.target.value)}
          placeholder="Search this chat"
          aria-label="Search this chat"
          className="flex-1 bg-transparent text-body text-lantern-text outline-none"
          autoFocus
        />
        <button
          type="button"
          onClick={() => {
            setThreadSearch('');
            setThreadSearchOpen(false);
          }}
          className="text-caption font-semibold text-lantern-primary"
        >
          Close
        </button>
      </div>
    )}
    {starredOnly && (
      <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200/70 dark:border-amber-900/40">
        <AppIcon name="star" size={14} className="text-amber-500" />
        <p className="flex-1 text-caption font-semibold text-amber-800 dark:text-amber-300">
          Starred messages ({visibleMessagesCount})
        </p>
        <button type="button" onClick={() => setStarredOnly(false)} className="text-caption font-semibold text-amber-800">
          Show all
        </button>
      </div>
    )}
    {pinnedMessage && (
      <button
        type="button"
        onClick={() => scrollToMessageId(pinnedMessage.id)}
        className="flex items-center gap-2 w-full px-4 py-2 text-left border-b border-lantern-border bg-lantern-background-secondary"
      >
        <AppIcon name="pin" size={14} className="text-lantern-text-tertiary" />
        <span className="flex-1 text-caption truncate text-lantern-text">
          {pinnedMessage.questionStem || pinnedMessage.text || 'Pinned message'}
        </span>
      </button>
    )}
    {messageList}
    {/* Composer slot — mutually exclusive states, in precedence order:
        archived group → blocked DM → declined request → the real composer
        (which may itself be preceded by the accept/decline request banner).
        `flex-shrink-0` keeps every one of them at full height beside the
        scrolling list; `pb-16 md:pb-0` clears the mobile bottom nav. */}
    {isArchived ? (
      <div className="flex items-center justify-center gap-3 p-4 pb-20 md:pb-4 bg-amber-50 dark:bg-amber-900/20 border-t border-amber-200 dark:border-amber-800/40 flex-shrink-0">
        <AppIcon name="archive" size={16} className="text-amber-600 dark:text-amber-400" />
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
    ) : dmBlocked ? (
      <div className="flex flex-col items-center justify-center gap-2 p-4 pb-20 md:pb-4 bg-lantern-background-secondary border-t border-lantern-border flex-shrink-0">
        <p className="text-sm text-lantern-text-secondary text-center">
          {iBlockedThem
            ? 'You blocked this user. Messaging is disabled until you unblock them.'
            : 'You can’t message this user.'}
        </p>
        {iBlockedThem && (
          <button
            type="button"
            disabled={dmBlockBusy}
            onClick={() => void handleToggleDmBlock()}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold border border-lantern-border text-lantern-text hover:bg-lantern-surface disabled:opacity-60"
          >
            Unblock
          </button>
        )}
      </div>
    ) : isDmRequestDeclinedForRecipient ? (
      <div className="flex items-center justify-center gap-3 p-4 pb-20 md:pb-4 bg-lantern-background-secondary border-t border-lantern-border flex-shrink-0">
        <p className="text-sm text-lantern-text-secondary">
          You declined this message request. It stays one-way unless they send again.
        </p>
      </div>
    ) : (
      <div className="flex-shrink-0 pb-16 md:pb-0 bg-lantern-surface relative z-20 border-t border-lantern-border">
        {isDmRequestRecipient && (
          <div className="px-4 py-3 border-b border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/30">
            <p className="text-sm text-amber-900 dark:text-amber-200 mb-2">
              Message request — reply or accept to open a two-way chat. Decline to keep it one-way.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={dmRequestBusy}
                onClick={() => void handleAcceptDmRequest()}
                className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-lantern-primary text-white hover:bg-lantern-primary-dark disabled:opacity-60"
              >
                Accept
              </button>
              <button
                type="button"
                disabled={dmRequestBusy}
                onClick={() => void handleDeclineDmRequest()}
                className="px-3 py-1.5 rounded-lg text-sm font-semibold border border-lantern-border text-lantern-text hover:bg-lantern-background-secondary disabled:opacity-60"
              >
                Decline
              </button>
            </div>
          </div>
        )}
        {isDmRequestSender && (
          <p className="px-4 py-2 text-xs text-lantern-text-secondary border-b border-lantern-border bg-lantern-background-secondary">
            Message request sent — they can see your messages. Two-way chat opens when they accept or reply.
          </p>
        )}
        {typingLabels.length > 0 && (
          <p className="px-4 py-1 text-xs text-lantern-text-tertiary" aria-live="polite">
            {typingLabels.length === 1
              ? `${typingLabels[0]} is typing…`
              : `${typingLabels.slice(0, 2).join(' and ')} are typing…`}
          </p>
        )}
        <MessageInputBar
          onSendMessage={handleComposerSend}
          onOpenQuestionModal={isGroup && !communityHost ? onOpenQuestionModal : undefined}
          onAIQuery={isGroup && !communityHost ? onAIQuery : undefined}
          onTyping={broadcastTyping}
          mentionCandidates={mentionCandidates}
          seedMentionUsername={seedMentionUsername}
          onSeedMentionConsumed={() => setSeedMentionUsername(null)}
          replyTo={replyTo}
          onClearReply={() => setReplyTo(null)}
          editingMessage={editingMessage}
          onClearEdit={() => setEditingMessage(null)}
          groupId={isGroup ? chat.id : undefined}
          threadId={!isGroup ? chat.id : undefined}
        />
      </div>
    )}
  </>
);

export default ConversationPane;
