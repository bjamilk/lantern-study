/**
 * One row of the conversation: the date separator that precedes it when the
 * calendar day changes, the "New messages" divider when it is the first unread,
 * and the `MessageItem` itself with every action wired to the chat window.
 *
 * Extracted verbatim from the `visibleMessages.map` body in
 * `components/ChatWindow.tsx` (lane M8, step 2). The three outer-scope reads it
 * used became props with no change of meaning: the previous message (was
 * `visibleMessages[idx - 1]`), whether this row is the first unread one (was
 * `firstUnreadId === msg.id`), and the two node-map lookups (was
 * `messageNodeRefs.current`).
 *
 * Touches: nothing. Every callback is the caller's; this module holds no state
 * and performs no I/O.
 *
 * Gotchas:
 *  - A row carrying the unread divider is NEVER grouped with the previous one,
 *    so the divider cannot land in the middle of a sender cluster. That is the
 *    `&& !isFirstUnread` on `isGroupedWithPrevious`, not a styling tweak.
 *  - `registerNode` must be called with `null` on unmount (React does that for
 *    a callback ref); a row that leaves without clearing its entry leaves a
 *    dangling node in the map the reply-quote scroll reads.
 */
import React from 'react';
import MessageItem from '../MessageItem';
import type { ContentReportTargetType } from '@lantern/shared';
import type { Group, Message, MessageReplyPreview, User } from '../../types';

export interface MessageRowProps {
  message: Message;
  /** The row above this one, or null at the top of the visible list. */
  previousMessage: Message | null;
  /** True when this row is where the unread divider goes. */
  isFirstUnread: boolean;
  /** Attached to the unread divider so the list can scroll to it. */
  firstUnreadRef: React.RefObject<HTMLDivElement | null>;
  /** Records this row's DOM node under the message id, for scroll-to-message. */
  registerNode: (messageId: string, node: HTMLDivElement | null) => void;
  onScrollToMessage: (messageId: string) => void;

  currentUser: User;
  /** The open conversation's id — the group a "similar" flag is filed against. */
  chatId: string;
  isGroup: boolean;
  group: (Group & { members: unknown[] }) | null;
  /** True when the group is a community board: no votes, no similar-flagging. */
  communityHost: boolean;
  currentUserVote?: 'up' | 'down';
  myReactions?: string[];
  starred: boolean;
  pinned: boolean;

  handleToggleReaction: (messageId: string, emoji: string, added: boolean) => void;
  onVoteQuestion: (messageId: string, voteType: 'up' | 'down') => void;
  onFlagAsSimilar: (messageId: string, groupId: string) => void;
  handleOpenThread: (rootId: string) => void;
  beginEditingMessage: (message: Message) => void;
  handleRemoveMessage: (message: Message) => Promise<void> | void;
  handleCopyMessage: (message: Message) => Promise<void> | void;
  handleToggleStar: (message: Message) => void;
  handleTogglePin: (message: Message) => void;
  setReportTarget: (target: { type: ContentReportTargetType; id: string; label?: string } | null) => void;
  setEditingMessage: (editing: { id: string; text: string } | null) => void;
  setReplyTo: (reply: MessageReplyPreview | null) => void;
  setForwardMessage: (message: Message | null) => void;
  setSeedMentionUsername: (username: string | null) => void;
}

