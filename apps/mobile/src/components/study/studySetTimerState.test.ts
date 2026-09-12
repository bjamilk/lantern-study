import {
  IDLE_STUDY_TIMER,
  useStudySetTimerStore,
} from '../../stores/studySetTimerStore';
import {
  STUDY_TIMER_DEFAULT_SECONDS,
  createStudyTimer,
  formatStudyTimer,
  isStudyTimerRunning,
  resetStudyTimer,
  studyTimerAccessibilityLabel,
  studyTimerRemaining,
  toggleStudyTimer,
} from './studySetTimerState';

const T0 = 1_700_000_000_000;

describe('studySetTimerState', () => {
  it('starts paused at a full session', () => {
    const state = createStudyTimer();
    expect(isStudyTimerRunning(state)).toBe(false);
    expect(studyTimerRemaining(state, T0)).toBe(STUDY_TIMER_DEFAULT_SECONDS);
    expect(formatStudyTimer(studyTimerRemaining(state, T0))).toBe('25:00');
  });

  it('counts down from the wall clock once started', () => {
    const running = toggleStudyTimer(createStudyTimer(), T0);
    expect(isStudyTimerRunning(running)).toBe(true);
    expect(studyTimerRemaining(running, T0 + 60_000)).toBe(STUDY_TIMER_DEFAULT_SECONDS - 60);
  });

  // The whole point of the wall-clock shape: no tick ran between T0 and here,
  // because the screen was unmounted, and the time still passed.
  it('keeps running across an activity switch with no ticks', () => {
    const running = toggleStudyTimer(createStudyTimer(), T0);
    expect(studyTimerRemaining(running, T0 + 10 * 60_000)).toBe(15 * 60);
  });

  it('resumes from where a pause left it, not from the top', () => {
    const running = toggleStudyTimer(createStudyTimer(), T0);
    const paused = toggleStudyTimer(running, T0 + 5 * 60_000);
    expect(isStudyTimerRunning(paused)).toBe(false);
    expect(paused.baseSeconds).toBe(20 * 60);
    // Time passes while paused and must NOT be charged to the session.
    expect(studyTimerRemaining(paused, T0 + 60 * 60_000)).toBe(20 * 60);
    const resumed = toggleStudyTimer(paused, T0 + 60 * 60_000);
    expect(studyTimerRemaining(resumed, T0 + 61 * 60_000)).toBe(19 * 60);
  });

  it('clamps at zero rather than going negative', () => {
    const running = toggleStudyTimer(createStudyTimer(), T0);
    expect(studyTimerRemaining(running, T0 + 60 * 60_000)).toBe(0);
    expect(formatStudyTimer(-30)).toBe('00:00');
  });

  it('starts a fresh session when toggled after it has run out', () => {
    const running = toggleStudyTimer(createStudyTimer(), T0);
    const finishedAt = T0 + 30 * 60_000;
    const restarted = toggleStudyTimer(running, finishedAt);
    expect(isStudyTimerRunning(restarted)).toBe(true);
    expect(studyTimerRemaining(restarted, finishedAt)).toBe(STUDY_TIMER_DEFAULT_SECONDS);
  });

  it('formats minutes past an hour without wrapping', () => {
    expect(formatStudyTimer(0)).toBe('00:00');
    expect(formatStudyTimer(9)).toBe('00:09');
    expect(formatStudyTimer(90 * 60)).toBe('90:00');
  });

  it('resets to a paused full session', () => {
    const running = toggleStudyTimer(createStudyTimer(), T0);
    const reset = resetStudyTimer();
    expect(isStudyTimerRunning(running)).toBe(true);
    expect(isStudyTimerRunning(reset)).toBe(false);
    expect(studyTimerRemaining(reset, T0 + 99_000)).toBe(STUDY_TIMER_DEFAULT_SECONDS);
  });

  it('says what the control will do', () => {
    const idle = createStudyTimer();
    expect(studyTimerAccessibilityLabel(idle, T0)).toBe('Start study timer. 25:00 left');
    const running = toggleStudyTimer(idle, T0);
    expect(studyTimerAccessibilityLabel(running, T0 + 60_000)).toBe(
      'Pause study timer. 24:00 left'
    );
    expect(studyTimerAccessibilityLabel(running, T0 + 60 * 60_000)).toBe(
      'Study timer finished. Start another 25 minutes'
    );
  });
});

// The store is the half that made the device-pass timer freeze: the state used
// to belong to the room, so leaving the room threw it away.
describe('studySetTimerStore', () => {
  beforeEach(() => {
    useStudySetTimerStore.setState({ timers: {} });
  });

  it('hands back one stable idle object for a set never started', () => {
    const read = () => useStudySetTimerStore.getState().timers['set-a'] ?? IDLE_STUDY_TIMER;
    expect(read()).toBe(read());
    expect(isStudyTimerRunning(read())).toBe(false);
  });

  it('keeps a set running with no component mounted', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(T0);
    useStudySetTimerStore.getState().toggle('set-a');
    now.mockReturnValue(T0 + 5 * 60_000);
    const timer = useStudySetTimerStore.getState().timers['set-a'];
    expect(isStudyTimerRunning(timer)).toBe(true);
    expect(studyTimerRemaining(timer, Date.now())).toBe(20 * 60);
    now.mockRestore();
  });

  it('gives every set its own clock', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(T0);
    useStudySetTimerStore.getState().toggle('set-a');
    now.mockReturnValue(T0 + 10 * 60_000);
    useStudySetTimerStore.getState().toggle('set-b');
    const at = T0 + 10 * 60_000;
    expect(studyTimerRemaining(useStudySetTimerStore.getState().timers['set-a'], at)).toBe(15 * 60);
    expect(studyTimerRemaining(useStudySetTimerStore.getState().timers['set-b'], at)).toBe(25 * 60);
    now.mockRestore();
  });

  it('resets only the set asked for', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(T0);
    useStudySetTimerStore.getState().toggle('set-a');
    useStudySetTimerStore.getState().toggle('set-b');
    useStudySetTimerStore.getState().reset('set-a');
    expect(isStudyTimerRunning(useStudySetTimerStore.getState().timers['set-a'])).toBe(false);
    expect(isStudyTimerRunning(useStudySetTimerStore.getState().timers['set-b'])).toBe(true);
    now.mockRestore();
  });
});
