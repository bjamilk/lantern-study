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
