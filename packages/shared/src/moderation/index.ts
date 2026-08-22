/**
 * Moderation vocabulary shared by web, mobile and the API (Phase 1 · E —
 * docs/phase1-rights-moderation-contract.md §2): report target types and
 * reasons, the rights attestation every publish flow shows, which listings
 * need it, strike/suspension thresholds and the takedown → appeal state
 * machine. The DB CHECK constraints in
 * supabase/migrations/20260822140000_rights_and_moderation.sql mirror the
 * string unions here — change both together.
 */
import type {
  ContentReportReason,
  ContentReportStatus,
  ContentReportTargetType,
  ListingAppealStatus,
  MarketplaceListing,
} from '../types';

export * from './contentFilter';

// ─── Report targets + reasons ───────────────────────────────────────────────

export const CONTENT_REPORT_TARGET_TYPES: readonly ContentReportTargetType[] = [
  'listing',
  'question_bank',
  'note',
  'deck',
  'user',
  'group',
  'message',
  'dm_message',
  'job_posting',
];

export function isContentReportTargetType(value: unknown): value is ContentReportTargetType {
  return (
    typeof value === 'string' &&
    (CONTENT_REPORT_TARGET_TYPES as readonly string[]).includes(value)
  );
}

export const CONTENT_REPORT_REASONS: readonly ContentReportReason[] = [
  'scam',
  'spam',
  'inappropriate',
  'copyright',
  'leaked_exam',
  'plagiarism',
  'harassment',
  'prohibited_item',
  'wrong_category',
  'discriminatory',
  'other',
];

export function isContentReportReason(value: unknown): value is ContentReportReason {
  return (
    typeof value === 'string' && (CONTENT_REPORT_REASONS as readonly string[]).includes(value)
  );
}

export const REPORT_REASON_LABELS: Record<ContentReportReason, string> = {
  scam: 'Scam or fraud',
  spam: 'Spam or misleading',
  inappropriate: 'Inappropriate content',
  copyright: 'Copyright / not theirs to share',
  leaked_exam: 'Leaked or unreleased exam',
  plagiarism: 'Plagiarism',
  harassment: 'Harassment or bullying',
  prohibited_item: 'Prohibited item or service',
  wrong_category: 'Wrong category',
  discriminatory: 'Discriminatory',
  other: 'Other',
};

export const CONTENT_REPORT_TARGET_LABELS: Record<ContentReportTargetType, string> = {
  listing: 'Listing',
  question_bank: 'Question bank',
  note: 'Note',
  deck: 'Deck',
  user: 'User',
  group: 'Group',
  message: 'Group message',
  dm_message: 'Direct message',
  job_posting: 'Job posting',
};

const REASONS_BY_TARGET: Record<ContentReportTargetType, readonly ContentReportReason[]> = {
  listing: [
    'scam',
    'spam',
    'inappropriate',
    'copyright',
    'leaked_exam',
    'plagiarism',
    'prohibited_item',
    'wrong_category',
    'other',
  ],
  question_bank: [
    'scam',
    'spam',
    'inappropriate',
    'copyright',
    'leaked_exam',
    'plagiarism',
    'prohibited_item',
    'wrong_category',
    'other',
  ],
  note: ['copyright', 'leaked_exam', 'plagiarism', 'inappropriate', 'spam', 'other'],
  deck: ['copyright', 'leaked_exam', 'plagiarism', 'inappropriate', 'spam', 'other'],
  user: ['harassment', 'spam', 'scam', 'inappropriate', 'other'],
  group: ['inappropriate', 'spam', 'scam', 'harassment', 'leaked_exam', 'other'],
  message: ['harassment', 'spam', 'inappropriate', 'scam', 'other'],
  dm_message: ['harassment', 'spam', 'inappropriate', 'scam', 'other'],
  // Mirrors JOB_REPORT_REASONS (../jobs/trust.ts) so old jobs clients keep working.
  job_posting: ['scam', 'spam', 'inappropriate', 'discriminatory', 'other'],
};

