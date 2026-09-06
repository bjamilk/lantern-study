/**
 * Global points leaderboard (GET /api/v1/gamification/leaderboard).
 * Highlights the signed-in user's row and paginates in pages of 50.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, Text, View } from 'react-native';
import { Screen, useScreenBottomPadding } from '../../components/layout';
import { useNavigation } from '@react-navigation/native';
import { fetchLeaderboard, type LeaderboardEntry } from '../../services/gamification';
import { useAuthStore } from '../../stores/authStore';
import { Avatar, Button, Card, ScreenHeader } from '../../components/ui';
import { useTheme } from '../../theme';
import { AppIcon } from '../../components/ui/AppIcon';

const PAGE_SIZE = 50;

const MEDAL_COLORS: Record<number, string> = {
  1: '#f59e0b',
  2: '#94a3b8',
  3: '#b45309',
};

function LeaderboardRow({ entry, isSelf }: { entry: LeaderboardEntry; isSelf: boolean }) {
  const medalColor = MEDAL_COLORS[entry.rank];
  return (
    <View
      className={`flex-row items-center gap-3 px-3 py-2.5 rounded-xl mb-1.5 ${
        isSelf ? 'bg-lantern-primary-background border border-lantern-primary/40' : 'bg-lantern-surface'
      }`}
    >
      <View className="w-8 items-center">
        {medalColor ? (
          <AppIcon name="medal" size={20} color={medalColor} />
        ) : (
          <Text className="text-sm font-bold text-lantern-text-secondary">{entry.rank}</Text>
        )}
      </View>
      <Avatar name={entry.user.name || 'Student'} size={36} />
      <View className="flex-1 min-w-0">
        <Text className="text-sm font-medium text-lantern-text" numberOfLines={1}>
          {entry.user.name || 'Student'}
          {isSelf ? '  (you)' : ''}
        </Text>
      </View>
      <View className="flex-row items-center gap-1">
        <AppIcon name="star" size={13} color="#f59e0b" />
        <Text className="text-sm font-bold text-lantern-text">{entry.user.points.toLocaleString()}</Text>
      </View>
    </View>
  );
}

export function LeaderboardScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const userId = useAuthStore(s => s.user?.id);

  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPage = useCallback(async (page: number, replace: boolean) => {
    const rows = await fetchLeaderboard({ page, limit: PAGE_SIZE });
    setEntries(prev => (replace ? rows : [...prev, ...rows]));
    setHasMore(rows.length >= PAGE_SIZE);
  }, []);

  const loadInitial = useCallback(async () => {
    setError(null);
    try {
      await loadPage(1, true);
    } catch (err: any) {
      setError(err?.message || 'Could not load the leaderboard.');
    }
  }, [loadPage]);

  useEffect(() => {
    setLoading(true);
    void loadInitial().finally(() => setLoading(false));
  }, [loadInitial]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadInitial();
    setRefreshing(false);
  };

  const onEndReached = () => {
    if (loading || loadingMore || !hasMore || entries.length === 0) return;
    setLoadingMore(true);
    const nextPage = Math.floor(entries.length / PAGE_SIZE) + 1;
    void loadPage(nextPage, false)
      .catch(() => setHasMore(false))
      .finally(() => setLoadingMore(false));
  };

  const selfEntry = entries.find(e => e.user.id === userId);
  // Infinite list under an absolutely positioned bottom tab bar: 32px never
  // cleared it, so there was always a rank row buried under the bar.
  const listPadding = useScreenBottomPadding();

  return (
    <Screen edges={['top']} bottom="none">
      <ScreenHeader title="Leaderboard" subtitle="Top students by points" onBack={() => navigation.goBack()} />

      {selfEntry ? (
        <View className="px-4 mb-2">
          <Card className="flex-row items-center gap-3 py-3">
            <AppIcon name="trophy" size={18} color="#f59e0b" />
            <Text className="text-sm text-lantern-text flex-1">
              You're ranked <Text className="font-bold">#{selfEntry.rank}</Text> with{' '}
              <Text className="font-bold">{selfEntry.user.points.toLocaleString()}</Text> points
            </Text>
          </Card>
        </View>
      ) : null}

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={colors.primaryText} />
        </View>
      ) : error ? (
        <View className="flex-1 items-center justify-center px-6">
          <AppIcon name="cloud-offline" size={36} color="#94a3b8" />
          <Text className="text-sm text-lantern-text-secondary text-center mt-3 mb-4">{error}</Text>
          <Button onPress={() => void onRefresh()}>Try again</Button>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={item => item.user.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: listPadding }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.primaryText} />
          }
          onEndReached={onEndReached}
          onEndReachedThreshold={0.4}
          renderItem={({ item }) => <LeaderboardRow entry={item} isSelf={item.user.id === userId} />}
          ListEmptyComponent={
            <Card className="items-center py-10">
              <AppIcon name="trophy" size={36} color="#94a3b8" />
              <Text className="text-sm text-lantern-text-secondary text-center mt-3 px-4">
                No rankings yet. Earn points by studying to appear here.
              </Text>
            </Card>
          }
          ListFooterComponent={
            loadingMore ? (
              <View className="py-4 items-center">
                <ActivityIndicator size="small" color={colors.primaryText} />
              </View>
            ) : null
          }
        />
      )}
    </Screen>
  );
}

export default LeaderboardScreen;
