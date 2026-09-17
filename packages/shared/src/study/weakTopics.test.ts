/**
 * The weak-topic rule, asserted once for both clients.
 *
 * These cases are the union of the two suites that used to guard the two
 * copies of this rule: the server's `companionWeakTopics.test.ts` (the
 * "buildTagBreakdown" / "deriveWeakTopics" blocks) and the web's
 * `apps/web/src/useCompanionContext.test.ts` weak-topic cases, restated
 * against the shared function. Neither side lost coverage in the move; both
 * sides still run their own suites through their own adapter.
 */
import {
  WEAK_TOPIC_LIMIT,
  WEAK_TOPIC_SESSION_LIMIT,
  buildTagBreakdown,
  deriveWeakTopics,
} from './weakTopics';

function q(id: string, tags?: string[]) {
  return tags ? { id, questionStem: id, tags } : { id, questionStem: id };
}

/** `correct` right answers out of `total` attempted questions, per tag. */
function session(tags: Record<string, { correct: number; total: number }>) {
  const questions: Array<{ id: string; tags?: string[] }> = [];
  const userAnswers: Record<string, { isCorrect: boolean }> = {};
  let n = 0;
  for (const [tag, stats] of Object.entries(tags)) {
    for (let i = 0; i < stats.total; i++) {
      const id = `${tag}-q${n++}`;
      questions.push(tag === 'untagged' ? { id } : { id, tags: [tag] });
      userAnswers[id] = { isCorrect: i < stats.correct };
    }
  }
  return { questions, userAnswers };
}

/** What both adapters do: tally the sessions, then apply the thresholds. */
const weakTopicsOf = (...sessions: ReturnType<typeof session>[]) =>
  deriveWeakTopics(buildTagBreakdown(sessions));

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

// The web's cases (apps/web/src/useCompanionContext.test.ts), restated against
// the shared function so the rule keeps them even though the web's copy is gone.
describe('the rule end to end (the shape both adapters feed it)', () => {
  it('counts a topic as weak below 60% and leaves the rest out', () => {
    expect(
      weakTopicsOf(
        session({
          Cardio: { correct: 1, total: 4 }, // 25% — weak
          Renal: { correct: 3, total: 4 }, // 75% — not weak
          Neuro: { correct: 3, total: 5 }, // exactly 60% — not weak
          Empty: { correct: 0, total: 0 }, // never attempted — not weak
          Thin: { correct: 0, total: 2 }, // under the 3-question floor
        })
      )
    ).toEqual(['Cardio']);
  });

  it('reports no weak topic when nothing is weak', () => {
    expect(weakTopicsOf(session({ Renal: { correct: 9, total: 10 } }))).toEqual([]);
  });

  it('reports nothing at all with no sessions', () => {
    expect(weakTopicsOf()).toEqual([]);
  });

  it('buckets untagged questions under General, like the dashboards', () => {
    expect(weakTopicsOf(session({ untagged: { correct: 0, total: 4 } }))).toEqual(['General']);
  });

  it('puts the weakest topic first', () => {
    expect(
      weakTopicsOf(
        session({
          Barely: { correct: 2, total: 4 }, // 50%
          Worst: { correct: 0, total: 4 }, // 0%
        })
      )
    ).toEqual(['Worst', 'Barely']);
  });

  it('never returns more than five weak topics, and never returns one twice', () => {
    const tags = Object.fromEntries(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((t) => [t, { correct: 0, total: 4 }])
    );
    const weak = weakTopicsOf(session(tags), session(tags));
    expect(weak).toHaveLength(WEAK_TOPIC_LIMIT);
    expect(new Set(weak).size).toBe(WEAK_TOPIC_LIMIT);
  });

  it('publishes the session window both adapters slice to', () => {
    expect(WEAK_TOPIC_SESSION_LIMIT).toBe(10);
  });
});
