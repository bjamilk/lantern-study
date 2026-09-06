import {
  hasStoredTimerChoice,
  resolveAttemptTimeLimitMinutes,
  resolveResumeTimeLimitMinutes,
  resolveSessionTimeLimitMinutes,
} from '../utils/resolveAttemptTimeLimitMinutes';
import { resolveTestTimeLimitMinutes } from '../screens/tests/testConfigRules';

describe('resolveAttemptTimeLimitMinutes', () => {
  it('prefers explicit timerDurationMinutes', () => {
    expect(resolveAttemptTimeLimitMinutes({ timerDurationMinutes: 12, timerDuration: 999 })).toBe(12);
  });

  it('honours an explicit zero in timerDurationMinutes over a stale seconds field', () => {
    // The untimed case a build ago: the minutes field said "None" and the
    // seconds field still carried the old chip.
    expect(resolveAttemptTimeLimitMinutes({ timerDurationMinutes: 0, timerDuration: 600 })).toBe(0);
  });

  it('reads timerDurationSeconds when that is what the payload spells', () => {
    expect(resolveAttemptTimeLimitMinutes({ timerDurationSeconds: 300 })).toBe(5);
    expect(resolveAttemptTimeLimitMinutes({ timerDurationSeconds: 0 })).toBe(0);
  });

  it('treats a whole-minute timerDuration as seconds (how every writer stores it)', () => {
    expect(resolveAttemptTimeLimitMinutes({ timerDuration: 300 })).toBe(5);
    expect(resolveAttemptTimeLimitMinutes({ timerDuration: 3600 })).toBe(60);
  });

  it('treats a legacy payload that stored minutes as minutes', () => {
    expect(resolveAttemptTimeLimitMinutes({ timerDuration: 15 })).toBe(15);
    expect(resolveAttemptTimeLimitMinutes({ timerDuration: 45 })).toBe(45);
    // 90 used to come back as 2 minutes ("90 >= 60, so it must be seconds"),
    // which quietly shortened a 90-minute mock exam to a minute and a half.
    expect(resolveAttemptTimeLimitMinutes({ timerDuration: 90 })).toBe(90);
  });

  it('returns 0 when missing or invalid', () => {
    expect(resolveAttemptTimeLimitMinutes(undefined)).toBe(0);
    expect(resolveAttemptTimeLimitMinutes(null)).toBe(0);
    expect(resolveAttemptTimeLimitMinutes({})).toBe(0);
    expect(resolveAttemptTimeLimitMinutes({ timerDuration: 0 })).toBe(0);
    expect(resolveAttemptTimeLimitMinutes({ timerDuration: -600 })).toBe(0);
    expect(resolveAttemptTimeLimitMinutes({ timerDuration: Number.NaN })).toBe(0);
  });
});

describe('hasStoredTimerChoice', () => {
  it('separates "chose None" from "never recorded a timer"', () => {
    expect(hasStoredTimerChoice({ timerDuration: 0 })).toBe(true);
    expect(hasStoredTimerChoice({ timerDurationMinutes: 0 })).toBe(true);
    expect(hasStoredTimerChoice({ numberOfQuestions: 5 })).toBe(false);
    expect(hasStoredTimerChoice(undefined)).toBe(false);
  });
});

describe('resolveSessionTimeLimitMinutes (start)', () => {
  it('None means no limit, whatever the fallback says', () => {
    expect(
      resolveSessionTimeLimitMinutes({ timerDurationSeconds: 0, sessionMode: 'test', fallbackMinutes: 45 })
    ).toBe(0);
  });

  it('None on a group session with nothing to fall back to stays 0', () => {
    // The device defect: this path used to substitute
    // max(questionCount * 2, 5) minutes and start a 10:00 countdown on a
    // 5-question test the reader had asked to be untimed.
    expect(
      resolveSessionTimeLimitMinutes({ timerDurationSeconds: 0, sessionMode: 'test', fallbackMinutes: 0 })
    ).toBe(0);
  });

  it('turns an explicit 5-minute chip into 5 minutes', () => {
    expect(
      resolveSessionTimeLimitMinutes({ timerDurationSeconds: 300, sessionMode: 'test', fallbackMinutes: 45 })
    ).toBe(5);
  });

  it('study mode takes the fallback, since it never shows a timer', () => {
    expect(
      resolveSessionTimeLimitMinutes({ timerDurationSeconds: 0, sessionMode: 'study', fallbackMinutes: 45 })
    ).toBe(45);
    expect(
      resolveSessionTimeLimitMinutes({ timerDurationSeconds: 0, sessionMode: 'study', fallbackMinutes: 0 })
    ).toBe(0);
  });

  it('is the same function the tests screens import as resolveTestTimeLimitMinutes', () => {
    expect(resolveTestTimeLimitMinutes).toBe(resolveSessionTimeLimitMinutes);
  });
});

