/**
 * "Upcoming exam" — the nearest date a STUDY SET carries, named by the set.
 *
 * Web moved this off calendar notes for a reason worth keeping: a set knows
 * its own exam first-hand, and its title is a name the student typed, where a
 * parsed note gave them "Plan — 12 Oct" and asked them to recognise it.
 *
 * Renders nothing when no set has a date. The screen then draws the readiness
 * card in its place, which is a real answer to "am I ready" rather than a card
 * whose entire content is an apology for having no date.
 */
import React from 'react';
import { Pressable, View } from 'react-native';
import { formatDisplayDate } from '@lantern/shared/utils/displayDate';
import { Card, FeatureDisc, T } from '../ui';
import type { UpcomingExam } from './homeSections';

export interface HomeUpcomingExamProps {
  exam: UpcomingExam | null;
  onOpenSet: (studySetId: string) => void;
}

export function HomeUpcomingExam({ exam, onOpenSet }: HomeUpcomingExamProps) {
  if (!exam) return null;
  const when = formatDisplayDate(exam.examDate) || exam.examDate;
  return (
    <Card className="mb-3">
      <Pressable
        onPress={() => onOpenSet(exam.studySetId)}
        accessibilityRole="button"
        accessibilityLabel={`Upcoming exam: ${exam.title}, ${when}. Open the study set.`}
        testID="home-upcoming-exam"
        className="flex-row items-center gap-3 active:opacity-80"
      >
        <FeatureDisc feature="tests" icon="calendar" size={32} />
        <View className="flex-1 min-w-0">
          <T.Caption tone="secondary">Upcoming exam</T.Caption>
          <T.Body style={{ fontWeight: '600' }} numberOfLines={1}>
            {exam.title}
          </T.Body>
          <T.Caption tone="secondary" numberOfLines={1}>
            {when}
          </T.Caption>
        </View>
      </Pressable>
    </Card>
  );
}

export default HomeUpcomingExam;
