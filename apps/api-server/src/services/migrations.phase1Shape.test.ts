/**
 * Pins the SQL shape of the seven Phase 1 migrations
 * (supabase/migrations/20260822*.sql) after the 2026-08-22 adversarial review:
 *
 *   - 120000: the moderation-lock trigger exempts GoTrue cascades
 *     (session_user = 'supabase_auth_admin') and any FK cascade / SET NULL
 *     action (pg_trigger_depth() > 1) — otherwise auth.admin.deleteUser failed
 *     on any account that owned a moderated listing.
 *   - 130000: the `institutions` view is security_invoker and hides deactivated
 *     campuses (it bypassed marketplace_campuses RLS before).
 *   - 140000: content_reports is service-role only — no authenticated
 *     INSERT/SELECT grant or policy (clients report through POST /reports).
 *   - 170000: strip_privileged_profile_settings gets the service-role guard
 *     (suspensions persist), marketplace_listings hides the rights/appeal
 *     columns from anon/authenticated via column-level SELECT grants and loses
 *     direct client writes, and purchased packs get their course_id backfilled.
 *
 * These migrations are hand-applied in the Supabase SQL editor; nothing here
 * talks to a database — the tests read the files so a later edit cannot
 * quietly drop one of the guards. The trigger/RPC behaviour of 120000/121000
 * is also pinned by supabase.listingModerationLock.test.ts.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(__dirname, '../../../../supabase/migrations');

const PHASE1_MIGRATIONS = [
  '20260822120000_marketplace_listings_moderation_lock.sql',
  '20260822121000_marketplace_release_escrow_moderation_safe.sql',
  '20260822130000_academic_identity_and_courses.sql',
  '20260822140000_rights_and_moderation.sql',
  '20260822150000_learning_events_and_concepts.sql',
  '20260822160000_library_search_indexes.sql',
  '20260822170000_phase1_hardening.sql',
];

const read = (name: string) => readFileSync(join(MIGRATIONS_DIR, name), 'utf8');

/** The twelve columns 20260822140000 adds to marketplace_listings. */
const MODERATION_COLUMNS = [
  'rights_status',
  'rights_attested_at',
  'rights_attestation_version',
  'moderation_flags',
  'takedown_reason',
  'takedown_at',
  'takedown_by',
  'appeal_status',
  'appeal_note',
  'appealed_at',
  'appeal_decided_at',
  'appeal_decided_by',
];

describe('Phase 1 migrations: ordering', () => {
  it('has all seven files on disk and they sort into the intended apply order', () => {
    const onDisk = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.startsWith('20260822') && f.endsWith('.sql'))
      .sort();
    // Lexicographic order (what `ls` / the SQL-editor checklist uses) must be
    // exactly the documented order, and every file must exist.
    expect(onDisk.filter((f) => PHASE1_MIGRATIONS.includes(f))).toEqual(PHASE1_MIGRATIONS);
    expect([...PHASE1_MIGRATIONS].sort()).toEqual(PHASE1_MIGRATIONS);
    // The hardening migration touches columns created by 130000/140000, so it
    // must be the last of the seven.
    expect(PHASE1_MIGRATIONS[PHASE1_MIGRATIONS.length - 1]).toBe('20260822170000_phase1_hardening.sql');
  });
});

