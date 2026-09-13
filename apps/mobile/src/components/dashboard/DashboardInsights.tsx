/**
 * Dashboard insight sections (parity with web dashboard):
 * topic strengths/weaknesses, questions to review, and per-group performance.
 * All data comes from stats already computed by buildDashboardStats.
 */
import React from 'react';
import { Text, View } from 'react-native';
import { Card } from '../ui';
import type { DashboardStats } from '../../types/dashboardStats';
import { AppIcon } from '../ui/AppIcon';
import { useFeatureAccent } from '../ui/FeatureDisc';
import { useTheme } from '../../theme';

const MIN_TOPIC_QUESTIONS = 3;

/** Dashboard “Questions to review” card. Review/study screens stay available. */
export const SHOW_DASHBOARD_QUESTIONS_TO_REVIEW = false;

function TopicRow({ tag, accuracy, tone }: { tag: string; accuracy: number; tone: 'strong' | 'weak' }) {
  const bg = tone === 'strong' ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-red-50 dark:bg-red-900/20';
  const valueColor = tone === 'strong' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400';
  return (
    <View className={`flex-row items-center justify-between px-3 py-2 rounded-lg ${bg}`}>
      <Text className="text-sm text-lantern-text flex-1 pr-2" numberOfLines={1}>
        {tag}
      </Text>
      <Text className={`text-sm font-bold ${valueColor}`}>{Math.round(accuracy)}%</Text>
    </View>
  );
}

export function DashboardInsights({ stats }: { stats: DashboardStats | null }) {
  const { colors } = useTheme();
  // Hooks before the early return: a card that renders nothing must still call
  // the same hooks in the same order as one that renders.
  const accent = useFeatureAccent('tests');

  if (!stats) return null;

  const rankedTopics = (stats.topicPerformance ?? [])
    .filter(t => t.totalQuestions >= MIN_TOPIC_QUESTIONS)
    .sort((a, b) => b.accuracy - a.accuracy);
  const strongest = rankedTopics.slice(0, 3);
  const weakest = rankedTopics.length > 3 ? rankedTopics.slice(-3).reverse() : [];

  const troublesome = (stats.troublesomeQuestions ?? []).slice(0, 5);
  const showQuestions = SHOW_DASHBOARD_QUESTIONS_TO_REVIEW && troublesome.length > 0;

  const hasTopics = strongest.length > 0 || weakest.length > 0;
  if (!hasTopics && !showQuestions) return null;

  return (
    <>
      {hasTopics ? (
        <Card className="mb-4">
          <View className="flex-row items-center gap-2 mb-3">
            <AppIcon name="pricetag" size={16} color="#8b5cf6" />
            <Text className="text-sm font-semibold text-lantern-text">Topic insights</Text>
          </View>
          {strongest.length > 0 ? (
            <View className="mb-3">
              <Text className="text-label font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-1.5">
                Strongest
              </Text>
              <View className="gap-1.5">
                {strongest.map(t => (
                  <TopicRow key={`strong-${t.tag}`} tag={t.tag} accuracy={t.accuracy} tone="strong" />
                ))}
              </View>
            </View>
          ) : null}
          {weakest.length > 0 ? (
            <View>
              <Text className="text-label font-semibold uppercase tracking-wider text-red-600 dark:text-red-400 mb-1.5">
                Needs work
              </Text>
              <View className="gap-1.5">
                {weakest.map(t => (
                  <TopicRow key={`weak-${t.tag}`} tag={t.tag} accuracy={t.accuracy} tone="weak" />
                ))}
              </View>
            </View>
          ) : null}
        </Card>
      ) : null}

      {showQuestions ? (
        <Card className="mb-4">
          <View className="flex-row items-center gap-2 mb-3">
            {/* The warning TOKEN, not Tailwind's `#f59e0b`: a raw palette hex
                is the same colour in both themes and answers to nothing. */}
            <AppIcon name="warning" size={16} color={colors.warning} />
            <Text className="text-sm font-semibold text-lantern-text">Questions to review</Text>
          </View>
          <View className="gap-2">
            {troublesome.map(q => {
              const accuracy =
                q.totalAttempts > 0
                  ? Math.round(((q.totalAttempts - q.incorrectAttempts) / q.totalAttempts) * 100)
                  : 0;
              return (
                <View key={q.id} className="flex-row items-start gap-3">
                  {/* The tests family's own tint, by the same registry every
                      other disc on the phone reads, so a score chip is not a
                      fourth amber nobody owns. */}
                  <View
                    className="w-10 h-10 rounded-lg items-center justify-center"
                    style={{ backgroundColor: accent.tint }}
                  >
                    <Text className="text-xs font-bold" style={{ color: accent.ink }}>
                      {accuracy}%
                    </Text>
                  </View>
                  <View className="flex-1 min-w-0">
                    <Text className="text-sm text-lantern-text" style={{ flexShrink: 1 }}>
                      {q.stem}
                    </Text>
                    <Text className="text-xs text-lantern-text-tertiary mt-0.5">
                      {q.incorrectAttempts} incorrect · {q.groupName}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        </Card>
      ) : null}

    </>
  );
}

export default DashboardInsights;
