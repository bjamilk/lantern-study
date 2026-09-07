import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  examCountdownLabel,
  masteryBand,
  type CourseReadiness,
} from '@lantern/shared/network';
import { fetchCourseReadiness } from '../../services/api';
import { navigate as navigateFromRoot } from '../../navigation/navigationRef';
import { Card } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { tabularNums } from '../../design/typeScale';
import { clampProgressPercent } from './progressBar';

import { toTab } from '../../navigation/nestedTab';

/**
 * Home's "Exam readiness" card: one compact bar per active course, a
 * Start-here pointer for day one, tap-through to the full Mastery screen.
 *
 * Spec §5.7 makes this the SECOND card on Home and the screen's ONE tint
 * panel, in the tests family's sky — so the single coloured thing above the
 * fold is the answer to "am I ready", not a decoration.
 *
 * It no longer disappears when there are no courses. A card that renders
 * nothing is indistinguishable from a card that failed, and both read to a
 * student as "the app forgot my exams". The three honest states are: courses,
 * no courses yet (say what would fill it), and could-not-load (say so).
 */
const BAND_BAR: Record<string, string> = {
  unknown: 'bg-lantern-primary/50',
  weak: 'bg-red-400',
  developing: 'bg-amber-400',
  strong: 'bg-emerald-500',
};

const openMastery = (courseId?: string) =>
  navigateFromRoot('Main', {
    screen: 'MarketTab',
    params: toTab('Mastery', courseId ? { courseId } : undefined),
  });

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; courses: CourseReadiness[] }
  | { status: 'failed' };

export function CourseReadinessCard() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchCourseReadiness()
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', courses: data.courses });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Nothing is drawn for the beat before the first answer: a skeleton in the
  // screen's only tint panel is a flash of colour that means nothing.
  if (state.status === 'loading') return null;

  const courses = state.status === 'ready' ? state.courses : [];

  return (
    <Card
      variant="feature"
      feature="tests"
      icon="clipboard"
      title="Exam readiness"
      // The screen's one tint panel gets the screen's one picture. It sits
      // beside the courses rather than on the band, which costs the card no
      // extra tint — see `CardProps.illustration`.
      illustration="readiness-ring"
      className="mb-4"
    >
      {state.status === 'failed' ? (
        <Text className="text-caption text-lantern-text-secondary">
          We could not load your readiness just now. Your study still counts — pull down to
          refresh.
        </Text>
      ) : courses.length === 0 ? (
        <Text className="text-caption text-lantern-text-secondary">
          Add your courses and exam dates and this becomes a per-course readiness score.
        </Text>
      ) : (
        courses.slice(0, 3).map((course) => {
          const pct = course.readinessScore ?? course.coveragePct;
          const band = masteryBand(course.readinessScore);
          const statusLine =
            course.readinessScore != null
              ? `Readiness ${course.readinessScore}%`
              : course.coveragePct != null
                ? `${course.coveredCount} of ${course.outlineTotal} topics started`
                : 'No study data yet';
          return (
            <Pressable
              key={course.courseId}
              onPress={() => openMastery(course.courseId)}
              accessibilityRole="button"
              accessibilityLabel={`${course.courseCode || 'Course'}: ${statusLine}. Open breakdown`}
              className="py-2 border-b border-lantern-border/50 last:border-b-0"
            >
              <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
                <Text className="flex-1 text-caption font-semibold text-lantern-text" numberOfLines={1}>
                  {course.courseCode || 'Course'}
                </Text>
                {course.daysUntil != null ? (
                  <Text className="text-label text-lantern-text-tertiary" style={tabularNums}>
                    {examCountdownLabel(course.daysUntil)}
                  </Text>
                ) : null}
                <AppIcon
                  name="chevron-forward"
                  size={12}
                  color="#94a3b8"
                  importantForAccessibility="no"
                />
              </View>
              <View className="mt-1.5 h-1.5 rounded-full bg-lantern-background-secondary overflow-hidden">
                <View
                  className={`h-full rounded-full ${course.readinessScore != null ? BAND_BAR[band] : 'bg-lantern-primary/50'}`}
                  style={{
                    width: `${Math.max(clampProgressPercent(pct), pct != null ? 4 : 0)}%`,
                  }}
                />
              </View>
              <View className="mt-1 flex-row items-center justify-between" style={{ gap: 8 }}>
                <Text className="text-label text-lantern-text-secondary" style={tabularNums}>
                  {statusLine}
                </Text>
                {course.nextTopic ? (
                  <Text
                    className="flex-1 text-right text-label font-medium text-lantern-primary-text"
                    numberOfLines={1}
                  >
                    Start here: {course.nextTopic.title}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        })
      )}

      {courses.length > 0 ? (
        <Pressable
          onPress={() => openMastery()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Open your full readiness breakdown"
          className="pt-3"
        >
          <Text className="text-caption font-semibold text-lantern-primary-text">View all</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

export default CourseReadinessCard;
