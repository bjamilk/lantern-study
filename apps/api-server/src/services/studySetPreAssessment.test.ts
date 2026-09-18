/**
 * The pure halves of the per-unit pre-assessment: the source text handed to the
 * generator, how a generated question is mapped back onto a plan topic, and how
 * a stored session is graded into per-topic tallies.
 *
 * The thresholds themselves are `@lantern/shared`'s and are tested there; this
 * file is about the two places a wrong answer would be SILENT — an attribution
 * that guesses, and a grader that counts an unanswered question as wrong.
 */
import {
  attributeQuestionsToTopics,
  buildPreAssessmentSource,
  gradePreAssessment,
} from './studySetPreAssessment';

describe('buildPreAssessmentSource', () => {
  it('heads each block with the topic title the model must copy back', () => {
    expect(
      buildPreAssessmentSource([
        { topicId: 't1', title: 'Enzymes', content: 'Catalysts lower activation energy.' },
        { topicId: 't2', title: 'Osmosis', content: 'Water moves down its gradient.' },
      ])
    ).toBe(
      '## Enzymes\nCatalysts lower activation energy.\n\n## Osmosis\nWater moves down its gradient.'
    );
  });

  it('keeps a topic that has no material — its NAME is still askable', () => {
    expect(buildPreAssessmentSource([{ topicId: 't1', title: 'Enzymes', content: '  ' }])).toBe(
      '## Enzymes'
    );
  });

  it('drops a topic with no title, which has nothing to head a block with', () => {
    expect(buildPreAssessmentSource([{ topicId: 't1', title: '   ', content: 'body' }])).toBe('');
  });

  it('caps one topic so a single huge note cannot crowd the others out', () => {
    const built = buildPreAssessmentSource([
      { topicId: 't1', title: 'A', content: 'x'.repeat(5000) },
      { topicId: 't2', title: 'B', content: 'the second topic' },
    ]);
    expect(built).toContain('## B\nthe second topic');
    expect(built.length).toBeLessThan(2000);
  });

  it('caps the whole source at what the generator will read anyway', () => {
    const built = buildPreAssessmentSource(
      Array.from({ length: 40 }, (_, index) => ({
        topicId: `t${index}`,
        title: `Topic ${index}`,
        content: 'y'.repeat(1200),
      }))
    );
    expect(built.length).toBe(6000);
  });
});

describe('attributeQuestionsToTopics', () => {
  const topics = [
    { topicId: 't1', title: 'Enzymes and catalysis' },
    { topicId: 't2', title: 'Osmosis' },
  ];

  it('matches the model topic string exactly, ignoring case and punctuation', () => {
    expect(
      attributeQuestionsToTopics([{ topic: 'enzymes and catalysis!', text: 'q' }], topics)[0]?.topicId
    ).toBe('t1');
  });

  it('matches a shortened topic string against the fuller title', () => {
    expect(attributeQuestionsToTopics([{ topic: 'Enzymes', text: 'q' }], topics)[0]?.topicId).toBe(
      't1'
    );
  });

  it('falls back to the question text naming a topic', () => {
    expect(
      attributeQuestionsToTopics(
        [{ topic: '', text: 'Which way does water move in osmosis?' }],
        topics
      )[0]?.topicId
    ).toBe('t2');
  });

  it('attributes NOTHING rather than guessing when nothing matches', () => {
    expect(
      attributeQuestionsToTopics([{ topic: 'Mitochondria', text: 'unrelated' }], topics)[0]?.topicId
    ).toBeNull();
  });

  it('keeps every other field on the question', () => {
    const [out] = attributeQuestionsToTopics(
      [{ topic: 'Osmosis', text: 'q', type: 'true_false', correctAnswer: 'True' }],
      topics
    );
    expect(out).toMatchObject({ type: 'true_false', correctAnswer: 'True', topicId: 't2' });
  });

  it('survives a plan with no topics', () => {
    expect(attributeQuestionsToTopics([{ topic: 'Enzymes', text: 'q' }], [])[0]?.topicId).toBeNull();
  });
});

describe('gradePreAssessment', () => {
  const questions = [
    { id: 'pa-1', topicId: 't1', correctAnswer: 'Yes' },
    { id: 'pa-2', topicId: 't1', correctAnswer: 'No' },
    { id: 'pa-3', topicId: 't2', correctAnswer: 'True' },
  ];

  it('tallies a record of answers by question id', () => {
    expect(
      gradePreAssessment({
        questions,
        user_answers: { 'pa-1': { answer: 'Yes' }, 'pa-2': { answer: 'Yes' }, 'pa-3': { answer: 'true' } },
      })
    ).toEqual([
      { topicId: 't1', answered: 2, correct: 1 },
      { topicId: 't2', answered: 1, correct: 1 },
    ]);
  });

  it('reads the legacy positional array shape too', () => {
    expect(
      gradePreAssessment({ questions, user_answers: [{ answer: 'Yes' }, { answer: 'No' }, null] })
    ).toEqual([{ topicId: 't1', answered: 2, correct: 2 }]);
  });

  it('counts an unanswered question as UNANSWERED, not as wrong', () => {
    // Only pa-1 was answered. A student who ran out of time is judged on what
    // they attempted, so this reads 1/1 for t1 and says nothing about t2.
    expect(gradePreAssessment({ questions, user_answers: { 'pa-1': { answer: 'Yes' } } })).toEqual([
      { topicId: 't1', answered: 1, correct: 1 },
    ]);
  });

  it('drops a question that was never attributed to a topic', () => {
    expect(
      gradePreAssessment({
        questions: [{ id: 'pa-1', topicId: null, correctAnswer: 'Yes' }],
        user_answers: { 'pa-1': { answer: 'Yes' } },
      })
    ).toEqual([]);
  });

  it('is empty-safe on a session with nothing stored', () => {
    expect(gradePreAssessment({})).toEqual([]);
    expect(gradePreAssessment({ questions: null, user_answers: 'nonsense' })).toEqual([]);
  });

  it('accepts a bare value as the answer, not only the {answer} wrapper', () => {
    expect(
      gradePreAssessment({ questions: [questions[0]], user_answers: { 'pa-1': 'yes' } })
    ).toEqual([{ topicId: 't1', answered: 1, correct: 1 }]);
  });
});
