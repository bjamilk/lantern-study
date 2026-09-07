/**
 * "Read it to me" — the mobile client for the narration script.
 *
 * Two calls and a local copy, and the split between them is the whole design:
 *
 *  - `requestNarrationScript` is the ONE metered call in the feature. It spends
 *    the student's AI uses, once per document, and goes through the Wave G job
 *    system when the server answers 202.
 *  - `fetchNarrationScript` is free and unmetered. A player opening for the
 *    tenth time must never touch the generate route — the script was written
 *    once and is replayed forever.
 *  - `readCachedScript`/`writeCachedScript` keep a copy on the device, so a
 *    deck that has been opened once plays with no network at all.
 *
 * The contract is the web lane's (`services/apiEndpoints.ts` at the repo root)
 * and this file mirrors it deliberately, field for field, so a document
 * narrated on one platform plays on the other without a translation layer.
 *
 * What is NOT cached is the page IMAGES. They arrive as short-lived signed
 * URLs from the pages route and expire — the same lesson the chat photos
 * taught. So an offline replay is the script and the page TEXT, and the player
 * says so rather than showing an empty frame where a picture used to be.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL, getAuthHeaders } from './supabase';
import { applyAIUsageFromResponse, applyAIUsageFromErrorBody } from './ai';
import { awaitJobResult } from './jobWatch';

/** One spoken chunk. Transcript-shaped, plus the page it belongs to. */
export interface NarrationScriptSegment {
  id?: string;
  pageIndex: number;
  order: number;
  text: string;
}

/**
 * Why there is no script, when there is none.
 *
 * `not_generated` is the ordinary first state of every document and must never
 * be rendered as a failure; `schema_missing` is the hand-applied-migration
 * case, exactly as the pages route reports it.
 */
export type NarrationReason =
  | 'ok'
  | 'not_generated'
  | 'schema_missing'
  | 'unsupported'
  | 'source_missing'
  | 'preview_pending'
  | 'unreadable';

export interface NarrationScriptResult {
  attachmentId: string;
  available: boolean;
  reason: NarrationReason;
  /** Pages the script covers — may be fewer than the document has. */
  pageCount: number;
  segments: NarrationScriptSegment[];
  /** Server job id, when the script is still being written. */
  jobId?: string;
  generatedAt?: string;
}

function narrationPath(noteId: string, attachmentId: string): string {
  return `${API_BASE_URL}/api/v1/notes/${encodeURIComponent(
    noteId
  )}/attachments/${encodeURIComponent(attachmentId)}/narration`;
}

function normalize(attachmentId: string, body: unknown): NarrationScriptResult {
  const envelope = (body ?? {}) as { data?: unknown };
  const data = (envelope.data ?? body ?? {}) as Partial<NarrationScriptResult>;
  const segments = Array.isArray(data.segments) ? data.segments : [];
  return {
    attachmentId,
    available: data.available !== false,
    reason: (data.reason as NarrationReason) ?? (segments.length > 0 ? 'ok' : 'not_generated'),
    pageCount:
      typeof data.pageCount === 'number'
        ? data.pageCount
        : new Set(segments.map((segment) => segment?.pageIndex)).size,
    segments,
    jobId: typeof data.jobId === 'string' ? data.jobId : undefined,
    generatedAt: typeof data.generatedAt === 'string' ? data.generatedAt : undefined,
  };
}

function narrationError(body: unknown, status: number, fallback: string): Error {
  const shaped = (body ?? {}) as { error?: unknown; message?: unknown };
  if (typeof shaped.message === 'string' && shaped.message) return new Error(shaped.message);
  if (typeof shaped.error === 'string' && shaped.error) return new Error(shaped.error);
  return new Error(`${fallback} (${status}).`);
}

/**
 * The script a document already has.
 *
 * A 404 is not an error: it is `not_generated`, the state every document
 * starts in, and the screen offers to write one rather than showing a failure.
 */
export async function fetchNarrationScript(
  noteId: string,
  attachmentId: string
): Promise<NarrationScriptResult> {
  const response = await fetch(narrationPath(noteId, attachmentId), {
    headers: await getAuthHeaders(),
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 404) {
    return { attachmentId, available: false, reason: 'not_generated', pageCount: 0, segments: [] };
  }
  if (!response.ok) {
    throw narrationError(body, response.status, 'Could not load this reading');
  }
  applyAIUsageFromResponse(response);
  return normalize(attachmentId, body);
}

/**
 * Ask the server to write the script. The one metered call.
 *
 * `clientJobId` is the idempotency key the AI job system already uses, so a
 * student who taps twice buys one script, not two. A 202 hands back a server
 * job id — reported through `onJobId` so the store can survive a cold start —
 * and is then polled to its real end through the shared job client.
 */
export async function requestNarrationScript(
  noteId: string,
  attachmentId: string,
  options: { clientJobId?: string; onJobId?: (jobId: string) => void } = {}
): Promise<NarrationScriptResult> {
  const response = await fetch(narrationPath(noteId, attachmentId), {
    method: 'POST',
    headers: {
      ...(await getAuthHeaders()),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(options.clientJobId ? { clientJobId: options.clientJobId } : {}),
  });
  const body = await response.json().catch(() => ({}));
  if (response.ok || response.status === 202) {
    applyAIUsageFromResponse(response);
  } else if (response.status === 429) {
    // A refused request must still correct the badge.
    applyAIUsageFromErrorBody(body);
  }
  if (!response.ok && response.status !== 202) {
    throw narrationError(body, response.status, 'Could not start reading this document');
  }
  const shaped = normalize(attachmentId, body);
  const serverJobId =
    shaped.jobId ?? (typeof (body as { jobId?: unknown }).jobId === 'string'
      ? ((body as { jobId: string }).jobId)
      : undefined);
  if (response.status === 202 && serverJobId) {
    options.onJobId?.(serverJobId);
    const settled = await awaitJobResult<unknown>(serverJobId);
    return normalize(attachmentId, settled);
  }
  return shaped;
}

/* ------------------------------------------------------------ offline -- */

/**
 * Where a script lives on the device.
 *
 * Keyed on the ATTACHMENT, not the note: a note can carry more than one
 * document, and two of them sharing a cache entry would play the wrong words
 * over the right pictures.
 */
export function narrationCacheKey(attachmentId: string): string {
  return `lantern.narration.${attachmentId}`;
}

/** The device's copy, or null. A corrupt entry reads as "no copy", never a throw. */
export async function readCachedScript(
  attachmentId: string
): Promise<NarrationScriptResult | null> {
  try {
    const raw = await AsyncStorage.getItem(narrationCacheKey(attachmentId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NarrationScriptResult;
    if (!parsed || !Array.isArray(parsed.segments) || !parsed.segments.length) return null;
    return { ...parsed, attachmentId };
  } catch {
    return null;
  }
}

/**
 * Keep this script for offline play.
 *
 * A write failure is swallowed: the student has the script in memory and the
 * reading is about to start. Losing the offline copy is worth strictly less
 * than an error dialog over a deck that is playing fine.
 */
export async function writeCachedScript(result: NarrationScriptResult): Promise<void> {
  if (!result?.attachmentId || !result.segments?.length) return;
  try {
    await AsyncStorage.setItem(narrationCacheKey(result.attachmentId), JSON.stringify(result));
  } catch {
    /* offline replay is a bonus, not a promise */
  }
}

/** Drop the device's copy — for a deliberate regenerate. */
export async function clearCachedScript(attachmentId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(narrationCacheKey(attachmentId));
  } catch {
    /* nothing to do about it, and nothing to say about it */
  }
}
