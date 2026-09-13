import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import {
  describeFeedItem,
  feedItemNavTarget,
  isCommunityBoard,
  learningConnectionLabel,
  remapFeedTargetForBoard,
  type FeedItem,
  type LearningConnectionSummary,
} from '@lantern/shared/network';
import { fetchFeed, fetchLearningConnections } from '../services/api';
import { useCommunityStore } from '../stores/communityStore';
import { useGroupStore } from '../stores/groupStore';
import { AppIcon } from './ui/AppIcon';
import { useTheme } from '../theme';

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
  const minutes = Math.floor((Date.now() - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
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

export function AcademicFeedPanel({
  onNavigate,
  limit = 4,
  className,
  heading = 'Happening now',
  hideWhenEmpty = false,
}: AcademicFeedPanelProps) {
  const { colors } = useTheme();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [connections, setConnections] = useState<LearningConnectionSummary | null>(null);
  const [loading, setLoading] = useState(true);
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
    void fetchLearningConnections()
      .then(setConnections)
      .catch(() => setConnections(null));
  }, [load]);

  const connectionLine = learningConnectionLabel(connections);
  const rendered = items.map((i) => ({ item: i, text: describeFeedItem(i) })).filter((x) => x.text);

  if (hideWhenEmpty && !loading && rendered.length === 0 && !connectionLine) return null;

  return (
    <View className={className ?? 'mx-4 mb-4'}>
      <View className="flex-row items-end justify-between gap-3 mb-4">
        <View className="flex-1">
          <Text className="text-title font-semibold text-lantern-text">{heading}</Text>
          <Text className="mt-1 text-caption text-lantern-text-secondary">
            {connectionLine || 'Posts and listings from rooms you belong to.'}
          </Text>
        </View>
        <Pressable
          onPress={() => void load()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Refresh feed"
          className="min-h-[36px] min-w-[36px] items-center justify-center"
        >
          <AppIcon name="refresh" size={16} color={colors.textSecondary} />
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primaryText} />
      ) : rendered.length === 0 ? (
        <Text className="text-caption text-lantern-text-tertiary">
          Follow a creator or join a community and their activity shows up here.
        </Text>
      ) : (
        rendered.map(({ item, text }) => {
          const target = onNavigate ? toNavigateTarget(item, feedLookup) : null;
          return (
            <Pressable
              key={item.id}
              disabled={!target}
              onPress={() => target && onNavigate?.(target.screen, target.params)}
              className="mb-3 rounded-2xl border border-lantern-border bg-lantern-surface p-4"
            >
              <Text className="text-body font-semibold text-lantern-text">{text}</Text>
              <Text className="mt-1 text-caption text-lantern-text-secondary">
                {relativeTime(item.createdAt)}
              </Text>
            </Pressable>
          );
        })
      )}
    </View>
  );
}

export default AcademicFeedPanel;
