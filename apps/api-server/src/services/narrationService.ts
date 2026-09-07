/**
 * "Read this document to me" — the script half (Wave 3 of the deep-dive plan).
 *
 * There is no video here and no server-side speech. This service writes TEXT:
 * one short spoken paragraph per page of an uploaded document, stored in
 * `narration_scripts`. The student's own device speaks it — `speechSynthesis`
 * on web, `expo-speech` on mobile — over the page images the page model
 * (`notePages`) already renders. That is the whole reason the feature is
 * affordable: no TTS vendor, no render farm, no CDN, no audio bandwidth, and a
 * deck that plays offline once the script and its pictures are cached.
 *
 * Three rules this module exists to keep:
 *
 *  1. **Refuse before charging.** A document with no pages (or whose page model
 *     migration is not applied) is refused with a reason and costs nothing.
 *     The page count is resolved BEFORE the credit middleware runs — see
 *     `resolveNarrationTarget`, which the route calls first.
 *  2. **Charge once.** (attachment, user, version) is the idempotency key. A
 *     retry while a run is in flight, or after one succeeded, returns what
 *     exists. Only an explicit regeneration bumps the version and pays again.
 *  3. **Refund on failure.** The generation runs as a job through
 *     `runSyncOrEnqueue` with the Wave G stages, exactly like
 *     `studyPackFactory`: a throw from `generate` is what makes the worker hand
 *     the credits back.
 *
 * Like every other reader of a hand-applied migration, every path here
 * feature-detects `narration_scripts` and degrades honestly: `available: false`
 * with reason `schema_missing`, one warn log, and no charge.
 *
 * ## Why a narration deck is NOT an `offline_bundles` row
 *
 * The existing offline store is a question-bank store, not a generic one:
 * `offline_bundles` has NOT NULL `config` (a `TestConfig`), NOT NULL
 * `questions` and NOT NULL `group_name`, no `kind` discriminator, and every
 * reader of `getOfflineBundles` — the offline screen, the library list, the
 * test runner — treats a row as a downloaded test. Putting a reading in there
 * means writing an empty question array and a fabricated TestConfig, and then
 * teaching each of those readers to skip the rows that are secretly not tests.
 * That is a lie in the data with three places to forget it.
 *
 * So the offline entry is this service's GET instead: `getNarrationBundle`
 * returns the script AND its page images, freshly signed, in ONE response with
 * a private cache header — everything a client needs to store a deck and play
 * it with no network. Nothing else is required of the server, because nothing
 * about playback needs it: the voice is the device's own. When the founder
 * wants readings to appear in the offline LIST beside downloaded tests, the
 * honest change is a `kind` column on `offline_bundles` with `config` and
 * `questions` made nullable — a migration, not a workaround.
 */
import type { SupabaseService } from './supabase';
import { logger } from '../utils/logger';
import { PublicError } from '../utils/safeError';
import { chatCompletion, extractJSON } from './aiService';
import { ensurePages, ensurePageImages, getPages, signPageImages } from './notePages';
import type { NotePagesReason } from './notePages';
import {
  MAX_NARRATION_PAGES,
  NARRATION_NO_PAGES_MESSAGE,
  getNarrationCreditCost,
} from '@lantern/shared/utils/aiCredits';
import {
  narrationDuration,
  narrationSegmentsFromModel,
  planNarrationBatches,
  type NarrationScriptRow,
  type NarrationScriptSegment,
  type NarrationScriptStatus,
} from '@lantern/shared/notes/narration';

const TABLE = 'narration_scripts';

/** How long the page-image URLs handed to a client stay valid. */
export const NARRATION_IMAGE_URL_TTL_SECONDS = 60 * 60 * 24;

/** Longest single page's text we send to the model. */
const MAX_PAGE_TEXT_CHARS = 4000;

let warnedSchemaMissing = false;

/**
 * "The migration is not applied yet" — a missing table, or PostgREST's cached
 * view of one. Anything else is a real fault and must surface: a broken table
 * must not read as a document that has never been narrated.
 */
export function isMissingNarrationSchema(
  error: { code?: string; message?: string } | null | undefined
): boolean {
  if (!error) return false;
  const code = error.code || '';
  if (code === '42P01' || code === '42703' || code === 'PGRST205' || code === 'PGRST204') {
    return true;
  }
  const message = error.message || '';
  return /narration_scripts/i.test(message) && /does not exist|could not find/i.test(message);
}

function warnSchemaOnce(operation: string, error: unknown): void {
  if (warnedSchemaMissing) return;
  warnedSchemaMissing = true;
  logger.warn(
    'narration_scripts is unavailable (migration 20260907190000 not applied); reading aloud degrades to unavailable',
    { operation, error }
  );
}

