/**
 * The web study timer's state — outside React, and outside this page load.
 *
 * `StudySetTimer` held `remaining` in `useState` and decremented it on an
 * interval. Two things followed. The clock died with the component, so opening
 * a note and coming back restarted 25:00; and a reload — the thing a browser
 * does on every deploy, every crash and every accidental ⌘R — threw away a
 * session the student had been keeping honestly for twenty minutes.
 *
 * So this mirrors the phone's `studySetTimerStore`: never a counter, always a
 * base duration plus the wall-clock instant the run started. "How much is
 * left" is derived from `Date.now()` on demand, which is what makes the state
 * safe to write to `localStorage` — a stored `startedAtMs` is still true after
 * a reload, where a stored `remaining` would silently gain back every second
 * the tab was closed.
 *
 * The honest consequence, and the reason `isStudyTimerExpired` exists: if the
 * 25 minutes ran out while the tab was shut, the student comes back to 00:00
 * and "time's up", not to a fresh session. The timer reports what the clock
 * did, not what would have been nicer.
 *
 * Keyed BY SET, like the phone's: one shared clock would mean starting a
 * session in Pharmacology and finding Anatomy already half spent.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const STUDY_TIMER_DEFAULT_SECONDS = 25 * 60;

/** The key a timer rendered without a set id lands under. */
export const DEFAULT_STUDY_TIMER_KEY = 'default';

export interface StudyTimerState {
  /** Seconds left at the moment the current run started, or while paused. */
  baseSeconds: number;
  /** `Date.now()` when the current run started; null while paused. */
  startedAtMs: number | null;
}

export function createStudyTimer(
  seconds: number = STUDY_TIMER_DEFAULT_SECONDS
): StudyTimerState {
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
 * A run that reached zero — including one that reached it while the tab was
 * closed. This is the state the button must render as "time's up" rather than
 * quietly resetting to a full session.
 */
export function isStudyTimerExpired(state: StudyTimerState, nowMs: number): boolean {
  return isStudyTimerRunning(state) && studyTimerRemaining(state, nowMs) <= 0;
}

/**
 * Start, pause, or — when the clock has run out — start a fresh 25 minutes.
 *
 * Pausing folds the elapsed time into `baseSeconds`, so the next start resumes
 * where the student stopped rather than from the top.
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
export function studyTimerAccessibilityLabel(
  state: StudyTimerState,
  nowMs: number
): string {
  const remaining = studyTimerRemaining(state, nowMs);
  if (remaining <= 0) {
    return isStudyTimerRunning(state)
      ? "Time's up. Start another 25 minutes"
      : 'Start study timer. 25 minutes';
  }
  return isStudyTimerRunning(state)
    ? `Pause study timer. ${formatStudyTimer(remaining)} left`
    : `Start study timer. ${formatStudyTimer(remaining)} left`;
}

/**
 * The answer for a set that has never been started.
 *
 * A single frozen instance, not a fresh object per call: selectors compare by
 * reference, so `createStudyTimer()` inside a selector would return a new
 * object every render and re-render forever.
 */
export const IDLE_STUDY_TIMER: StudyTimerState = Object.freeze(createStudyTimer());

/**
 * Drop timers that are paused at a full session — a student who never pressed
 * start leaves nothing worth carrying to the next page load, and without this
 * every set ever opened accumulates a row in `localStorage` forever.
 */
export function pruneStudyTimers(
  timers: Record<string, StudyTimerState>
): Record<string, StudyTimerState> {
  const kept: Record<string, StudyTimerState> = {};
  for (const [setId, timer] of Object.entries(timers || {})) {
    if (!timer || typeof timer.baseSeconds !== 'number') continue;
    const untouched =
      timer.startedAtMs === null && timer.baseSeconds >= STUDY_TIMER_DEFAULT_SECONDS;
    if (untouched) continue;
    kept[setId] = timer;
  }
  return kept;
}

/**
 * `localStorage`, or a per-process stand-in where there is none.
 *
 * Node (tests, SSR) has no `localStorage`, and a private-mode browser can have
 * one that throws on write. Persist must degrade to "this page load only"
 * rather than take the timer down with it — a study clock is not worth an
 * exception.
 */
function browserStorage(): Storage {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.getItem('lantern-study-set-timers');
      return localStorage;
    }
  } catch {
    // Blocked site data: fall through to memory.
  }
  const memory = new Map<string, string>();
  return {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
    clear: () => memory.clear(),
    key: (index: number) => Array.from(memory.keys())[index] ?? null,
    get length() {
      return memory.size;
    },
  } as Storage;
}

interface StudySetTimerStore {
  timers: Record<string, StudyTimerState>;
  toggle: (setId: string) => void;
  reset: (setId: string) => void;
}

export const useStudySetTimerStore = create<StudySetTimerStore>()(
  persist(
    (set, get) => ({
      timers: {} as Record<string, StudyTimerState>,

      toggle: (setId) => {
        const key = setId || DEFAULT_STUDY_TIMER_KEY;
        const current = get().timers[key] ?? IDLE_STUDY_TIMER;
        set({
          timers: pruneStudyTimers({
            ...get().timers,
            [key]: toggleStudyTimer(current, Date.now()),
          }),
        });
      },

      reset: (setId) => {
        const key = setId || DEFAULT_STUDY_TIMER_KEY;
        const next = { ...get().timers };
        delete next[key];
        set({ timers: next });
      },
    }),
    {
      name: 'lantern-study-set-timers',
      storage: createJSONStorage(() => browserStorage()),
      partialize: (state) => ({ timers: pruneStudyTimers(state.timers) }),
    }
  )
);

/** One set's timer, or the shared idle one — always a stable reference. */
export function selectStudySetTimer(setId: string) {
  const key = setId || DEFAULT_STUDY_TIMER_KEY;
  return (state: StudySetTimerStore): StudyTimerState =>
    state.timers[key] ?? IDLE_STUDY_TIMER;
}
