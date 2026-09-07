import {
  REVIEW_OUTCOMES,
  classifyReviewOutcome,
  describeTally,
  isAnswerProvided,
  isPracticeAttempt,
  questionSourceTarget,
  resolveQuestionSource,
  tallyAttempt,
} from './confidenceReveal';

describe('isPracticeAttempt', () => {
  it('is practice when there is no time limit', () => {
    expect(isPracticeAttempt({ mode: 'test', timeLimitMinutes: 0 })).toBe(true);
    expect(isPracticeAttempt({ mode: 'study', timeLimitMinutes: 0 })).toBe(true);
    expect(isPracticeAttempt({ mode: 'practice' })).toBe(true);
    expect(isPracticeAttempt({ mode: null, timeLimitMinutes: null })).toBe(true);
  });

  it('leaves a TIMED attempt plain — the founder decision', () => {
    expect(isPracticeAttempt({ mode: 'test', timeLimitMinutes: 30 })).toBe(false);
    expect(isPracticeAttempt({ mode: 'study', timeLimitMinutes: 1 })).toBe(false);
  });

  it('leaves an exam mode plain even with no limit on the clock', () => {
    expect(isPracticeAttempt({ mode: 'exam', timeLimitMinutes: 0 })).toBe(false);
    expect(isPracticeAttempt({ mode: 'Timed' })).toBe(false);
  });

  it('treats a nonsense limit as no limit rather than as an exam', () => {
    expect(isPracticeAttempt({ mode: 'test', timeLimitMinutes: Number.NaN })).toBe(true);
    expect(isPracticeAttempt({ mode: 'test', timeLimitMinutes: -5 })).toBe(true);
  });
});

describe('classifyReviewOutcome', () => {
  it('names the four confidence pairs', () => {
    expect(classifyReviewOutcome({ isCorrect: true, answered: true, confidence: 'sure' })).toBe('locked_in');
    expect(classifyReviewOutcome({ isCorrect: true, answered: true, confidence: 'unsure' })).toBe('lucky');
    expect(classifyReviewOutcome({ isCorrect: false, answered: true, confidence: 'sure' })).toBe('slipped');
    expect(classifyReviewOutcome({ isCorrect: false, answered: true, confidence: 'unsure' })).toBe('learning');
  });

  it('never invents a confidence the reader did not give', () => {
    expect(classifyReviewOutcome({ isCorrect: true, answered: true })).toBe('correct');
    expect(classifyReviewOutcome({ isCorrect: false, answered: true, confidence: null })).toBe('incorrect');
  });

  it('reports a blank as unanswered even when the grader marked it wrong', () => {
    expect(classifyReviewOutcome({ isCorrect: false, answered: false })).toBe('unanswered');
    expect(classifyReviewOutcome({ isCorrect: false, answered: false, confidence: 'sure' })).toBe('unanswered');
  });

  it('gives every outcome a word and a glyph, so colour is never the only signal', () => {
    for (const key of Object.keys(REVIEW_OUTCOMES) as Array<keyof typeof REVIEW_OUTCOMES>) {
      expect(REVIEW_OUTCOMES[key].label.length).toBeGreaterThan(0);
      expect(REVIEW_OUTCOMES[key].icon.length).toBeGreaterThan(0);
    }
  });
});

describe('isAnswerProvided', () => {
  it('rejects every empty shape a stored answer can take', () => {
    expect(isAnswerProvided(undefined)).toBe(false);
    expect(isAnswerProvided(null)).toBe(false);
    expect(isAnswerProvided('')).toBe(false);
    expect(isAnswerProvided('   ')).toBe(false);
    expect(isAnswerProvided([])).toBe(false);
    expect(isAnswerProvided(['', '  '])).toBe(false);
    expect(isAnswerProvided({})).toBe(false);
    expect(isAnswerProvided({ Mitochondria: '' })).toBe(false);
  });

  it('accepts real answers of every shape', () => {
    expect(isAnswerProvided('True')).toBe(true);
    expect(isAnswerProvided(['A', 'C'])).toBe(true);
    expect(isAnswerProvided({ Mitochondria: 'Powerhouse' })).toBe(true);
  });
});

