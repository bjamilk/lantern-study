/**
 * Route inventory guard for the admin router (M4).
 *
 * The admin console's HTTP surface is one 2,039-line `routes/admin.ts` with 57
 * direct `.from()` calls, 27 `getClient()` escapes, 55 hand-rolled try/catch
 * handlers and 117 lines of test for the whole thing. M4 converts those
 * handlers to `asyncHandler`, lifts the database access into
 * `services/adminData.ts`, and finally splits the file into `routes/admin/`.
 *
 * This file is the net that makes that safe, and it was written FIRST: the
 * baseline in `admin.preSplitInventory.json` was captured from the single file
 * BEFORE anything moved, by walking the registered Express stack. Each step is
 * behaviour-preserving only if the registered surface stays identical — same
 * methods, same paths, same middleware in the same order — and if no route is
 * made unreachable by an earlier pattern once handlers live in different files.
 *
 * Five assertions stand on that:
 *
 *   1. The surface entry count is unchanged (47 routes, plus whatever
 *      non-route layers `DOCUMENTED_USE_ADDITIONS` records).
 *   2. As a multiset, the current surface equals the frozen one exactly —
 *      every method, path and middleware chain, character for character. The
 *      ORDER is allowed to differ, because the split moves routes between
 *      sub-routers; assertion (4) is what makes that difference provably
 *      irrelevant.
 *   3. Independently of the frozen file: every `METHOD /path` pair that
 *      `ef947980`'s single `routes/admin.ts` registered is still registered,
 *      read straight out of git so no artefact this lane wrote stands between
 *      the test and the truth. That half of the surface — which URLs answer at
 *      all — is verified without trusting the baseline.
 *   4. No route anywhere in the surface is shadowed by an earlier pattern of
 *      the same method. The admin router has no literal-before-parameter pair
 *      to preserve (unlike marketplace's `/listings/batch`), so an empty shadow
 *      set means cross-file mount order cannot change what Express resolves.
 *   5. The ordered snapshot is kept too, so any FUTURE reordering is a visible,
 *      reviewed diff rather than a silent one.
 *
 * Handler names are load-bearing in the baseline. `asyncHandler` returns an
 * unnamed arrow, so wrapping a handler that was already an unnamed arrow keeps
 * its recorded name (`anon#N`) — which is why the try/catch conversion does not
 * show up here as a chain diff. Giving a handler a name, or adding or removing
 * a middleware layer, WILL show up, which is the point.
 *
 * Why the router is collected rather than an app: `routes/admin` exports a bare
 * `Router`, and the `authMiddleware` → `requirePlatformAdmin` →
 * `adminRateLimit` stack is applied at the mount in `server.ts`. The inventory
 * records what the router registers, which is exactly what M4 moves; the mount
 * stack is out of scope and is not touched.
 *
 * After the split `import adminRouter from './admin'` resolves to
 * `routes/admin/index.ts` — the import path no importer had to change, which is
 * the shim.
 */
import { execFileSync } from 'child_process';
import path from 'path';
import type { Router } from 'express';
import adminRouter from './admin';
import preSplitInventory from './admin.preSplitInventory.json';

type Entry = { method: string; path: string; handlers: string[] };

