/**
 * Request-level idempotency for side-effecting POSTs, backed by the database
 * rather than process memory.
 *
 * Exports — called by `routes/marketplace/*` (buy-now, cart checkout, listing
 * boost) and by `middleware/idempotency.ts`:
 * - `withIdempotency(client, userId, operation, key, handler)` — the wrapper.
 * - `normalizeIdempotencyKey(header, fallback)` — trims and length-caps the
 *   client's `Idempotency-Key`, returning null when absent or over 128 chars so
 *   the caller supplies its own derived key.
 * - `getIdempotentResponse` — reads a completed response without claiming.
 * - `IdempotentRetryAfterFailureError` — thrown (statusCode 409) when a key is
 *   reused after a failed attempt.
 *
 * What it touches: the Supabase table `api_idempotency_keys`, unique on
 * (user_id, operation, idempotency_key), plus a best-effort
 * `claim_idempotency_lock` advisory-lock RPC. State lives ONLY in that table,
 * never in a module-level Map, so the guarantee holds across the several Render
 * replicas serving the API — an in-memory claim would be invisible to the
 * replica that fields the retry.
 *
 * Protocol. A claim is an INSERT with `response = {_status: '__processing__'}`.
 * The unique index decides the winner: the loser reads the row back and either
 * returns the cached response, waits for the in-flight one (100 ms x 50), or
 * refuses because the previous attempt failed.
 *
 * Failure handling. A handler that throws now marks the row
 * `{_status: '__failed__', _failedAt}` instead of DELETING it. Deleting freed
 * the key, so an automatic client retry re-entered the handler — and a checkout
 * handler that threw after creating an order created a second one, the exact
 * duplicate the key exists to prevent. The marker owns the key for
 * `FAILURE_TTL_MS` (10 minutes) and is reclaimable after that; within the
 * window the retry gets a 409 telling it to use a new key.
 *
 * FIXED (G3 · H5): reclaiming a STALE failure marker is itself a claim and must
 * be a compare-and-set. It used to be an unconditional
 * `update({response: PROCESSING})` filtered only on (user, operation, key),
 * with its result discarded, so two retries arriving together 10 minutes after
 * a failed checkout BOTH got `'claimed'` and both ran the money handler — two
 * orders, two Paystack charges. The reclaim now filters on
 * `response->>_status = '__failed__'` and returns the row it flipped: exactly
 * one caller sees a row and proceeds, and the loser is told to wait.
 *
 * FIXED (G3 · H6): `claim === 'cached'` used to fall THROUGH to the handler when
 * the cached re-read came back empty (a transient read error, or the row
 * reclaimed in between) — a replay of a completed checkout ran the checkout
 * again, without holding the claim. A cached claim now either returns the cached
 * body or 409s; it never runs the handler.
 *
 * FIXED (G3 · M13, same family): the response write and the failure marker are
 * both conditional on the row still being this attempt's `__processing__`
 * marker, so a slow original handler finishing after its key was reclaimed
 * cannot overwrite the reclaimer's response (or bury it under a failure).
 *
 * The fallback key when no header is sent is derived by the caller from the
 * REQUEST CONTENT (a SHA-256 of listing id, quantity, cart lines, and so on)
 * plus a 5-minute bucket. The bucket alone used to be the whole key, which
 * meant two DIFFERENT requests from one user in the same window shared a key
 * and the second was served the first one's cached response — the wrong cart,
 * the wrong listing, the wrong amount.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { PublicError } from '../utils/safeError';

const MAX_KEY_LENGTH = 128;
const PROCESSING_STATUS = '__processing__';
const FAILED_STATUS = '__failed__';
/**
 * How long a failed attempt keeps owning its key. Deleting the slot instead
 * (the old behaviour) let an automatic client retry re-enter the handler and
 * create a SECOND order for one checkout — the exact duplicate the key exists
 * to prevent. Holding the key makes the retry fail loudly; a genuinely new
 * attempt uses a new key.
 */
const FAILURE_TTL_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 100;
const POLL_MAX_ATTEMPTS = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasStatus(value: unknown, status: string): boolean {
  return (
    typeof value === 'object' && value !== null && (value as { _status?: string })._status === status
  );
}

function isProcessingResponse(value: unknown): boolean {
  return hasStatus(value, PROCESSING_STATUS);
}

