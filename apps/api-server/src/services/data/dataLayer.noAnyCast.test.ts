/**
 * No `any` cast on the data-layer / facade handle (monolith lane M3).
 *
 * ## Why this exists
 *
 * "`tsc` is the proof" is the claim every step of this decomposition rests on,
 * and it is FALSE wherever the injected handle is cast to `any` first. #92
 * rewrote `this.svc.parseMessageContent(msg)` in `services/challengeService.ts`
 * to `(this.data as any).parseMessageContent(msg)`. `DataLayer` has no such
 * member; the cast told the compiler not to look, so the type-check and the
 * whole suite stayed green while every challenge question resolution threw
 * `parseMessageContent is not a function` in production. It shipped, and it was
 * found by reading, not by a gate (#94 fixed it).
 *
 * So: a call THROUGH a layer or facade handle must be typed. This test reads
 * every non-test `.ts` file under `apps/api-server/src` and fails on
 *
 *  1. a cast of a known HANDLE name to `any` / `unknown` followed by a member
 *     CALL — `(this.data as any).foo(…)`, `(dataLayer as any).foo(…)`,
 *     `(legacyService() as any).foo(…)`, `(this.svc as unknown as any).foo(…)`;
 *  2. any double cast that launders something into a handle type —
 *     `as unknown as SupabaseService`, `as any as DataLayer`.
 *
 * ## Why a member CALL, and not any member access
 *
 * `(data as any).thread_id` in `data/groups.ts` is a query ROW whose PostgREST
 * generic came back as a union — a legitimate, local coercion of data the
 * server just read. Requiring a CALL separates the two cases without a
 * hand-maintained list of every row variable: a handle is used by calling a
 * method on it, a row by reading a field off it. A genuine row method call is
 * the one false positive this can produce, and `ALLOWLIST` takes it with a
 * reason.
 *
 * ## The gotcha
 *
 * The client (`supabase`, `db`, `client`) is deliberately NOT a handle here.
 * `(supabase as any).from(…)` is the PostgREST builder's own typing problem,
 * it is not how a caller reaches a domain method, and folding it in would bury
 * the signal this test exists for. If the client casts ever need a rule, give
 * them their own test rather than widening this one.
 */
import fs from 'fs';
import path from 'path';

const SRC_ROOT = path.join(__dirname, '..', '..');

/**
 * The names a `DataLayer` or `SupabaseService` is bound to across the server:
 * constructor fields, route-module injectables, the `legacyService()` helper
 * every flipped route family declares, and the `data` / `service` parameter
 * names the `services/` free functions take.
 */
const HANDLE_NAMES = [
  'this\\.data',
  'this\\.dataLayer',
  'this\\.layer',
  'this\\.svc',
  'this\\.service',
  'this\\.supabaseService',
  'dataLayer',
  'layer',
  'legacyService\\(\\)',
  'supabaseService',
  'svc',
  'data',
  'service',
];

/** `(<handle> as any|unknown [as …]).member(` — a CALL through a laundered handle. */
const HANDLE_CAST_CALL = new RegExp(
  // `(?![\\w$[])` keeps `as any[]` out: a row ARRAY cast, followed by `.map(`,
  // is the row case again and not a call through a handle.
  `\\(\\s*(?:${HANDLE_NAMES.join('|')})\\s+as\\s+(?:any|unknown)(?![\\w$[])[^)]*\\)\\s*\\.\\s*[A-Za-z_$][\\w$]*\\s*\\(`,
);

/** `as unknown as SupabaseService` / `as any as DataLayer` — laundering INTO a handle. */
const CAST_INTO_HANDLE = /as\s+(?:unknown|any)\s+as\s+(?:SupabaseService|DataLayer)\b/;

/**
 * Reviewed exceptions, `relative/path.ts:<line>` → why. Empty is the goal and
 * the default: add an entry only when the flagged line is genuinely not a call
 * through a layer or facade handle, and say what it is instead.
 */
const ALLOWLIST: Record<string, string> = {};

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      sourceFiles(full, found);
      continue;
    }
    if (!entry.name.endsWith('.ts')) continue;
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.d.ts')) continue;
    found.push(full);
  }
  return found;
}

function findings(): Array<{ where: string; line: string }> {
  const hits: Array<{ where: string; line: string }> = [];
  for (const file of sourceFiles(SRC_ROOT)) {
    const relative = path.relative(SRC_ROOT, file);
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      // A comment describing the pattern (this file's own history is full of
      // them) is documentation, not a call.
      const code = line.replace(/\/\/.*$/, '');
      if (!HANDLE_CAST_CALL.test(code) && !CAST_INTO_HANDLE.test(code)) return;
      const where = `${relative}:${index + 1}`;
      if (where in ALLOWLIST) return;
      hits.push({ where, line: line.trim() });
    });
  }
  return hits;
}

describe('no `any` cast on a data-layer or facade handle', () => {
  it('has no untyped call through a layer or facade handle', () => {
    expect(findings()).toEqual([]);
  });

  it('allowlists nothing that no longer matches', () => {
    // A stale entry is a rule that has quietly stopped applying; it should be
    // deleted, not carried.
    const stale = Object.keys(ALLOWLIST).filter((where) => {
      const [relative, lineNumber] = where.split(':');
      const file = path.join(SRC_ROOT, relative);
      if (!fs.existsSync(file)) return true;
      const line = fs.readFileSync(file, 'utf8').split('\n')[Number(lineNumber) - 1];
      if (line === undefined) return true;
      const code = line.replace(/\/\/.*$/, '');
      return !HANDLE_CAST_CALL.test(code) && !CAST_INTO_HANDLE.test(code);
    });
    expect(stale).toEqual([]);
  });

  it('every allowlist entry carries a reason', () => {
    const blank = Object.entries(ALLOWLIST)
      .filter(([, reason]) => !reason.trim())
      .map(([where]) => where);
    expect(blank).toEqual([]);
  });

  it('actually scans the tree it claims to', () => {
    // Guards the failure mode where a bad root makes every assertion vacuous.
    const files = sourceFiles(SRC_ROOT);
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((f) => f.endsWith(path.join('services', 'challengeService.ts')))).toBe(
      true,
    );
  });

  it('catches the shape that shipped the #92 regression', () => {
    // The guard is only worth its runtime if it recognises the original: a
    // handle laundered through `any`, then called.
    expect(HANDLE_CAST_CALL.test('const parsed = (this.data as any).parseMessageContent(msg);')).toBe(
      true,
    );
    expect(HANDLE_CAST_CALL.test('await (dataLayer as any).getGroupById(id);')).toBe(true);
    expect(HANDLE_CAST_CALL.test('(legacyService() as any).getUserById(uid)')).toBe(true);
    expect(CAST_INTO_HANDLE.test('const svc = layer as unknown as SupabaseService;')).toBe(true);
    // …and that it leaves a query row's field read alone.
    expect(HANDLE_CAST_CALL.test('const threadId = String((data as any).thread_id);')).toBe(
      false,
    );
    // …and a row ARRAY being mapped, which is the same case one indirection on.
    expect(HANDLE_CAST_CALL.test('return (data as any[]).map((row) => ({')).toBe(false);
  });
});
