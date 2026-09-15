/**
 * Idempotency keys for money-moving marketplace calls (mobile half of fix F3).
 *
 * The problem this exists for: every checkout call used to send a FRESH random
 * `Idempotency-Key` per call (`endpoints.ts` defaults to `createIdempotencyKey`
 * when the caller passes `undefined`), on endpoints that create an order and
 * initialise a Paystack charge with a 10s client timeout. A buyer on a slow link
 * whose request aborts client-side — while the server has already created the
 * order — taps Buy again, a different key arrives, and the server has nothing to
 * dedupe on: a SECOND order and a SECOND charge. A random default made every
 * call site LOOK protected while none of them were.
 *
 * The model. A *purchase intent* is one thing the user meant to do: buy this
 * listing at this quantity, check out this exact cart, accept this offer. The
 * caller names the intent with a `scope` string derived from that content, and
 * this module owns one key per live scope:
 *
 *   - minted ONCE, the first time the scope is used (the user taps Buy);
 *   - REUSED verbatim on every retry of the same intent — a network drop, an
 *     app resume, a background sync replay;
 *   - ROTATED (dropped, so the next call mints a new one) only when the intent
 *     has actually resolved: a success, or a terminal 4xx the user must fix.
 *
 * Keys are persisted to AsyncStorage so a cold start mid-checkout still retries
 * with the key the server already knows. Persistence is best-effort: with no
 * storage the map is still correct for the life of the process, which covers
 * the tap-twice case.
 *
 * Concurrency. The server answers a request that arrives while the SAME key is
 * still in flight with 409 (`ConcurrentIdempotentRequestTimeoutError`, surfaced
 * by the shared client as a `VersionConflictError` carrying `status` 409). That
 * is not a rejection — it means "the first one is still running" — so
 * `withPurchaseIntent` waits and retries with the SAME key rather than minting a
 * new one, which is exactly what would create the duplicate.
 *
 * KNOWN GAP (reported, needs an API change, see fix-F3 report): the API's other
 * 409 on this path (`IdempotentRetryAfterFailureError`, "a previous attempt with
 * this key failed, use a new one") is indistinguishable from the concurrent one
 * on the wire — the global error handler sends `{error: 'Error', message: ...}`
 * and the shared client's 409 branch keeps `error` ('Error'), dropping the
 * prose that is the only difference. Until a machine-readable code exists both
 * are treated as the concurrent case: retried on the same key and then
 * surfaced. That is the safe side of the ambiguity (a stuck key costs a
 * 10-minute wait; a rotated key after a partially-applied attempt costs a
 * duplicate order and a duplicate charge).
 *
 * Exports: `purchaseIntentKey`, `resolvePurchaseIntent`, `isIdempotencyConflict`,
 * `withPurchaseIntent`, `resetPurchaseIntentsForTests`. The web keeps a
 * near-identical copy at `services/marketplacePurchaseIntent.ts` (sessionStorage
 * instead of AsyncStorage) — change both.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createIdempotencyKey } from '@lantern/shared/api';

/** How many times a 409 "same key still in flight" is retried before surfacing. */
export const PURCHASE_INTENT_CONFLICT_RETRIES = 3;
/** Backoff before each same-key retry. The server itself waits ~5s internally. */
export const PURCHASE_INTENT_RETRY_DELAYS_MS = [700, 1500, 3000];

const STORAGE_KEY = 'lantern_purchase_intent_keys_v1';

const liveKeys = new Map<string, string>();
let hydrated = false;

async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;
    for (const [scope, key] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof key === 'string' && key && !liveKeys.has(scope)) liveKeys.set(scope, key);
    }
  } catch {
    /* best effort: the in-memory map still covers this process */
  }
}

function persist(): void {
  // Fire-and-forget: a slow disk write must never delay a checkout, and losing
  // the write only costs the cold-start case, not the tap-twice case.
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(liveKeys))).catch(
    () => undefined
  );
}

/**
 * The key for this intent — minted on first use, then stable until the intent
 * resolves. Calling it twice for the same scope returns the same string, which
 * is the whole point: the retry must carry the key the server already saw.
 */
export async function purchaseIntentKey(scope: string): Promise<string> {
  await hydrate();
  const existing = liveKeys.get(scope);
  if (existing) return existing;
  // The scope is NOT part of the key: it can be long (cart lines) and the API
  // caps the header at 128 chars, silently dropping anything longer — which
  // would put us back to no idempotency at all.
  const key = createIdempotencyKey('mkt');
  liveKeys.set(scope, key);
  persist();
  return key;
}

/** The intent is over (bought, or refused for a reason the user must fix). */
export async function resolvePurchaseIntent(scope: string): Promise<void> {
  await hydrate();
  if (liveKeys.delete(scope)) persist();
}

function errorStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === 'number') return status;
  const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof statusCode === 'number' ? statusCode : undefined;
}

/** 409: the same key is still in flight server-side. Retry it, do not rotate. */
export function isIdempotencyConflict(error: unknown): boolean {
  if (errorStatus(error) === 409) return true;
  // The shared client turns every 409 into a VersionConflictError; older copies
  // of it carry the name but not a numeric status.
  return (error as { name?: unknown } | null)?.name === 'VersionConflictError';
}

/**
 * A 4xx the user must act on (bad coupon, out of stock, empty cart). The intent
 * is over, so the key rotates — the next attempt is a genuinely new request.
 * 408 and 409 are excluded: those say "unknown/again", not "wrong".
 */
function isTerminalClientError(error: unknown): boolean {
  if (isIdempotencyConflict(error)) return false;
  const status = errorStatus(error);
  if (typeof status !== 'number') return false;
  return status >= 400 && status < 500 && status !== 408;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run a money-moving call under a stable idempotency key.
 *
 * `run` receives the key and must pass it to the endpoint's `idempotencyKey`
 * argument. Anything that is not a terminal 4xx (a 10s timeout, a dropped
 * connection, a 5xx) leaves the key in place, so the caller's next attempt is a
 * true retry rather than a second purchase.
 */
export async function withPurchaseIntent<T>(
  scope: string,
  run: (idempotencyKey: string) => Promise<T>
): Promise<T> {
  const key = await purchaseIntentKey(scope);
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await run(key);
      await resolvePurchaseIntent(scope);
      return result;
    } catch (error) {
      if (isIdempotencyConflict(error) && attempt < PURCHASE_INTENT_CONFLICT_RETRIES) {
        await sleep(
          PURCHASE_INTENT_RETRY_DELAYS_MS[
            Math.min(attempt, PURCHASE_INTENT_RETRY_DELAYS_MS.length - 1)
          ] ?? 1000
        );
        continue;
      }
      if (isTerminalClientError(error)) await resolvePurchaseIntent(scope);
      throw error;
    }
  }
}

/** Test seam only. */
export function resetPurchaseIntentsForTests(): void {
  liveKeys.clear();
  hydrated = false;
}
