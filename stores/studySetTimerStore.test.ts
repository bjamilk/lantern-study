import { describe, expect, it, beforeEach } from 'vitest';
import {
  DEFAULT_STUDY_TIMER_KEY,
  STUDY_TIMER_DEFAULT_SECONDS,
  clearExpiredStudyTimers,
  createStudyTimer,
  formatStudyTimer,
  isStudyTimerExpired,
  isStudyTimerRunning,
  pruneStudyTimers,
  selectStudySetTimer,
  studyTimerAccessibilityLabel,
  studyTimerRemaining,
  toggleStudyTimer,
  useStudySetTimerStore,
  type StudyTimerState,
} from './studySetTimerStore';

const T0 = 1_700_000_000_000;
const MIN = 60_000;

describe('studyTimerRemaining', () => {
  it('is the full session before anything starts', () => {
    expect(studyTimerRemaining(createStudyTimer(), T0)).toBe(STUDY_TIMER_DEFAULT_SECONDS);
  });

  it('derives what is left from the wall clock, not from ticks', () => {
    const running = toggleStudyTimer(createStudyTimer(), T0);
    // No interval ever ran; ten minutes of real time still passed.
    expect(studyTimerRemaining(running, T0 + 10 * MIN)).toBe(15 * 60);
  });

  it('clamps at zero rather than going negative', () => {
    const running = toggleStudyTimer(createStudyTimer(), T0);
    expect(studyTimerRemaining(running, T0 + 90 * MIN)).toBe(0);
  });
});

describe('reload behaviour', () => {
  it('resumes a running timer where the clock says it is, not at 25:00', () => {
    const running = toggleStudyTimer(createStudyTimer(), T0);
    // Serialise exactly as the persist middleware would, then come back.
    const rehydrated = JSON.parse(JSON.stringify(running)) as StudyTimerState;
    expect(isStudyTimerRunning(rehydrated)).toBe(true);
    expect(studyTimerRemaining(rehydrated, T0 + 4 * MIN)).toBe(21 * 60);
  });

  it('shows 00:00 and time\'s up when it expired while the tab was closed', () => {
    const running = toggleStudyTimer(createStudyTimer(), T0);
    const rehydrated = JSON.parse(JSON.stringify(running)) as StudyTimerState;
    const later = T0 + 40 * MIN;
    expect(studyTimerRemaining(rehydrated, later)).toBe(0);
    expect(formatStudyTimer(studyTimerRemaining(rehydrated, later))).toBe('00:00');
    expect(isStudyTimerExpired(rehydrated, later)).toBe(true);
  });

  it('does not call a never-started timer expired', () => {
    expect(isStudyTimerExpired(createStudyTimer(), T0 + 99 * MIN)).toBe(false);
  });

  it('keeps a paused timer frozen however long the student is away', () => {
    const running = toggleStudyTimer(createStudyTimer(), T0);
    const paused = toggleStudyTimer(running, T0 + 5 * MIN);
    expect(isStudyTimerRunning(paused)).toBe(false);
    expect(studyTimerRemaining(paused, T0 + 500 * MIN)).toBe(20 * 60);
  });
});

describe('toggleStudyTimer', () => {
  it('pauses to the remaining time, then resumes from there', () => {
    const running = toggleStudyTimer(createStudyTimer(), T0);
    const paused = toggleStudyTimer(running, T0 + 5 * MIN);
    const resumed = toggleStudyTimer(paused, T0 + 60 * MIN);
    expect(studyTimerRemaining(resumed, T0 + 62 * MIN)).toBe(18 * 60);
  });

  it('starts a fresh session only once the clock has actually run out', () => {
    const running = toggleStudyTimer(createStudyTimer(), T0);
    const restarted = toggleStudyTimer(running, T0 + 30 * MIN);
    expect(studyTimerRemaining(restarted, T0 + 30 * MIN)).toBe(STUDY_TIMER_DEFAULT_SECONDS);
    expect(isStudyTimerRunning(restarted)).toBe(true);
  });
});

describe('formatStudyTimer', () => {
  it('pads and does not wrap past an hour', () => {
    expect(formatStudyTimer(25 * 60)).toBe('25:00');
    expect(formatStudyTimer(9)).toBe('00:09');
    expect(formatStudyTimer(75 * 60 + 3)).toBe('75:03');
    expect(formatStudyTimer(-5)).toBe('00:00');
  });
});

describe('studyTimerAccessibilityLabel', () => {
  it('says time is up only for a run that reached zero', () => {
    const running = toggleStudyTimer(createStudyTimer(), T0);
    expect(studyTimerAccessibilityLabel(running, T0 + 40 * MIN)).toContain("Time's up");
    expect(studyTimerAccessibilityLabel(createStudyTimer(), T0)).toContain('Start study timer');
    expect(studyTimerAccessibilityLabel(running, T0 + MIN)).toContain('Pause study timer');
  });
});

describe('pruneStudyTimers', () => {
  it('drops untouched sets so localStorage does not grow forever', () => {
    const running = toggleStudyTimer(createStudyTimer(), T0);
    const kept = pruneStudyTimers({
      opened: createStudyTimer(),
      studied: running,
      partial: { baseSeconds: 120, startedAtMs: null },
      junk: null as never,
    });
    expect(Object.keys(kept).sort()).toEqual(['partial', 'studied']);
  });
});

describe('useStudySetTimerStore', () => {
  beforeEach(() => {
    useStudySetTimerStore.setState({ timers: {} });
  });

  it('keeps one clock per set', () => {
    useStudySetTimerStore.getState().toggle('pharm');
    const pharm = selectStudySetTimer('pharm')(useStudySetTimerStore.getState());
    const anatomy = selectStudySetTimer('anatomy')(useStudySetTimerStore.getState());
    expect(isStudyTimerRunning(pharm)).toBe(true);
    expect(isStudyTimerRunning(anatomy)).toBe(false);
  });

  it('returns the same idle object every time, so selectors do not thrash', () => {
    const a = selectStudySetTimer('nope')(useStudySetTimerStore.getState());
    const b = selectStudySetTimer('nope')(useStudySetTimerStore.getState());
    expect(a).toBe(b);
  });

  it('files a timer with no set id under one shared key', () => {
    useStudySetTimerStore.getState().toggle('');
    expect(useStudySetTimerStore.getState().timers[DEFAULT_STUDY_TIMER_KEY]).toBeTruthy();
  });

  it('reset clears that set only', () => {
    useStudySetTimerStore.getState().toggle('pharm');
    useStudySetTimerStore.getState().toggle('anatomy');
    useStudySetTimerStore.getState().reset('pharm');
    const state = useStudySetTimerStore.getState();
    expect(state.timers.pharm).toBeUndefined();
    expect(isStudyTimerRunning(state.timers.anatomy)).toBe(true);
  });
});

describe('clearExpiredStudyTimers', () => {
  it('retires runs that finished before this page load, and keeps live ones', () => {
    const finished: StudyTimerState = { baseSeconds: 25 * 60, startedAtMs: T0 - 60 * MIN };
    const live: StudyTimerState = { baseSeconds: 25 * 60, startedAtMs: T0 - 5 * MIN };
    const paused: StudyTimerState = { baseSeconds: 10 * 60, startedAtMs: null };

    const kept = clearExpiredStudyTimers({ a: finished, b: live, c: paused }, T0);

    expect(kept.a).toBeUndefined();
    expect(kept.b).toEqual(live);
    expect(kept.c).toEqual(paused);
  });
});
