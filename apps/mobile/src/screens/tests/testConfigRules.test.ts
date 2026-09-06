import {
  isTestConfigValid,
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
