import React, { useState } from 'react';
import {
  ChatBubbleOvalLeftIcon,
  EllipsisHorizontalIcon,
  MicrophoneIcon,
  PhotoIcon,
} from '@heroicons/react/24/outline';
import { BookmarkIcon as BookmarkSolidIcon } from '@heroicons/react/24/solid';
import {
  COMMUNITY_BOARD_COPY,
  boardPostAccessibilityLabel,
  boardRelativeTime,
  reactionAccessibilityLabel,
  type BoardPost,
} from '@lantern/shared/network';
import {
  canEditChatMessage,
  canRemoveChatMessage,
  parseChatAudioUrl,
  parseChatImageUrl,
} from '@lantern/shared/utils';
import MessageReactions from '../chat/MessageReactions';
import { Avatar, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../ui';

export interface BoardPostCardProps {
  post: BoardPost;
  currentUserId: string;
  /** Emoji the viewer has personally added to this post. */
  myReactions?: string[];
  /** The viewer passes `canPinOnBoard` — shows Pin / Unpin. */
  canPin: boolean;
  lowDataMode: boolean;
  /** Freshly created by this viewer: a 1.2s wash (static under reduced motion). */
  highlighted?: boolean;
  /** Personal, device-local bookmark. */
  saved: boolean;
  /** Optimistic states for the viewer's own post. */
  sending?: boolean;
  failed?: boolean;
  onRetry?: () => void;
  onToggleReaction: (emoji: string, added: boolean) => void;
  onOpenComments: () => void;
  onCopyText: () => void;
  onToggleSave: () => void;
  onReport: () => void;
  onEdit: (text: string) => Promise<void> | void;
  onDelete: () => void;
  onTogglePin: () => void;
  onStartStudyGroup: () => void;
}

/**
 * Media on a board list is a text chip, never a download (spec §10): at 20
 * cards a page the images are the whole data bill. The chip loads on tap, and
 * the comments panel loads it outright.
 */
export const BoardPostMedia: React.FC<{ text: string; eager?: boolean }> = ({ text, eager }) => {
  const imageUrl = parseChatImageUrl(text);
  const audioUrl = parseChatAudioUrl(text);
  const [showImage, setShowImage] = useState(!!eager);
  const [showAudio, setShowAudio] = useState(!!eager);

  if (!imageUrl && !audioUrl) return null;

  return (
    <div className="mt-2 space-y-2">
      {imageUrl ? (
        showImage ? (
          <img
            src={imageUrl}
            alt="Post attachment"
            loading="lazy"
            className="max-h-96 w-full rounded-lantern object-contain bg-lantern-background-secondary"
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowImage(true)}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lantern border border-lantern-border bg-lantern-background-secondary px-3 text-xs font-medium text-lantern-text-secondary hover:bg-lantern-border focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
          >
            <PhotoIcon className="h-4 w-4" aria-hidden="true" />
            {COMMUNITY_BOARD_COPY.photoTapToLoad}
          </button>
        )
      ) : null}
      {audioUrl ? (
        showAudio ? (
          // preload="none": a voice note fetches on play, never on render (§10).
          <audio src={audioUrl} controls preload="none" className="w-full max-w-sm" />
        ) : (
          <button
            type="button"
            onClick={() => setShowAudio(true)}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lantern border border-lantern-border bg-lantern-background-secondary px-3 text-xs font-medium text-lantern-text-secondary hover:bg-lantern-border focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
          >
            <MicrophoneIcon className="h-4 w-4" aria-hidden="true" />
            {COMMUNITY_BOARD_COPY.voiceNote}
          </button>
        )
      ) : null}
    </div>
  );
};

/** The post body with its media stripped out — media renders as its own chip. */
export const boardPostText = (text: string): string =>
  text
    .replace(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/gi, '')
    .replace(/\[audio\]\((https?:\/\/[^)\s]+)\)/gi, '')
    .trim();

/**
 * One card on a board (spec §4.2). Deliberately NOT a bubble: no left/right
 * alignment, no tail, no sender grouping, no date separators, no ticks, no
 * "Seen by N of M", no vote arrows, no VERIFIED chip, no flag-duplicate.
 */
