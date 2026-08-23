import React, { useCallback, useEffect, useState } from 'react';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import {
  describeFeedItem,
  learningConnectionLabel,
  type FeedItem,
  type LearningConnectionSummary,
} from '@lantern/shared/network';
import { fetchFeed, fetchLearningConnections } from '../services/supabase';

/**
 * The Academic Feed panel (Phase 3 · M).
 *
 * PULL-BASED. Web already holds ~8 realtime channels per user, so this
 * deliberately fetches on mount and on an explicit refresh rather than opening
 * a ninth subscription. Direct-to-me events stay in notifications.
 */
export interface AcademicFeedPanelProps {
  onNavigate?: (screen: string, params?: Record<string, unknown>) => void;
  limit?: number;
  className?: string;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diff = Date.now() - then;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d ago` : new Date(then).toLocaleDateString();
}

/** Where a feed row should take you, or null when the object is not routable. */
function targetFor(item: FeedItem): { screen: string; params: Record<string, unknown> } | null {
  if (!item.objectId) return null;
  switch (item.objectType) {
    case 'listing':
      return { screen: 'MarketplaceListingDetail', params: { listingId: item.objectId } };
    case 'group':
      return { screen: 'GroupChat', params: { groupId: item.objectId } };
    case 'profile':
      return { screen: 'CreatorProfile', params: { userId: item.objectId } };
    case 'note':
      return { screen: 'NoteEditor', params: { noteId: item.objectId } };
    default:
      return null;
  }
}

export const AcademicFeedPanel: React.FC<AcademicFeedPanelProps> = ({
  onNavigate,
  limit = 8,
  className = '',
}) => {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [connections, setConnections] = useState<LearningConnectionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchFeed({ limit });
      setItems(page.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your feed');
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    void load();
    // The connections line is independent — its failure must not blank the feed.
    void fetchLearningConnections()
      .then(setConnections)
      .catch(() => setConnections(null));
  }, [load]);

  const connectionLine = learningConnectionLabel(connections);

  return (
    <section
      className={`rounded-xl border border-lantern-border bg-lantern-background p-4 ${className}`}
      aria-label="Academic feed"
    >
      <header className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-lantern-text">From your network</h2>
          {connectionLine && (
            <p className="text-xs text-lantern-primary">{connectionLine}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-lantern-text-secondary hover:bg-lantern-background-secondary"
          aria-label="Refresh feed"
        >
          <ArrowPathIcon className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>

      {loading && (
        <p className="text-xs text-lantern-text-secondary" role="status">
          Loading…
        </p>
      )}

      {!loading && error && (
        <p className="text-xs text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}

      {!loading && !error && items.length === 0 && (
        <p className="text-xs text-lantern-text-secondary">
          Follow a creator or join a community and their activity shows up here.
        </p>
      )}

      <ul className="space-y-2">
        {items.map((item) => {
          const text = describeFeedItem(item);
          // A verb we have no copy for renders nothing rather than a blank card.
          if (!text) return null;
          const target = onNavigate ? targetFor(item) : null;
          const body = (
            <>
              <span className="text-xs text-lantern-text">{text}</span>
              <span className="ml-2 text-[10px] text-lantern-text-secondary">
                {relativeTime(item.createdAt)}
              </span>
            </>
          );
          return (
            <li key={item.id}>
              {target ? (
                <button
                  type="button"
                  onClick={() => onNavigate?.(target.screen, target.params)}
                  className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-lantern-background-secondary"
                >
                  {body}
                </button>
              ) : (
                <div className="px-2 py-1.5">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default AcademicFeedPanel;
