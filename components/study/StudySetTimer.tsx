import React, { useEffect, useState } from 'react';
import { Button } from '../ui';
import {
  formatStudyTimer,
  isStudyTimerExpired,
  isStudyTimerRunning,
  selectStudySetTimer,
  studyTimerAccessibilityLabel,
  studyTimerRemaining,
  useStudySetTimerStore,
} from '../../stores/studySetTimerStore';

interface StudySetTimerProps {
  /** Which set's clock this is. Timers are per-set, exactly as on the phone. */
  setId?: string;
}

/**
 * The button is a VIEW of the store, not the timer itself.
 *
 * Nothing here counts down. The interval exists only so the digits change on
 * screen; every value comes from `Date.now()` against the stored start
 * instant, so a dropped tick, a backgrounded tab and a reload all cost
 * nothing.
 */
export const StudySetTimer: React.FC<StudySetTimerProps> = ({ setId = '' }) => {
  const timer = useStudySetTimerStore(selectStudySetTimer(setId));
  const toggle = useStudySetTimerStore((s) => s.toggle);
  const [now, setNow] = useState(() => Date.now());

  const running = isStudyTimerRunning(timer);
  const remaining = studyTimerRemaining(timer, now);
  const expired = isStudyTimerExpired(timer, now);

  useEffect(() => {
    if (!running || remaining <= 0) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running, remaining <= 0]);

  // A reload lands mid-second; re-read the clock once on mount so the first
  // paint is not up to a second stale.
  useEffect(() => {
    setNow(Date.now());
  }, []);

  return (
    <Button
      variant="secondary"
      onClick={() => toggle(setId)}
      aria-label={studyTimerAccessibilityLabel(timer, now)}
      title={expired ? "Time's up — start another 25 minutes" : undefined}
    >
      {formatStudyTimer(remaining)}
      {expired ? <span className="ml-1.5 text-caption">Time’s up</span> : null}
    </Button>
  );
};

export default StudySetTimer;
