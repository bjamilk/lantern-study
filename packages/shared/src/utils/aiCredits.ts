import type { SmartNotesDepth } from './smartNotes';

/**
 * Global daily AI credits consumed per user action.
 * Single source of truth: the server charges these amounts and the clients
 * display them — if they ever diverge, the counter lies to students.
 */
export const SMART_NOTES_CREDIT_COST: Record<SmartNotesDepth, number> = {
  concise: 1,
  standard: 1,
  // Deep dive runs up to 10 chunk extractions + a long-context merge + a
  // critique pass (~12 provider calls on a long source).
  deep: 3,
};

export const AI_CREDIT_COSTS = {
  generate_flashcards: 1,
  generate_questions: 1,
  note_ocr: 2,
} as const;

/** Bounds any single action's charge — protects against a bad env override or request body. */
export const MAX_AI_CREDIT_COST = 10;

export function getSmartNotesCreditCost(depth?: string | null): number {
  if (depth === 'concise' || depth === 'standard' || depth === 'deep') {
    return SMART_NOTES_CREDIT_COST[depth];
  }
  return SMART_NOTES_CREDIT_COST.standard;
}

/** "1 credit" / "3 credits" */
export function formatCreditCost(cost: number): string {
  return `${cost} credit${cost === 1 ? '' : 's'}`;
}
