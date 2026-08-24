-- Phase 1 A (deferred, now built) — course_topics + topic_id.
--
-- A topic is one entry in a course's syllabus outline: "Gas exchange" inside
-- PHM 201. It is the level between a course and an individual artefact, and it
-- is what a student actually revises against.
--
-- WHY THIS IS NOT `concepts`. Phase 1 C shipped `concepts` + `concept_links`,
-- and they solve a different problem: concepts are a cross-course, AI/backfill
-- populated knowledge graph, linked many-to-many to individual cards and
-- questions. A course topic is an ORDERED, human-curated outline that belongs
-- to exactly one course. Collapsing the two would either impose an order on the
-- graph or lose the syllabus. They coexist: an artefact can carry both a
-- topic_id (where it sits in the syllabus) and concept links (what it is about).
--
-- Hand-apply order: independent of the Phase 4 migrations; safe any time after
-- 20260822130000 created `courses`.

-- ============ 1. course_topics ============

CREATE TABLE IF NOT EXISTS public.course_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  -- Sparse ordering (10, 20, 30…) so a topic can be inserted between two
  -- others without renumbering the whole outline.
  position integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One topic title per course, case-insensitively: "Gas Exchange" and
-- "gas exchange" are the same entry in a syllabus.
CREATE UNIQUE INDEX IF NOT EXISTS course_topics_course_title_uidx
  ON public.course_topics (course_id, lower(btrim(title)));

CREATE INDEX IF NOT EXISTS course_topics_course_position_idx
  ON public.course_topics (course_id, position, id);

DROP TRIGGER IF EXISTS update_course_topics_updated_at ON public.course_topics;
CREATE TRIGGER update_course_topics_updated_at
  BEFORE UPDATE ON public.course_topics
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.course_topics ENABLE ROW LEVEL SECURITY;
-- Readable by any signed-in student (a syllabus outline is not private);
-- writes go through the API, like every other curated table.
REVOKE INSERT, UPDATE, DELETE ON public.course_topics FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.course_topics TO authenticated;
GRANT ALL ON public.course_topics TO service_role;

DROP POLICY IF EXISTS course_topics_select ON public.course_topics;
CREATE POLICY course_topics_select ON public.course_topics
  FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE public.course_topics IS
  'Phase 1 A — ordered syllabus outline per course. Distinct from `concepts`, which is a cross-course graph.';

-- ============ 2. topic_id on the artefact tables ============
-- Mirrors exactly the course_id rollout in 20260822130000: nullable, ON DELETE
-- SET NULL, indexed. An artefact may have a course but no topic; it may never
-- have a topic without a course (enforced in the API, not here — a CHECK across
-- two nullable columns would reject legitimate mid-edit states).

ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS topic_id uuid REFERENCES public.course_topics(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS notes_topic_id_idx ON public.notes (topic_id) WHERE topic_id IS NOT NULL;

ALTER TABLE public.note_folders
  ADD COLUMN IF NOT EXISTS topic_id uuid REFERENCES public.course_topics(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS note_folders_topic_id_idx ON public.note_folders (topic_id) WHERE topic_id IS NOT NULL;

ALTER TABLE public.decks
  ADD COLUMN IF NOT EXISTS topic_id uuid REFERENCES public.course_topics(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS decks_topic_id_idx ON public.decks (topic_id) WHERE topic_id IS NOT NULL;

ALTER TABLE public.test_sessions
  ADD COLUMN IF NOT EXISTS topic_id uuid REFERENCES public.course_topics(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS test_sessions_topic_id_idx ON public.test_sessions (topic_id) WHERE topic_id IS NOT NULL;

ALTER TABLE public.marketplace_listings
  ADD COLUMN IF NOT EXISTS topic_id uuid REFERENCES public.course_topics(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS marketplace_listings_topic_id_idx
  ON public.marketplace_listings (topic_id) WHERE topic_id IS NOT NULL;

-- ============ 3. Seeding a course outline from what already exists ============
-- A brand-new course has an empty outline, which makes the picker useless on
-- day one. Students have already been tagging cards and questions with free
-- text; those tags ARE the outline in everything but name.

CREATE OR REPLACE FUNCTION public.seed_course_topics_from_tags(
  p_course_id uuid,
  p_created_by uuid DEFAULT NULL,
  p_limit integer DEFAULT 40
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted integer := 0;
  v_limit integer := GREATEST(1, LEAST(200, COALESCE(p_limit, 40)));
BEGIN
  IF p_course_id IS NULL THEN RETURN 0; END IF;

  WITH tag_counts AS (
    SELECT btrim(t) AS title, COUNT(*) AS n
    FROM public.flashcards f
    JOIN public.decks d ON d.id = f.deck_id
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(f.tags) = 'array' THEN f.tags ELSE '[]'::jsonb END
    ) AS x(t)
    WHERE d.course_id = p_course_id
      AND btrim(t) <> ''
      -- 'General' is the untagged bucket, not a syllabus entry.
      AND lower(btrim(t)) <> 'general'
    GROUP BY btrim(t)
  ),
  ranked AS (
    SELECT title, n, row_number() OVER (ORDER BY n DESC, title) AS rn
    FROM tag_counts
    WHERE n >= 2   -- one card with a tag is not a topic
  )
  INSERT INTO public.course_topics (course_id, title, position, created_by)
  SELECT p_course_id, title, rn * 10, p_created_by
  FROM ranked
  WHERE rn <= v_limit
  ON CONFLICT (course_id, lower(btrim(title))) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_course_topics_from_tags(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_course_topics_from_tags(uuid, uuid, integer) TO service_role;

COMMENT ON FUNCTION public.seed_course_topics_from_tags(uuid, uuid, integer) IS
  'Phase 1 A — bootstrap a course outline from flashcard tags already in use (>=2 uses, excluding General).';