export const BoardPostCard: React.FC<BoardPostCardProps> = ({
  post,
  currentUserId,
  myReactions = [],
  canPin,
  lowDataMode,
  highlighted = false,
  saved,
  sending = false,
  failed = false,
  onRetry,
  onToggleReaction,
  onOpenComments,
  onCopyText,
  onToggleSave,
  onReport,
  onEdit,
  onDelete,
  onTogglePin,
  onStartStudyGroup,
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const isOwn = post.senderId === currentUserId;
  const when = boardRelativeTime(post.timestamp);
  const body = boardPostText(post.text);
  const mutationCandidate = {
    id: post.id,
    senderId: post.senderId,
    timestamp: post.timestamp,
    type: 'TEXT' as const,
    text: post.text,
    removedAt: post.removedAt ?? undefined,
  };
  const canEdit = canEditChatMessage(mutationCandidate, currentUserId);
  const canDelete = canRemoveChatMessage(mutationCandidate, currentUserId);

  if (post.removedAt) {
    return (
      <article
        aria-label={boardPostAccessibilityLabel(post)}
        className="rounded-lantern-xl border border-dashed border-lantern-border bg-lantern-background-secondary/60 p-4"
      >
        <p className="text-sm italic text-lantern-text-tertiary">
          {COMMUNITY_BOARD_COPY.postRemoved}
        </p>
      </article>
    );
  }

  const saveEdit = async () => {
    const next = draft.trim();
    if (!next || savingEdit) return;
    setSavingEdit(true);
    try {
      await onEdit(next);
      setEditing(false);
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <article
      aria-label={boardPostAccessibilityLabel(post)}
      className={`rounded-lantern-xl border border-lantern-border p-4 transition-colors duration-700 motion-reduce:transition-none ${
        highlighted ? 'bg-lantern-primary-background' : 'bg-lantern-surface'
      }`}
    >
      <div className="flex items-start gap-2">
        <Avatar name={post.senderName} src={post.senderAvatarUrl} size="sm" localOnly={lowDataMode} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-lantern-text">{post.senderName}</p>
          <p className="text-[11px] text-lantern-text-tertiary">
            {when}
            {post.editedAt ? ' · edited' : ''}
          </p>
        </div>
        <Menu>
          <MenuTrigger
            aria-label="Post options"
            title="Post options"
            className="-mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-lantern text-lantern-text-secondary hover:bg-lantern-background-secondary hover:text-lantern-text focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
          >
            <EllipsisHorizontalIcon className="h-5 w-5" aria-hidden="true" />
          </MenuTrigger>
          <MenuContent align="end" className="w-56">
            {/* §8 parity rule 7 binds the row ORDER and the rows themselves.
                A media-only post has nothing to copy, so mobile omits the row
                and web must too. */}
            {body ? (
              <MenuItem onSelect={onCopyText}>{COMMUNITY_BOARD_COPY.copyText}</MenuItem>
            ) : null}
            <MenuItem onSelect={onToggleSave}>
              {saved ? COMMUNITY_BOARD_COPY.saved : COMMUNITY_BOARD_COPY.saveForMe}
            </MenuItem>
            {isOwn ? null : (
              <MenuItem onSelect={onReport}>{COMMUNITY_BOARD_COPY.reportPost}</MenuItem>
            )}
            {isOwn && canEdit ? (
              <MenuItem
                onSelect={() => {
                  setDraft(post.text);
                  setEditing(true);
                }}
              >
                {COMMUNITY_BOARD_COPY.editPost}
              </MenuItem>
            ) : null}
            {isOwn && canDelete ? (
              <MenuItem destructive onSelect={onDelete}>
                {COMMUNITY_BOARD_COPY.deletePost}
              </MenuItem>
            ) : null}
            {canPin ? (
              <MenuItem onSelect={onTogglePin}>
                {post.pinnedAt ? COMMUNITY_BOARD_COPY.unpin : COMMUNITY_BOARD_COPY.pin}
              </MenuItem>
            ) : null}
            <MenuSeparator />
            <MenuItem onSelect={onStartStudyGroup}>{COMMUNITY_BOARD_COPY.openStudyGroup}</MenuItem>
          </MenuContent>
        </Menu>
      </div>

      {post.subject ? (
        <h3 className="mt-2 break-words text-sm font-bold text-lantern-text">{post.subject}</h3>
      ) : null}

      {editing ? (
        <div className="mt-2 space-y-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={3}
            aria-label={COMMUNITY_BOARD_COPY.editPost}
            className="w-full rounded-lantern border border-lantern-border bg-lantern-background px-3 py-2 text-sm text-lantern-text focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void saveEdit()}
              disabled={!draft.trim() || savingEdit}
              className="min-h-[44px] rounded-lantern bg-lantern-primary px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="min-h-[44px] rounded-lantern px-4 text-sm font-medium text-lantern-text-secondary hover:bg-lantern-background-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          {body ? (
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-lantern-text">{body}</p>
          ) : null}
          <BoardPostMedia text={post.text} />
        </>
      )}

      {failed ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 min-h-[44px] text-xs font-semibold text-lantern-error hover:underline"
        >
          {COMMUNITY_BOARD_COPY.notSent}
        </button>
      ) : sending ? (
        <p className="mt-2 text-xs text-lantern-text-tertiary">{COMMUNITY_BOARD_COPY.posting}</p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <MessageReactions
          reactions={post.reactions}
          mine={myReactions}
          onToggle={onToggleReaction}
          size="touch"
          addLabel={COMMUNITY_BOARD_COPY.react}
          labelFor={reactionAccessibilityLabel}
        />
        <button
          type="button"
          onClick={onOpenComments}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lantern px-3 text-xs font-medium text-lantern-text-secondary hover:bg-lantern-background-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
        >
          <ChatBubbleOvalLeftIcon className="h-4 w-4" aria-hidden="true" />
          {COMMUNITY_BOARD_COPY.comments(post.replyCount)}
        </button>
        {saved ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-lantern-text-tertiary">
            <BookmarkSolidIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {COMMUNITY_BOARD_COPY.saved}
          </span>
        ) : null}
      </div>
    </article>
  );
};

export default BoardPostCard;
