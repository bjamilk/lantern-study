/**
 * The global handler passes a thrown error's machine-readable `code` through to
 * the response body.
 *
 * Why: the two idempotency refusals are both 409s, and in production the F7b
 * message-genericising replaces their prose, so a client could not tell "the
 * same key is still in flight, retry it" (IDEMPOTENCY_CONCURRENT) from "the
 * previous attempt failed, mint a new key" (IDEMPOTENCY_PREVIOUS_FAILED). The
 * body was `{error:'Error', message:<prose>}` and nothing else.
 *
 * Only an UPPER_SNAKE code is passed through, so a PostgREST/Postgres code
 * ('23505', 'PGRST201') never becomes part of the client contract.
 */
import { errorHandler, ApiError } from './errorHandler';
import {
  ConcurrentIdempotentRequestTimeoutError,
  IdempotentRetryAfterFailureError,
} from '../services/idempotency';

function run(err: unknown) {
  const res: any = { statusCode: undefined, body: undefined };
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (b: unknown) => ((res.body = b), res);
  errorHandler(
    err as Error,
    { originalUrl: '/api/v1/marketplace/orders/o1', get: () => undefined } as any,
    res,
    (() => {}) as any
  );
  return res;
}

describe('errorHandler code passthrough', () => {
  it('distinguishes the two idempotency 409s by code', () => {
    const concurrent = run(new ConcurrentIdempotentRequestTimeoutError());
    expect(concurrent.statusCode).toBe(409);
    expect(concurrent.body.code).toBe('IDEMPOTENCY_CONCURRENT');

    const previousFailed = run(new IdempotentRetryAfterFailureError());
    expect(previousFailed.statusCode).toBe(409);
    expect(previousFailed.body.code).toBe('IDEMPOTENCY_PREVIOUS_FAILED');
  });

  it('omits code entirely when the error carries none', () => {
    const res = run(new ApiError('Order is closed', 400));
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toHaveProperty('code');
  });

  it('does not leak a Postgres/PostgREST code as an API code', () => {
    for (const code of ['23505', 'PGRST201', 'p0001', 'ab']) {
      const err = Object.assign(new Error('boom'), { code, statusCode: 409 });
      expect(run(err).body).not.toHaveProperty('code');
    }
  });
});
