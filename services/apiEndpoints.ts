/**
 * The few endpoints web calls through the SHARED api client.
 *
 * Web hand-writes most of its fetch layer (services/supabase.ts), which is
 * fine for reads. It is not fine for the writes that file generated work: the
 * deck-and-cards save carries an idempotency key, a 20s timeout for decks with
 * hundreds of cards, and a body shape the server validates strictly — and web
 * having its own copy of all that is exactly how the two clients drifted, with
 * mobile saving a generation in one atomic request while web still created a
 * deck and then pushed cards one at a time.
 *
 * So these two come from packages/shared/src/api/endpoints.ts, the same
 * definitions apps/mobile uses. The client underneath is web's: web's auth
 * headers, web's cookie credentials, and the `X-Requested-With` header the
 * server's CSRF middleware demands on every cookie-authenticated write.
 */
import { createApiClient, createApiEndpoints } from '@lantern/shared/api';
import type { NoteAttachmentPage } from '@lantern/shared/types';
import type {
  NarrationScriptSegment,
  NarrationScriptStatus,
  NarrationUnavailableReason,
} from '@lantern/shared/notes/narration';
import { pollApiJob, type ApiJobProgress } from './jobPoll';
import { getApiRoot, getAuthHeaders, withApiCredentials } from './supabase';
import { isCookieAuthEnabled } from './authCookieSession';

const client = createApiClient({
  // The shared client appends `/api/v1` itself.
  getBaseUrl: () => getApiRoot(),
  getAuthHeaders: async () => ({
    ...(await getAuthHeaders()),
    // Phase 1 C: the server stamps learning_events.surface from this.
    'X-Lantern-Surface': 'web',
  }),
  // Cookie-auth mode sends the session cookie; token mode must NOT, or the
  // browser attaches credentials to a cross-origin API it has none for.
  ...(isCookieAuthEnabled() ? { credentials: 'include' as const } : {}),
});

const endpoints = createApiEndpoints(client);

/**
 * Create a deck AND its cards in one request, keyed on the generating job.
 *
 * Either both land or neither does, and a retry under the same key replays the
 * first response rather than creating a second deck.
 */
export const createDeckWithCards = endpoints.createDeckWithCards;

/**
 * Save generated questions as a launchable personal test.
 *
 * `sourceJobId` is what lets the server stamp the test onto the job record, so
 * a reload — or another device — can be told where the quiz went.
 */
export const createPersonalTest = endpoints.createPersonalTest;

/**
 * One page of an uploaded document, plus why the server had (or had not) any.
 *
 * `reason` is not decoration: a document uploaded before the page model
 * existed comes back `schema_missing` with no pages, and a walk-through that
 * treated that as an error would tell students their file was broken. See
 * `@lantern/shared/notes/walkthroughCopy` for the wording each state gets —
 * the same module mobile reads, so the two clients cannot drift again.
 */
export interface NoteAttachmentPagesResult {
  attachmentId: string;
  available: boolean;
  reason: 'ok' | 'schema_missing' | 'unsupported' | 'source_missing' | 'preview_pending' | 'unreadable';
  pageCount: number;
  /** The server's page ceiling, so the screen can say what was left out. */
  maxPages: number;
  pages: NoteAttachmentPage[];
}

/**
 * Read a document's pages (`GET /notes/:noteId/attachments/:attachmentId/pages`).
 *
 * `images: true` asks the server to render any page pictures it is missing
 * before answering — slower, and only worth it for the page viewer. The plan
 * panel needs headings alone, so it omits the flag.
 *
 * `imageUrl` on a returned page is a short-lived signed URL. It is fetched
 * fresh with the pages and must never be cached past this response.
 */
