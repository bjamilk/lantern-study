import { describe, expect, it } from 'vitest';
import {
  ADAPTIVE_CONFIDENCE_CHOICES,
  ADAPTIVE_PAUSE_AFTER_MISSES,
  advanceAdaptiveQuiz,
  adaptiveDots,
  applyRequeue,
  buildQuestionAsk,
  canConfirmAnswer,
  canSubmitAll,
  confirmAdaptiveAnswer,
  currentAdaptiveItem,
  gradeAdaptiveAnswer,
  itemsFromUnknownQuestions,
  masteryPercent,
  rateAdaptiveConfidence,
  resumeAdaptiveQuiz,
  setAdaptiveDraft,
  shouldPause,
  shouldRequeue,
  startAdaptiveQuiz,
  type AdaptiveQuizItem,
} from './adaptiveQuiz';

const mcq = (id: string, correct = 'Bile'): AdaptiveQuizItem => ({
  id,
  stem: `What does ${id} do?`,
  kind: 'multiple_choice',
  options: ['Bile', 'Insulin', 'Pepsin'],
  correctAnswer: correct,
  explanation: `${correct} is right.`,
});

function playHit(session: ReturnType<typeof startAdaptiveQuiz>, answer: string, confidence: 1 | 2 | 3) {
  const drafted = setAdaptiveDraft(session, answer);
  const confirmed = confirmAdaptiveAnswer(drafted);
  return rateAdaptiveConfidence(confirmed, confidence);
}

describe('adaptive quiz helpers', () => {
  it('exposes a 1–3 confidence scale', () => {
    expect(ADAPTIVE_CONFIDENCE_CHOICES.map((row) => row.id)).toEqual([1, 2, 3]);
  });

  it('grades MCQ, T/F, fill-blank, and short answer', () => {
    expect(
      gradeAdaptiveAnswer(
        { id: '1', stem: 'Pick', kind: 'multiple_choice', options: ['A', 'B'], correctAnswer: 'B' },
        'B'
      )
    ).toBe(true);
    expect(
      gradeAdaptiveAnswer(
        { id: '2', stem: 'T/F', kind: 'true_false', options: ['True', 'False'], correctAnswer: 'A' },
        'True'
      )
    ).toBe(true);
    expect(
      gradeAdaptiveAnswer(
        { id: '3', stem: 'Blank', kind: 'fill_in_blank', correctAnswer: 'Km' },
        'km'
      )
    ).toBe(true);
    expect(
      gradeAdaptiveAnswer(
        { id: '4', stem: 'Short', kind: 'short_answer', correctAnswer: 'activation energy' },
        'Activation Energy'
      )
    ).toBe(true);
    expect(
      gradeAdaptiveAnswer(
        { id: '5', stem: 'Short', kind: 'short_answer', correctAnswer: 'activation energy' },
        'something else'
      )
    ).toBe(false);
  });

  it('will not confirm an empty draft', () => {
    expect(canConfirmAnswer('multiple_choice', '')).toBe(false);
    expect(canConfirmAnswer('short_answer', '   ')).toBe(false);
    expect(canConfirmAnswer('true_false', 'True')).toBe(true);
  });

  it('requeues misses and guesses, not a confident hit', () => {
    expect(shouldRequeue(false, 3)).toBe(true);
    expect(shouldRequeue(true, 1)).toBe(true);
    expect(shouldRequeue(true, 2)).toBe(false);
    expect(shouldRequeue(true, 3)).toBe(false);
  });

  it('pauses after N consecutive misses', () => {
    expect(shouldPause(2)).toBe(false);
    expect(shouldPause(ADAPTIVE_PAUSE_AFTER_MISSES)).toBe(true);
  });

  it('inserts a requeued item after the next one, not immediately', () => {
    expect(applyRequeue(['a', 'b', 'c'], 0, 'a')).toEqual(['a', 'b', 'a', 'c']);
  });

  it('has no submit-all path', () => {
    expect(canSubmitAll()).toBe(false);
  });

  it('quotes the stem so Ask cites this question', () => {
    const message = buildQuestionAsk({
      stem: 'What lowers activation energy?',
      noteTitle: 'Enzymes',
    });
    expect(message).toContain('Explain this question');
    expect(message).toContain('What lowers activation energy?');
    expect(message).toContain('in "Enzymes"');
    expect(message).toContain('"""');
  });

  it('skips matching and diagram rows when normalizing a mixed bank', () => {
    const items = itemsFromUnknownQuestions([
      { id: 'q1', type: 'multiple_choice', text: 'MCQ', options: ['A', 'B'], correctAnswer: 'B' },
      { id: 'q2', type: 'true_false', text: 'TF', correctAnswer: 'True' },
      { id: 'q3', type: 'fill_in_blank', text: 'Blank', correctAnswer: 'Vmax' },
      { id: 'q4', type: 'short_answer', text: 'Why?', correctAnswer: 'enzymes' },
      { id: 'q5', type: 'matching', text: 'Match these', correctAnswer: 'x' },
      { id: 'q6', questionType: 'OPEN_ENDED', questionStem: 'Open', acceptableAnswers: ['enzymes'] },
      { id: 'q7', questionType: 'MATCHING', questionStem: 'Pairs' },
    ]);
    expect(items.map((item) => item.id)).toEqual(['q1', 'q2', 'q3', 'q4', 'q6']);
    expect(items[1]?.options).toEqual(['True', 'False']);
  });
});

