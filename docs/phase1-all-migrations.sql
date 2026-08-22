-- ===================================================================
-- 20260822120000_marketplace_listings_moderation_lock.sql
-- ===================================================================
-- Lock moderation outcomes on marketplace listings (hand-apply in the Supabase
-- SQL editor — this repo hand-applies migrations; sequence after
-- 20260821140000_budget_recurring_transactions.sql).
--
-- Problem: "Users can update own listings" / "Users can delete own listings"
-- (20260306000000_marketplace_rls_and_reports.sql) let a seller UPDATE any
-- column of their own row — status included — and DELETE it. So once an admin
-- sets status = 'removed_by_admin' / 'suspended_by_admin'
-- (apps/api-server/src/routes/admin.ts: listing remove/suspend, report
-- resolution), the owner could flip it straight back to 'active' with a plain
-- PostgREST UPDATE, rewrite the reported content, or DELETE the row (which
-- cascades marketplace_reports away and lets them relist a copy) — and, before
-- the matching API change, do the same through PUT /marketplace/listings/:id
-- (/status) and DELETE /marketplace/listings/:id. The jobs board already locks
-- its moderated statuses (packages/shared/src/jobs/lifecycle.ts); this is the
-- listing equivalent at the database layer.
--
-- Rules for any writer that is NOT the API (service role), the SQL editor /
-- psql / migrations (login role postgres or supabase_admin) or a superuser:
--   * a row whose status is 'suspended_by_admin' / 'removed_by_admin' is
--     read-only — no column may change except the counters the app bumps
--     (views_count, favorites_count, inquiries_count) and updated_at — and it
--     may not be deleted;
--   * no transition may ENTER a moderated status.
-- The API enforces the seller-side transition table for its own callers
-- (packages/shared/src/marketplace/lifecycle.ts via SupabaseService
-- updateListingStatus / updateMarketplaceListing, the DELETE route and
-- question-bank update-content), and admin routes / order-lifecycle RPCs run as
-- the service role, so they are unaffected.
--
-- Role detection: public.is_service_role_caller() (20260704110000) for the API;
-- session_user for direct sessions. NOTE current_setting('role') is the literal
-- 'none' in a plain session, so it must never be used for the postgres check.
-- session_user is 'authenticator' for every PostgREST request, so the direct-
-- session exemption never widens the client exemption.
--
-- Cascades (2026-08-22 adversarial review): deleting an account
-- (auth.admin.deleteUser → GoTrue) cascades auth.users → profiles →
-- marketplace_listings (user_id ON DELETE CASCADE) and fires the ON DELETE SET
-- NULL actions on takedown_by / appeal_decided_by (20260822140000). Those rows
-- reach this trigger with session_user = 'supabase_auth_admin' (GoTrue's login
-- role) and/or pg_trigger_depth() > 1 (every FK cascade / SET NULL action runs
-- as a nested trigger). Without an exemption a moderated listing raised 42501
-- and the WHOLE account deletion failed. Both are therefore exempt — for the
-- UPDATE and the DELETE branch alike. A direct seller write is depth 1 with
-- session_user 'authenticator', so it stays blocked; a cascade can only
-- originate from a parent row the writer may delete (their own profiles row,
-- i.e. account deletion), which is the intended outcome.

CREATE OR REPLACE FUNCTION public.marketplace_listings_guard_moderated_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_old_cmp jsonb;
  v_new_cmp jsonb;
BEGIN
  -- Exemptions (cover BOTH the UPDATE and the DELETE branch below):
  --   * the API (service role), SQL editor / psql / migrations, superusers;
  --   * GoTrue-driven cascades (auth.admin.deleteUser): session_user = 'supabase_auth_admin';
  --   * any FK cascade / SET NULL action: pg_trigger_depth() > 1 — a direct
  --     seller write is depth 1, so this never widens the client exemption.
  IF public.is_service_role_caller()
     OR session_user IN ('postgres', 'supabase_admin')
     OR session_user = 'supabase_auth_admin'
     OR current_setting('is_superuser', true) = 'on'
     OR pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('suspended_by_admin', 'removed_by_admin') THEN
      RAISE EXCEPTION
        'Listing % was taken down by Lantern moderation and cannot be deleted by the seller',
        OLD.id
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE
  IF OLD.status IN ('suspended_by_admin', 'removed_by_admin') THEN
    v_old_cmp := to_jsonb(OLD) - 'views_count' - 'favorites_count' - 'inquiries_count' - 'updated_at';
    v_new_cmp := to_jsonb(NEW) - 'views_count' - 'favorites_count' - 'inquiries_count' - 'updated_at';
    IF v_new_cmp IS DISTINCT FROM v_old_cmp THEN
      RAISE EXCEPTION
        'Listing status % was set by Lantern moderation; the listing is read-only for the seller',
        OLD.status
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IN ('suspended_by_admin', 'removed_by_admin')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION
      'Only Lantern moderation can set listing status %',
      NEW.status
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS marketplace_listings_guard_moderated_status
  ON public.marketplace_listings;
CREATE TRIGGER marketplace_listings_guard_moderated_status
  BEFORE UPDATE ON public.marketplace_listings
  FOR EACH ROW
  EXECUTE FUNCTION public.marketplace_listings_guard_moderated_status();

DROP TRIGGER IF EXISTS marketplace_listings_guard_moderated_delete
  ON public.marketplace_listings;
CREATE TRIGGER marketplace_listings_guard_moderated_delete
  BEFORE DELETE ON public.marketplace_listings
  FOR EACH ROW
  EXECUTE FUNCTION public.marketplace_listings_guard_moderated_status();

-- Rollback:
-- DROP TRIGGER IF EXISTS marketplace_listings_guard_moderated_status ON public.marketplace_listings;
-- DROP TRIGGER IF EXISTS marketplace_listings_guard_moderated_delete ON public.marketplace_listings;
-- DROP FUNCTION IF EXISTS public.marketplace_listings_guard_moderated_status();


