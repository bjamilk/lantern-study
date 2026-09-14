import { describe, expect, it } from 'vitest';
import {
  MAX_QUESTION_COUNT,
  TEST_SOURCES,
  clampQuestionCount,
  defaultTestPlan,
  attemptKindFromConfig,
  isNavigationSource,
  primaryActionLabel,
  applyTestSittingPreset,
  testConfigForPlan,
  summarizeTestPlan,
  validateTestPlan,
  type TestPlanDraft,
} from './testBuilder';

const plan = (over: Partial<TestPlanDraft> = {}): TestPlanDraft => ({
  ...defaultTestPlan(),
  ...over,
});

describe('TEST_SOURCES', () => {
  it('offers the three sources, group last and honest about leaving', () => {
    expect(TEST_SOURCES.map((s) => s.id)).toEqual(['deck', 'note', 'group']);
    expect(TEST_SOURCES[2].description).toMatch(/group chat/i);
  });
});

describe('defaultTestPlan', () => {
  it('starts on practice with no clock and nothing pre-chosen', () => {
    expect(defaultTestPlan()).toMatchObject({
      source: null,
      attemptKind: 'practice',
      timerMinutes: 0,
    });
  });
});

describe('applyTestSittingPreset', () => {
  it('turns timed into an exam with a clock', () => {
    expect(applyTestSittingPreset(plan(), 'timed')).toMatchObject({
      sittingPreset: 'timed',
      attemptKind: 'exam',
      timerMinutes: 30,
    });
  });
});

describe('clampQuestionCount', () => {
  it('never falls below one or above the ceiling', () => {
    expect(clampQuestionCount(0)).toBe(1);
    expect(clampQuestionCount(999)).toBe(MAX_QUESTION_COUNT);
    expect(clampQuestionCount(Number.NaN)).toBe(1);
  });

  it('is capped by what the source actually holds', () => {
    expect(clampQuestionCount(30, 7)).toBe(7);
    expect(clampQuestionCount(3, 7)).toBe(3);
  });

  it('ignores a meaningless availability', () => {
    expect(clampQuestionCount(10, 0)).toBe(10);
    expect(clampQuestionCount(10, null)).toBe(10);
  });
});

describe('validateTestPlan', () => {
  it('will not start without a source', () => {
    expect(validateTestPlan(plan())).toEqual({
      canStart: false,
      blocker: 'Pick where the questions come from.',
    });
  });

  it('says WHY it cannot start, never a silent dead button', () => {
    const cases = [
      validateTestPlan(plan({ source: 'deck' }), { deckCount: 0 }),
      validateTestPlan(plan({ source: 'note' }), { noteCount: 0 }),
      validateTestPlan(plan({ source: 'deck' }), { deckCount: 3 }),
    ];
    for (const result of cases) {
      expect(result.canStart).toBe(false);
      expect(result.blocker).toBeTruthy();
    }
  });

  it('points at the Library when there is nothing to build from', () => {
    expect(validateTestPlan(plan({ source: 'deck' }), { deckCount: 0 }).blocker).toMatch(/Library/);
  });

  it('starts once a deck is chosen', () => {
    expect(
      validateTestPlan(plan({ source: 'deck', sourceId: 'd1' }), { deckCount: 2 })
    ).toEqual({ canStart: true, blocker: null });
  });

  it('lets the group source through with nothing else filled in — it is a door, not a form', () => {
    expect(validateTestPlan(plan({ source: 'group' }))).toEqual({ canStart: true, blocker: null });
  });

  it('refuses a zero-question test', () => {
    expect(
      validateTestPlan(plan({ source: 'note', sourceId: 'n1', questionCount: 0 }), { noteCount: 1 })
        .canStart
    ).toBe(false);
  });
});

