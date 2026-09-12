/**
 * The study timer's running state, per set, at module scope.
 *
 * It lives here rather than in the set room because the clock has to outlive
 * the screen. On the device pass the timer froze the instant the student left
 * the room — start 25 minutes, open Cards, come back, and it read the value it
 * held on exit and never moved again — because the state was the room's, and
 * the room had unmounted. A store outside React survives that, and survives
 * Home, a studio, and the app being backgrounded.
 *
 * Keyed BY SET on purpose. One shared clock would mean starting a session in
 * Pharmacology and finding it already half spent when you open Anatomy, which
 * is not a timer anyone can trust.
 *
 * Nothing here counts. `studySetTimerState` derives what is left from the wall
 * clock, so a store that is never ticked is still correct; the only thing a
 * running interval buys is digits that change on screen.
 */
import { create } from 'zustand';
import {
  createStudyTimer,
  resetStudyTimer,
  toggleStudyTimer,
  type StudyTimerState,
} from '../components/study/studySetTimerState';

/**
 * The answer for a set that has never been started.
 *
 * A single frozen instance, not a fresh object per call: selectors compare by
 * reference, so `createStudyTimer()` inside a selector would return a new
 * object every render and re-render forever.
 */
export const IDLE_STUDY_TIMER: StudyTimerState = Object.freeze(createStudyTimer());

interface StudySetTimerStore {
  timers: Record<string, StudyTimerState>;
  toggle: (setId: string) => void;
  reset: (setId: string) => void;
}

export const useStudySetTimerStore = create<StudySetTimerStore>((set, get) => ({
  timers: {} as Record<string, StudyTimerState>,

  toggle: (setId) => {
    if (!setId) return;
    const current = get().timers[setId] ?? IDLE_STUDY_TIMER;
    set({ timers: { ...get().timers, [setId]: toggleStudyTimer(current, Date.now()) } });
  },

  reset: (setId) => {
    if (!setId) return;
    set({ timers: { ...get().timers, [setId]: resetStudyTimer() } });
  },
}));

/** One set's timer, or the shared idle one — always a stable reference. */
export function selectStudySetTimer(setId: string) {
  return (state: StudySetTimerStore): StudyTimerState => state.timers[setId] ?? IDLE_STUDY_TIMER;
}