-- ===================================================================
-- 20260822121000_marketplace_release_escrow_moderation_safe.sql
-- ===================================================================
-- marketplace_release_escrow must not undo a moderation takedown (hand-apply;
-- sequence after 20260822120000_marketplace_listings_moderation_lock.sql).
--
-- The 20260818120000 version of this RPC completed an order by writing the
-- listing's status unconditionally: 'sold' for a unique item, and for multi-qty
-- stock `CASE WHEN quantity <= 0 THEN 'sold' ELSE 'active' END`. If an admin had
-- taken the listing down (removed_by_admin / suspended_by_admin) while an order
-- was still open (admin takedowns do not cancel orders), the buyer's
-- confirm-received — or the Paystack payout path — would flip the listing back
-- to 'active' (or to 'sold', which a seller may then relist). The RPC runs as
-- the service role, so the moderation trigger does not fence it.
--
-- Fix: the two listing UPDATEs only apply while the listing is in an
-- order-held state (status IN ('active','reserved')); the order still
-- completes, escrow/inquiry bookkeeping is unchanged, and a moderated or
-- archived listing simply keeps its status. Body otherwise identical to
-- 20260818120000_marketplace_question_banks.sql.

CREATE OR REPLACE FUNCTION public.marketplace_release_escrow(
  p_order_id uuid,
  p_actor_id uuid DEFAULT NULL,
  p_allow_disputed boolean DEFAULT false
)
RETURNS TABLE (
  order_id uuid,
  already_completed boolean,
  listing_id uuid,
  buyer_id uuid,
  seller_id uuid,
  amount numeric,
  transaction_id uuid,
  source text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order marketplace_orders%ROWTYPE;
  v_listing marketplace_listings%ROWTYPE;
  v_now timestamptz := NOW();
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'Order id required';
  END IF;

  SELECT * INTO v_order FROM public.marketplace_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;

  IF p_actor_id IS NOT NULL
     AND v_order.buyer_id IS DISTINCT FROM p_actor_id
     AND v_order.seller_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF v_order.status = 'completed' THEN
    RETURN QUERY SELECT
      v_order.id, true, v_order.listing_id, v_order.buyer_id, v_order.seller_id,
      v_order.amount, v_order.transaction_id, v_order.source;
    RETURN;
  END IF;

  IF p_allow_disputed THEN
    IF v_order.status IS DISTINCT FROM 'disputed' THEN
      RAISE EXCEPTION 'Only disputed orders can be released by admin';
    END IF;
  ELSE
    IF v_order.status NOT IN ('ready_for_pickup', 'paid', 'buyer_confirmed') THEN
      RAISE EXCEPTION 'Order is not ready for escrow release';
    END IF;
  END IF;

  SELECT * INTO v_listing FROM public.marketplace_listings WHERE id = v_order.listing_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Listing not found for order'; END IF;

  IF v_order.transaction_id IS NOT NULL THEN
    UPDATE public.marketplace_transactions
    SET status = 'released'
    WHERE id = v_order.transaction_id AND status IS DISTINCT FROM 'released';
  END IF;

  IF v_listing.listing_kind = 'question_bank' THEN
    NULL; -- Digital: the listing stays active for the next buyer.
  ELSIF v_listing.quantity IS NULL THEN
    -- Unique item: mark sold once completed — unless moderation/archival has
    -- already taken the listing out of the order-held states.
    UPDATE public.marketplace_listings
    SET status = 'sold', updated_at = v_now
    WHERE id = v_listing.id
      AND status IN ('active', 'reserved');
  ELSE
    -- Stock already reduced when the order opened; only flip sold when none
    -- left. Same moderation/archival guard.
    UPDATE public.marketplace_listings
    SET status = CASE
          WHEN COALESCE(quantity, 0) <= 0 THEN 'sold'
          ELSE 'active'
        END,
        updated_at = v_now
    WHERE id = v_listing.id
      AND status IN ('active', 'reserved');
  END IF;

  IF v_order.inquiry_id IS NOT NULL THEN
    UPDATE public.marketplace_inquiries
    SET status = 'purchased', updated_at = v_now
    WHERE id = v_order.inquiry_id;
  END IF;

  UPDATE public.marketplace_orders
  SET status = 'completed',
      buyer_confirmed_at = COALESCE(v_order.buyer_confirmed_at, v_now),
      completed_at = v_now,
      updated_at = v_now
  WHERE id = v_order.id;

  RETURN QUERY SELECT
    v_order.id, false, v_order.listing_id, v_order.buyer_id, v_order.seller_id,
    v_order.amount, v_order.transaction_id, v_order.source;
END;
$$;

REVOKE ALL ON FUNCTION public.marketplace_release_escrow(uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marketplace_release_escrow(uuid, uuid, boolean) TO service_role;


-- ===================================================================
-- 20260822130000_academic_identity_and_courses.sql
-- ===================================================================
-- Academic identity + Course entity (Phase 1 · A of
-- docs/PLAN-2026-08-22-knowledge-network.md; shapes pinned by
-- docs/phase1-academic-identity-contract.md §1). Hand-apply in the Supabase
-- SQL editor — this repo hand-applies migrations; sequence after
-- 20260822120000_marketplace_listings_moderation_lock.sql.
--
-- Why: nothing in the schema knows what a student studies. Notes, decks,
-- groups, tests, offline bundles and listings are all flat; the only campus
-- signal is an optional settings.marketplace.campus_id JSONB preference. This
-- migration gives every artefact a shared Course row to hang off, and gives
-- profiles a single queryable writer for "my university / programme / level":
--
--   1a. marketplace_campuses is promoted to the institutions list (kind column
--       + a filtered `institutions` view that hides the "Other — <city>"
--       sentinels and deactivated campuses; security_invoker so it cannot
--       bypass marketplace_campuses RLS).
--   1b. profiles gains institution_id / faculty / programme / study_level /
--       entry_year / expected_graduation_year, backfilled from the marketplace
--       preference where it already points at a real campus.
--   1c. courses: ONE row per (institution, normalised code), shared by every
--       student; is_canonical marks Lantern-curated rows.
--   1d. user_courses: enrolment per academic year — the archive spine.
--       Archiving a semester = status 'archived'; no data moves.
--   1e. Nullable course_id on the 8 artefact tables (SET NULL on course delete).
--   1f. RLS on the two new tables.
--
-- Everything is idempotent (IF NOT EXISTS / DROP IF EXISTS + CREATE) so a
-- partial run can simply be re-run. NOT optional for the API: the API build's
-- create paths write course_id unconditionally (there is no
-- isMissingRelationError fallback for a missing column), so this migration —
-- and 20260822140000 / 150000 / 160000, plus the 20260822170000 hardening —
-- must be applied BEFORE deploying the matching API build. Apply in order:
-- 120000, 121000, 130000, 140000, 150000, 160000, 170000
-- (docs/RELEASING.md → "Apply migrations before deploying").

-- ============ 1a. Institutions = marketplace_campuses, promoted ============

ALTER TABLE public.marketplace_campuses
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'university'
  CHECK (kind IN ('university','polytechnic','college','other'));

UPDATE public.marketplace_campuses SET kind = CASE
  WHEN slug = 'other-city-nigeria' OR slug LIKE 'other-%' THEN 'other'
  WHEN name ILIKE '%polytechnic%' THEN 'polytechnic'
  WHEN name ILIKE '%college%' THEN 'college'
  ELSE 'university' END;

-- security_invoker: a plain view runs with its owner's privileges, so it
-- bypassed marketplace_campuses RLS (marketplace_campuses_public_read:
-- active = TRUE) and exposed deactivated campuses. With security_invoker the
-- caller's grants + policies apply; the explicit active = TRUE filter keeps
-- the list honest for roles that bypass RLS (service role / SQL editor) too.
CREATE OR REPLACE VIEW public.institutions
  WITH (security_invoker = true) AS
  SELECT id, name, city, state, country_code, slug, kind, geopolitical_zone, active
  FROM public.marketplace_campuses
  WHERE kind <> 'other' AND active = TRUE;

GRANT SELECT ON public.institutions TO anon, authenticated, service_role;

-- ============ 1b. Academic profile columns ============

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES public.marketplace_campuses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS faculty text,
  ADD COLUMN IF NOT EXISTS programme text,
  ADD COLUMN IF NOT EXISTS study_level smallint CHECK (study_level BETWEEN 100 AND 900),
  ADD COLUMN IF NOT EXISTS entry_year smallint CHECK (entry_year BETWEEN 1990 AND 2100),
  ADD COLUMN IF NOT EXISTS expected_graduation_year smallint CHECK (expected_graduation_year BETWEEN 1990 AND 2100);

CREATE INDEX IF NOT EXISTS profiles_institution_id_idx ON public.profiles (institution_id);

-- Backfill from the marketplace preference (settings.marketplace.campus_id),
-- skipping sentinels and malformed values. Write-through stays one-directional:
-- the API copies institution_id INTO the preference when the preference is
-- unset, never the other way after this one-off.
UPDATE public.profiles p SET institution_id = c.id
  FROM public.marketplace_campuses c
  WHERE p.institution_id IS NULL
    AND (p.settings->'marketplace'->>'campus_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND c.id = (p.settings->'marketplace'->>'campus_id')::uuid
    AND c.kind <> 'other';

-- ============ 1c. Courses: ONE row per (institution, code) ============

CREATE TABLE IF NOT EXISTS public.courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES public.marketplace_campuses(id) ON DELETE SET NULL,
  code text NOT NULL,                    -- normalised: trim, uppercase, single spaces, e.g. 'BIO 201'
  title text NOT NULL,
  faculty text,
  level smallint CHECK (level BETWEEN 100 AND 900),
  semester smallint CHECK (semester IN (1,2)),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  is_canonical boolean NOT NULL DEFAULT false,   -- curated by Lantern/admins
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- NULL institution (cross-campus / unknown) collapses onto the zero uuid so the
-- uniqueness rule still holds for institution-less courses.
CREATE UNIQUE INDEX IF NOT EXISTS courses_institution_code_uidx
  ON public.courses (COALESCE(institution_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(code));
-- pg_trgm is enabled since 20260601010000_marketplace_indexed_search.sql.
CREATE INDEX IF NOT EXISTS courses_search_trgm_idx
  ON public.courses USING gin ((code || ' ' || title) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS courses_institution_idx ON public.courses (institution_id);

-- updated_at: reuse public.update_updated_at_column() (exists since 20251121000000).
DROP TRIGGER IF EXISTS update_courses_updated_at ON public.courses;
CREATE TRIGGER update_courses_updated_at
  BEFORE UPDATE ON public.courses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ 1d. Enrolment = the student's archive spine ============

CREATE TABLE IF NOT EXISTS public.user_courses (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  academic_year text NOT NULL,           -- '2026/2027' (API computes the default)
  semester smallint CHECK (semester IN (1,2)),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  exam_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course_id, academic_year)
);

CREATE INDEX IF NOT EXISTS user_courses_course_idx ON public.user_courses (course_id);

DROP TRIGGER IF EXISTS update_user_courses_updated_at ON public.user_courses;
CREATE TRIGGER update_user_courses_updated_at
  BEFORE UPDATE ON public.user_courses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ 1e. Nullable course_id on every artefact table ============
-- test_sessions.course_id replaces the dead config->>'subject' path.

ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS notes_course_id_idx ON public.notes (course_id);

ALTER TABLE public.note_folders
  ADD COLUMN IF NOT EXISTS course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS note_folders_course_id_idx ON public.note_folders (course_id);

ALTER TABLE public.decks
  ADD COLUMN IF NOT EXISTS course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS decks_course_id_idx ON public.decks (course_id);

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS groups_course_id_idx ON public.groups (course_id);

ALTER TABLE public.test_sessions
  ADD COLUMN IF NOT EXISTS course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS test_sessions_course_id_idx ON public.test_sessions (course_id);

ALTER TABLE public.offline_bundles
  ADD COLUMN IF NOT EXISTS course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS offline_bundles_course_id_idx ON public.offline_bundles (course_id);

ALTER TABLE public.marketplace_listings
  ADD COLUMN IF NOT EXISTS course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS marketplace_listings_course_id_idx ON public.marketplace_listings (course_id);

ALTER TABLE public.marketplace_question_banks
  ADD COLUMN IF NOT EXISTS course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS marketplace_question_banks_course_id_idx ON public.marketplace_question_banks (course_id);

-- ============ 1f. RLS ============
-- courses: any signed-in student can read and add (created_by must be them);
-- edits/deletes are service-role only (the API / admins curate).
-- user_courses: owner-only; service_role for the API.

ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.courses FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public.courses TO authenticated;
GRANT ALL ON public.courses TO service_role;

DROP POLICY IF EXISTS courses_select_authenticated ON public.courses;
CREATE POLICY courses_select_authenticated ON public.courses
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS courses_insert_own ON public.courses;
CREATE POLICY courses_insert_own ON public.courses
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS courses_service_role_all ON public.courses;
CREATE POLICY courses_service_role_all ON public.courses
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.user_courses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_courses FROM PUBLIC, anon;
GRANT ALL ON public.user_courses TO authenticated, service_role;

DROP POLICY IF EXISTS user_courses_owner_all ON public.user_courses;
CREATE POLICY user_courses_owner_all ON public.user_courses
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_courses_service_role_all ON public.user_courses;
CREATE POLICY user_courses_service_role_all ON public.user_courses
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Rollback (reverse order; profile/artefact columns are dropped last because
-- the FKs point at courses):
-- DROP POLICY IF EXISTS user_courses_service_role_all ON public.user_courses;
-- DROP POLICY IF EXISTS user_courses_owner_all ON public.user_courses;
-- DROP POLICY IF EXISTS courses_service_role_all ON public.courses;
-- DROP POLICY IF EXISTS courses_insert_own ON public.courses;
-- DROP POLICY IF EXISTS courses_select_authenticated ON public.courses;
-- ALTER TABLE public.marketplace_question_banks DROP COLUMN IF EXISTS course_id;
-- ALTER TABLE public.marketplace_listings DROP COLUMN IF EXISTS course_id;
-- ALTER TABLE public.offline_bundles DROP COLUMN IF EXISTS course_id;
-- ALTER TABLE public.test_sessions DROP COLUMN IF EXISTS course_id;
-- ALTER TABLE public.groups DROP COLUMN IF EXISTS course_id;
-- ALTER TABLE public.decks DROP COLUMN IF EXISTS course_id;
-- ALTER TABLE public.note_folders DROP COLUMN IF EXISTS course_id;
-- ALTER TABLE public.notes DROP COLUMN IF EXISTS course_id;
-- DROP TABLE IF EXISTS public.user_courses;
-- DROP TABLE IF EXISTS public.courses;
-- ALTER TABLE public.profiles
--   DROP COLUMN IF EXISTS expected_graduation_year,
--   DROP COLUMN IF EXISTS entry_year,
--   DROP COLUMN IF EXISTS study_level,
--   DROP COLUMN IF EXISTS programme,
--   DROP COLUMN IF EXISTS faculty,
--   DROP COLUMN IF EXISTS institution_id;
-- DROP VIEW IF EXISTS public.institutions;
-- ALTER TABLE public.marketplace_campuses DROP COLUMN IF EXISTS kind;


-- ===================================================================
-- 20260822140000_rights_and_moderation.sql
-- ===================================================================
-- Rights attestation, generic content reports, takedown/appeal state and
-- moderation strikes (Phase 1 · E of docs/PLAN-2026-08-22-knowledge-network.md;
-- shapes pinned by docs/phase1-rights-moderation-contract.md §1). Hand-apply in
-- the Supabase SQL editor — this repo hand-applies migrations; sequence after
-- 20260822130000_academic_identity_and_courses.sql (ordering among the
-- 2026-08-22 migrations is not load-bearing: none of them depend on each other).
--
-- Why: the publish-time "I own this" checkbox was client-only (never in the
-- payload, never in a column), only listings and job posts were reportable
-- (two separate tables with two admin queues), an admin takedown carried no
-- reason the seller could see or contest, and there was no repeat-offender
-- state at all. This migration gives moderation a durable shape:
--
--   1a. Rights + takedown + appeal state on marketplace_listings.
--   1b. Provenance on digital content (question banks) + a removed_by_admin_at
--       soft-delete marker on notes (decks already have it, 20260608100000).
--   1c. content_reports — ONE table for every reportable thing, service-role
--       only (clients report through POST /reports); old marketplace_reports /
--       job_reports rows are backfilled and the old tables become read-only
--       history (the API stops writing them).
--   1d. moderation_strikes — dated, expiring strikes; 3 active = suspension.
--
-- Suspension itself lives in the already-reserved privileged settings key
-- profiles.settings.suspended_until (apps/api-server/src/utils/sanitizeSettings.ts,
-- trigger 20260625120000) — no new column.
--
-- Everything is idempotent (IF NOT EXISTS / DROP IF EXISTS + CREATE /
-- ON CONFLICT DO NOTHING) so a partial run can simply be re-run. NOT optional
-- for the API: listing create and question-bank publish write rights_* /
-- moderation_flags unconditionally, so apply this (after 20260822130000,
-- before 150000/160000/170000) BEFORE deploying the matching API build —
-- docs/RELEASING.md → "Apply migrations before deploying". The 20260822170000
-- hardening migration then hides the rights_*/takedown_*/appeal_* columns
-- from anon/authenticated (column-level SELECT grants) and revokes direct
-- client writes on marketplace_listings.

-- ============ 1a. Rights + takedown + appeal state on listings ============

ALTER TABLE public.marketplace_listings
  ADD COLUMN IF NOT EXISTS rights_status text NOT NULL DEFAULT 'unattested'
    CHECK (rights_status IN ('unattested','attested','under_review','takedown','cleared')),
  ADD COLUMN IF NOT EXISTS rights_attested_at timestamptz,
  ADD COLUMN IF NOT EXISTS rights_attestation_version text,
  -- Soft content-filter hits at create/edit time: [{ pattern, reason, at }].
  ADD COLUMN IF NOT EXISTS moderation_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS takedown_reason text,
  ADD COLUMN IF NOT EXISTS takedown_at timestamptz,
  ADD COLUMN IF NOT EXISTS takedown_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS appeal_status text NOT NULL DEFAULT 'none'
    CHECK (appeal_status IN ('none','requested','upheld','reversed')),
  ADD COLUMN IF NOT EXISTS appeal_note text,
  ADD COLUMN IF NOT EXISTS appealed_at timestamptz,
  ADD COLUMN IF NOT EXISTS appeal_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS appeal_decided_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- The admin appeals queue reads "requested" rows; keep that lookup cheap.
CREATE INDEX IF NOT EXISTS marketplace_listings_appeal_requested_idx
  ON public.marketplace_listings (appealed_at)
  WHERE appeal_status = 'requested';

-- Listings that were already taken down before this migration carry the
-- moderated status but no takedown timestamp; stamp them so the seller-facing
-- state is consistent ("taken down on …" can never be blank).
UPDATE public.marketplace_listings
   SET rights_status = 'takedown',
       takedown_at = COALESCE(takedown_at, updated_at, now())
 WHERE status = 'removed_by_admin'
   AND rights_status = 'unattested'
   AND takedown_at IS NULL;

-- ============ 1b. Provenance on digital content ============

ALTER TABLE public.marketplace_question_banks
  ADD COLUMN IF NOT EXISTS rights_attested_at timestamptz,
  ADD COLUMN IF NOT EXISTS rights_attestation_version text,
  ADD COLUMN IF NOT EXISTS ai_assisted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sources_cited jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS originality_score numeric;      -- reserved; not computed yet

-- Decks already have this marker (20260608100000_admin_audit_log.sql).
ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS removed_by_admin_at timestamptz;

-- ============ 1c. Generic content reports ============
-- Supersedes marketplace_reports / job_reports for NEW reports. Old rows are
-- backfilled below with legacy_source/legacy_id so nothing is lost; the old
-- tables stay (read-only from now on — the API no longer inserts into them).

CREATE TABLE IF NOT EXISTS public.content_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN (
    'listing','question_bank','note','deck','user','group','message','dm_message','job_posting'
  )),
  target_id uuid NOT NULL,
  reason text NOT NULL CHECK (reason IN (
    'scam','spam','inappropriate','copyright','leaked_exam','plagiarism',
    'harassment','prohibited_item','wrong_category','discriminatory','other'
  )),
  details text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','under_review','resolved','dismissed')),
  admin_note text,
  resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  legacy_source text,            -- 'marketplace_reports' | 'job_reports' for backfilled rows
  legacy_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reporter_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS content_reports_status_idx ON public.content_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS content_reports_target_idx ON public.content_reports (target_type, target_id);
CREATE INDEX IF NOT EXISTS content_reports_reporter_idx ON public.content_reports (reporter_id);

-- Backfill marketplace_reports (target_type 'listing'). Legacy reasons already
-- fit the new CHECK (scam/spam/inappropriate/other); 'open' was normalised to
-- 'pending' in 20260608100000. Rows whose listing or reporter is gone are
-- skipped (the FK/UNIQUE would reject them anyway).
INSERT INTO public.content_reports
  (reporter_id, target_type, target_id, reason, details, status, admin_note, resolved_by, resolved_at, legacy_source, legacy_id, created_at)
SELECT
  r.reporter_id,
  'listing',
  r.listing_id,
  CASE WHEN r.reason IN ('scam','spam','inappropriate','other') THEN r.reason ELSE 'other' END,
  r.details,
  CASE WHEN r.status IN ('pending','resolved','dismissed') THEN r.status
       WHEN r.status = 'open' THEN 'pending'
       ELSE 'pending' END,
  r.admin_note,
  r.resolved_by,
  r.resolved_at,
  'marketplace_reports',
  r.id,
  COALESCE(r.created_at, now())
FROM public.marketplace_reports r
WHERE r.reporter_id IS NOT NULL
  AND r.listing_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = r.reporter_id)
  AND EXISTS (SELECT 1 FROM public.marketplace_listings l WHERE l.id = r.listing_id)
ON CONFLICT (reporter_id, target_type, target_id) DO NOTHING;

-- Backfill job_reports (target_type 'job_posting'). Its reason set is a subset
-- of the new one (incl. 'discriminatory'); it has no admin_note/resolved_* yet.
INSERT INTO public.content_reports
  (reporter_id, target_type, target_id, reason, details, status, legacy_source, legacy_id, created_at)
SELECT
  r.reporter_id,
  'job_posting',
  r.posting_id,
  CASE WHEN r.reason IN ('scam','spam','inappropriate','discriminatory','other') THEN r.reason ELSE 'other' END,
  r.details,
  CASE WHEN r.status IN ('pending','resolved','dismissed') THEN r.status ELSE 'pending' END,
  'job_reports',
  r.id,
  COALESCE(r.created_at, now())
FROM public.job_reports r
WHERE EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = r.reporter_id)
  AND EXISTS (SELECT 1 FROM public.job_postings j WHERE j.id = r.posting_id)
ON CONFLICT (reporter_id, target_type, target_id) DO NOTHING;

-- RLS: service_role ONLY. Clients file reports through POST /reports (the
-- API, running as the service role), which validates reason/target, dedupes,
-- rate-limits and owns status/admin_note/resolved_*; the admin queue, status
-- changes and the auto-flag writer are API-side too. A direct PostgREST
-- INSERT grant would let any signed-in user write rows with an arbitrary
-- status/admin_note/resolved_by and flood the queue, and a SELECT grant is not
-- needed (a reporter's own reports come back through the API) — so
-- authenticated gets NO table privileges and NO policies here.
ALTER TABLE public.content_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.content_reports FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.content_reports TO service_role;

-- An earlier draft of this migration granted authenticated SELECT/INSERT via
-- these two policies; drop them in case that draft was ever applied.
DROP POLICY IF EXISTS content_reports_select_own ON public.content_reports;
DROP POLICY IF EXISTS content_reports_insert_own ON public.content_reports;

DROP POLICY IF EXISTS content_reports_service_role_all ON public.content_reports;
CREATE POLICY content_reports_service_role_all ON public.content_reports
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============ 1d. Strikes ============
-- A strike expires 180 days after it is issued; "active strikes" = not yet
-- expired. Three active strikes = 14-day suspension (applied by the API when
-- the third strike is written — settings.suspended_until).

CREATE TABLE IF NOT EXISTS public.moderation_strikes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  report_id uuid REFERENCES public.content_reports(id) ON DELETE SET NULL,
  severity smallint NOT NULL DEFAULT 1 CHECK (severity BETWEEN 1 AND 3),
  reason text NOT NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '180 days')
);