/** A layer's regexp → the literal path it was registered with, Express-style. */
function layerPath(layer: any): string {
  if (typeof layer?.path === 'string') return layer.path;
  const src: string = layer?.regexp?.source ?? '';
  if (src === '^\\/?(?=\\/|$)') return '/';
  const keys: string[] = (layer?.keys ?? []).map((k: any) => k.name);
  let i = 0;
  const cleaned = src
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
    .replace(/\$$/, '')
    .replace(/\(\?:\(\[\^\\\/\]\+\?\)\)/g, () => `:${keys[i++] ?? '?'}`)
    .replace(/\\\//g, '/')
    .replace(/\\\./g, '.')
    .replace(/\(\?:\\\/\)\?/g, '')
    .replace(/\?\(\?=\/\|\$\)/g, '');
  return cleaned || '/';
}

function handlerName(fn: any, index: number): string {
  const name = fn?.name;
  if (name && name !== 'anonymous' && name !== '<anonymous>') return name;
  return `anon#${index}`;
}

function collect(router: Router, prefix = ''): Entry[] {
  const out: Entry[] = [];
  const stack: any[] = (router as any)?.stack ?? [];
  for (const layer of stack) {
    if (layer.route) {
      const routePath = prefix + (layer.route.path ?? layerPath(layer));
      const methods = Object.keys(layer.route.methods || {})
        .filter((m) => layer.route.methods[m])
        .sort();
      const handlers: string[] = (layer.route.stack ?? []).map((s: any, i: number) =>
        handlerName(s.handle, i)
      );
      for (const method of methods) {
        out.push({ method: method.toUpperCase(), path: routePath, handlers });
      }
      continue;
    }
    // A mounted sub-router (`router.use(sub)` / `router.use('/x', sub)`) — recurse.
    if (layer.name === 'router' && layer.handle?.stack) {
      const sub = layerPath(layer);
      out.push(...collect(layer.handle as Router, prefix + (sub === '/' ? '' : sub)));
      continue;
    }
    // Router-level middleware (`router.use(fn)`) — part of the surface too.
    if (typeof layer.handle === 'function' && layer.name !== 'router') {
      out.push({
        method: 'USE',
        path: prefix + layerPath(layer),
        handlers: [handlerName(layer.handle, 0)],
      });
    }
  }
  return out;
}

/** The commit the router is being refactored from — the last single-file one. */
const PRE_SPLIT_COMMIT = 'ef947980';
const PRE_SPLIT_SOURCE = 'apps/api-server/src/routes/admin.ts';
/** How many distinct `METHOD /path` pairs that file registered. */
const PRE_SPLIT_ROUTE_COUNT = 47;

/**
 * Routes the refactor is allowed to have ADDED. Empty by design: M4 moves
 * code, it does not extend the surface. A new admin route lands here (with the
 * change that introduced it) or the guard fails.
 */
const DOCUMENTED_ADDITIONS: string[] = [
  // #113: the read-only marketplace reconciliation findings. It answers a URL
  // the pre-split file never had, so it is recorded here, with the full
  // registered chain below, in the commit that adds it.
  'GET /marketplace/reconcile/findings',
  // #113 Phase B: apply ONE of those findings, by hand, behind a per-class flag
  // that is off by default.
  'POST /marketplace/reconcile/apply',
];

/**
 * The same additions as full surface lines (`METHOD /path [handlers]`), for the
 * multiset assertion. Kept beside `DOCUMENTED_ADDITIONS` rather than derived
 * from the live router: a reviewer should read the middleware chain a new admin
 * route was registered with, not trust it.
 */
const DOCUMENTED_ADDITION_LINES: string[] = [
  'GET /marketplace/reconcile/findings [anon#0]',
  'POST /marketplace/reconcile/apply [anon#0]',
];

/**
 * Non-route surface entries the refactor is allowed to have added — recorded
 * separately from routes because they answer no URL. Empty when this guard was
 * written: the single file registered 47 routes and no router-level
 * middleware. An entry lands here in the same commit that introduces it, so
 * every non-route layer the refactor adds is a line a reviewer has to read.
 */
const DOCUMENTED_USE_ADDITIONS: string[] = [
  // Step 2: the router-scoped error middleware that lets the 47 handlers drop
  // their hand-rolled try/catch and use `asyncHandler` while still answering
  // with this router's own body shape (`{success:false, error}`) rather than
  // the global handler's (`{error, message, timestamp, path}`). After step 4 it
  // is registered by `routes/admin/index.ts`, after every sub-router.
  'USE / [adminErrorHandler]',
];

/**
 * Middleware-chain changes the refactor is allowed to have made. Empty by
 * design, for the reason in the header: wrapping an unnamed arrow in
 * `asyncHandler` yields another unnamed arrow at the same index.
 */
const EXPECTED_CHANGES: Array<[string, string]> = [];

/**
 * `METHOD /path` for every route the pre-refactor commit's single file
 * registered, read straight out of git so no frozen artefact stands between
 * this test and the truth. Returns null when the commit is not in the clone.
 */
function preSplitHeadRoutes(): Set<string> | null {
  let source: string;
  try {
    source = execFileSync('git', ['show', `${PRE_SPLIT_COMMIT}:${PRE_SPLIT_SOURCE}`], {
      cwd: path.resolve(__dirname, '../../../..'),
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }

  const found = new Set<string>();
  const pattern = /router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    found.add(`${match[1].toUpperCase()} ${match[2]}`);
  }
  return found;
}

const entries = collect(adminRouter);
const lines = entries.map((e) => `${e.method} ${e.path} [${e.handlers.join(', ')}]`);

/** `/users/:id` → a regex that matches what Express would route to it. */
function pathMatcher(p: string): RegExp {
  const body = p
    .split('/')
    .map((seg) => (seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^${body}/?$`);
}

/** `/users/:id` → a concrete path a client could send. */
function samplePath(p: string): string {
  return p
    .split('/')
    .map((seg) => (seg.startsWith(':') ? 'sample' : seg))
    .join('/');
}

describe('admin router inventory', () => {
  it('registers the expected number of surface entries', () => {
    expect(lines.length).toBe(
      preSplitInventory.length + DOCUMENTED_USE_ADDITIONS.length + DOCUMENTED_ADDITION_LINES.length,
    );
    expect(entries.filter((e) => e.method !== 'USE').length).toBe(
      PRE_SPLIT_ROUTE_COUNT + DOCUMENTED_ADDITIONS.length,
    );
  });

  it('is the same surface as before the refactor, bar the recorded changes', () => {
    // Multiset, not sequence: sub-routers mount in a different order than the
    // single file declared its routes. The shadow assertion below is what makes
    // that reordering provably irrelevant to Express resolution.
    const expected = [...preSplitInventory, ...DOCUMENTED_USE_ADDITIONS, ...DOCUMENTED_ADDITION_LINES];
    for (const [before, after] of EXPECTED_CHANGES) {
      const at = expected.indexOf(before);
      expect(at).toBeGreaterThanOrEqual(0);
      expected[at] = after;
    }
    expect([...lines].sort()).toEqual(expected.sort());
  });

  /**
   * The independent check: the pre-refactor commit's own source, read through
   * git, rather than a frozen JSON a later commit in this same PR could have
   * been regenerated against.
   */
  it('still registers every route the pre-refactor file registered, read from git', () => {
    const headRoutes = preSplitHeadRoutes();
    if (!headRoutes) {
      // A shallow CI checkout may not contain the commit. Say so loudly rather
      // than reporting a green guard that never ran.
      console.warn(
        `[routeInventory] skipped: ${PRE_SPLIT_COMMIT}:${PRE_SPLIT_SOURCE} is not in this clone`
      );
      return;
    }

    // A regex that silently matches nothing would make this assertion vacuous.
    expect(headRoutes.size).toBe(PRE_SPLIT_ROUTE_COUNT);

    const current = new Set(
      entries.filter((e) => e.method !== 'USE').map((e) => `${e.method} ${e.path}`)
    );
    const missing = [...headRoutes].filter((route) => !current.has(route)).sort();
    expect(missing).toEqual([]);

    const added = [...current].filter((route) => !headRoutes.has(route)).sort();
    expect(added).toEqual([...DOCUMENTED_ADDITIONS].sort());
  });

  it('has no route shadowed by an earlier pattern (so cross-file ordering is irrelevant)', () => {
    const shadowed: string[] = [];
    for (let i = 0; i < entries.length; i++) {
      const later = entries[i];
      if (later.method === 'USE') continue;
      const sample = samplePath(later.path);
      for (let j = 0; j < i; j++) {
        const earlier = entries[j];
        if (earlier.method !== later.method) continue;
        if (earlier.path === later.path) continue; // duplicate registration, checked below
        if (pathMatcher(earlier.path).test(sample)) {
          shadowed.push(
            `${later.method} ${later.path} is shadowed by earlier ${earlier.method} ${earlier.path}`
          );
        }
      }
    }
    // Empty on the pre-refactor file: every parametrised admin path sits under
    // a distinct prefix, so there is no literal-before-param pair to preserve.
    // That is precisely why the split may reorder routes freely.
    expect(shadowed).toEqual([]);
  });

  it('has no duplicate method+path registrations', () => {
    const seen = new Map<string, number>();
    for (const e of entries) {
      if (e.method === 'USE') continue;
      const key = `${e.method} ${e.path}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    expect([...seen.entries()].filter(([, n]) => n > 1)).toEqual([]);
  });

  it('matches the recorded registration order', () => {
    expect(lines.join('\n')).toMatchSnapshot();
  });
});
