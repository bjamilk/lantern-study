import React, { useRef, useState } from 'react';
import { AppIcon } from '../ui/AppIcon';
import type { AppIconName } from '../ui/appIconMap';
import {
  BOARD_POST_KINDS,
  BOARD_POST_KIND_DEFAULT,
  BOARD_POST_SUBJECT_MAX,
  COMMUNITY_BOARD_COPY,
  COMMUNITY_MODERATION_COPY,
  boardPostKindMeta,
  canPostBoardKind,
  canPostOnBoard,
  validateBoardSubject,
  type BoardPostKind,
  type CommunityRole,
} from '@lantern/shared/network';
import MessageInputBar, { type MentionCandidate, type SendMessageOptions } from '../MessageInputBar';
import { Avatar } from '../ui';

export interface BoardComposerProps {
  groupId: string;
  authorName: string;
  authorAvatarUrl?: string | null;
  lowDataMode: boolean;
  mentionCandidates: MentionCandidate[];
  /** The viewer's community role — the ONLY input to which kinds are offered. */
  viewerRole?: CommunityRole | null;
  isMember?: boolean;
  /** The viewer's own `community_members.muted_until`, when it is known. */
  mutedUntil?: string | null;
  /** Resolves once the post is accepted (or rejected) — the pill collapses either way. */
  onPost: (
    text: string,
    options: SendMessageOptions & { subject: string | null; postKind: BoardPostKind }
  ) => Promise<void>;
}

/**
 * The docked composer (spec §4.1 region 6): a collapsed pill on a board, which
 * expands to an optional title, the shared message body (photo, voice note,
 * `@mention` autocomplete) and `Post`. It collapses again after sending, and
 * focus returns to the pill — the board is a place you post to, not a chat you
 * sit inside.
 */
