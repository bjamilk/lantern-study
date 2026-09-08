/**
 * The limit sentence is the one place a server routing key used to reach a
 * student ("Daily limit reached for this feature (generate_flashcards)"), so
 * the first test here is that no key can ever come out of it again.
 */
import {
  AI_FEATURE_LIMIT_NOUNS,
  aiFeatureLimitNoun,
  describeAIDailyLimitReached,
  describeAIFeatureLimitReached,
  DEFAULT_AI_FEATURE_LIMITS,
} from './aiUsage';

const NOW = Date.parse('2026-09-07T17:00:00.000Z');
const IN_THREE_HOURS = new Date(NOW + 3 * 60 * 60 * 1000 + 12 * 60 * 1000).toISOString();

describe('aiFeatureLimitNoun', () => {
  it('names every feature the server can cap', () => {
    for (const key of Object.keys(DEFAULT_AI_FEATURE_LIMITS)) {
      expect(AI_FEATURE_LIMIT_NOUNS[key]).toBeTruthy();
    }
  });

  it('falls back to plain words for a key it has never seen', () => {
    expect(aiFeatureLimitNoun('some_new_server_feature')).toBe('AI runs');
    expect(aiFeatureLimitNoun(null)).toBe('AI runs');
    expect(aiFeatureLimitNoun(undefined)).toBe('AI runs');
  });
});

describe('describeAIFeatureLimitReached', () => {
  it('states the allowance and when it returns, with no internal key', () => {
    const message = describeAIFeatureLimitReached({
      featureKey: 'generate_flashcards',
      limit: 15,
      resetsAt: IN_THREE_HOURS,
      nowMs: NOW,
    });
    expect(message).toBe("You have used today's 15 flashcard runs. Resets in 3h 12m.");
    expect(message).not.toContain('generate_flashcards');
    expect(message).not.toContain('(');
  });

  it('never prints a feature key, whatever the server sends', () => {
    const message = describeAIFeatureLimitReached({
      featureKey: 'brand_new_key',
      limit: 5,
      resetsAt: IN_THREE_HOURS,
      nowMs: NOW,
    });
    expect(message).not.toContain('brand_new_key');
    expect(message).toContain('AI runs');
  });

  it('says nothing about timing when the server sent no window', () => {
    const message = describeAIFeatureLimitReached({
      featureKey: 'generate_questions',
      limit: 15,
      nowMs: NOW,
    });
    expect(message).toBe("You have used today's 15 test runs.");
    // "Try again tomorrow" was the guess this replaces: the caps roll over at
    // midnight UTC, which is the same afternoon in much of the world.
    expect(message).not.toContain('tomorrow');
  });

  it('drops the timing rather than inventing one for an unparseable stamp', () => {
    const message = describeAIFeatureLimitReached({
      featureKey: 'explain',
      limit: 40,
      resetsAt: 'not-a-date',
      nowMs: NOW,
    });
    expect(message).toBe("You have used today's 40 explanations.");
  });
});

describe('describeAIDailyLimitReached', () => {
  it('states the whole-account allowance and its reset', () => {
    expect(describeAIDailyLimitReached({ limit: 100, resetsAt: IN_THREE_HOURS, nowMs: NOW })).toBe(
      "You have used today's 100 AI uses. Resets in 3h 12m."
    );
  });

  it('never says "try again tomorrow"', () => {
    expect(describeAIDailyLimitReached({ limit: 20, nowMs: NOW })).not.toContain('tomorrow');
  });
});
