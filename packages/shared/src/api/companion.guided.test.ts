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
  GUIDED_FIRST_STEP,
  advanceGuidedSession,
  extractGuidedCheck,
  guidedFreeTextPrompt,
  normalizeGuidedSession,
  startGuidedSession,
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

/**
 * The guided SESSION — what turn 2 knows about turn 1.
 *
 * The seed sentence named the topic once. Every turn after it sent `mode:
 * 'guided'` and nothing else, so the model re-read the thread, found the words
 * "Imported Notes" in the seed, and taught the student how to find their notes
 * — from step 1, on a turn they had just answered correctly (production
 * faeaf324). These are the rules that stop that: the session is carried, the
 * step only moves forward, and a re-check of the SAME question does not count
 * as progress.
 */
describe('guided session', () => {
  it('opens a lesson at step 1 with its topic and source', () => {
    const session = startGuidedSession({
      topic: '  Osmosis  and   diffusion ',
      sourceNoteId: 'note-1',
      sourceTitle: 'Cell transport',
    });

    expect(session).toEqual({
      topic: 'Osmosis and diffusion',
      sourceNoteId: 'note-1',
      sourceTitle: 'Cell transport',
      step: GUIDED_FIRST_STEP,
      lastCheck: null,
    });
  });

  it('refuses a session with no real topic — an empty one would reach the prompt', () => {
    expect(startGuidedSession({ topic: '   ' })).toBeNull();
    expect(startGuidedSession({ topic: '' })).toBeNull();
  });

  it('reads the check question the reply ended on', () => {
    expect(
      extractGuidedCheck('Water moves to the saltier side.\n\nCheck: which way does water move?')
    ).toBe('which way does water move?');
    // The model writes **Check:** about as often as it writes Check:.
    expect(extractGuidedCheck('Taught it.\n\n**Check:** name the solute.')).toBe('name the solute.');
  });

  it('takes the LAST check, so a re-teach does not resurrect the old one', () => {
    const reply = [
      'Not quite — earlier I asked',
      'Check: what is osmosis?',
      'and the answer is water.',
      '',
      'Check: which side does water move toward?',
    ].join('\n');

    expect(extractGuidedCheck(reply)).toBe('which side does water move toward?');
  });

  it('returns null when the reply asked no check at all', () => {
    expect(extractGuidedCheck('Here is a definition and nothing else.')).toBeNull();
    expect(extractGuidedCheck('')).toBeNull();
  });

  it('advances a step when the reply asks a NEW check question', () => {
    const session = {
      topic: 'Osmosis',
      step: 1,
      lastCheck: 'which way does water move?',
    };

    const next = advanceGuidedSession(session, {
      reply: 'Correct.\n\nStep 2: tonicity.\n\nCheck: what is a hypertonic solution?',
    });

    expect(next.step).toBe(2);
    expect(next.lastCheck).toBe('what is a hypertonic solution?');
    expect(next.topic).toBe('Osmosis');
  });

  it('does NOT advance when the same check comes back — that is a re-teach', () => {
    const session = { topic: 'Osmosis', step: 3, lastCheck: 'which way does water move?' };

    const next = advanceGuidedSession(session, {
      reply: 'Not quite. Think of it as chasing salt.\n\nCheck: which way does water move?',
    });

    expect(next.step).toBe(3);
    expect(next.lastCheck).toBe('which way does water move?');
  });

  it('prefers the server step, which is the only thing that judged the answer', () => {
    const session = { topic: 'Osmosis', step: 4, lastCheck: 'a?' };

    expect(advanceGuidedSession(session, { reply: 'No check here.', guidedStep: 5 }).step).toBe(5);
  });

  it('never rewinds, and never restarts at step 1', () => {
    const session = { topic: 'Osmosis', step: 6, lastCheck: 'a?' };

    expect(advanceGuidedSession(session, { guidedStep: 1 }).step).toBe(6);
    expect(
      advanceGuidedSession(session, { reply: 'Step 1 – Locate your Imported Notes' }).step
    ).toBe(6);
  });

  it('keeps the standing question when a reply carries no check', () => {
    const session = { topic: 'Osmosis', step: 2, lastCheck: 'which way does water move?' };

    expect(advanceGuidedSession(session, { reply: 'Yes, Lantern is free.' }).lastCheck).toBe(
      'which way does water move?'
    );
  });
});

