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

import { toTab } from '../../navigation/nestedTab';

/**
 * Dashboard "Exam readiness" card: one compact bar per active course, a
 * Start-here pointer for day one, tap-through to the full Mastery screen
 * (which finally gets its navigation entry point here). Renders nothing when
 * the account has no courses — the academic-profile nudge owns that pitch.
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

export function CourseReadinessCard() {
  const [courses, setCourses] = useState<CourseReadiness[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCourseReadiness()
      .then((data) => {
        if (!cancelled) setCourses(data.courses);
      })
      .catch(() => {
        if (!cancelled) setCourses([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!courses || courses.length === 0) return null;

  return (
    <Card className="mb-4">
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-sm font-semibold text-lantern-text">Exam readiness</Text>
        <Pressable
          onPress={() => openMastery()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Open your full readiness breakdown"
        >
          <Text className="text-xs font-semibold text-lantern-primary-text">View all</Text>
        </Pressable>
      </View>

      {courses.slice(0, 3).map((course) => {
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
              <Text className="flex-1 text-xs font-semibold text-lantern-text" numberOfLines={1}>
                {course.courseCode || 'Course'}
              </Text>
              {course.daysUntil != null ? (
                <Text className="text-label text-lantern-text-tertiary">
                  {examCountdownLabel(course.daysUntil)}
                </Text>
              ) : null}
              <AppIcon name="chevron-forward" size={12} color="#94a3b8" />
            </View>
            <View className="mt-1.5 h-1.5 rounded-full bg-lantern-background-secondary overflow-hidden">
              <View
                className={`h-full rounded-full ${course.readinessScore != null ? BAND_BAR[band] : 'bg-lantern-primary/50'}`}
                style={{ width: `${Math.max(pct ?? 0, pct != null ? 4 : 0)}%` }}
              />
            </View>
            <View className="mt-1 flex-row items-center justify-between" style={{ gap: 8 }}>
              <Text className="text-[11px] text-lantern-text-secondary">{statusLine}</Text>
              {course.nextTopic ? (
                <Text
                  className="flex-1 text-right text-[11px] font-medium text-lantern-primary-text"
                  numberOfLines={1}
                >
                  Start here: {course.nextTopic.title}
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </Card>
  );
}

export default CourseReadinessCard;