/** Test seam: the warn-once latch is process-wide. */
export function __resetNarrationWarningForTests(): void {
  warnedSchemaMissing = false;
}

/* ------------------------------------------------------------- reading -- */

export interface StoredNarrationScript extends NarrationScriptRow {
  status: NarrationScriptStatus;
  creditCost: number;
  jobId: string | null;
  errorMessage: string | null;
  updatedAt: string;
}

export interface NarrationReadResult {
  available: boolean;
  /** 'ok' whenever `script` is the real answer, present or absent. */
  reason: 'ok' | 'schema_missing';
  script: StoredNarrationScript | null;
}

function mapSegments(raw: unknown): NarrationScriptSegment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((row, index) => {
      const text = typeof row.text === 'string' ? row.text : '';
      const estimatedSeconds =
        typeof row.estimatedSeconds === 'number' && Number.isFinite(row.estimatedSeconds)
          ? row.estimatedSeconds
          : 0;
      return {
        pageIndex: Number(row.pageIndex) || 0,
        order: typeof row.order === 'number' ? row.order : index,
        text,
        estimatedSeconds,
        startMs: typeof row.startMs === 'number' ? row.startMs : 0,
        durationMs:
          typeof row.durationMs === 'number' ? row.durationMs : estimatedSeconds * 1000,
      };
    });
}

function mapRow(row: Record<string, unknown>): StoredNarrationScript {
  return {
    sourceId: String(row.attachment_id),
    version: Number(row.version) || 1,
    status: (String(row.status || 'queued') as NarrationScriptStatus) || 'queued',
    pageCount: Number(row.page_count) || 0,
    creditCost: Number(row.credit_cost) || 0,
    segments: mapSegments(row.segments),
    jobId: typeof row.job_id === 'string' && row.job_id ? row.job_id : null,
    errorMessage:
      typeof row.error_message === 'string' && row.error_message ? row.error_message : null,
    createdAt: typeof row.created_at === 'string' ? row.created_at : undefined,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : '',
  };
}

/** The stored script for one (document, student), or null when there is none. */
export async function getNarrationScript(
  supabaseService: SupabaseService,
  attachmentId: string,
  userId: string
): Promise<NarrationReadResult> {
  const { data, error } = await supabaseService
    .getClient()
    .from(TABLE)
    .select(
      'attachment_id, user_id, version, status, segments, page_count, credit_cost, job_id, error_message, created_at, updated_at'
    )
    .eq('attachment_id', attachmentId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    if (isMissingNarrationSchema(error)) {
      warnSchemaOnce('getNarrationScript', error);
      return { available: false, reason: 'schema_missing', script: null };
    }
    throw error;
  }

  return {
    available: true,
    reason: 'ok',
    script: data ? mapRow(data as Record<string, unknown>) : null,
  };
}

async function writeRow(
  supabaseService: SupabaseService,
  row: Record<string, unknown>
): Promise<{ available: boolean }> {
  const { error } = await supabaseService
    .getClient()
    .from(TABLE)
    .upsert({ ...row, updated_at: new Date().toISOString() }, {
      onConflict: 'attachment_id,user_id',
    });
  if (error) {
    if (isMissingNarrationSchema(error)) {
      warnSchemaOnce('writeRow', error);
      return { available: false };
    }
    throw error;
  }
  return { available: true };
}

/* -------------------------------------- claiming a run, and dead runs -- */

/**
 * How long a run may sit in `queued` or `generating` without being touched
 * before we call it dead.
 *
 * A worker that is killed between the row being queued and
 * `markNarrationFailed` leaves the row in flight forever. The credit is not
 * lost — the job hook refunds it — but the ROW is: every later POST sees an
 * in-flight run, reuses it at cost 0, and both the web player and the phone
 * poll a script that will never be written. The window is measured from the
 * row's last touch, and a live run touches it after every batch
 * (`touchNarrationRun`), so fifteen minutes only has to outlast ONE model call
 * with its fallbacks — not a whole 40-page run — and is still short enough
 * that a student who walks away and comes back can start again.
 */
export const NARRATION_STALE_AFTER_MS = 15 * 60 * 1000;

/** What a student reads when their run died with the worker that held it. */
export const NARRATION_STALLED_MESSAGE =
  'This reading stopped before it was finished. Start it again — the AI uses for the run that stopped were given back.';

/**
 * The statuses a new run may claim: everything that is NOT a run in flight.
 *
 * Spelled as an allowlist rather than "not queued, not generating" because it
 * is the guard of an UPDATE that has to be right: `ready` is here because a
 * deliberate regeneration claims a finished script, and a repeat request that
 * is NOT a regeneration never reaches the claim at all (it is answered as
 * reuse). Two regenerations racing still serialize here — the first flips the
 * row to `queued`, and the second no longer matches.
 */
