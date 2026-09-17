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
 * FIXED (#117): `__processing__` now has an expiry too. It never had one — only
 * `__failed__` aged out — so a claim whose holder died (a deploy, a crash, an
 * OOM, or a `markIdempotencyFailure` write that itself failed) owned its key for
 * ever, and every retry on that key waited 5 s and answered 409. The claim now
 * carries `_claimedAt`, and a claim older than `PROCESSING_LEASE_MS` is
 * ABANDONED: the next request compare-and-swaps it (on the old status AND the
 * old timestamp, so two racing retries cannot both win) into `__failed__` — the
 * state the dead attempt would have written itself — which frees the key
 * through the existing stale-failure path. A caller that has proved its handler
 * survives a replay passes `{ leaseReclaim: true }` and takes the key
 * immediately instead. Full derivation, and the per-caller replay-safety table
 * the default comes from, in `docs/idempotency-lease.md`.
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
import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PublicError } from '../utils/safeError';
import { logger } from '../utils/logger';
import { captureScopedException } from '../utils/sentry';
import { bestEffortWrite } from './data/writeResult';

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
/**
 * How long a `__processing__` claim owns its key before it counts as ABANDONED
 * (#117). See `docs/idempotency-lease.md` for the derivation; in short, the
 * number has to clear the longest run a LIVE handler can legitimately have, or
 * the lease would hand a second request a key whose first execution is still
 * working and duplicate its side effects.
 *
 * The ceiling is set by outbound HTTP, not by us. The express request timeout
 * (30 s, `middleware/timeout.ts`) only destroys the socket — the handler keeps
 * running — and `services/paystack.ts` passes NO `AbortSignal`, so a stalled
 * Paystack call is bounded only by undici's defaults (300 s headers + 300 s
 * body ≈ 10 min). The AI path is the tidy counter-example at 120 s
 * (`AI_FETCH_TIMEOUT_MS`), and no AI route is behind this wrapper anyway.
 * 20 minutes is that ~10-minute worst case with a 2x margin.
 *
 * Bounding `paystackFetch` would let this drop to the ~2 minutes the issue
 * suggested; until then a bigger number is the cheap side of the trade, because
 * being late to recover a key costs a client one extra key, while being early
 * costs a buyer a second order.
 */
const PROCESSING_LEASE_MS = 20 * 60 * 1000;
const POLL_INTERVAL_MS = 100;
const POLL_MAX_ATTEMPTS = 50;

/**
 * Per-call policy for `withIdempotency`.
 */
