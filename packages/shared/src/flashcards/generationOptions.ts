/**
 * The flashcard generation options model — one source of truth for the
 * options sheet on web and mobile, the request the server receives, and the
 * price the student is shown before they spend anything.
 *
 * The rule that matters most here: a generation run costs ONE AI use however
 * many cards it makes. Ten cards and thirty cards are the same single request
 * to the provider, and the server charges a flat feature credit
 * (`aiRateLimitForFeature`), so a screen that priced by card count would be
 * lying. `planGenerationRequest` returns that cost with the body so the two
 * can never drift.
 */

import {
  AI_CREDIT_COSTS,
  AI_FEATURE_CREDIT_COST,
  formatCreditCost,
} from '../utils/aiCredits';
import {
  MAX_FLASHCARD_COUNT,
  MIN_FLASHCARD_COUNT,
  normalizeFlashcardCount,
} from '../utils/flashcardGeneration';

/**
 * Re-exported under names that say where the bound comes from, so a screen can
 * label a custom-count field without also star-importing `utils`.
 * (The originals stay in `utils/flashcardGeneration` — one declaration, two
 * doors.)
 */
export const GENERATION_MIN_COUNT = MIN_FLASHCARD_COUNT;
export const GENERATION_MAX_COUNT = MAX_FLASHCARD_COUNT;

/** Which kinds of card a run may produce. */
export type FlashcardTypeMix = 'basic' | 'cloze' | 'mixed';

export const FLASHCARD_TYPE_MIXES: readonly FlashcardTypeMix[] = ['basic', 'cloze', 'mixed'];

/** Optional difficulty steer; absent means "let the material decide". */
export type FlashcardGenerationDifficulty = 'easy' | 'medium' | 'hard';

export const FLASHCARD_DIFFICULTIES: readonly FlashcardGenerationDifficulty[] = [
  'easy',
  'medium',
  'hard',
];

/**
 * The counts on the sheet. Anything else is a custom count, still bounded by
 * MIN/MAX because the server clamps to the same range — offering 250 like
 * StudyFetch would print a number the generator cannot honour.
 */
export const FLASHCARD_COUNT_PRESETS: readonly number[] = [10, 20, 30];

/**
 * Share of a mixed run that should be cloze. Matches the server's own target
 * ratio; exported so the prompt and the preview agree.
 */
export const MIXED_CLOZE_RATIO = 0.3;

/**
 * The server refuses material shorter than this (`/ai/generate-flashcards`
 * answers 400). Clients hold the button rather than spend the round trip.
 */
export const MIN_GENERATION_SOURCE_LENGTH = 50;

export interface FlashcardGenerationOptions {
  count: number;
  typeMix: FlashcardTypeMix;
  difficulty?: FlashcardGenerationDifficulty;
}

export const DEFAULT_FLASHCARD_GENERATION_OPTIONS: FlashcardGenerationOptions = {
  count: 20,
  typeMix: 'mixed',
};

/** True when `count` is one of the preset chips rather than a custom number. */
export function isPresetCount(count: number): boolean {
  return FLASHCARD_COUNT_PRESETS.includes(count);
}

export function isFlashcardTypeMix(value: unknown): value is FlashcardTypeMix {
  return typeof value === 'string' && (FLASHCARD_TYPE_MIXES as readonly string[]).includes(value);
}

/**
 * Coerce anything (remembered settings, a request body, a deep link) into a
 * usable options object. Never throws: a broken value falls back to the
 * default rather than blocking a generation.
 */
export function normalizeGenerationOptions(
  raw: Partial<FlashcardGenerationOptions> | Record<string, unknown> | null | undefined
): FlashcardGenerationOptions {
  const record = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<
    string,
    unknown
  >;
  const countRaw = typeof record.count === 'number' ? record.count : Number(record.count);
  const count = Number.isFinite(countRaw)
    ? normalizeFlashcardCount(Math.round(countRaw))
    : DEFAULT_FLASHCARD_GENERATION_OPTIONS.count;
  const typeMix = isFlashcardTypeMix(record.typeMix)
    ? record.typeMix
    : DEFAULT_FLASHCARD_GENERATION_OPTIONS.typeMix;
  const difficulty =
    typeof record.difficulty === 'string' &&
    (FLASHCARD_DIFFICULTIES as readonly string[]).includes(record.difficulty)
      ? (record.difficulty as FlashcardGenerationDifficulty)
      : undefined;
  return difficulty ? { count, typeMix, difficulty } : { count, typeMix };
}

/**
 * How many of the run's cards should be cloze.
 *
 * The mix rule: `basic` asks for none, `cloze` asks for all, and `mixed` asks
 * for roughly {@link MIXED_CLOZE_RATIO} of them — but never zero and never all,
 * because a "mixed" deck of one kind is the one outcome the option promised
 * not to produce.
 */