export const NARRATION_CLAIMABLE_STATUSES: NarrationScriptStatus[] = ['ready', 'failed'];

function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return !!error && error.code === '23505';
}

/**
 * Has this run been abandoned? True only for a run in flight whose row has not
 * been touched inside the window.
 *
 * A row with no readable timestamp is NOT called stale: an unparsable
 * `updated_at` is a bug in our own writing, and the safe reading of it is "a
 * run that is still going", which costs nothing, rather than "start again",
 * which charges.
 */
export function isNarrationRunStale(
  script: Pick<StoredNarrationScript, 'status' | 'updatedAt' | 'createdAt'> | null,
  now: number = Date.now()
): boolean {
  if (!script) return false;
  if (script.status !== 'queued' && script.status !== 'generating') return false;
  const stamp = Date.parse(script.updatedAt || script.createdAt || '');
  if (!Number.isFinite(stamp)) return false;
  return now - stamp > NARRATION_STALE_AFTER_MS;
}

/**
 * Turn an abandoned run into a failure, so it stops being reused and stops
 * being polled.
 *
 * Called on both read paths — the POST resolver and the GET bundle — because
 * either one may be the first to notice. Returns the script the caller should
 * act on: the same object when the run is alive, a failed one when it was not.
 * Best-effort about the write: a student who cannot be told the run died still
 * gets the honest answer in this response.
 */
