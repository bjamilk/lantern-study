/**
 * "Your progress" — region 7 of Home's shared spine, and a DOOR.
 *
 * One card, one line of telemetry, one chevron. This replaces eight separate
 * looking-back regions that used to sit on Home below the doors: today's
 * goals, three stat cards, the coach, daily quests, the 16-week heatmap,
 * badges, recent tests, group performance, the due/groups pair, the daily
 * quiz and the leaderboard banner. Every one of them still exists — they are
 * on the Progress screen, which is where a student goes to LOOK BACK. Home is
 * for starting work.
 *
 * `door: true` on the shared region is the reason this is a card that opens a
 * screen rather than a wall of numbers rendered in place. Web keeps the same
 * figures in its right rail, which a phone has no room for.
 *
 * Honest when it does not know: offline with nothing cached, the figures go to
 * em-dashes and the card says so, instead of printing "0 day streak · Level 1
 * · 0 XP" at a student who has been studying for a month.
 */
import React from 'react';
import { Pressable, View } from 'react-native';
import { Card, T } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { FeatureDisc } from '../ui/FeatureDisc';
import { useTheme } from '../../theme';
import { tabularNums } from '../../design/typeScale';
import { progressSummaryLine } from './homeSections';

export interface HomeProgressCardProps {
  /** Days in a row. */
  streak: number;
  /** The level's number and name, when the stats have arrived. */
  level?: { level: number; name: string } | null;
  /** Total points. */
  points: number;
  /**
   * False when we have neither live stats nor a cached snapshot — the figures
   * are unknown, not zero.
   */
  known: boolean;
  /** True for the beat before anything has hydrated. */
  pending: boolean;
  onOpen: () => void;
}

export function HomeProgressCard({
  streak,
  level,
  points,
  known,
  pending,
  onOpen,
}: HomeProgressCardProps) {
  const { colors } = useTheme();
  const line = progressSummaryLine({ streak, level, points, known, pending });

  return (
    <View className="mb-4">
      <T.Caption tone="secondary" className="mb-2">
        Your progress
      </T.Caption>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`View progress. ${line}`}
        testID="home-progress-card"
        className="active:opacity-80"
      >
        <Card className="flex-row items-center gap-3">
          {/* A tint disc, not a saturated panel: the hue is the streak's
              identity, and the card behind it stays a flat surface like every
              other card on Home. */}
          <FeatureDisc feature="tests" icon="flame" size={40} />
          <View className="flex-1 min-w-0">
            <T.Body style={{ fontWeight: '600' }}>View progress</T.Body>
            <T.Caption
              tone="secondary"
              numberOfLines={2}
              style={known && !pending ? tabularNums : undefined}
            >
              {line}
            </T.Caption>
          </View>
          <AppIcon name="chevron-forward" size={18} color={colors.textTertiary} />
        </Card>
      </Pressable>
    </View>
  );
}

export default HomeProgressCard;
