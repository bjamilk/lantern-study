/**
 * Web glue for the flashcard generation sheet.
 *
 * The model itself — presets, normalisation, the request body, the price and
 * the one-card preview — is Lane A's `@lantern/shared/flashcards`. Web adds
 * only what the shared module cannot know: what THIS server honours today, and
 * how to cut a preview sample out of a textarea.
 *
 * Two live constraints, read off apps/api-server/src/routes/ai.ts,
 * services/aiService.ts and hooks/useFlashcardHandlers.ts:
 *
 *  1. `generateFlashcardsFromNotes` clamps the count with the shared
 *     `normalizeFlashcardCount`, so the ceiling here is the shared one
 *     (`GENERATION_MAX_COUNT`). It stays a separate constant so that if the
 *     route ever clamps lower than shared again, the chips can be filtered
 *     here rather than offering a count the AI use would not buy.
 *  2. The route now reads `typeMix`, but web's generate handler
 *     (`useFlashcardHandlers.handleGenerateFlashcards`) still flattens every
 *     generated card to `{ front, back }` before saving, so a "fill the
 *     blank" run would land as basic cards with blanks on their face rather
 *     than real cloze cards. Until that handler keeps the card type, the sheet
 *     STATES the fixed mix instead of offering a control that half-works.
 */
import {
  FLASHCARD_COUNT_PRESETS,
  GENERATION_MAX_COUNT,
  GENERATION_MIN_COUNT,
  MIXED_CLOZE_RATIO,
  planClozeCount,
  type FlashcardGenerationOptions,
  type PreviewSample,
} from '@lantern/shared/flashcards';

/** Style is the one steer the route honours besides the count. */
export type FlashcardGenerationStyle = 'concise' | 'detailed';

export const STYLE_CHOICES: ReadonlyArray<{
  value: FlashcardGenerationStyle;
  label: string;
  hint: string;
}> = [
  { value: 'concise', label: 'Short answers', hint: 'Brief backs. Faster to review.' },
  { value: 'detailed', label: 'Detailed answers', hint: 'Fuller backs, with an example.' },
];

/**
 * The largest count `POST /ai/generate-flashcards` will actually return today.
 * A measurement of the route, not a preference — the server clamps with the
 * same shared constant, so this follows it; lower it here if the route ever
 * clamps below shared, never raise it ahead of the route.
 */
export const SERVER_MAX_GENERATION_COUNT = GENERATION_MAX_COUNT;

/**
 * True once web's generate handler keeps the card type the route returns.
 * False while `useFlashcardHandlers` saves every card as `{ front, back }`.
 */
export const TYPE_MIX_SUPPORTED = false;

/** The chips the sheet may offer, given what the server honours. */
export function supportedCountPresets(max: number = SERVER_MAX_GENERATION_COUNT): number[] {
  return FLASHCARD_COUNT_PRESETS.filter((n) => n >= GENERATION_MIN_COUNT && n <= max);
}

/** Clamp a remembered or typed count to what the server will honour. */
export function clampToServerCount(count: unknown, max: number = SERVER_MAX_GENERATION_COUNT): number {
  const n = typeof count === 'number' && Number.isFinite(count) ? Math.round(count) : NaN;
  if (Number.isNaN(n)) return Math.min(max, 20);
  return Math.min(max, Math.max(GENERATION_MIN_COUNT, n));
}

/**
 * What the student is about to get, in one sentence.
 *
 * While {@link TYPE_MIX_SUPPORTED} is false this describes the fixed prompt
 * ratio; once the route honours a mix it describes the chosen one. Either way
 * the numbers come from shared's `planClozeCount`, so the sentence and the
 * request can never disagree.
 */
export function describeCardMix(options: FlashcardGenerationOptions): string {
  const count = clampToServerCount(options.count);
  const cloze = TYPE_MIX_SUPPORTED
    ? planClozeCount(count, options.typeMix)
    : planClozeCount(count, 'mixed');
  const basic = count - cloze;
  if (cloze === 0) return `${count} question-and-answer cards.`;
  if (basic === 0) return `${count} fill-in-the-blank cards.`;
  return `About ${cloze} of the ${count} come back as fill-in-the-blank; the other ${basic} are question and answer.`;
}

/** The share of a mixed run that is cloze, for copy that wants the ratio. */
export const CLOZE_SHARE = MIXED_CLOZE_RATIO;

/**
 * Cut a term/definition sample out of pasted notes for `previewCard`.
 *
 * Reads the same shapes the offline fallback in useFlashcardHandlers reads
 * (Q:/A:, `Term: definition`, `Term — definition`), so the example card is one
 * this material could really produce. Returns null when there is nothing to
 * cut yet — the sheet then shows a labelled sample instead of inventing a
 * front out of the student's first three words.
 */
export function sampleFromNotes(notes: string): PreviewSample | null {
  const lines = (notes || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 5);

  for (const line of lines) {
    const qa = line.match(/^(?:Q:\s*|Question:\s*)(.+?)\s*(?:A:\s*|Answer:\s*)(.+)$/i);
    if (qa) return { front: trim(qa[1]!, 80), back: trim(qa[2]!, 160), sentence: trim(line, 200) };

    const colon = line.match(/^([^:]{2,60}):\s+(.+)$/);
    if (colon && colon[1]!.split(/\s+/).length <= 6) {
      return { front: trim(colon[1]!, 80), back: trim(colon[2]!, 160), sentence: trim(line, 200) };
    }

    const dash = line.match(/^([^-–—]{2,60})\s*[-–—]\s+(.+)$/);
    if (dash && dash[1]!.split(/\s+/).length <= 6) {
      return { front: trim(dash[1]!, 80), back: trim(dash[2]!, 160), sentence: trim(line, 200) };
    }
  }

  const sentences = (notes || '')
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 24);
  const first = sentences[0];
  if (!first) return null;

  // No labelled pair anywhere: hide the longest word in the first real
  // sentence, which is what a cloze card off this material would do.
  const words = first.split(/\s+/).filter((w) => w.length > 3);
  if (words.length === 0) return null;
  const hidden = words.reduce((longest, word) => (word.length > longest.length ? word : longest));
  return {
    front: trim(first.replace(hidden, '_____'), 120),
    back: hidden.replace(/[^\w'’-]/g, ''),
    sentence: trim(first, 200),
  };
}

/** The sample shown before there is anything to cut from. */
export const PLACEHOLDER_SAMPLE: PreviewSample = {
  front: 'Osmosis',
  back: 'water moving across a semi-permeable membrane',
  sentence: 'Osmosis is water moving across a semi-permeable membrane.',
};

function trim(value: string, limit: number): string {
  const text = value.trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}
