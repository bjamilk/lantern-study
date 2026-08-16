/**
 * Preview sanitization for marketplace question banks.
 *
 * A preview must be worth reading and worthless as a substitute for buying:
 * the stem, options and media stay, every answer key is removed. This is an
 * allowlist, not a blocklist — new answer-bearing fields added to the
 * question type later cannot leak by omission.
 */

export const QUESTION_BANK_PREVIEW_LIMIT = 3;

/** Fields a viewer may see before owning the bank. */
const PREVIEW_FIELDS = [
  'id',
  'type',
  'questionType',
  'questionStem',
  'text',
  'options',
  'imageUrl',
  'tags',
  'matchingPromptItems',
  'matchingAnswerItems',
  'diagramLabels',
] as const;

export function sanitizeQuestionForPreview(
  question: unknown
): Record<string, unknown> | null {
  if (!question || typeof question !== 'object') return null;
  const source = question as Record<string, unknown>;
  const preview: Record<string, unknown> = {};
  for (const field of PREVIEW_FIELDS) {
    if (source[field] !== undefined) preview[field] = source[field];
  }
  // Options are {id, text} today, but strip any correctness marker a future
  // shape might add rather than trusting the type to stay narrow.
  if (Array.isArray(preview.options)) {
    preview.options = (preview.options as Array<Record<string, unknown>>).map((option) => {
      if (!option || typeof option !== 'object') return option;
      const { isCorrect, correct, ...rest } = option;
      return rest;
    });
  }
  return preview;
}

export function buildQuestionBankPreview(
  questions: unknown,
  limit = QUESTION_BANK_PREVIEW_LIMIT
): Array<Record<string, unknown>> {
  if (!Array.isArray(questions)) return [];
  return questions
    .slice(0, Math.max(0, limit))
    .map((question) => sanitizeQuestionForPreview(question))
    .filter((question): question is Record<string, unknown> => question !== null);
}
