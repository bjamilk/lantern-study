/**
 * The scrolling message list: the "loading older messages" spinner, the rows,
 * the bottom sentinel, the empty state, and the "N new messages" pill that
 * floats over it.
 *
 * Extracted verbatim from `components/ChatWindow.tsx` (lane M8, step 3). The
 * scroll bookkeeping itself stays in ChatWindow — this component receives the
 * container ref, the scroll handler and the derived counts, so which commit
 * the scroll effects run in did not change.
 *
 * Touches: nothing. No state, no I/O.
 *
 * Gotchas:
 *  - `relative` on the outer div is what anchors the pill over the list. The
 *    scroller needs BOTH `flex-1` and `min-h-0`: without `min-h-0` its automatic
 *    minimum height is the full message list, so the pane grows instead of
 *    scrolling and the composer is pushed off-screen.
 *  - The empty state answers four different questions (archived / starred-only /
 *    no search match / genuinely empty) in one block; changing the order of
 *    those ternaries changes which sentence a student reads.
 */
import React from 'react';
import { AppIcon } from '../ui/AppIcon';
import { MessageRow, type MessageRowSharedProps } from './MessageRow';
import type { Message } from '../../types';

export interface MessageListProps {
  visibleMessages: Message[];
  /** The scroller node. ChatWindow owns every read of it. */
  messagesContainerRef: React.RefObject<HTMLDivElement>;
  /** The bottom sentinel auto-scroll scrolls into view. */
  messagesEndRef: React.RefObject<HTMLDivElement>;
  /** Attached to the unread divider, wherever in the list it lands. */
  firstUnreadRef: React.RefObject<HTMLDivElement>;
  handleScroll: (event: React.UIEvent<HTMLDivElement>) => void;
  isLoadingMore: boolean;
  awaitingMessages: boolean;
  newMessagesBelow: number;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  firstUnreadId: string | null;

  /** Empty-state inputs: which of the four sentences applies, and for whom. */
  isArchived: boolean;
  isGroup: boolean;
  starredOnly: boolean;
  threadSearch: string;
  name: string;

  /** Per-row lookups, applied here so a row never sees the whole map. */
  userVotes: Record<string, 'up' | 'down' | undefined>;
  myReactions: Record<string, string[]>;
  starredIds: Set<string>;
  pinnedMessageId: string | null;
  registerNode: (messageId: string, node: HTMLDivElement | null) => void;
  onScrollToMessage: (messageId: string) => void;
  /** Everything every row shares: the conversation, and the message actions. */
  rowProps: MessageRowSharedProps;
}

export const MessageList: React.FC<MessageListProps> = ({
  visibleMessages,
  messagesContainerRef,
  messagesEndRef,
  firstUnreadRef,
  handleScroll,
  isLoadingMore,
  awaitingMessages,
  newMessagesBelow,
  scrollToBottom,
  firstUnreadId,
  isArchived,
  isGroup,
  starredOnly,
  threadSearch,
  name,
  userVotes,
  myReactions,
  starredIds,
  pinnedMessageId,
  registerNode,
  onScrollToMessage,
  rowProps,
}) => {
  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
    <div ref={messagesContainerRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 py-4 space-y-3">
      {isLoadingMore && (
        <div className="flex justify-center py-2" aria-live="polite">
          <div className="w-5 h-5 border-2 border-lantern-primary/30 border-t-lantern-primary rounded-full animate-spin" />
          <span className="sr-only">Loading older messages</span>
        </div>
      )}
      {visibleMessages.map((msg, idx) => (
        <MessageRow
          key={msg.id}
          message={msg}
          previousMessage={idx > 0 ? visibleMessages[idx - 1] : null}
          isFirstUnread={firstUnreadId === msg.id}
          firstUnreadRef={firstUnreadRef}
          registerNode={registerNode}
          onScrollToMessage={onScrollToMessage}
          currentUserVote={userVotes[msg.id]}
          myReactions={myReactions[msg.id]}
          starred={starredIds.has(msg.id)}
          pinned={pinnedMessageId === msg.id}
          {...rowProps}
        />
      ))}
      <div ref={messagesEndRef} />
      {visibleMessages.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          {awaitingMessages ? (
            <>
              <div className="w-10 h-10 border-2 border-lantern-primary/30 border-t-lantern-primary rounded-full animate-spin mb-4" />
              <p className="text-sm text-lantern-text-secondary">Loading messages…</p>
            </>
          ) : (
            <>
              <div className="w-16 h-16 rounded-2xl bg-lantern-background-secondary/60 dark:bg-lantern-surface flex items-center justify-center mb-4">
                <AppIcon name="chatbubbles" size={32} className="text-lantern-text-tertiary" />
              </div>
              <h3 className="text-base font-semibold text-lantern-text mb-1">
                {isArchived
                  ? 'This group is archived'
                  : starredOnly
                    ? 'No starred messages yet'
                    : threadSearch.trim().length >= 2
                      ? 'No matches'
                      : 'No messages yet'}
              </h3>
              <p className="text-sm text-lantern-text-secondary max-w-xs">
                {isArchived
                  ? 'Unarchive the group to resume the conversation.'
                  : starredOnly
                    ? 'Long-press or open a message menu and tap Star to keep it here.'
                    : threadSearch.trim().length >= 2
                      ? 'Try a different search.'
                      : isGroup
                        ? `Be the first to write in ${name}.`
                        : `Say hi to ${name}.`}
              </p>
            </>
          )}
        </div>
      )}
    </div>
    {newMessagesBelow > 0 && (
      <button
        type="button"
        onClick={() => scrollToBottom('smooth')}
        className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 rounded-full bg-lantern-primary text-white text-xs font-semibold shadow-lg hover:bg-lantern-primary-dark transition-colors"
      >
        ↓ {newMessagesBelow} new message{newMessagesBelow === 1 ? '' : 's'}
      </button>
    )}
    </div>
  );
};

export default MessageList;