describe('tallyAttempt', () => {
  const answered = (isCorrect: boolean) => ({ isCorrect, userAnswer: isCorrect ? 'A' : 'B' });
  const blank = { isCorrect: false, userAnswer: '' };

  it('counts unanswered apart from wrong', () => {
    const tally = tallyAttempt([answered(true), answered(false), blank, blank]);
    expect(tally.total).toBe(4);
    expect(tally.answered).toBe(2);
    expect(tally.correct).toBe(1);
    expect(tally.incorrect).toBe(1);
    expect(tally.unanswered).toBe(2);
  });

  it('reports accuracy on what was answered beside the graded score', () => {
    const tally = tallyAttempt([answered(true), answered(true), blank, blank]);
    expect(tally.scorePercentage).toBe(50);
    expect(tally.accuracyPercentage).toBe(100);
    expect(tally.isPartial).toBe(true);
  });

  it('does not let a stray isCorrect on a blank inflate the score', () => {
    const tally = tallyAttempt([{ isCorrect: true, userAnswer: '' }, answered(true)]);
    expect(tally.correct).toBe(1);
    expect(tally.unanswered).toBe(1);
    expect(tally.incorrect).toBe(0);
  });

  it('flags an abandoned attempt instead of scoring it', () => {
    const tally = tallyAttempt([blank, blank, blank]);
    expect(tally.isAbandoned).toBe(true);
    expect(tally.accuracyPercentage).toBeNull();
    expect(describeTally(tally)).toContain('This is not a score');
  });

  it('says nothing extra when every question was answered', () => {
    const tally = tallyAttempt([answered(true), answered(false)]);
    expect(tally.isPartial).toBe(false);
    expect(tally.isAbandoned).toBe(false);
    expect(describeTally(tally)).toBeNull();
  });

  it('spells out the split on a partial attempt', () => {
    const tally = tallyAttempt([answered(true), answered(false), blank]);
    const line = describeTally(tally)!;
    expect(line).toContain('1 question left blank');
    expect(line).toContain('1 answered wrong');
    expect(line).toContain('50%');
  });

  it('survives an empty attempt', () => {
    const tally = tallyAttempt([]);
    expect(tally.scorePercentage).toBe(0);
    expect(tally.isAbandoned).toBe(false);
    expect(describeTally(tally)).toBeNull();
  });
});

describe('resolveQuestionSource', () => {
  it('prefers the question’s own note over the attempt', () => {
    const source = resolveQuestionSource({
      question: { noteId: 'n1', noteTitle: 'Cell Biology' },
      attempt: { groupId: 'g1', groupName: 'Bio 101' },
    });
    expect(source).toEqual({ kind: 'note', id: 'n1', title: 'Cell Biology', label: 'From Cell Biology' });
  });

  it('falls back to the study group the attempt came from', () => {
    const source = resolveQuestionSource({ question: {}, attempt: { groupId: 'g1', groupName: 'Bio 101' } });
    expect(source).toEqual({ kind: 'group', id: 'g1', title: 'Bio 101', label: 'From Bio 101' });
  });

  it('falls back to the deck last', () => {
    const source = resolveQuestionSource({ attempt: { deckId: 'd1', deckName: 'Organelles' } });
    expect(source?.kind).toBe('deck');
    expect(source?.label).toBe('From Organelles');
  });

  it('names the kind when the title is missing but the link still works', () => {
    expect(resolveQuestionSource({ attempt: { groupId: 'g1' } })?.label).toBe('From this study group');
  });

  it('refuses a chip that would link nowhere', () => {
    expect(resolveQuestionSource({ question: { noteTitle: 'Orphan' }, attempt: {} })).toBeNull();
    expect(resolveQuestionSource({})).toBeNull();
    expect(resolveQuestionSource({ attempt: { groupId: '   ' } })).toBeNull();
  });
});

describe('questionSourceTarget', () => {
  it('opens a note and a deck on the Study tab', () => {
    expect(questionSourceTarget({ kind: 'note', id: 'n1', title: 'N', label: '' })).toEqual({
      tab: 'StudyTab',
      screen: 'NoteEditor',
      params: { noteId: 'n1' },
    });
    expect(questionSourceTarget({ kind: 'deck', id: 'd1', title: 'D', label: '' })).toEqual({
      tab: 'StudyTab',
      screen: 'DeckDetail',
      params: { deckId: 'd1', deckName: 'D' },
    });
  });

  it('opens a study group thread on the Chat tab', () => {
    expect(questionSourceTarget({ kind: 'group', id: 'g1', title: 'Bio 101', label: '' })).toEqual({
      tab: 'ChatTab',
      screen: 'GroupChat',
      params: { groupId: 'g1', groupName: 'Bio 101' },
    });
  });
});
