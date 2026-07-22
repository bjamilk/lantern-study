/**
 * Dashboard insight sections (parity with web dashboard):
 * topic strengths/weaknesses, questions to review, and per-group performance.
 * All data comes from stats already computed by buildDashboardStats.
 */
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../ui';
import type { DashboardStats } from '../../types/dashboardStats';

const MIN_TOPIC_QUESTIONS = 3;

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
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);

  if (!stats) return null;

  const rankedTopics = (stats.topicPerformance ?? [])
    .filter(t => t.totalQuestions >= MIN_TOPIC_QUESTIONS)
    .sort((a, b) => b.accuracy - a.accuracy);
  const strongest = rankedTopics.slice(0, 3);
  const weakest = rankedTopics.length > 3 ? rankedTopics.slice(-3).reverse() : [];

  const troublesome = (stats.troublesomeQuestions ?? []).slice(0, 5);
  const groupPerformance = (stats.groupPerformance ?? []).filter(g => g.testsCount > 0);

  const hasTopics = strongest.length > 0 || weakest.length > 0;
  if (!hasTopics && troublesome.length === 0 && groupPerformance.length === 0) return null;

  return (
    <>
      {hasTopics ? (
        <Card className="mb-4">
          <View className="flex-row items-center gap-2 mb-3">
            <Ionicons name="pricetag" size={16} color="#8b5cf6" />
            <Text className="text-sm font-semibold text-lantern-text">Topic insights</Text>
          </View>
          {strongest.length > 0 ? (
            <View className="mb-3">
              <Text className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-1.5">
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
              <Text className="text-[10px] font-semibold uppercase tracking-wider text-red-600 dark:text-red-400 mb-1.5">
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

      {troublesome.length > 0 ? (
        <Card className="mb-4">
          <View className="flex-row items-center gap-2 mb-3">
            <Ionicons name="warning" size={16} color="#f59e0b" />
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
                  <View className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/30 items-center justify-center">
                    <Text className="text-xs font-bold text-amber-600 dark:text-amber-400">{accuracy}%</Text>
                  </View>
                  <View className="flex-1 min-w-0">
                    <Text className="text-sm text-lantern-text" numberOfLines={2}>
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

      {groupPerformance.length > 0 ? (
        <Card className="mb-4">
          <View className="flex-row items-center gap-2 mb-3">
            <Ionicons name="people" size={16} color="#3b82f6" />
            <Text className="text-sm font-semibold text-lantern-text">Performance by group</Text>
          </View>
          <View className="gap-2">
            {groupPerformance.map(g => {
              const expanded = expandedGroupId === g.groupId;
              return (
                <View key={g.groupId} className="rounded-xl border border-lantern-border overflow-hidden">
                  <Pressable
                    onPress={() => setExpandedGroupId(expanded ? null : g.groupId)}
                    className="flex-row items-center justify-between px-3 py-2.5 active:opacity-80"
                    accessibilityRole="button"
                    accessibilityLabel={`${g.groupName} performance`}
                  >
                    <Text className="text-sm font-medium text-lantern-text flex-1 pr-2" numberOfLines={1}>
                      {g.groupName}
                    </Text>
                    <View className="flex-row items-center gap-2">
                      <Text className="text-sm font-bold text-lantern-primary">{g.averageScore.toFixed(0)}%</Text>
                      <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color="#94a3b8" />
                    </View>
                  </Pressable>
                  {expanded ? (
                    <View className="flex-row border-t border-lantern-border">
                      <View className="flex-1 items-center py-2">
                        <Text className="text-xs text-lantern-text-secondary">Tests</Text>
                        <Text className="text-sm font-bold text-lantern-text">{g.testsCount}</Text>
                      </View>
                      <View className="flex-1 items-center py-2">
                        <Text className="text-xs text-lantern-text-secondary">Accuracy</Text>
                        <Text className="text-sm font-bold text-lantern-text">{g.accuracy.toFixed(0)}%</Text>
                      </View>
                      <View className="flex-1 items-center py-2">
                        <Text className="text-xs text-lantern-text-secondary">Avg / Q</Text>
                        <Text className="text-sm font-bold text-lantern-text">
                          {g.averageTimePerQuestion > 0 ? `${g.averageTimePerQuestion.toFixed(0)}s` : '—'}
                        </Text>
                      </View>
                    </View>
                  ) : null}
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
