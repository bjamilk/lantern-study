/**
 * Tests for the database-backed replay store.
 *
 * The fake client below is a small in-memory Postgres: every `.eq()` in a chain
 * is a real filter, including the JSON one (`response->>_status`), and an
 * `.update()` only touches rows that match ALL of them and returns what it
 * actually wrote. That fidelity is the point — the money guarantees in this
 * file are compare-and-set writes, and a fake whose `update` ignores its
 * filters would pass whether or not the CAS is there (G3 · H5/H6/M13).
 */
import { withIdempotency } from './idempotency';
import { captureScopedException } from '../utils/sentry';

// The abandoned-claim report (#117) is an assertion target, and the real one is
// a no-op without SENTRY_DSN, which would make the assertion vacuous.
jest.mock('../utils/sentry', () => ({ captureScopedException: jest.fn() }));

beforeEach(() => {
  (captureScopedException as jest.Mock).mockClear();
});

type Row = {
  user_id: string;
  operation: string;
  idempotency_key: string;
  response: unknown;
  /** Set by the INSERT the way the table's `DEFAULT now()` does. */
  created_at?: string;
};

const COLUMN_READERS: Record<string, (r: Row) => unknown> = {
  user_id: (r) => r.user_id,
  operation: (r) => r.operation,
  idempotency_key: (r) => r.idempotency_key,
  // PostgREST's JSON text accessors, as used by the claim/store CAS.
  'response->>_status': (r) => (r.response as { _status?: string } | null)?._status,
  'response->>_claimedAt': (r) =>
    (r.response as { _claimedAt?: string } | null)?._claimedAt ?? null,
};

function createMemoryClient(store: Row[] = []) {
  const match = (filters: Array<[string, unknown]>, r: Row) =>
    filters.every(([col, val]) => {
      const read = COLUMN_READERS[col];
      if (!read) throw new Error(`fake client: unknown column filter ${col}`);
      return read(r) === val;
    });

  const eqChain = (onDone: (filters: Array<[string, unknown]>) => Promise<unknown>) => {
    const filters: Array<[string, unknown]> = [];
    const chain: any = {
      eq(col: string, val: unknown) {
        filters.push([col, val]);
        return chain;
      },
      // PostgREST `is.null` on a JSON accessor: a missing key reads as SQL NULL.
      is(col: string, val: unknown) {
        filters.push([col, val]);
        return chain;
      },
      select() {
        return chain;
      },
      maybeSingle: () => onDone(filters),
      then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
        Promise.resolve(onDone(filters)).then(resolve, reject);
      },
    };
    return chain;
  };

  return {
    store,
    client: {
      rpc: jest.fn(async () => ({ data: null, error: null })),
      from(_table: string) {
        return {
          insert(row: Row) {
            if (
              store.some((r) =>
                match(
                  [
                    ['user_id', row.user_id],
                    ['operation', row.operation],
                    ['idempotency_key', row.idempotency_key],
                  ],
                  r
                )
              )
            ) {
              return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate' } });
            }
            // The table's `created_at timestamptz NOT NULL DEFAULT now()`.
            store.push({ created_at: new Date().toISOString(), ...row });
            return Promise.resolve({ data: row, error: null });
          },
          select(_cols: string) {
            return eqChain(async (filters) => {
              const found = store.find((r) => match(filters, r));
              return {
                data: found
                  ? { response: found.response, created_at: found.created_at ?? null }
                  : null,
                error: null,
              };
            });
          },
          update(patch: { response: unknown }) {
            return eqChain(async (filters) => {
              // Every filter applies, so a CAS that loses writes nothing and
              // reports no row — exactly what the service branches on.
              const row = store.find((r) => match(filters, r));
              if (!row) return { data: null, error: null };
              row.response = patch.response;
              return { data: { idempotency_key: row.idempotency_key }, error: null };
            });
          },
          delete() {
            return eqChain(async (filters) => {
              const idx = store.findIndex((r) => match(filters, r));
              if (idx >= 0) store.splice(idx, 1);
              return { data: null, error: null };
            });
          },
        };
      },
    },
  };
}

