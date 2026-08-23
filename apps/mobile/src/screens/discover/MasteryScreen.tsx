import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  MASTERY_BAND_LABELS,
  examCountdownLabel,
  masteryBand,
  type ExamReadiness,
  type MasteryGraph,
  type TopicMastery,
} from '@lantern/shared/network';
import { fetchExamReadiness, fetchMasteryGraph, refreshMasteryGraph } from '../../services/api';

type NavigationProp = { goBack: () => void };

/**
 * The Mastery Graph (Phase 3 · P) — mobile parity.
 *
 * The honesty rule, identical to web: a topic with no mastery score reads as
 * "not enough data yet", never as 0 %.
 */
const BAND_TEXT: Record<string, string> = {
  unknown: 'text-lantern-text-tertiary',
  weak: 'text-red-500',
  developing: 'text-amber-500',
  strong: 'text-emerald-500',
};

const TopicRow: React.FC<{ topic: TopicMastery }> = ({ topic }) => {
  const band = masteryBand(topic.masteryScore);
  return (
    <View className="flex-row items-center justify-between py-2 border-b border-lantern-border/60">
      <View className="flex-1 pr-3">
        <Text className="text-xs font-medium text-lantern-text" numberOfLines={1}>
          {topic.topic}
        </Text>
        <Text className="text-[11px] text-lantern-text-tertiary">
          {topic.attempts > 0
            ? `${topic.correct}/${topic.attempts} correct`
            : `${topic.cardsTotal} ${topic.cardsTotal === 1 ? 'card' : 'cards'}`}
          {topic.cardsDue > 0 ? ` · ${topic.cardsDue} due` : ''}
        </Text>
      </View>
      <Text className={`text-xs font-semibold ${BAND_TEXT[band]}`}>
        {topic.masteryScore == null ? MASTERY_BAND_LABELS.unknown : `${topic.masteryScore}%`}
      </Text>
    </View>
  );
};

export function MasteryScreen({ navigation }: { navigation: NavigationProp }) {
  const [graph, setGraph] = useState<MasteryGraph | null>(null);
  const [exams, setExams] = useState<ExamReadiness[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setGraph(await fetchMasteryGraph({}));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your topics');
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
      setLoading(false);
    })();
    void fetchExamReadiness()
      .then(setExams)
      .catch(() => setExams([]));
  }, [load]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshMasteryGraph();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not refresh');
    } finally {
      setRefreshing(false);
    }
  };

  const weak = graph?.weak ?? [];
  const strong = graph?.strong ?? [];
  const hasAny = (graph?.topics?.length ?? 0) > 0;

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <View className="flex-row items-center px-4 py-3 border-b border-lantern-border">
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={8}
          className="mr-2 -ml-1 p-1"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={22} color="#64748b" />
        </Pressable>
        <Text className="flex-1 text-lg font-bold text-lantern-text">Your topics</Text>
        <Pressable
          onPress={() => void handleRefresh()}
          disabled={refreshing}
          hitSlop={8}
          className="p-1"
          style={{ opacity: refreshing ? 0.5 : 1 }}
          accessibilityRole="button"
          accessibilityLabel="Recalculate topic mastery"
        >
          <Ionicons name="refresh-outline" size={20} color="#64748b" />
        </Pressable>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#6366f1" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
          {exams.slice(0, 2).map((exam) => (
            <View
              key={exam.courseId}
              className="mb-3 flex-row rounded-xl bg-lantern-background-secondary p-3"
              style={{ gap: 8 }}
            >
              <Ionicons name="school-outline" size={18} color="#6366f1" />
              <View className="flex-1">
                <Text className="text-xs font-semibold text-lantern-text">
                  {exam.courseCode ? `${exam.courseCode} — ` : ''}
                  {examCountdownLabel(exam.daysUntil)}
                </Text>
                {exam.weakestTopics.length > 0 ? (
                  <Text className="text-[11px] text-lantern-text-tertiary">
                    Biggest gain: {exam.weakestTopics.join(', ')}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}

          {error ? <Text className="text-xs text-red-500 mb-3">{error}</Text> : null}

          {!error && !hasAny ? (
            <Text className="text-xs text-lantern-text-tertiary">
              Take a test or review some cards and your topic strengths appear here.
            </Text>
          ) : null}

          {weak.length > 0 ? (
            <View className="mb-4">
              <Text className="mb-1 text-[11px] font-semibold uppercase text-lantern-text-tertiary">
                Needs work
              </Text>
              {weak.map((topic) => (
                <TopicRow key={`w-${topic.topic}-${topic.courseId ?? 'none'}`} topic={topic} />
              ))}
            </View>
          ) : null}

          {strong.length > 0 ? (
            <View>
              <Text className="mb-1 text-[11px] font-semibold uppercase text-lantern-text-tertiary">
                Strongest
              </Text>
              {strong.slice(0, 3).map((topic) => (
                <TopicRow key={`s-${topic.topic}-${topic.courseId ?? 'none'}`} topic={topic} />
              ))}
            </View>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

export default MasteryScreen;
