import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import {
  describeFeedItem,
  learningConnectionLabel,
  type FeedItem,
  type LearningConnectionSummary,
} from '@lantern/shared/network';
import { fetchFeed, fetchLearningConnections } from '../services/api';
import { AppIcon } from './ui/AppIcon';

/**
 * The academic feed panel on the mobile dashboard (Phase 3 · M).
 *
 * The plan asked for a feed panel on BOTH dashboards; only web got one, so
 * mobile users had no way to see network activity without navigating to the
 * dedicated Feed screen they had no reason to know existed.
 *
 * Compact by design — a handful of rows with a link through to the full screen.
 * Pull-based like web; this must never become a realtime channel.
 */
export interface AcademicFeedPanelProps {
  onOpenFeed?: () => void;
  limit?: number;
  className?: string;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const minutes = Math.floor((Date.now() - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function AcademicFeedPanel({ onOpenFeed, limit = 4, className }: AcademicFeedPanelProps) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [connections, setConnections] = useState<LearningConnectionSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const page = await fetchFeed({ limit });
      setItems(page.items);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    void load();
    // Independent of the feed — a failure here must not blank the panel.
    void fetchLearningConnections()
      .then(setConnections)
      .catch(() => setConnections(null));
  }, [load]);

  const connectionLine = learningConnectionLabel(connections);
  const rendered = items.map((i) => ({ item: i, text: describeFeedItem(i) })).filter((x) => x.text);

  // Nothing to show and nothing to say — render nothing rather than an empty box.
  if (!loading && rendered.length === 0 && !connectionLine) return null;

  return (
    <View className={className ?? 'mx-4 mb-4 rounded-2xl border border-lantern-border bg-lantern-surface p-4'}>
      <View className="flex-row items-center justify-between mb-2">
        <View className="flex-1">
          <Text className="text-sm font-semibold text-lantern-text">From your network</Text>
          {connectionLine ? (
            <Text className="text-xs text-lantern-primary">{connectionLine}</Text>
          ) : null}
        </View>
        {onOpenFeed ? (
          <Pressable
            onPress={onOpenFeed}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Open the full feed"
          >
            <AppIcon name="chevron-forward" size={18} color="#64748b" />
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <ActivityIndicator color="#6366f1" />
      ) : rendered.length === 0 ? (
        <Text className="text-xs text-lantern-text-tertiary">
          Follow a creator or join a community and their activity shows up here.
        </Text>
      ) : (
        rendered.map(({ item, text }) => (
          <View key={item.id} className="py-1.5">
            <Text className="text-xs text-lantern-text">{text}</Text>
            <Text className="text-[10px] text-lantern-text-tertiary">
              {relativeTime(item.createdAt)}
            </Text>
          </View>
        ))
      )}
    </View>
  );
}

export default AcademicFeedPanel;
