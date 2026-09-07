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

/**
 * What one plain AI request costs.
 *
 * Every route behind `aiRateLimit` / `aiRateLimitForFeature` charges exactly
 * this against the daily allowance — tutor replies, explanations, study
 * recommendations, flashcard polish, lecture transcription, listing copy. The
 * server reads this constant too (apps/api-server/src/middleware/aiRateLimit.ts),
 * so the number a screen prints and the number a student is charged cannot
 * drift apart.
 */
export const AI_FEATURE_CREDIT_COST = 1;

/** Bounds any single action's charge — protects against a bad env override or request body. */
export const MAX_AI_CREDIT_COST = 10;

export function getSmartNotesCreditCost(depth?: string | null): number {
  if (depth === 'concise' || depth === 'standard' || depth === 'deep') {
    return SMART_NOTES_CREDIT_COST[depth];
  }
  return SMART_NOTES_CREDIT_COST.standard;
}

/**
 * "1 AI use" / "3 AI uses" — the ONE way a price is ever printed.
 *
 * One word for one thing. The app used to say "credits" on a button, "AI uses"
 * in the badge and "requests" in a modal for the same unit, which reads as
 * three different currencies. "AI use" is the word the counter already used,
 * so it is the one that stayed.
 */
export function formatCreditCost(cost: number): string {
  return `${cost} AI use${cost === 1 ? '' : 's'}`;
}

/* ------------------------------------------------ lecture transcription -- */

/**
 * Transcription is the one AI action whose cost depends on how much work it
 * is: a 4-minute voice memo and a 90-minute lecture are not the same request,
 * and charging them the same either gives the long one away or overcharges the
 * short one. The founder's rule is one AI use per 15 minutes recorded, or part
 * of it — so a 16-minute lecture costs 2, and the student is told so before
 * they stop.
 */
export const LECTURE_TRANSCRIPTION_MINUTES_PER_CREDIT = 15;

/** The rule in one line, for the Record door and the pre-flight card. */
export const LECTURE_TRANSCRIPTION_PRICE_RULE = `Transcribing costs ${formatCreditCost(1)} for every ${LECTURE_TRANSCRIPTION_MINUTES_PER_CREDIT} minutes recorded, or part of one.`;

/**
 * Longest recording the server will price from a client-reported duration.
 *
 * The duration arrives in the request body, so it is a claim, not a fact. Past
 * three hours the claim is not credible and is clamped rather than trusted —
 * the provider call is bounded by the audio it actually receives anyway.
 */
export const MAX_LECTURE_TRANSCRIPTION_MS = 3 * 60 * 60 * 1000;

/**
 * What a recording of this length costs to transcribe.
 *
 * Charged by the server and shown by both clients, from this one function.
 * A recording of any length costs at least one — the upload and the provider
 * call happen whether the clip is 3 seconds or 3 minutes — and no single
 * request may exceed `MAX_AI_CREDIT_COST`.
 *
 * "Or part of one" is read strictly: 15:00 is one part and costs 1; 15:01 has
 * started a second and costs 2. Rounding the other way would let a two-hour
 * lecture be sliced into free-ish remainders.
 */
export function getLectureTranscriptionCost(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 1;
  const bounded = Math.min(durationMs, MAX_LECTURE_TRANSCRIPTION_MS);
  // Divided in milliseconds, not minutes: `ms / 60000 / 15` can land a hair
  // above a whole number in binary floating point and bill a clean 30:00 as 3.
  const blocks = Math.ceil(bounded / (LECTURE_TRANSCRIPTION_MINUTES_PER_CREDIT * 60_000));
  return Math.min(MAX_AI_CREDIT_COST, Math.max(1, blocks));
}

/**
 * "About 2 AI uses for this lecture" — the running estimate on the pre-flight
 * card. "About", because the recording has not stopped yet.
 */
export function formatLectureTranscriptionEstimate(durationMs: number): string {
  return `About ${formatCreditCost(getLectureTranscriptionCost(durationMs))} for this lecture`;
}

/* ------------------------------------------------------------ referral -- */

/**
 * The one thing on offer when a student hits zero.
 *
 * The founder's decision (binding): at zero we do NOT sell AI uses. There is
 * no Paystack call anywhere near the Usage & limits screen. What we offer is a
 * referral reward paid in the same unit the meter counts, to both sides, once
 * the invited student actually starts studying — an invite that installs and
 * never opens a deck is worth nothing to anyone.
 *
 * The server grants this amount and reports what is left as `bonusRemaining`
 * on GET /ai/usage. Clients hide the bonus line entirely when that field is
 * absent, rather than printing a zero they did not measure.
 */
export const REFERRAL_BONUS_AI_USES = 5;