describe('20260822120000 moderation lock: cascade exemptions', () => {
  const sql = read('20260822120000_marketplace_listings_moderation_lock.sql');

  it('exempts GoTrue-driven cascades and nested FK actions', () => {
    expect(sql).toMatch(/session_user = 'supabase_auth_admin'/);
    expect(sql).toMatch(/pg_trigger_depth\(\) > 1/);
    // The existing exemptions stay.
    expect(sql).toMatch(/public\.is_service_role_caller\(\)/);
    expect(sql).toMatch(/session_user IN \('postgres', 'supabase_admin'\)/);
  });

  it('puts the exemptions before the DELETE branch so both UPDATE and DELETE are covered', () => {
    const body = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.marketplace_listings_guard_moderated_status'));
    const exemptAt = body.indexOf("pg_trigger_depth() > 1");
    const authAdminAt = body.indexOf("session_user = 'supabase_auth_admin'");
    const deleteBranchAt = body.indexOf("IF TG_OP = 'DELETE' THEN\n    IF OLD.status IN");
    expect(exemptAt).toBeGreaterThan(0);
    expect(authAdminAt).toBeGreaterThan(0);
    expect(deleteBranchAt).toBeGreaterThan(0);
    expect(exemptAt).toBeLessThan(deleteBranchAt);
    expect(authAdminAt).toBeLessThan(deleteBranchAt);
    // Direct seller writes (depth 1, session_user 'authenticator') must still
    // hit the 42501 guards.
    expect(sql).toMatch(/USING ERRCODE = '42501'/);
    expect(sql).not.toMatch(/session_user = 'authenticator'/);
  });
});

describe('20260822130000 academic identity: institutions view', () => {
  const sql = read('20260822130000_academic_identity_and_courses.sql');

  it('creates the institutions view with security_invoker and hides inactive campuses', () => {
    const view = sql.match(/CREATE OR REPLACE VIEW public\.institutions[\s\S]*?;/)?.[0];
    expect(view).toBeDefined();
    expect(view).toMatch(/WITH \(security_invoker = true\)/);
    expect(view).toMatch(/kind <> 'other'/);
    expect(view).toMatch(/active = TRUE/);
    expect(view).toMatch(/FROM public\.marketplace_campuses/);
  });

  it('tells the operator the API build requires it (no "degrades quietly" escape hatch)', () => {
    expect(sql).toMatch(/BEFORE deploying the matching API build/);
    expect(sql).not.toMatch(/degrades like\s+isMissingRelationError/);
    expect(sql).not.toMatch(/degrades quietly/);
  });
});

