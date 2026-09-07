/**
 * The two prices the walk-through adds, as the screen states them.
 *
 * Asking a page a question OUT LOUD must cost nothing — it is the same
 * question typed, and typing it is already paid for by the tutor reply that
 * follows. Quizzing yourself on a page costs exactly what quizzing yourself on
 * the whole note costs, and counts against the same cap, so a page scope
 * cannot be used to buy extra generations.
 *
 * Both facts are asserted against the constants the SERVER enforces, not
 * against copy, so a limiter change that contradicts the screen fails here.
 */
import {
  DEFAULT_AI_FEATURE_LIMITS,
  VOICE_ASK_FEATURE_KEY,
  VOICE_ASK_MAX_DURATION_MS,
  ZERO_CREDIT_AI_FEATURES,
  isZeroCreditAIFeature,
} from '../utils/aiUsage';
import { AI_CREDIT_COSTS } from '../utils/aiCredits';
import { AI_COST_SPECS, ZERO_CREDIT_DOORS, buildAIUsageView } from './aiUsageView';

describe('voice_ask is a capped feature that spends nothing', () => {
  it('has its own daily cap and is on the zero-credit list', () => {
    expect(DEFAULT_AI_FEATURE_LIMITS.voice_ask).toBe(40);
    expect(ZERO_CREDIT_AI_FEATURES).toContain(VOICE_ASK_FEATURE_KEY);
    expect(isZeroCreditAIFeature(VOICE_ASK_FEATURE_KEY)).toBe(true);
  });

  it('does not sweep other AI features into the free list', () => {
    expect(isZeroCreditAIFeature('companion')).toBe(false);
    expect(isZeroCreditAIFeature('generate_questions')).toBe(false);
    expect(isZeroCreditAIFeature(undefined)).toBe(false);
    expect(isZeroCreditAIFeature('')).toBe(false);
  });

  it('keeps a spoken question to a clip, so it can stay free', () => {
    // The whole reason voice_ask can cost nothing is that the audio behind it
    // is seconds long. If this cap ever grew to lecture length the pricing
    // decision would have to be revisited, not silently inherited.
    expect(VOICE_ASK_MAX_DURATION_MS).toBeLessThanOrEqual(15_000);
  });
});

describe('the Usage & limits screen states both correctly', () => {
  const snapshot = {
    used: 4,
    limit: 20,
    resetsAt: new Date(Date.now() + 3_600_000).toISOString(),
    features: [{ feature: 'generate_questions', used: 15, limit: 15 }],
  };

  it('lists asking by voice under what costs nothing, with its cap', () => {
    const row = ZERO_CREDIT_DOORS.find((door) => door.id === 'voice_ask');
    expect(row).toBeDefined();
    expect(row?.label).toBe('Ask about a page by voice');
    // The number in the sentence comes from the limiter's constant.
    expect(row?.detail).toContain(String(DEFAULT_AI_FEATURE_LIMITS.voice_ask));

    const view = buildAIUsageView(snapshot);
    expect(view.freeRows.some((free) => free.id === 'voice_ask')).toBe(true);
    expect(view.costRows.some((cost) => cost.id === 'voice_ask')).toBe(false);
  });

  it('prices a page quiz like any other test, on the same cap', () => {
    const spec = AI_COST_SPECS.find((row) => row.id === 'page_quiz');
    expect(spec?.cost).toBe(AI_CREDIT_COSTS.generate_questions);
    expect(spec?.featureKey).toBe('generate_questions');

    // The shared cap is the point: a spent generate_questions budget must
    // close the page door too, or scoping to a page would be a way around it.
    const view = buildAIUsageView(snapshot);
    const row = view.costRows.find((cost) => cost.id === 'page_quiz');
    expect(row?.costLabel).toBe('1 AI use');
    expect(row?.featureCapReached).toBe(true);
    expect(row?.featureCapLabel).toBe('15 of 15 used today');
  });
});