function isFailureMarker(value: unknown): boolean {
  return hasStatus(value, FAILED_STATUS);
}

/** A failure marker only owns the key for FAILURE_TTL_MS; after that it is reclaimable. */
function isFreshFailureMarker(value: unknown): boolean {
  if (!isFailureMarker(value)) return false;
  const at = Date.parse(String((value as { _failedAt?: string })._failedAt || ''));
  if (!Number.isFinite(at)) return true;
  return Date.now() - at < FAILURE_TTL_MS;
}

/**
 * Both refusals extend PublicError (G3 · H7): their messages are written for the
 * buyer and must survive `clientErrorMessage` in production, where a bare Error
 * collapses to "Something went wrong" and the client is left guessing which of
 * the two 409s it got.
 */
export class IdempotentRetryAfterFailureError extends PublicError {
  readonly statusCode = 409;
  /** A new key is required; retrying this one can only 409 again. */
  readonly retryable = false;
  /**
   * Both idempotency refusals are 409s, and the global handler genericises
   * messages in production, so English prose was the only thing telling them
   * apart on the wire. The code is what a client should branch on: this one
   * means "mint a new key", IDEMPOTENCY_CONCURRENT means "retry the same one".
   */
  readonly code = 'IDEMPOTENCY_PREVIOUS_FAILED';
  constructor() {
    super(
      'A previous request with this Idempotency-Key failed. Retry with a new Idempotency-Key.'
    );
    this.name = 'IdempotentRetryAfterFailureError';
  }
}

/**
 * The wait for an in-flight request holding the same Idempotency-Key ran out.
 * Nothing about the caller's request is wrong, so it must not surface as a 400:
 * 409 says "the same key is still busy — retry it".
 */
export class ConcurrentIdempotentRequestTimeoutError extends PublicError {
  readonly statusCode = 409;
  readonly retryable = true;
  /** See IdempotentRetryAfterFailureError.code — this one is safe to retry as-is. */
  readonly code = 'IDEMPOTENCY_CONCURRENT';
  constructor() {
    super('Concurrent idempotent request timed out');
    this.name = 'ConcurrentIdempotentRequestTimeoutError';
  }
}

export function normalizeIdempotencyKey(
  headerValue: string | string[] | undefined,
  fallback?: string
): string | null {
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const key = (raw || fallback || '').trim();
  if (!key || key.length > MAX_KEY_LENGTH) return null;
  return key;
}

export async function getIdempotentResponse<T>(
  client: SupabaseClient,
  userId: string,
  operation: string,
  idempotencyKey: string
): Promise<T | null> {
  const { data, error } = await client
    .from('api_idempotency_keys')
    .select('response')
    .eq('user_id', userId)
    .eq('operation', operation)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  if (error) throw error;
  if (!data?.response || isProcessingResponse(data.response) || isFailureMarker(data.response)) {
    return null;
  }
  return data.response as T;
}

async function waitForCompletedResponse<T>(
  client: SupabaseClient,
  userId: string,
  operation: string,
  idempotencyKey: string
): Promise<T | null> {
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);
    const cached = await getIdempotentResponse<T>(client, userId, operation, idempotencyKey);
    if (cached) return cached;
  }
  return null;
}

async function claimIdempotencySlot(
  client: SupabaseClient,
  userId: string,
  operation: string,
  idempotencyKey: string
): Promise<'claimed' | 'cached' | 'wait' | 'failed'> {
  // Advisory lock when available; unique index still owns cross-request safety.
  try {
    await client.rpc('claim_idempotency_lock', {
      p_user_id: userId,
      p_operation: operation,
      p_idempotency_key: idempotencyKey,
    });
  } catch {
    // Best-effort; insert conflict handling below remains authoritative.
  }

  const { error } = await client.from('api_idempotency_keys').insert({
    user_id: userId,
    operation,
    idempotency_key: idempotencyKey,
    response: { _status: PROCESSING_STATUS },
  });

  if (!error) return 'claimed';

  if (error.code === '23505') {
    const { data, error: readError } = await client
      .from('api_idempotency_keys')
      .select('response')
      .eq('user_id', userId)
      .eq('operation', operation)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    if (readError) throw readError;
    if (isFreshFailureMarker(data?.response)) return 'failed';
    if (isFailureMarker(data?.response)) {
      // Stale failure: take the key back for this attempt — but only if it is
      // STILL a failure marker when the write lands. Without the status filter
      // (H5) two simultaneous retries both "reclaimed" the same key and both
      // re-entered the money handler. The filter makes the reclaim a CAS and
      // the returned row is the proof: no row means another attempt won it, so
      // this caller waits for that attempt's response instead of racing it.
      const { data: reclaimed, error: reclaimError } = await client
        .from('api_idempotency_keys')
        .update({ response: { _status: PROCESSING_STATUS } })
        .eq('user_id', userId)
        .eq('operation', operation)
        .eq('idempotency_key', idempotencyKey)
        .eq('response->>_status', FAILED_STATUS)
        .select('idempotency_key')
        .maybeSingle();
      if (reclaimError) throw reclaimError;
      return reclaimed ? 'claimed' : 'wait';
    }
    if (data?.response && !isProcessingResponse(data.response)) {
      return 'cached';
    }
    return 'wait';
  }

  throw error;
}

