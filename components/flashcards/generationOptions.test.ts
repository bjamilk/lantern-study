import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FLASHCARD_GENERATION_OPTIONS,
  GENERATION_MAX_COUNT,
  planGenerationRequest,
  previewCard,
} from '@lantern/shared/flashcards';
import { AI_CREDIT_COSTS } from '@lantern/shared/utils/aiCredits';
import {
  PLACEHOLDER_SAMPLE,
  SERVER_MAX_GENERATION_COUNT,
  TYPE_MIX_SUPPORTED,
  clampToServerCount,
  describeCardMix,
  sampleFromNotes,
  supportedCountPresets,
} from './generationOptions';

const NOTES =
  'Osmosis: water moving across a semi-permeable membrane, from low solute to high solute.\nDiffusion: particles spreading from high to low concentration.';

describe('what the sheet may offer', () => {
  it('offers only the counts this server honours today', () => {
    // The server clamps with the same shared constant, so every preset is on
    // offer; a route clamping lower is filtered here, not in shared.
    expect(supportedCountPresets()).toEqual([10, 20, 30]);
    expect(supportedCountPresets(GENERATION_MAX_COUNT)).toEqual([10, 20, 30]);
    expect(supportedCountPresets(20)).toEqual([10, 20]);
  });

  it('clamps a remembered count into what the server honours', () => {
    expect(clampToServerCount(30)).toBe(SERVER_MAX_GENERATION_COUNT);
    expect(clampToServerCount(1)).toBe(10);
    expect(clampToServerCount('twenty')).toBe(20);
  });

  it('does not pretend the type mix is a control while the route ignores it', () => {
    expect(TYPE_MIX_SUPPORTED).toBe(false);
    expect(describeCardMix({ ...DEFAULT_FLASHCARD_GENERATION_OPTIONS, typeMix: 'basic' })).toContain(
      'fill-in-the-blank'
    );
  });

  it('describes the mix with the numbers the request carries', () => {
    expect(describeCardMix({ count: 10, typeMix: 'mixed' })).toContain('About 3 of the 10');
  });
});

describe('the price', () => {
  it('is one AI use at every count the sheet offers', () => {
    for (const count of supportedCountPresets(GENERATION_MAX_COUNT)) {
      const plan = planGenerationRequest({ count, typeMix: 'mixed' }, { notes: NOTES });
      expect(plan.cost).toBe(AI_CREDIT_COSTS.generate_flashcards);
      expect(plan.cost).toBe(1);
      expect(plan.costLabel).toBe('1 AI use');
    }
  });

  it('blocks a run the server would reject, before anything is spent', () => {
    const plan = planGenerationRequest({ count: 20, typeMix: 'mixed' }, { notes: 'too short' });
    expect(plan.ok).toBe(false);
    expect(plan.blockedReason).toContain('at least 50 characters');
  });

  it('carries the style the route reads', () => {
    const plan = planGenerationRequest({ count: 20, typeMix: 'mixed' }, { notes: NOTES, style: 'detailed' });
    expect(plan.body.style).toBe('detailed');
    expect(plan.body.count).toBe(20);
  });
});

describe('the one-card preview', () => {
  it('cuts a term and its definition out of the notes', () => {
    const sample = sampleFromNotes(NOTES);
    expect(sample).toMatchObject({ front: 'Osmosis' });
    expect(sample!.back).toContain('water moving');
  });

  it('reads a question-and-answer line', () => {
    const sample = sampleFromNotes('Q: What is ATP? A: The cell’s energy currency');
    expect(sample).toMatchObject({ front: 'What is ATP?', back: 'The cell’s energy currency' });
  });

  it('falls back to hiding a word in the first real sentence', () => {
    const sample = sampleFromNotes('The citric acid cycle regenerates oxaloacetate every turn.');
    expect(sample!.front).toContain('_____');
    expect(sample!.back).toBe('oxaloacetate');
  });

  it('has nothing to cut from an empty textarea', () => {
    expect(sampleFromNotes('')).toBeNull();
    expect(sampleFromNotes('short')).toBeNull();
  });

  it('feeds a card the shared previewer can render either way', () => {
    const sample = sampleFromNotes(NOTES) ?? PLACEHOLDER_SAMPLE;
    const mixed = previewCard({ count: 20, typeMix: 'mixed' }, sample);
    expect(mixed.type).toBe('CLOZE');
    expect(mixed.clozeText).toContain('{{c1::');
    const basic = previewCard({ count: 20, typeMix: 'basic' }, sample);
    expect(basic).toMatchObject({ type: 'BASIC', front: 'Osmosis' });
  });
});
