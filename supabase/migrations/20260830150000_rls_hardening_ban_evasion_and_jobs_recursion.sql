-- RLS hardening, from an adversarial audit run against the real schema in
-- PGlite (all 182 migrations loaded) with a hostile authenticated JWT — i.e.
-- exactly what a student can do from the browser's DevTools console with the
-- public anon key and their own token.
--
-- 32 of 33 attacks were already blocked (no cross-user reads or writes on
-- profiles, notes, messages, DMs, groups; no self-granted points, verification
-- or admin). Exactly 4 of 113 tables are anon-readable, each scoped by policy
-- to published content: job_postings (active/paused/closed), job_companies
-- (verified), job_screening_questions (for public postings) and
-- marketplace_listings (active). This migration closes what got through.

-- ===========================================================================
-- 1. CRITICAL — ban evasion by deleting and re-creating your own profile.
--
-- Ban/suspension state lives in profiles.settings, and every protective
-- trigger guards UPDATE (restoring OLD). But profiles kept a DELETE policy
-- from 20260520000000, and "not banned" is the ABSENCE of ban keys — so a
-- banned user could DELETE their profile row and re-INSERT a clean one
-- (signup already inserts profiles directly), clearing the ban and
-- cascade-wiping their moderation strikes. Admin ban does a global signOut
-- but does not set auth.users.banned_until, so they simply sign in again.
--
-- Clients never delete profiles: account deletion is the scheduled,
-- service-role flow behind deletion_scheduled_at (routes/users.ts). So the
-- policy is removed outright rather than narrowed.
-- ===========================================================================

DROP POLICY IF EXISTS profiles_delete ON public.profiles;

COMMENT ON TABLE public.profiles IS
  'Client DELETE is deliberately impossible: ban state lives in settings and is absence-based, so self-deletion was a ban-evasion path. Account deletion is the service-role flow behind deletion_scheduled_at.';

-- ===========================================================================
-- 2. profiles.created_at is client-writable and feeds account_age_days ->
--    trust_score (up to +20 of the 50 needed for the "trusted" badge). Freeze
--    it for non-service-role writers, matching how points/badges/stats and
--    verification_level are already preserved.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.preserve_profile_created_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_service_role_caller() THEN
    RETURN NEW;
  END IF;
  -- Age is earned, not declared.
  NEW.created_at := OLD.created_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_preserve_created_at ON public.profiles;
CREATE TRIGGER profiles_preserve_created_at
  BEFORE UPDATE OF created_at ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.preserve_profile_created_at();

-- ===========================================================================
-- 3. HIGH — the jobs board is unusable through PostgREST: 42P17 infinite
--    recursion. job_company_members_select queries job_company_members from
--    inside its own USING clause, which poisons every table whose policy
--    touches it: job_postings, job_companies, job_company_members,
--    job_applications. Anonymous AND authenticated. It is invisible today
--    only because the app reads jobs through the API under service_role,
--    which bypasses RLS — so any direct client query or Realtime subscription
--    on jobs fails outright.
--
-- Fixed with the SECURITY DEFINER helper pattern this codebase already uses
-- for group membership (is_group_member, 20260625120100): the helper runs as
-- owner, so reading the membership table does not re-enter its own policy.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.is_job_company_member(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.job_company_members m
    WHERE m.company_id = p_company_id
      AND m.user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_job_company_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_job_company_member(uuid) TO authenticated, anon, service_role;

DROP POLICY IF EXISTS job_company_members_select ON public.job_company_members;
CREATE POLICY job_company_members_select ON public.job_company_members
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.is_job_company_member(company_id)
  );

-- Same policy also had a real bug: `m.company_id = id` resolved to the
-- MEMBERS table's own id column, never job_companies.id, so the member branch
-- could never be true and a company's own members could not see their
-- unverified company. Fixed via the helper.
DROP POLICY IF EXISTS job_companies_select ON public.job_companies;
CREATE POLICY job_companies_select ON public.job_companies
  FOR SELECT USING (
    verification_status = 'verified'
    OR created_by = auth.uid()
    OR public.is_job_company_member(id)
  );

