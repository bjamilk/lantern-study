import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppIcon } from '../ui/AppIcon';
import {
  COMMUNITY_BOARD_COPY,
  boardFavoriteAccessibilityLabel,
  boardFavoriteCount,
  boardRelativeTime,
  isBoardFavorited,
  type BoardPost,
} from '@lantern/shared/network';
import { fetchGroupThread } from '../../services/supabase';
import { toBoardPost } from '../../utils/boardPosts';
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap';
import type { MentionCandidate, SendMessageOptions } from '../MessageInputBar';
import MessageInputBar from '../MessageInputBar';
import { AnsweredChip, BOARD_ANSWER_COPY, BoardPostMedia, boardPostText } from './BoardPostCard';
import { Avatar } from '../ui';

/**
 * The one control a board comment gets. Same table, same endpoints and the
 * same pinned emoji as a post's Favorite; the emoji picker is gone from every
 * board surface and untouched in group chat and DMs.
 */
const FavoriteButton: React.FC<{
  count: number;
  mine: boolean;
  onToggle: (added: boolean) => void;
}> = ({ count, mine, onToggle }) => (
  <button
    type="button"
    onClick={() => onToggle(!mine)}
    aria-pressed={mine}
    aria-label={boardFavoriteAccessibilityLabel(count, mine)}
    className="mt-1 inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-lantern px-2.5 text-xs font-medium text-lantern-text-secondary hover:bg-lantern-background-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
  >
    {mine ? (
      <AppIcon name="heart" size={16} filled className="text-lantern-error" />
    ) : (
      <AppIcon name="heart" size={16} />
    )}
    {count > 0 ? count : null}
  </button>
);

/**
 * The mark-answered controls on one reply.
 *
 * The "Answer" badge renders for EVERYONE when this reply is the accepted one —
 * that is what makes the answer identifiable. The action button appears only
 * when `canMark` (the shared rule already decided the viewer may): "Mark as
 * answer" on any other reply, "Clear answer" on the accepted one, so
 * un-answering is available to exactly whoever could answer.
 */
export const CommentAnswer: React.FC<{
  isAnswer: boolean;
  canMark: boolean;
  onMark: () => void;
  onClear: () => void;
}> = ({ isAnswer, canMark, onMark, onClear }) => {
  if (!isAnswer && !canMark) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      {isAnswer ? (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-lantern-success/10 px-2 py-0.5 text-label font-medium text-lantern-success">
          <AppIcon name="checkmark-circle" size={13} filled aria-hidden />
          {BOARD_ANSWER_COPY.answerBadge}
        </span>
      ) : null}
      {canMark ? (
        <button
          type="button"
          onClick={isAnswer ? onClear : onMark}
          className="inline-flex min-h-[44px] items-center gap-1 rounded-lantern px-2 text-label font-semibold text-lantern-primary hover:bg-lantern-background-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
        >
          {isAnswer ? BOARD_ANSWER_COPY.clearAnswer : BOARD_ANSWER_COPY.markAnswer}
        </button>
      ) : null}
    </div>
  );
};

