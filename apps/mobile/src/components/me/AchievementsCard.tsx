import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import {
  buildAchievementRowsFromSummaries,
  type AchievementRow,
  type BadgeSummaryLike,
} from '@lantern/shared/learning';
import { Card, T } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { useTheme } from '../../theme';
import { clampProgressPercent } from '../dashboard/progressBar';

/**
 * Achievements on Me — the phone's half of web's Achievements card.
 *
 * Home already prints points and a level; what it never printed is the LADDER:
 * which badges exist, which level the student is on, and how far the next one
 * is. That list belongs on Me, beside the rest of what is theirs.
 *
 * Every number here comes from `@lantern/shared/learning/meProgress`, which is
 * the same module web's `components/me/progressHelpers.ts` re-exports — so a
 * badge cannot read "12 / 25" on one platform and "12 / 50" on the other.
 * This file only draws the rows.
 */

/** How many rows are shown before the list asks to be expanded. */
const COLLAPSED_ROWS = 4;

interface Props {
  /** The badge summaries the stats store holds. */
  badges: readonly BadgeSummaryLike[];
  /** True while the first stats snapshot is still on its way. */
  loading?: boolean;
}

export function AchievementsCard({ badges, loading = false }: Props) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const rows = useMemo(() => buildAchievementRowsFromSummaries(badges), [badges]);
  const shown = expanded ? rows : rows.slice(0, COLLAPSED_ROWS);
  const earnedCount = rows.filter((row) => row.earned).length;

  return (
    <Card className="mb-4">
      <View className="flex-row items-center justify-between mb-1">
        <View className="flex-row items-center gap-2">
          <AppIcon name="trophy" size={20} color={colors.warning} />
          <T.Heading>Achievements</T.Heading>
        </View>
        {rows.length > 0 ? (
          <T.Caption tone="secondary">
            {earnedCount} of {rows.length}
          </T.Caption>
        ) : null}
      </View>

      {rows.length === 0 ? (
        // Two honest empty states, never one: "still loading" and "there is
        // nothing" look identical on screen but mean opposite things.
        <T.Caption tone="secondary">
          {loading ? 'Loading your badges…' : 'Badges appear once your first study activity syncs.'}
        </T.Caption>
      ) : (
        <View className="gap-3 mt-2">
          {shown.map((row) => (
            <AchievementRowView key={row.id} row={row} barTrack={colors.border} barFill={colors.primaryFill} />
          ))}
        </View>
      )}

      {rows.length > COLLAPSED_ROWS ? (
        <Pressable
          onPress={() => setExpanded((prev) => !prev)}
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Show fewer achievements' : 'Show all achievements'}
          className="mt-3 flex-row items-center gap-1 active:opacity-70"
        >
          <T.Caption style={{ color: colors.primaryText, fontWeight: '600' }}>
            {expanded ? 'Show fewer' : `Show all ${rows.length}`}
          </T.Caption>
          <AppIcon name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.primaryText} />
        </Pressable>
      ) : null}
    </Card>
  );
}

function AchievementRowView({
  row,
  barTrack,
  barFill,
}: {
  row: AchievementRow;
  barTrack: string;
  barFill: string;
}) {
  return (
    <View
      accessible
      accessibilityLabel={
        row.level > 0
          ? `${row.name}, level ${row.level} of ${row.maxLevel}, ${row.progressText}`
          : `${row.name}, not earned yet, ${row.goalOnly ? row.goalText ?? '' : row.progressText}`
      }
      className="flex-row items-center gap-3"
    >
      {/* The badge emoji is the definition's own glyph, shared with web. */}
      <T.Title accessibilityElementsHidden importantForAccessibility="no">
        {row.icon}
      </T.Title>
      <View className="flex-1 min-w-0">
        <View className="flex-row items-center justify-between gap-2">
          <T.Body className="font-semibold flex-1" numberOfLines={1}>
            {row.name}
          </T.Body>
          {row.level > 0 ? (
            <T.Label tone="secondary">Lv.{row.level}</T.Label>
          ) : null}
        </View>
        {row.goalOnly ? (
          <T.Caption tone="secondary" className="mt-0.5">
            {row.maxed ? 'Max level' : row.goalText}
          </T.Caption>
        ) : (
          <View className="mt-1">
            <T.Caption tone="secondary">{row.progressText}</T.Caption>
            <View
              className="h-1.5 rounded-full overflow-hidden mt-1"
              style={{ backgroundColor: barTrack }}
            >
              <View
                style={{
                  width: `${clampProgressPercent(row.progressPercent)}%`,
                  backgroundColor: barFill,
                }}
                className="h-1.5 rounded-full"
              />
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

export default AchievementsCard;
