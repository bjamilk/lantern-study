import React, { useCallback, useEffect, useState } from 'react';
import {
  describeFeedItem,
  feedItemNavTarget,
  isCommunityBoard,
  learningConnectionLabel,
  remapFeedTargetForBoard,
  type FeedItem,
  type LearningConnectionSummary,
} from '@lantern/shared/network';
import { fetchFeed, fetchLearningConnections } from '../services/supabase';
import { useCommunityStore } from '../stores/communityStore';
import { useGroupStore } from '../stores/groupStore';
import { AppIcon } from './ui/AppIcon';

/**
 * Campus activity — pull-based network feed.
 *
 * Lives on Campus, not in the notification inbox. Direct-to-me events stay
 * in notifications; this is what people around you posted or listed.
 */
export interface AcademicFeedPanelProps {
  onNavigate?: (screen: string, params?: Record<string, unknown>) => void;
  limit?: number;
  className?: string;
  heading?: string;
  hideWhenEmpty?: boolean;
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

function toNavigateTarget(
  item: FeedItem,
  lookup: {
    isBoardGroup: (groupId: string) => boolean;
    communitySlugForGroup: (groupId: string) => string | null;
  },
): { screen: string; params: Record<string, unknown> } | null {
  const raw = feedItemNavTarget(item);
  if (!raw) return null;
  const target = remapFeedTargetForBoard(raw, lookup);
  if (target.screen === 'CommunityPost') {
    return {
      screen: 'CommunityPost',
      params: { slug: target.params.slug, groupId: target.params.groupId, id: target.params.id },
    };
  }
  return target;
}

export const AcademicFeedPanel: React.FC<AcademicFeedPanelProps> = ({
  onNavigate,
  limit = 8,
  className = '',
  heading = 'Happening now',
  hideWhenEmpty = false,
}) => {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [connections, setConnections] = useState<LearningConnectionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const groups = useGroupStore((s) => s.groups);
  const myCommunities = useCommunityStore((s) => s.myCommunities);
  const feedLookup = {
    isBoardGroup: (groupId: string) => {
      const group = groups.find((g) => g.id === groupId);
      return !!group && isCommunityBoard(group);
    },
    communitySlugForGroup: (groupId: string) => {
      const group = groups.find((g) => g.id === groupId);
      if (!group?.communityId) return null;
      return myCommunities.find((c) => c.id === group.communityId)?.slug ?? null;
    },
  };

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
    void fetchLearningConnections()
      .then(setConnections)
      .catch(() => setConnections(null));
  }, [load]);

  const connectionLine = learningConnectionLabel(connections);
  const visible = items
    .map((item) => ({ item, text: describeFeedItem(item) }))
    .filter((row) => row.text);

  if (hideWhenEmpty && !loading && !error && visible.length === 0 && !connectionLine) {
    return null;
  }

  return (
    <section className={className} aria-label={heading}>
      <header className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-title font-semibold text-lantern-text">{heading}</h2>
          {connectionLine ? (
            <p className="mt-1 text-caption text-lantern-text-secondary">{connectionLine}</p>
          ) : (
            <p className="mt-1 text-caption text-lantern-text-secondary">
              Posts and listings from rooms you belong to.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-lantern-text-secondary hover:bg-lantern-background-secondary"
          aria-label="Refresh feed"
        >
          <AppIcon name="refresh" size={16} aria-hidden="true" />
        </button>
      </header>

      {loading && (
        <p className="text-caption text-lantern-text-secondary" role="status">
          Loading…
        </p>
      )}

      {!loading && error && (
        <p className="text-caption text-lantern-error" role="alert">
          {error}
        </p>
      )}

      {!loading && !error && visible.length === 0 && (
        <p className="text-caption text-lantern-text-secondary">
          Follow a creator or join a community and their activity shows up here.
        </p>
      )}

      {visible.length > 0 ? (
        <ul className="space-y-3">
          {visible.map(({ item, text }) => {
            const target = onNavigate ? toNavigateTarget(item, feedLookup) : null;
            const body = (
              <>
                <span className="block text-body font-semibold text-lantern-text">{text}</span>
                <span className="mt-1 block text-caption text-lantern-text-secondary">
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
                    className="w-full rounded-2xl border border-lantern-border bg-lantern-surface p-4 text-left hover:bg-lantern-background-secondary/70"
                  >
                    {body}
                  </button>
                ) : (
                  <div className="rounded-2xl border border-lantern-border bg-lantern-surface p-4">
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
};

export default AcademicFeedPanel;
