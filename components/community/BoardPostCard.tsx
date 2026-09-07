import React, { useState } from 'react';
import { AppIcon } from '../ui/AppIcon';
import {
  BOARD_ACTION_ROW_ORDER,
  BOARD_FAVORITE_EMOJI,
  COMMUNITY_BOARD_COPY,
  boardBookmarkAccessibilityLabel,
  boardCommentAccessibilityLabel,
  boardFavoriteAccessibilityLabel,
  boardPostAccessibilityLabel,
  boardRelativeTime,
  boardRepostAccessibilityLabel,
  boardShareAccessibilityLabel,
  type BoardAction,
  type BoardPost,
  type BoardQuotedPost,
} from '@lantern/shared/network';
import {
  canEditChatMessage,
  canRemoveChatMessage,
  parseChatAudioUrl,
  parseChatImageUrl,
} from '@lantern/shared/utils';
import { useResolvedStorageUrl } from '../../hooks/useResolvedStorageUrl';
import { Avatar, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../ui';

export interface BoardPostCardProps {
  post: BoardPost;
  currentUserId: string;
  /**
   * Emoji the viewer has added to the ACTION TARGET — the original on a repost
   * card, the post itself otherwise (§6.5). The parent resolves that id, so
   * favoriting from a repost never fragments the original's count.
   */
  myReactions?: string[];
  /** The viewer passes `canPinOnBoard` — shows Pin / Unpin. */
  canPin: boolean;
  lowDataMode: boolean;
  /** Freshly created by this viewer: a 1.2s wash (static under reduced motion). */
  highlighted?: boolean;
  /**
   * The device-local "Save for me". Still here because a database without
   * `message_bookmarks` has to keep working; it is deleted in Phase 2, once
   * the one-time import has run everywhere.
   */
  saved: boolean;
  /** Account-level bookmark on the action target. */
  bookmarked: boolean;
  /** False when `message_bookmarks` is not applied yet: the control is hidden. */
  bookmarksAvailable: boolean;
  /** The action target's counts — see `myReactions`. */
  favoriteCount: number;
  commentCount: number;
  /** Optimistic states for the viewer's own post. */
  sending?: boolean;
  failed?: boolean;
  onRetry?: () => void;
  onToggleReaction: (emoji: string, added: boolean) => void;
  onOpenComments: () => void;
  /** Repost, or undo the viewer's own. The parent decides which and refuses. */
  onRepost: () => void;
  onToggleBookmark: () => void;
  onShare: () => void;
  onCopyText: () => void;
  onToggleSave: () => void;
  onReport: () => void;
  onEdit: (text: string) => Promise<void> | void;
  onDelete: () => void;
  /**
   * May this viewer remove somebody ELSE's post? Decided by `boardPostRules`
   * in the parent and passed in — a card never tests a role itself.
   */
  canRemoveAsModerator?: boolean;
  onRemoveAsModerator?: () => void;
  /** "Announcement" / "Question" / "Event"; null for a plain discussion. */
  postKindLabel?: string | null;
  onTogglePin: () => void;
  onStartStudyGroup: () => void;
}

const MEDIA_CHIP_CLASS =
  'inline-flex min-h-[44px] items-center gap-1.5 rounded-lantern border border-lantern-border bg-lantern-background-secondary px-3 text-xs font-medium text-lantern-text-secondary';

/** The unresolvable case, said out loud instead of shown as a broken image. */
const MediaUnavailable: React.FC<{ label: string; icon: 'photo' | 'audio' }> = ({ label, icon }) => (
  <p className={`${MEDIA_CHIP_CLASS} text-lantern-text-tertiary`}>
    {icon === 'photo' ? (
      <AppIcon name="image" size={16} />
    ) : (
      <AppIcon name="mic" size={16} />
    )}
    {label}
  </p>
);

/**
 * A board post's photo and voice note.
 *
 * Two things this deliberately does NOT do.
 *
 * It never puts the stored url straight into a `src`. That string is a
 * REFERENCE: it was signed at upload time and `clampSignedUrlTtl` caps every
 * signed URL at 24 hours, so a day later it is a 400 and the card showed a
 * broken-image icon. `useResolvedStorageUrl` re-signs it on read through
 * POST /api/v1/storage/signed-url[s], which re-checks board membership as it
 * goes; every resolve landing in the same tick is batched into one request, so
 * a page of photo posts costs one call, not one per card.
 *
 * And it never loads anything the reader did not ask for while low-data mode
 * is on. The list renders the 480px `thumb` sibling that
 * `processImageForUpload` already writes for every upload and that nothing
 * used to request — 15–35 KB against 100–250 KB for the original, which at
 * ₦0.30–0.50/MB is the difference between ₦0.01 and ₦0.13 a card.
 */
export const BoardPostMedia: React.FC<{
  text: string;
  /**
   * `messages.image_url` — the first encoding. Legacy posts keep theirs as
   * markdown inside `text`, which is still parsed as the fallback, so nothing
   * posted before this release stops rendering.
   */
  imageUrl?: string | null;
  /** Load without a tap. Off in low-data mode, where the chip stays. */
  eager?: boolean;
  /** `thumb` on a list card, `original` in the post view. */
  variant?: 'thumb' | 'original';
  /** List cards crop to a Twitter-shaped band; the post view shows the whole photo. */
  cropped?: boolean;
}> = ({ text, imageUrl: imageUrlProp, eager, variant = 'original', cropped = false }) => {
  const imageUrl = imageUrlProp || parseChatImageUrl(text);
  const audioUrl = parseChatAudioUrl(text);
  const [showImage, setShowImage] = useState(!!eager);
  const [showAudio, setShowAudio] = useState(!!eager);

  // Passing null until the reader asks keeps the tap-to-load promise honest:
  // the hook signs nothing, so nothing is fetched.
  const resolvedImage = useResolvedStorageUrl(showImage ? imageUrl : null, { variant });
  const resolvedAudio = useResolvedStorageUrl(showAudio ? audioUrl : null);

  if (!imageUrl && !audioUrl) return null;

  return (
    <div className="mt-2 space-y-2">
      {imageUrl ? (
        !showImage ? (
          <button
            type="button"
            onClick={() => setShowImage(true)}
            className={`${MEDIA_CHIP_CLASS} hover:bg-lantern-border focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary`}
          >
            <AppIcon name="image" size={16} />
            {COMMUNITY_BOARD_COPY.photoTapToLoad}
          </button>
        ) : resolvedImage === null ? (
          <MediaUnavailable label={COMMUNITY_BOARD_COPY.photoUnavailable} icon="photo" />
        ) : resolvedImage === undefined ? (
          <p className={MEDIA_CHIP_CLASS} role="status">
            <AppIcon name="image" size={16} />
            {COMMUNITY_BOARD_COPY.photoLoading}
          </p>
        ) : (
          <img
            src={resolvedImage}
            alt="Post attachment"
            loading="lazy"
            className={
              cropped
                ? 'aspect-[16/9] w-full rounded-lantern border border-lantern-border object-cover bg-lantern-background-secondary'
                : 'max-h-96 w-full rounded-lantern object-contain bg-lantern-background-secondary'
            }
          />
        )
      ) : null}
      {audioUrl ? (
        !showAudio ? (
          <button
            type="button"
            onClick={() => setShowAudio(true)}
            className={`${MEDIA_CHIP_CLASS} hover:bg-lantern-border focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary`}
          >
            <AppIcon name="mic" size={16} />
            {COMMUNITY_BOARD_COPY.voiceNote}
          </button>
        ) : resolvedAudio === null ? (
          <MediaUnavailable label={COMMUNITY_BOARD_COPY.voiceNoteUnavailable} icon="audio" />
        ) : resolvedAudio === undefined ? (
          <p className={MEDIA_CHIP_CLASS} role="status">
            <AppIcon name="mic" size={16} />
            {COMMUNITY_BOARD_COPY.voiceNoteLoading}
          </p>
        ) : (
          // preload="none": a voice note fetches on play, never on render (§10).
          <audio src={resolvedAudio} controls preload="none" className="w-full max-w-sm" />
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

/** One control in the action row: ≥44px, icon + optional count, never colour-only. */
const ACTION_BUTTON_CLASS =
  'inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-lantern px-2.5 text-xs font-medium text-lantern-text-secondary hover:bg-lantern-background-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary disabled:opacity-50 disabled:hover:bg-transparent';

/**
 * The quoted original inside a repost card.
 *
 * TEXT ONLY, on purpose: it carries `hasImage` / `hasAudio` flags and never a
 * media URL, so a repost card downloads exactly zero bytes of media like every
 * other list card. A takedown of the original propagates here with no writes
 * to any repost row, and an id that no longer resolves says so rather than
 * rendering a blank block.
 */
const QuotedPost: React.FC<{ quoted: BoardQuotedPost | null }> = ({ quoted }) => {
  const shell =
    'mt-2 rounded-lantern border border-lantern-border bg-lantern-background-secondary/60 p-3';
  if (!quoted) {
    return (
      <p className={`${shell} text-xs italic text-lantern-text-tertiary`}>
        {COMMUNITY_BOARD_COPY.quotedUnavailable}
      </p>
    );
  }
  if (quoted.removedAt) {
    return (
      <p className={`${shell} text-xs italic text-lantern-text-tertiary`}>
        {COMMUNITY_BOARD_COPY.quotedRemoved}
      </p>
    );
  }
  return (
    <div className={shell}>
      <p className="text-xs font-semibold text-lantern-text">
        {quoted.senderName}
        <span className="ml-2 font-normal text-lantern-text-tertiary">
          {boardRelativeTime(quoted.timestamp)}
        </span>
      </p>
      {quoted.subject ? (
        <p className="mt-1 break-words text-xs font-bold text-lantern-text">{quoted.subject}</p>
      ) : null}
      {quoted.snippet ? (
        <p className="mt-1 break-words text-xs text-lantern-text-secondary">{quoted.snippet}</p>
      ) : null}
      {quoted.hasImage || quoted.hasAudio ? (
        <p className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-lantern-text-tertiary">
          {quoted.hasImage ? (
            <AppIcon name="image" size={14} />
          ) : (
            <AppIcon name="mic" size={14} />
          )}
          {quoted.hasImage ? COMMUNITY_BOARD_COPY.photoTapToLoad : COMMUNITY_BOARD_COPY.voiceNote}
        </p>
      ) : null}
    </div>
  );
};

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
  bookmarked,
  bookmarksAvailable,
  favoriteCount,
  commentCount,
  sending = false,
  failed = false,
  onRetry,
  onToggleReaction,
  onOpenComments,
  onRepost,
  onToggleBookmark,
  onShare,
  onCopyText,
  onToggleSave,
  onReport,
  onEdit,
  onDelete,
  canRemoveAsModerator = false,
  onRemoveAsModerator,
  postKindLabel = null,
  onTogglePin,
  onStartStudyGroup,
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const isOwn = post.senderId === currentUserId;
  const when = boardRelativeTime(post.timestamp);
  const body = boardPostText(post.text);
  const isRepost = !!post.repostOf;
  /**
   * An unconfirmed post has no server-side row yet, so every action on it
   * would be a no-op. Disabled says that; leaving them live would mean a Share
   * button that quietly does nothing.
   */
  const pending = sending || failed;
  const favorited = myReactions.includes(BOARD_FAVORITE_EMOJI);
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
      {/*
        Who bumped this, in an icon AND in words. Never colour alone, and never
        a badge that a screen reader would read as decoration: the reposter's
        name is the only thing on the card that is not the original author's.
      */}
      {isRepost ? (
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-lantern-text-tertiary">
          <AppIcon name="repeat" size={14} />
          {COMMUNITY_BOARD_COPY.repostedBy(post.senderName)}
        </p>
      ) : null}

      <div className="flex items-start gap-2">
        <Avatar name={post.senderName} src={post.senderAvatarUrl} size="sm" localOnly={lowDataMode} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-lantern-text">
            <span className="truncate">{post.senderName}</span>
            {/* What the post is, in a word — an announcement that looked like
                every other post was an announcement nobody read. */}
            {postKindLabel ? (
              <span className="shrink-0 rounded-full bg-lantern-feature-campus-tint px-2 py-0.5 text-label font-medium text-lantern-feature-campus-ink">
                {postKindLabel}
              </span>
            ) : null}
          </p>
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
            <AppIcon name="ellipsis-horizontal" size={20} />
          </MenuTrigger>
          <MenuContent align="end" className="w-56">
            {/* §8 parity rule 7 binds the row ORDER and the rows themselves.
                A media-only post has nothing to copy, so mobile omits the row
                and web must too. */}
            {body ? (
              <MenuItem onSelect={onCopyText}>{COMMUNITY_BOARD_COPY.copyText}</MenuItem>
            ) : null}
            {/*
              "Save for me" LEAVES the overflow in the release Bookmark enters
              the row — one save affordance, not two. It survives only for a
              database that has not had `message_bookmarks` hand-applied yet,
              where hiding both would take the feature away entirely.
            */}
            {bookmarksAvailable ? null : (
              <MenuItem onSelect={onToggleSave}>
                {saved ? COMMUNITY_BOARD_COPY.saved : COMMUNITY_BOARD_COPY.saveForMe}
              </MenuItem>
            )}
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
            {/* A moderator removing somebody else's post. Worded as "Remove",
                not "Delete": the card stays, carrying the reason. */}
            {!isOwn && canRemoveAsModerator && onRemoveAsModerator ? (
              <MenuItem destructive onSelect={onRemoveAsModerator}>
                Remove post
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
          {/*
            The list shows the photo INLINE, Twitter-shaped, from the 480px
            `thumb` sibling that every upload already generates — a card is a
            few tens of KB, not a few hundred. Low-data mode keeps the
            tap-to-load chip, so nothing is fetched until the reader asks.
          */}
          <BoardPostMedia
            text={post.text}
            imageUrl={post.imageUrl}
            eager={!lowDataMode}
            variant="thumb"
            cropped
          />
          {isRepost ? <QuotedPost quoted={post.repostOf} /> : null}
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

      {/*
        The five-control action row (§9.1), rendered FROM
        `BOARD_ACTION_ROW_ORDER` rather than hand-ordered, so web and Android
        cannot drift into two different orders. Counts are hidden at zero —
        that is what makes five 44px targets fit inside a 320dp screen — but
        never hidden from the accessibility label. State is carried by an
        outline-vs-solid icon AND by words, never by colour alone.
      */}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {BOARD_ACTION_ROW_ORDER.map((action: BoardAction) => {
          switch (action) {
            case 'comment':
              return (
                <button
                  key={action}
                  type="button"
                  onClick={onOpenComments}
                  disabled={pending}
                  aria-label={boardCommentAccessibilityLabel(commentCount)}
                  className={ACTION_BUTTON_CLASS}
                >
                  <AppIcon name="chatbubble" size={16} />
                  {commentCount > 0 ? commentCount : null}
                </button>
              );
            case 'repost':
              return (
                <button
                  key={action}
                  type="button"
                  onClick={onRepost}
                  disabled={pending}
                  aria-pressed={post.repostedByMe}
                  aria-label={boardRepostAccessibilityLabel(post.repostCount, post.repostedByMe)}
                  className={ACTION_BUTTON_CLASS}
                >
                  {post.repostedByMe ? (
                    <AppIcon name="repeat" size={16} className="text-lantern-primary" />
                  ) : (
                    <AppIcon name="repeat" size={16} />
                  )}
                  {post.repostCount > 0 ? post.repostCount : null}
                </button>
              );
            case 'favorite':
              /*
                Favorite replaces the emoji React on BOARD surfaces only
                (§4.1): the same `message_reactions` table and the same
                endpoints with the emoji pinned, so group chat and DMs keep the
                full picker and every heart already left on a board post counts
                forward untouched.
              */
              return (
                <button
                  key={action}
                  type="button"
                  onClick={() => onToggleReaction(BOARD_FAVORITE_EMOJI, !favorited)}
                  disabled={pending}
                  aria-pressed={favorited}
                  aria-label={boardFavoriteAccessibilityLabel(favoriteCount, favorited)}
                  className={ACTION_BUTTON_CLASS}
                >
                  {favorited ? (
                    <AppIcon name="heart" size={16} filled className="text-lantern-error" />
                  ) : (
                    <AppIcon name="heart" size={16} />
                  )}
                  {favoriteCount > 0 ? favoriteCount : null}
                </button>
              );
            case 'bookmark':
              // Hidden, not disabled, where `message_bookmarks` has not been
              // applied: a control that can only fail is worse than none, and
              // "Save for me" is still in the overflow in that state.
              if (!bookmarksAvailable) return null;
              return (
                <button
                  key={action}
                  type="button"
                  onClick={onToggleBookmark}
                  disabled={pending}
                  aria-pressed={bookmarked}
                  aria-label={boardBookmarkAccessibilityLabel(bookmarked)}
                  className={ACTION_BUTTON_CLASS}
                >
                  {bookmarked ? (
                    <AppIcon name="bookmark" size={16} filled className="text-lantern-primary" />
                  ) : (
                    <AppIcon name="bookmark" size={16} />
                  )}
                </button>
              );
            case 'share':
              return (
                <button
                  key={action}
                  type="button"
                  onClick={onShare}
                  disabled={pending}
                  aria-label={boardShareAccessibilityLabel()}
                  className={ACTION_BUTTON_CLASS}
                >
                  <AppIcon name="share-social" size={16} />
                </button>
              );
            default:
              return null;
          }
        })}
      </div>
    </article>
  );
};

export default BoardPostCard;