export async function fetchNoteAttachmentPages(
  noteId: string,
  attachmentId: string,
  options?: { images?: boolean; signal?: AbortSignal }
): Promise<NoteAttachmentPagesResult> {
  const query = options?.images ? '?images=1' : '';
  const response = await fetch(
    `${getApiRoot()}/api/v1/notes/${encodeURIComponent(noteId)}/attachments/${encodeURIComponent(attachmentId)}/pages${query}`,
    withApiCredentials({
      method: 'GET',
      headers: await getAuthHeaders(),
      signal: options?.signal,
    })
  );

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    // The STATUS and the BODY ride along; the server's sentence does not reach
    // the screen. It used to: this throw carried `body.error` verbatim, and a
    // server without the pages route answers
    // "Not found - /api/v1/notes/<uuid>/attachments/<uuid>/pages?images=1",
    // which the walk-through then printed at the student. `pagesUnavailableCopy`
    // reads `status` (404 → "not split into pages yet", no retry) and `body`
    // (a `reason` the server named), and writes the sentence itself. The
    // message below is a developer's line for a console, never a student's.
    const error = new Error(
      `Note attachment pages request failed (${response.status})`
    ) as Error & { status?: number; body?: unknown };
    error.status = response.status;
    error.body = body;
    throw error;
  }

  const data = (body?.data ?? body) as Partial<NoteAttachmentPagesResult>;
  const pages = Array.isArray(data.pages) ? data.pages : [];
  return {
    attachmentId,
    available: data.available !== false,
    reason: data.reason ?? 'ok',
    pageCount: typeof data.pageCount === 'number' ? data.pageCount : pages.length,
    maxPages: typeof data.maxPages === 'number' ? data.maxPages : pages.length,
    pages,
  };
}

/* ------------------------------------------------------- read it to me -- */

/**
 * A whole narrated deck in one response: the script the device speaks, plus
 * this document's page pictures signed in the same batch.
 *
 * One request, because that is what a client caches to play offline. The
 * signed URLs expire, and `imageUrlExpiresIn` says when — a stored deck is
 * refreshed by calling the route again, never by holding a frozen URL, which
 * is the bug that killed chat and board photos after 24 hours.
 *
 * Mirrors `NarrationBundle` in apps/api-server/src/services/narrationService.
 */
export interface NarrationBundle {
  attachmentId: string;
  /** The SCRIPT's state on the server, not the player's. */
  status: NarrationScriptStatus;
  version: number;
  /** How many pages the server actually read — never how many the file has. */
  pageCount: number;
  segments: NarrationScriptSegment[];
  /** Estimated length of the whole deck at a normal reading pace. */
  estimatedSeconds: number;
  /** What this script was charged. Read back, never re-derived for display. */
  creditCost: number;
  jobId: string | null;
  errorMessage: string | null;
  createdAt?: string;
  pages: Array<{ pageIndex: number; imageUrl?: string }>;
  /** Seconds until the signed image URLs stop working. */
  imageUrlExpiresIn: number;
}

/**
 * What the narration routes answer with.
 *
 * `script: null` with `available: true` is the ordinary "nobody has had this
 * read out yet" state, not a failure. `available: false` means the
 * hand-applied migration is not in this environment — the same honest
 * degradation the pages route uses.
 */
export interface NarrationScriptResult {
  attachmentId: string;
  available: boolean;
  reason: 'ok' | NarrationUnavailableReason;
  /** The server's page ceiling, so the door can say where reading stops. */
  maxPages?: number;
  script: NarrationBundle | null;
  /** The POST returned a script that already existed. Nothing was charged. */
  reused?: boolean;
  /** The document is longer than `maxPages` and was read up to it. */
  truncated?: boolean;
  message?: string;
}

function narrationPath(noteId: string, attachmentId: string): string {
  return `${getApiRoot()}/api/v1/notes/${encodeURIComponent(noteId)}/attachments/${encodeURIComponent(
    attachmentId
  )}/narration`;
}

const SCRIPT_STATUSES: ReadonlySet<string> = new Set(['queued', 'generating', 'ready', 'failed']);

/**
 * The server sends the deck FLAT on `data` — `status`, `segments`, `pages`,
 * `pageCount` and the rest sit beside `available` and `reason`, because that is
 * the one object both clients store for offline play (see
 * `narrationApiPayload` in apps/api-server/src/services/narrationService.ts).
 * A document nobody has narrated is `status: null` with reason
 * `not_generated`. This folds that flat shape into the `script` the player
 * reads; a nested `script` is still honoured so a stored copy in the older
 * shape keeps working.
 */
