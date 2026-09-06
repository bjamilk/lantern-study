/**
 * AI Study Coach card (parity with web dashboard).
 * Builds performance data from computed dashboard stats and calls
 * POST /ai/study-recommendations via useAIHandlers. Hidden in low-data mode.
 */
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { buildFlashcardAccuracyByDeck, countActiveDaysInLastWeek } from '@lantern/shared/utils';
import type { AIStudyRecommendation } from '../../services/ai';
import { useAIHandlers } from '../../hooks/useAIHandlers';
import { useSettingsStore } from '../../stores/settingsStore';
import { useFlashcardStore } from '../../stores/flashcardStore';
import { Card } from '../ui';
import { useTheme } from '../../theme';
import type { DashboardStats } from '../../types/dashboardStats';
import { AppIcon } from '../ui/AppIcon';

export function AIStudyCoachCard({ stats, streak }: { stats: DashboardStats | null; streak: number }) {
  const lowDataMode = useSettingsStore(s => s.settings.appearance.lowDataMode);
  const { handleAIStudyRecommendations, aiError } = useAIHandlers();
  const { colors } = useTheme();
  const [loading, setLoading] = useState(false);
  const [coach, setCoach] = useState<AIStudyRecommendation | null>(null);
  // Deck names + SRS state for the per-deck flashcard accuracy (hooks must run
  // before the early return below).
  const decks = useFlashcardStore(s => s.decks);
  const flashcardsByDeck = useFlashcardStore(s => s.flashcards);

  const topics = stats?.topicPerformance ?? [];
  if (topics.length === 0) return null;

  if (lowDataMode) {
    return (
      <Card className="mb-4">
        <View className="flex-row items-center gap-2">
          <AppIcon name="sparkle" size={16} color={colors.primaryText} />
          <Text className="text-sm text-lantern-text-secondary flex-1">
            AI Study Coach is paused in low-data mode.
          </Text>
        </View>
      </Card>
    );
  }

  const fetchRecommendations = async () => {
    setLoading(true);
    const ranked = [...topics].sort((a, b) => b.accuracy - a.accuracy);
    const now = new Date().toISOString();
    // Flashcard accuracy = mature / reviewed cards per deck from the SRS state
    // in the flashcard store (topic = deck name). When no card has been
    // reviewed the field is OMITTED rather than filled with test accuracy.
    const flashcardAccuracy = buildFlashcardAccuracyByDeck(decks, flashcardsByDeck);
    // Days studied in the last 7 days from the dashboard-summary activity data
    // (same source as the heatmap). Only if no activity data is loaded do we
    // fall back to the streak, capped at the 7-day window.
    const activityDays = stats?.activityDays ?? [];
    const studyDaysThisWeek =
      activityDays.length > 0 ? countActiveDaysInLastWeek(activityDays) : Math.min(streak, 7);
    const result = await handleAIStudyRecommendations({
      // recentScores stays TEST-derived — that is what it claims to be.
      recentScores: ranked.map(t => ({ topic: t.tag, score: t.accuracy, date: now })),
      ...(flashcardAccuracy.length > 0 ? { flashcardAccuracy } : {}),
      studyDaysThisWeek,
    });
    if (result) setCoach(result);
    setLoading(false);
  };

  return (
    <Card className="mb-4">
      <View className="flex-row items-center justify-between mb-2">
        <View className="flex-row items-center gap-2">
          <AppIcon name="sparkle" size={16} color={colors.primaryText} />
          <Text className="text-sm font-semibold text-lantern-text">AI Study Coach</Text>
        </View>
        <Pressable
          onPress={() => void fetchRecommendations()}
          disabled={loading}
          className="px-3 py-1.5 rounded-full border border-lantern-primary/40 bg-lantern-primary-background active:opacity-80"
          accessibilityRole="button"
          accessibilityLabel={coach ? 'Refresh study recommendations' : 'Get study recommendations'}
        >
          {loading ? (
            <ActivityIndicator size="small" color={colors.primaryText} />
          ) : (
            <Text className="text-xs font-semibold text-lantern-primary-text">
              {coach ? 'Refresh' : 'Get tips'}
            </Text>
          )}
        </Pressable>
      </View>

      {coach ? (
        <View className="gap-2.5">
          <View className="p-3 rounded-xl bg-lantern-primary-background">
            <Text className="text-xs font-semibold text-lantern-primary-text mb-1">Study tip</Text>
            <Text className="text-sm text-lantern-text">{coach.studyTip}</Text>
          </View>
          {coach.weakTopics.length > 0 ? (
            <View>
              <Text className="text-xs font-semibold text-lantern-text-secondary mb-1.5">Focus areas</Text>
              <View className="flex-row flex-wrap gap-1.5">
                {coach.weakTopics.map(topic => (
                  <View key={topic} className="px-2 py-1 rounded-md bg-red-50 dark:bg-red-900/20">
                    <Text className="text-xs text-red-600 dark:text-red-400">{topic}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
          <Text className="text-xs text-lantern-text-secondary">
            Estimated study time: <Text className="font-semibold">{coach.estimatedMinutes} min</Text>
          </Text>
        </View>
      ) : (
        <Text className="text-xs text-lantern-text-secondary">
          {aiError || 'Get personalized study tips based on your recent performance.'}
        </Text>
      )}
    </Card>
  );
}

export default AIStudyCoachCard;
