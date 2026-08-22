/**
 * Pure helpers behind the web rights-attestation / report / suspension UI
 * (Phase 1 · E, docs/phase1-rights-moderation-contract.md §4). Kept free of
 * React and fetch so apps/web/src/moderationForms.test.ts can cover them.
 */
import {
  ATTESTATION_REQUIRED_MESSAGE,
  isAcademicListing,
  normalizeSourcesCited,
  type ListingRightsStatus,
} from '@lantern/shared';

/** The create/edit listing forms keep 'other' for a free-text custom category. */
export function resolveListingCategoryId(subcategory: string, customCategory: string): string {
  return subcategory === 'other' ? `custom:${customCategory.trim()}` : subcategory;
}

/**
 * Whether the listing form must show (and require) the rights checkbox: any
 * academic content category or a digital question bank. A free-text custom
 * category is never academic, so 'other' is always false.
 */
export function listingNeedsAttestation(input: {
  listingKind?: string | null;
  category?: string | null;
}): boolean {
  return isAcademicListing(input);
}

/**
 * Whether the seller still has to tick the box. A listing that was already
 * attested (or cleared by an appeal) keeps its rights state, so an edit that
 * stays in an academic category does not re-prompt.
 */
export function attestationRequiredForEdit(input: {
  listingKind?: string | null;
  category?: string | null;
  rightsStatus?: ListingRightsStatus | string | null;
}): boolean {
  if (!listingNeedsAttestation(input)) return false;
  return input.rightsStatus !== 'attested' && input.rightsStatus !== 'cleared';
}

/** Parse the "one source per line" textarea into the API's sourcesCited list. */
export function parseSourcesCited(
  text: string,
): { ok: true; value: string[] } | { ok: false; error: string } {
  return normalizeSourcesCited(text);
}

/**
 * 400s from create/edit/publish that the seller can fix in the form (missing
 * attestation, blocked wording) are shown inline next to the submit button;
 * everything else keeps going to the toast.
 */
export function isInlineSubmitError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const status = (err as Error & { status?: number }).status;
  if (status === 400) return true;
  return err.message === ATTESTATION_REQUIRED_MESSAGE;
}

/** POST /reports answers 409 when this user already reported the target. */
export function isAlreadyReportedError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const status = (err as Error & { status?: number }).status;
  if (status === 409) return true;
  return /already reported/i.test(err.message);
}

export interface SuspensionBody {
  code?: unknown;
  suspendedUntil?: unknown;
  message?: unknown;
  error?: unknown;
}

/**
 * Read the ACCOUNT_SUSPENDED shape the API puts in a 403 body. Returns null
 * for any other 403 (plain forbidden, banned, etc.).
 */
export function readSuspensionFromBody(
  status: number,
  body: SuspensionBody | null | undefined,
): { suspendedUntil: string | null; message: string } | null {
  if (status !== 403 || !body || body.code !== 'ACCOUNT_SUSPENDED') return null;
  const suspendedUntil = typeof body.suspendedUntil === 'string' ? body.suspendedUntil : null;
  const message =
    (typeof body.message === 'string' && body.message) ||
    (typeof body.error === 'string' && body.error) ||
    'Your account is suspended.';
  return { suspendedUntil, message };
}

/** Human date for the suspension notice; falls back to the raw string. */
export function formatSuspensionDate(suspendedUntil: string | null): string | null {
  if (!suspendedUntil) return null;
  const until = new Date(suspendedUntil);
  if (Number.isNaN(until.getTime())) return suspendedUntil;
  return until.toLocaleDateString(undefined, { dateStyle: 'long' });
}

/** Admin "suspend until" date input → ISO end-of-day, or null when invalid/past. */
export function suspendUntilIso(dateInput: string, now: Date = new Date()): string | null {
  if (!dateInput) return null;
  const until = new Date(`${dateInput}T23:59:59`);
  if (Number.isNaN(until.getTime())) return null;
  if (until.getTime() <= now.getTime()) return null;
  return until.toISOString();
}
