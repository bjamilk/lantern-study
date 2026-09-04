import React, { useRef, useState } from 'react';
import { PhotoIcon } from '@heroicons/react/24/outline';
import {
  BOARD_POST_SUBJECT_MAX,
  COMMUNITY_BOARD_COPY,
  validateBoardSubject,
} from '@lantern/shared/network';
import MessageInputBar, { type MentionCandidate, type SendMessageOptions } from '../MessageInputBar';
import { Avatar } from '../ui';

export interface BoardComposerProps {
  groupId: string;
  authorName: string;
  authorAvatarUrl?: string | null;
  lowDataMode: boolean;
  mentionCandidates: MentionCandidate[];
  /** Resolves once the post is accepted (or rejected) — the pill collapses either way. */
  onPost: (text: string, options: SendMessageOptions & { subject: string | null }) => Promise<void>;
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
  onPost,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [subject, setSubject] = useState('');
  const [subjectError, setSubjectError] = useState<string | null>(null);
  const pillRef = useRef<HTMLButtonElement>(null);

  const collapse = () => {
    setExpanded(false);
    setSubject('');
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
    await onPost(text, { ...options, subject: validated.subject });
    collapse();
  };

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
          <PhotoIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-lantern-border bg-lantern-surface p-3">
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
