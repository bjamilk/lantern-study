/**
 * Error-mapping policy for the marketplace HTTP surface.
 *
 * Handlers do not rely on the global errorHandler for user-facing states. Two
 * shapes appear:
 *   - `respondMarketplaceClientError(res, err)` — surfaces a service validation
 *     message as 4xx, returns false for anything internal so it rethrows.
 *   - `respondMarketplaceError(res, err, fallbackStatus)` — the order and
 *     payment routes: same classification plus a stable `code`, and returns
 *     false for internal errors so the handler rethrows into the global
 *     errorHandler instead of reporting an outage as the buyer's mistake.
 *
 * FIXED (R5a, was the `isPlainValidation` marker at the top of the old
 * marketplace.ts): both helpers used to classify ANY `new Error(...)` without a
 * `.code` as a client validation error and echo `err.message` verbatim as a
 * 400. Internal messages thrown as bare Errors anywhere under a marketplace
 * service therefore reached the buyer — including idempotency's "Concurrent
 * idempotent request timed out" — and the request was recorded as a 4xx, so it
 * never reached 5xx alerting. The name check is gone: a marketplace service now
 * throws `PublicError` (or a `PublicError` subclass, or an error carrying an
 * explicit 4xx `statusCode`) at each site that means "the caller's problem".
 * Everything else — PostgrestError, TypeError, a 5xx from Paystack, a bare
 * `new Error` nobody marked public — escapes to the global handler as a 500.
 *
 * The explicit contract, in one place:
 *   public  = `err instanceof PublicError` OR a numeric `statusCode`/`status`
 *             in the 4xx range.
 *   private = everything else.
 */
import { clientErrorMessage, PublicError } from '../../utils/safeError';

/** The two ways an error can declare itself the caller's problem. */
function errorStatus(err: unknown): number | undefined {
  const raw = (err as any)?.statusCode ?? (err as any)?.status;
  return typeof raw === 'number' ? raw : undefined;
}

/**
 * An error's OWN machine-readable code, when it has one written for clients.
 *
 * FIXED (G3 · H7): the mapper used to overwrite every 409 with
 * `MARKETPLACE_CONFLICT`, so the two idempotency refusals — which mean opposite
 * things — arrived identical. `IDEMPOTENCY_CONCURRENT` means "the same key is
 * still in flight, retry it"; `IDEMPOTENCY_PREVIOUS_FAILED` means "that key is
 * burnt, mint a new one". Without the distinction a client retried the dead key
 * three times, gave up, kept it, and the buyer's purchase was unusable for the
 * full 10-minute failure TTL behind "Something went wrong".
 *
 * Only SCREAMING_SNAKE identifiers are passed through, so a PostgrestError's
 * `code` ('23505', 'PGRST116') can never leak into a client contract — those
 * errors are not client-facing anyway.
 */
const CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/;

function errorCode(err: unknown): string | undefined {
  const raw = (err as any)?.code;
  return typeof raw === 'string' && CODE_PATTERN.test(raw) ? raw : undefined;
}

/**
 * Whether the client may retry the SAME request unchanged. `true` only when the
 * error says so itself (the concurrent-idempotency wait); a burnt key is
 * explicitly `false` so a client can stop hammering it and rotate instead.
 */
function errorRetryable(err: unknown): boolean | undefined {
  const raw = (err as any)?.retryable;
  return typeof raw === 'boolean' ? raw : undefined;
}

function isClientFacing(err: unknown): boolean {
  const status = errorStatus(err);
  if (typeof status === 'number') {
    // An explicit status always decides, in both directions: a service that
    // stamps 502 on a PublicError is reporting an upstream fault, not a
    // validation error.
    return status >= 400 && status < 500;
  }
  return err instanceof PublicError;
}

export function respondMarketplaceClientError(res: any, err: unknown): boolean {
  if (!isClientFacing(err)) return false;
  const status = errorStatus(err);
  const httpStatus =
    typeof status === 'number' && status >= 400 && status < 500 ? status : 400;
  const code = errorCode(err);
  const retryable = errorRetryable(err);
  // H7: buy-now and cart checkout answer through THIS helper, so it has to
  // carry the idempotency codes too — it emitted none at all before.
  res.status(httpStatus).json({
    success: false,
    error: (err as Error).message,
    ...(code ? { code } : {}),
    ...(retryable === undefined ? {} : { retryable }),
  });
  return true;
}

const MARKETPLACE_ERROR_CODES: Record<number, string> = {
  400: 'MARKETPLACE_REQUEST_INVALID',
  401: 'MARKETPLACE_UNAUTHENTICATED',
  403: 'MARKETPLACE_FORBIDDEN',
  404: 'MARKETPLACE_NOT_FOUND',
  409: 'MARKETPLACE_CONFLICT',
  422: 'MARKETPLACE_REQUEST_INVALID',
  429: 'MARKETPLACE_RATE_LIMITED',
};

/**
 * FIXED (F7b): the single error-mapping helper for the order and payment
 * routes, which used to end in a bare
 * `catch (err) { res.status(400|403).json({ error: clientErrorMessage(err) }) }`.
 *
 * Returns the client-facing status/code/message for an error that really is the
 * caller's problem, and `null` for everything else — a Postgres outage, a
 * PostgREST embed error, a TypeError in a service, a failed Paystack call.
 * `null` means the caller rethrows, so `asyncHandler` hands the error to the
 * global `errorHandler`: the buyer sees an honest 5xx instead of being told a
 * server fault was their mistake, and the failure lands in 5xx alerting instead
 * of hiding in the 4xx rate.
 *
 * `fallbackStatus` is the status that route already used for client errors, so
 * the classification changes but the status a real client error gets does not.
 * An error carrying its own 4xx `statusCode` still wins.
 */
export function mapMarketplaceError(
  err: unknown,
  fallbackStatus = 400
): { status: number; code: string; message: string; retryable?: boolean } | null {
  if (!isClientFacing(err)) return null;
  const status = errorStatus(err);
  const httpStatus =
    typeof status === 'number' && status >= 400 && status < 500 ? status : fallbackStatus;
  const retryable = errorRetryable(err);
  return {
    status: httpStatus,
    // The error's own code wins over the per-status default (H7).
    code:
      errorCode(err) || MARKETPLACE_ERROR_CODES[httpStatus] || 'MARKETPLACE_REQUEST_INVALID',
    message: clientErrorMessage(err),
    ...(retryable === undefined ? {} : { retryable }),
  };
}

/**
 * `mapMarketplaceError` wired to a response. Returns false when the error is
 * internal — the caller must then `throw err`.
 */
export function respondMarketplaceError(
  res: any,
  err: unknown,
  fallbackStatus = 400
): boolean {
  const mapped = mapMarketplaceError(err, fallbackStatus);
  if (!mapped) return false;
  res.status(mapped.status).json({
    success: false,
    error: mapped.message,
    code: mapped.code,
    ...(mapped.retryable === undefined ? {} : { retryable: mapped.retryable }),
  });
  return true;
}