function scriptFromFlatPayload(
  attachmentId: string,
  data: Record<string, unknown>
): NarrationBundle | null {
  if (data.script && typeof data.script === 'object') return data.script as NarrationBundle;
  const status = typeof data.status === 'string' && SCRIPT_STATUSES.has(data.status) ? data.status : null;
  if (!status) return null;
  const segments = Array.isArray(data.segments) ? (data.segments as NarrationScriptSegment[]) : [];
  const pages = Array.isArray(data.pages)
    ? (data.pages as Array<{ pageIndex: number; imageUrl?: string }>)
    : [];
  return {
    attachmentId,
    status: status as NarrationScriptStatus,
    version: typeof data.version === 'number' ? data.version : 1,
    pageCount:
      typeof data.pageCount === 'number'
        ? data.pageCount
        : new Set(segments.map((segment) => segment.pageIndex)).size,
    segments,
    estimatedSeconds: typeof data.estimatedSeconds === 'number' ? data.estimatedSeconds : 0,
    creditCost: typeof data.creditCost === 'number' ? data.creditCost : 0,
    jobId: typeof data.jobId === 'string' ? data.jobId : null,
    errorMessage: typeof data.errorMessage === 'string' ? data.errorMessage : null,
    createdAt:
      typeof data.generatedAt === 'string'
        ? data.generatedAt
        : typeof data.createdAt === 'string'
          ? data.createdAt
          : undefined,
    pages,
    imageUrlExpiresIn: typeof data.imageUrlExpiresIn === 'number' ? data.imageUrlExpiresIn : 0,
  };
}

function normalizeNarrationResult(
  attachmentId: string,
  body: unknown
): NarrationScriptResult {
  const envelope = (body ?? {}) as { data?: unknown };
  const data = (envelope.data ?? body ?? {}) as Record<string, unknown>;
  const script = scriptFromFlatPayload(attachmentId, data);
  const reason = typeof data.reason === 'string' ? data.reason : 'ok';
  return {
    attachmentId,
    available: data.available !== false,
    // A failed run comes back as `unreadable` with the script's own status
    // carrying the detail; the player reads the status, so the reason folds
    // to the failed branch it already knows.
    reason: (reason === 'unreadable' && script?.status === 'failed' ? 'failed' : reason) as
      | 'ok'
      | NarrationUnavailableReason,
    maxPages: typeof data.maxPages === 'number' ? data.maxPages : undefined,
    script,
    reused: data.reused === true,
    truncated: data.truncated === true,
    message: typeof data.message === 'string' ? data.message : undefined,
  };
}

function narrationError(body: unknown, status: number, fallback: string): Error {
  const shaped = (body ?? {}) as { error?: unknown; message?: unknown };
  if (typeof shaped.error === 'string' && shaped.error) return new Error(shaped.error);
  if (typeof shaped.message === 'string' && shaped.message) return new Error(shaped.message);
  return new Error(`${fallback} (${status}).`);
}

/**
 * Read the deck a document already has
 * (`GET /notes/:noteId/attachments/:attachmentId/narration`).
 *
 * Free and unmetered — replaying a script the student has already paid for
 * costs nothing and runs no AI — so a player opening for the tenth time must
 * come here and never near the POST.
 */
export async function fetchNarrationScript(
  noteId: string,
  attachmentId: string,
  options?: { images?: boolean; signal?: AbortSignal }
): Promise<NarrationScriptResult> {
  // The server includes images unless asked not to; `images=0` is for a caller
  // that only wants to know whether a script exists.
  const query = options?.images === false ? '?images=0' : '';
  const response = await fetch(
    `${narrationPath(noteId, attachmentId)}${query}`,
    withApiCredentials({
      method: 'GET',
      headers: await getAuthHeaders(),
      signal: options?.signal,
    })
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw narrationError(body, response.status, 'Could not load this narration');
  }
  return normalizeNarrationResult(attachmentId, body);
}