export async function expireStalledNarration(
  supabaseService: SupabaseService,
  script: StoredNarrationScript | null,
  params: { userId: string },
  now: number = Date.now()
): Promise<StoredNarrationScript | null> {
  if (!isNarrationRunStale(script, now)) return script;
  const stalled = script as StoredNarrationScript;
  logger.warn('A narration run was abandoned and is being marked failed', {
    attachmentId: stalled.sourceId,
    status: stalled.status,
    updatedAt: stalled.updatedAt,
  });
  // A guarded UPDATE, not an upsert, and guarded on the VERSION as well as the
  // status. Two requests that both read the same dead row would otherwise
  // both retire it — and the second's write would land AFTER the first had
  // already claimed a new run, flipping that live `queued` row back to
  // `failed` so the second request's claim succeeded too: two charges for one
  // reading, through the very door the claim was built to close. With the
  // version in the guard the second write matches nothing (the claim bumped
  // it), and the second claim then fails its own status guard and is reuse.
  try {
    const { error } = await supabaseService
      .getClient()
      .from(TABLE)
      .update({
        status: 'failed',
        error_message: NARRATION_STALLED_MESSAGE.slice(0, 300),
        updated_at: new Date(now).toISOString(),
      })
      .eq('attachment_id', stalled.sourceId)
      .eq('user_id', params.userId)
      .eq('version', stalled.version)
      .in('status', ['queued', 'generating']);
    if (error && !isMissingNarrationSchema(error)) throw error;
  } catch (err) {
    logger.warn('Could not record an abandoned narration run as failed', {
      attachmentId: stalled.sourceId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return { ...stalled, status: 'failed', errorMessage: NARRATION_STALLED_MESSAGE };
}

/**
 * Heartbeat: keep an in-flight run's `updated_at` moving while it works.
 *
 * The stale sweep reads `updated_at`, and without this the row is stamped
 * once, at `generating`, and then not again until the script is saved. A run
 * that is alive but slow — ten batches against a provider that is timing out
 * and falling back — can legitimately outlast the window, at which point the
 * sweep would call it dead, the student would be told to start again, and the
 * old run would finish anyway: two charges for one reading. Touched after
 * every batch, guarded on the version and on `generating`, so a heartbeat from
 * an old run can never revive a row that a newer run has since claimed.
 * Best-effort: a missed heartbeat costs nothing but the window.
 */
async function touchNarrationRun(
  supabaseService: SupabaseService,
  params: { attachmentId: string; userId: string; version: number }
): Promise<void> {
  try {
    const { error } = await supabaseService
      .getClient()
      .from(TABLE)
      .update({ updated_at: new Date().toISOString() })
      .eq('attachment_id', params.attachmentId)
      .eq('user_id', params.userId)
      .eq('version', params.version)
      .eq('status', 'generating');
    if (error && !isMissingNarrationSchema(error)) throw error;
  } catch (err) {
    logger.warn('Could not refresh a narration run heartbeat', {
      attachmentId: params.attachmentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export interface NarrationClaimResult {
  /** False only when the migration is not applied. */
  available: boolean;
  /** True when THIS request owns the run and may be charged for it. */
  claimed: boolean;
  /** The version this run writes. */
  version: number;
  /** The row as it stood before the claim, so a refused charge can put it back. */
  previous: StoredNarrationScript | null;
}

/**
 * Take ownership of one (document, student) run in a single statement, BEFORE
 * a credit is reserved.
 *
 * This is the fix for a double POST. Reuse detection reads the row and the
 * handler writes `queued` several awaits later, so two taps 100 ms apart both
 * read "no run in flight", both pass, and the student pays twice for one
 * reading. The claim closes that window by making the transition to `queued`
 * itself the thing that decides: an INSERT for a document with no row, a
 * guarded UPDATE for one that has a finished or failed row, and in both cases
 * exactly one of two concurrent requests can win. The loser is not an error —
 * it is reuse, at cost 0, of the run the winner started.
 */
export async function claimNarrationRun(
  supabaseService: SupabaseService,
  params: {
    attachmentId: string;
    userId: string;
    previous: StoredNarrationScript | null;
    pageCount: number;
    creditCost: number;
  }
): Promise<NarrationClaimResult> {
  const version = params.previous ? params.previous.version + 1 : 1;
  const claimed: Record<string, unknown> = {
    attachment_id: params.attachmentId,
    user_id: params.userId,
    version,
    status: 'queued',
    // A queued run must never speak the previous version's script.
    segments: [],
    page_count: params.pageCount,
    credit_cost: params.creditCost,
    error_message: null,
    job_id: null,
    updated_at: new Date().toISOString(),
  };
  const client = supabaseService.getClient();

  if (!params.previous) {
    const { error } = await client.from(TABLE).insert(claimed);
    if (!error) {
      return { available: true, claimed: true, version, previous: null };
    }
    if (isMissingNarrationSchema(error)) {
      warnSchemaOnce('claimNarrationRun', error);
      return { available: false, claimed: false, version, previous: null };
    }
    // A row appeared between the read and this insert: that IS the race, and
    // the request that created it owns the run.
    if (isUniqueViolation(error)) {
      return { available: true, claimed: false, version, previous: null };
    }
    throw error;
  }

  const { data, error } = await client
    .from(TABLE)
    .update(claimed)
    .eq('attachment_id', params.attachmentId)
    .eq('user_id', params.userId)
    .in('status', NARRATION_CLAIMABLE_STATUSES)
    .select('attachment_id');
  if (error) {
    if (isMissingNarrationSchema(error)) {
      warnSchemaOnce('claimNarrationRun', error);
      return { available: false, claimed: false, version, previous: params.previous };
    }
    throw error;
  }
  return {
    // No row matched: the status moved to queued or generating under us, which
    // means another request claimed it first.
    claimed: Array.isArray(data) ? data.length > 0 : !!data,
    available: true,
    version,
    previous: params.previous,
  };
}

/**
 * Undo a claim whose charge was then refused.
 *
 * The claim happens before the credit middleware — it has to, or the double
 * post it prevents would still be charged twice — so a 429 leaves a `queued`
 * row for a run that will never start. Without this the student is locked out
 * of their own document until the stale window passes.
 *
 * Puts the row back EXACTLY: the previous status, version, segments and cost,
 * or no row at all when the claim created one. Guarded on `queued` throughout,
 * so a run that somehow got going in between is never clobbered, and
 * best-effort by contract — this runs while a refusal is already on its way to
 * the student and must not replace it with a different failure.
 */
export async function releaseNarrationClaim(
  supabaseService: SupabaseService,
  params: { attachmentId: string; userId: string; previous: StoredNarrationScript | null }
): Promise<void> {
  try {
    const client = supabaseService.getClient();
    const previous = params.previous;
    if (!previous) {
      const { error } = await client
        .from(TABLE)
        .delete()
        .eq('attachment_id', params.attachmentId)
        .eq('user_id', params.userId)
        .eq('status', 'queued');
      if (error && !isMissingNarrationSchema(error)) throw error;
      return;
    }
    const { error } = await client
      .from(TABLE)
      .update({
        version: previous.version,
        status: previous.status,
        segments: previous.segments,
        page_count: previous.pageCount,
        credit_cost: previous.creditCost,
        error_message: previous.errorMessage,
        job_id: previous.jobId,
        updated_at: new Date().toISOString(),
      })
      .eq('attachment_id', params.attachmentId)
      .eq('user_id', params.userId)
      .eq('status', 'queued');
    if (error && !isMissingNarrationSchema(error)) throw error;
  } catch (err) {
    logger.warn('Could not release a narration claim after a refused charge', {
      attachmentId: params.attachmentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/* --------------------------------------------------- what a run will cost -- */

/**
 * Everything the route needs to decide whether to charge, and what.
 *
 * `ok: false` is the refusal: it carries the sentence the student sees and the
 * route answers 4xx with it BEFORE any credit middleware runs, which is the
 * whole point of resolving this first.
 */
export type NarrationTarget =
  | {
      ok: true;
      attachmentId: string;
      /** Pages this run will read — already capped at MAX_NARRATION_PAGES. */
      pageCount: number;
      cost: number;
      /** True when the document is longer than the run will read. */
      truncated: boolean;
      /** A script that already exists for this student and document. */
      existing: StoredNarrationScript | null;
      /** Set when the answer is "this already exists, do not charge again". */
      reuse: boolean;
    }
  | {
      ok: false;
      status: number;
      reason: 'schema_missing' | 'no_pages' | NotePagesReason;
      message: string;
    };

/** What to tell a student when a document cannot be split into pages. */
function pagesReasonMessage(reason: NotePagesReason): string {
  switch (reason) {
    case 'schema_missing':
      return 'Reading documents aloud is not switched on yet.';
    case 'unsupported':
      return 'Only PDFs and presentations can be read aloud.';
    case 'preview_pending':
      return 'This deck is still being prepared. Try again in a moment.';
    case 'source_missing':
      return 'The original file for this document is missing.';
    case 'unreadable':
      return 'This file could not be split into pages, so there is nothing to read.';
    default:
      return NARRATION_NO_PAGES_MESSAGE;
  }
}

/**
 * Resolve the pages and decide the price — before a single credit is reserved.
 *
 * Ordering is the safety property here. `ensurePages` may back-fill a document
 * that has never been opened, which is the slow part, and it is exactly the
 * part that decides whether the request is chargeable at all. Doing it inside
 * the handler (after the middleware had already reserved credits) would charge
 * a student for a scanned image nobody can read and lean on a refund path to
 * put it back.
 */
export async function resolveNarrationTarget(
  supabaseService: SupabaseService,
  params: { noteId: string; attachmentId: string; userId: string; regenerate?: boolean }
): Promise<NarrationTarget> {
  const stored = await getNarrationScript(
    supabaseService,
    params.attachmentId,
    params.userId
  );
  if (!stored.available) {
    return {
      ok: false,
      status: 200,
      reason: 'schema_missing',
      message: 'Reading documents aloud is not switched on yet.',
    };
  }

  // A run whose worker died stays `queued` forever, and every later request
  // would reuse it at cost 0 while the client polls a script nobody is
  // writing. Retire it here, before reuse is decided, so this request becomes
  // an ordinary new run — and is charged, because the dead one was refunded.
  const existing = await expireStalledNarration(supabaseService, stored.script, {
    userId: params.userId,
  });

  // Rule 2: charge once. A run that is already queued, already generating, or
  // already finished is the answer to a repeat request — only an explicit
  // regeneration goes on to pay again.
  if (
    existing &&
    !params.regenerate &&
    (existing.status === 'ready' ||
      existing.status === 'queued' ||
      existing.status === 'generating')
  ) {
    return {
      ok: true,
      attachmentId: params.attachmentId,
      pageCount: existing.pageCount,
      cost: 0,
      truncated: false,
      existing,
      reuse: true,
    };
  }

  const pages = await ensurePages(supabaseService, {
    noteId: params.noteId,
    attachmentId: params.attachmentId,
  });
  if (!pages.available || pages.reason !== 'ok') {
    return {
      ok: false,
      status: pages.reason === 'schema_missing' ? 200 : 400,
      reason: pages.reason,
      message: pagesReasonMessage(pages.reason),
    };
  }

  const plan = planNarrationBatches(pages.pages, { maxPages: MAX_NARRATION_PAGES });
  if (!plan.batches.length) {
    return {
      ok: false,
      status: 400,
      reason: 'no_pages',
      message:
        'There is no readable text in this document, so there is nothing to read aloud. Run OCR on it first.',
    };
  }

  return {
    ok: true,
    attachmentId: params.attachmentId,
    pageCount: plan.pageIndexes.length,
    cost: getNarrationCreditCost(plan.pageIndexes.length),
    truncated: plan.truncated,
    existing,
    reuse: false,
  };
}

/* ----------------------------------------------------------- generating -- */

const SYSTEM_PROMPT = [
  'You write narration scripts that a student listens to while looking at the page you are describing.',
  'For each page you are given, write ONE spoken paragraph, 40 to 110 words, that explains what is on that page.',
  'Rules:',
  '- Speak only about the page you were given. Never mention a page you were not shown, and never invent a figure, a number or a name that is not in the text.',
  '- Plain spoken English. No markdown, no headings, no bullet points, no "on this slide" filler on every page.',
  '- Write numbers and symbols the way they are said aloud: "twenty four", "per cent", "H two O".',
  '- If a page is mostly a diagram with a caption, say what the diagram shows and stop. Do not pad.',
  'Return JSON only: {"segments":[{"pageIndex":<number>,"text":"..."}]} with one entry per page you were given.',
].join('\n');

const MERGE_SYSTEM_PROMPT = [
  'You are joining narration paragraphs written separately for consecutive pages of one document into a single reading.',
  'Keep every paragraph on its own page. Do not merge, split, reorder or drop pages, and do not add new facts.',
  'Only smooth the joins: remove a repeated introduction, fix a paragraph that restarts the topic from scratch, and keep one consistent voice.',
  'Return JSON only: {"segments":[{"pageIndex":<number>,"text":"..."}]} containing exactly the pages you were given.',
].join('\n');

function batchUserPrompt(
  title: string,
  pages: Array<{ pageIndex: number; text: string }>
): string {
  const body = pages
    .map(
      (page) =>
        `--- PAGE ${page.pageIndex} ---\n${page.text.slice(0, MAX_PAGE_TEXT_CHARS)}`
    )
    .join('\n\n');
  return `Document: ${title || 'Untitled document'}\n\n${body}`;
}

function segmentsFromReply(text: string): Array<{ pageIndex?: unknown; text?: unknown }> {
  const parsed = extractJSON(text);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).segments)) {
    return (parsed as any).segments;
  }
  return [];
}

/** Progress hook, so the job's stages move while the map calls run. */
export interface NarrationProgress {
  stage: (stage: 'reading' | 'generating' | 'saving') => Promise<void> | void;
  percent?: (percent: number) => Promise<void> | void;
}

export interface BuildNarrationResult {
  attachmentId: string;
  version: number;
  pageCount: number;
  segmentCount: number;
  estimatedSeconds: number;
}

/**
 * Write the script. Runs in the worker, or in-request when BullMQ is off.
 *
 * Throws on total failure, which is what makes the job wrapper refund the
 * charge — the same contract `studyPackFactory.generate` has. A partial
 * failure is NOT a total one: if one batch of four pages fails while the rest
 * succeed, the student gets a script with a gap rather than nothing, because a
 * 36-page reading missing four pages is worth more than a refund. A run where
 * EVERY batch failed throws.
 */
export async function buildNarrationScript(
  supabaseService: SupabaseService,
  params: {
    noteId: string;
    attachmentId: string;
    userId: string;
    version?: number;
    creditCost?: number;
    title?: string;
  },
  progress?: NarrationProgress
): Promise<BuildNarrationResult> {
  const version = Math.max(1, Math.floor(params.version || 1));

  await progress?.stage('reading');
  const pages = await ensurePages(supabaseService, {
    noteId: params.noteId,
    attachmentId: params.attachmentId,
  });
  if (!pages.available) {
    // The migration went away between the route and the worker. Nothing to
    // store and nothing to say — throw so the charge is refunded.
    throw new Error('Page model unavailable while writing a narration script');
  }
  if (pages.reason !== 'ok' || !pages.pages.length) {
    throw new PublicError(pagesReasonMessage(pages.reason));
  }

  const plan = planNarrationBatches(pages.pages, { maxPages: MAX_NARRATION_PAGES });
  if (!plan.batches.length) {
    throw new PublicError(
      'There is no readable text in this document, so there is nothing to read aloud.'
    );
  }

  await markStatus(supabaseService, {
    attachmentId: params.attachmentId,
    userId: params.userId,
    version,
    status: 'generating',
    pageCount: plan.pageIndexes.length,
    creditCost: params.creditCost,
  });

  await progress?.stage('generating');

  const title = params.title || 'Untitled document';
  const collected: Array<{ pageIndex?: unknown; text?: unknown }> = [];
  let failedBatches = 0;
  // Sticky routing: every batch of one document should be written by the same
  // model, or page 9 reads like a different narrator from page 8.
  let preferredProvider: string | undefined;

  for (const batch of plan.batches) {
    try {
      const { text, provider } = await chatCompletion(
        SYSTEM_PROMPT,
        batchUserPrompt(title, batch.pages),
        { temperature: 0.4, maxTokens: 1200, jsonOutput: true, preferredProvider }
      );
      preferredProvider = preferredProvider || provider;
      collected.push(...segmentsFromReply(text));
    } catch (err) {
      failedBatches += 1;
      logger.warn('A narration batch failed; the script will have a gap', {
        attachmentId: params.attachmentId,
        batch: batch.index,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (progress?.percent) {
      const done = batch.index + 1;
      await progress.percent(45 + Math.round((done / plan.batches.length) * 35));
    }
    // The job record moved above; the row has to move too, or the stale
    // sweep reads a run that is still working as one that died.
    await touchNarrationRun(supabaseService, {
      attachmentId: params.attachmentId,
      userId: params.userId,
      version,
    });
  }

  if (failedBatches === plan.batches.length) {
    // Nothing was written. Throw so the job refunds — never store an empty
    // script and call it ready.
    throw new Error('Every narration batch failed');
  }

  let segments = narrationSegmentsFromModel(collected, plan.pageIndexes);

  // The merge pass is one call over the whole reading, and it is best-effort:
  // its only job is to smooth the joins between batches. A document that only
  // needed one call has no joins to smooth, so it is skipped entirely.
  if (plan.batches.length > 1 && segments.length > 1) {
    try {
      const { text } = await chatCompletion(
        MERGE_SYSTEM_PROMPT,
        JSON.stringify({
          title,
          segments: segments.map((segment) => ({
            pageIndex: segment.pageIndex,
            text: segment.text,
          })),
        }),
        { temperature: 0.2, maxTokens: 3000, jsonOutput: true, preferredProvider }
      );
      const merged = narrationSegmentsFromModel(
        segmentsFromReply(text),
        segments.map((segment) => segment.pageIndex)
      );
      // Only accept a merge that kept every page. A merge that lost pages is a
      // worse script than the one we already have.
      if (merged.length === segments.length) segments = merged;
    } catch (err) {
      logger.warn('Narration merge pass failed; keeping the per-batch script', {
        attachmentId: params.attachmentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await progress?.stage('saving');

  const write = await writeRow(supabaseService, {
    attachment_id: params.attachmentId,
    user_id: params.userId,
    version,
    status: 'ready',
    segments,
    page_count: plan.pageIndexes.length,
    credit_cost: params.creditCost ?? 0,
    error_message: null,
  });
  if (!write.available) {
    throw new Error('Narration script table unavailable while saving');
  }

  // Page pictures are what make the deck playable offline. Best-effort and
  // AFTER the script is stored: a render that times out must not lose a script
  // the student has already paid for — the next GET renders what is missing.
  void ensurePageImages(supabaseService, {
    noteId: params.noteId,
    attachmentId: params.attachmentId,
    maxPages: MAX_NARRATION_PAGES,
  }).catch((err) => {
    logger.warn('Page images for a narration deck could not be rendered yet', {
      attachmentId: params.attachmentId,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  logger.info('Wrote a narration script', {
    attachmentId: params.attachmentId,
    pageCount: plan.pageIndexes.length,
    segments: segments.length,
    failedBatches,
  });

  return {
    attachmentId: params.attachmentId,
    version,
    pageCount: plan.pageIndexes.length,
    segmentCount: segments.length,
    estimatedSeconds: narrationDuration(segments),
  };
}

/** Stamp a status on the row without touching the segments it already holds. */
export async function markStatus(
  supabaseService: SupabaseService,
  params: {
    attachmentId: string;
    userId: string;
    version: number;
    status: NarrationScriptStatus;
    pageCount?: number;
    creditCost?: number;
    jobId?: string | null;
    errorMessage?: string | null;
  }
): Promise<{ available: boolean }> {
  const row: Record<string, unknown> = {
    attachment_id: params.attachmentId,
    user_id: params.userId,
    version: params.version,
    status: params.status,
  };
  if (params.pageCount !== undefined) row.page_count = params.pageCount;
  if (params.creditCost !== undefined) row.credit_cost = params.creditCost;
  if (params.jobId !== undefined) row.job_id = params.jobId;
  if (params.errorMessage !== undefined) row.error_message = params.errorMessage;
  // A fresh queued/generating row must not inherit stale segments from a
  // previous version; a ready row writes its own.
  if (params.status === 'queued') row.segments = [];
  return writeRow(supabaseService, row);
}

/**
 * Mark a run failed, with the sentence the student will read.
 *
 * Best-effort by contract: this runs on the failure path, and a failure to
 * record a failure must never mask the original error.
 */
export async function markNarrationFailed(
  supabaseService: SupabaseService,
  params: { attachmentId: string; userId: string; version: number; message: string }
): Promise<void> {
  try {
    await markStatus(supabaseService, {
      attachmentId: params.attachmentId,
      userId: params.userId,
      version: params.version,
      status: 'failed',
      errorMessage: params.message.slice(0, 300),
    });
  } catch (err) {
    logger.warn('Could not record a narration failure', {
      attachmentId: params.attachmentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/* -------------------------------------------------- the offline payload -- */

export interface NarrationBundle {
  attachmentId: string;
  status: NarrationScriptStatus;
  version: number;
  pageCount: number;
  segments: NarrationScriptSegment[];
  estimatedSeconds: number;
  creditCost: number;
  jobId: string | null;
  errorMessage: string | null;
  createdAt?: string;
  /** Page pictures, signed in one batch. Absent for a page with no image yet. */
  pages: Array<{ pageIndex: number; imageUrl?: string }>;
  /** When the signed image URLs stop working. */
  imageUrlExpiresIn: number;
}

/**
 * The whole playable deck in one response: the script plus this document's page
 * images, signed together in a single batch.
 *
 * One request, because that is what a client caches for offline play. Signing
 * the images one at a time was the bug that killed chat and board photos after
 * 24 hours; here the paths are stored and re-signed on every read, and the
 * response says exactly how long the URLs last so a client knows when its
 * offline copy needs refreshing.
 */
export async function getNarrationBundle(
  supabaseService: SupabaseService,
  params: { noteId: string; attachmentId: string; userId: string; includeImages?: boolean }
): Promise<
  | { available: false; reason: 'schema_missing'; bundle: null }
  | { available: true; reason: 'ok'; bundle: NarrationBundle | null }
> {
  const stored = await getNarrationScript(
    supabaseService,
    params.attachmentId,
    params.userId
  );
  if (!stored.available) return { available: false, reason: 'schema_missing', bundle: null };
  if (!stored.script) return { available: true, reason: 'ok', bundle: null };

  // The GET is what a waiting client polls, so it is often the first to notice
  // that the run behind it died. Report such a row as failed, with the reason,
  // rather than letting the player spin on `generating` forever.
  const script = (await expireStalledNarration(supabaseService, stored.script, {
    userId: params.userId,
  }))!;
  let pages: Array<{ pageIndex: number; imageUrl?: string }> = [];

  if (params.includeImages !== false && script.status === 'ready') {
    const stored_pages = await getPages(supabaseService, params.attachmentId);
    if (stored_pages.available && stored_pages.pages.length) {
      const capped = stored_pages.pages.slice(0, MAX_NARRATION_PAGES);
      const signed = await signPageImages(supabaseService, capped, {
        expiresInSeconds: NARRATION_IMAGE_URL_TTL_SECONDS,
      });
      pages = capped.map((page) => ({
        pageIndex: page.pageIndex,
        ...(signed.has(page.pageIndex) ? { imageUrl: signed.get(page.pageIndex) } : {}),
      }));
    }
  }

  return {
    available: true,
    reason: 'ok',
    bundle: {
      attachmentId: script.sourceId,
      status: script.status,
      version: script.version,
      pageCount: script.pageCount,
      segments: script.segments,
      estimatedSeconds: narrationDuration(script.segments),
      creditCost: script.creditCost,
      jobId: script.jobId,
      errorMessage: script.errorMessage,
      createdAt: script.createdAt,
      pages,
      imageUrlExpiresIn: NARRATION_IMAGE_URL_TTL_SECONDS,
    },
  };
}

/* ------------------------------------------------------- the wire shape -- */

/**
 * What the API says about one narration deck. One shape, three callers: the
 * GET, the POST, and the JOB RESULT.
 *
 * The job result matters as much as the routes. A client that started a script
 * asynchronously waits on the job and renders whatever it returns — so the
 * job's result has to be the whole deck, not a summary of one, or the player
 * would finish "writing your reading" and then have nothing to speak until it
 * fetched again.
 *
 * FLAT, deliberately: `segments`, `pageCount` and `jobId` sit directly on
 * `data` because that is the shape both clients read and the object they store
 * for offline play. A document nobody has narrated yet is
 * `reason: 'not_generated'` with an empty segment list — the ordinary first
 * state of every document, and never an error.
 */
export function narrationApiPayload(
  attachmentId: string,
  bundle: NarrationBundle | null,
  extra?: Record<string, unknown>
): Record<string, unknown> {
  if (!bundle) {
    return {
      attachmentId,
      available: true,
      reason: 'not_generated',
      status: null,
      pageCount: 0,
      segments: [],
      pages: [],
      maxPages: MAX_NARRATION_PAGES,
      ...(extra || {}),
    };
  }
  return {
    attachmentId,
    available: true,
    // A failed run is reported as failed rather than as "no script": the
    // student paid for it and is owed the reason.
    reason: bundle.status === 'failed' ? 'unreadable' : 'ok',
    status: bundle.status,
    version: bundle.version,
    pageCount: bundle.pageCount,
    segments: bundle.segments,
    estimatedSeconds: bundle.estimatedSeconds,
    creditCost: bundle.creditCost,
    jobId: bundle.jobId ?? undefined,
    errorMessage: bundle.errorMessage ?? undefined,
    generatedAt: bundle.createdAt,
    pages: bundle.pages,
    imageUrlExpiresIn: bundle.imageUrlExpiresIn,
    maxPages: MAX_NARRATION_PAGES,
    ...(extra || {}),
  };
}