export const MessageRow: React.FC<MessageRowProps> = ({
  message: msg,
  previousMessage,
  isFirstUnread,
  firstUnreadRef,
  registerNode,
  onScrollToMessage,
  currentUser,
  chatId,
  isGroup,
  group,
  communityHost,
  currentUserVote,
  myReactions,
  starred,
  pinned,
  handleToggleReaction,
  onVoteQuestion,
  onFlagAsSimilar,
  handleOpenThread,
  beginEditingMessage,
  handleRemoveMessage,
  handleCopyMessage,
  handleToggleStar,
  handleTogglePin,
  setReportTarget,
  setEditingMessage,
  setReplyTo,
  setForwardMessage,
  setSeedMentionUsername,
}) => {
  // Per-row derivations: a date separator whenever the calendar day
  // changes, and "grouped with previous" (no repeated avatar/name) for a
  // same-sender message within 5 minutes. A row carrying the unread
  // divider is never grouped, so the divider cannot land mid-cluster.
  const msgDate = new Date(msg.timestamp);
  const prevMsg = previousMessage;
  const prevDate = prevMsg ? new Date(prevMsg.timestamp) : null;
  const showDateSeparator = !prevDate
    || msgDate.toDateString() !== prevDate.toDateString();
  const isGroupedWithPrevious =
    !!prevMsg &&
    !showDateSeparator &&
    !!prevMsg.sender?.id &&
    !!msg.sender?.id &&
    prevMsg.sender.id === msg.sender.id &&
    msgDate.getTime() - prevDate!.getTime() < 5 * 60 * 1000;

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
    <React.Fragment>
      {showDateSeparator && (
        <div className="flex items-center gap-3 py-2">
          <div className="flex-1 h-px bg-lantern-background-secondary" />
          <span className="text-xs font-medium text-lantern-text-tertiary whitespace-nowrap px-2">
            {formatDateLabel(msgDate)}
          </span>
          <div className="flex-1 h-px bg-lantern-background-secondary" />
        </div>
      )}
      {isFirstUnread && (
        <div
          ref={firstUnreadRef}
          className="flex items-center gap-3 py-2"
          data-testid="unread-divider"
        >
          <div className="flex-1 h-px bg-lantern-primary/40" />
          <span className="text-xs font-semibold text-lantern-primary whitespace-nowrap px-2">
            New messages
          </span>
          <div className="flex-1 h-px bg-lantern-primary/40" />
        </div>
      )}
      <div
        ref={(el) => {
          registerNode(msg.id, el);
        }}
      >
        <MessageItem
          message={msg}
          isCurrentUserMessage={msg.sender?.id === currentUser.id}
          currentUserVote={currentUserVote}
          myReactions={myReactions}
          onToggleReaction={handleToggleReaction}
          onVoteQuestion={communityHost ? undefined : onVoteQuestion}
          onFlagAsSimilar={
            communityHost ? undefined : (messageId) => onFlagAsSimilar(messageId, chatId)
          }
          currentUserFlagged={msg.flaggedAsSimilarUserIds?.includes(currentUser.id)}
          group={group}
          currentUser={currentUser}
          isGroupedWithPrevious={isGroupedWithPrevious && !isFirstUnread}
          isGroupChat={isGroup}
          onOpenThread={handleOpenThread}
          onEditMessage={(m) => beginEditingMessage(m)}
          onRemoveMessage={(m) => void handleRemoveMessage(m)}
          onReportMessage={
            isGroup
              ? (m) =>
                  setReportTarget({
                    type: 'message',
                    id: m.id,
                    label: m.sender?.name || m.sender?.username || 'this message',
                  })
              : undefined
          }
          onReply={(m) => {
            setEditingMessage(null);
            setReplyTo({
              id: m.id,
              senderId: m.sender?.id,
              senderName: m.sender?.name || m.sender?.username,
              type: m.type,
              text: m.text,
              questionStem: m.questionStem,
            });
          }}
          onForward={(m) => setForwardMessage(m)}
          onCopy={(m) => void handleCopyMessage(m)}
          onStar={handleToggleStar}
          onPin={handleTogglePin}
          starred={starred}
          pinned={pinned}
          onMentionUser={(username) => setSeedMentionUsername(username)}
          onScrollToMessage={onScrollToMessage}
        />
      </div>
    </React.Fragment>
  );
};

/**
 * Everything a row needs that is the same for every row in the conversation:
 * who is reading it, which conversation it is, and what each action does. The
 * list spreads one of these into every row it renders.
 */
export type MessageRowSharedProps = Omit<
  MessageRowProps,
  | 'message'
  | 'previousMessage'
  | 'isFirstUnread'
  | 'firstUnreadRef'
  | 'registerNode'
  | 'onScrollToMessage'
  | 'currentUserVote'
  | 'myReactions'
  | 'starred'
  | 'pinned'
>;

export default MessageRow;
