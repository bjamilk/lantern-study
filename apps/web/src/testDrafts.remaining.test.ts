import { describe, expect, it, vi, afterEach } from 'vitest';
import { getSessionRemainingSeconds, sessionToDraftPayload } from '../../../services/testDrafts';
import type { TestSessionData } from '../../../types';

describe('getSessionRemainingSeconds / sessionToDraftPayload', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses remainingTime when set', () => {
    const session = {
      remainingTime: 120,
      endTime: new Date(Date.now() + 999999),
      config: {},
      questions: [],
      userAnswers: {},
      currentQuestionIndex: 0,
      startTime: new Date(),
    } as TestSessionData;

    expect(getSessionRemainingSeconds(session)).toBe(120);
  });

  it('derives remaining seconds from endTime when remainingTime is absent', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T18:00:00.000Z'));
    const session = {
      endTime: new Date('2026-07-31T18:05:00.000Z'),
      config: { timerDuration: 300 },
      questions: [],
      userAnswers: {},
      currentQuestionIndex: 0,
      startTime: new Date('2026-07-31T18:00:00.000Z'),
    } as TestSessionData;

    expect(getSessionRemainingSeconds(session)).toBe(300);
    expect(sessionToDraftPayload(session, 'test').remaining_time_seconds).toBe(300);
  });

  it('returns null when the session is untimed', () => {
    const session = {
      config: {},
      questions: [],
      userAnswers: {},
      currentQuestionIndex: 0,
      startTime: new Date(),
    } as TestSessionData;

    expect(getSessionRemainingSeconds(session)).toBeNull();
    expect(sessionToDraftPayload(session, 'study').remaining_time_seconds).toBeNull();
  });
});
