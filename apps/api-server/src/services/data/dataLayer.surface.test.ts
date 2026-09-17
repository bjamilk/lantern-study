/**
 * Public-surface freeze for the DATA LAYER (monolith lane M3, step 18).
 *
 * ## Why this exists
 *
 * `supabase.surface.test.ts` has guarded every extraction so far by freezing
 * the 381 method names of `SupabaseService.prototype`. Lane M3 DELETES that
 * class, which deletes its net with it. This file is the replacement, and it
 * has to be at least as strict before the class goes, so it is written and
 * committed FIRST, against untouched code.
 *
 * It asserts two things.
 *
 *  1. FREEZE — every namespace of `createDataLayer(...)`, every function name
 *     in it and that function's arity, against `dataLayer.surface.json`. A
 *     namespace that loses a member, or a member that loses a parameter in a
 *     move, is a failing diff rather than a runtime 500.
 *
 *  2. EQUIVALENCE — every one of the 381 names frozen in
 *     `supabase.surface.json` was reachable as exactly one
 *     `data.<namespace>.<fn>`, or named in `NOT_ON_LAYER` with the reason.
 *     That is what made the deletion of the facade a provable no-op rather
 *     than a hope. It ran green through Phases A and B and is RETIRED with the
 *     class it compared against; the allowlist it ended on is kept below as
 *     the record of the three names that were never on a namespace.
 *
 * ## The arity caveat (read before trusting a green arity)
 *
 * `createDataLayer` binds most members through `bindDb` / `bindDbDeps`, whose
 * wrappers are `(...args) => fn(client, …)`. `Function.length` of a rest
 * parameter is 0, so most arities here are 0 and only the members handed out
 * as raw module functions (pure helpers such as
 * `marketplace.pickCompactListingFields`) carry a real one. The arity column
 * is therefore a bonus signal, not the main assertion — the NAME SET is. The
 * facade surface keeps its own arity freeze until it is deleted.
 *
 * ## The gotcha
 *
 * The layer is built here over a Proxy client: nothing is called, only
 * enumerated, so no query is issued.
 * If a future `createDataLayer` starts INVOKING a dep during construction,
 * this test is where it will first be noticed.
 */
import fs from 'fs';
import path from 'path';

import { createDataLayer, type DataLayer } from './index';

type Snapshot = {
  root: Array<{ name: string; kind: string }>;
  namespaces: Array<{
    namespace: string;
    functions: Array<{ name: string; arity: number }>;
  }>;
};

const SNAPSHOT_PATH = path.join(__dirname, 'dataLayer.surface.json');

/**
 * RETIRED (monolith lane M3, Phase B, PR 4). The list below was the allowlist
 * of
 * the EQUIVALENCE check: every one of the 381 names frozen in
 * `supabase.surface.json` had to be reachable as exactly one
 * `data.<ns>.<fn>`, or be named here with a reason. It ran green on every
 * commit of Phases A and B and ended with exactly three entries — the two
 * spellings of the client escape hatch, which live on the layer ROOT, and one
 * private coercion that is inlined in `data/index.ts`. The facade is deleted,
 * so there is nothing left to be equivalent to; the FREEZE above is what
 * carries on.
 */
//   getClient            → layer root, `data.getClient()`: the escape hatch
//                          for callers running their own query;
//   getSupabaseClient    → layer root, the facade's second name for the
//                          identical body (`return this.supabase`);
//   getResponseProfile   → a private three-line coercion ("compact" | "full"),
//                          inlined in `data/index.ts`, with no caller outside
//                          a `deps` literal.

function fakeClient(): never {
  return new Proxy({}, { get: () => () => undefined }) as never;
}

function buildLayer(): DataLayer {
  return createDataLayer({
    client: fakeClient(),
    supabaseUrl: 'http://localhost:54321',
  });
}

function currentSurface(): Snapshot {
  const layer = buildLayer() as unknown as Record<string, unknown>;
  const root: Snapshot['root'] = [];
  const namespaces: Snapshot['namespaces'] = [];

  for (const key of Object.keys(layer).sort()) {
    const value = layer[key];
    if (typeof value === 'object' && value !== null) {
      const members = value as Record<string, unknown>;
      namespaces.push({
        namespace: key,
        functions: Object.keys(members)
          .sort()
          .map((name) => ({
            name,
            arity:
              typeof members[name] === 'function'
                ? (members[name] as (...a: unknown[]) => unknown).length
                : -1,
          })),
      });
      continue;
    }
    root.push({ name: key, kind: typeof value });
  }

  return { root, namespaces };
}

describe('the data layer public surface', () => {
  const frozen: Snapshot = JSON.parse(
    fs.readFileSync(SNAPSHOT_PATH, 'utf8'),
  ) as Snapshot;

  it('exposes exactly the frozen namespaces, members and arities', () => {
    expect(currentSurface()).toEqual(frozen);
  });

  it('the frozen snapshot is not accidentally empty', () => {
    // Guards the failure mode where the snapshot is regenerated from a broken
    // import and every assertion above passes vacuously.
    expect(frozen.namespaces.length).toBeGreaterThan(15);
    const total = frozen.namespaces.reduce(
      (sum, ns) => sum + ns.functions.length,
      0,
    );
    expect(total).toBeGreaterThan(350);
  });
});
