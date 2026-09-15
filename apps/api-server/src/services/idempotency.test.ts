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

type Row = {
  user_id: string;
  operation: string;
  idempotency_key: string;
  response: unknown;
};

const COLUMN_READERS: Record<string, (r: Row) => unknown> = {
  user_id: (r) => r.user_id,
  operation: (r) => r.operation,
  idempotency_key: (r) => r.idempotency_key,
  // PostgREST's JSON text accessor, as used by the claim/store CAS.
  'response->>_status': (r) => (r.response as { _status?: string } | null)?._status,
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
            store.push({ ...row });
            return Promise.resolve({ data: row, error: null });
          },
          select(_cols: string) {
            return eqChain(async (filters) => {
              const found = store.find((r) => match(filters, r));
              return { data: found ? { response: found.response } : null, error: null };
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
