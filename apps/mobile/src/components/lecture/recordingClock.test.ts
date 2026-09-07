import {
  elapsedRecordingMs,
  elapsedRecordingSeconds,
  pausedTotalAfterResume,
} from './recordingClock';

const START = 1_000_000;

describe('elapsedRecordingMs', () => {
  it('is zero before anything starts', () => {
    expect(elapsedRecordingMs({ startedAt: null, pausedTotalMs: 0, pausedAt: null })).toBe(0);
  });

  it('counts wall time while running', () => {
    expect(
      elapsedRecordingMs({ startedAt: START, pausedTotalMs: 0, pausedAt: null }, START + 60_000)
    ).toBe(60_000);
  });

  it('stops moving while paused', () => {
    const clock = { startedAt: START, pausedTotalMs: 0, pausedAt: START + 30_000 };
    expect(elapsedRecordingMs(clock, START + 30_000)).toBe(30_000);
    // Ten minutes later, still paused: the number has not moved.
    expect(elapsedRecordingMs(clock, START + 630_000)).toBe(30_000);
  });

  it('excludes every earlier pause, so a resumed lecture is not billed for the gap', () => {
    // Recorded 30 s, paused 10 minutes, resumed and recorded another 30 s.
    const clock = { startedAt: START, pausedTotalMs: 600_000, pausedAt: null };
    expect(elapsedRecordingMs(clock, START + 660_000)).toBe(60_000);
  });

  it('never goes negative on a clock that jumped backwards', () => {
    expect(
      elapsedRecordingMs({ startedAt: START, pausedTotalMs: 0, pausedAt: null }, START - 5_000)
    ).toBe(0);
  });

  it('reports whole seconds for the timer', () => {
    expect(
      elapsedRecordingSeconds({ startedAt: START, pausedTotalMs: 0, pausedAt: null }, START + 1_900)
    ).toBe(1);
  });
});

describe('pausedTotalAfterResume', () => {
  it('adds the pause that just ended', () => {
    expect(pausedTotalAfterResume(0, START, START + 5_000)).toBe(5_000);
    expect(pausedTotalAfterResume(5_000, START, START + 5_000)).toBe(10_000);
  });

  it('is unchanged when there was no pause running', () => {
    expect(pausedTotalAfterResume(5_000, null, START)).toBe(5_000);
  });
});