export type IdempotencyOptions = {
  /**
   * May THIS request take an abandoned claim and run the handler again in the
   * same breath? Default FALSE, and the default is the point.
   *
   * An abandoned claim says only "the attempt that held this key never came
   * back". It does not say whether that attempt created the order, charged the
   * card, wrote the ledger row, or did nothing at all — a crash leaves no note.
   * Almost every handler behind this wrapper ends in a plain INSERT or a
   * relative balance change, so replaying it duplicates something. So the
   * default answer to an abandoned claim is not "run it again", it is "retire
   * the claim to `__failed__`, the terminal state this codebase already has a
   * TTL and a test suite for" — which is exactly the state the dead attempt
   * would have reached had `markIdempotencyFailure` survived. The retry then
   * gets the honest, actionable `IDEMPOTENCY_PREVIOUS_FAILED` ("mint a new
   * key") immediately instead of a 5-second wait and a misleading
   * "still in flight", and the key frees itself FAILURE_TTL_MS later through
   * the shipped stale-failure path.
   *
   * `true` is the opt-in for a handler whose every write is guarded — an upsert,
   * a CAS on a status, an RPC that refuses when the row already moved — so that
   * running it twice cannot double anything. It only buys the FAILURE_TTL_MS;
   * it never weakens the CAS.
   */
  leaseReclaim?: boolean;
  /** Injectable clock. Tests age a claim instead of sleeping through a lease. */
  now?: () => number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * What may be logged about a key. The key itself may be client-chosen text (the
 * `Idempotency-Key` header, capped at 128 chars but otherwise arbitrary), so it
 * never reaches a log line or a Sentry tag; a short digest is enough to tie
 * repeated reports to one key.
 */
function keyDigest(idempotencyKey: string): string {
  return createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 12);
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
function isFreshFailureMarker(value: unknown, nowMs: number): boolean {
  if (!isFailureMarker(value)) return false;
  const at = Date.parse(String((value as { _failedAt?: string })._failedAt || ''));
  if (!Number.isFinite(at)) return true;
  return nowMs - at < FAILURE_TTL_MS;
}

/** The marker one attempt writes to say "this key is mine, as of now". */
function processingMarker(nowMs: number): { _status: string; _claimedAt: string } {
  return { _status: PROCESSING_STATUS, _claimedAt: new Date(nowMs).toISOString() };
}

/**
 * When the `__processing__` claim on this row was taken, in ms, or null when
 * that cannot be established.
 *
 * `_claimedAt` is written into the marker itself (#117) rather than into a new
 * column, because the marker is the thing the claim CAS already filters on and
 * a jsonb field needs no migration. Rows claimed before this shipped have no
 * `_claimedAt`, and for those `created_at` IS the claim time: the only write
 * that reaches a `__processing__` marker on an existing row is a reclaim, and
 * every reclaim now stamps `_claimedAt`. Null (an unparsable or missing pair)
 * means "unknown", and an unknown claim is never treated as abandoned.
 */
function processingClaimedAt(response: unknown, createdAt: unknown): number | null {
  const stamped = Date.parse(String((response as { _claimedAt?: string })?._claimedAt || ''));
  if (Number.isFinite(stamped)) return stamped;
  const created = Date.parse(String(createdAt || ''));
  return Number.isFinite(created) ? created : null;
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

/**
 * Take an ABANDONED `__processing__` claim off whoever left it there (#117).
 *
 * The write is the whole safety argument, so it is one statement:
 *
 *   UPDATE api_idempotency_keys SET response = <next>
 *    WHERE user_id = … AND operation = … AND idempotency_key = …
 *      AND response->>'_status'    = '__processing__'
 *      AND response->>'_claimedAt' = <the value this caller READ>   -- or IS NULL
 *   RETURNING idempotency_key
 *
 * PostgreSQL takes a row lock for the duration of that UPDATE, and under READ
 * COMMITTED a second UPDATE that finds the row locked waits, then re-evaluates
 * its WHERE against the row the winner wrote. `_claimedAt` has moved by then,
 * so the loser matches nothing and RETURNING gives it no row. That is why the
 * old timestamp is in the predicate and not just the status: two retries
 * reading the same abandoned claim would otherwise both see `__processing__`
 * and both "win". The returned row is the proof of the claim — exactly one
 * caller can hold it — which is the same shape as the stale-failure reclaim
 * above (G3 · H5) and needs no advisory lock to be correct.
 *
 * `next` is where the policy lives: `__processing__` stamped NOW for a caller
 * that opted into `leaseReclaim` (so the third racer's CAS fails too), and
 * otherwise the `__failed__` marker the dead attempt never got to write.
 */
async function reclaimAbandonedClaim(
  client: SupabaseClient,
  userId: string,
  operation: string,
  idempotencyKey: string,
  previousClaimedAt: string | null,
  ageMs: number,
  options: IdempotencyOptions,
  nowMs: number
): Promise<'claimed' | 'failed' | 'wait'> {
  const reclaim = options.leaseReclaim === true;
  const next = reclaim
    ? processingMarker(nowMs)
    : {
        _status: FAILED_STATUS,
        _failedAt: new Date(nowMs).toISOString(),
        // Tells a reader of the row apart from a handler that actually threw.
        _abandoned: true,
        _error: 'The attempt holding this key never finished (lease expired)',
      };

  const cas = client
    .from('api_idempotency_keys')
    .update({ response: next })
    .eq('user_id', userId)
    .eq('operation', operation)
    .eq('idempotency_key', idempotencyKey)
    .eq('response->>_status', PROCESSING_STATUS);
  // A pre-#117 claim carries no `_claimedAt` at all, and `IS NULL` is the CAS
  // that matches it — PostgREST's `->>` yields SQL NULL for a missing key.
  const scoped =
    previousClaimedAt === null
      ? cas.is('response->>_claimedAt', null)
      : cas.eq('response->>_claimedAt', previousClaimedAt);

  const { data, error } = await scoped.select('idempotency_key').maybeSingle();
  if (error) throw error;
  // No row: another retry took the abandoned claim first. Wait for its answer
  // rather than race it — the same branch the stale-failure loser takes.
  if (!data) return 'wait';

  const scope = { operation, userId, ageMs, keyDigest: keyDigest(idempotencyKey), reclaim };
  logger.warn(
    reclaim
      ? 'Idempotency claim abandoned; re-claimed under the lease'
      : 'Idempotency claim abandoned; retired to a failure marker',
    scope
  );
  if (!reclaim) {
    // The caller opted out of replay, so nothing recovers this key inside this
    // request: report it so somebody can see how often claims are being
    // abandoned at all (a deploy mid-checkout, an OOM, a failed marker write).
    // Ids and an age only — the key is client text and stays hashed.
    captureScopedException(new Error(`Idempotency claim abandoned: ${operation}`), {
      fingerprint: ['idempotency-key-abandoned'],
      tags: { operation, userId },
      extra: scope,
    });
  }
  return reclaim ? 'claimed' : 'failed';
}

async function claimIdempotencySlot(
  client: SupabaseClient,
  userId: string,
  operation: string,
  idempotencyKey: string,
  options: IdempotencyOptions,
  nowMs: number
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
    // Stamped, so the lease can tell an in-flight claim from an abandoned one
    // (#117) and so the reclaim CAS has an old value to compare against.
    response: processingMarker(nowMs),
  });

  if (!error) return 'claimed';

  if (error.code === '23505') {
    const { data, error: readError } = await client
      .from('api_idempotency_keys')
      // `created_at` is the claim time for a row claimed before `_claimedAt`
      // existed; the lease below needs one or the other.
      .select('response, created_at')
      .eq('user_id', userId)
      .eq('operation', operation)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    if (readError) throw readError;
    if (isFreshFailureMarker(data?.response, nowMs)) return 'failed';
    if (isFailureMarker(data?.response)) {
      // Stale failure: take the key back for this attempt — but only if it is
      // STILL a failure marker when the write lands. Without the status filter
      // (H5) two simultaneous retries both "reclaimed" the same key and both
      // re-entered the money handler. The filter makes the reclaim a CAS and
      // the returned row is the proof: no row means another attempt won it, so
      // this caller waits for that attempt's response instead of racing it.
      const { data: reclaimed, error: reclaimError } = await client
        .from('api_idempotency_keys')
        // Stamped with THIS attempt's claim time (#117). Without it the fresh
        // claim would fall back to the row's `created_at`, which is the ORIGINAL
        // claim's age, and the very next request would read the key as abandoned.
        .update({ response: processingMarker(nowMs) })
        .eq('user_id', userId)
        .eq('operation', operation)
        .eq('idempotency_key', idempotencyKey)
        .eq('response->>_status', FAILED_STATUS)
        .select('idempotency_key')
        .maybeSingle();
      if (reclaimError) throw reclaimError;
      return reclaimed ? 'claimed' : 'wait';
    }
    if (isProcessingResponse(data?.response)) {
      // FIXED (#117): `__processing__` used to fall straight to 'wait' with no
      // staleness handling of any kind, so a claim whose holder died — a
      // deploy, a crash, an OOM, or a failed `markIdempotencyFailure` write —
      // made every retry on that key wait 5 s and answer 409, for ever.
      const claimedAt = processingClaimedAt(data?.response, data?.created_at);
      // Unknown claim time: treat the claim as live. Being slow to free a key
      // costs a client one extra key; being wrong here costs a buyer a second
      // order.
      if (claimedAt === null) return 'wait';
      const ageMs = nowMs - claimedAt;
      if (ageMs < PROCESSING_LEASE_MS) return 'wait';
      return reclaimAbandonedClaim(
        client,
        userId,
        operation,
        idempotencyKey,
        (data?.response as { _claimedAt?: string })?._claimedAt ?? null,
        ageMs,
        options,
        nowMs
      );
    }
    if (data?.response) {
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
  // MUST BE SEEN, not must block (#108). This runs in the `catch` of
  // `withIdempotency`, one line before the handler's own error is rethrown, so
  // throwing here would REPLACE the error the caller needs with this one.
  //
  // It is reported at error level under a fingerprint because losing this write
  // leaves the claim at `__processing__` with nobody behind it. Since #117 that
  // is no longer permanent — the lease retires the claim PROCESSING_LEASE_MS
  // later — but it is still 20 minutes of a key answering 409 for no reason,
  // and a burst of them says a replica is dying mid-handler.
  bestEffortWrite(
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
    .eq('response->>_status', PROCESSING_STATUS),
    { table: 'api_idempotency_keys', op: 'update', userId, operation },
    'error',
    'idempotency-failure-marker-write-failed',
  );
}

export async function withIdempotency<T extends Record<string, unknown>>(
  client: SupabaseClient,
  userId: string,
  operation: string,
  idempotencyKey: string | null,
  handler: () => Promise<T>,
  options: IdempotencyOptions = {}
): Promise<T> {
  if (!idempotencyKey) {
    return handler();
  }

  const nowMs = (options.now ?? Date.now)();
  const claim = await claimIdempotencySlot(
    client,
    userId,
    operation,
    idempotencyKey,
    options,
    nowMs
  );
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
