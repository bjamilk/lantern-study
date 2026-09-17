/**
 * The money suites' fake PostgREST client, extracted so more than one suite can
 * drive it (#108).
 *
 * It was written for the H4 race tests in `marketplacePayments.security.test.ts`
 * and is the only stub in the tree that records the WHOLE filter chain, which
 * is what lets a test assert on a compare-and-set — which filters a write used,
 * not merely its payload. The write-error tests need the other half of the same
 * ability: making one specific call in a flow resolve with `{ error }`.
 *
 * Moved here verbatim; `marketplacePayments.security.test.ts` now imports it.
 *
 * Gotcha: `.then` is what makes an un-terminated chain awaitable, and it is
 * exactly the shape the production bug hides behind — awaiting the chain
 * resolves with `{ data, error }` rather than rejecting. Resolving a call with
 * `{ error }` here therefore models a failed write faithfully, including that
 * nothing throws.
 */
export type Op = { fn: string; args: unknown[] };
/**
 * One finished chain. An `rpc(name, params)` call is recorded as the pseudo
 * table `rpc:<name>` with terminal `rpc`, so one resolver covers both.
 */
export type Call = { table: string; ops: Op[]; terminal: string };
export type CallResult = { data?: unknown; error?: unknown } | undefined;

/** The chain methods the services use. Each records itself and returns `this`. */
const CHAIN_METHODS = [
  'select',
  'eq',
  'neq',
  'in',
  'or',
  'is',
  'not',
  'gte',
  'lte',
  'gt',
  'lt',
  'like',
  'ilike',
  'contains',
  'textSearch',
  'update',
  'insert',
  'upsert',
  'delete',
  'order',
  'limit',
  'range',
];

/**
 * A recording PostgREST stand-in. `resolve` is called with the finished chain
 * and returns what awaiting it should produce; returning `undefined` means the
 * default `{ data: null, error: null }`.
 */
export function scriptedDb(resolve: (call: Call) => CallResult) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const ops: Op[] = [];
      const chain: any = {};
      for (const fn of CHAIN_METHODS) {
        chain[fn] = (...args: unknown[]) => {
          ops.push({ fn, args });
          return chain;
        };
      }
      const settle = (terminal: string) => {
        const call: Call = { table, ops, terminal };
        calls.push(call);
        return Promise.resolve(resolve(call) ?? { data: null, error: null });
      };
      chain.single = () => settle('single');
      chain.maybeSingle = () => settle('maybeSingle');
      chain.then = (ok: any, err: any) => settle('then').then(ok, err);
      return chain;
    },
    rpc(name: string, params?: unknown) {
      const call: Call = { table: `rpc:${name}`, ops: [{ fn: 'rpc', args: [params] }], terminal: 'rpc' };
      calls.push(call);
      return Promise.resolve(resolve(call) ?? { data: null, error: null });
    },
  };
  return { client, calls };
}

/** Did this call use `fn(…)` with these leading arguments? */
export function usedFilter(call: Call, fn: string, ...args: unknown[]): boolean {
  return call.ops.some(
    (op) => op.fn === fn && args.every((arg, index) => JSON.stringify(op.args[index]) === JSON.stringify(arg)),
  );
}

/** The payload a write was given, or undefined when the call is not that write. */
export function writePayload(call: Call, fn: 'insert' | 'update' | 'upsert'): Record<string, unknown> | undefined {
  const op = call.ops.find((candidate) => candidate.fn === fn);
  return op ? (op.args[0] as Record<string, unknown>) : undefined;
}
