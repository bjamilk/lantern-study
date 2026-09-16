/**
 * The thread side panel: the replies to one message, with their own composer.
 *
 * Moved out of `components/ChatWindow.tsx` verbatim (lane M8b, step 2). Threads
 * are NOT part of the conversation's `messages`: the shell fetches them whole
 * per root id into `threadMessages`, so every mutation inside this panel (send,
 * edit, remove) has to re-run the shell's `loadThread` to see itself. That
 * fetching, and the focus handling keyed on `threadRootId`, stayed in the shell
 * — this file is the view only and holds no state.
 *
 * Touches: nothing. Every callback and ref is the caller's.
 *
 * Gotchas:
 *  - the overlay is absolutely positioned inside the CHAT WINDOW's own
 *    `relative` root rather than portalled, so it covers the conversation but
 *    not the app chrome. The backdrop click closes it; `stopPropagation` on the
 *    panel keeps clicks inside from doing the same.
 *  - the thread keeps its OWN node map (`threadMessageNodeRefs`), so a
 *    reply-quote click scrolls within the thread rather than to the hidden
 *    main-list copy of the same message.
 *  - the composer disappears when the root message has been removed: a closed
 *    thread takes no new replies.
 *  - the `chat` guard the inline version carried (`threadRootId && chat`) is
 *    now `threadRootId` alone, because the shell only renders this after its
 *    `if (!chat)` early return. Same condition, one term shorter.
 */
import React from 'react';
import MessageItem from '../MessageItem';
import MessageInputBar, { type SendMessageOptions } from '../MessageInputBar';
import { AppIcon } from '../ui/AppIcon';
import type { ContentReportTargetType } from '@lantern/shared';
import type { ChatItem, Group, Message, MessageReplyPreview, User } from '../../types';

export interface ThreadPanelProps {
  /** The root message's id, or null when no thread is open. */
  threadRootId: string | null;
  chat: ChatItem;
  currentUser: User;
  group: (Group & { members: unknown[] }) | null;
  /** True when the group is a community board: no votes, no similar-flagging. */
  communityHost: boolean;
  isArchived: boolean;
  /** True when the root message was removed — the thread is closed. */
  isThreadRootRemoved: boolean;

  threadLoading: boolean;
  /** The thread's messages after the shell's visibility filter. */
  visibleThreadMessages: Message[];
  /** The unfiltered fetch, read only to fall a cleared reply back to the root. */
  threadMessages: Message[];
  threadReplyTo: MessageReplyPreview | null;
  threadEditingMessage: { id: string; text: string } | null;
  threadSeedMentionUsername: string | null;

  threadScrollRef: React.RefObject<HTMLDivElement | null>;
  threadEndRef: React.RefObject<HTMLDivElement | null>;
  threadCloseButtonRef: React.MutableRefObject<HTMLButtonElement | null>;
  threadMessageNodeRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;

  userVotes: Record<string, 'up' | 'down' | undefined>;
  myReactions: Record<string, string[]>;
  starredIds: Set<string>;
  pinnedMessageId: string | null;
  mentionCandidates: Array<{ id: string; username: string; name?: string }>;

  setThreadRootId: (rootId: string | null) => void;
  setThreadReplyTo: (reply: MessageReplyPreview | null) => void;
  setThreadEditingMessage: (editing: { id: string; text: string } | null) => void;
  setThreadSeedMentionUsername: (username: string | null) => void;
  setForwardMessage: (message: Message | null) => void;
  setReportTarget: (
    target: { type: ContentReportTargetType; id: string; label?: string } | null
  ) => void;

  handleThreadSend: (text: string, options?: SendMessageOptions) => void | Promise<void>;
  handleToggleReaction: (messageId: string, emoji: string, added: boolean) => void;
  handleCopyMessage: (message: Message) => Promise<void> | void;
  handleToggleStar: (message: Message) => void;
  handleTogglePin: (message: Message) => void;
  beginEditingMessage: (message: Message, inThread: boolean) => void;
  handleRemoveMessage: (message: Message, inThread: boolean) => Promise<void> | void;
  onVoteQuestion: (messageId: string, voteType: 'up' | 'down') => void;
  onFlagAsSimilar: (messageId: string, groupId: string) => void;
  onAIQuery?: (question: string) => Promise<string | null>;
}

