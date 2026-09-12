/**
 * The set room's study timer — a 25-minute pill in the header.
 *
 * The component owns nothing but a repaint. Both halves of the state live
 * outside React: the arithmetic in `studySetTimerState` (a base duration plus
 * the instant the run started, so "how long is left" is derived from the wall
 * clock) and the value itself in `stores/studySetTimerStore` (module scope, so
 * it outlives this screen). That is what makes the clock survive walking into
 * a quiz and back: the interval below only makes the digits change, and losing
 * it costs a stale label until the next mount, never a lost minute.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable } from 'react-native';
import { T } from '../ui';
import {
  selectStudySetTimer,
  useStudySetTimerStore,
} from '../../stores/studySetTimerStore';
import {
  formatStudyTimer,
  isStudyTimerRunning,
  studyTimerAccessibilityLabel,
  studyTimerRemaining,
} from './studySetTimerState';

export function StudySetTimer({
  studySetId,
  className = '',
}: {
  studySetId: string;
  className?: string;
}) {
  const selector = useMemo(() => selectStudySetTimer(studySetId), [studySetId]);
  const timer = useStudySetTimerStore(selector);
  const toggle = useStudySetTimerStore((s) => s.toggle);
  const [now, setNow] = useState(() => Date.now());
  const running = isStudyTimerRunning(timer);

  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running, studySetId]);

  const remaining = studyTimerRemaining(timer, now);

  return (
    <Pressable
      onPress={() => toggle(studySetId)}
      accessibilityRole="button"
      accessibilityLabel={studyTimerAccessibilityLabel(timer, now)}
      className={`px-3 py-1.5 rounded-full border ${
        running ? 'border-lantern-primary bg-lantern-primary-background' : 'border-lantern-border'
      } ${className}`}
    >
      <T.Caption tabular>{formatStudyTimer(remaining)}</T.Caption>
    </Pressable>
  );
}

export default StudySetTimer;