describe('withIdempotency', () => {
  it('claims once and returns cached body on second request', async () => {
    const { client } = createMemoryClient();
    const handler = jest.fn(async () => ({ ok: true, n: 1 }));

    const first = await withIdempotency(client as any, 'user-1', 'op', 'key-a', handler);
    const second = await withIdempotency(client as any, 'user-1', 'op', 'key-a', handler);

    expect(first).toEqual({ ok: true, n: 1 });
    expect(second).toEqual({ ok: true, n: 1 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('holds the key after a handler failure so a blind retry cannot re-run it', async () => {
    // Deleting the slot (the old behaviour) let an automatic client retry
    // re-enter the handler — and a checkout handler that threw AFTER creating
    // an order then created a second one. The key stays owned by the failure.
    const { client, store } = createMemoryClient();
    const failing = jest.fn(async () => {
      throw new Error('boom');
    });

    await expect(
      withIdempotency(client as any, 'user-1', 'op', 'key-b', failing)
    ).rejects.toThrow('boom');

    const row = store.find((r) => r.idempotency_key === 'key-b');
    expect(row).toBeDefined();
    expect((row!.response as any)._status).toBe('__failed__');

    const retry = jest.fn(async () => ({ recovered: true }));
    await expect(
      withIdempotency(client as any, 'user-1', 'op', 'key-b', retry)
    ).rejects.toThrow(/new Idempotency-Key/i);
    expect(retry).not.toHaveBeenCalled();
  });

  it('a fresh key after a failure works normally', async () => {
    const { client } = createMemoryClient();
    await expect(
      withIdempotency(client as any, 'user-1', 'op', 'key-c', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    const ok = jest.fn(async () => ({ recovered: true }));
    const result = await withIdempotency(client as any, 'user-1', 'op', 'key-d', ok);
    expect(result).toEqual({ recovered: true });
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it('reclaims a failure marker once its short TTL has passed', async () => {
    const { client, store } = createMemoryClient();
    await expect(
      withIdempotency(client as any, 'user-1', 'op', 'key-e', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    // Age the marker past the TTL.
    const row = store.find((r) => r.idempotency_key === 'key-e')!;
    (row.response as any)._failedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const ok = jest.fn(async () => ({ recovered: true }));
    const result = await withIdempotency(client as any, 'user-1', 'op', 'key-e', ok);
    expect(result).toEqual({ recovered: true });
    expect(ok).toHaveBeenCalledTimes(1);
  });

  /**
   * G3 · H5. The reclaim of a stale failure marker is itself a claim. It used
   * to be an unconditional update whose result was discarded, so two retries
   * arriving together both got 'claimed' and both ran the money handler —
   * two orders and two Paystack charges for one checkout.
   */
  it('lets only ONE of two simultaneous retries reclaim a stale failure marker', async () => {
    const { client, store } = createMemoryClient();
    await expect(
      withIdempotency(client as any, 'user-1', 'op', 'key-race', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    const row = store.find((r) => r.idempotency_key === 'key-race')!;
    (row.response as any)._failedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    let running = 0;
    let maxConcurrent = 0;
    const handler = jest.fn(async () => {
      running += 1;
      maxConcurrent = Math.max(maxConcurrent, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return { charged: true };
    });

    const results = await Promise.allSettled([
      withIdempotency(client as any, 'user-1', 'op', 'key-race', handler),
      withIdempotency(client as any, 'user-1', 'op', 'key-race', handler),
    ]);

    // The money handler ran once, and never twice at the same time.
    expect(handler).toHaveBeenCalledTimes(1);
    expect(maxConcurrent).toBe(1);
    // The loser either waited for the winner's response or was told to retry —
    // never a second charge.
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    for (const r of fulfilled) {
      expect((r as PromiseFulfilledResult<unknown>).value).toEqual({ charged: true });
    }
    for (const r of results.filter((r) => r.status === 'rejected')) {
      expect((r as PromiseRejectedResult).reason).toMatchObject({
        statusCode: 409,
        code: 'IDEMPOTENCY_CONCURRENT',
      });
    }
  });

  it('does not reclaim a failure marker another attempt already took', async () => {
    const { client, store } = createMemoryClient();
    await expect(
      withIdempotency(client as any, 'user-1', 'op', 'key-taken', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    const row = store.find((r) => r.idempotency_key === 'key-taken')!;
    (row.response as any)._failedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    // Another replica reclaims it between our read and our write: the row is no
    // longer a failure marker when the CAS lands.
    const realFrom = (client as any).from.bind(client);
    (client as any).from = (table: string) => {
      const api = realFrom(table);
      const originalUpdate = api.update;
      api.update = (patch: any) => {
        row.response = { _status: '__processing__' };
        api.update = originalUpdate;
        return originalUpdate.call(api, patch);
      };
      return api;
    };

    const handler = jest.fn(async () => ({ charged: true }));
    await expect(
      withIdempotency(client as any, 'user-1', 'op', 'key-taken', handler)
    ).rejects.toMatchObject({ statusCode: 409, code: 'IDEMPOTENCY_CONCURRENT' });
    expect(handler).not.toHaveBeenCalled();
  });

  /**
   * G3 · H6. A 'cached' claim used to fall through to the handler whenever the
   * cached re-read came back empty — so a replay of an already-completed
   * checkout ran the checkout again, without holding the claim.
   */
  it('never runs the handler on a cached claim whose re-read comes back empty', async () => {
    const { client, store } = createMemoryClient();
    store.push({
      user_id: 'user-1',
      operation: 'op',
      idempotency_key: 'key-cached',
      response: { ok: true },
    });

    // The completed row vanishes between the claim and the re-read (a transient
    // read failure, or a reclaim by another attempt).
    const realFrom = (client as any).from.bind(client);
    (client as any).from = (table: string) => {
      const api = realFrom(table);
      const originalSelect = api.select;
      api.select = (cols: string) => {
        const idx = store.findIndex((r) => r.idempotency_key === 'key-cached');
        const chain = originalSelect.call(api, cols);
        if (idx >= 0) store.splice(idx, 1);
        return chain;
      };
      return api;
    };

    const handler = jest.fn(async () => ({ chargedAgain: true }));
    await expect(
      withIdempotency(client as any, 'user-1', 'op', 'key-cached', handler)
    ).rejects.toMatchObject({ statusCode: 409, code: 'IDEMPOTENCY_CONCURRENT' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns the cached body on a cached claim without running the handler', async () => {
    const { client, store } = createMemoryClient();
    store.push({
      user_id: 'user-1',
      operation: 'op',
      idempotency_key: 'key-hit',
      response: { orderId: 'ord_1' },
    });
    const handler = jest.fn(async () => ({ orderId: 'ord_2' }));
    await expect(
      withIdempotency(client as any, 'user-1', 'op', 'key-hit', handler)
    ).resolves.toEqual({ orderId: 'ord_1' });
    expect(handler).not.toHaveBeenCalled();
  });

  /**
   * G3 · M13. A slow original handler that finishes after its key was reclaimed
   * must not overwrite the reclaimer's response — nor bury it under a failure
   * marker when the late attempt throws.
   */
  it('a late handler cannot overwrite the response of whoever reclaimed its key', async () => {
    const { client, store } = createMemoryClient();
    const slow = withIdempotency(client as any, 'user-1', 'op', 'key-late', async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { from: 'slow' };
    });
    // The key is reclaimed and completed by someone else while `slow` runs.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const row = store.find((r) => r.idempotency_key === 'key-late')!;
    row.response = { from: 'reclaimer' };

    await expect(slow).resolves.toEqual({ from: 'slow' });
    expect(row.response).toEqual({ from: 'reclaimer' });
  });

  it('a late FAILING handler cannot bury the reclaimer response under a failure marker', async () => {
    const { client, store } = createMemoryClient();
    const slow = withIdempotency(client as any, 'user-1', 'op', 'key-late-fail', async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      throw new Error('too late');
    });
    slow.catch(() => {}); // the rejection is asserted below; do not go unhandled
    await new Promise((resolve) => setTimeout(resolve, 5));
    const row = store.find((r) => r.idempotency_key === 'key-late-fail')!;
    row.response = { from: 'reclaimer' };

    await expect(slow).rejects.toThrow('too late');
    expect(row.response).toEqual({ from: 'reclaimer' });
  });

  it('both refusals carry a machine-readable code and a retryable hint', async () => {
    const { client } = createMemoryClient();
    await expect(
      withIdempotency(client as any, 'user-1', 'op', 'key-codes', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    // Same key inside the failure TTL: mint a new one, retrying is pointless.
    await expect(
      withIdempotency(client as any, 'user-1', 'op', 'key-codes', async () => ({ a: 1 }))
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'IDEMPOTENCY_PREVIOUS_FAILED',
      retryable: false,
      // A PublicError, so the message survives clientErrorMessage in production
      // instead of collapsing into "Something went wrong" (H7).
      name: 'IdempotentRetryAfterFailureError',
    });
  });

  it('passes through when idempotency key is null', async () => {
    const { client } = createMemoryClient();
    const handler = jest.fn(async () => ({ a: 1 }));
    const result = await withIdempotency(client as any, 'user-1', 'op', null, handler);
    expect(result).toEqual({ a: 1 });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

/**
 * #117 — the lease on `__processing__`.
 *
 * Before this, `__processing__` was the only marker with no expiry: a claim
 * whose holder died owned its key for ever and every retry waited 5 s and
 * answered 409. The tests below are the two halves of the fix — a claim older
 * than the lease is ABANDONED and goes somewhere, and a claim younger than it
 * behaves exactly as it did.
 *
 * Time is injected (`{ now }`), never slept: the lease is twenty minutes.
 */
describe('withIdempotency · the abandoned-claim lease (#117)', () => {
  const LEASE_MS = 20 * 60 * 1000;
  const T0 = Date.parse('2026-09-17T12:00:00.000Z');
  const at = (ms: number) => () => T0 + ms;

  /** A row left at `__processing__` by an attempt that never came back. */
  function wedged(store: Row[], key: string, claimedAtMs: number | null) {
    store.push({
      user_id: 'user-1',
      operation: 'op',
      idempotency_key: key,
      response:
        claimedAtMs === null
          ? // A claim written before `_claimedAt` existed: `created_at` is its age.
            { _status: '__processing__' }
          : { _status: '__processing__', _claimedAt: new Date(claimedAtMs).toISOString() },
      created_at: new Date(claimedAtMs ?? T0 - LEASE_MS - 1).toISOString(),
    });
  }

  it('leaves a claim younger than the lease alone: still 409 IDEMPOTENCY_CONCURRENT', async () => {
    jest.useFakeTimers();
    try {
      const store: Row[] = [];
      const { client } = createMemoryClient(store);
      wedged(store, 'key-fresh', T0 - (LEASE_MS - 1000));
      const handler = jest.fn(async () => ({ ok: true }));

      const attempt = withIdempotency(client as any, 'user-1', 'op', 'key-fresh', handler, {
        leaseReclaim: true,
        now: at(0),
      });
      const asserted = expect(attempt).rejects.toMatchObject({
        statusCode: 409,
        code: 'IDEMPOTENCY_CONCURRENT',
      });
      await jest.advanceTimersByTimeAsync(10_000); // the whole 50 x 100 ms poll window
      await asserted;

      expect(handler).not.toHaveBeenCalled();
      // Untouched: a live claim is nobody else's to rewrite.
      expect((store[0].response as any)._status).toBe('__processing__');
    } finally {
      jest.useRealTimers();
    }
  });

  it('re-claims a claim older than the lease when the caller opted in, and runs it once', async () => {
    const store: Row[] = [];
    const { client } = createMemoryClient(store);
    wedged(store, 'key-stale', T0 - LEASE_MS - 1);
    const handler = jest.fn(async () => ({ recovered: true }));

    const result = await withIdempotency(client as any, 'user-1', 'op', 'key-stale', handler, {
      leaseReclaim: true,
      now: at(0),
    });

    expect(result).toEqual({ recovered: true });
    expect(handler).toHaveBeenCalledTimes(1);
    // …and the response is STORED, so the next retry on this key replays it
    // instead of running the handler a second time.
    expect(store[0].response).toEqual({ recovered: true });
    const replay = jest.fn(async () => ({ recovered: 'again' }));
    await expect(
      withIdempotency(client as any, 'user-1', 'op', 'key-stale', replay, { leaseReclaim: true })
    ).resolves.toEqual({ recovered: true });
    expect(replay).not.toHaveBeenCalled();
  });

  it('ages a pre-#117 claim, which has no `_claimedAt`, off its `created_at`', async () => {
    const store: Row[] = [];
    const { client } = createMemoryClient(store);
    wedged(store, 'key-legacy', null);
    const handler = jest.fn(async () => ({ recovered: true }));

    await expect(
      withIdempotency(client as any, 'user-1', 'op', 'key-legacy', handler, {
        leaseReclaim: true,
        now: at(0),
      })
    ).resolves.toEqual({ recovered: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('treats a claim with no usable timestamp at all as live, never as abandoned', async () => {
    jest.useFakeTimers();
    try {
      const store: Row[] = [];
      const { client } = createMemoryClient(store);
      store.push({
        user_id: 'user-1',
        operation: 'op',
        idempotency_key: 'key-undated',
        response: { _status: '__processing__' },
        created_at: undefined,
      });
      const handler = jest.fn(async () => ({ ok: true }));

      const attempt = withIdempotency(client as any, 'user-1', 'op', 'key-undated', handler, {
        leaseReclaim: true,
        now: at(0),
      });
      const asserted = expect(attempt).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONCURRENT' });
      await jest.advanceTimersByTimeAsync(10_000);
      await asserted;
      expect(handler).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  /**
   * The CAS is the whole safety argument: two retries that read the same
   * abandoned claim must not both take it, or the lease would do exactly what
   * it exists to prevent — run one money handler twice. The losing side is
   * driven through the fake client, which applies every filter for real.
   */
  it('lets only ONE of two simultaneous retries take an abandoned claim', async () => {
    const store: Row[] = [];
    const { client } = createMemoryClient(store);
    wedged(store, 'key-race', T0 - LEASE_MS - 1);

    let running = 0;
    let maxConcurrent = 0;
    const handler = jest.fn(async () => {
      running += 1;
      maxConcurrent = Math.max(maxConcurrent, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return { charged: true };
    });

    const results = await Promise.allSettled([
      withIdempotency(client as any, 'user-1', 'op', 'key-race', handler, {
        leaseReclaim: true,
        now: at(0),
      }),
      withIdempotency(client as any, 'user-1', 'op', 'key-race', handler, {
        leaseReclaim: true,
        now: at(0),
      }),
    ]);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(maxConcurrent).toBe(1);
    for (const r of results.filter((r) => r.status === 'fulfilled')) {
      expect((r as PromiseFulfilledResult<unknown>).value).toEqual({ charged: true });
    }
    for (const r of results.filter((r) => r.status === 'rejected')) {
      expect((r as PromiseRejectedResult).reason).toMatchObject({
        statusCode: 409,
        code: 'IDEMPOTENCY_CONCURRENT',
      });
    }
  });

  /**
   * The timestamp has to be IN the predicate, not just the status. Without it
   * the loser's CAS would still see `__processing__` — the winner rewrote the
   * marker to `__processing__` too — and both would "win".
   */
  it('refuses a retry whose read is stale: the CAS compares the claim timestamp', async () => {
    const store: Row[] = [];
    const { client } = createMemoryClient(store);
    wedged(store, 'key-moved', T0 - LEASE_MS - 1);

    // Another replica re-claims it between our read and our write.
    const realFrom = (client as any).from.bind(client);
    (client as any).from = (table: string) => {
      const api = realFrom(table);
      const originalUpdate = api.update;
      api.update = (patch: any) => {
        store[0].response = { _status: '__processing__', _claimedAt: new Date(T0).toISOString() };
        api.update = originalUpdate;
        return originalUpdate.call(api, patch);
      };
      return api;
    };

    const handler = jest.fn(async () => ({ charged: true }));
    await expect(
      withIdempotency(client as any, 'user-1', 'op', 'key-moved', handler, {
        leaseReclaim: true,
        now: at(0),
      })
    ).rejects.toMatchObject({ statusCode: 409, code: 'IDEMPOTENCY_CONCURRENT' });
    expect(handler).not.toHaveBeenCalled();
  });

  /**
   * The DEFAULT, and the answer for every caller whose handler cannot survive a
   * replay: the abandoned claim is retired to the failure marker its dead
   * holder never got to write, the retry is told the honest thing ("mint a new
   * key") straight away instead of waiting 5 s for a "still in flight" that is
   * not true, and the event is reported.
   */
  it('retires an abandoned claim instead of replaying it when reclaim is off', async () => {
    const store: Row[] = [];
    const { client } = createMemoryClient(store);
    wedged(store, 'key-retired', T0 - LEASE_MS - 1);
    const handler = jest.fn(async () => ({ charged: true }));

    await expect(
      withIdempotency(client as any, 'user-1', 'op', 'key-retired', handler, { now: at(0) })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'IDEMPOTENCY_PREVIOUS_FAILED',
      retryable: false,
    });
    expect(handler).not.toHaveBeenCalled();

    const row = store[0].response as any;
    expect(row._status).toBe('__failed__');
    expect(row._abandoned).toBe(true);

    expect(captureScopedException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        fingerprint: ['idempotency-key-abandoned'],
        tags: { operation: 'op', userId: 'user-1' },
      })
    );
    // Ids and an age only: the key is client-chosen text and stays hashed.
    const reported = (captureScopedException as jest.Mock).mock.calls[0][1];
    expect(JSON.stringify(reported)).not.toContain('key-retired');
    expect(reported.extra.ageMs).toBeGreaterThanOrEqual(LEASE_MS);
  });

  /**
   * And the retired key is not dead for ever, which is the whole complaint in
   * #117: FAILURE_TTL_MS later it ages out through the stale-failure path that
   * already shipped, with no new code and no new risk.
   */
  it('frees the retired key through the existing failure TTL', async () => {
    const store: Row[] = [];
    const { client } = createMemoryClient(store);
    wedged(store, 'key-eventually', T0 - LEASE_MS - 1);

    await expect(
      withIdempotency(client as any, 'user-1', 'op', 'key-eventually', async () => ({ a: 1 }), {
        now: at(0),
      })
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_PREVIOUS_FAILED' });

    const handler = jest.fn(async () => ({ recovered: true }));
    await expect(
      withIdempotency(client as any, 'user-1', 'op', 'key-eventually', handler, {
        now: at(10 * 60 * 1000 + 1), // FAILURE_TTL_MS later
      })
    ).resolves.toEqual({ recovered: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('stamps its own claim time when it reclaims a stale FAILURE marker', async () => {
    // Otherwise the fresh claim would be aged off the row's original
    // `created_at` and read as abandoned by the very next request.
    const store: Row[] = [];
    const { client } = createMemoryClient(store);
    store.push({
      user_id: 'user-1',
      operation: 'op',
      idempotency_key: 'key-restamp',
      response: { _status: '__failed__', _failedAt: new Date(T0 - 60 * 60 * 1000).toISOString() },
      created_at: new Date(T0 - 24 * 60 * 60 * 1000).toISOString(),
    });

    let seen: string | undefined;
    await withIdempotency(
      client as any,
      'user-1',
      'op',
      'key-restamp',
      async () => {
        seen = (store[0].response as any)._claimedAt;
        return { ok: true };
      },
      { now: at(0) }
    );
    expect(seen).toBe(new Date(T0).toISOString());
  });
});
