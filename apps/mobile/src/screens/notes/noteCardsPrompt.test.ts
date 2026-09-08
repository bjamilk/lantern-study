import {
  creditsLeftLine,
  makeCardsConfirmMessage,
  noCreditsLeftMessage,
  type AIUsageSnapshot,
} from './noteCardsPrompt';

const NOW = Date.parse('2026-09-07T17:03:00.000Z');
const usage = (over: Partial<AIUsageSnapshot> = {}): AIUsageSnapshot => ({
  remaining: 71,
  limit: 100,
  used: 29,
  resetsAt: new Date(NOW + 56 * 60 * 1000).toISOString(),
  ...over,
});

describe('creditsLeftLine', () => {
  it('states the balance and when it comes back', () => {
    expect(creditsLeftLine(usage(), NOW)).toBe('71 of 100 AI uses left today · Resets in 56m.');
  });

  it('says nothing at all before a limit has been heard from the server', () => {
    // "0 of 0 AI uses left" would read as an exhausted account on a screen
    // that has simply not loaded yet.
    expect(creditsLeftLine(usage({ limit: 0, remaining: 0, used: 0 }), NOW)).toBe('');
  });

  it('never shows a negative balance', () => {
    expect(creditsLeftLine(usage({ remaining: -3 }), NOW)).toContain('0 of 100');
  });
});

describe('makeCardsConfirmMessage', () => {
  it('prices the action before anything is spent', () => {
    expect(makeCardsConfirmMessage(1, usage(), NOW)).toBe(
      'Costs 1 AI use. 71 of 100 AI uses left today · Resets in 56m.'
    );
  });

  it('pluralises the cost through the shared formatter', () => {
    expect(makeCardsConfirmMessage(3, usage(), NOW)).toContain('Costs 3 AI uses.');
  });

  it('still names the price when the balance is unknown', () => {
    expect(makeCardsConfirmMessage(1, usage({ limit: 0 }), NOW)).toBe('Costs 1 AI use.');
  });
});

describe('noCreditsLeftMessage', () => {
  it('says when the allowance returns rather than "tomorrow"', () => {
    const message = noCreditsLeftMessage(1, usage({ remaining: 0, used: 100 }), NOW);
    expect(message).toBe('Flashcards from a note cost 1 AI use. Resets in 56m.');
    expect(message).not.toContain('tomorrow');
  });
});
