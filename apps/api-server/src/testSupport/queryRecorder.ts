/**
 * testSupport/queryRecorder.ts — TEST ONLY. A PostgREST double that records the
 * chain instead of running it.
 *
 * ## Why
 *
 * Monolith lane R2 moves the queries route files still build by hand into
 * `services/data/*`. A move is only behaviour-preserving if each query still
 * asks the same question, so every route in the lane gets a freeze written
 * against the UNTOUCHED handler: drive the route, record the builder calls, and
 * assert the trace literally — `from("profiles") select("id") eq("id", "u1")
 * maybeSingle()`. It is asserted as a list of strings because a query is exactly
 * the kind of thing that is easy to "clean up" into a different question.
 *
 * PR 1 and PR 2a each carried their own copy of this. PR 2b needs it in six
 * files at once, so it lives here. `routes/marketplace.offers.test.ts` has an
 * older variant of the same idea (`fakeDb`) that resolves per call; this one
 * resolves per TABLE and per chain, which is what a handler that reads the same
 * table twice needs.
 *
 * ## What it records
 *
 * Every builder method in `CHAIN_METHODS`, with its arguments JSON-encoded, in
 * the order they were applied — including the options object of
 * `select(cols, { count: "exact", head: true })` and of `upsert(rows,
 * { onConflict })`, which are the parts a careless rewrite drops first.
 *
 * ## What it does NOT do
 *
 * It never invents results beyond what the caller supplies, and it does not
 * assert them. These functions return PostgREST's `{data, error}` untouched and
 * the routes branch on `error` themselves — a double that faked results would
 * hide exactly the branch a freeze is there to protect.
 *
 * ## The gotcha
 *
 * The builder is THENABLE, so `await`ing it resolves like a real query. That
 * also means anything which duck-types a promise (`Promise.all`, an `await` on
 * the builder itself) works — but a test that forgets to give a second read its
 * own result will silently get the first one. Pass the function form of
 * `resolve` whenever a handler touches the same table twice.
 */

/** One recorded call: the builder method and the arguments it was given. */
export type RecordedCall = string;

export type QueryResult = { data: unknown; error: unknown; count?: number };

/** Resolve by table name and by how many chains have been opened before it. */
export type ResolveResult =
  | QueryResult
  | ((table: string, nth: number) => QueryResult);

export const CHAIN_METHODS = [
  "select",
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "is",
  "not",
  "in",
  "or",
  "ilike",
  "contains",
  "order",
  "limit",
  "range",
  "update",
  "delete",
  "upsert",
  "insert",
  "maybeSingle",
  "single",
] as const;

const fmt = (args: unknown[]): string =>
  args.map((a) => JSON.stringify(a)).join(", ");

export type Recorder = {
  /** Pass to `getClient: () => client`, or to a data function directly. */
  client: any;
  /** The chain, in order, across every table the handler touched. */
  trace: RecordedCall[];
  /** Just the `from("…")` entries — for asserting WHICH tables, and how many. */
  tables: () => RecordedCall[];
  /** GoTrue admin calls, which are not table chains. */
  authCalls: RecordedCall[];
};

