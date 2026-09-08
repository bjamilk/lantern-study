import {
  describeStudyModeCard,
  describeTestModeCard,
  isTestConfigValid,
  applyTimerChoices,
  planTimerChoicePersist,
  pruneTimerChoices,
  resolveDefaultSessionMinutes,
  resolveTestTimeLimitMinutes,
  testConfigValidationHint,
  type TestConfigValidity,
} from './testConfigRules';

const base: TestConfigValidity = {
  effectiveMaxQuestions: 10,
  numberOfQuestions: 10,
  isStudyMode: false,
  useSpacedRepetition: false,
  focusOnNew: false,
  selectedQuestionTypeCount: 6,
};

describe('testConfigValidationHint', () => {
  it('passes a normal test configuration', () => {
    expect(testConfigValidationHint(base)).toBeNull();
    expect(isTestConfigValid(base)).toBe(true);
  });

  it('refuses when nothing matches the filters', () => {
    expect(testConfigValidationHint({ ...base, effectiveMaxQuestions: 0, numberOfQuestions: 0 }))
      .toBe('No testable questions match your filters.');
  });

  it('refuses an empty question count', () => {
    expect(testConfigValidationHint({ ...base, numberOfQuestions: 0 }))
      .toBe('Choose at least one question.');
  });

  it('refuses asking for more than the pool holds, and says how many there are', () => {
    expect(testConfigValidationHint({ ...base, effectiveMaxQuestions: 3, numberOfQuestions: 5 }))
      .toBe('Only 3 questions match your filters.');
    expect(testConfigValidationHint({ ...base, effectiveMaxQuestions: 1, numberOfQuestions: 5 }))
      .toBe('Only 1 question matches your filters.');
  });

  it('requires a question type in test mode', () => {
    expect(testConfigValidationHint({ ...base, selectedQuestionTypeCount: 0 }))
      .toBe('Select at least one question type.');
  });

  it('does not require a question type when the mode picks them', () => {
    expect(
      isTestConfigValid({ ...base, selectedQuestionTypeCount: 0, useSpacedRepetition: true })
    ).toBe(true);
    expect(isTestConfigValid({ ...base, selectedQuestionTypeCount: 0, focusOnNew: true })).toBe(true);
    expect(isTestConfigValid({ ...base, selectedQuestionTypeCount: 0, isStudyMode: true })).toBe(true);
  });

  it('starts an untimed test: Timer "None" is a choice, not a missing field', () => {
    // The regression: Start Test was inert with the None chip selected while
    // "5 min" worked, because the validity rule read 0 minutes as invalid.
    expect(isTestConfigValid(base)).toBe(true);
    expect(testConfigValidationHint(base)).toBeNull();
  });

  it('never disables Start without a sentence explaining why', () => {
    const cases: TestConfigValidity[] = [
      { ...base, effectiveMaxQuestions: 0, numberOfQuestions: 0 },
      { ...base, numberOfQuestions: 0 },
      { ...base, numberOfQuestions: 99 },
      { ...base, selectedQuestionTypeCount: 0 },
      base,
    ];
    for (const input of cases) {
      expect(isTestConfigValid(input)).toBe(testConfigValidationHint(input) === null);
    }
  });
});

describe('resolveTestTimeLimitMinutes', () => {
  it('converts the chosen timer to whole minutes', () => {
    expect(
      resolveTestTimeLimitMinutes({ timerDurationSeconds: 300, sessionMode: 'test', fallbackMinutes: 45 })
    ).toBe(5);
    expect(
      resolveTestTimeLimitMinutes({ timerDurationSeconds: 3600, sessionMode: 'test', fallbackMinutes: 45 })
    ).toBe(60);
  });

  it('rounds a partial minute up, so no time is lost', () => {
    expect(
      resolveTestTimeLimitMinutes({ timerDurationSeconds: 90, sessionMode: 'test', fallbackMinutes: 45 })
    ).toBe(2);
  });

  it('honours None as untimed instead of falling back to the test default', () => {
    expect(
      resolveTestTimeLimitMinutes({ timerDurationSeconds: 0, sessionMode: 'test', fallbackMinutes: 45 })
    ).toBe(0);
  });

  it('keeps the test default for a study session, which shows no timer', () => {
    expect(
      resolveTestTimeLimitMinutes({ timerDurationSeconds: 0, sessionMode: 'study', fallbackMinutes: 45 })
    ).toBe(45);
    expect(
      resolveTestTimeLimitMinutes({ timerDurationSeconds: 0, sessionMode: 'study', fallbackMinutes: 0 })
    ).toBe(0);
  });

  it('treats nonsense as untimed', () => {
    expect(
      resolveTestTimeLimitMinutes({ timerDurationSeconds: Number.NaN, sessionMode: 'test', fallbackMinutes: 45 })
    ).toBe(0);
    expect(
      resolveTestTimeLimitMinutes({ timerDurationSeconds: -60, sessionMode: 'test', fallbackMinutes: 45 })
    ).toBe(0);
  });
});

