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
