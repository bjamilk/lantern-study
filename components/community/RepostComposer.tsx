import React, { useState } from 'react';
import {
  BOARD_REPOST_QUOTE_MAX,
  COMMUNITY_BOARD_COPY,
  boardQuoteSnippet,
  type BoardPost,
} from '@lantern/shared/network';
import { Modal } from '../ui';

export interface RepostComposerProps {
  post: BoardPost;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (quote: string) => void;
}

/**
 * The optional comment on a repost.
 *
 * A repost with no comment is the common case and is one click away — Cancel
 * and Repost are both here, and Repost is enabled with the field empty. The
 * quote is capped by the SHARED `BOARD_REPOST_QUOTE_MAX`, which the server
 * re-checks: a limit that lives only in a client is a review blocker.
 */
export const RepostComposer: React.FC<RepostComposerProps> = ({
  post,
  busy,
  onCancel,
  onSubmit,
}) => {
  const [quote, setQuote] = useState('');
  const snippet = post.subject?.trim() || boardQuoteSnippet(post.text);

  return (
    <Modal isOpen onClose={onCancel} ariaLabelledBy="board-repost-title" maxWidthClass="max-w-md">
      <h2 id="board-repost-title" className="text-lg font-semibold text-lantern-text">
        {COMMUNITY_BOARD_COPY.repost}
      </h2>

      {/* What is being bumped, in text. No media is loaded here either. */}
      <div className="mt-3 rounded-lantern border border-lantern-border bg-lantern-background-secondary/60 p-3">
        <p className="text-xs font-semibold text-lantern-text">{post.senderName}</p>
        {snippet ? (
          <p className="mt-1 break-words text-xs text-lantern-text-secondary">{snippet}</p>
        ) : null}
      </div>

      <label htmlFor="board-repost-quote" className="sr-only">
        {COMMUNITY_BOARD_COPY.repostQuotePlaceholder}
      </label>
      <textarea
        id="board-repost-quote"
        value={quote}
        onChange={(event) => setQuote(event.target.value)}
        maxLength={BOARD_REPOST_QUOTE_MAX}
        rows={3}
        autoFocus
        placeholder={COMMUNITY_BOARD_COPY.repostQuotePlaceholder}
        className="mt-3 w-full rounded-lantern border border-lantern-border bg-lantern-background px-3 py-2 text-sm text-lantern-text placeholder:text-lantern-text-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
      />

      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-[44px] rounded-lantern px-4 text-sm font-medium text-lantern-text-secondary hover:bg-lantern-background-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSubmit(quote)}
          disabled={busy}
          className="min-h-[44px] rounded-lantern bg-lantern-primary px-4 text-sm font-semibold text-white disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
        >
          {busy ? COMMUNITY_BOARD_COPY.posting : COMMUNITY_BOARD_COPY.repost}
        </button>
      </div>
    </Modal>
  );
};

export default RepostComposer;