describe('resolveDefaultSessionMinutes', () => {
  it('keeps a recorded timer, including an explicit "No limit"', () => {
    expect(
      resolveDefaultSessionMinutes({ timerChosen: true, storedMinutes: 5, questionCount: 20 })
    ).toBe(5);
    // 0 is the reader's answer, not a gap to fill with a question count.
    expect(
      resolveDefaultSessionMinutes({ timerChosen: true, storedMinutes: 0, questionCount: 20 })
    ).toBe(0);
  });

  it('falls back to a minute per question when nothing was recorded', () => {
    // The exact case behind T4: the strip said "No Limit" off a stored 0
    // while the config sheet said "5 min" off this rule. One answer now.
    expect(
      resolveDefaultSessionMinutes({ timerChosen: false, storedMinutes: 0, questionCount: 5 })
    ).toBe(5);
  });

  it('never starts a test on nothing', () => {
    expect(
      resolveDefaultSessionMinutes({ timerChosen: false, storedMinutes: 0, questionCount: 0 })
    ).toBe(1);
    expect(
      resolveDefaultSessionMinutes({ timerChosen: true, storedMinutes: NaN, questionCount: 3 })
    ).toBe(3);
  });
});

describe('planTimerChoicePersist', () => {
  it('records the chips as minutes, No limit included', () => {
    expect(planTimerChoicePersist({ timerDurationSeconds: 300, sessionMode: 'test' })).toBe(5);
    expect(planTimerChoicePersist({ timerDurationSeconds: 90, sessionMode: 'test' })).toBe(2);
    // 0 is the answer, not the absence of one: it is what makes reopening the
    // sheet say "No limit" instead of a minute per question (T4).
    expect(planTimerChoicePersist({ timerDurationSeconds: 0, sessionMode: 'test' })).toBe(0);
  });

  it('records nothing for a study session, which has no Timer section', () => {
    expect(planTimerChoicePersist({ timerDurationSeconds: 0, sessionMode: 'study' })).toBeNull();
    expect(planTimerChoicePersist({ timerDurationSeconds: 600, sessionMode: 'study' })).toBeNull();
  });

  it('keeps the same choice however the sheet closed', () => {
    // Build 164: × committed the timer and Cancel threw it away, so the same
    // sheet meant two different things depending on which corner you pressed.
    // A timer is a setting, not a form field — every exit keeps it.
    for (const seconds of [0, 90, 300]) {
      const start = planTimerChoicePersist({
        timerDurationSeconds: seconds,
        sessionMode: 'test',
        exit: 'start',
      });
      expect(
        planTimerChoicePersist({ timerDurationSeconds: seconds, sessionMode: 'test', exit: 'cancel' }),
      ).toBe(start);
      expect(
        planTimerChoicePersist({ timerDurationSeconds: seconds, sessionMode: 'test', exit: 'dismiss' }),
      ).toBe(start);
      // And naming no exit at all is the same answer again.
      expect(planTimerChoicePersist({ timerDurationSeconds: seconds, sessionMode: 'test' })).toBe(start);
    }
  });

  it('records nothing on any exit from a study session', () => {
    for (const exit of ['start', 'cancel', 'dismiss'] as const) {
      expect(
        planTimerChoicePersist({ timerDurationSeconds: 600, sessionMode: 'study', exit }),
      ).toBeNull();
    }
  });

  it('reads nonsense as No limit rather than dropping the choice', () => {
    expect(planTimerChoicePersist({ timerDurationSeconds: Number.NaN, sessionMode: 'test' })).toBe(0);
    expect(planTimerChoicePersist({ timerDurationSeconds: -60, sessionMode: 'test' })).toBe(0);
  });
});

