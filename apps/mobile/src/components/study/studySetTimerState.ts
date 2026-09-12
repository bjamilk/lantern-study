/**
 * The study timer's state, with no React and no interval in it.
 *
 * The timer has to survive an activity switch: a student starts 25 minutes,
 * opens a quiz, comes back, and the clock must have kept running. So the state
 * is NOT a decrementing counter — a counter only advances while something is
 * ticking it, which stops the moment the component unmounts. It is a base
 * duration plus the wall-clock instant the run started, and "how long is left"
 * is derived from `Date.now()` whenever anyone asks. An unmounted screen, a
 * backgrounded app and a dropped interval all then cost nothing: the answer is
 * computed from the clock, not accumulated from ticks.
 */

export const STUDY_TIMER_DEFAULT_SECONDS = 25 * 60;

export interface StudyTimerState {
  /** Seconds left at the moment the current run started, or while paused. */
  baseSeconds: number;
  /** `Date.now()` when the current run started; null while paused. */
  startedAtMs: number | null;
}

export function createStudyTimer(seconds: number = STUDY_TIMER_DEFAULT_SECONDS): StudyTimerState {
  return { baseSeconds: Math.max(0, Math.floor(seconds)), startedAtMs: null };
}

export function isStudyTimerRunning(state: StudyTimerState): boolean {
  return state.startedAtMs !== null;
}

/** Seconds left at `nowMs`, clamped at zero — never negative, never fractional. */
export function studyTimerRemaining(state: StudyTimerState, nowMs: number): number {
  if (state.startedAtMs === null) return Math.max(0, state.baseSeconds);
  const elapsed = Math.floor(Math.max(0, nowMs - state.startedAtMs) / 1000);
  return Math.max(0, state.baseSeconds - elapsed);
}

/**
 * Start, pause, or — when the clock has run out — start a fresh 25 minutes.
 *
 * Pausing folds the elapsed time into `baseSeconds`, so the next start resumes
 * from where the student stopped rather than from the top.
 */
export function toggleStudyTimer(
  state: StudyTimerState,
  nowMs: number,
  restartSeconds: number = STUDY_TIMER_DEFAULT_SECONDS
): StudyTimerState {
  const remaining = studyTimerRemaining(state, nowMs);
  if (remaining <= 0) {
    return { baseSeconds: Math.max(0, Math.floor(restartSeconds)), startedAtMs: nowMs };
  }
  if (isStudyTimerRunning(state)) {
    return { baseSeconds: remaining, startedAtMs: null };
  }
  return { baseSeconds: remaining, startedAtMs: nowMs };
}

/** Back to a paused full session. */
export function resetStudyTimer(
  seconds: number = STUDY_TIMER_DEFAULT_SECONDS
): StudyTimerState {
  return createStudyTimer(seconds);
}

/** "25:00" — minutes can pass 59 without wrapping, so a long session reads true. */
export function formatStudyTimer(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/** What a screen reader should hear on the control. */
export function studyTimerAccessibilityLabel(state: StudyTimerState, nowMs: number): string {
  const remaining = studyTimerRemaining(state, nowMs);
  if (remaining <= 0) return 'Study timer finished. Start another 25 minutes';
  return isStudyTimerRunning(state)
    ? `Pause study timer. ${formatStudyTimer(remaining)} left`
    : `Start study timer. ${formatStudyTimer(remaining)} left`;
}
