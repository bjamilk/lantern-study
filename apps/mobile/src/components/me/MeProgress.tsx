import React, { useEffect } from 'react';
import { View } from 'react-native';
import { Card, T } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { useTheme } from '../../theme';
import { tabularNums } from '../../design/typeScale';
import { useAuthStore } from '../../stores/authStore';
import { useGroupStore } from '../../stores/groupStore';
import { useStatsStore } from '../../stores/statsStore';
import { AchievementsCard } from './AchievementsCard';
import { GroupPerformanceCard } from './GroupPerformanceCard';
import { RecentTestsCard } from './RecentTestsCard';

/**
 * The progress hub on Me — web's Me page, on the phone.
 *
 * Web put points, achievements, group performance and test history on Me and
 * off Home. The phone had none of it on Me: points lived only on Home, the
 * badge ladder was drawn nowhere, and a sitting could not be reopened from
 * here at all. This block closes that gap; it sits ABOVE the row list, which
 * is untouched — settings, downloads, credits, dark mode and sign out are
 * still exactly where a student left them.
 *
 * It reads the stores Home already fills rather than fetching its own copy, so
 * the two screens cannot show different scores. The one fetch it will start is
 * the first snapshot, for a student who opened Me before Home.
 */
export function MeProgress() {
  const { colors } = useTheme();
  const user = useAuthStore((s) => s.user);
  const groups = useGroupStore((s) => s.groups);
  const stats = useStatsStore((s) => s.stats);
  const leanTestResults = useStatsStore((s) => s.leanTestResults);
  const statsLoading = useStatsStore((s) => s.isLoading);
  const selectedPeriod = useStatsStore((s) => s.selectedPeriod);
  const fetchStats = useStatsStore((s) => s.fetchStats);

  useEffect(() => {
    // Only when nothing has been loaded at all: Home owns the refresh cadence,
    // and a second screen re-fetching on every focus would double the cost of
    // the dashboard for no new information.
    if (!user?.id || stats || statsLoading) return;
    void fetchStats(user.id, selectedPeriod);
  }, [user?.id, stats, statsLoading, selectedPeriod, fetchStats]);

  return (
    <View className="px-4 pt-4">
      <T.Heading>Progress</T.Heading>
      <T.Caption tone="secondary" className="mt-0.5 mb-3">
        Points, achievements and your test history.
      </T.Caption>

      <Card className="mb-4">
        <View className="flex-row items-center gap-3">
          <AppIcon name="sparkles" size={22} color={colors.warning} />
          <View className="flex-1 min-w-0">
            <T.Body className="font-semibold">Points</T.Body>
            <T.Caption tone="secondary">
              {stats?.userLevel
                ? `Level ${stats.userLevel.level} · ${stats.userLevel.name}`
                : statsLoading
                  ? 'Loading your total…'
                  : 'Earned from quests, tests and study streaks'}
            </T.Caption>
          </View>
          <T.Title tabular accessibilityLabel={`${stats?.totalPoints ?? 0} points`}>
            {(stats?.totalPoints ?? 0).toLocaleString()}
          </T.Title>
        </View>
        {stats?.currentStreak ? (
          <T.Caption tone="secondary" className="mt-2" style={tabularNums}>
            {stats.currentStreak} day streak · longest {stats.longestStreak}
          </T.Caption>
        ) : null}
      </Card>

      <AchievementsCard badges={stats?.badges ?? []} loading={statsLoading} />

      <GroupPerformanceCard
        groups={groups}
        testResults={leanTestResults}
        loading={statsLoading}
      />

      <RecentTestsCard userId={user?.id} groups={groups} />
    </View>
  );
}

export default MeProgress;