export const BoardComposer: React.FC<BoardComposerProps> = ({
  groupId,
  authorName,
  authorAvatarUrl,
  lowDataMode,
  mentionCandidates,
  viewerRole = null,
  isMember = true,
  mutedUntil = null,
  onPost,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [subject, setSubject] = useState('');
  const [postKind, setPostKind] = useState<BoardPostKind>(BOARD_POST_KIND_DEFAULT);
  const [subjectError, setSubjectError] = useState<string | null>(null);
  const pillRef = useRef<HTMLButtonElement>(null);

  /**
   * May this viewer post at all right now, and which kinds? Both answers come
   * from the shared rules — a muted member READS the whole board and cannot
   * write, and only a moderator may announce. The server re-decides both.
   */
  const kinds = BOARD_POST_KINDS.filter((kind) => canPostBoardKind(viewerRole, kind));
  /**
   * The kind that will actually be sent. A moderator who picked Announcement
   * and was demoted mid-session must not keep a selection the server will
   * refuse with a 403 — it falls back to the default rather than silently
   * sending as something the picker no longer offers.
   */
  const activeKind: BoardPostKind = kinds.includes(postKind) ? postKind : BOARD_POST_KIND_DEFAULT;
  const gate = canPostOnBoard({ role: viewerRole, isMember, mutedUntil, postKind: activeKind });

  const collapse = () => {
    setExpanded(false);
    setSubject('');
    setPostKind(BOARD_POST_KIND_DEFAULT);
    setSubjectError(null);
    // Collapsing returns focus to the pill that opened it (§9).
    window.setTimeout(() => pillRef.current?.focus(), 0);
  };

  const handleSend = async (text: string, options?: SendMessageOptions) => {
    const validated = validateBoardSubject(subject);
    if (validated.error) {
      setSubjectError(validated.error);
      // Thrown, not returned: `MessageInputBar` clears the body and the held
      // photo the moment it starts sending, and only puts them back when the
      // send throws. Returning here quietly binned a typed post and an
      // already-paid-for upload over a too-long title. The message is empty on
      // purpose — the error belongs beside the title field that caused it, and
      // `recordError` is falsy for '' so it is not also shown twice.
      throw new Error('');
    }
    setSubjectError(null);
    await onPost(text, { ...options, subject: validated.subject, postKind: activeKind });
    collapse();
  };

  // Muted, or looking at a board in a community they have not joined: say
  // which it is, in the shared words, and offer no composer to fight with.
  if (!gate.ok && gate.reason !== 'restricted_kind') {
    return (
      <div className="border-t border-lantern-border bg-lantern-surface p-3">
        <p className="text-body font-medium text-lantern-text">
          {gate.reason === 'muted'
            ? COMMUNITY_MODERATION_COPY.mutedTitle
            : COMMUNITY_MODERATION_COPY.notMember}
        </p>
        {gate.reason === 'muted' ? (
          <p className="text-caption text-lantern-text-secondary">
            {COMMUNITY_MODERATION_COPY.mutedBody}
          </p>
        ) : null}
      </div>
    );
  }

  if (!expanded) {
    return (
      <div className="border-t border-lantern-border bg-lantern-surface p-3">
        <button
          ref={pillRef}
          type="button"
          onClick={() => setExpanded(true)}
          aria-expanded={false}
          className="flex w-full min-h-[44px] items-center gap-2 rounded-full border border-lantern-border bg-lantern-background px-3 text-left text-sm text-lantern-text-tertiary hover:bg-lantern-background-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
        >
          <Avatar name={authorName} src={authorAvatarUrl} size="xs" localOnly={lowDataMode} />
          <span className="flex-1 truncate">{COMMUNITY_BOARD_COPY.composerPlaceholder}</span>
          <AppIcon name="image" size={16} className="shrink-0" />
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-lantern-border bg-lantern-surface p-3">
      {/* What the post IS. Announcement is absent for a member rather than
          disabled: a control that exists but refuses reads as "you are doing
          it wrong", and this is simply not their power. */}
      <div role="radiogroup" aria-label="Post kind" className="mb-2 flex flex-wrap gap-1.5">
        {kinds.map((kind) => {
          const meta = boardPostKindMeta(kind);
          const active = kind === activeKind;
          return (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setPostKind(kind)}
              className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3 text-caption font-semibold ${
                active
                  ? 'bg-lantern-feature-campus-ink text-white'
                  : 'bg-lantern-background-secondary text-lantern-text-secondary hover:text-lantern-text'
              }`}
            >
              <AppIcon name={meta.icon as AppIconName} size={16} />
              {meta.label}
            </button>
          );
        })}
      </div>

      <div className="mb-2 flex items-center gap-2">
        <label htmlFor="board-post-subject" className="sr-only">
          {COMMUNITY_BOARD_COPY.subjectPlaceholder}
        </label>
        <input
          id="board-post-subject"
          type="text"
          value={subject}
          maxLength={BOARD_POST_SUBJECT_MAX}
          onChange={(event) => {
            setSubject(event.target.value);
            if (subjectError) setSubjectError(null);
          }}
          placeholder={COMMUNITY_BOARD_COPY.subjectPlaceholder}
          aria-invalid={subjectError ? true : undefined}
          aria-describedby={subjectError ? 'board-post-subject-error' : undefined}
          className="min-h-[44px] flex-1 rounded-lantern border border-lantern-border bg-lantern-background px-3 text-sm text-lantern-text placeholder:text-lantern-text-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
        />
        <button
          type="button"
          onClick={collapse}
          className="min-h-[44px] rounded-lantern px-3 text-sm font-medium text-lantern-text-secondary hover:bg-lantern-background-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
        >
          Cancel
        </button>
      </div>
      {subjectError ? (
        <p id="board-post-subject-error" role="alert" className="mb-2 text-xs text-lantern-error">
          {subjectError}
        </p>
      ) : null}
      <MessageInputBar
        onSendMessage={handleSend}
        mentionCandidates={mentionCandidates}
        groupId={groupId}
        placeholder={COMMUNITY_BOARD_COPY.composerPlaceholder}
        sendLabel={COMMUNITY_BOARD_COPY.post}
        autoFocus
        // A title, a body and one photo as ONE row (§5). Chat keeps the
        // default `'send'`, where a photo is still its own message.
        attachmentMode="inline"
      />
    </div>
  );
};

export default BoardComposer;