-- Every other jobs policy embeds the same members subquery. Left as-is they
-- keep the jobs board broken for anon (the subquery needs a SELECT grant on
-- job_company_members that anon does not have) and re-expose the recursion
-- risk. All of them route through the helper instead — same meaning, no
-- self-reference, no grant needed because the helper runs as owner.

DROP POLICY IF EXISTS job_postings_select_public ON public.job_postings;
CREATE POLICY job_postings_select_public ON public.job_postings
  FOR SELECT USING (
    status IN ('active', 'paused', 'closed')
    OR poster_user_id = auth.uid()
    OR public.is_job_company_member(company_id)
  );

DROP POLICY IF EXISTS job_applications_select_participants ON public.job_applications;
CREATE POLICY job_applications_select_participants ON public.job_applications
  FOR SELECT USING (
    applicant_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.job_postings p
      WHERE p.id = posting_id
        AND (p.poster_user_id = auth.uid() OR public.is_job_company_member(p.company_id))
    )
  );

DROP POLICY IF EXISTS job_interviews_participants_read ON public.job_interviews;
CREATE POLICY job_interviews_participants_read ON public.job_interviews
  FOR SELECT USING (
    applicant_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.job_postings p
      WHERE p.id = job_interviews.posting_id
        AND (p.poster_user_id = auth.uid() OR public.is_job_company_member(p.company_id))
    )
  );

DROP POLICY IF EXISTS job_offers_participants_read ON public.job_offers;
CREATE POLICY job_offers_participants_read ON public.job_offers
  FOR SELECT USING (
    applicant_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.job_postings p
      WHERE p.id = job_offers.posting_id
        AND (p.poster_user_id = auth.uid() OR public.is_job_company_member(p.company_id))
    )
  );

DROP POLICY IF EXISTS job_application_notes_hiring_side ON public.job_application_notes;
CREATE POLICY job_application_notes_hiring_side ON public.job_application_notes
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.job_applications a
      JOIN public.job_postings p ON p.id = a.posting_id
      WHERE a.id = job_application_notes.application_id
        AND (p.poster_user_id = auth.uid() OR public.is_job_company_member(p.company_id))
    )
  );

-- ===========================================================================
-- 4. courses.is_canonical ("curated by Lantern/admins", drives search
--    ranking) could be set true on a client INSERT. Force it false for
--    non-service-role writers on both INSERT and UPDATE.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.preserve_course_canonical()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_service_role_caller() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.is_canonical := false;
  ELSE
    NEW.is_canonical := OLD.is_canonical;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS courses_preserve_canonical ON public.courses;
CREATE TRIGGER courses_preserve_canonical
  BEFORE INSERT OR UPDATE OF is_canonical ON public.courses
  FOR EACH ROW EXECUTE FUNCTION public.preserve_course_canonical();

-- ===========================================================================
-- 4b. profiles.settings_version is the optimistic-concurrency counter the
--     settings API compares against (expectedSettingsVersion). It is
--     server-owned state, but a client could PATCH it to an arbitrary number
--     via PostgREST. The blast radius is only the user's own settings sync
--     (their next save conflicts), but a server-owned column should not be
--     client-writable. Frozen for non-service-role writers.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.preserve_profile_settings_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_service_role_caller() THEN
    RETURN NEW;
  END IF;
  NEW.settings_version := OLD.settings_version;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_preserve_settings_version ON public.profiles;
CREATE TRIGGER profiles_preserve_settings_version
  BEFORE UPDATE OF settings_version ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.preserve_profile_settings_version();

-- ===========================================================================
-- 5. Defence in depth: five tables carry INSERT/UPDATE/DELETE grants for
--    `authenticated` but have NO policies. RLS already denies every one of
--    them (verified empirically), so the grants are dead weight today — but
--    they are a trap: the day someone adds a permissive policy for one
--    narrow case, the unused write grants become live. Least privilege.
-- ===========================================================================

REVOKE INSERT, UPDATE, DELETE ON public.api_idempotency_keys FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.job_posting_unique_views FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.marketplace_listing_unique_views FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.marketplace_review_votes FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.youtube_transcripts FROM authenticated, anon;

NOTIFY pgrst, 'reload schema';
