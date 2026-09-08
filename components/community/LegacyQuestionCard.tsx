import React from 'react';
import { AppIcon } from '../ui/AppIcon';
import {
  COMMUNITY_BOARD_COPY,
  boardPostAccessibilityLabel,
  boardRelativeTime,
  type BoardPost,
} from '@lantern/shared/network';
import { Avatar } from '../ui';

export interface LegacyQuestionCardProps {
  post: BoardPost;
  lowDataMode: boolean;
  /** "Start a study group about this" — the one action a legacy row keeps. */
  onStartStudyGroup: () => void;
}

/**
 * A `type='QUESTION'` row that predates the board (spec §4.2). Read-only: no
 * vote bar, no VERIFIED chip, no flag-duplicate — those live in a study group
 * now. Without this card these rows render blank, which is the one legacy-data
 * failure the acceptance criteria name (§11.12).
 */
export const LegacyQuestionCard: React.FC<LegacyQuestionCardProps> = ({
  post,
  lowDataMode,
  onStartStudyGroup,
}) => {
  const when = boardRelativeTime(post.timestamp);
  const stem = post.legacyQuestionStem || post.text;

  return (
    <article
      aria-label={boardPostAccessibilityLabel(post)}
      className="rounded-lantern-xl border border-lantern-border bg-lantern-surface p-4"
    >
      <div className="flex items-center gap-2">
        <Avatar
          name={post.senderName}
          id={post.senderId}
          src={post.senderAvatarUrl}
          size="sm"
          localOnly={lowDataMode}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-lantern-text">{post.senderName}</p>
          {when ? <p className="text-[11px] text-lantern-text-tertiary">{when}</p> : null}
        </div>
      </div>

      <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-lantern-background-secondary px-2.5 py-1 text-[11px] font-semibold text-lantern-text-secondary">
        <AppIcon name="school" size={14} />
        {COMMUNITY_BOARD_COPY.legacyQuestion}
      </p>

      {stem ? (
        <p className="mt-2 whitespace-pre-wrap break-words text-sm text-lantern-text">{stem}</p>
      ) : null}

      <button
        type="button"
        onClick={onStartStudyGroup}
        className="mt-3 min-h-[44px] rounded-lantern px-3 text-sm font-semibold text-lantern-primary hover:bg-lantern-primary-background focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
      >
        {COMMUNITY_BOARD_COPY.openStudyGroup}
      </button>
    </article>
  );
};

export default LegacyQuestionCard;
