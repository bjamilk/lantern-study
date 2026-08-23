/**
 * Learning events + concepts — shared vocabulary (Phase 1 · C).
 *
 * `learning_events` is the append-only log of what a student did when (card
 * reviewed, question answered, note opened, …). It is PRODUCT data (decision
 * D9): written server-side regardless of the analytics cookie, kept while the
 * account exists, exported and deleted with the account. It is NOT
 * `product_events` (consent-gated, 90-day, anonymous).
 *
 * Shapes are pinned by docs/phase1-learning-events-contract.md §1/§2 — the
 * API (emitters), web and mobile (concept tagging UI in Phase 3) all build
 * against them, so keep the wire names stable.
 */

export const LEARNING_EVENT_TYPES = [
  'card_reviewed',
  'question_shown',
  'question_answered',
  'resource_opened',
  'note_created',
  'card_generated',
  'question_generated',
  'bank_downloaded',
  'bank_score_recorded',
  'pack_downloaded',
  'group_question_posted',
] as const;

export type LearningEventType = (typeof LEARNING_EVENT_TYPES)[number];

export const LEARNING_EVENT_TARGET_TYPES = [
  'flashcard',
  'question',
  'note',
  'deck',
  'listing',
  'group',
  'test_session',
] as const;

export type LearningEventTargetType = (typeof LEARNING_EVENT_TARGET_TYPES)[number];

/** Where the action originated. The API reads `x-lantern-surface` ('web'|'mobile'); anything else is 'api'. */
export const LEARNING_SURFACES = ['web', 'mobile', 'api'] as const;
export type LearningSurface = (typeof LEARNING_SURFACES)[number];

export const LEARNING_SURFACE_HEADER = 'x-lantern-surface';

export const CONCEPT_SOURCES = ['ai', 'user', 'import', 'backfill'] as const;
export type ConceptSource = (typeof CONCEPT_SOURCES)[number];

export const CONCEPT_LINK_TARGET_TYPES = ['flashcard', 'question', 'note', 'deck'] as const;
export type ConceptLinkTargetType = (typeof CONCEPT_LINK_TARGET_TYPES)[number];

/** AI/author-declared difficulty. Stored as `authored_difficulty` — never `difficulty` (that is FSRS state). */
export const AUTHORED_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type AuthoredDifficulty = (typeof AUTHORED_DIFFICULTIES)[number];

/**
 * One row to record. Every id is optional; the server coalesces undefined /
 * empty / non-uuid values to NULL so an emitter never has to pre-validate.
 */
export interface LearningEventInput {
  userId: string;
  eventType: LearningEventType;
  targetType?: LearningEventTargetType | null;
  /** uuid or messages.id text (question ids are text). */
  targetId?: string | null;
  deckId?: string | null;
  groupId?: string | null;
  noteId?: string | null;
  courseId?: string | null;
  sessionId?: string | null;
  listingId?: string | null;
  /** Flashcard grade 1-4 (again/hard/good/easy). */
  rating?: number | null;
  isCorrect?: boolean | null;
  responseMs?: number | null;
  /** Reserved — no capture yet. */
  confidence?: number | null;
  attemptNo?: number | null;
  /** For *_generated: items per call. */
  count?: number | null;
  srsBefore?: unknown;
  srsAfter?: unknown;
  surface?: LearningSurface | null;
  /** ISO timestamp; defaults to now() server-side. Offline replays pass the original review time. */
  occurredAt?: string | null;
}

export const FLASHCARD_RATING_VALUES: Record<'again' | 'hard' | 'good' | 'easy', 1 | 2 | 3 | 4> = {
  again: 1,
  hard: 2,
  good: 3,
  easy: 4,
};

/** again/hard/good/easy → 1-4; anything else → null. */
export function flashcardRatingToNumber(rating: unknown): 1 | 2 | 3 | 4 | null {
  if (typeof rating !== 'string') return null;
  const key = rating.toLowerCase() as keyof typeof FLASHCARD_RATING_VALUES;
  return FLASHCARD_RATING_VALUES[key] ?? null;
}

export const CONCEPT_SLUG_MAX_LENGTH = 80;
export const CONCEPT_NAME_MAX_LENGTH = 120;

/**
 * Normalise a concept name into its slug so equal names collide on one row:
 * trim → lower-case → strip diacritics → any run of non [a-z0-9] becomes a
 * single '-' → trim leading/trailing '-' → cap at CONCEPT_SLUG_MAX_LENGTH.
 * Mirrors the SQL backfill in 20260822150000 (which cannot strip diacritics,
 * so accented tags get a second slug there; acceptable for a one-off).
 * Non-string / empty input returns "".
 */
export function normalizeConceptSlug(raw: unknown): string {
  if (raw == null) return '';
  const folded = String(raw)
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
  const slug = folded.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) return '';
  return slug.length > CONCEPT_SLUG_MAX_LENGTH
    ? slug.slice(0, CONCEPT_SLUG_MAX_LENGTH).replace(/-+$/g, '')
    : slug;
}

/** Tidy a user/AI supplied concept name for storage (whitespace only; case is kept). */
export function normalizeConceptName(raw: unknown): string {
  if (raw == null) return '';
  return String(raw).trim().replace(/\s+/g, ' ').slice(0, CONCEPT_NAME_MAX_LENGTH);
}

export const QUESTION_BANK_BUNDLE_PREFIX = 'qbank-';
export const STUDY_PACK_BUNDLE_PREFIX = 'pack-';
/** Offline-bundle id prefixes for the digital marketplace products. */
export const MARKETPLACE_BUNDLE_PREFIXES = [
  QUESTION_BANK_BUNDLE_PREFIX,
  STUDY_PACK_BUNDLE_PREFIX,
] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a canonical 36-char uuid string. */
export function isUuidLike(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * `test_sessions.config.bundleId` is the string "qbank-<listingId>" for a
 * marketplace question bank and "pack-<listingId>" for a study pack. Returns
 * the listing uuid for either, or null for anything else (other bundle kinds,
 * malformed ids) — so a quiz taken from a purchased pack keeps its listing_id
 * on the learning event, exactly like a question bank.
 */
export function parseQuestionBankListingId(bundleId: unknown): string | null {
  if (typeof bundleId !== 'string') return null;
  const prefix = MARKETPLACE_BUNDLE_PREFIXES.find((p) => bundleId.startsWith(p));
  if (!prefix) return null;
  const listingId = bundleId.slice(prefix.length);
  return isUuidLike(listingId) ? listingId.toLowerCase() : null;
}

/** Clearer alias for {@link parseQuestionBankListingId} — handles both kinds. */
export const parseMarketplaceBundleListingId = parseQuestionBankListingId;
