/**
 * Idempotency keys for money-moving marketplace calls (web half of fix F3).
 *
 * The problem this exists for: every checkout call used to send either no
 * `Idempotency-Key` at all (web) or a FRESH random one per call (mobile), on
 * endpoints that create an order and initialise a Paystack charge. A buyer on a
 * slow link whose request times out client-side — while the server has already
 * created the order — taps Buy again, a different key arrives, and the server
 * has nothing to dedupe on: a SECOND order and a SECOND charge.
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
 * Keys are persisted (sessionStorage on web, AsyncStorage on mobile) so a
 * reload or a cold start mid-checkout still retries with the key the server
 * already knows. Persistence is best-effort: with no storage the map is still
 * correct for the life of the tab, which covers the tap-twice case.
 *
 * Concurrency. The server answers a request that arrives while the SAME key is
 * still in flight with 409 (`ConcurrentIdempotentRequestTimeoutError`). That is
 * not a rejection of the request — it means "the first one is still running" —
 * so `withPurchaseIntent` waits and retries with the SAME key rather than
 * minting a new one, which is exactly what would create the duplicate.
 *
 * KNOWN GAP (reported, needs an API change, see fix-F3 report): the API's other
 * 409 on this path (`IdempotentRetryAfterFailureError`, "a previous attempt with
 * this key failed, use a new one") is indistinguishable from the concurrent one
 * on the wire — the global error handler sends `{error: 'Error', message: ...}`
 * and only the prose differs. Until a machine-readable code is added, both are
 * treated as the concurrent case: retried on the same key and then surfaced.
 * That is the safe side of the ambiguity (a stuck key costs a 10-minute wait; a
 * rotated key after a partially-applied attempt costs a duplicate order).
 *
 * Exports: `purchaseIntentKey`, `resolvePurchaseIntent`,
 * `isIdempotencyConflict`, `withPurchaseIntent`, `resetPurchaseIntentsForTests`.
 * Mobile keeps a byte-identical copy at
 * `apps/mobile/src/services/marketplacePurchaseIntent.ts` — change both.
 */
import { createIdempotencyKey } from '@lantern/shared/api';

/** How many times a 409 "same key still in flight" is retried before surfacing. */
export const PURCHASE_INTENT_CONFLICT_RETRIES = 3;
/** Backoff before each same-key retry. The server itself waits ~5s internally. */
export const PURCHASE_INTENT_RETRY_DELAYS_MS = [700, 1500, 3000];

const STORAGE_KEY = 'lantern_purchase_intent_keys_v1';

const liveKeys = new Map<string, string>();
let hydrated = false;

function readStore(): Record<string, string> | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return null;
  }
}

function writeStore(): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(liveKeys)));
  } catch {
    /* best effort: the in-memory map still covers this tab */
  }
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  const stored = readStore();
  if (!stored) return;
  for (const [scope, key] of Object.entries(stored)) {
    if (typeof key === 'string' && key && !liveKeys.has(scope)) liveKeys.set(scope, key);
  }
}

/**
 * The key for this intent — minted on first use, then stable until the intent
 * resolves. Calling it twice for the same scope returns the same string, which
 * is the whole point: the retry must carry the key the server already saw.
 */
export function purchaseIntentKey(scope: string): string {
  hydrate();
  const existing = liveKeys.get(scope);
  if (existing) return existing;
  // The scope is NOT part of the key: it can be long (cart lines) and the API
  // caps the header at 128 chars, silently ignoring anything longer — which
  // would put us back to no idempotency at all.
  const key = createIdempotencyKey('mkt');
  liveKeys.set(scope, key);
  writeStore();
  return key;
}

/** The intent is over (bought, or refused for a reason the user must fix). */
export function resolvePurchaseIntent(scope: string): void {
  hydrate();
  if (liveKeys.delete(scope)) writeStore();
}

function errorStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown; statusCode?: unknown } | null)?.status;
  if (typeof status === 'number') return status;
  const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof statusCode === 'number' ? statusCode : undefined;
}

/** 409: the same key is still in flight server-side. Retry it, do not rotate. */
export function isIdempotencyConflict(error: unknown): boolean {
  return errorStatus(error) === 409;
}

/**
 * A 4xx the user must act on (bad coupon, out of stock, empty cart). The intent
 * is over, so the key rotates — the next attempt is a genuinely new request.
 * 408 and 409 are excluded: those say "unknown/again", not "wrong".
 */
function isTerminalClientError(error: unknown): boolean {
  const status = errorStatus(error);
  if (typeof status !== 'number') return false;
  return status >= 400 && status < 500 && status !== 408 && status !== 409;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run a money-moving call under a stable idempotency key.
 *
 * `run` receives the key and must send it as the `Idempotency-Key` header.
 * Anything that is not a terminal 4xx (a timeout, a dropped connection, a 5xx)
 * leaves the key in place, so the caller's next attempt is a true retry rather
 * than a second purchase.
 */
export async function withPurchaseIntent<T>(
  scope: string,
  run: (idempotencyKey: string) => Promise<T>
): Promise<T> {
  const key = purchaseIntentKey(scope);
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await run(key);
      resolvePurchaseIntent(scope);
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
      if (isTerminalClientError(error)) resolvePurchaseIntent(scope);
      throw error;
    }
  }
}

/** Test seam only. */
export function resetPurchaseIntentsForTests(): void {
  liveKeys.clear();
  hydrated = false;
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
