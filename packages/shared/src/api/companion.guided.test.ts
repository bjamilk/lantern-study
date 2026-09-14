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
  guidedSeedPrompt,
  showGuidedComposerPicker,
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
    expect(goal.prompt).toContain('in 01 AI Foundations');
  });

  it('drops a blank unit rather than sending an empty one to the model', () => {
    const [goal] = buildGuidedGoals({ nextTopic: { title: 'Osmosis', unit: '  ' } });

    expect(goal.label).toBe('Continue learning: Osmosis');
    expect(goal.unit).toBeNull();
    expect(goal.prompt).toBe(
      'Guide me through "Osmosis". Start with step 1 now — teach that one step,' +
        ' then check I have got it before moving on. Do not ask me which material to use.'
    );
  });

  /**
   * Observation B of the 1.0.57 release smoke: picking `Continue learning:
   * Imported Notes` spent a credit on "which imported note would you like to
   * continue with?" and taught nothing until turn 2. The seed named the UNIT,
   * so the model had a folder and no document. It now names the topic and the
   * source note the plan built it from.
   */
  it('names the topic and its source note, not the unit, in the turn it sends', () => {
    const [goal] = buildGuidedGoals({
      nextTopic: {
        title: 'RSV transmission',
        unit: 'Imported Notes',
        sourceNoteId: 'note-7',
        sourceTitle: 'The RSV overview',
      },
    });

    expect(goal.label).toBe('Continue learning: RSV transmission');
    expect(goal.sourceNoteId).toBe('note-7');
    expect(goal.prompt).toBe(
      'Guide me through "RSV transmission" from "The RSV overview" in Imported Notes.' +
        ' Start with step 1 now — teach that one step, then check I have got it' +
        ' before moving on. Do not ask me which material to use.'
    );
  });

  it('sends a teaching order even when no source is known', () => {
    const [goal] = buildGuidedGoals({
      nextTopic: { title: 'RSV transmission', unit: 'Imported Notes' },
    });

    expect(goal.sourceNoteId).toBeNull();
    expect(goal.sourceTitle).toBeNull();
    expect(goal.prompt).not.toContain(' from "');
    expect(goal.prompt).toContain('Start with step 1 now');
    expect(goal.prompt).toContain('Do not ask me which material to use');
  });

  it('builds the same sentence for a bare topic, blanks trimmed away', () => {
    expect(guidedSeedPrompt({ topic: '  Osmosis  ', source: '  ', unit: null })).toBe(
      'Guide me through "Osmosis". Start with step 1 now — teach that one step,' +
        ' then check I have got it before moving on. Do not ask me which material to use.'
    );
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
    expect(goal.prompt).toContain('Start with step 1 now');
    expect(guidedFreeTextPrompt('  the  Krebs cycle ')).toContain('the Krebs cycle');
    expect(guidedFreeTextPrompt('Osmosis')).toContain('one step at a time');
  });
});

/**
 * Toggling Guided on inside a thread that already had turns flipped the header
 * badge and offered nothing — the mode with no way to name a target except free
 * text (AH release smoke 1.0.57). The picker now follows the mode, drawn above
 * the composer once the thread has history; an empty thread already draws it in
 * the empty state, and two cost lines on one screen is not an improvement.
 */
describe('the guided picker above the composer', () => {
  it('appears when Guided is on inside a thread with history', () => {
    expect(showGuidedComposerPicker({ guided: true, hasMessages: true })).toBe(true);
  });

  it('stays out of an empty thread, where the empty state already offers it', () => {
    expect(showGuidedComposerPicker({ guided: true, hasMessages: false })).toBe(false);
    expect(showGuidedComposerPicker({ guided: true })).toBe(false);
  });

  it('is never drawn with Guided off, once dismissed, or while history loads', () => {
    expect(showGuidedComposerPicker({ guided: false, hasMessages: true })).toBe(false);
    expect(showGuidedComposerPicker({ guided: true, hasMessages: true, dismissed: true })).toBe(
      false
    );
    expect(
      showGuidedComposerPicker({ guided: true, hasMessages: true, isLoadingHistory: true })
    ).toBe(false);
  });
});

/**
 * The 1.0.58 smoke: a set with TWO topics, one of them already covered, drew a
 * picker with a `Continue learning:` row and nothing else — no way to start
 * the other topic, and no way to walk the covered one again. The rule is the
 * narrow one: a topic is offered unless it IS the Continue row or the plan
 * says `mastered`.
 */
describe('the guided picker over plan rows', () => {
  const topics = [
    { title: 'Narrow vs. General AI', status: 'covered' as const },
    { title: 'Symbolic AI', status: 'unseen' as const },
  ];

  it('offers a Start row for every topic that is not the Continue row', () => {
    const goals = buildGuidedGoals({ nextTopic: 'Symbolic AI', topics });

    expect(goals.map((g) => g.label)).toEqual([
      'Continue learning: Symbolic AI',
      // Covered, and still startable: seen once is not done with.
      'Start learning: Narrow vs. General AI',
    ]);
  });

  it('keeps covered topics and drops only mastered ones', () => {
    const goals = buildGuidedGoals({
      topics: [
        { title: 'Osmosis', status: 'covered' },
        { title: 'Diffusion', status: 'mastered' },
        { title: 'Active transport', status: 'unseen' },
        { title: 'Tonicity' },
      ],
    });

    expect(goals.map((g) => g.topic)).toEqual(['Osmosis', 'Active transport', 'Tonicity']);
    expect(goals.every((g) => g.kind === 'start')).toBe(true);
  });

  it('carries the row’s own source into the turn it sends, as Continue does', () => {
    const [goal] = buildGuidedGoals({
      topics: [
        {
          title: 'Osmosis',
          status: 'covered',
          unit: '02 Transport',
          sourceNoteId: 'note-9',
          sourceTitle: 'Membranes lecture',
        },
      ],
    });

    expect(goal.sourceNoteId).toBe('note-9');
    expect(goal.prompt).toContain('Guide me through "Osmosis" from "Membranes lecture" in 02 Transport');
  });

  it('still takes bare titles, and still ignores blanks', () => {
    const goals = buildGuidedGoals({ topics: ['Symbolic AI', { title: '  ' }, null] });
    expect(goals.map((g) => g.topic)).toEqual(['Symbolic AI']);
  });
});