CREATE INDEX IF NOT EXISTS moderation_strikes_user_idx ON public.moderation_strikes (user_id, expires_at);

-- RLS: service_role only — users learn their strike count via
-- GET /users/me/moderation, never by reading the table.
ALTER TABLE public.moderation_strikes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.moderation_strikes FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.moderation_strikes TO service_role;

DROP POLICY IF EXISTS moderation_strikes_service_role_all ON public.moderation_strikes;
CREATE POLICY moderation_strikes_service_role_all ON public.moderation_strikes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Rollback (reverse order; the legacy tables were never dropped so nothing to
-- restore there):
-- DROP POLICY IF EXISTS moderation_strikes_service_role_all ON public.moderation_strikes;
-- DROP TABLE IF EXISTS public.moderation_strikes;
-- DROP POLICY IF EXISTS content_reports_service_role_all ON public.content_reports;
-- DROP TABLE IF EXISTS public.content_reports;
-- ALTER TABLE public.notes DROP COLUMN IF EXISTS removed_by_admin_at;
-- ALTER TABLE public.marketplace_question_banks
--   DROP COLUMN IF EXISTS originality_score,
--   DROP COLUMN IF EXISTS sources_cited,
--   DROP COLUMN IF EXISTS ai_assisted,
--   DROP COLUMN IF EXISTS rights_attestation_version,
--   DROP COLUMN IF EXISTS rights_attested_at;
-- DROP INDEX IF EXISTS public.marketplace_listings_appeal_requested_idx;
-- ALTER TABLE public.marketplace_listings
--   DROP COLUMN IF EXISTS appeal_decided_by,
--   DROP COLUMN IF EXISTS appeal_decided_at,
--   DROP COLUMN IF EXISTS appealed_at,
--   DROP COLUMN IF EXISTS appeal_note,
--   DROP COLUMN IF EXISTS appeal_status,
--   DROP COLUMN IF EXISTS takedown_by,
--   DROP COLUMN IF EXISTS takedown_at,
--   DROP COLUMN IF EXISTS takedown_reason,
--   DROP COLUMN IF EXISTS moderation_flags,
--   DROP COLUMN IF EXISTS rights_attestation_version,
--   DROP COLUMN IF EXISTS rights_attested_at,
--   DROP COLUMN IF EXISTS rights_status;