export const ThreadPanel: React.FC<ThreadPanelProps> = ({
  threadRootId,
  chat,
  currentUser,
  group,
  communityHost,
  isArchived,
  isThreadRootRemoved,
  threadLoading,
  visibleThreadMessages,
  threadMessages,
  threadReplyTo,
  threadEditingMessage,
  threadSeedMentionUsername,
  threadScrollRef,
  threadEndRef,
  threadCloseButtonRef,
  threadMessageNodeRefs,
  userVotes,
  myReactions,
  starredIds,
  pinnedMessageId,
  mentionCandidates,
  setThreadRootId,
  setThreadReplyTo,
  setThreadEditingMessage,
  setThreadSeedMentionUsername,
  setForwardMessage,
  setReportTarget,
  handleThreadSend,
  handleToggleReaction,
  handleCopyMessage,
  handleToggleStar,
  handleTogglePin,
  beginEditingMessage,
  handleRemoveMessage,
  onVoteQuestion,
  onFlagAsSimilar,
  onAIQuery,
}) => {
  if (!threadRootId) return null;
  return (
    <div
      className="absolute inset-0 z-30 flex justify-end bg-black/30"
      onClick={() => setThreadRootId(null)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-thread-title"
        className="w-full max-w-md h-full bg-lantern-surface border-l border-lantern-border flex flex-col shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between h-14 px-4 border-b border-lantern-border flex-shrink-0">
          <div>
            <p id="chat-thread-title" className="text-sm font-semibold text-lantern-text">Thread</p>
            <p className="text-[11px] text-lantern-text-tertiary">
              {Math.max(0, visibleThreadMessages.length - 1)}{' '}
              {visibleThreadMessages.length - 1 === 1 ? 'reply' : 'replies'}
            </p>
          </div>
          <button
            ref={threadCloseButtonRef}
            type="button"
            onClick={() => setThreadRootId(null)}
            className="p-1.5 rounded-lg text-lantern-text-secondary hover:bg-lantern-background-secondary"
            aria-label="Close thread"
          >
            <AppIcon name="close" size={20} />
          </button>
        </div>
        <div ref={threadScrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
          {threadLoading ? (
            <div className="flex justify-center py-10">
              <div className="w-8 h-8 border-2 border-lantern-primary/30 border-t-lantern-primary rounded-full animate-spin" />
            </div>
          ) : (
            visibleThreadMessages.map((msg) => (
              <div
                key={msg.id}
                ref={(el) => {
                  threadMessageNodeRefs.current[msg.id] = el;
                }}
              >
                <MessageItem
                  message={msg}
                  isCurrentUserMessage={msg.sender?.id === currentUser.id}
                  currentUserVote={userVotes[msg.id]}
                  myReactions={myReactions[msg.id]}
                  onToggleReaction={handleToggleReaction}
                  onVoteQuestion={communityHost ? undefined : onVoteQuestion}
                  onFlagAsSimilar={
                    communityHost ? undefined : (messageId) => onFlagAsSimilar(messageId, chat.id)
                  }
                  currentUserFlagged={msg.flaggedAsSimilarUserIds?.includes(currentUser.id)}
                  group={group}
                  currentUser={currentUser}
                  isGroupChat={chat.chatType === 'group'}
                  onEditMessage={(m) => beginEditingMessage(m, true)}
                  onRemoveMessage={(m) => void handleRemoveMessage(m, true)}
                  onReportMessage={
                    chat.chatType === 'group'
                      ? (m) =>
                          setReportTarget({
                            type: 'message',
                            id: m.id,
                            label: m.sender?.name || m.sender?.username || 'this message',
                          })
                      : undefined
                  }
                  onReply={(m) => {
                    setThreadEditingMessage(null);
                    setThreadReplyTo({
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
                  starred={starredIds.has(msg.id)}
                  pinned={pinnedMessageId === msg.id}
                  onMentionUser={(username) => setThreadSeedMentionUsername(username)}
                  onScrollToMessage={(messageId) => {
                    threadMessageNodeRefs.current[messageId]?.scrollIntoView({
                      behavior: 'smooth',
                      block: 'center',
                    });
                  }}
                />
              </div>
            ))
          )}
          <div ref={threadEndRef} />
        </div>
        {!isArchived && !isThreadRootRemoved && (
          <div className="flex-shrink-0 border-t border-lantern-border">
            <MessageInputBar
              onSendMessage={handleThreadSend}
              onAIQuery={chat.chatType === 'group' && !communityHost ? onAIQuery : undefined}
              mentionCandidates={mentionCandidates}
              seedMentionUsername={threadSeedMentionUsername}
              onSeedMentionConsumed={() => setThreadSeedMentionUsername(null)}
              replyTo={threadReplyTo}
              // Clearing a reply inside a thread falls BACK to the root rather
              // than to nothing — there is no such thing as a thread message
              // with no thread.
              onClearReply={() => {
                const root = threadMessages.find((m) => m.id === threadRootId) || threadMessages[0];
                if (root) {
                  setThreadReplyTo({
                    id: root.id,
                    senderId: root.sender?.id,
                    senderName: root.sender?.name || root.sender?.username,
                    type: root.type,
                    text: root.text,
                    questionStem: root.questionStem,
                  });
                }
              }}
              editingMessage={threadEditingMessage}
              onClearEdit={() => setThreadEditingMessage(null)}
              groupId={chat.chatType === 'group' ? chat.id : undefined}
              threadId={chat.chatType === 'dm' ? chat.id : undefined}
            />
          </div>
        )}
        {!isArchived && isThreadRootRemoved && (
          <div className="border-t border-lantern-border px-4 py-3 text-center text-xs text-lantern-text-secondary">
            This thread is closed because its original message was removed.
          </div>
        )}
      </div>
    </div>
  );
};

export default ThreadPanel;