export function createQueryRecorder(
  resolve: ResolveResult = { data: null, error: null },
  authResult: Record<string, unknown> = { data: { user: null }, error: null },
): Recorder {
  const trace: RecordedCall[] = [];
  const authCalls: RecordedCall[] = [];
  const resultFor = typeof resolve === "function" ? resolve : () => resolve;
  let opened = 0;

  const openChain = (table: string) => {
    trace.push(`from(${JSON.stringify(table)})`);
    const nth = opened++;
    const builder: any = {
      then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
        Promise.resolve(resultFor(table, nth)).then(ok, err),
    };
    for (const method of CHAIN_METHODS) {
      builder[method] = (...args: unknown[]) => {
        trace.push(`${method}(${fmt(args)})`);
        return builder;
      };
    }
    return builder;
  };

  const admin = (name: string) => (...args: unknown[]) => {
    authCalls.push(`${name}(${fmt(args)})`);
    return Promise.resolve(authResult);
  };

  const client = {
    from: openChain,
    rpc: (fn: string, params: unknown) => {
      trace.push(`rpc(${JSON.stringify(fn)}, ${JSON.stringify(params)})`);
      const nth = opened++;
      const builder: any = {
        then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
          Promise.resolve(resultFor(`rpc:${fn}`, nth)).then(ok, err),
      };
      for (const method of CHAIN_METHODS) {
        builder[method] = (...args: unknown[]) => {
          trace.push(`${method}(${fmt(args)})`);
          return builder;
        };
      }
      return builder;
    },
    auth: {
      admin: {
        getUserById: admin("getUserById"),
        updateUserById: admin("updateUserById"),
        signOut: admin("signOut"),
        listUsers: admin("listUsers"),
      },
    },
  };

  return {
    client,
    trace,
    tables: () => trace.filter((c) => c.startsWith("from(")),
    authCalls,
  };
}

/**
 * Bind a whole `services/data/*` module to a recorder's client, giving a
 * namespace shaped exactly like the one `data/index.ts` builds with `bindDb`.
 * Re-exported from `services/data/testStub` so a suite needs one import.
 */
export { bindDataModule } from "../services/data/testStub";

/**
 * Drive one route body and wait for the RESPONSE.
 *
 * `asyncHandler` swallows its own promise, so awaiting the handler proves
 * nothing — this resolves when `res.json` or `res.send` is called, and rejects
 * when the handler calls `next(err)` or answers nothing within two seconds.
 * The route body is the LAST handler on the layer, so auth and validation
 * middleware are skipped; a suite supplies `req.user` itself.
 *
 * Returns `{ statusCode, body, sent, headers }`: `body` for a JSON answer,
 * `sent` for `res.send` (the sitemaps answer XML).
 */
export async function runRouteHandler(
  router: unknown,
  method: "get" | "post" | "put" | "patch" | "delete",
  path: string,
  req: Record<string, unknown>,
  timeoutMs = 2000,
): Promise<{
  statusCode: number;
  body: any;
  sent: any;
  headers: Record<string, string>;
  cookies: string[];
}> {
  const layer = (router as any).stack?.find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method],
  );
  if (!layer) throw new Error(`route ${method.toUpperCase()} ${path} not found`);
  const handlers = layer.route.stack.map((s: any) => s.handle);
  const handler = handlers[handlers.length - 1] as (
    req: any,
    res: any,
    next: any,
  ) => void;

  const res: any = {
    statusCode: 200,
    body: undefined,
    sent: undefined,
    headers: {} as Record<string, string>,
    cookies: [] as string[],
  };
  await new Promise<void>((resolve, reject) => {
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.set = (key: string, value: string) => {
      res.headers[key] = value;
      return res;
    };
    res.setHeader = res.set;
    // Cookie helpers are recorded, not applied: several handlers clear auth
    // cookies on their way out, and an absent method throws before the response.
    res.cookie = (name: string, ...rest: unknown[]) => {
      res.cookies.push(`cookie(${JSON.stringify(name)})`);
      void rest;
      return res;
    };
    res.clearCookie = (name: string, ...rest: unknown[]) => {
      res.cookies.push(`clearCookie(${JSON.stringify(name)})`);
      void rest;
      return res;
    };
    res.json = (body: unknown) => {
      res.body = body;
      resolve();
      return res;
    };
    res.send = (payload: unknown) => {
      res.sent = payload;
      resolve();
      return res;
    };
    handler(
      { user: { id: "user-1" }, params: {}, query: {}, body: {}, headers: {}, ...req },
      res,
      (err: unknown) => reject(err ?? new Error("next() with no error")),
    );
    setTimeout(() => reject(new Error("route never responded")), timeoutMs).unref?.();
  });
  return res;
}
