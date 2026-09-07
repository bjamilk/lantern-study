import { AI_CREDIT_COSTS, AI_FEATURE_CREDIT_COST } from '../utils/aiCredits';
import { MAX_FLASHCARD_COUNT, MIN_FLASHCARD_COUNT } from '../utils/flashcardGeneration';
import {
  DEFAULT_FLASHCARD_GENERATION_OPTIONS,
  FLASHCARD_COUNT_PRESETS,
  MIN_GENERATION_SOURCE_LENGTH,
  describeGenerationPlan,
  isPresetCount,
  normalizeGenerationOptions,
  planClozeCount,
  planGenerationRequest,
  previewCard,
} from './generationOptions';

const material = 'Photosynthesis converts light energy into chemical energy stored as glucose.';

describe('generation cost', () => {
  it('charges exactly one AI use, whatever the count or mix', () => {
    for (const count of [MIN_FLASHCARD_COUNT, 20, MAX_FLASHCARD_COUNT, 999]) {
      for (const typeMix of ['basic', 'cloze', 'mixed'] as const) {
        const plan = planGenerationRequest({ count, typeMix }, { notes: material });
        expect(plan.cost).toBe(1);
        expect(plan.cost).toBe(AI_CREDIT_COSTS.generate_flashcards);
        expect(plan.costLabel).toBe('1 AI use');
      }
    }
  });

  it('prices from the same constant the server charges', () => {
    // aiRateLimitForFeature('generate_flashcards') takes AI_FEATURE_CREDIT_COST
    // once per request. If these ever diverge the badge lies about the price.
    expect(AI_CREDIT_COSTS.generate_flashcards).toBe(AI_FEATURE_CREDIT_COST);
  });

  it('says what you get and what it costs in one line', () => {
    const plan = planGenerationRequest({ count: 20, typeMix: 'mixed' }, { notes: material });
    expect(describeGenerationPlan(plan)).toBe('20 cards · 1 AI use');
  });
});

describe('options model', () => {
  it('defaults to 20 mixed cards', () => {
    expect(normalizeGenerationOptions(undefined)).toEqual(DEFAULT_FLASHCARD_GENERATION_OPTIONS);
    expect(normalizeGenerationOptions({})).toEqual({ count: 20, typeMix: 'mixed' });
  });

  it('clamps a custom count to the range the generator honours', () => {
    expect(normalizeGenerationOptions({ count: 1 }).count).toBe(MIN_FLASHCARD_COUNT);
    expect(normalizeGenerationOptions({ count: 250 }).count).toBe(MAX_FLASHCARD_COUNT);
    expect(normalizeGenerationOptions({ count: 23 }).count).toBe(23);
    expect(normalizeGenerationOptions({ count: 22.6 }).count).toBe(23);
  });

  it('falls back rather than throwing on junk', () => {
    expect(normalizeGenerationOptions({ count: 'lots', typeMix: 'sideways' })).toEqual({
      count: 20,
      typeMix: 'mixed',
    });
    expect(normalizeGenerationOptions(null)).toEqual(DEFAULT_FLASHCARD_GENERATION_OPTIONS);
  });

  it('keeps a difficulty steer only when it is one of the three', () => {
    expect(normalizeGenerationOptions({ difficulty: 'hard' }).difficulty).toBe('hard');
    expect(normalizeGenerationOptions({ difficulty: 'brutal' }).difficulty).toBeUndefined();
  });

  it('marks the preset chips', () => {
    for (const preset of FLASHCARD_COUNT_PRESETS) expect(isPresetCount(preset)).toBe(true);
    expect(isPresetCount(23)).toBe(false);
    expect(FLASHCARD_COUNT_PRESETS.every((c) => c >= MIN_FLASHCARD_COUNT && c <= MAX_FLASHCARD_COUNT)).toBe(true);
  });
});

describe('the mix rule', () => {
  it('asks for none, all, or roughly a third', () => {
    expect(planClozeCount(20, 'basic')).toBe(0);
    expect(planClozeCount(20, 'cloze')).toBe(20);
    expect(planClozeCount(20, 'mixed')).toBe(6);
    expect(planClozeCount(30, 'mixed')).toBe(9);
  });

  it('never lets a mixed run come out all one kind', () => {
    for (let count = MIN_FLASHCARD_COUNT; count <= MAX_FLASHCARD_COUNT; count++) {
      const cloze = planClozeCount(count, 'mixed');
      expect(cloze).toBeGreaterThanOrEqual(1);
      expect(cloze).toBeLessThanOrEqual(count - 1);
    }
  });
});

describe('the request body', () => {
  it('carries the count, the mix and the derived cloze target', () => {
    const plan = planGenerationRequest(
      { count: 30, typeMix: 'mixed', difficulty: 'hard' },
      { notes: material, style: 'detailed' }
    );
    expect(plan.ok).toBe(true);
    expect(plan.body).toEqual({
      notes: material,
      count: 30,
      typeMix: 'mixed',
      clozeCount: 9,
      difficulty: 'hard',
      style: 'detailed',
    });
  });

  it('blocks material the server would reject, before spending anything', () => {
    const plan = planGenerationRequest({ count: 10, typeMix: 'basic' }, { notes: 'too short' });
    expect(plan.ok).toBe(false);
    expect(plan.blockedReason).toContain(String(MIN_GENERATION_SOURCE_LENGTH));
    expect(plan.cost).toBe(1);
  });
});

describe('one-card preview', () => {
  const sample = {
    front: 'Mitochondrion',
    back: 'the powerhouse of the cell',
    sentence: 'The mitochondrion is the powerhouse of the cell.',
  };

  it('previews a term card for a basic run', () => {
    expect(previewCard({ typeMix: 'basic' }, sample)).toEqual({
      type: 'BASIC',
      front: 'Mitochondrion',
      back: 'the powerhouse of the cell',
    });
  });

  it('previews the cloze side for cloze and mixed runs', () => {
    for (const typeMix of ['cloze', 'mixed'] as const) {
      const card = previewCard({ typeMix }, sample);
      expect(card.type).toBe('CLOZE');
      expect(card.clozeText).toBe(
        'The mitochondrion is {{c1::the powerhouse of the cell}}.'
      );
      expect(card.front).not.toContain('{{c1::');
      expect(card.front).toContain('_');
      expect(card.back).toBe('the powerhouse of the cell');
    }
  });

  it('still makes a card when the sample has no sentence', () => {
    const card = previewCard({ typeMix: 'cloze' }, { front: 'Osmosis', back: 'water moves' });
    expect(card.clozeText).toContain('{{c1::water moves}}');
  });
});