/**
 * The server's read of that session.
 *
 * `guided` is client-declared metadata, like `mode`: the student's own app is
 * the usual author, but nothing stops a forged body. Anything malformed must
 * become null — which costs one block of prompt, not a wrong answer.
 */
describe('normalizeGuidedSession (server side)', () => {
  it('accepts a well-formed session', () => {
    expect(
      normalizeGuidedSession({
        topic: 'Osmosis',
        sourceNoteId: 'note-1',
        sourceTitle: 'Cell transport',
        step: 3,
        lastCheck: 'which way does water move?',
      })
    ).toEqual({
      topic: 'Osmosis',
      sourceNoteId: 'note-1',
      sourceTitle: 'Cell transport',
      step: 3,
      lastCheck: 'which way does water move?',
    });
  });

  it('drops anything that is not a session object', () => {
    for (const bad of [null, undefined, 'guided', 42, [], [{ topic: 'x' }], true]) {
      expect(normalizeGuidedSession(bad)).toBeNull();
    }
  });

  it('drops a session with no topic — the block would name nothing', () => {
    expect(normalizeGuidedSession({ step: 4, lastCheck: 'a?' })).toBeNull();
    expect(normalizeGuidedSession({ topic: '   ', step: 4 })).toBeNull();
    expect(normalizeGuidedSession({ topic: 12, step: 4 })).toBeNull();
  });

  it('clamps a forged step instead of pasting it into the prompt', () => {
    expect(normalizeGuidedSession({ topic: 'x', step: 1e9 })?.step).toBe(99);
    expect(normalizeGuidedSession({ topic: 'x', step: -4 })?.step).toBe(1);
    expect(normalizeGuidedSession({ topic: 'x', step: 'seven' })?.step).toBe(1);
    expect(normalizeGuidedSession({ topic: 'x' })?.step).toBe(1);
  });

  it('caps lengths and strips control characters', () => {
    const long = normalizeGuidedSession({
      topic: 'a'.repeat(500),
      lastCheck: 'b'.repeat(900),
      step: 2,
    });

    expect(long?.topic.length).toBe(160);
    expect(long?.lastCheck?.length).toBe(400);
    expect(normalizeGuidedSession({ topic: 'osmo\nsis', step: 1 })?.topic).toBe('osmo sis');
  });

  it('keeps non-string ids out rather than guessing at them', () => {
    const session = normalizeGuidedSession({ topic: 'x', sourceNoteId: { id: 1 }, step: 1 });
    expect(session?.sourceNoteId).toBeNull();
  });
});

/**
 * The seed turn is the one that exposed this rule.
 *
 * The seed reply teaches step 1 and ends with step 1's check. Counting that
 * first check as progress put the student on step 2 before they had answered
 * anything, so the next reply skipped a step they had never been taught.
 */
describe('the first check does not move the lesson', () => {
  it('stays on step 1 when the seed reply asks its first check', () => {
    const session = startGuidedSession({ topic: 'Osmosis' })!;

    const next = advanceGuidedSession(session, {
      reply: 'Step 1: water follows salt.\n\nCheck: which way does water move?',
    });

    expect(next.step).toBe(1);
    expect(next.lastCheck).toBe('which way does water move?');
  });

  it('then advances on the answer, once a check is on file', () => {
    const seeded = advanceGuidedSession(startGuidedSession({ topic: 'Osmosis' })!, {
      reply: 'Step 1.\n\nCheck: which way does water move?',
    });

    const next = advanceGuidedSession(seeded, {
      reply: 'Correct.\n\nStep 2.\n\nCheck: what is hypertonic?',
    });

    expect(next.step).toBe(2);
  });
});