export interface BoardPostPanelProps {
  groupId: string;
  post: BoardPost;
  lowDataMode: boolean;
  mentionCandidates: MentionCandidate[];
  onClose: () => void;
  /**
   * The viewer's own reactions across this board, keyed by message id. A
   * comment's Favorite reads its row out of the same map the cards use, so a
   * heart placed here and one placed on the card are the same record.
   */
  myReactions: Record<string, string[]>;
  /**
   * Favorite on the root post or on any comment. Board comments get Favorite
   * and NOTHING else (§4.5) — five 44px controls do not fit a comment row
   * beside a 24px avatar on a 320dp screen.
   */
  onToggleFavorite: (
    messageId: string,
    added: boolean,
  ) => Promise<Record<string, number> | null>;
  /** Posts a comment (a plain TEXT reply on the root). */
  onSendComment: (text: string, options: SendMessageOptions) => Promise<void>;
  /** Keeps the card's `N comments` in step without a manual refetch (§11.7). */
  onReplyCountChange: (postId: string, replyCount: number) => void;
  /**
   * The reply currently accepted as the answer (the root's
   * `answered_message_id`), or null. Drives the "Answer" badge on the reply and
   * the "Answered" chip above the thread — for EVERY reader, marker or not, so
   * an answered question is identifiable without any permission.
   */
  answeredMessageId?: string | null;
  /**
   * May THIS viewer accept or clear an answer? Decided once by the parent from
   * the shared `boardPostRules(...).canMarkAnswered` — never re-derived here, so
   * the panel cannot drift from the card or the server.
   */
  canMarkAnswered?: boolean;
  /**
   * Accept `messageId` as the answer, or clear it with `null`. The parent owns
   * the write (one shared endpoint) and the optimistic state; the panel only
   * says which reply.
   */
  onSetAnswer?: (messageId: string | null) => void;
}

/**
 * The comments view (spec §5.1 / §4.1): a right panel at `lg+`, a modal below
 * it. The root post renders in full here — this is where images and the voice
 * player actually load — then its comments, oldest first, as flat rows.
 * No typing indicator, no read receipts, no ticks.
 */
