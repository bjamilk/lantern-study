import React from 'react';
import { View } from 'react-native';
import type { LeanTestResultLike } from '@lantern/shared/utils';
import { Card, T } from '../ui';
import { GroupPerformanceChartCard } from '../dashboard/GroupPerformanceChartCard';

/**
 * Group performance on Me.
 *
 * The chart itself is the one Home already draws — same component, same shared
 * series builder, same saved selection and period — so the two screens can
 * never disagree about a score. This wrapper exists only to decide what Me
 * shows when there is nothing to plot: the chart card renders nothing without
 * results, and a hub that silently drops a card reads as a hub that failed.
 */

interface Props {
  groups: Array<{ id: string; name: string; parentId?: string | null; isArchived?: boolean }>;
  testResults: LeanTestResultLike[];
  /** True while the first results page is still loading. */
  loading?: boolean;
}

export function GroupPerformanceCard({ groups, testResults, loading = false }: Props) {
  if (testResults.length === 0) {
    return (
      <Card className="mb-4">
        <T.Heading>Group performance</T.Heading>
        <T.Caption tone="secondary" className="mt-1">
          {loading
            ? 'Loading your test history…'
            : 'Sit a test and your scores per exam are charted here.'}
        </T.Caption>
      </Card>
    );
  }

  return (
    <View>
      <GroupPerformanceChartCard groups={groups} testResults={testResults} />
    </View>
  );
}

export default GroupPerformanceCard;