describe('applyTimerChoices', () => {
  const rows = [
    { id: 'a', timeLimit: 5, timerChosen: true },
    { id: 'b', timeLimit: 0 },
  ];

  it('puts a recorded choice back on a freshly fetched row', () => {
    // The fetch answers with the SERVER's config, which has no timer key for a
    // test the server never wrote one for — so it would undo the choice made
    // in the config sheet seconds earlier.
    expect(applyTimerChoices(rows, { b: 0 })[1]).toEqual({
      id: 'b',
      timeLimit: 0,
      timerChosen: true,
    });
  });

  it('makes a recorded No limit a RECORDED one, not a missing value', () => {
    const [a] = applyTimerChoices(rows, { a: 0 });
    expect(a.timeLimit).toBe(0);
    expect(a.timerChosen).toBe(true);
    expect(resolveDefaultSessionMinutes({
      timerChosen: !!a.timerChosen,
      storedMinutes: a.timeLimit,
      questionCount: 20,
    })).toBe(0);
  });

  it('leaves a row with no recorded choice exactly as it came', () => {
    const out = applyTimerChoices(rows, {});
    expect(out[0]).toBe(rows[0]);
    expect(out[1]).toBe(rows[1]);
  });

  it('ignores a junk entry rather than timing a test at NaN', () => {
    expect(applyTimerChoices(rows, { b: Number.NaN })[1]).toBe(rows[1]);
  });
});

describe('pruneTimerChoices', () => {
  it('forgets choices for tests that are gone', () => {
    expect(pruneTimerChoices({ a: 0, b: 5 }, ['a'])).toEqual({ a: 0 });
  });

  it('keeps every live one', () => {
    expect(pruneTimerChoices({ a: 0, b: 5 }, ['a', 'b', 'c'])).toEqual({ a: 0, b: 5 });
  });
});


describe('planTimerChoicePersist · untouched sheet', () => {
  it('does not record the seeded default on cancel or dismiss when the reader touched nothing', () => {
    expect(planTimerChoicePersist({ timerDurationSeconds: 600, sessionMode: 'test', exit: 'cancel', touched: false })).toBeNull();
    expect(planTimerChoicePersist({ timerDurationSeconds: 600, sessionMode: 'test', exit: 'dismiss', touched: false })).toBeNull();
  });
  it('still records on start, and on cancel once the timer was touched', () => {
    expect(planTimerChoicePersist({ timerDurationSeconds: 600, sessionMode: 'test', exit: 'start', touched: false })).toBe(10);
    expect(planTimerChoicePersist({ timerDurationSeconds: 0, sessionMode: 'test', exit: 'cancel', touched: true })).toBe(0);
  });
});

describe('describeTestModeCard: the card and the strip say one thing', () => {
  it('names the minutes a timed test actually runs for', () => {
    expect(describeTestModeCard(45)).toBe('45 min • Scored\nNo hints');
  });

  it('says Untimed for a test whose timer is "No limit"', () => {
    // The defect: this card said "Timed • Scored" beside a strip reading
    // "∞ / No limit" for the same test.
    expect(describeTestModeCard(0)).toBe('Untimed • Scored\nNo hints');
  });

  it('agrees with the strip for every stored timer choice', () => {
    for (const stored of [0, 1, 5, 45]) {
      const minutes = resolveDefaultSessionMinutes({
        timerChosen: true,
        storedMinutes: stored,
        questionCount: 10,
      });
      const stripSaysNoLimit = minutes === 0;
      expect(describeTestModeCard(minutes).startsWith('Untimed')).toBe(stripSaysNoLimit);
    }
  });

  it('never promises a timer for practice', () => {
    expect(describeStudyModeCard()).toContain('Untimed');
  });
});