/**
 * Ask the server to write the script
 * (`POST /notes/:noteId/attachments/:attachmentId/narration`).
 *
 * The ONE metered call in the whole feature, charged once per document per
 * student. The server, not this client, is what makes that true: a request for
 * a document that already has a script comes back `reused` with no credit
 * reserved, so a double tap cannot buy a second reading. Only `regenerate`
 * pays again, and the caller must say so in words before setting it.
 *
 * A 202 means the work went to the queue. `onServerJob` hands the job id to
 * the Wave G job record — without it a reload has nothing to reattach to — and
 * `onProgress` forwards the server's own stage and percent, the only thing
 * allowed to move the progress bar.
 */
export async function requestNarrationScript(
  noteId: string,
  attachmentId: string,
  options?: {
    regenerate?: boolean;
    signal?: AbortSignal;
    onServerJob?: (jobId: string) => void;
    onProgress?: (progress: ApiJobProgress) => void;
  }
): Promise<NarrationScriptResult> {
  const response = await fetch(
    narrationPath(noteId, attachmentId),
    withApiCredentials({
      method: 'POST',
      headers: {
        ...(await getAuthHeaders()),
        'Content-Type': 'application/json',
        // The CSRF middleware demands this on every cookie-authenticated
        // write, and this is a write: it spends the student's AI uses.
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify(options?.regenerate ? { regenerate: true } : {}),
      signal: options?.signal,
    })
  );
  const body = (await response.json().catch(() => ({}))) as { jobId?: unknown };

  if (response.status === 202 && typeof body.jobId === 'string') {
    options?.onServerJob?.(body.jobId);
    const result = await pollApiJob<unknown>(body.jobId, { onProgress: options?.onProgress });
    return normalizeNarrationResult(attachmentId, result);
  }

  if (!response.ok) {
    throw narrationError(body, response.status, 'Could not start reading this document');
  }
  return normalizeNarrationResult(attachmentId, body);
}

// ---------------------------------------------------------------------------
// Community moderation (Wave 8 — roles, mutes, soft removals, invite codes)
//
// These come from the SHARED endpoints for one reason web's hand-written fetch
// layer cannot give: the typed NOT_ENABLED failure. The mute and invite routes
// answer 503 until the 20260908120000 migration is hand-applied on a
// deployment, and the wrapper maps that one status to a `NotEnabledError` the
// panel can branch on (`isNotEnabledError`) to say "Not switched on for this
// campus yet". A hand-written copy here would show the server's raw wording to
// a moderator who can do nothing about it — which is what the old copy did.
//
// Every one of them is re-decided server-side from the same pure rules in
// `@lantern/shared/network` that `components/community/manageCommunity.ts`
// calls, so hiding a control is a courtesy and never the gate.
// ---------------------------------------------------------------------------

/** Promote or demote a member. Owner (or platform admin) only; never NOT_ENABLED. */
export const setCommunityMemberRole = endpoints.setCommunityMemberRole;
/** Mute for one of `COMMUNITY_MUTE_DURATIONS`. A muted member still reads everything. */
export const muteCommunityMember = endpoints.muteCommunityMember;
/** Lift a mute — the same route with no duration. */
export const unmuteCommunityMember = endpoints.unmuteCommunityMember;
/** Soft-remove a board post; the card stays as a tombstone carrying the reason. */
export const removeCommunityPost = endpoints.removeCommunityPost;
export const createCommunityInvite = endpoints.createCommunityInvite;
export const listCommunityInvites = endpoints.listCommunityInvites;
export const revokeCommunityInvite = endpoints.revokeCommunityInvite;
/**
 * Redeem an invite code. Every refusal is ONE 404 with `INVITE_REFUSAL_COPY` —
 * show it as-is; distinguishing "expired" from "never existed" would make this
 * an oracle for which codes are real.
 */
export const joinCommunityByCode = endpoints.joinCommunityByCode;
