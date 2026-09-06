import {
  activeElapsedSeconds,
  bankedSecondsFromTimings,
  timingsFromDraftAnswers,
} from './testDuration';

describe('activeElapsedSeconds', () => {
  it('measures a fresh run from its own start', () => {
    expect(
      activeElapsedSeconds({ bankedSeconds: 0, runStartedAtMs: 1_000_000, nowMs: 1_090_000 })
    ).toBe(90);
  });

  it('does not bill a resumed run for the hours the draft sat paused', () => {
    // Session opened at 20:04 and resumed at 03:20 the next morning. The old
    // model reported 439m 6s; the run itself lasted 96 seconds.
    const originalStart = Date.parse('2026-09-04T20:04:00.000Z');
    const resumedAt = Date.parse('2026-09-05T03:21:44.000Z');
    const submittedAt = resumedAt + 96_000;

    expect(
      activeElapsedSeconds({ bankedSeconds: 40, runStartedAtMs: resumedAt, nowMs: submittedAt })
    ).toBe(136);
    // The naive measurement it replaces.
    expect(Math.round((submittedAt - originalStart) / 1000)).toBeGreaterThan(26_000);
  });

  it('keeps banked time when the clock jumps backwards', () => {
    expect(
      activeElapsedSeconds({ bankedSeconds: 30, runStartedAtMs: 5_000, nowMs: 1_000 })
    ).toBe(30);
  });

  it('treats missing or nonsense inputs as zero', () => {
    expect(
      activeElapsedSeconds({ bankedSeconds: NaN, runStartedAtMs: NaN, nowMs: NaN })
    ).toBe(0);
    expect(
      activeElapsedSeconds({ bankedSeconds: -12, runStartedAtMs: 0, nowMs: 0 })
    ).toBe(0);
  });
});

describe('bankedSecondsFromTimings', () => {
  it('sums the per-question timings', () => {
    expect(bankedSecondsFromTimings({ a: 12, b: 30, c: 0 })).toBe(42);
  });

  it('ignores nothing-shaped input', () => {
    expect(bankedSecondsFromTimings(undefined)).toBe(0);
    expect(bankedSecondsFromTimings({ a: undefined, b: -4 })).toBe(0);
  });
});

describe('timingsFromDraftAnswers', () => {
  it('recovers timings from a draft answer map, in either casing', () => {
    expect(
      timingsFromDraftAnswers({
        q1: { selectedOptionIds: ['1'], timeSpentSeconds: 14 },
        q2: { fillText: 'Accra', time_spent_seconds: 9 },
        q3: { selectedOptionIds: ['2'] },
        q4: null,
      })
    ).toEqual({ q1: 14, q2: 9 });
  });

  it('returns an empty map for a draft with no answers', () => {
    expect(timingsFromDraftAnswers({})).toEqual({});
    expect(timingsFromDraftAnswers(null)).toEqual({});
  });
});
