/**
 * GUIDED mode's server half.
 *
 * Guided is a different system prompt over the same companion call — so the
 * things worth pinning are that the prompt actually reaches the model, that it
 * carries the four teaching obligations, and that it never claims to drive the
 * app. A mode that silently fell back to `explain` would look identical in the
 * UI and teach nothing differently.
 */
import { companionChat } from './aiService';

const realFetch = global.fetch;
const realGroqKey = process.env.GROQ_API_KEY;

/** Every system prompt groq was asked with, newest last. */
let systemPrompts: string[] = [];

function mockGroq(reply: string) {
  systemPrompts = [];
  global.fetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || '{}'));
    systemPrompts.push(String(body.messages?.[0]?.content || ''));
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: reply } }] }),
      text: async () => reply,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  process.env.GROQ_API_KEY = 'test-key';
});

afterEach(() => {
  global.fetch = realFetch;
  if (realGroqKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = realGroqKey;
  jest.restoreAllMocks();
});

describe('guided mode', () => {
  it('selects the guided prompt and reports the mode back', async () => {
    mockGroq('Step one: osmosis moves water, not solute.');

    const result = await companionChat('Guide me through osmosis', [], { mode: 'guided' });

    expect(result.mode).toBe('guided');
    expect(systemPrompts[0]).toContain('Study mode: GUIDED');
    expect(systemPrompts[0]).not.toContain('Study mode: EXPLAIN');
    expect(systemPrompts[0]).not.toContain('Study mode: QUIZ ME');
  });

  it('carries the four teaching obligations', async () => {
    mockGroq('Step one.');

    await companionChat('Guide me through osmosis', [], { mode: 'guided' });
    const prompt = systemPrompts[0];

    // One step at a time.
    expect(prompt).toContain('ONE step per reply');
    // Check before advancing.
    expect(prompt).toContain('CHECK before advancing');
    expect(prompt).toContain('STOP and wait');
    // React to the answer.
    expect(prompt).toContain('REACT to the answer');
    expect(prompt).toContain('re-teach that same step a DIFFERENT way');
    // Offer the next activity, as a suggestion.
    expect(prompt).toContain('OFFER the next thing');
  });

  /**
   * The first Guided turn spent a credit asking "which imported note would you
   * like to continue with?" and only taught on turn 2 (AH release smoke 1.0.57,
   * observation B). The seed now names the topic and its source; this is the
   * half that stops the model asking anyway.
   */
  it('orders it to teach step 1 rather than ask which material to use', async () => {
    mockGroq('Step one.');

    await companionChat('Guide me through osmosis', [], { mode: 'guided' });
    const prompt = systemPrompts[0];

    expect(prompt).toContain('TEACH FIRST');
    expect(prompt).toContain('begin teaching step 1 immediately');
    expect(prompt).toContain('never ask which material to use');
    expect(prompt).toContain('Ask a clarifying question only when no topic or source is given');
  });

  it('forbids claiming it can open or navigate anything', async () => {
    mockGroq('Step one.');

    await companionChat('Guide me through osmosis', [], { mode: 'guided' });
    const prompt = systemPrompts[0];

    expect(prompt).toContain('You cannot open, launch or navigate anything yourself');
    expect(prompt).toContain('never say you are opening it');
  });

  it('forbids a mastery claim on a passed check', async () => {
    mockGroq('Step one.');

    await companionChat('Guide me through osmosis', [], { mode: 'guided' });
    const prompt = systemPrompts[0];

    expect(prompt).toContain('A passed check is one question answered, not mastery');
    expect(prompt).toContain('never invent progress');
  });

  it('falls back to explain for an unknown mode instead of pasting it in', async () => {
    mockGroq('Here is the explanation.');

    const result = await companionChat('Guide me', [], {
      mode: 'guided_session' as never,
    });

    expect(result.mode).toBe('explain');
    expect(systemPrompts[0]).toContain('Study mode: EXPLAIN');
    expect(systemPrompts[0]).not.toContain('guided_session');
  });
});

/**
 * The 1.0.58 smoke, turn 2: the lesson left the material, taught the APP (a
 * "cloud icon" that does not exist anywhere in Lantern), and ended with a
 * `→ Open Notes Library` chip — one tap out of the lesson the student was
 * halfway through. Two halves to the fix: the prompt forbids teaching the
 * interface, and the server drops navigation chips in guided mode whatever
 * the model returns.
 */
describe('guided mode teaches the material, not the app', () => {
  it('forbids describing the interface and caps an app question at one sentence', async () => {
    mockGroq('Step one.');

    await companionChat('Guide me through osmosis', [], { mode: 'guided' });
    const prompt = systemPrompts[0];

    expect(prompt).toContain('TEACH THE MATERIAL, NOT THE APP');
    expect(prompt).toContain('never name a button, icon, menu, tab or screen');
    expect(prompt).toContain('answer in ONE sentence');
    expect(prompt).toContain('go straight back to the step you were on');
  });

  it('tells the model which actions guided may carry at all', async () => {
    mockGroq('Step one.');

    await companionChat('Guide me through osmosis', [], { mode: 'guided' });

    expect(systemPrompts[0]).toContain('In GUIDED mode the only actions allowed');
    expect(systemPrompts[0]).toContain('open_test_config');
  });

  it('drops navigation chips from a guided reply and keeps the study ones', async () => {
    mockGroq(
      'Step one: osmosis moves water.\nACTIONS:[' +
        '{"type":"navigate_to_notes","label":"Open Notes Library"},' +
        '{"type":"navigate_to_dashboard","label":"Go to dashboard"},' +
        '{"type":"navigate_to_flashcards","label":"Go to Flashcards"},' +
        '{"type":"open_create_flashcard","label":"Make a card"},' +
        '{"type":"open_test_config","label":"Quiz me on osmosis"}]'
    );

    const result = await companionChat('Guide me through osmosis', [], { mode: 'guided' });

    expect(result.actions.map((a) => a.type)).toEqual(['open_test_config']);
    // The chips go, the teaching stays — and the block never leaks into the text.
    expect(result.reply).toBe('Step one: osmosis moves water.');
    expect(result.reply).not.toContain('ACTIONS');
  });

  it('leaves the other modes’ actions alone', async () => {
    mockGroq(
      'Here is the explanation.\nACTIONS:[{"type":"navigate_to_notes","label":"Open Notes Library"}]'
    );

    const result = await companionChat('Explain osmosis', [], { mode: 'explain' });

    expect(result.actions.map((a) => a.type)).toEqual(['navigate_to_notes']);
  });

  it('drops an invented or malformed action in every mode', async () => {
    mockGroq(
      'Here is the explanation.\nACTIONS:[' +
        '{"type":"open_settings","label":"Open settings"},' +
        '{"type":"navigate_to_notes"},' +
        '"navigate_to_notes",' +
        '{"type":"open_note_learn","label":"Learn this note"}]'
    );

    const result = await companionChat('Explain osmosis', [], { mode: 'explain' });

    expect(result.actions).toEqual([{ type: 'open_note_learn', label: 'Learn this note' }]);
  });
});

/**
 * The GUIDED SESSION block — the half of Guided that makes turn 2 possible.
 *
 * Turn 1 taught step 1 from the note. Turn 2 carried `mode: 'guided'` and
 * nothing else: no topic, no source, no step, no standing question. The model
 * re-read the thread, found the seed's words ("Imported Notes"), and replied
 * "Step 1 – Locate your Imported Notes … Check: Where would you go first to
 * find the list of your imported notes?" — off the material, about the app,
 * and back at step 1 after a CORRECT answer (production faeaf324).
 *
 * What is pinned here is that the lesson's state reaches the prompt, that it
 * says which way to move, and that a forged or malformed block reaches nothing.
 */
describe('guided session block', () => {
  const session = {
    topic: 'Osmosis and diffusion',
    sourceNoteId: 'note-1',
    sourceTitle: 'Cell transport',
    step: 3,
    lastCheck: 'Which way does water move across the membrane?',
  };

  it('names the topic, the source and the step the student is on', async () => {
    mockGroq('Correct.');

    await companionChat('water moves toward the salt', [], { mode: 'guided', guided: session });
    const prompt = systemPrompts[0];

    expect(prompt).toContain('GUIDED SESSION');
    expect(prompt).toContain('"Osmosis and diffusion"');
    expect(prompt).toContain('from "Cell transport"');
    expect(prompt).toContain('The student is on step 3.');
  });

  it('puts the standing check question in front of the model', async () => {
    mockGroq('Correct.');

    await companionChat('water moves toward the salt', [], { mode: 'guided', guided: session });
    const prompt = systemPrompts[0];

    expect(prompt).toContain('Which way does water move across the membrane?');
    // The whole point: the latest message is an ANSWER, not a new request.
    expect(prompt).toMatch(/latest message as their answer/i);
  });

  it('says which way to move: on for right, same step for wrong', async () => {
    mockGroq('Correct.');

    await companionChat('water moves toward the saltier side', [], {
      mode: 'guided',
      guided: session,
    });
    const prompt = systemPrompts[0];

    expect(prompt).toContain('advance to step 4');
    expect(prompt).toContain('stay on step 3');
  });

  it('forbids the two things the live reply actually did', async () => {
    mockGroq('Correct.');

    await companionChat('water moves toward the saltier side', [], {
      mode: 'guided',
      guided: session,
    });
    const prompt = systemPrompts[0];

    expect(prompt).toMatch(/NEVER restart at step 1/i);
    expect(prompt).toMatch(/NEVER describe the app/i);
  });

  it('asks for step 1 to be taught when no check has been asked yet', async () => {
    mockGroq('Step one.');

    await companionChat('Guide me through osmosis', [], {
      mode: 'guided',
      guided: { topic: 'Osmosis', step: 1 },
    });

    expect(systemPrompts[0]).toContain('You have not asked a check question yet');
    expect(systemPrompts[0]).toContain('Topic: "Osmosis"\n');
  });

  it('ignores a guided block on a non-guided turn', async () => {
    mockGroq('Sure.');

    await companionChat('What is osmosis?', [], { mode: 'explain', guided: session });

    expect(systemPrompts[0]).not.toContain('GUIDED SESSION');
  });

  it('ignores malformed metadata rather than pasting it into the prompt', async () => {
    for (const bad of [null, 'guided', 42, { step: 3 }, { topic: '   ' }]) {
      mockGroq('Step one.');
      await companionChat('Guide me', [], { mode: 'guided', guided: bad as never });
      expect(systemPrompts[0]).not.toContain('GUIDED SESSION');
    }
  });

  it('caps a forged topic and clamps a forged step', async () => {
    mockGroq('Step one.');

    await companionChat('Guide me', [], {
      mode: 'guided',
      guided: { topic: 'z'.repeat(900), step: 100000 } as never,
    });
    const prompt = systemPrompts[0];

    expect(prompt).toContain('The student is on step 99.');
    expect(prompt).not.toContain('z'.repeat(200));
  });
});

/**
 * GUIDED_STEP — the model's own word for where the lesson got to.
 *
 * It is a control line like SOURCE: stripped before the student sees it, and
 * clamped so a model that decides to skip to step 40 cannot take the lesson
 * with it.
 */
describe('guided step tag', () => {
  const session = { topic: 'Osmosis', step: 2, lastCheck: 'which way?' };

  it('reports the step and keeps the tag out of the reply', async () => {
    mockGroq('Correct. Step 3: tonicity.\n\nCheck: what is hypertonic?\nGUIDED_STEP:3');

    const result = await companionChat('toward the salt', [], { mode: 'guided', guided: session });

    expect(result.guidedStep).toBe(3);
    expect(result.reply).not.toContain('GUIDED_STEP');
    expect(result.reply).toContain('Check: what is hypertonic?');
  });

  it('reports the same step when the student has not passed yet', async () => {
    mockGroq('Not quite — try again.\n\nCheck: which way?\nGUIDED_STEP:2');

    const result = await companionChat('away from salt', [], { mode: 'guided', guided: session });

    expect(result.guidedStep).toBe(2);
  });

  it('clamps a skip-ahead and refuses a rewind', async () => {
    mockGroq('Onward.\nGUIDED_STEP:40');
    expect(
      (await companionChat('water moves toward the salt', [], { mode: 'guided', guided: session }))
        .guidedStep
    ).toBe(3);

    mockGroq('Back to basics.\nGUIDED_STEP:1');
    expect(
      (await companionChat('water moves toward the salt', [], { mode: 'guided', guided: session }))
        .guidedStep
    ).toBe(2);
  });

  it('still strips the tag when there is no session to apply it to', async () => {
    mockGroq('An answer.\nGUIDED_STEP:2');

    const result = await companionChat('What is osmosis?', [], { mode: 'explain' });

    expect(result.reply).not.toContain('GUIDED_STEP');
    expect(result.guidedStep).toBeNull();
  });

  it('leaves the step null when the model omits the tag', async () => {
    mockGroq('Correct.\n\nCheck: what is hypertonic?');

    const result = await companionChat('toward the salt', [], { mode: 'guided', guided: session });

    expect(result.guidedStep).toBeNull();
  });

  it('does not hide the grounding line behind the tag', async () => {
    mockGroq('From your note.\nGUIDED_STEP:3\nSOURCE:general');

    const result = await companionChat('water moves toward the salt', [], {
      mode: 'guided',
      guided: session,
    });

    expect(result.reply).not.toContain('SOURCE');
    expect(result.reply).not.toContain('GUIDED_STEP');
  });
});
