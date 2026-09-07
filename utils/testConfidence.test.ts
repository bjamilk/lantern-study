import { describe, expect, it } from 'vitest';
import {
  CONFIDENCE_CHOICES,
  asksForConfidence,
  canRevealAnswer,
  confidenceGate,
  confidenceOutcomeLabel,
  readConfidence,
} from './testConfidence';

describe('asksForConfidence', () => {
  it('asks on practice and never on a timed exam attempt', () => {
    // Founder decision, spec §9 #5.
    expect(asksForConfidence('study')).toBe(true);
    expect(asksForConfidence('test')).toBe(false);
    expect(asksForConfidence(undefined)).toBe(false);
  });
});

describe('confidenceGate', () => {
  const base = { hasDraftAnswer: true, isRevealed: false, recorded: null as null };

  it('holds the reveal once an answer is committed on a practice attempt', () => {
    const gate = confidenceGate({ sessionKind: 'study', ...base });
    expect(gate.state).toBe('ask');
    expect(canRevealAnswer(gate)).toBe(false);
  });

  it('asks nothing before anything is committed', () => {
    expect(
      confidenceGate({ sessionKind: 'study', ...base, hasDraftAnswer: false }).state
    ).toBe('hidden');
  });

  it('never interrupts an exam attempt', () => {
    const gate = confidenceGate({ sessionKind: 'test', ...base });
    expect(gate.state).toBe('hidden');
    expect(canRevealAnswer(gate)).toBe(true);
  });

  it('lets the reveal through once the student has said how sure', () => {
    const gate = confidenceGate({ sessionKind: 'study', ...base, recorded: 'unsure' });
    expect(gate).toEqual({ state: 'answered', confidence: 'unsure' });
    expect(canRevealAnswer(gate)).toBe(true);
  });

  it('does not re-ask about an answer that is already revealed', () => {
    // A question graded before confidence existed must not be blocked behind a
    // question it can no longer honestly answer.
    expect(
      confidenceGate({ sessionKind: 'study', ...base, isRevealed: true }).state
    ).toBe('hidden');
  });
});

describe('confidenceOutcomeLabel', () => {
  it('names the sure-but-wrong case as the one to look at', () => {
    expect(confidenceOutcomeLabel('sure', false)).toMatch(/second look/);
  });

  it('reads back the other three combinations', () => {
    expect(confidenceOutcomeLabel('sure', true)).toMatch(/and right/);
    expect(confidenceOutcomeLabel('unsure', true)).toMatch(/right anyway/);
    expect(confidenceOutcomeLabel('unsure', false)).toMatch(/it was wrong/);
  });

  it('says nothing when confidence was never asked or nothing is graded yet', () => {
    expect(confidenceOutcomeLabel(null, true)).toBe(null);
    expect(confidenceOutcomeLabel('sure', undefined)).toBe(null);
  });
});

describe('readConfidence', () => {
  it('tolerates rows written before confidence existed', () => {
    expect(readConfidence(undefined)).toBe(null);
    expect(readConfidence({ questionId: 'a' })).toBe(null);
    expect(readConfidence({ questionId: 'a', confidence: 'maybe' } as never)).toBe(null);
    expect(readConfidence({ questionId: 'a', confidence: 'sure' })).toBe('sure');
  });
});

describe('CONFIDENCE_CHOICES', () => {
  it('offers two levels, each with a label and a hint', () => {
    expect(CONFIDENCE_CHOICES.map((c) => c.id)).toEqual(['sure', 'unsure']);
    for (const choice of CONFIDENCE_CHOICES) {
      expect(choice.label.length).toBeGreaterThan(0);
      expect(choice.hint.length).toBeGreaterThan(0);
    }
  });
});