/** Reasons a reporter may pick for a given target (drives the report modal + API validation). */
export function reasonsForTarget(targetType: ContentReportTargetType): readonly ContentReportReason[] {
  return REASONS_BY_TARGET[targetType] ?? ['other'];
}

export function isReasonAllowedForTarget(
  targetType: ContentReportTargetType,
  reason: unknown,
): reason is ContentReportReason {
  return isContentReportReason(reason) && reasonsForTarget(targetType).includes(reason);
}

export const CONTENT_REPORT_STATUSES: readonly ContentReportStatus[] = [
  'pending',
  'under_review',
  'resolved',
  'dismissed',
];

export const REPORT_DETAILS_MAX_LENGTH = 1000;

// ─── Admin actions ─────────────────────────────────────────────────────────

export type AdminReportAction = 'dismiss' | 'under_review' | 'warn' | 'remove_content' | 'strike';

export const ADMIN_REPORT_ACTIONS: readonly AdminReportAction[] = [
  'dismiss',
  'under_review',
  'warn',
  'remove_content',
  'strike',
];

export function isAdminReportAction(value: unknown): value is AdminReportAction {
  return typeof value === 'string' && (ADMIN_REPORT_ACTIONS as readonly string[]).includes(value);
}

/**
 * Targets `remove_content` can act on automatically in v1. Messages, DMs,
 * users and job postings have dedicated admin tools; the API answers 400
 * "use the dedicated tool" for them and leaves the report under review.
 */
export const REMOVE_CONTENT_SUPPORTED_TARGETS: readonly ContentReportTargetType[] = [
  'listing',
  'question_bank',
  'note',
  'deck',
  'group',
];

// ─── Rights attestation ────────────────────────────────────────────────────

export const RIGHTS_ATTESTATION_VERSION = '2026-08-22-v1';

/** The sentence both publish flows (question bank + academic listing) show next to the checkbox. */
export const RIGHTS_ATTESTATION_TEXT =
  'I confirm that I created this material or have the right to share and sell it, that it is not a leaked or unreleased exam or assessment, and that it does not infringe anyone else’s copyright. I accept the Seller & Creator Terms.';

export const ATTESTATION_REQUIRED_MESSAGE = 'You must confirm you have the rights to share this content';

/**
 * Listing categories whose content is someone's intellectual work (notes,
 * past questions, projects, textbooks) and therefore needs the rights
 * attestation. Exact ids from the marketplace category constants — a
 * free-text / custom category is never treated as academic.
 */
export const ACADEMIC_LISTING_CATEGORIES: readonly string[] = [
  'pq_bank',
  'lecture_notes',
  'project_thesis',
  'textbook_exchange',
];

/**
 * Whether a listing needs the rights attestation: every digital
 * (question_bank) listing, and any listing in an academic content category.
 * Gate on listing_kind / the exact category id only — never on free text.
 */
export function isAcademicListing(input: {
  listingKind?: MarketplaceListing['listing_kind'] | string | null;
  category?: string | null;
}): boolean {
  if (input.listingKind === 'question_bank') return true;
  const category = typeof input.category === 'string' ? input.category.trim() : '';
  return category.length > 0 && ACADEMIC_LISTING_CATEGORIES.includes(category);
}

export const SOURCES_CITED_MAX = 20;
export const SOURCE_CITATION_MAX_LENGTH = 200;

/**
 * Normalise a client-supplied sources list: strings only, trimmed, empties
 * dropped, at most SOURCES_CITED_MAX entries of SOURCE_CITATION_MAX_LENGTH
 * chars. Returns an error message instead of throwing so both the API (400)
 * and the clients (inline) can use it.
 */
