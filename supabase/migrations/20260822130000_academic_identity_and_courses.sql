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