-- ===================================================================
-- 20260822150000_learning_events_and_concepts.sql
-- ===================================================================
-- learning_events + concepts (Phase 1 · C of
-- docs/PLAN-2026-08-22-knowledge-network.md; shapes pinned by
-- docs/phase1-learning-events-contract.md §1). Hand-apply in the Supabase
-- SQL editor — this repo hand-applies migrations; sequence after
-- 20260822140000 (library search) / 20260822130000_academic_identity_and_courses.sql
-- (the concepts.course_id FK needs public.courses).
--
-- Why: every flashcard review overwrites flashcards.srs_data and every test
-- answer lives inside one test_sessions.user_answers blob, so there is no
-- append-only record of *what a student did when* — mastery, readiness and
-- recommendations (Phase 3) have nothing to read. Decision D9: learning
-- events are PRODUCT data (needed to run the learning product), written
-- server-side regardless of the analytics cookie, retained while the account
-- exists, exported and deleted with the account. They are NOT product_events
-- (consent-gated, 90-day, "anonymous product events").
--
--   1a. learning_events — append-only, service-role only (no anon/authenticated
--       policies; no UPDATE/DELETE path except the profiles CASCADE).
--   1b. concepts — a normalised vocabulary (lower-kebab slug per course).
--   1c. concept_links — concept ↔ flashcard/question/note/deck, with confidence.
--   1d. flashcards.authored_difficulty — the AI/author-declared difficulty,
--       deliberately NOT named `difficulty` (srs_data.difficulty is FSRS state).
--       Questions keep it in messages.question_data->>'authored_difficulty'.
--   1e. Backfill concepts + links from existing free-text tags.
--
-- Everything is idempotent (IF NOT EXISTS / DROP IF EXISTS + CREATE /
-- ON CONFLICT DO NOTHING) so a partial run can simply be re-run. The API
-- degrades quietly (logs, never fails the user action) until this is applied.