/**
 * The most bonus AI uses one account can have BANKED at once.
 *
 * A banked cap, not a lifetime one: spending makes room to earn again. Past it
 * a qualifying referral is still RECORDED in `ai_bonus_grants` with amount 0
 * and a reason, so the ledger never silently loses one.
 *
 * This is the second line of defence, not the first. The real anti-abuse rule
 * is the referral qualification itself — real study events on two distinct
 * calendar days inside a 45-day window (services/referrals.ts) — which no
 * burst of scripted signups can manufacture. The cap only bounds the blast
 * radius if that rule ever turns out to be wrong.
 */
export const REFERRAL_BONUS_AI_USES_CAP = 50;

/**
 * The number the zero-state screen prints, and the number the server grants.
 *
 * Deliberately an alias rather than its own literal: these two had already
 * drifted apart once (a screen promising 3 while the grant paid 5 is the
 * counter lying about money), and one constant cannot drift from itself.
 */
export const REFERRAL_REWARD_AI_USES = REFERRAL_BONUS_AI_USES;

/** "+3 bonus uses" — the extra line under the counter. Never shown at zero. */
export function formatBonusAIUses(bonusRemaining: number | null | undefined): string | null {
  if (typeof bonusRemaining !== 'number' || !Number.isFinite(bonusRemaining)) return null;
  if (bonusRemaining <= 0) return null;
  return `+${bonusRemaining} bonus use${bonusRemaining === 1 ? '' : 's'}`;
}

/* ------------------------------------------------------- read it to me -- */

/**
 * "Read this to me" — a narration script for an uploaded document.
 *
 * There is no video here and no server voice: the server writes a SCRIPT, one
 * narration segment per page, and the DEVICE speaks it (`speechSynthesis` on
 * web, `expo-speech` on mobile). So what is being priced is the writing — one
 * model call per ~4 pages plus one merge pass — not any audio. That is why a
 * whole deck costs less than three tutor replies.
 *
 * Two tiers, because a 6-page handout and a 38-page lecture deck are not the
 * same amount of writing:
 *   ≤ 20 pages → 2 AI uses
 *   21 pages and up → 3 AI uses
 *
 * Charged ONCE per document, whatever the student does with it afterwards:
 * playing it again, skipping pages, or listening offline costs nothing, and a
 * retry of a run already paid for is not charged again (the script row is
 * idempotent per attachment, user and version).
 */
export const NARRATION_CREDIT_COST = 2;

/** From 21 pages up. Still one action, still charged once. */
export const NARRATION_LONG_CREDIT_COST = 3;

/** The boundary between the two tiers. */
export const NARRATION_SHORT_MAX_PAGES = 20;

/**
 * The most pages one narration run reads.
 *
 * A longer document is not refused — it is read up to here and the student is
 * told where the reading stops, which is what `formatNarrationPrice` prints.
 * Refusing a 60-page deck outright would leave a student with nothing; reading
 * the first 40 pages for the same 3 uses leaves them with most of a lecture.
 */
export const MAX_NARRATION_PAGES = 40;

/** How many pages this run will actually read, given what the document has. */
export function narratedPageCount(pageCount: number): number {
  if (!Number.isFinite(pageCount)) return 0;
  return Math.max(0, Math.min(MAX_NARRATION_PAGES, Math.floor(pageCount)));
}

/**
 * What reading this document aloud costs.
 *
 * Total by construction: `aiRateLimitWithCost` reads a cost synchronously and
 * has no way to handle a thrown refusal, so an unknown or absurd page count
 * must still price at something chargeable. An unknown count (0, negative,
 * NaN, Infinity) prices at the cheap tier — the run is refused before it is
 * charged when there are genuinely no pages, and quoting the expensive tier for
 * a count we never measured would overcharge a one-page handout.
 */
export function getNarrationCreditCost(pageCount: number): number {
  if (!Number.isFinite(pageCount)) return NARRATION_CREDIT_COST;
  const pages = Math.floor(pageCount);
  if (pages <= 0) return NARRATION_CREDIT_COST;
  const cost =
    pages <= NARRATION_SHORT_MAX_PAGES ? NARRATION_CREDIT_COST : NARRATION_LONG_CREDIT_COST;
  return Math.min(MAX_AI_CREDIT_COST, cost);
}

/**
 * "3 AI uses — covers up to 40 pages" — the pre-flight line on the Read-aloud
 * door, where the page count IS known.
 *
 * The second half is the honest part: a 120-page book prices at 3 and says so,
 * rather than letting a student believe the whole book will be read.
 */
export function formatNarrationPrice(pageCount: number): string {
  const covered = narratedPageCount(pageCount);
  return `${formatCreditCost(getNarrationCreditCost(pageCount))} — covers up to ${covered} page${covered === 1 ? '' : 's'}`;
}

/** Why a document cannot be read aloud at all, when it cannot. */
export const NARRATION_NO_PAGES_MESSAGE =
  'This document has not been split into pages yet, so there is nothing to read aloud.';
