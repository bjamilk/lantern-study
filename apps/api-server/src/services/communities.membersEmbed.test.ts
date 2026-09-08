/**
 * Regression guard for the 2026-09-08 production roster outage.
 *
 * Migration 20260908120000_community_governance added
 * `community_members.muted_by uuid REFERENCES public.profiles(id)`. Since
 * `community_members.user_id` ALREADY references public.profiles(id), the table
 * now has TWO foreign keys to profiles, so a bare embed —
 * `profiles!inner(...)` — is ambiguous and PostgREST answers PGRST201, which
 * the roster rendered to students as raw red "Invalid reference or
 * relationship". The house fix is to NAME the constraint the embed resolves
 * through (`community_members_user_id_fkey`, the auto-name from
 * 20260824120000), exactly as the rest of the codebase disambiguates
 * (`profiles!marketplace_offers_buyer_id_fkey`, `profiles!class_members_user_id_fkey`).
 *
 * A unit test cannot exercise PostgREST's relationship resolver, so the durable
 * form is a source scan: every `profiles` embed written against
 * `community_members` MUST carry the disambiguating hint, and no bare
 * `profiles!inner(` may reappear in this file — a later edit that drops the
 * hint fails here instead of in production.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const SOURCE = readFileSync(join(__dirname, 'communities.ts'), 'utf8');

describe('community_members -> profiles embeds are disambiguated', () => {
  it('never embeds profiles by the bare (ambiguous) relationship', () => {
    // muted_by makes `profiles` (unqualified) ambiguous from community_members.
    // No embed in this file may guess; each must name the fkey.
    const bare = SOURCE.match(/profiles!inner\(/g) ?? [];
    expect(bare).toEqual([]);
  });

  it('resolves every profiles embed through community_members_user_id_fkey', () => {
    // Grab each `profiles!<hint>` occurrence and assert the hint is the
    // user_id constraint, never `muted_by` and never nothing.
    const hints = [...SOURCE.matchAll(/profiles!([A-Za-z0-9_]+)/g)].map((m) => m[1]);
    expect(hints.length).toBeGreaterThan(0);
    for (const hint of hints) {
      expect(hint).toBe('community_members_user_id_fkey');
    }
  });
});
