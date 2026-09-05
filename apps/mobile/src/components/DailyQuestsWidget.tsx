import React from 'react';
import { View, Text, Pressable } from 'react-native';
import type { DailyQuest } from '../services/gamification';
import { Card } from './ui';
import { AppIcon } from './ui/AppIcon';

const QUEST_LABELS: Record<string, string> = {
  review_cards: 'Review flashcards',
  answer_questions: 'Answer group questions',
  create_note: 'Create or edit a note',
  complete_test: 'Complete a practice test',
};

interface Props {
  quests: DailyQuest[];
  streak: number;
  streakFreezes?: number;
  onPurchaseFreeze?: () => void;
  purchasingFreeze?: boolean;
  className?: string;
}

export function DailyQuestsWidget({ quests, streak, streakFreezes = 0, onPurchaseFreeze, purchasingFreeze, className }: Props) {
  if (quests.length === 0) return null;
  const completedCount = quests.filter(q => q.completed).length;

  return (
    <Card className={`p-4 ${className ?? 'mb-4'}`}>
      <View className="flex-row items-center justify-between mb-3">
        <Text className="font-semibold text-lantern-text">Daily Quests</Text>
        <View className="flex-row items-center gap-1.5">
          <AppIcon name="flame" size={16} color="#f97316" />
          <Text className="text-sm font-bold text-orange-600">{streak} day streak</Text>
          {streakFreezes > 0 ? (
            <View className="flex-row items-center gap-0.5 px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30">
              <AppIcon name="snow" size={12} color="#3b82f6" />
              <Text className="text-xs font-semibold text-blue-600 dark:text-blue-400">{streakFreezes}</Text>
            </View>
          ) : onPurchaseFreeze ? (
            <Pressable
              onPress={onPurchaseFreeze}
              disabled={purchasingFreeze}
              className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 active:opacity-70"
              accessibilityRole="button"
              accessibilityLabel="Buy streak freeze for 50 coins"
            >
              <Text className="text-xs font-medium text-amber-700 dark:text-amber-400">
                {purchasingFreeze ? 'Buying…' : 'Buy freeze (50 coins)'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <Text className="text-xs text-lantern-text-secondary mb-3">
        {completedCount}/{quests.length} completed today
      </Text>
      <View className="gap-3">
        {quests.map((quest, index) => {
          const pct = Math.min(100, (quest.progress_count / quest.target_count) * 100);
          return (
            <View key={quest.id || `${quest.quest_type}-${index}`} className="flex-row items-center gap-3">
              <AppIcon
                name={quest.completed ? 'checkmark-circle' : 'ellipse'}
                size={20}
                color={quest.completed ? '#10b981' : '#94a3b8'}
              />
              <View className="flex-1">
                <View className="flex-row justify-between mb-1">
                  <Text
                    className={`text-sm ${quest.completed ? 'text-lantern-text-tertiary line-through' : 'text-lantern-text'}`}
                    numberOfLines={1}
                  >
                    {QUEST_LABELS[quest.quest_type] || quest.quest_type}
                  </Text>
                  <Text className="text-xs text-lantern-text-tertiary">
                    {quest.progress_count}/{quest.target_count}
                  </Text>
                </View>
                <View className="h-1.5 bg-lantern-background-secondary dark:bg-lantern-surface-secondary rounded-full overflow-hidden">
                  <View
                    className={`h-full rounded-full ${quest.completed ? 'bg-emerald-500' : 'bg-lantern-primary'}`}
                    style={{ width: `${pct}%` }}
                  />
                </View>
              </View>
              <Text className="text-xs text-amber-600 font-medium">+{quest.reward_xp}</Text>
            </View>
          );
        })}
      </View>
    </Card>
  );
}
