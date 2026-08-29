import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  MASTERY_BAND_LABELS,
  examCountdownLabel,
  masteryBand,
  type CourseClassSignal,
  type CourseReadiness,
  type MasteryGraph,
  type TopicMastery,
} from '@lantern/shared/network';
import { fetchCourseReadiness, fetchMasteryGraph, refreshMasteryGraph } from '../../services/api';

type NavigationProp = { goBack: () => void };
type RouteProp = { params?: { courseId?: string } };

/**
 * The Mastery Graph (Phase 3 · P) — mobile parity — now led by the
 * syllabus-aware course readiness rollup: every active course (exam date or
 * not), coverage of its shared outline, a Start-here pointer, and — when the
 * cohort is 20+ — what the class finds hardest. Opened with a courseId (from
 * the Dashboard card) it focuses on that course with the full topic list.
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

const BAND_BAR: Record<string, string> = {
  unknown: 'bg-lantern-primary/50',
  weak: 'bg-red-400',
  developing: 'bg-amber-400',
  strong: 'bg-emerald-500',
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

const CourseBlock: React.FC<{ course: CourseReadiness; expanded: boolean }> = ({
  course,
  expanded,
}) => {
  const pct = course.readinessScore ?? course.coveragePct;
  const band = masteryBand(course.readinessScore);
  const statusLine =
    course.readinessScore != null
      ? `Readiness ${course.readinessScore}%`
      : course.coveragePct != null
        ? `${course.coveredCount} of ${course.outlineTotal} topics started`
        : course.averageMastery != null
          ? `Average mastery ${course.averageMastery}%`
          : 'No study data yet';

  return (
    <View className="mb-3 rounded-xl border border-lantern-border/70 bg-lantern-surface p-3">
      <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
        <Text className="flex-1 text-sm font-semibold text-lantern-text" numberOfLines={1}>
          {course.courseCode || 'Course'}
          {course.courseTitle ? (
            <Text className="font-normal text-lantern-text-secondary"> — {course.courseTitle}</Text>
          ) : null}
        </Text>
        {course.daysUntil != null ? (
          <Text className="text-[11px] text-lantern-text-tertiary">
            {examCountdownLabel(course.daysUntil)}
          </Text>
        ) : null}
      </View>

      <View className="mt-2 h-2 rounded-full bg-lantern-background-secondary overflow-hidden">
        <View
          className={`h-full rounded-full ${course.readinessScore != null ? BAND_BAR[band] : 'bg-lantern-primary/50'}`}
          style={{ width: `${Math.max(pct ?? 0, pct != null ? 4 : 0)}%` }}
        />
      </View>
      <View className="mt-1.5 flex-row flex-wrap items-center justify-between" style={{ gap: 6 }}>
        <Text className="text-xs text-lantern-text-secondary">{statusLine}</Text>
        {course.coveragePct != null && course.readinessScore != null ? (
          <Text className="text-[10px] text-lantern-text-tertiary">
            {course.coveredCount}/{course.outlineTotal} topics
          </Text>
        ) : null}
      </View>
      {course.nextTopic ? (
        <Text className="mt-1.5 text-xs font-medium text-lantern-primary">
          Start here: {course.nextTopic.title}
        </Text>
      ) : null}

      {expanded && course.topics.length > 0 ? (
        <View className="mt-3 border-t border-lantern-border/60 pt-2">
          {course.topics.map((topic) => (
            <View
              key={topic.topicId ?? `tag:${topic.title}`}
              className="flex-row items-center justify-between py-1.5"
            >
              <Text className="flex-1 pr-3 text-xs text-lantern-text" numberOfLines={1}>
                {topic.title}
                {!topic.inOutline ? (
                  <Text className="text-[10px] text-lantern-text-tertiary"> (outside outline)</Text>
                ) : null}
              </Text>
              <Text className={`text-[11px] font-semibold ${BAND_TEXT[topic.band]}`}>
                {topic.masteryScore != null
                  ? `${topic.masteryScore}%`
                  : topic.covered
                    ? MASTERY_BAND_LABELS.unknown
                    : 'Not started'}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
};

export function MasteryScreen({
  navigation,
  route,
}: {
  navigation: NavigationProp;
  route?: RouteProp;
}) {
  const focusCourseId = route?.params?.courseId;
  const [graph, setGraph] = useState<MasteryGraph | null>(null);
  const [readiness, setReadiness] = useState<CourseReadiness[]>([]);
  const [classSignal, setClassSignal] = useState<CourseClassSignal | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setGraph(await fetchMasteryGraph(focusCourseId ? { courseId: focusCourseId } : {}));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your topics');
    }
    try {
      const data = await fetchCourseReadiness(focusCourseId);
      setReadiness(data.courses);
      setClassSignal(data.classSignal ?? null);
    } catch {
      // Readiness is additive — its failure must not blank the topic graph.
      setReadiness([]);
      setClassSignal(null);
    }
  }, [focusCourseId]);

  useEffect(() => {
    void (async () => {
      await load();
      setLoading(false);
    })();
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
  const hasAny = (graph?.topics?.length ?? 0) > 0 || readiness.length > 0;

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
        <Text className="flex-1 text-lg font-bold text-lantern-text">
          {focusCourseId ? 'Course readiness' : 'Exam readiness'}
        </Text>
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
          {readiness.map((course) => (
            <CourseBlock
              key={course.courseId}
              course={course}
              expanded={!!focusCourseId || readiness.length === 1}
            />
          ))}

          {focusCourseId && classSignal ? (
            <View className="mb-4 rounded-xl bg-lantern-background-secondary p-3">
              {classSignal.available && classSignal.topics && classSignal.topics.length > 0 ? (
                <Text className="text-[11px] text-lantern-text-secondary">
                  <Text className="font-semibold">Your class finds hardest: </Text>
                  {classSignal.topics.slice(0, 3).map((t) => t.topic).join(', ')}
                  <Text className="text-lantern-text-tertiary"> · {classSignal.cohortSize} students</Text>
                </Text>
              ) : (
                <Text className="text-[11px] text-lantern-text-tertiary">
                  Class insights unlock once 20+ students on this course have study data.
                </Text>
              )}
            </View>
          ) : null}

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
