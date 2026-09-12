import { describe, expect, it } from 'vitest';
import {
  confirmAdaptiveAnswer,
  currentAdaptiveItem,
  masteryPercent,
  rateAdaptiveConfidence,
  setAdaptiveDraft,
  startAdaptiveQuiz,
  type AdaptiveQuizItem,
} from '@lantern/shared';
import {
  ADAPTIVE_PROGRESS_KEY,
  decodeAdaptiveProgress,
  encodeAdaptiveProgress,
} from './AdaptiveQuiz';

function pool(count: number): AdaptiveQuizItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `q${i}`,
    stem: `Question ${i}?`,
    kind: 'multiple_choice' as const,
    options: ['A', 'B', 'C', 'D'],
    correctAnswer: 'A',
    explanation: `Because ${i}.`,
  }));
}

/** Answer the current question and rate it, as the screen does. */
function answerOne(session: ReturnType<typeof startAdaptiveQuiz>, answer: string) {
  const drafted = setAdaptiveDraft(session, answer);
  const confirmed = confirmAdaptiveAnswer(drafted);
  return rateAdaptiveConfidence(confirmed, 3);
}

describe('adaptive quiz persistence', () => {
  it('resumes at the same question with the same mastery after a reload', () => {
    const items = pool(20);
    let session = startAdaptiveQuiz(items);
    // Three questions in: two right, one wrong.
    session = answerOne(session, 'A');
    session = { ...session, phase: 'answer', cursor: session.cursor + 1, draft: '' };
    session = answerOne(session, 'A');
    session = { ...session, phase: 'answer', cursor: session.cursor + 1, draft: '' };
    session = answerOne(session, 'B');

    const stored = encodeAdaptiveProgress(session);
    // The reload: nothing survives but the row, and the pool is re-fetched.
    const resumed = decodeAdaptiveProgress(stored, pool(20));

    expect(resumed).not.toBeNull();
    expect(currentAdaptiveItem(resumed!)?.id).toBe(currentAdaptiveItem(session)?.id);
    expect(masteryPercent(resumed!)).toBe(masteryPercent(session));
    expect(resumed!.attempts).toHaveLength(3);
    expect(resumed!.phase).toBe(session.phase);
    expect(resumed!.consecutiveMisses).toBe(session.consecutiveMisses);
  });

  it('keeps requeued misses in the queue the student will actually see', () => {
    const items = pool(4);
    let session = startAdaptiveQuiz(items);
    session = setAdaptiveDraft(session, 'B');
    session = confirmAdaptiveAnswer(session);
    session = rateAdaptiveConfidence(session, 3); // wrong but confident → requeue

    const resumed = decodeAdaptiveProgress(encodeAdaptiveProgress(session), pool(4));
    expect(resumed!.queue).toEqual(session.queue);
    expect(resumed!.queue.length).toBeGreaterThan(4);
  });

  it('writes the graded answers under their own question ids too', () => {
    const session = answerOne(startAdaptiveQuiz(pool(3)), 'C');
    const stored = encodeAdaptiveProgress(session);
    expect(stored.q0).toBe('C');
    expect(stored[ADAPTIVE_PROGRESS_KEY]).toBeTruthy();
  });

  it('reserves a key that cannot collide with a question id', () => {
    const stored = encodeAdaptiveProgress(startAdaptiveQuiz(pool(2)));
    expect(Object.keys(stored).filter((key) => key.startsWith('q'))).toEqual([]);
    expect(ADAPTIVE_PROGRESS_KEY.startsWith('__')).toBe(true);
  });

  it('refuses to resume into a pool whose questions were regenerated', () => {
    const session = answerOne(startAdaptiveQuiz(pool(5)), 'A');
    const stored = encodeAdaptiveProgress(session);
    const rewritten = pool(5).map((item, i) => ({ ...item, id: `new${i}` }));
    expect(decodeAdaptiveProgress(stored, rewritten)).toBeNull();
  });

  it('refuses to resume when the pool changed size', () => {
    const stored = encodeAdaptiveProgress(answerOne(startAdaptiveQuiz(pool(5)), 'A'));
    expect(decodeAdaptiveProgress(stored, pool(4))).toBeNull();
  });

  it('starts fresh rather than resuming into a finished quiz', () => {
    const session = answerOne(startAdaptiveQuiz(pool(1)), 'A');
    const done = { ...session, phase: 'done' as const };
    expect(decodeAdaptiveProgress(encodeAdaptiveProgress(done), pool(1))).toBeNull();
  });

  it('ignores an answers map with no progress in it', () => {
    expect(decodeAdaptiveProgress({ q0: 'A' }, pool(3))).toBeNull();
    expect(decodeAdaptiveProgress(null, pool(3))).toBeNull();
    expect(decodeAdaptiveProgress(undefined, pool(3))).toBeNull();
  });

  it('ignores corrupt or foreign progress instead of throwing', () => {
    expect(decodeAdaptiveProgress({ [ADAPTIVE_PROGRESS_KEY]: 'not json' }, pool(3))).toBeNull();
    expect(decodeAdaptiveProgress({ [ADAPTIVE_PROGRESS_KEY]: '{"v":2}' }, pool(3))).toBeNull();
    expect(
      decodeAdaptiveProgress(
        { [ADAPTIVE_PROGRESS_KEY]: JSON.stringify({ v: 1, itemIds: ['q0'], queue: ['nope'], attempts: [], cursor: 0, phase: 'answer' }) },
        pool(1)
      )
    ).toBeNull();
  });

  it('rejects a cursor that points past the queue', () => {
    const session = startAdaptiveQuiz(pool(3));
    const stored = encodeAdaptiveProgress({ ...session, cursor: 99 });
    expect(decodeAdaptiveProgress(stored, pool(3))).toBeNull();
  });

  it('survives a round trip through JSON exactly as the API stores it', () => {
    const session = answerOne(startAdaptiveQuiz(pool(6)), 'A');
    const overTheWire = JSON.parse(JSON.stringify(encodeAdaptiveProgress(session)));
    const resumed = decodeAdaptiveProgress(overTheWire, pool(6));
    expect(resumed!.attempts).toEqual(session.attempts);
    expect(resumed!.cursor).toBe(session.cursor);
  });
});
