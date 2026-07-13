import { resolveAttemptTimeLimitMinutes } from '../utils/resolveAttemptTimeLimitMinutes';

describe('resolveAttemptTimeLimitMinutes', () => {
  it('prefers explicit timerDurationMinutes', () => {
    expect(resolveAttemptTimeLimitMinutes({ timerDurationMinutes: 12, timerDuration: 999 })).toBe(12);
  });

  it('treats timerDuration >= 60 as seconds', () => {
    expect(resolveAttemptTimeLimitMinutes({ timerDuration: 300 })).toBe(5);
  });

  it('treats small timerDuration as minutes', () => {
    expect(resolveAttemptTimeLimitMinutes({ timerDuration: 15 })).toBe(15);
  });

  it('returns 0 when missing or invalid', () => {
    expect(resolveAttemptTimeLimitMinutes(undefined)).toBe(0);
    expect(resolveAttemptTimeLimitMinutes({})).toBe(0);
    expect(resolveAttemptTimeLimitMinutes({ timerDuration: 0 })).toBe(0);
  });
});
