import type { AnswerConfidence, TestSessionKind, UserAnswerRecord } from '../types';

/**
 * Confidence before the reveal (spec §9 #5, founder decision).
 *
 * Asked on PRACTICE attempts only. A timed exam attempt stays plain: a student
 * racing a clock does not need a second decision per question, and an exam that
 * interrupts itself is no longer measuring the thing it was set to measure.
 *
 * Two levels, not five. The useful signal is "did I know this, or did I get
 * lucky" — a five-point scale collects a number nobody can act on and costs a
 * moment of thought on every single question.
 */

export const CONFIDENCE_CHOICES: readonly { id: AnswerConfidence; label: string; hint: string }[] = [
  { id: 'sure', label: 'Sure', hint: 'I know this one' },
  { id: 'unsure', label: 'Not sure', hint: 'Might be a guess' },
];

/** A practice attempt is the one that asks. `test` is the timed exam. */
export function asksForConfidence(sessionKind: TestSessionKind | undefined): boolean {
  return sessionKind === 'study';
}

export type ConfidenceGate =
  /** Not a practice attempt, or nothing committed yet — show nothing. */
  | { state: 'hidden' }
  /** Committed an answer, has not said how sure — ask, and hold the reveal. */
  | { state: 'ask' }
  /** Said how sure. The reveal may proceed. */
  | { state: 'answered'; confidence: AnswerConfidence };

/**
 * What the taking screen should show under the options right now.
 *
 * The gate sits between "I have chosen" and "show me if I was right", which is
 * the only place the question is worth asking: ask it earlier and the student
 * has nothing to be confident about, ask it later and they already know.
 */
export function confidenceGate(input: {
  sessionKind: TestSessionKind | undefined;
  /** Something is selected/typed but not yet graded. */
  hasDraftAnswer: boolean;
  /** The answer has already been graded and the explanation shown. */
  isRevealed: boolean;
  recorded?: AnswerConfidence | null;
}): ConfidenceGate {
  if (!asksForConfidence(input.sessionKind)) return { state: 'hidden' };
  if (input.recorded === 'sure' || input.recorded === 'unsure') {
    return { state: 'answered', confidence: input.recorded };
  }
  if (input.isRevealed) return { state: 'hidden' };
  if (!input.hasDraftAnswer) return { state: 'hidden' };
  return { state: 'ask' };
}

/**
 * May the answer be graded and the explanation shown?
 *
 * `false` while the gate is asking — this is what makes it confidence BEFORE
 * reveal rather than a survey afterwards.
 */
export function canRevealAnswer(gate: ConfidenceGate): boolean {
  return gate.state !== 'ask';
}

/** How the student's own call is echoed back once they can see the outcome. */
export function confidenceOutcomeLabel(
  confidence: AnswerConfidence | undefined | null,
  isCorrect: boolean | undefined
): string | null {
  if (confidence !== 'sure' && confidence !== 'unsure') return null;
  if (isCorrect === undefined) return null;
  if (confidence === 'sure') {
    return isCorrect ? 'You were sure — and right.' : 'You were sure — worth a second look.';
  }
  return isCorrect ? 'You were not sure — and right anyway.' : 'You were not sure, and it was wrong.';
}

/** Read the level off a stored answer, tolerating rows written before it existed. */
export function readConfidence(
  record: UserAnswerRecord | undefined | null
): AnswerConfidence | null {
  const value = record?.confidence;
  return value === 'sure' || value === 'unsure' ? value : null;
}
