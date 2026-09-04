import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  describeFeedItem,
  learningConnectionLabel,
  type FeedItem,
  type LearningConnectionSummary,
} from '@lantern/shared/network';
import { fetchFeed, fetchLearningConnections } from '../../services/api';
import { Screen, useScreenBottomPadding } from '../../components/layout';

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

/**
 * The Academic Feed (Phase 3 · M) — mobile parity.
 *
 * Pull-based, exactly like web: pull-to-refresh and cursor paging, never a
 * realtime channel. Direct-to-me events stay in notifications.
 */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const minutes = Math.floor((Date.now() - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d ago` : new Date(then).toLocaleDateString();
}

function targetFor(item: FeedItem): { screen: string; params: Record<string, unknown> } | null {
  if (!item.objectId) return null;
  switch (item.objectType) {
    case 'listing':
      return { screen: 'ListingDetail', params: { listingId: item.objectId } };
    case 'profile':
      return { screen: 'CreatorProfile', params: { userId: item.objectId } };
    default:
      return null;
  }
}

export function FeedScreen({ navigation }: { navigation: NavigationProp }) {
  // `Feed` is not immersive, so the absolutely-positioned bottom tab bar draws
  // over the list; the old hard-coded 32 buried the last row and the paging
  // spinner under it.
  const listBottomPadding = useScreenBottomPadding();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [connections, setConnections] = useState<LearningConnectionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const page = await fetchFeed({ limit: 20 });
      setItems(page.items);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your feed');
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
      setLoading(false);
    })();
    // Independent of the feed — a failure here must not blank the list.
    void fetchLearningConnections()
      .then(setConnections)
      .catch(() => setConnections(null));
  }, [load]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchFeed({ limit: 20, before: cursor });
      // Guard against a duplicate id if two rows share a timestamp boundary.
      setItems((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        return [...prev, ...page.items.filter((x) => !seen.has(x.id))];
      });
      setCursor(page.nextCursor);
    } catch {
      // keep the existing page; the user can pull to refresh
    } finally {
      setLoadingMore(false);
    }
  };

  const connectionLine = learningConnectionLabel(connections);

  const renderItem = ({ item }: { item: FeedItem }) => {
    const text = describeFeedItem(item);
    // A verb with no copy renders nothing rather than a blank row.
    if (!text) return null;
    const target = targetFor(item);
    const body = (
      <View className="mx-4 mb-2 rounded-xl border border-lantern-border bg-lantern-surface px-4 py-3">
        <Text className="text-sm text-lantern-text">{text}</Text>
        <Text className="text-[11px] text-lantern-text-tertiary mt-0.5">
          {relativeTime(item.createdAt)}
        </Text>
      </View>
    );
    return target ? (
      <Pressable
        onPress={() => navigation.navigate(target.screen, target.params)}
        accessibilityRole="button"
        accessibilityLabel={text}
      >
        {body}
      </Pressable>
    ) : (
      body
    );
  };

  return (
    <Screen bottom="none">
      <View className="flex-row items-center px-4 py-3 border-b border-lantern-border">
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={8}
          className="mr-2 -ml-1 p-1"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color="#64748b" />
        </Pressable>
        <View className="flex-1">
          <Text className="text-lg font-bold text-lantern-text">From your network</Text>
          {connectionLine ? (
            <Text className="text-xs text-lantern-primary">{connectionLine}</Text>
          ) : null}
        </View>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#6366f1" />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: listBottomPadding }}
          onEndReachedThreshold={0.4}
          onEndReached={() => void loadMore()}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load().finally(() => setRefreshing(false));
              }}
              tintColor="#6366f1"
            />
          }
          ListEmptyComponent={
            <Text className="mx-4 text-xs text-lantern-text-tertiary">
              {error ?? 'Follow a creator or join a community and their activity shows up here.'}
            </Text>
          }
          ListFooterComponent={
            loadingMore ? <ActivityIndicator className="my-4" color="#6366f1" /> : null
          }
        />
      )}
    </Screen>
  );
}

export default FeedScreen;
