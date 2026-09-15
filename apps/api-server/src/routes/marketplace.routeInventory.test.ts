/**
 * Route inventory guard for the marketplace router (R5a).
 *
 * The marketplace HTTP surface was one 4.3k-line `routes/marketplace.ts`; R5a
 * split it into `routes/marketplace/` sub-routers mounted by an `index.ts`.
 * The split is only safe if the *registered surface* is identical: same methods,
 * same paths, same middleware in the same order — and no route made unreachable
 * by an earlier pattern.
 *
 * `marketplace.preSplitInventory.json` is the surface recorded from the single
 * file BEFORE the split (this test was written first, run against the old file,
 * and its output frozen). Three assertions stand on it:
 *
 *   1. As a multiset, the post-split surface equals the pre-split one exactly —
 *      every method, path and middleware chain, byte for byte.
 *   2. The one order-sensitive pair (`GET /listings/batch` before
 *      `GET /listings/:id`) still resolves in that order.
 *   3. No route anywhere in the surface is shadowed by an earlier pattern of the
 *      same method, which is the general form of (2) and what makes the
 *      remaining ordering differences — routes moving between sub-routers —
 *      provably irrelevant to Express resolution.
 *
 * The ordered snapshot is kept too, so any *future* reordering is still a
 * visible, reviewed diff rather than a silent one.
 *
 * WHEN THE BASELINE WAS TAKEN (review M16). The frozen file is NOT a record of
 * the committed HEAD (`e2fa40f4`): it was captured from the working tree, after
 * lane F7b had already removed the chainless `handleValidationErrors` layers
 * from this router. HEAD's single file mentions `handleValidationErrors` 36
 * times, the baseline records 21 — 15 routes' worth of layers — and those
 * removals belong to F7b, not to the split. They are behaviour-free: a
 * `handleValidationErrors` with no `express-validator` chain in front of it
 * reads an empty `validationResult` and calls `next()`
 * (`middleware/validation.ts:30-56`). Consequence: assertion (1) cannot be
 * re-derived from `git show HEAD:` and, on its own, would let another lane's
 * diff pass unexamined.
 *
 * So a fourth assertion does not trust the frozen file at all: it extracts the
 * (method, path) pairs from HEAD's `routes/marketplace.ts` with `git show` and
 * requires every one of them to still be registered. That half of the surface —
 * which URLs answer at all — is then independently verified, whatever the
 * baseline recorded about middleware chains.
 */
import { execFileSync } from 'child_process';
import path from 'path';
import type { Router } from 'express';
import marketplaceRouter from './marketplace';
import preSplitInventory from './marketplace.preSplitInventory.json';

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
      const path = prefix + (layer.route.path ?? layerPath(layer));
      const methods = Object.keys(layer.route.methods || {})
        .filter((m) => layer.route.methods[m])
        .sort();
      const handlers: string[] = (layer.route.stack ?? []).map((s: any, i: number) =>
        handlerName(s.handle, i)
      );
      for (const method of methods) {
        out.push({ method: method.toUpperCase(), path, handlers });
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

/** The commit the router was split from — the last one with the single file. */
const PRE_SPLIT_COMMIT = 'e2fa40f4';
const PRE_SPLIT_SOURCE = 'apps/api-server/src/routes/marketplace.ts';
/** How many distinct `METHOD /path` pairs that file registered. */
const PRE_SPLIT_ROUTE_COUNT = 106;
/**
 * Routes the split is allowed to have ADDED. Empty by design: R5a moved code,
 * it did not extend the surface. A new marketplace route lands here (with the
 * change that introduced it) or the guard fails.
 */
const DOCUMENTED_ADDITIONS: string[] = [];

/**
 * `METHOD /path` for every route HEAD's single file registered, read straight
 * out of git so no frozen artefact stands between this test and the truth.
 *
 * `\s*` after the paren is load-bearing: most registrations in that file put
 * the path on the next line. Returns null when the commit is not in the clone.
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

const entries = collect(marketplaceRouter);
const lines = entries.map((e) => `${e.method} ${e.path} [${e.handlers.join(', ')}]`);

/** `/listings/:id` → a regex that matches what Express would route to it. */
function pathMatcher(p: string): RegExp {
  const body = p
    .split('/')
    .map((seg) => (seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^${body}/?$`);
}

/** `/listings/:id` → a concrete path a client could send. */
function samplePath(p: string): string {
  return p
    .split('/')
    .map((seg) => (seg.startsWith(':') ? 'sample' : seg))
    .join('/');
}

describe('marketplace router inventory', () => {
  it('registers the expected number of routes', () => {
    expect(lines.length).toBe(preSplitInventory.length);
  });

  /**
   * The one intentional change to the surface: R5a fix (b) gave
   * PATCH /orders/:id the `idempotencyMiddleware` its money siblings already
   * carried, so its chain gains exactly one anonymous layer between
   * authMiddleware and the handler. Everything else must be untouched.
   */
  const EXPECTED_CHANGES: Array<[string, string]> = [
    [
      'PATCH /orders/:id [authMiddleware, anon#1]',
      'PATCH /orders/:id [authMiddleware, anon#1, anon#2]',
    ],
  ];

  it('is the same surface as before the split, bar the one recorded change', () => {
    const expected = [...preSplitInventory];
    for (const [before, after] of EXPECTED_CHANGES) {
      const at = expected.indexOf(before);
      expect(at).toBeGreaterThanOrEqual(0);
      expected[at] = after;
    }
    expect([...lines].sort()).toEqual(expected.sort());
  });

  /**
   * The independent check (review M16): HEAD's own source, read through git,
   * rather than the frozen JSON a sibling lane's diff had already touched.
   */
  it('still registers every route the pre-split HEAD file registered', () => {
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

  it('keeps the one order-sensitive pair in order: /listings/batch before /listings/:id', () => {
    const batch = lines.findIndex((l) => l.startsWith('GET /listings/batch '));
    const byId = lines.findIndex((l) => l.startsWith('GET /listings/:id ['));
    expect(batch).toBeGreaterThanOrEqual(0);
    expect(byId).toBeGreaterThanOrEqual(0);
    expect(batch).toBeLessThan(byId);
  });

  it('has no route shadowed by an earlier pattern (so cross-file ordering is irrelevant)', () => {
    const shadowed: string[] = [];
    for (let i = 0; i < entries.length; i++) {
      const later = entries[i];
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
    // The only shadowing pair in the surface is the literal-before-param one the
    // previous test pins; a param route never precedes its own literal sibling.
    expect(shadowed).toEqual([]);
  });

  it('has no duplicate method+path registrations', () => {
    const seen = new Map<string, number>();
    for (const e of entries) {
      const key = `${e.method} ${e.path}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    expect([...seen.entries()].filter(([, n]) => n > 1)).toEqual([]);
  });

  it('matches the recorded post-split registration order', () => {
    expect(lines.join('\n')).toMatchSnapshot();
  });
});
