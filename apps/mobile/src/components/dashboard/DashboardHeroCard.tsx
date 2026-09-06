import React from 'react';
import { View, Text } from 'react-native';
import { UNAVAILABLE_PROGRESS_COPY } from '@lantern/shared/network';
import { Card, Button } from '../ui';
import type { UserLevel } from '../../types/dashboardStats';
import { AppIcon } from '../ui/AppIcon';

interface DashboardHeroCardProps {
  userName: string;
  streak: number;
  points: number;
  dueCount: number;
  totalTests: number;
  level?: UserLevel | null;
  /**
   * False when the last refresh could not reach Lantern and there is nothing
   * real cached to fall back on. The card then drops every figure rather than
   * printing a zero it cannot stand behind — "0 pts, Level 1 Newcomer" reads
   * to a student as work that has been lost.
   */
  progressKnown?: boolean;
  /**
   * True while no snapshot has arrived yet (cold start, before the cache or
   * the server answers). Distinct from `progressKnown === false`: nothing has
   * failed, we simply have nothing to show yet, so the figures are withheld
   * without the offline copy.
   */
  progressPending?: boolean;
  /** e.g. "Last synced 2h ago" — shown when the figures are real but old. */
  progressNote?: string;
  onPrimaryAction: () => void;
  primaryActionLabel: string;
  className?: string;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function DashboardHeroCard({
  userName,
  streak,
  points,
  dueCount,
  totalTests,
  level,
  progressKnown = true,
  progressPending = false,
  progressNote,
  onPrimaryAction,
  primaryActionLabel,
  className,
}: DashboardHeroCardProps) {
  // The due count comes off cards already on the device, so it stays true even
  // with the radio off; the rest of the subtitle is a claim about server-side
  // history and is withheld when we could not fetch it.
  const subtitle =
    dueCount > 0
      ? `${dueCount} flashcard${dueCount !== 1 ? 's' : ''} due for review.`
      : !progressKnown
        ? UNAVAILABLE_PROGRESS_COPY.body
        : progressPending
          ? 'Loading your progress…'
          : totalTests > 0
          ? `You've completed ${totalTests} test${totalTests !== 1 ? 's' : ''}. What's next?`
          : 'Import material or review flashcards to get started.';

  // Figures are drawn only when they are real AND here: not offline with
  // nothing cached, and not before the first snapshot has landed.
  const showFigures = progressKnown && !progressPending;

  // Plain surface: no accent rail, no tinted fill. The greeting is the first
  // thing on the dashboard and a coloured edge made it shout.
  return (
    <Card className={className ?? 'mb-4'}>
      <Text className="font-display text-xl font-semibold text-lantern-text">
        {/* A bare greeting until the profile resolves — never a stand-in name. */}
        {userName ? `${getGreeting()}, ${userName}` : getGreeting()}
      </Text>
      <Text className="text-sm text-lantern-text-secondary mt-1 leading-relaxed">{subtitle}</Text>

      {showFigures ? (
        <View className="flex-row flex-wrap gap-2 mt-3">
          <View className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-full bg-lantern-accent-background">
            <AppIcon name="flame" size={14} color="#d97706" />
            <Text className="text-xs font-semibold text-lantern-accent">{streak}d streak</Text>
          </View>
          <View className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-full bg-lantern-primary-background">
            <AppIcon name="sparkle" size={14} color="#4f46e5" />
            <Text className="text-xs font-semibold text-lantern-primary-text">{points.toLocaleString()} pts</Text>
          </View>
          {progressNote ? (
            <View className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-full bg-lantern-background-secondary dark:bg-lantern-surface-secondary">
              <AppIcon name="cloud-offline" size={14} color="#b45309" />
              <Text className="text-xs font-semibold text-lantern-text-secondary">{progressNote}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <Button size="lg" onPress={onPrimaryAction} className="mt-4">
        {primaryActionLabel}
      </Button>

      {level && showFigures ? (
        <View className="mt-4 pt-4 border-t border-lantern-border">
          <View className="flex-row items-center justify-between mb-2">
            <View>
              <Text className="text-xs text-lantern-text-tertiary uppercase tracking-wide">Level {level.level}</Text>
              <Text className="text-base font-bold text-lantern-primary-text">{level.name}</Text>
            </View>
            <Text className="text-sm font-semibold text-lantern-text-secondary">{level.currentXP} XP</Text>
          </View>
          <View className="h-2 rounded-full bg-lantern-background-secondary overflow-hidden">
            <View
              className="h-full bg-lantern-primary-fill rounded-full"
              style={{ width: `${level.progressToNextLevel}%` }}
            />
          </View>
          <Text className="text-xs text-lantern-text-tertiary mt-1">
            {Math.round(level.progressToNextLevel)}% to next level
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

export default DashboardHeroCard;