describe('adaptive quiz session', () => {
  it('requires confirm, then confidence, before feedback', () => {
    let session = startAdaptiveQuiz([mcq('one'), mcq('two')]);
    expect(session.phase).toBe('answer');
    expect(currentAdaptiveItem(session)?.id).toBe('one');

    session = confirmAdaptiveAnswer(session);
    expect(session.phase).toBe('answer');

    session = setAdaptiveDraft(session, 'Bile');
    session = confirmAdaptiveAnswer(session);
    expect(session.phase).toBe('confidence');
    expect(session.lastGrade).toBeNull();

    session = rateAdaptiveConfidence(session, 3);
    expect(session.phase).toBe('feedback');
    expect(session.lastGrade).toEqual({ correct: true, confidence: 3 });
    expect(masteryPercent(session)).toBe(50);
  });

  it('requeues a miss and does not let the student jump to done', () => {
    let session = startAdaptiveQuiz([mcq('one'), mcq('two')]);
    session = playHit(session, 'Insulin', 2);
    expect(session.lastGrade?.correct).toBe(false);
    expect(session.queue).toEqual(['one', 'two', 'one']);
    expect(advanceAdaptiveQuiz(session).phase).toBe('answer');
    expect(advanceAdaptiveQuiz(session).phase).not.toBe('done');
  });

  it('pauses after three misses and recommends coming back from notes', () => {
    let session = startAdaptiveQuiz([mcq('a'), mcq('b'), mcq('c'), mcq('d')]);
    session = playHit(session, 'Insulin', 2);
    session = advanceAdaptiveQuiz(session);
    session = playHit(session, 'Insulin', 2);
    session = advanceAdaptiveQuiz(session);
    session = playHit(session, 'Insulin', 3);
    expect(session.phase).toBe('paused');
    expect(session.consecutiveMisses).toBe(3);

    session = resumeAdaptiveQuiz(session);
    expect(session.phase).toBe('feedback');
    session = advanceAdaptiveQuiz(session);
    expect(session.phase).toBe('answer');
    expect(currentAdaptiveItem(session)?.id).toBeTruthy();
    expect(session.phase).not.toBe('done');
  });

  it('marks mastery on the bar from confident hits only', () => {
    let session = startAdaptiveQuiz([mcq('a'), mcq('b')]);
    session = playHit(session, 'Bile', 3);
    expect(masteryPercent(session)).toBe(50);
    expect(adaptiveDots(session).map((dot) => dot.state)).toEqual(['current', 'unseen']);
    session = advanceAdaptiveQuiz(session);
    expect(adaptiveDots(session).map((dot) => dot.state)).toEqual(['correct', 'current']);
    session = playHit(session, 'Insulin', 2);
    expect(masteryPercent(session)).toBe(50);
    expect(session.queue.filter((id) => id === 'b').length).toBeGreaterThan(1);
  });

  it('finishes only after every queued item has been answered', () => {
    let session = startAdaptiveQuiz([mcq('only')]);
    session = playHit(session, 'Bile', 3);
    expect(session.phase).toBe('feedback');
    session = advanceAdaptiveQuiz(session);
    expect(session.phase).toBe('done');
    expect(masteryPercent(session)).toBe(100);
  });
});
