/**
 * Guided mode's client half: the modes a client may send, and the picker model
 * that decides what the goal rows say.
 *
 * The failure these pin is the dishonest one — a `Continue learning:` row for a
 * topic with no stored checkpoint, which tells a student they made progress
 * they never made.
 */
import {
  COMPANION_MODES,
  COMPANION_MODE_LABELS,
  DEFAULT_COMPANION_MODE,
  buildGuidedGoals,
  guidedFreeTextPrompt,
  isCompanionMode,
  normalizeCompanionMode,
} from './companion';

describe('companion modes on the wire', () => {
  it('offers guided alongside the three older modes', () => {
    expect(COMPANION_MODES).toEqual(['explain', 'quiz_me', 'socratic', 'guided']);
    expect(COMPANION_MODE_LABELS.guided).toBe('Guided');
    expect(isCompanionMode('guided')).toBe(true);
  });

  it('rejects anything not on the allowlist rather than passing it along', () => {
    expect(isCompanionMode('tutor')).toBe(false);
    expect(isCompanionMode('GUIDED')).toBe(false);
    expect(isCompanionMode(undefined)).toBe(false);
    expect(normalizeCompanionMode('tutor')).toBe(DEFAULT_COMPANION_MODE);
    expect(normalizeCompanionMode(undefined)).toBe('explain');
    expect(normalizeCompanionMode('guided')).toBe('guided');
  });
});

describe('the guided goal picker', () => {
  it('offers Continue learning first when a real next topic exists', () => {
    const goals = buildGuidedGoals({
      nextTopic: 'Narrow vs. General AI',
      topics: ['Symbolic AI', 'Deep Learning'],
    });

    expect(goals[0].kind).toBe('continue');
    expect(goals[0].label).toBe('Continue learning: Narrow vs. General AI');
    expect(goals.slice(1).map((g) => g.label)).toEqual([
      'Start learning: Symbolic AI',
      'Start learning: Deep Learning',
    ]);
  });

  it('offers Start learning only when there is no stored next topic', () => {
    const goals = buildGuidedGoals({ topics: ['Symbolic AI', 'Deep Learning'] });

    expect(goals.every((g) => g.kind === 'start')).toBe(true);
    expect(goals.map((g) => g.label)).toEqual([
      'Start learning: Symbolic AI',
      'Start learning: Deep Learning',
    ]);
  });

  it('never invents a row out of nothing', () => {
    expect(buildGuidedGoals()).toEqual([]);
    expect(buildGuidedGoals({ nextTopic: '   ', topics: [null, undefined, ''] })).toEqual([]);
  });

  it('does not offer the same topic twice as continue and start', () => {
    const goals = buildGuidedGoals({
      nextTopic: 'Deep Learning',
      topics: ['deep   learning', 'Symbolic AI'],
    });

    expect(goals.map((g) => g.label)).toEqual([
      'Continue learning: Deep Learning',
      'Start learning: Symbolic AI',
    ]);
  });

  it('takes the plan\'s next topic as an object and keeps the row one line', () => {
    const [goal] = buildGuidedGoals({
      nextTopic: { title: 'Narrow vs. General AI', unit: '01 AI Foundations' },
      topics: ['Symbolic AI'],
    });

    // The unit is context for the lesson, not a second line on the row.
    expect(goal.label).toBe('Continue learning: Narrow vs. General AI');
    expect(goal.unit).toBe('01 AI Foundations');
    expect(goal.prompt).toContain('from 01 AI Foundations in my study plan');
  });

  it('drops a blank unit rather than sending an empty one to the model', () => {
    const [goal] = buildGuidedGoals({ nextTopic: { title: 'Osmosis', unit: '  ' } });

    expect(goal.label).toBe('Continue learning: Osmosis');
    expect(goal.unit).toBeNull();
    expect(goal.prompt).not.toContain('in my study plan');
  });

  it('offers no continue row for an object with no real title', () => {
    expect(buildGuidedGoals({ nextTopic: { title: '   ', unit: 'Unit 1' } })).toEqual([]);
  });

  it('caps the rows so the picker stays a choice, not a list', () => {
    const goals = buildGuidedGoals({
      topics: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      limit: 3,
    });

    expect(goals).toHaveLength(3);
  });

  it('asks for one step at a time in the prompt every row sends', () => {
    const [goal] = buildGuidedGoals({ topics: ['Osmosis'] });

    expect(goal.prompt).toContain('Osmosis');
    expect(goal.prompt).toContain('one step at a time');
    expect(guidedFreeTextPrompt('  the  Krebs cycle ')).toContain('the Krebs cycle');
    expect(guidedFreeTextPrompt('Osmosis')).toContain('one step at a time');
  });
});