describe('20260822140000 rights & moderation: content_reports grants', () => {
  const sql = read('20260822140000_rights_and_moderation.sql');

  it('gives authenticated no table privileges and no policies on content_reports', () => {
    expect(sql).toMatch(/REVOKE ALL ON public\.content_reports FROM PUBLIC, anon, authenticated;/);
    expect(sql).toMatch(/GRANT ALL ON public\.content_reports TO service_role;/);
    // No GRANT of any kind to authenticated on the table …
    expect(sql).not.toMatch(/GRANT [^;]*ON public\.content_reports TO authenticated/);
    // … and the two draft policies are only ever dropped, never created.
    expect(sql).not.toMatch(/CREATE POLICY content_reports_(insert|select)_own/);
    expect(sql).toMatch(/DROP POLICY IF EXISTS content_reports_insert_own ON public\.content_reports;/);
    expect(sql).toMatch(/DROP POLICY IF EXISTS content_reports_select_own ON public\.content_reports;/);
    expect(sql).toMatch(/CREATE POLICY content_reports_service_role_all ON public\.content_reports\s+FOR ALL TO service_role/);
  });

  it('still adds the twelve moderation columns the hardening migration hides', () => {
    for (const column of MODERATION_COLUMNS) {
      expect(sql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${column} `));
    }
  });
});

describe('20260822150000 learning events: hand-apply must not die on a syntax error', () => {
  it('uses trim(both ... from ...) — btrim(both ...) is a real PostgreSQL syntax error', () => {
    // The four concept-slug backfills were written as `btrim(both '-' from …)`;
    // BOTH/FROM is grammar only the TRIM() keyword function accepts, so the SQL
    // editor rejected the whole statement ("syntax error at or near both").
    const sql = read('20260822150000_learning_events_and_concepts.sql');
    expect(sql).not.toMatch(/btrim\(\s*both/i);
    expect(sql.match(/trim\(both '-' from regexp_replace\(/g) ?? []).toHaveLength(4);
  });
});

describe('20260822170000 phase1 hardening', () => {
  const sql = read('20260822170000_phase1_hardening.sql');

  it('re-creates strip_privileged_profile_settings with the service-role guard first and the same key list', () => {
    const fn = sql.match(
      /CREATE OR REPLACE FUNCTION public\.strip_privileged_profile_settings\(\)[\s\S]*?\$\$;/,
    )?.[0];
    expect(fn).toBeDefined();
    const guardAt = fn!.indexOf('IF public.is_service_role_caller() THEN');
    const loopAt = fn!.indexOf('FOREACH k IN ARRAY privileged_keys LOOP');
    expect(guardAt).toBeGreaterThan(0);
    expect(loopAt).toBeGreaterThan(guardAt);
    expect(fn).toMatch(/IF public\.is_service_role_caller\(\) THEN\s+RETURN NEW;\s+END IF;/);
    for (const key of [
      'is_platform_admin',
      'is_banned',
      'account_status',
      'ban_reason',
      'banned_at',
      'banned_by',
      'suspended_until',
      'moderation_flags',
    ]) {
      expect(fn).toMatch(new RegExp(`'${key}'`));
    }
    // Faithful to 20260625120000: strip on INSERT, preserve OLD values on UPDATE.
    expect(fn).toMatch(/jsonb_set\(NEW\.settings, ARRAY\[k\], OLD\.settings -> k, true\)/);
    expect(fn).toMatch(/NEW\.settings := NEW\.settings - k;/);
    expect(fn).toMatch(/SECURITY INVOKER/);
  });

  it('hides the moderation columns with a column-level SELECT grant and revokes client writes on marketplace_listings', () => {
    const block = sql.match(/DO \$\$[\s\S]*?END\s*\$\$;/)?.[0];
    expect(block).toBeDefined();
    expect(block).toMatch(/FROM information_schema\.columns/);
    expect(block).toMatch(/table_name = 'marketplace_listings'/);
    for (const column of MODERATION_COLUMNS) {
      expect(block).toMatch(new RegExp(`'${column}'`));
    }
    // Table-level REVOKE before the column-level GRANT (a table REVOKE also
    // drops column grants, so this order is what makes a re-run converge).
    const revokeSelectAt = block!.indexOf('REVOKE SELECT ON public.marketplace_listings FROM anon, authenticated');
    const revokeWritesAt = block!.indexOf('REVOKE INSERT, UPDATE, DELETE ON public.marketplace_listings FROM anon, authenticated');
    const grantAt = block!.indexOf('GRANT SELECT (');
    expect(revokeSelectAt).toBeGreaterThan(0);
    expect(revokeWritesAt).toBeGreaterThan(0);
    expect(grantAt).toBeGreaterThan(revokeSelectAt);
    expect(block).toMatch(/GRANT SELECT \(%s\) ON public\.marketplace_listings TO anon, authenticated/);
    // service_role is never touched.
    expect(block).not.toMatch(/service_role/);
  });

  it('backfills offline_bundles.course_id for purchased question-bank packs', () => {
    expect(sql).toMatch(/UPDATE public\.offline_bundles ob/);
    expect(sql).toMatch(/SET course_id = l\.course_id/);
    expect(sql).toMatch(/FROM public\.marketplace_listings l/);
    expect(sql).toMatch(/ob\.bundle_id = 'qbank-' \|\| l\.id::text/);
    expect(sql).toMatch(/ob\.course_id IS NULL/);
    expect(sql).toMatch(/l\.course_id IS NOT NULL/);
  });

  it('documents the rollback that restores the table-level grants', () => {
    expect(sql).toMatch(/-- Rollback/);
    expect(sql).toMatch(/-- GRANT SELECT, INSERT, UPDATE, DELETE ON public\.marketplace_listings TO anon, authenticated;/);
  });
});
