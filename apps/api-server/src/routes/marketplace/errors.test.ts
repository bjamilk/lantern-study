/**
 * What the marketplace error mapper puts on the wire (G3 · H7).
 *
 * The two idempotency refusals are both 409s and mean opposite things:
 * IDEMPOTENCY_CONCURRENT is "the same key is still in flight, retry it",
 * IDEMPOTENCY_PREVIOUS_FAILED is "that key is burnt, mint a new one". The
 * mapper used to overwrite both with MARKETPLACE_CONFLICT and, in production,
 * replace the message with "Something went wrong" — so a client could not tell
 * them apart, retried the dead key three times, gave up, and kept it. That
 * purchase was then unusable for the full 10-minute failure TTL.
 *
 * These assertions are about the RESPONSE BODY, because the body is the whole
 * contract: a client branches on `code`, not on English prose.
 */
import {
  ConcurrentIdempotentRequestTimeoutError,
  IdempotentRetryAfterFailureError,
} from '../../services/idempotency';
import { PublicError } from '../../utils/safeError';
import {
  mapMarketplaceError,
  respondMarketplaceClientError,
  respondMarketplaceError,
} from './errors';

function fakeRes() {
  const sent: { status?: number; body?: any } = {};
  const res: any = {
    status(code: number) {
      sent.status = code;
      return res;
    },
    json(body: unknown) {
      sent.body = body;
      return res;
    },
  };
  return { res, sent };
}

describe('marketplace error mapping', () => {
  const ORIGINAL_ENV = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_ENV;
  });

  it('passes IDEMPOTENCY_PREVIOUS_FAILED through with its code and a retryable hint', () => {
    const { res, sent } = fakeRes();
    expect(respondMarketplaceError(res, new IdempotentRetryAfterFailureError(), 400)).toBe(true);
    expect(sent.status).toBe(409);
    expect(sent.body.code).toBe('IDEMPOTENCY_PREVIOUS_FAILED');
    // Retrying the same key can only 409 again — the client must rotate it.
    expect(sent.body.retryable).toBe(false);
    expect(sent.body.error).toMatch(/new Idempotency-Key/i);
  });

  it('passes IDEMPOTENCY_CONCURRENT through as safe to retry unchanged', () => {
    const { res, sent } = fakeRes();
    expect(respondMarketplaceError(res, new ConcurrentIdempotentRequestTimeoutError(), 400)).toBe(
      true,
    );
    expect(sent.status).toBe(409);
    expect(sent.body.code).toBe('IDEMPOTENCY_CONCURRENT');
    expect(sent.body.retryable).toBe(true);
  });

  it('keeps the codes and the real messages in production', () => {
    process.env.NODE_ENV = 'production';
    const failed = mapMarketplaceError(new IdempotentRetryAfterFailureError(), 400);
    expect(failed).toMatchObject({ status: 409, code: 'IDEMPOTENCY_PREVIOUS_FAILED' });
    // Both refusals are PublicErrors, so production does not collapse them into
    // "Something went wrong" — the buyer's client can act on either.
    expect(failed!.message).toMatch(/new Idempotency-Key/i);
    const concurrent = mapMarketplaceError(new ConcurrentIdempotentRequestTimeoutError(), 400);
    expect(concurrent!.message).toMatch(/concurrent/i);
  });

  it('still defaults a plain 409 to MARKETPLACE_CONFLICT', () => {
    const conflict = Object.assign(new PublicError('Order changed while cancelling'), {
      statusCode: 409,
    });
    expect(mapMarketplaceError(conflict, 400)).toMatchObject({
      status: 409,
      code: 'MARKETPLACE_CONFLICT',
    });
  });

  it('never leaks a Postgres error code into the client contract', () => {
    // A PostgrestError is not client-facing at all, and its `code` must not be
    // mistaken for a client contract code even if one ever slips through.
    const pgShaped = Object.assign(new Error('duplicate key'), { code: '23505', statusCode: 409 });
    expect(mapMarketplaceError(pgShaped, 400)).toMatchObject({ code: 'MARKETPLACE_CONFLICT' });
  });

  it('returns null for internal errors so the handler rethrows into the 5xx path', () => {
    const { res } = fakeRes();
    expect(mapMarketplaceError(new Error('PGRST201 embed ambiguity'), 400)).toBeNull();
    expect(respondMarketplaceError(res, new Error('boom'), 400)).toBe(false);
    expect(respondMarketplaceClientError(res, new Error('boom'))).toBe(false);
  });

  it('respondMarketplaceClientError carries the idempotency code too (buy-now, cart)', () => {
    const { res, sent } = fakeRes();
    expect(respondMarketplaceClientError(res, new IdempotentRetryAfterFailureError())).toBe(true);
    expect(sent.status).toBe(409);
    expect(sent.body.code).toBe('IDEMPOTENCY_PREVIOUS_FAILED');
    expect(sent.body.retryable).toBe(false);
  });

  /**
   * G3 · H9: offer-accept wrapped its whole idempotent block in a catch that
   * answered 500 for everything, so a buyer double-tapping Accept got a
   * fabricated server error — which clients classify as retryable-unknown (so
   * they keep the dead key) and which pollutes the 5xx error budget.
   */
  it('offer-accept maps both 409s rather than falling through to its 500', () => {
    for (const err of [
      new IdempotentRetryAfterFailureError(),
      new ConcurrentIdempotentRequestTimeoutError(),
    ]) {
      const { res, sent } = fakeRes();
      // The exact call the offers route makes before its 500 fallback.
      expect(respondMarketplaceError(res, err, 400)).toBe(true);
      expect(sent.status).toBe(409);
      expect(sent.status).not.toBe(500);
      expect(sent.body.code).toMatch(/^IDEMPOTENCY_/);
    }
  });
});