-- ============ 1a. learning_events ============

CREATE TABLE IF NOT EXISTS public.learning_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    'card_reviewed','question_shown','question_answered','resource_opened','note_created',
    'card_generated','question_generated','bank_downloaded','bank_score_recorded','group_question_posted')),
  target_type text CHECK (target_type IN ('flashcard','question','note','deck','listing','group','test_session')),
  target_id text,                           -- uuid or messages.id text (question ids are text)
  deck_id uuid,
  group_id uuid,
  note_id uuid,
  course_id uuid,
  session_id uuid,
  listing_id uuid,
  rating smallint,                          -- flashcard grade (again/hard/good/easy → 1-4)
  is_correct boolean,
  response_ms integer,
  confidence smallint,                      -- reserved (no capture yet)
  attempt_no smallint,
  count integer,                            -- for *_generated (items per call)
  srs_before jsonb,
  srs_after jsonb,
  surface text CHECK (surface IN ('web','mobile','api')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS learning_events_user_time_idx
  ON public.learning_events (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS learning_events_target_idx
  ON public.learning_events (target_type, target_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS learning_events_course_idx
  ON public.learning_events (course_id, occurred_at DESC) WHERE course_id IS NOT NULL;
-- Test-completion dedupe guard (one batch of question_answered per session).
CREATE INDEX IF NOT EXISTS learning_events_user_session_idx
  ON public.learning_events (user_id, session_id) WHERE session_id IS NOT NULL;

-- service_role only: no policies for anon/authenticated, so nothing but the
-- API (service-role client) can read or write. No UPDATE/DELETE except the
-- profiles ON DELETE CASCADE (account deletion).
ALTER TABLE public.learning_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.learning_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.learning_events TO service_role;

DROP POLICY IF EXISTS learning_events_service_role_all ON public.learning_events;
CREATE POLICY learning_events_service_role_all ON public.learning_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============ 1b. concepts ============

CREATE TABLE IF NOT EXISTS public.concepts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,                       -- normalised lower-kebab of name (@lantern/shared/learning normalizeConceptSlug)
  name text NOT NULL,
  parent_id uuid REFERENCES public.concepts(id) ON DELETE SET NULL,
  course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'user' CHECK (source IN ('ai','user','import','backfill')),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- NULL course (cross-course / unknown) collapses onto the zero uuid so the
-- uniqueness rule still holds for course-less concepts.
CREATE UNIQUE INDEX IF NOT EXISTS concepts_course_slug_uidx
  ON public.concepts (COALESCE(course_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);
-- pg_trgm is enabled since 20260601010000_marketplace_indexed_search.sql.
CREATE INDEX IF NOT EXISTS concepts_slug_trgm_idx
  ON public.concepts USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS concepts_course_idx ON public.concepts (course_id);

-- ============ 1c. concept_links ============

CREATE TABLE IF NOT EXISTS public.concept_links (
  concept_id uuid NOT NULL REFERENCES public.concepts(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('flashcard','question','note','deck')),
  target_id text NOT NULL,
  confidence real NOT NULL DEFAULT 1.0,
  source text NOT NULL DEFAULT 'user' CHECK (source IN ('ai','user','import','backfill')),
  -- Lifecycle hook: lets the GDPR export return the links a student authored
  -- (backfill/AI rows are NULL). SET NULL on account deletion, like concepts.
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (concept_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS concept_links_target_idx ON public.concept_links (target_type, target_id);
CREATE INDEX IF NOT EXISTS concept_links_created_by_idx
  ON public.concept_links (created_by) WHERE created_by IS NOT NULL;

-- RLS: concepts SELECT authenticated, INSERT authenticated (created_by = auth.uid());
-- concept_links SELECT authenticated; all other writes service_role (the API).
ALTER TABLE public.concepts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.concepts FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public.concepts TO authenticated;
GRANT ALL ON public.concepts TO service_role;

DROP POLICY IF EXISTS concepts_select_authenticated ON public.concepts;
CREATE POLICY concepts_select_authenticated ON public.concepts
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS concepts_insert_own ON public.concepts;
CREATE POLICY concepts_insert_own ON public.concepts
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS concepts_service_role_all ON public.concepts;
CREATE POLICY concepts_service_role_all ON public.concepts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.concept_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.concept_links FROM PUBLIC, anon;
GRANT SELECT ON public.concept_links TO authenticated;
GRANT ALL ON public.concept_links TO service_role;

DROP POLICY IF EXISTS concept_links_select_authenticated ON public.concept_links;
CREATE POLICY concept_links_select_authenticated ON public.concept_links
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS concept_links_service_role_all ON public.concept_links;
CREATE POLICY concept_links_service_role_all ON public.concept_links
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============ 1d. flashcards.authored_difficulty ============
-- NOT `difficulty`: srs_data.difficulty is FSRS scheduler state. Questions
-- keep theirs in messages.question_data->>'authored_difficulty' (JSONB, no column).

ALTER TABLE public.flashcards
  ADD COLUMN IF NOT EXISTS authored_difficulty text
  CHECK (authored_difficulty IN ('easy','medium','hard'));

-- ============ 1e. Backfill concepts + links from existing free-text tags ============
-- One concept per distinct lower(trim(tag)), course_id NULL (no course
-- attribution exists yet), source 'backfill'. Slugging mirrors
-- normalizeConceptSlug(): lower → non-alphanumerics to '-' → collapse/trim '-'.
-- Idempotent: ON CONFLICT DO NOTHING on both tables.

-- flashcards.tags (jsonb array of strings) → concept + link target_type 'flashcard'
WITH tag_rows AS (
  SELECT f.id AS flashcard_id,
         btrim(t.tag) AS name,
         trim(both '-' from regexp_replace(lower(btrim(t.tag)), '[^a-z0-9]+', '-', 'g')) AS slug
  FROM public.flashcards f
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(f.tags) = 'array' THEN f.tags ELSE '[]'::jsonb END
  ) AS t(tag)
  WHERE f.tags IS NOT NULL
)
INSERT INTO public.concepts (slug, name, course_id, source)
SELECT DISTINCT ON (slug) slug, name, NULL, 'backfill'
FROM tag_rows
WHERE slug <> ''
ORDER BY slug, name
ON CONFLICT DO NOTHING;

WITH tag_rows AS (
  SELECT f.id AS flashcard_id,
         trim(both '-' from regexp_replace(lower(btrim(t.tag)), '[^a-z0-9]+', '-', 'g')) AS slug
  FROM public.flashcards f
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(f.tags) = 'array' THEN f.tags ELSE '[]'::jsonb END
  ) AS t(tag)
  WHERE f.tags IS NOT NULL
)
INSERT INTO public.concept_links (concept_id, target_type, target_id, confidence, source)
SELECT c.id, 'flashcard', tr.flashcard_id::text, 1.0, 'backfill'
FROM tag_rows tr
JOIN public.concepts c
  ON c.slug = tr.slug AND c.course_id IS NULL
WHERE tr.slug <> ''
ON CONFLICT DO NOTHING;

-- messages.question_data->'tags' (type = 'QUESTION') → link target_type 'question'
-- (target_id = messages.id::text — question ids are text on the client).
WITH tag_rows AS (
  SELECT m.id AS message_id,
         btrim(t.tag) AS name,
         trim(both '-' from regexp_replace(lower(btrim(t.tag)), '[^a-z0-9]+', '-', 'g')) AS slug
  FROM public.messages m
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(m.question_data->'tags') = 'array' THEN m.question_data->'tags' ELSE '[]'::jsonb END
  ) AS t(tag)
  WHERE upper(m.type::text) = 'QUESTION' AND m.question_data IS NOT NULL
)
INSERT INTO public.concepts (slug, name, course_id, source)
SELECT DISTINCT ON (slug) slug, name, NULL, 'backfill'
FROM tag_rows
WHERE slug <> ''
ORDER BY slug, name
ON CONFLICT DO NOTHING;

WITH tag_rows AS (
  SELECT m.id AS message_id,
         trim(both '-' from regexp_replace(lower(btrim(t.tag)), '[^a-z0-9]+', '-', 'g')) AS slug
  FROM public.messages m
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(m.question_data->'tags') = 'array' THEN m.question_data->'tags' ELSE '[]'::jsonb END
  ) AS t(tag)
  WHERE upper(m.type::text) = 'QUESTION' AND m.question_data IS NOT NULL
)
INSERT INTO public.concept_links (concept_id, target_type, target_id, confidence, source)
SELECT c.id, 'question', tr.message_id::text, 1.0, 'backfill'
FROM tag_rows tr
JOIN public.concepts c
  ON c.slug = tr.slug AND c.course_id IS NULL
WHERE tr.slug <> ''
ON CONFLICT DO NOTHING;

-- Rollback (reverse order):
-- DROP POLICY IF EXISTS concept_links_service_role_all ON public.concept_links;
-- DROP POLICY IF EXISTS concept_links_select_authenticated ON public.concept_links;
-- DROP POLICY IF EXISTS concepts_service_role_all ON public.concepts;
-- DROP POLICY IF EXISTS concepts_insert_own ON public.concepts;
-- DROP POLICY IF EXISTS concepts_select_authenticated ON public.concepts;
-- DROP POLICY IF EXISTS learning_events_service_role_all ON public.learning_events;
-- ALTER TABLE public.flashcards DROP COLUMN IF EXISTS authored_difficulty;
-- DROP TABLE IF EXISTS public.concept_links;
-- DROP TABLE IF EXISTS public.concepts;
-- DROP TABLE IF EXISTS public.learning_events;


-- ===================================================================
-- 20260822160000_library_search_indexes.sql
-- ===================================================================
-- Library search indexes (Phase 1 · B of docs/PLAN-2026-08-22-knowledge-network.md;
-- contract docs/phase1-library-archive-contract.md §1). Hand-apply in the
-- Supabase SQL editor — this repo hand-applies migrations; sequence after
-- 20260822130000_academic_identity_and_courses.sql.
--
-- Why: GET /api/v1/library/search unions ILIKE '%q%' matches across notes,
-- decks, flashcards and offline bundles for the caller. Every query is
-- owner-scoped (user_id = caller, or a collaborator row), so the planner
-- usually walks the per-user btree first — but the trigram indexes below let it
-- satisfy `%q%` on the text columns without a sequential rescan of large
-- decks/notebooks, and they are what the cross-user library search of a later
-- phase (campus-wide notes discovery) will lean on. pg_trgm is already enabled
-- (20260601010000_marketplace_indexed_search.sql); the CREATE EXTENSION is a
-- no-op guard.
--
-- Idempotent: every statement is IF NOT EXISTS.
--
-- Indexed columns (GIN, gin_trgm_ops):
--   notes.title                      — note titles
--   left(notes.body, 4000)           — expression index bounding the size of
--                                      note bodies we index (a 200 KB body would
--                                      otherwise bloat the GIN index and slow
--                                      every note save). NOTE: PostgREST's
--                                      `body.ilike.%q%` does not match this
--                                      expression, so today it only serves a
--                                      query written as `left(body, 4000) ILIKE`
--                                      (i.e. an RPC); it is created now so the
--                                      RPC/search upgrade needs no migration.
--   decks.name, flashcards.front, flashcards.back, offline_bundles.display_name
--   (+ offline_bundles.group_name — the search matches it too and it is NOT
--    NULL on every row; display_name is nullable).
--
-- Not indexed: note_attachments.extracted_text (whole-document OCR/PDF text;
-- a trigram index on it would dwarf the table — the attachment branch of the
-- search stays owner-scoped + sequential) and notes.summary (short, rarely
-- the only match).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Notes
CREATE INDEX IF NOT EXISTS notes_title_trgm_idx
  ON public.notes USING gin (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS notes_body_head_trgm_idx
  ON public.notes USING gin (left(body, 4000) gin_trgm_ops);

-- Decks + flashcards
CREATE INDEX IF NOT EXISTS decks_name_trgm_idx
  ON public.decks USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS flashcards_front_trgm_idx
  ON public.flashcards USING gin (front gin_trgm_ops);

CREATE INDEX IF NOT EXISTS flashcards_back_trgm_idx
  ON public.flashcards USING gin (back gin_trgm_ops);

-- Offline bundles (display_name is the user-assigned name; group_name the source group)
CREATE INDEX IF NOT EXISTS offline_bundles_display_name_trgm_idx
  ON public.offline_bundles USING gin (display_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS offline_bundles_group_name_trgm_idx
  ON public.offline_bundles USING gin (group_name gin_trgm_ops);

-- Owner-scoped search walks: (user_id) already exists on notes
-- (idx_notes_user_updated), decks and offline_bundles (idx_offline_bundles_user_id);
-- flashcards are reached through decks(id) — its PK. Collaborator lookups use
-- the (note_id, user_id) / (deck_id, user_id) primary keys, so a user_id-led
-- index makes "what do I collaborate on" cheap:
CREATE INDEX IF NOT EXISTS note_collaborators_user_idx
  ON public.note_collaborators (user_id);

CREATE INDEX IF NOT EXISTS deck_collaborators_user_idx
  ON public.deck_collaborators (user_id);

-- Rollback (manual):
-- DROP INDEX IF EXISTS public.deck_collaborators_user_idx;
-- DROP INDEX IF EXISTS public.note_collaborators_user_idx;
-- DROP INDEX IF EXISTS public.offline_bundles_group_name_trgm_idx;
-- DROP INDEX IF EXISTS public.offline_bundles_display_name_trgm_idx;
-- DROP INDEX IF EXISTS public.flashcards_back_trgm_idx;
-- DROP INDEX IF EXISTS public.flashcards_front_trgm_idx;
-- DROP INDEX IF EXISTS public.decks_name_trgm_idx;
-- DROP INDEX IF EXISTS public.notes_body_head_trgm_idx;
-- DROP INDEX IF EXISTS public.notes_title_trgm_idx;


-- ===================================================================
-- 20260822170000_phase1_hardening.sql
-- ===================================================================
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


