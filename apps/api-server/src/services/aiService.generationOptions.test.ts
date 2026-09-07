/**
 * The options sheet's two promises, checked against the generator:
 * the count it offers is the count that is asked for, and the type mix it
 * offers changes the deck. Neither changes the price — the charge is taken by
 * aiRateLimitForFeature before this code runs and does not read the body.
 */
import { AI_CREDIT_COSTS, AI_FEATURE_CREDIT_COST } from '@lantern/shared/utils/aiCredits';
import { MAX_FLASHCARD_COUNT } from '@lantern/shared/utils/flashcardGeneration';
import { generateFlashcardsFromNotes } from './aiService';
import { clearAiResponseCacheForTests, hashAiCacheKey } from './aiResponseCache';

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

const basicCard = { cardType: 'basic', front: 'Define photosynthesis', back: 'Light to sugar.' };
const clozeCard = {
  cardType: 'cloze',
  clozeText: 'Photosynthesis happens in the {{c1::chloroplast}}.',
  front: 'Photosynthesis happens in the _____.',
  back: 'chloroplast',
};

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

describe('count', () => {
  it('asks for the count the sheet offered, up to the shared maximum', async () => {
    mockGroq({ flashcards: [basicCard] });
    await generateFlashcardsFromNotes(material, { count: MAX_FLASHCARD_COUNT });
    expect(systemPrompts[0]).toContain(`Generate exactly ${MAX_FLASHCARD_COUNT} flashcards.`);
  });

  it('clamps an out-of-range count to the same bounds the clients use', async () => {
    mockGroq({ flashcards: [basicCard] });
    await generateFlashcardsFromNotes(material, { count: 250 });
    expect(systemPrompts[0]).toContain(`Generate exactly ${MAX_FLASHCARD_COUNT} flashcards.`);
  });
});

describe('type mix', () => {
  it('asks for no cloze at all when the student picked basic', async () => {
    mockGroq({ flashcards: [basicCard] });
    await generateFlashcardsFromNotes(material, { count: 10, typeMix: 'basic' });
    expect(systemPrompts[0]).toContain('Every card must be "basic"');
  });

  it('asks for every card as cloze when the student picked cloze', async () => {
    mockGroq({ flashcards: [clozeCard] });
    await generateFlashcardsFromNotes(material, { count: 10, typeMix: 'cloze' });
    expect(systemPrompts[0]).toContain('Every one of the 10 cards must be "cloze"');
  });

  it('keeps the ~30% rule for mixed, including when nothing was picked', async () => {
    mockGroq({ flashcards: [basicCard] });
    await generateFlashcardsFromNotes(material, { count: 10, typeMix: 'mixed' });
    expect(systemPrompts[0]).toContain('Exactly 3 of the 10 cards must be "cloze"');

    clearAiResponseCacheForTests();
    mockGroq({ flashcards: [basicCard] });
    await generateFlashcardsFromNotes(material, { count: 10 });
    expect(systemPrompts[0]).toContain('Exactly 3 of the 10 cards must be "cloze"');
  });

  it('downgrades a cloze card the model returned to a basic-only run', async () => {
    mockGroq({ flashcards: [basicCard, clozeCard] });
    const result = await generateFlashcardsFromNotes(material, { count: 10, typeMix: 'basic' });
    expect(result.flashcards.map((c) => c.cardType)).toEqual(['basic', 'basic']);
    expect(result.flashcards[1].clozeText).toBeUndefined();
    // The downgraded card is still reviewable — the blanked sentence and its answer.
    expect(result.flashcards[1].front).toContain('_____');
    expect(result.flashcards[1].back).toBe('chloroplast');
  });

  it('ignores an unknown mix rather than failing the run', async () => {
    mockGroq({ flashcards: [basicCard] });
    await generateFlashcardsFromNotes(material, { count: 10, typeMix: 'sideways' });
    expect(systemPrompts[0]).toContain('Exactly 3 of the 10 cards must be "cloze"');
  });

  it('never replays a cached deck generated for a different mix', () => {
    const mixedKey = hashAiCacheKey('generate_flashcards', material, {
      count: 10,
      style: 'concise',
      typeMix: 'mixed',
      difficulty: undefined,
      promptVersion: 'cloze-2',
    });
    const clozeKey = hashAiCacheKey('generate_flashcards', material, {
      count: 10,
      style: 'concise',
      typeMix: 'cloze',
      difficulty: undefined,
      promptVersion: 'cloze-2',
    });
    expect(mixedKey).not.toBe(clozeKey);
  });
});

describe('price', () => {
  it('is one AI use per run, and the constant the clients print', () => {
    expect(AI_CREDIT_COSTS.generate_flashcards).toBe(1);
    expect(AI_CREDIT_COSTS.generate_flashcards).toBe(AI_FEATURE_CREDIT_COST);
  });
});
