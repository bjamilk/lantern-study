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
 *  2. EQUIVALENCE — every one of the names frozen in `supabase.surface.json`
 *     is reachable as EXACTLY ONE `data.<namespace>.<fn>`, or is named in
 *     `NOT_ON_LAYER` below with the reason it is not. A facade method with no
 *     layer home and no allowlist entry fails this test: that is what makes
 *     the deletion of the facade a provable no-op rather than a hope.
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
 * Every facade method name that is deliberately NOT reachable as
 * `data.<namespace>.<fn>`, with the reason. Adding an entry here is a
 * REVIEWED decision: it is the one way a name can leave the facade without a
 * home on the layer.
 */
const NOT_ON_LAYER: Record<string, string> = {
  // Lives on the layer ROOT, not in a namespace: `data.getClient()`. The
  // escape hatch for callers running their own query.
  getClient: 'layer root — `data.getClient()`',
  // The facade's second name for the identical body (`return this.supabase`).
  // The layer has one.
  getSupabaseClient: 'layer root — the facade`s alias of getClient()',
  // Three lines of pure coercion ("compact" | "full") that several data
  // modules take through `deps`. Inlined once in `data/index.ts` rather than
  // published as a namespace member; no caller outside a `deps` literal.
  getResponseProfile: 'private helper, inlined in data/index.ts',
};

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

/** name → the namespaces that publish it. */
function namesByNamespace(): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const { namespace, functions } of currentSurface().namespaces) {
    for (const { name } of functions) {
      index.set(name, [...(index.get(name) ?? []), namespace]);
    }
  }
  return index;
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

describe('the data layer covers the frozen SupabaseService surface', () => {
  const facade: { prototypeMethods: Array<{ name: string; arity: number }> } =
    JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'supabase.surface.json'), 'utf8'),
    );

  it('reaches every frozen facade method as exactly one data.<ns>.<fn>', () => {
    const index = namesByNamespace();
    const homeless: string[] = [];
    const ambiguous: Array<{ name: string; namespaces: string[] }> = [];

    for (const { name } of facade.prototypeMethods) {
      const owners = index.get(name);
      if (!owners) {
        if (!(name in NOT_ON_LAYER)) homeless.push(name);
        continue;
      }
      if (owners.length > 1) ambiguous.push({ name, namespaces: owners });
    }

    expect({ homeless, ambiguous }).toEqual({ homeless: [], ambiguous: [] });
  });

  it('allowlists nothing the layer actually publishes', () => {
    // An entry that goes stale — the name later lands on the layer after all —
    // would silently weaken the check above, so it is an error here.
    const index = namesByNamespace();
    const stale = Object.keys(NOT_ON_LAYER).filter((name) => index.has(name));
    expect(stale).toEqual([]);
  });

  it('allowlists nothing that is not a frozen facade method', () => {
    const frozenNames = new Set(facade.prototypeMethods.map((m) => m.name));
    const unknown = Object.keys(NOT_ON_LAYER).filter(
      (name) => !frozenNames.has(name),
    );
    expect(unknown).toEqual([]);
  });

  it('every allowlist entry carries a reason', () => {
    const blank = Object.entries(NOT_ON_LAYER)
      .filter(([, reason]) => !reason.trim())
      .map(([name]) => name);
    expect(blank).toEqual([]);
  });
});
