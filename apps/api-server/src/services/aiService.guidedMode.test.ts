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