async function storeIdempotentResponse(
  client: SupabaseClient,
  userId: string,
  operation: string,
  idempotencyKey: string,
  response: unknown
): Promise<void> {
  // Conditional on THIS attempt's processing marker (M13): a handler that
  // finishes after its key was reclaimed must not overwrite the reclaimer's
  // response with its own.
  const { error } = await client
    .from('api_idempotency_keys')
    .update({ response })
    .eq('user_id', userId)
    .eq('operation', operation)
    .eq('idempotency_key', idempotencyKey)
    .eq('response->>_status', PROCESSING_STATUS);

  if (error) throw error;
}

/**
 * Mark the attempt failed WITHOUT freeing the key. The handler may have had
 * side effects (an order row, a Paystack session) before it threw, so a retry
 * on the same key must not run it again.
 */
async function markIdempotencyFailure(
  client: SupabaseClient,
  userId: string,
  operation: string,
  idempotencyKey: string,
  error: unknown
): Promise<void> {
  await client
    .from('api_idempotency_keys')
    .update({
      response: {
        _status: FAILED_STATUS,
        _failedAt: new Date().toISOString(),
        _error: error instanceof Error ? error.message : String(error),
      },
    })
    .eq('user_id', userId)
    .eq('operation', operation)
    .eq('idempotency_key', idempotencyKey)
    // Same reasoning as storeIdempotentResponse: only this attempt's marker may
    // be turned into a failure. A late throw must not bury a reclaimer's
    // successful response under a failure marker.
    .eq('response->>_status', PROCESSING_STATUS);
}

export async function withIdempotency<T extends Record<string, unknown>>(
  client: SupabaseClient,
  userId: string,
  operation: string,
  idempotencyKey: string | null,
  handler: () => Promise<T>
): Promise<T> {
  if (!idempotencyKey) {
    return handler();
  }

  const claim = await claimIdempotencySlot(client, userId, operation, idempotencyKey);
  if (claim === 'cached') {
    // FIXED (H6): this used to fall through to the handler when the re-read
    // came back empty, so a replay of a COMPLETED checkout ran the checkout
    // again — without holding the claim. A cached claim is not ours to run:
    // either the recorded response comes back, or the caller retries.
    const cached = await getIdempotentResponse<T>(client, userId, operation, idempotencyKey);
    if (cached) return cached;
    throw new ConcurrentIdempotentRequestTimeoutError();
  }
  if (claim === 'failed') {
    throw new IdempotentRetryAfterFailureError();
  }
  if (claim === 'wait') {
    const waited = await waitForCompletedResponse<T>(client, userId, operation, idempotencyKey);
    if (waited) return waited;
    // FIXED (H4b · 4): this used to be a bare Error, which carries no
    // statusCode, so the marketplace error mapper defaulted it to 400 and told
    // the buyer their request was malformed. It is a server-side wait that ran
    // out while another request with the same key was still in flight, so it
    // now carries 409 the way IdempotentRetryAfterFailureError does — the same
    // key is safe to retry.
    throw new ConcurrentIdempotentRequestTimeoutError();
  }

  try {
    const result = await handler();
    await storeIdempotentResponse(client, userId, operation, idempotencyKey, result);
    return result;
  } catch (error) {
    await markIdempotencyFailure(client, userId, operation, idempotencyKey, error);
    throw error;
  }
}
