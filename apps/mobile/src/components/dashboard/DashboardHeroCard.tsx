import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card, Button } from '../ui';
import type { UserLevel } from '../../types/dashboardStats';

interface DashboardHeroCardProps {
  userName: string;
  streak: number;
  points: number;
  dueCount: number;
  totalTests: number;
  level?: UserLevel | null;
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
  onPrimaryAction,
  primaryActionLabel,
  className,
}: DashboardHeroCardProps) {
  const subtitle =
    dueCount > 0
      ? `${dueCount} flashcard${dueCount !== 1 ? 's' : ''} due for review.`
      : totalTests > 0
        ? `You've completed ${totalTests} test${totalTests !== 1 ? 's' : ''}. What's next?`
        : 'Import material or review flashcards to get started.';

  // Plain surface: no accent rail, no tinted fill. The greeting is the first
  // thing on the dashboard and a coloured edge made it shout.
  return (
    <Card className={className ?? 'mb-4'}>
      <Text className="font-display text-xl font-semibold text-lantern-text">
        {getGreeting()}, {userName}
      </Text>
      <Text className="text-sm text-lantern-text-secondary mt-1 leading-relaxed">{subtitle}</Text>

      <View className="flex-row flex-wrap gap-2 mt-3">
        <View className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-full bg-lantern-accent-background">
          <Ionicons name="flame" size={14} color="#d97706" />
          <Text className="text-xs font-semibold text-lantern-accent">{streak}d streak</Text>
        </View>
        <View className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-full bg-lantern-primary-background">
          <Ionicons name="sparkles" size={14} color="#4f46e5" />
          <Text className="text-xs font-semibold text-lantern-primary">{points.toLocaleString()} pts</Text>
        </View>
      </View>

      <Button size="lg" onPress={onPrimaryAction} className="mt-4">
        {primaryActionLabel}
      </Button>

      {level ? (
        <View className="mt-4 pt-4 border-t border-lantern-border">
          <View className="flex-row items-center justify-between mb-2">
            <View>
              <Text className="text-xs text-lantern-text-tertiary uppercase tracking-wide">Level {level.level}</Text>
              <Text className="text-base font-bold text-lantern-primary">{level.name}</Text>
            </View>
            <Text className="text-sm font-semibold text-lantern-text-secondary">{level.currentXP} XP</Text>
          </View>
          <View className="h-2 rounded-full bg-lantern-background-secondary overflow-hidden">
            <View
              className="h-full bg-lantern-primary rounded-full"
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
