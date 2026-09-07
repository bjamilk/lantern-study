import React, { useCallback, useEffect, useState } from 'react';
import { AppIcon } from '../ui/AppIcon';
import {
  BOARD_BOOKMARKS_PAGE_SIZE,
  COMMUNITY_BOARD_COPY,
  boardQuoteSnippet,
  boardRelativeTime,
  type BoardBookmarkEntry,
} from '@lantern/shared/network';
import { parseChatAudioUrl } from '@lantern/shared/utils';
import { fetchBookmarkedPosts } from '../../services/supabase';
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap';

export interface SavedPostsPanelProps {
  onClose: () => void;
  /** Opens one saved post — the caller routes to its board and its thread. */
  onOpenPost: (entry: BoardBookmarkEntry) => void;
}

/**
 * "Saved posts" — every board, newest-saved-first.
 *
 * A PANEL rather than a route, following the precedent `BoardPostPanel`
 * already set (mobile uses a screen for a post, web uses a panel). Parity rule
 * 7 binds payloads, copy and row order; it does not bind navigation chrome.
 *
 * Rows are TEXT ONLY. A photo is announced as a chip and never fetched, so
 * opening this list costs a few KB of JSON no matter how much media the saved
 * posts carry — the same rule the board list itself follows.
 *
 * There is no "how many people saved this", here or in any payload or column.
 * On a 30-person board where everyone can see the roster, a visible save count
 * turns a private "read this later" into a social signal.
 */
export const SavedPostsPanel: React.FC<SavedPostsPanelProps> = ({ onClose, onOpenPost }) => {
  const [entries, setEntries] = useState<BoardBookmarkEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * `false` means `message_bookmarks` has not been hand-applied yet. The panel
   * says so in one line instead of showing an empty list, which would read as
   * "you have saved nothing" — a lie the student would act on.
   */
  const [serverBacked, setServerBacked] = useState(true);
  const containerRef = useModalFocusTrap(true, onClose);

  const load = useCallback(async (before?: string) => {
    const page = await fetchBookmarkedPosts({ limit: BOARD_BOOKMARKS_PAGE_SIZE, before });
    setServerBacked(page.serverBacked);
    setCursor(page.nextCursor);
    setEntries((prev) => (before ? [...prev, ...page.entries] : page.entries));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load()
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load your saved posts');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      await load(cursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load more saved posts');
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-black/30" onClick={onClose}>
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="board-saved-title"
        onClick={(event) => event.stopPropagation()}
        className="flex h-full w-full flex-col border-l border-lantern-border bg-lantern-surface lg:w-[28rem]"
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-lantern-border px-4">
          <h2 id="board-saved-title" className="text-sm font-semibold text-lantern-text">
            {COMMUNITY_BOARD_COPY.savedPosts}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${COMMUNITY_BOARD_COPY.savedPosts}`}
            className="flex h-11 w-11 items-center justify-center rounded-lantern text-lantern-text-secondary hover:bg-lantern-background-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
          >
            <AppIcon name="close" size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {error ? (
            <p role="alert" className="text-xs text-lantern-error">
              {error}
            </p>
          ) : null}

          {loading ? (
            <p role="status" className="text-xs text-lantern-text-secondary">
              Loading…
            </p>
          ) : !serverBacked ? (
            <p className="text-sm text-lantern-text-secondary">
              {COMMUNITY_BOARD_COPY.bookmarksUnavailable}
            </p>
          ) : entries.length === 0 ? (
            <p className="text-sm text-lantern-text-secondary">
              {COMMUNITY_BOARD_COPY.savedPostsEmpty}
            </p>
          ) : (
            <ul className="space-y-2">
              {entries.map((entry) => {
                const hasPhoto = !!entry.post.imageUrl || /!\[[^\]]*\]\(/.test(entry.post.text);
                const hasAudio = !!parseChatAudioUrl(entry.post.text);
                const snippet = entry.post.subject?.trim() || boardQuoteSnippet(entry.post.text);
                return (
                  <li key={`${entry.groupId}:${entry.post.id}`}>
                    <button
                      type="button"
                      onClick={() => onOpenPost(entry)}
                      className="w-full rounded-lantern border border-lantern-border bg-lantern-background p-3 text-left hover:bg-lantern-background-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
                    >
                      <p className="truncate text-[11px] text-lantern-text-tertiary">
                        {entry.post.senderName}
                        {' · # '}
                        {entry.boardName}
                        {' · '}
                        {boardRelativeTime(entry.post.timestamp)}
                      </p>
                      <p className="mt-1 break-words text-sm font-medium text-lantern-text">
                        {snippet || COMMUNITY_BOARD_COPY.post}
                      </p>
                      {hasPhoto || hasAudio ? (
                        <p className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-lantern-text-tertiary">
                          {hasPhoto ? (
                            <AppIcon name="image" size={14} />
                          ) : (
                            <AppIcon name="mic" size={14} />
                          )}
                          {hasPhoto
                            ? COMMUNITY_BOARD_COPY.photoTapToLoad
                            : COMMUNITY_BOARD_COPY.voiceNote}
                        </p>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {cursor && serverBacked && !loading ? (
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="mx-auto mt-3 block min-h-[44px] rounded-lantern border border-lantern-border px-4 text-sm font-medium text-lantern-text-secondary hover:bg-lantern-background-secondary disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
            >
              {loadingMore ? 'Loading…' : COMMUNITY_BOARD_COPY.loadOlder}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default SavedPostsPanel;