describe('resolveResumeTimeLimitMinutes', () => {
  it('keeps an untimed session untimed on resume', () => {
    expect(
      resolveResumeTimeLimitMinutes({
        mode: 'test',
        remainingSeconds: 0,
        config: { timerDurationMinutes: 0, timerDuration: 0 },
      })
    ).toBe(0);
  });

  it('refuses to put a clock back on a session whose config says None', () => {
    // Defensive: a draft that somehow carries leftover remaining time must not
    // resurrect a timer the reader turned off.
    expect(
      resolveResumeTimeLimitMinutes({
        mode: 'test',
        remainingSeconds: 600,
        config: { timerDurationMinutes: 0 },
      })
    ).toBe(0);
  });

  it('restores what was left on the clock for a timed session', () => {
    expect(
      resolveResumeTimeLimitMinutes({
        mode: 'test',
        remainingSeconds: 300,
        config: { timerDurationMinutes: 10 },
      })
    ).toBe(5);
  });

  it('falls back to the remaining time when the draft recorded no timer at all', () => {
    expect(
      resolveResumeTimeLimitMinutes({ mode: 'test', remainingSeconds: 240, config: {} })
    ).toBe(4);
  });

  it('is always untimed in study mode', () => {
    expect(
      resolveResumeTimeLimitMinutes({
        mode: 'study',
        remainingSeconds: 600,
        config: { timerDurationMinutes: 10 },
      })
    ).toBe(0);
  });

  it('treats a missing or unusable remaining time as no limit', () => {
    expect(resolveResumeTimeLimitMinutes({ mode: 'test', remainingSeconds: null })).toBe(0);
    expect(resolveResumeTimeLimitMinutes({ mode: 'test', remainingSeconds: undefined })).toBe(0);
    expect(resolveResumeTimeLimitMinutes({ mode: 'test', remainingSeconds: Number.NaN })).toBe(0);
  });
});

/**
 * The end-to-end shape of the defect, in the units each hop actually uses:
 * chip seconds -> session minutes -> stored config -> resumed minutes.
 */
describe('a "None" test end to end', () => {
  const startFromChip = (timerDurationSeconds: number) =>
    resolveSessionTimeLimitMinutes({ timerDurationSeconds, sessionMode: 'test', fallbackMinutes: 0 });

  const store = (minutes: number) => ({
    timerDurationMinutes: minutes,
    timerDuration: minutes * 60,
  });

  it('None never grows a clock at any hop', () => {
    const minutes = startFromChip(0);
    expect(minutes).toBe(0);

    const config = store(minutes);
    expect(config.timerDuration).toBe(0);
    expect(resolveAttemptTimeLimitMinutes(config)).toBe(0);
    expect(
      resolveResumeTimeLimitMinutes({ mode: 'test', remainingSeconds: 0, config })
    ).toBe(0);
  });

  it('an explicit 5 minutes is stored as 300 seconds and comes back as 5', () => {
    const minutes = startFromChip(300);
    expect(minutes).toBe(5);

    const config = store(minutes);
    expect(config.timerDuration).toBe(300);
    expect(resolveAttemptTimeLimitMinutes(config)).toBe(5);
    expect(
      resolveResumeTimeLimitMinutes({ mode: 'test', remainingSeconds: 300, config })
    ).toBe(5);
  });
});
