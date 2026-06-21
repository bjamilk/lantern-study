import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { StudyActivityDay } from '@lantern/shared';
import { getDailyGoalProgress } from '@lantern/shared/settings';
import type { StudySettings } from '@lantern/shared/settings';
import { useTheme } from '../theme';

interface Props {
  study: Pick<StudySettings, 'dailyCardGoal' | 'dailyTestGoal'>;
  activityDays: StudyActivityDay[];
}

export function DailyGoalsProgress({ study, activityDays }: Props) {
  const { colors, fontScale } = useTheme();
  const progress = getDailyGoalProgress(study, activityDays);

  if (progress.cardGoal <= 0 && progress.testGoal <= 0) return null;

  return (
    <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: colors.text, fontSize: 14 * fontScale }]}>
          Today&apos;s goals
        </Text>
        {progress.goalsMet && (
          <Text style={[styles.complete, { color: colors.success }]}>Complete</Text>
        )}
      </View>
      {progress.cardGoal > 0 && (
        <GoalBar
          label="Flashcards"
          done={progress.cardsDone}
          goal={progress.cardGoal}
          percent={progress.cardProgressPercent}
          fillColor={colors.primary}
          colors={colors}
          fontScale={fontScale}
        />
      )}
      {progress.testGoal > 0 && (
        <GoalBar
          label="Tests"
          done={progress.testsDone}
          goal={progress.testGoal}
          percent={progress.testProgressPercent}
          fillColor={colors.warning}
          colors={colors}
          fontScale={fontScale}
        />
      )}
    </View>
  );
}

function GoalBar({
  label,
  done,
  goal,
  percent,
  fillColor,
  colors,
  fontScale,
}: {
  label: string;
  done: number;
  goal: number;
  percent: number;
  fillColor: string;
  colors: { textSecondary: string; backgroundSecondary: string };
  fontScale: number;
}) {
  return (
    <View style={styles.goalBlock}>
      <View style={styles.goalLabels}>
        <Text style={{ color: colors.textSecondary, fontSize: 12 * fontScale }}>{label}</Text>
        <Text style={{ color: colors.textSecondary, fontSize: 12 * fontScale }}>
          {done}/{goal}
        </Text>
      </View>
      <View style={[styles.track, { backgroundColor: colors.backgroundSecondary }]}>
        <View style={[styles.fill, { width: `${percent}%`, backgroundColor: fillColor }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
    gap: 12,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontWeight: '600',
  },
  complete: {
    fontSize: 12,
    fontWeight: '600',
  },
  goalBlock: {
    gap: 6,
  },
  goalLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  track: {
    height: 8,
    borderRadius: 999,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 999,
  },
});