export function planClozeCount(count: number, typeMix: FlashcardTypeMix): number {
  const total = normalizeFlashcardCount(count);
  if (typeMix === 'basic') return 0;
  if (typeMix === 'cloze') return total;
  const target = Math.round(total * MIXED_CLOZE_RATIO);
  return Math.min(total - 1, Math.max(1, target));
}

/** The body `/ai/generate-flashcards` receives. */
export interface FlashcardGenerationRequestBody {
  notes: string;
  count: number;
  typeMix: FlashcardTypeMix;
  /** Derived, sent so the server does not have to re-derive the mix rule. */
  clozeCount: number;
  difficulty?: FlashcardGenerationDifficulty;
  style?: 'concise' | 'detailed';
}

export interface FlashcardGenerationSource {
  /** The material itself. */
  notes: string;
  style?: 'concise' | 'detailed';
}

export interface FlashcardGenerationPlan {
  ok: boolean;
  /** Why the run cannot start, in plain words. Null when it can. */
  blockedReason: string | null;
  body: FlashcardGenerationRequestBody;
  /** AI uses this run spends. Always 1 — see the module note. */
  cost: number;
  /** "1 AI use" — the only way this price is ever printed. */
  costLabel: string;
}

/**
 * Turn options plus material into the exact request and its price.
 *
 * The cost is read from the shared constant rather than computed from `count`
 * on purpose: if a future server change ever charged per card, this assertion
 * would be the thing that breaks, not the student's balance.
 */
export function planGenerationRequest(
  options: Partial<FlashcardGenerationOptions> | null | undefined,
  source: FlashcardGenerationSource
): FlashcardGenerationPlan {
  const normalized = normalizeGenerationOptions(options);
  const notes = typeof source?.notes === 'string' ? source.notes : '';
  const trimmed = notes.trim();
  const blockedReason =
    trimmed.length < MIN_GENERATION_SOURCE_LENGTH
      ? `Add at least ${MIN_GENERATION_SOURCE_LENGTH} characters of material to make cards from.`
      : null;

  const cost = AI_CREDIT_COSTS.generate_flashcards;

  return {
    ok: blockedReason === null,
    blockedReason,
    body: {
      notes,
      count: normalized.count,
      typeMix: normalized.typeMix,
      clozeCount: planClozeCount(normalized.count, normalized.typeMix),
      ...(normalized.difficulty ? { difficulty: normalized.difficulty } : {}),
      ...(source?.style ? { style: source.style } : {}),
    },
    cost,
    costLabel: formatCreditCost(cost),
  };
}

/** One line under the sheet's button: what you get and what it costs. */
export function describeGenerationPlan(plan: FlashcardGenerationPlan): string {
  const cards = plan.body.count === 1 ? '1 card' : `${plan.body.count} cards`;
  return `${cards} · ${plan.costLabel}`;
}

/* -------------------------------------------------------------- preview -- */

export interface PreviewSample {
  /** A term or question from the material. */
  front: string;
  /** Its answer. */
  back: string;
  /** A full sentence the cloze preview can hide words inside. */
  sentence?: string;
}

export interface PreviewCard {
  type: 'BASIC' | 'CLOZE';
  front: string;
  back: string;
  clozeText?: string;
}

/**
 * The one card the sheet shows before spending anything.
 *
 * It is a shape preview, not a prediction: it says what a card of this mix
 * will look like, built from a sample the caller already has (the first line
 * of the note, an existing card). `mixed` previews the cloze side, because
 * that is the half students do not expect.
 */
export function previewCard(
  options: Partial<FlashcardGenerationOptions> | null | undefined,
  sample: PreviewSample
): PreviewCard {
  const { typeMix } = normalizeGenerationOptions(options);
  const front = (sample?.front ?? '').trim();
  const back = (sample?.back ?? '').trim();

  if (typeMix === 'basic') {
    return { type: 'BASIC', front, back };
  }

  const sentence = (sample?.sentence ?? '').trim() || (front && back ? `${front} — ${back}` : front);
  const hidden = back || front;
  const clozeText = sentence.includes(hidden)
    ? sentence.replace(hidden, `{{c1::${hidden}}}`)
    : `${sentence} {{c1::${hidden}}}`;

  return {
    type: 'CLOZE',
    front: clozeText.replace(/\{\{c\d+::(.*?)\}\}/g, (_m, span: string) => '_'.repeat(Math.min(12, Math.max(5, span.length)))),
    back: hidden,
    clozeText,
  };
}

/** The counter's own sanity check, asserted in tests: one run, one AI use. */
export const GENERATION_RUN_COST = AI_CREDIT_COSTS.generate_flashcards;

/** Kept next to the cost so a divergence fails a test rather than a student. */
export const GENERATION_RUN_COST_MATCHES_FEATURE_CHARGE =
  AI_CREDIT_COSTS.generate_flashcards === AI_FEATURE_CREDIT_COST;