export function normalizeSourcesCited(
  input: unknown,
): { ok: true; value: string[] } | { ok: false; error: string } {
  if (input === undefined || input === null) return { ok: true, value: [] };
  if (typeof input === 'string') {
    return normalizeSourcesCited(input.split(/\r?\n/));
  }
  if (!Array.isArray(input)) {
    return { ok: false, error: 'sourcesCited must be a list of up to 20 short references' };
  }
  const value: string[] = [];
  for (const entry of input) {
    if (typeof entry !== 'string') {
      return { ok: false, error: 'Each source must be text' };
    }
    const trimmed = entry.replace(/[\u0000-\u001F\u007F]/g, '').trim();
    if (!trimmed) continue;
    if (trimmed.length > SOURCE_CITATION_MAX_LENGTH) {
      return { ok: false, error: `Each source must be at most ${SOURCE_CITATION_MAX_LENGTH} characters` };
    }
    value.push(trimmed);
  }
  if (value.length > SOURCES_CITED_MAX) {
    return { ok: false, error: `List at most ${SOURCES_CITED_MAX} sources` };
  }
  return { ok: true, value };
}

// ─── Strikes + suspension ──────────────────────────────────────────────────

/** Active (unexpired) strikes at which the account is suspended automatically. */
export const STRIKE_SUSPENSION_THRESHOLD = 3;
/** Length of the automatic suspension when the threshold is reached. */
export const STRIKE_SUSPENSION_DAYS = 14;
/** A strike stops counting this many days after it was issued. */
export const STRIKE_TTL_DAYS = 180;
/** Longest suspension an admin may set by hand (PATCH /admin/users/:id/status). */
export const MAX_SUSPENSION_DAYS = 365;

export type StrikeSeverity = 1 | 2 | 3;

export function isStrikeSeverity(value: unknown): value is StrikeSeverity {
  return value === 1 || value === 2 || value === 3;
}

/** True when `suspendedUntil` is a valid ISO date in the future. */
export function isSuspensionActive(
  suspendedUntil: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!suspendedUntil || typeof suspendedUntil !== 'string') return false;
  const until = new Date(suspendedUntil);
  if (Number.isNaN(until.getTime())) return false;
  return until.getTime() > now.getTime();
}

export function suspensionMessage(suspendedUntil: string): string {
  const until = new Date(suspendedUntil);
  const label = Number.isNaN(until.getTime())
    ? suspendedUntil
    : until.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return `Account suspended until ${label}`;
}

// ─── Takedown + appeal state machine ───────────────────────────────────────

export const APPEALABLE_LISTING_STATUSES: readonly MarketplaceListing['status'][] = [
  'removed_by_admin',
  'suspended_by_admin',
];

export const APPEAL_NOTE_MAX_LENGTH = 1000;

export const LISTING_APPEAL_STATUS_LABELS: Record<ListingAppealStatus, string> = {
  none: 'No appeal',
  requested: 'Appeal submitted',
  upheld: 'Appeal reviewed — takedown upheld',
  reversed: 'Appeal reviewed — listing restored',
};

/**
 * A seller may appeal once, only while the listing is in a moderated status.
 * Returns the refusal written for the seller, or null when the appeal is allowed.
 */
export function listingAppealRefusal(listing: {
  status: MarketplaceListing['status'] | string;
  appeal_status?: ListingAppealStatus | string | null;
  appealStatus?: ListingAppealStatus | string | null;
}): string | null {
  const appealStatus = listing.appeal_status ?? listing.appealStatus ?? 'none';
  if (!(APPEALABLE_LISTING_STATUSES as readonly string[]).includes(listing.status)) {
    return 'Only a listing that Lantern moderation took down can be appealed.';
  }
  if (appealStatus === 'requested') {
    return 'An appeal is already under review for this listing.';
  }
  if (appealStatus === 'upheld' || appealStatus === 'reversed') {
    return 'This listing has already been through an appeal.';
  }
  return null;
}

export function canAppealListing(listing: Parameters<typeof listingAppealRefusal>[0]): boolean {
  return listingAppealRefusal(listing) === null;
}

export type ListingAppealDecision = 'upheld' | 'reversed';

export function isListingAppealDecision(value: unknown): value is ListingAppealDecision {
  return value === 'upheld' || value === 'reversed';
}
