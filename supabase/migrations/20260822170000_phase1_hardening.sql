-- Phase 1 hardening (2026-08-22 adversarial review of the Phase 1 server work;
-- docs/PLAN-2026-08-22-knowledge-network.md §4, the docs/phase1-*-contract.md
-- files). Hand-apply in the Supabase SQL editor — this repo hand-applies
-- migrations; sequence LAST of the seven 2026-08-22 migrations, after
-- 20260822160000_library_search_indexes.sql (it touches columns that
-- 20260822130000 / 20260822140000 create). Apply order: 120000, 121000, 130000,
-- 140000, 150000, 160000, 170000 — docs/RELEASING.md → "Apply migrations
-- before deploying".
--
-- Three findings, each touching an OLDER (already applied) migration, so they
-- live here rather than in an edited-in-place 20260822* file:
--
--   1. Suspensions never persisted. public.strip_privileged_profile_settings()
--      (20260625120000_rls_privilege_hardening.sql) strips / reverts the
--      privileged settings keys (is_platform_admin, is_banned, account_status,
--      ban_reason, banned_at, banned_by, suspended_until, moderation_flags) on
--      EVERY profiles write with no role exemption — so the API's
--      settings.suspended_until write (three active strikes → 14-day
--      suspension, 20260822140000 §1d) was silently reverted to the old value.
--      Same body, plus the public.is_service_role_caller() guard at the top,
--      mirroring 20260704110000_fix_gamification_service_role.sql. Direct
--      PostgREST writes (authenticated) are still stripped.
--
--   2. marketplace_listings column exposure. The moderation / rights columns
--      added by 20260822140000 (rights_status, rights_attested_at,
--      rights_attestation_version, moderation_flags, takedown_reason,
--      takedown_at, takedown_by, appeal_status, appeal_note, appealed_at,
--      appeal_decided_at, appeal_decided_by) were readable by anon and
--      authenticated through PostgREST: the Supabase default table-level SELECT
--      grant + "Anyone can view active listings" (20260306000000). No web or
--      mobile client reads or writes marketplace_listings directly (zero
--      `.from('marketplace_listings')` outside apps/api-server; the API uses
--      the service role), so:
--        * REVOKE SELECT at the table level for anon/authenticated and re-GRANT
--          SELECT on every OTHER column (built dynamically from
--          information_schema.columns). Column-level GRANT is the only way to
--          subtract columns — a column-level REVOKE does not subtract from a
--          table-level grant. A table-level REVOKE also drops column grants, so
--          the order (REVOKE, then GRANT (cols)) makes a re-run converge.
--        * REVOKE INSERT, UPDATE, DELETE for anon/authenticated — closes direct
--          seller writes to the rights/appeal columns (and any other column)
--          through PostgREST; the 20260822120000 lock trigger stays as defence
--          in depth, and the three seller policies from 20260306000000 become
--          inert (left in place; harmless).
--      RLS policies / SECURITY INVOKER functions that reference
--      marketplace_listings in subqueries (id, user_id, status, campus_id, …)
--      keep working because every pre-existing column stays granted. Two
--      consequences worth knowing: `select=*` on this table as anon/
--      authenticated now fails with "permission denied" (intended — nothing
--      does it), and any FUTURE column is invisible to those roles until it is
--      added to the GRANT below (re-running this migration re-grants all
--      non-excluded columns).
--
--   3. Purchased question-bank bundles carried no course. deliverBundle wrote
--      offline_bundles without course_id (the API fix sets it going forward);
--      rows already delivered (bundle_id = 'qbank-' || listing id) are
--      backfilled from the listing's course_id.
--
-- Everything is idempotent: CREATE OR REPLACE, REVOKE/GRANT converge, the
-- UPDATE only touches rows that still lack a course.

-- ============ 1. strip_privileged_profile_settings: service-role guard ============
-- Body identical to 20260625120000_rls_privilege_hardening.sql §2 apart from
-- the guard (keep them in sync if the key list ever changes).

CREATE OR REPLACE FUNCTION public.strip_privileged_profile_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  privileged_keys text[] := ARRAY[
    'is_platform_admin',
    'is_banned',
    'account_status',
    'ban_reason',
    'banned_at',
    'banned_by',
    'suspended_until',
    'moderation_flags'
  ];
  k text;
BEGIN
  -- The API (service role) is the only writer of the privileged keys
  -- (suspensions, bans, admin flags); everything else is stripped / reverted.
  IF public.is_service_role_caller() THEN
    RETURN NEW;
  END IF;

  IF NEW.settings IS NULL THEN
    NEW.settings := '{}'::jsonb;
  END IF;

  -- Strip privileged keys from incoming settings; preserve existing values on UPDATE.
  FOREACH k IN ARRAY privileged_keys LOOP
    IF TG_OP = 'UPDATE' AND OLD.settings ? k THEN
      NEW.settings := jsonb_set(NEW.settings, ARRAY[k], OLD.settings -> k, true);
    ELSE
      NEW.settings := NEW.settings - k;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

-- The trigger itself (profiles_strip_privileged_settings, BEFORE INSERT OR
-- UPDATE OF settings) is unchanged; CREATE OR REPLACE swaps the body in place.

-- ============ 2. marketplace_listings: hide moderation columns, close client writes ============

DO $$
DECLARE
  v_cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'marketplace_listings'
     AND column_name NOT IN (
       'rights_status', 'rights_attested_at', 'rights_attestation_version',
       'moderation_flags', 'takedown_reason', 'takedown_at', 'takedown_by',
       'appeal_status', 'appeal_note', 'appealed_at', 'appeal_decided_at',
       'appeal_decided_by'
     );

  IF v_cols IS NULL THEN
    RAISE EXCEPTION 'public.marketplace_listings has no grantable columns — is the table missing?';
  END IF;

  -- Table-level REVOKE first (it also drops any column grants), then the
  -- column-level GRANT — a re-run converges on the same state.
  EXECUTE 'REVOKE SELECT ON public.marketplace_listings FROM anon, authenticated';
  EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON public.marketplace_listings FROM anon, authenticated';
  EXECUTE format('GRANT SELECT (%s) ON public.marketplace_listings TO anon, authenticated', v_cols);
END
$$;

-- ============ 3. Backfill offline_bundles.course_id for purchased packs ============
-- offline_bundles.bundle_id for a bought/downloaded question bank is
-- 'qbank-<listing id>' (apps/api-server/src/services/marketplaceQuestionBanks.ts
-- bundleIdForListing). Only rows that still lack a course are touched, and only
-- when the listing has one.

UPDATE public.offline_bundles ob
   SET course_id = l.course_id
  FROM public.marketplace_listings l
 WHERE ob.bundle_id = 'qbank-' || l.id::text
   AND ob.course_id IS NULL
   AND l.course_id IS NOT NULL;

-- Rollback (reverse order):
-- 3. Data-only; to undo: UPDATE public.offline_bundles SET course_id = NULL WHERE bundle_id LIKE 'qbank-%';
-- 2. Restore the Supabase default table-level grants (the column-level SELECT
--    grant is subsumed by the table-level one, nothing to drop):
-- GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketplace_listings TO anon, authenticated;
-- 1. Re-run the 20260625120000_rls_privilege_hardening.sql §2
--    CREATE OR REPLACE FUNCTION public.strip_privileged_profile_settings() body
--    (no service-role guard) — the trigger needs no change.
