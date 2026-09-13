import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
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
import { Screen, useScreenBottomPadding } from '../../components/layout';
import { AppIcon } from '../../components/ui/AppIcon';
import { runReadinessAction } from '../../components/dashboard/CourseReadinessCard';
import { buildReadinessRow } from '../../components/dashboard/readinessCardModel';
import { brand } from '../../theme';

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
  // The same row the Home card is built from, so the breakdown screen and the
  // card can never name a different next action for the same course.
  const row = buildReadinessRow(course);
  const statusLine = row.statusLine;

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
          <Text className="text-label text-lantern-text-tertiary">
            {course.coveredCount}/{course.outlineTotal} topics
          </Text>
        ) : null}
      </View>
      <Pressable
        onPress={() => runReadinessAction(row.nextAction.target)}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={row.nextAction.accessibilityLabel}
        className="mt-2 self-start rounded-lg bg-lantern-feature-tests-tint px-3 py-1.5"
      >
        <Text className="text-caption font-semibold text-lantern-feature-tests-ink">
          {row.nextAction.label}
        </Text>
      </Pressable>
      {row.nextAction.reason ? (
        <Text className="mt-1 text-label text-lantern-text-tertiary">{row.nextAction.reason}</Text>
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
                  <Text className="text-label text-lantern-text-tertiary"> (outside outline)</Text>
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
          {/* The list above is a report; this is the way to change it. Without
              it a student who sees a wrong or missing topic here has nowhere
              to go — the outline editor is two screens away in Library. */}
          <Pressable
            onPress={() =>
              runReadinessAction({
                kind: 'topics',
                courseId: course.courseId,
                ...(course.courseCode ? { courseLabel: course.courseCode } : {}),
              })
            }
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`Edit the topics for ${course.courseCode || 'this course'}`}
            className="mt-2 self-start"
          >
            <Text className="text-caption font-semibold text-lantern-primary-text">Edit topics</Text>
          </Pressable>
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
  // Non-immersive route: the absolute bottom tab bar draws over the last rows
  // of "Strongest", and this scroller wires no chrome handler so the bar never
  // slides away. The old hard-coded 32 was ~70px short.
  const scrollBottomPadding = useScreenBottomPadding();
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
    <Screen bottom="none">
      <View className="flex-row items-center px-4 py-3 border-b border-lantern-border">
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={8}
          className="mr-2 -ml-1 p-1"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <AppIcon name="arrow-back" size={24} color="#64748b" />
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
          <AppIcon name="refresh" size={20} color="#64748b" />
        </Pressable>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={brand.text} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: scrollBottomPadding }}>
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
    </Screen>
  );
}

export default MasteryScreen;
