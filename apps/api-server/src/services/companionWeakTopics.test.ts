/**
 * The API's half of the weak-topic proof.
 *
 * The rule itself now lives in `@lantern/shared/study/weakTopics` and is
 * asserted there; the server's copy is gone. These cases are kept verbatim
 * (only the import moved) so the API cannot lose the coverage it had, and so
 * this suite also proves the new shared subpath resolves under the API's
 * tsconfig `paths` and jest — the failure mode that only shows in CI.
 */
import {
  WEAK_TOPIC_LIMIT,
  buildTagBreakdown,
  deriveWeakTopics,
} from '@lantern/shared/study/weakTopics';

function q(id: string, tags?: string[]) {
  return tags ? { id, questionStem: id, tags } : { id, questionStem: id };
}

describe('buildTagBreakdown', () => {
  it('tallies correct / total per tag from questions × userAnswers', () => {
    const sessions = [
      {
        questions: [q('q1', ['Anatomy']), q('q2', ['Anatomy', 'Physiology']), q('q3', ['Physiology'])],
        userAnswers: {
          q1: { isCorrect: true },
          q2: { isCorrect: false },
          q3: { isCorrect: false, timeSpentSeconds: 12 },
        },
      },
      {
        questions: [q('q4', ['Anatomy'])],
        userAnswers: { q4: { isCorrect: true } },
      },
    ];

    expect(buildTagBreakdown(sessions)).toEqual({
      Anatomy: { total: 3, correct: 2 },
      Physiology: { total: 2, correct: 0 },
    });
  });

  it('skips unanswered questions, files untagged ones under General, and reads raw user_answers rows', () => {
    const sessions = [
      {
        questions: [q('a', ['Pharm']), q('b'), q('c', [' ', ''])],
        user_answers: { b: { isCorrect: true }, c: { isCorrect: false } },
      },
    ];
    expect(buildTagBreakdown(sessions)).toEqual({ General: { total: 2, correct: 1 } });
  });

  it('contributes nothing for lean rows (questions: [] / userAnswers: {}) or null sessions', () => {
    expect(
      buildTagBreakdown([
        { questions: [], userAnswers: {} },
        { questions: [q('x', ['T'])], userAnswers: {} },
        { questions: [q('x', ['T'])] },
        null,
        undefined,
      ])
    ).toEqual({});
  });

  it('does not double count a tag repeated on one question', () => {
    expect(
      buildTagBreakdown([{ questions: [q('x', ['T', 'T'])], userAnswers: { x: { isCorrect: false } } }])
    ).toEqual({ T: { total: 1, correct: 0 } });
  });
});

describe('deriveWeakTopics', () => {
  it('keeps tags with >= 3 questions and accuracy < 60 %, weakest first, capped', () => {
    const breakdown = {
      Anatomy: { total: 3, correct: 2 }, // 66 % — not weak
      Physiology: { total: 5, correct: 2 }, // 40 %
      Pharm: { total: 2, correct: 0 }, // too few questions
      Histology: { total: 4, correct: 0 }, // 0 %
      Biochem: { total: 10, correct: 5 }, // 50 %
      Genetics: { total: 3, correct: 1 }, // 33 %
      Embryology: { total: 6, correct: 3 }, // 50 % — ties sort alphabetically
      Neuro: { total: 3, correct: 0 }, // 0 %
    };
    const weak = deriveWeakTopics(breakdown);
    expect(weak).toHaveLength(WEAK_TOPIC_LIMIT);
    expect(weak).toEqual(['Histology', 'Neuro', 'Genetics', 'Physiology', 'Biochem']);
  });

  it('treats exactly 60 % as not weak and returns [] for an empty breakdown', () => {
    expect(deriveWeakTopics({ Edge: { total: 5, correct: 3 } })).toEqual([]);
    expect(deriveWeakTopics({})).toEqual([]);
  });
});