describe('summarizeTestPlan', () => {
  it('says exactly what Start will produce', () => {
    expect(
      summarizeTestPlan(
        plan({ source: 'deck', sourceId: 'd1', sourceTitle: 'Bio cards', questionCount: 10 })
      )
    ).toBe('10 questions from “Bio cards” · practice · answers revealed as you go.');
  });

  it('names the clock on an exam, including when there is none', () => {
    const exam = plan({
      source: 'note',
      sourceId: 'n1',
      sourceTitle: 'L4',
      attemptKind: 'exam',
      questionCount: 20,
      timerMinutes: 15,
    });
    expect(summarizeTestPlan(exam)).toMatch(/exam · 15 min · scored at the end/);
    expect(summarizeTestPlan({ ...exam, timerMinutes: 0 })).toMatch(/no timer/);
  });

  it('is singular for one question', () => {
    expect(summarizeTestPlan(plan({ source: 'deck', sourceId: 'd', questionCount: 1 }))).toMatch(
      /^1 question from a deck/
    );
  });

  it('tells the truth about the group source instead of describing a test', () => {
    expect(summarizeTestPlan(plan({ source: 'group' }))).toMatch(/opens it/);
  });

  it('prompts before anything is chosen', () => {
    expect(summarizeTestPlan(plan())).toBe('Pick a source to begin.');
  });
});

describe('primaryActionLabel', () => {
  it('changes with the source and the attempt kind', () => {
    expect(primaryActionLabel(plan({ source: 'group' }))).toBe('Open group chat');
    expect(primaryActionLabel(plan({ source: 'deck' }))).toBe('Start practice');
    expect(primaryActionLabel(plan({ source: 'deck', attemptKind: 'exam' }))).toBe('Start test');
  });
});

describe('isNavigationSource', () => {
  it('is only the group source', () => {
    expect(isNavigationSource('group')).toBe(true);
    expect(isNavigationSource('deck')).toBe(false);
    expect(isNavigationSource(null)).toBe(false);
  });
});

describe('testConfigForPlan', () => {
  it('sends practice through as a study-mode attempt with no clock', () => {
    expect(testConfigForPlan(plan({ source: 'deck', attemptKind: 'practice', timerMinutes: 15 })))
      .toEqual({ attemptKind: 'practice', mode: 'study', studyDoor: 'test' });
  });

  it('carries an exam timer through as seconds', () => {
    expect(testConfigForPlan(plan({ source: 'note', attemptKind: 'exam', timerMinutes: 15 })))
      .toEqual({ attemptKind: 'exam', mode: 'test', timerDuration: 900, studyDoor: 'test' });
  });

  it('omits the timer entirely on an untimed exam rather than sending 0', () => {
    const config = testConfigForPlan(plan({ source: 'note', attemptKind: 'exam', timerMinutes: 0 }));
    expect(config).toEqual({ attemptKind: 'exam', mode: 'test', studyDoor: 'test' });
    expect('timerDuration' in config).toBe(false);
  });

  it('ignores a nonsense timer instead of arming a clock with NaN seconds', () => {
    expect(testConfigForPlan(plan({ attemptKind: 'exam', timerMinutes: Number.NaN })))
      .toEqual({ attemptKind: 'exam', mode: 'test', studyDoor: 'test' });
    expect(testConfigForPlan(plan({ attemptKind: 'exam', timerMinutes: -30 })))
      .toEqual({ attemptKind: 'exam', mode: 'test', studyDoor: 'test' });
  });

  it('stamps a sitting preset onto the saved test', () => {
    expect(
      testConfigForPlan(plan({ attemptKind: 'exam', sittingPreset: 'calculator_off', calculatorAllowed: false }))
    ).toMatchObject({
      studyDoor: 'test',
      sittingPreset: 'calculator_off',
      calculatorAllowed: false,
    });
  });
});

describe('attemptKindFromConfig', () => {
  it('reads practice back off a config the builder wrote', () => {
    expect(attemptKindFromConfig(testConfigForPlan(plan({ attemptKind: 'practice' })))).toBe(
      'practice'
    );
  });

  it('treats a test written before the builder existed as an exam', () => {
    expect(attemptKindFromConfig(undefined)).toBe('exam');
    expect(attemptKindFromConfig(null)).toBe('exam');
    expect(attemptKindFromConfig({})).toBe('exam');
    expect(attemptKindFromConfig({ attemptKind: 'nonsense' })).toBe('exam');
  });
});
