/**
 * Public-surface freeze for `services/supabase.ts` (monolith lane M2, step 1).
 *
 * 97 non-test modules import this file and 760 call sites reach 256 of
 * `SupabaseService`'s 381 methods. The decomposition plan
 * (`TEAM-S1-api-structure.md` §3, P0) moves code OUT of the file behind a
 * facade that keeps the same module path, the same class name and the same
 * exports, so that no importer has to change in the same PR as the move.
 *
 * That only works if the surface is genuinely unchanged, and "unchanged" is not
 * something a type-check proves: a method that silently loses a parameter, an
 * export that stops being re-exported, or a delegation that forgets one of the
 * 381 names would all still compile for most callers (optional args, `any`
 * boundaries, dynamic property access) and fail at runtime in production.
 *
 * So this test freezes two lists into `supabase.surface.json`, captured from the
 * untouched 18,257-line file BEFORE any extraction:
 *
 *   1. every own property name of `SupabaseService.prototype` (public and
 *      TypeScript-`private` alike — `private` is erased at runtime, so all 381
 *      are callable and all 381 are frozen), each with its `Function.length`
 *      arity, sorted;
 *   2. every named export of the module, with its `typeof`, sorted.
 *
 * Arity is `Function.length`, i.e. parameters before the first defaulted or
 * rest parameter. That makes the snapshot sensitive to a parameter being
 * dropped or made optional in a move — the exact class of accident a
 * copy-paste extraction produces.
 *
 * If a future step INTENTIONALLY changes the surface (step 18 deletes the class
 * outright), update the JSON in the same commit and say so in the PR. Do not
 * relax the assertions: the point is that the diff is visible and reviewed.
 */
import fs from 'fs';
import path from 'path';

import * as supabaseModule from './supabase';

type Snapshot = {
  prototypeMethods: Array<{ name: string; arity: number }>;
  moduleExports: Array<{ name: string; kind: string }>;
};

const SNAPSHOT_PATH = path.join(__dirname, 'supabase.surface.json');

function currentPrototypeMethods(): Snapshot['prototypeMethods'] {
  const proto = supabaseModule.SupabaseService.prototype as unknown as Record<
    string,
    unknown
  >;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor')
    .map((name) => {
      const descriptor = Object.getOwnPropertyDescriptor(proto, name);
      const value = descriptor?.value;
      return {
        name,
        arity: typeof value === 'function' ? value.length : -1,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function currentModuleExports(): Snapshot['moduleExports'] {
  const mod = supabaseModule as unknown as Record<string, unknown>;
  return Object.keys(mod)
    .map((name) => ({ name, kind: typeof mod[name] }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

describe('services/supabase.ts public surface', () => {
  const frozen: Snapshot = JSON.parse(
    fs.readFileSync(SNAPSHOT_PATH, 'utf8'),
  ) as Snapshot;

  it('exposes exactly the frozen set of prototype methods, with the same arities', () => {
    expect(currentPrototypeMethods()).toEqual(frozen.prototypeMethods);
  });

  it('exposes exactly the frozen set of named module exports', () => {
    expect(currentModuleExports()).toEqual(frozen.moduleExports);
  });

  it('still exports SupabaseService as a constructible class', () => {
    expect(typeof supabaseModule.SupabaseService).toBe('function');
    expect(supabaseModule.SupabaseService.prototype).toBeDefined();
  });

  it('the frozen snapshot is not accidentally empty', () => {
    // Guards the failure mode where the snapshot file is regenerated from a
    // broken import and every assertion above passes vacuously.
    expect(frozen.prototypeMethods.length).toBeGreaterThan(300);
    expect(frozen.moduleExports.length).toBeGreaterThan(10);
  });
});
