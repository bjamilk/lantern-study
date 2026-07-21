import { withIdempotency } from './idempotency';

type Row = {
  user_id: string;
  operation: string;
  idempotency_key: string;
  response: unknown;
};

function createMemoryClient(store: Row[] = []) {
  const match = (filters: Record<string, string>, r: Row) =>
    r.user_id === filters.user_id &&
    r.operation === filters.operation &&
    r.idempotency_key === filters.idempotency_key;

  const eqChain = (onDone: (filters: Record<string, string>) => Promise<unknown>) => {
    const filters: Record<string, string> = {};
    const chain: any = {
      eq(col: string, val: string) {
        filters[col] = val;
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
            if (store.some((r) => match({
              user_id: row.user_id,
              operation: row.operation,
              idempotency_key: row.idempotency_key,
            }, r))) {
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
              const row = store.find((r) => match(filters, r));
              if (row) row.response = patch.response;
              return { data: row, error: null };
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

  it('releases the slot when the handler fails so a retry can claim', async () => {
    const { client, store } = createMemoryClient();
    const failing = jest.fn(async () => {
      throw new Error('boom');
    });

    await expect(
      withIdempotency(client as any, 'user-1', 'op', 'key-b', failing)
    ).rejects.toThrow('boom');

    expect(store.find((r) => r.idempotency_key === 'key-b')).toBeUndefined();

    const ok = jest.fn(async () => ({ recovered: true }));
    const result = await withIdempotency(client as any, 'user-1', 'op', 'key-b', ok);
    expect(result).toEqual({ recovered: true });
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it('passes through when idempotency key is null', async () => {
    const { client } = createMemoryClient();
    const handler = jest.fn(async () => ({ a: 1 }));
    const result = await withIdempotency(client as any, 'user-1', 'op', null, handler);
    expect(result).toEqual({ a: 1 });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
