/**
 * Auto cloze: every generated deck is asked for ~30% cloze deletions, and the
 * mapper decides the card type from what actually came back.
 *
 * The trap being pinned is a card that CALLS itself cloze with no {{c1::…}} in
 * it. That reaches a study session as a card with nothing hidden, so it is
 * downgraded to basic rather than saved as a broken cloze.
 */
import {
  CLOZE_TARGET_RATIO,
  __flashcardTestables,
  generateFlashcardsFromNotes,
} from './aiService';
import { clearAiResponseCacheForTests, hashAiCacheKey } from './aiResponseCache';

const { normalizeGeneratedFlashcard } = __flashcardTestables;

const realFetch = global.fetch;
const realGroqKey = process.env.GROQ_API_KEY;

let systemPrompts: string[] = [];

function mockGroq(payload: unknown) {
  systemPrompts = [];
  global.fetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || '{}'));
    systemPrompts.push(String(body.messages?.[0]?.content || ''));
    const content = JSON.stringify(payload);
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content } }] }),
      text: async () => content,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

const material =
  'Photosynthesis is the process by which plants convert light energy into chemical energy stored as sugar.';

beforeEach(() => {
  clearAiResponseCacheForTests();
  process.env.GROQ_API_KEY = 'test-key';
  process.env.AI_RESPONSE_CACHE = '0';
});

afterEach(() => {
  global.fetch = realFetch;
  if (realGroqKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = realGroqKey;
  delete process.env.AI_RESPONSE_CACHE;
  jest.restoreAllMocks();
});

describe('cloze card mapping', () => {
  it('types a card with a real deletion as cloze', () => {
    const card = normalizeGeneratedFlashcard({
      cardType: 'cloze',
      clozeText: 'Photosynthesis stores energy as {{c1::glucose}}.',
      front: 'Photosynthesis stores energy as _____.',
      back: 'glucose',
    });

    expect(card.cardType).toBe('cloze');
    expect(card.clozeText).toBe('Photosynthesis stores energy as {{c1::glucose}}.');
  });

  it('rebuilds front/back from the deletion so basic-only consumers still work', () => {
    const card = normalizeGeneratedFlashcard({
      cardType: 'cloze',
      clozeText: 'The powerhouse of the cell is the {{c1::mitochondrion}}.',
    });

    expect(card.front).toBe('The powerhouse of the cell is the _____.');
    expect(card.back).toBe('mitochondrion');
    expect(card.front).not.toContain('{{c1::');
  });

  it('joins multiple deletions on the back', () => {
    const card = normalizeGeneratedFlashcard({
      cardType: 'cloze',
      clozeText: 'Photosynthesis needs {{c1::light}} and {{c2::carbon dioxide}}.',
    });

    expect(card.front).toBe('Photosynthesis needs _____ and _____.');
    expect(card.back).toBe('light / carbon dioxide');
  });

  it('downgrades a card that claims to be cloze but hides nothing', () => {
    const card = normalizeGeneratedFlashcard({
      cardType: 'cloze',
      front: 'What is photosynthesis?',
      back: 'Light to chemical energy.',
    });

    expect(card.cardType).toBe('basic');
    expect(card.clozeText).toBeUndefined();
  });

  it('downgrades a card whose only deletion is empty, so no cloze card has an empty answer', () => {
    // `{{c1::}}` matches the marker syntax but hides nothing. Left as cloze,
    // this card would reach a study session with no answer to reveal.
    const card = normalizeGeneratedFlashcard({
      cardType: 'cloze',
      clozeText: 'The capital of Nigeria is {{c1::}}.',
      front: 'The capital of Nigeria is _____.',
      back: 'Abuja',
    });

    expect(card.cardType).toBe('basic');
    expect(card.clozeText).toBeUndefined();
    expect(card.back).toBe('Abuja');
  });

  it('detects a deletion the model put in front instead of clozeText', () => {
    const card = normalizeGeneratedFlashcard({
      front: 'Glucose is produced in the {{c1::Calvin cycle}}.',
      back: 'Calvin cycle',
    });

    expect(card.cardType).toBe('cloze');
    expect(card.front).toBe('Glucose is produced in the _____.');
    expect(card.clozeText).toContain('{{c1::Calvin cycle}}');
  });

  it('accepts snake_case cloze_text from a provider that reshapes keys', () => {
    const card = normalizeGeneratedFlashcard({
      card_type: 'cloze',
      cloze_text: 'ATP is made in the {{c1::mitochondria}}.',
    });

    expect(card.cardType).toBe('cloze');
    expect(card.back).toBe('mitochondria');
  });

  it('leaves an ordinary card basic and untouched', () => {
    const card = normalizeGeneratedFlashcard({
      front: 'Define osmosis',
      back: 'Movement of water across a semipermeable membrane.',
      mnemonic: 'Water walks',
    });

    expect(card).toEqual({
      front: 'Define osmosis',
      back: 'Movement of water across a semipermeable membrane.',
      mnemonic: 'Water walks',
      example: undefined,
      cardType: 'basic',
    });
  });
});

describe('generateFlashcardsFromNotes', () => {
  it('asks for roughly 30% cloze without offering a picker', async () => {
    mockGroq({ flashcards: [{ front: 'Q', back: 'A' }] });

    await generateFlashcardsFromNotes(material, { count: 10 });

    expect(systemPrompts[0]).toContain('"cloze"');
    expect(systemPrompts[0]).toContain(`Exactly ${Math.round(10 * CLOZE_TARGET_RATIO)} of the 10 cards must be "cloze"`);
  });

  it('returns a mixed deck with the cloze cards typed', async () => {
    mockGroq({
      flashcards: [
        { cardType: 'basic', front: 'Define photosynthesis', back: 'Light to chemical energy.' },
        {
          cardType: 'cloze',
          clozeText: 'Photosynthesis happens in the {{c1::chloroplast}}.',
          front: 'Photosynthesis happens in the _____.',
          back: 'chloroplast',
        },
      ],
    });

    const result = await generateFlashcardsFromNotes(material, { count: 10 });

    expect(result.flashcards.map((c) => c.cardType)).toEqual(['basic', 'cloze']);
    expect(result.flashcards[1].clozeText).toContain('{{c1::chloroplast}}');
  });

  it('still rejects a batch where every card is blank', async () => {
    mockGroq({ flashcards: [{ front: '', back: '' }] });

    await expect(generateFlashcardsFromNotes(material, { count: 10 })).rejects.toThrow(
      /no usable cards/i
    );
  });

  it('does not replay pre-cloze cached decks', () => {
    const oldKey = hashAiCacheKey('generate_flashcards', material, {
      count: 10,
      style: 'concise',
    });
    const newKey = hashAiCacheKey('generate_flashcards', material, {
      count: 10,
      style: 'concise',
      promptVersion: 'cloze-1',
    });

    expect(newKey).not.toBe(oldKey);
  });
});