export const BoardPostPanel: React.FC<BoardPostPanelProps> = ({
  groupId,
  post,
  lowDataMode,
  mentionCandidates,
  onClose,
  myReactions,
  onToggleFavorite,
  onSendComment,
  onReplyCountChange,
  answeredMessageId = null,
  canMarkAnswered = false,
  onSetAnswer,
}) => {
  const [comments, setComments] = useState<BoardPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const containerRef = useModalFocusTrap(true, onClose);
  // Held in a ref: the parent passes an inline callback, and putting it in
  // `load`'s deps would refetch the thread on every render of the board.
  const onReplyCountChangeRef = useRef(onReplyCountChange);
  onReplyCountChangeRef.current = onReplyCountChange;

  const load = useCallback(async () => {
    try {
      const rows = await fetchGroupThread(groupId, post.id);
      const mapped = (Array.isArray(rows) ? rows : [])
        .map((row: any) => toBoardPost(row, groupId))
        .filter((row: BoardPost) => row.id !== post.id)
        .sort((a: BoardPost, b: BoardPost) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
      setComments(mapped);
      onReplyCountChangeRef.current(post.id, mapped.length);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load comments');
    } finally {
      setLoading(false);
    }
  }, [groupId, post.id]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  /**
   * A comment is not in the board's `posts` list, so the authoritative counts
   * that come back from the toggle are patched onto its row here. Without this
   * the heart filled and the number beside it stayed on the old value until
   * the thread was reloaded.
   */
  const handleFavorite = async (messageId: string, added: boolean) => {
    const reactions = await onToggleFavorite(messageId, added);
    if (!reactions) return;
    setComments((prev) =>
      prev.map((comment) => (comment.id === messageId ? { ...comment, reactions } : comment))
    );
  };

  const handleSend = async (text: string, options?: SendMessageOptions) => {
    await onSendComment(text, { ...options, replyToMessageId: post.id });
    setComposing(false);
    await load();
  };

  const body = boardPostText(post.text);

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-black/30" onClick={onClose}>
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="board-comments-title"
        onClick={(event) => event.stopPropagation()}
        className="flex h-full w-full flex-col border-l border-lantern-border bg-lantern-surface shadow-xl lg:w-[28rem]"
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-lantern-border px-4">
          <h2 id="board-comments-title" className="text-sm font-semibold text-lantern-text">
            {COMMUNITY_BOARD_COPY.commentsTitle}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close comments"
            className="flex h-11 w-11 items-center justify-center rounded-lantern text-lantern-text-secondary hover:bg-lantern-background-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
          >
            <AppIcon name="close" size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <article className="rounded-lantern-xl border border-lantern-border bg-lantern-background p-3">
            <div className="flex items-center gap-2">
              <Avatar
                name={post.senderName}
                src={post.senderAvatarUrl}
                size="sm"
                localOnly={lowDataMode}
              />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-lantern-text">
                  <span className="truncate">{post.senderName}</span>
                  {/* The question reads as answered at the top of its own
                      thread, for every reader. */}
                  {answeredMessageId ? <AnsweredChip /> : null}
                </p>
                <p className="text-[11px] text-lantern-text-tertiary">
                  {boardRelativeTime(post.timestamp)}
                </p>
              </div>
            </div>
            {post.subject ? (
              <h3 className="mt-2 break-words text-sm font-bold text-lantern-text">{post.subject}</h3>
            ) : null}
            {body ? (
              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-lantern-text">{body}</p>
            ) : null}
            {/*
              The post view is where the FULL photo loads — `original` unless
              low-data mode is on, which reads the 480px thumb instead. It is
              also the only board surface that ever fetches a voice note.
            */}
            <BoardPostMedia
              text={post.text}
              imageUrl={post.imageUrl}
              eager={!lowDataMode}
              variant={lowDataMode ? 'thumb' : 'original'}
            />
            <div className="mt-2">
              <FavoriteButton
                count={boardFavoriteCount(post.reactions)}
                mine={isBoardFavorited(myReactions[post.id])}
                onToggle={(added) => void handleFavorite(post.id, added)}
              />
            </div>
          </article>

          {error ? (
            <p role="alert" className="mt-3 text-xs text-lantern-error">
              {error}
            </p>
          ) : null}

          {loading ? (
            <p role="status" className="mt-3 text-xs text-lantern-text-secondary">
              Loading…
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {comments.map((comment) => (
                <li key={comment.id} className="flex items-start gap-2">
                  <Avatar
                    name={comment.senderName}
                    src={comment.senderAvatarUrl}
                    size="xs"
                    localOnly={lowDataMode}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-lantern-text">
                      {comment.senderName}
                      <span className="ml-2 font-normal text-lantern-text-tertiary">
                        {boardRelativeTime(comment.timestamp)}
                      </span>
                    </p>
                    {comment.removedAt ? (
                      <p className="text-sm italic text-lantern-text-tertiary">
                        {COMMUNITY_BOARD_COPY.postRemoved}
                      </p>
                    ) : (
                      <>
                        <p className="whitespace-pre-wrap break-words text-sm text-lantern-text">
                          {boardPostText(comment.text)}
                        </p>
                        <BoardPostMedia
                          text={comment.text}
                          imageUrl={comment.imageUrl}
                          eager={!lowDataMode}
                          variant="thumb"
                          cropped
                        />
                        <FavoriteButton
                          count={boardFavoriteCount(comment.reactions)}
                          mine={isBoardFavorited(myReactions[comment.id])}
                          onToggle={(added) => void handleFavorite(comment.id, added)}
                        />
                        {/* Which reply answered the question, and — for the
                            author or a moderator — the accept/clear control. */}
                        <CommentAnswer
                          isAnswer={answeredMessageId === comment.id}
                          canMark={canMarkAnswered}
                          onMark={() => onSetAnswer?.(comment.id)}
                          onClear={() => onSetAnswer?.(null)}
                        />
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="shrink-0 border-t border-lantern-border">
          {composing ? (
            <MessageInputBar
              onSendMessage={handleSend}
              mentionCandidates={mentionCandidates}
              groupId={groupId}
              placeholder={COMMUNITY_BOARD_COPY.commentPlaceholder}
              sendLabel={COMMUNITY_BOARD_COPY.comment}
              autoFocus
            />
          ) : (
            <div className="p-3">
              <button
                type="button"
                onClick={() => setComposing(true)}
                className="w-full min-h-[44px] rounded-full border border-lantern-border bg-lantern-background px-3 text-left text-sm text-lantern-text-tertiary hover:bg-lantern-background-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
              >
                {COMMUNITY_BOARD_COPY.comment}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BoardPostPanel;
