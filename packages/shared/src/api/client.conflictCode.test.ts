/**
 * A 409 keeps the body's own `code` and its real sentence.
 *
 * The client turned every 409 into `VersionConflictError(errBody.error ||
 * errBody.message)` with a hard-coded `code = 'version_conflict'`. Two things
 * were lost: the API's own code — the idempotency layer answers 409 with
 * IDEMPOTENCY_CONCURRENT ("retry the same key") or IDEMPOTENCY_PREVIOUS_FAILED
 * ("mint a new one"), which a caller must be able to tell apart — and, when the
 * body came from the global error handler, the message itself, because that
 * handler puts the error CLASS NAME in `error` ('Error') and the sentence in
 * `message`.
 *
 * The class name and `status` are unchanged, so every existing catcher
 * (`isVersionConflictError`, mobile's report/purchase-intent checks) still
 * matches.
 */
import { createApiClient } from './client';
import { isVersionConflictError, VersionConflictError } from './versionConflict';

const BASE = 'https://api.test';
const originalFetch = globalThis.fetch;

function setFetch(body: unknown) {
  (globalThis as { fetch: unknown }).fetch = jest.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      })
  );
}

afterEach(() => {
  (globalThis as { fetch: unknown }).fetch = originalFetch;
  jest.restoreAllMocks();
});

function client() {
  return createApiClient({
    getBaseUrl: () => BASE,
    getAuthHeaders: async () => ({}),
  });
}

async function conflictFrom(body: unknown): Promise<any> {
  setFetch(body);
  return client()
    .request('/marketplace/orders/o1', { method: 'PATCH' })
    .then(
      () => {
        throw new Error('request should have rejected');
      },
      (e) => e
    );
}

describe('409 → VersionConflictError', () => {
  it('carries the API code instead of flattening it to version_conflict', async () => {
    const err = await conflictFrom({
      error: 'Error',
      message: 'Concurrent idempotent request timed out',
      code: 'IDEMPOTENCY_CONCURRENT',
    });

    expect(err).toBeInstanceOf(VersionConflictError);
    expect(err.name).toBe('VersionConflictError');
    expect(err.status).toBe(409);
    expect(err.code).toBe('IDEMPOTENCY_CONCURRENT');
    // The global handler's `error` field is the class name, not a sentence.
    expect(err.message).toBe('Concurrent idempotent request timed out');
    // Existing catchers still recognise it.
    expect(isVersionConflictError(err)).toBe(true);
  });

  it('tells the two idempotency refusals apart', async () => {
    const previous = await conflictFrom({
      error: 'Error',
      message: 'A previous request with this Idempotency-Key failed. Retry with a new Idempotency-Key.',
      code: 'IDEMPOTENCY_PREVIOUS_FAILED',
    });
    expect(previous.code).toBe('IDEMPOTENCY_PREVIOUS_FAILED');
  });

  it('still defaults to version_conflict when the body carries no code', async () => {
    const err = await conflictFrom({ error: 'Note was updated elsewhere', data: { version: 4 } });
    expect(err.code).toBe('version_conflict');
    expect(err.message).toBe('Note was updated elsewhere');
    expect(err.current).toEqual({ version: 4 });
    expect(isVersionConflictError(err)).toBe(true);
  });

  it('keeps preferring the `error` sentence when it is one', async () => {
    const err = await conflictFrom({
      error: 'That offer was already accepted',
      message: 'ignored',
      code: 'MARKETPLACE_CONFLICT',
    });
    expect(err.message).toBe('That offer was already accepted');
    expect(err.code).toBe('MARKETPLACE_CONFLICT');
  });
});
