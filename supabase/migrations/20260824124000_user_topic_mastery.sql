-- Phase 3 P — Mastery Graph v1.
--
-- Today the only per-topic signal in the product is computed on the CLIENT
-- (packages/shared/src/utils/buildDashboardStats.ts buildTopicPerformance +
-- the mobile getDeckCardStats), which means the server — and therefore the AI
-- companion, /ai/study-recommendations and /dashboard/summary's lean rows —
-- has never known which topics a student is weak on.
--
-- user_topic_mastery is the server-side materialisation of that, per
-- (user, topic, course): question accuracy from test_sessions x user answers,
-- plus flashcard health from flashcards.srs_data. It is refreshed on test
-- completion and review, not computed per request, because walking every
-- session's `questions` jsonb on each dashboard load does not scale.
--
-- Hand-apply AFTER 20260824123000_learning_connections.sql. LAST Phase 3
-- migration.

-- ============ 1. user_topic_mastery ============

CREATE TABLE IF NOT EXISTS public.user_topic_mastery (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Free-text tag today ('General' for untagged, matching the dashboards).
  -- concept_id is the Phase 1 C upgrade path once concepts are linked.
  topic text NOT NULL,
  course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL,
  concept_id uuid REFERENCES public.concepts(id) ON DELETE SET NULL,

  -- Question side
  attempts integer NOT NULL DEFAULT 0,
  correct integer NOT NULL DEFAULT 0,
  accuracy numeric(5,4) NOT NULL DEFAULT 0,
  avg_response_s numeric(6,2),
  last_attempt_at timestamptz,

  -- Flashcard side
  cards_total integer NOT NULL DEFAULT 0,
  cards_mature integer NOT NULL DEFAULT 0,     -- interval >= 21 days
  cards_due integer NOT NULL DEFAULT 0,
  avg_stability numeric(8,3),
  avg_difficulty numeric(6,3),
  leech_count integer NOT NULL DEFAULT 0,

  -- 0-100 blended score; NULL when there is not enough evidence either way.
  mastery_score integer,
  refreshed_at timestamptz NOT NULL DEFAULT now()
);

-- Identity is (user, topic, course). It canNOT be a PRIMARY KEY: a PK forces
-- course_id NOT NULL, and a course-less row would then need a sentinel value
-- that violates the FK to courses. Same problem, same fix as
-- courses_institution_code_uidx / concepts_course_slug_uidx: keep the column
-- nullable with its FK and collapse NULL onto the zero uuid in a unique index.
-- The upsert below infers this index by repeating the expression verbatim.
CREATE UNIQUE INDEX IF NOT EXISTS user_topic_mastery_identity_uidx
  ON public.user_topic_mastery (
    user_id, topic, COALESCE(course_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE INDEX IF NOT EXISTS user_topic_mastery_user_idx
  ON public.user_topic_mastery (user_id, mastery_score);
CREATE INDEX IF NOT EXISTS user_topic_mastery_course_idx
  ON public.user_topic_mastery (course_id, topic)
  WHERE course_id IS NOT NULL;

ALTER TABLE public.user_topic_mastery ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_topic_mastery FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.user_topic_mastery TO service_role;

COMMENT ON TABLE public.user_topic_mastery IS
  'Phase 3 P — per (user, topic, course) mastery materialised from test_sessions + flashcards.srs_data.';

-- ============ 2. refresh_user_topic_mastery ============
-- Walks the user's recent sessions in SQL rather than shipping megabytes of
-- jsonb to Node. Bounded to the most recent sessions so a heavy user does not
-- turn a test submission into a multi-second write.

CREATE OR REPLACE FUNCTION public.refresh_user_topic_mastery(
  p_user_id uuid,
  p_session_limit integer DEFAULT 200
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_zero uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  v_limit integer := GREATEST(1, LEAST(1000, COALESCE(p_session_limit, 200)));
  v_rows integer := 0;
BEGIN
  IF p_user_id IS NULL THEN RETURN 0; END IF;

  -- Deliberately ONE statement built from CTEs rather than temp tables.
  -- plpgsql caches query plans per session; a TEMP TABLE dropped and recreated
  -- across calls on a pooled connection invalidates those plans and the second
  -- call fails with "relation with OID ... does not exist". CTEs have no such
  -- lifetime, and the planner materialises them the same way.
  WITH sessions AS (
    SELECT id, questions, user_answers, course_id, start_time, end_time
    FROM public.test_sessions
    WHERE user_id = p_user_id AND end_time IS NOT NULL
    ORDER BY COALESCE(end_time, start_time) DESC
    LIMIT v_limit
  ),
  -- Question side: expand each session's questions, join the user's answer by
  -- question id, and tally per tag. Untagged questions fall under 'General',
  -- exactly as buildTopicPerformance and companionWeakTopics do, so the server
  -- and the dashboards never disagree about what a weak topic is.
  answered AS (
    SELECT
      u.tag AS topic,
      COALESCE(s.course_id, v_zero) AS course_id,
      a.ans,
      COALESCE(s.end_time, s.start_time) AS at
    FROM sessions s
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(s.questions) = 'array' THEN s.questions ELSE '[]'::jsonb END
    ) AS q(question)
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN jsonb_typeof(s.user_answers) = 'object'
        THEN s.user_answers -> (q.question->>'id')
        ELSE NULL
      END AS ans
    ) a
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN jsonb_typeof(q.question->'tags') = 'array'
          AND jsonb_array_length(q.question->'tags') > 0
        THEN (
          SELECT COALESCE(array_agg(btrim(t)) FILTER (WHERE btrim(t) <> ''), ARRAY['General'])
          FROM jsonb_array_elements_text(q.question->'tags') AS x(t)
        )
        ELSE ARRAY['General']
      END AS tags
    ) tg
    CROSS JOIN LATERAL unnest(tg.tags) AS u(tag)
    -- An answer record means the question was attempted; no record = skipped.
    WHERE a.ans IS NOT NULL AND jsonb_typeof(a.ans) = 'object'
  ),
  q_side AS (
    SELECT
      topic,
      course_id,
      COUNT(*)::int AS attempts,
      COUNT(*) FILTER (WHERE (ans->>'isCorrect')::boolean IS TRUE)::int AS correct,
      COALESCE(
        SUM((ans->>'timeSpent')::bigint) FILTER (WHERE (ans->>'timeSpent') ~ '^\d+$'), 0
      ) AS total_ms,
      COUNT(*) FILTER (WHERE (ans->>'timeSpent') ~ '^\d+$')::int AS timed,
      MAX(at) AS last_at
    FROM answered
    GROUP BY topic, course_id
  ),
  -- Flashcard side: a server port of getDeckCardStats, keyed by card tag.
  cards AS (
    SELECT
      u.tag AS topic,
      COALESCE(d.course_id, v_zero) AS course_id,
      f.srs_data
    FROM public.flashcards f
    JOIN public.decks d ON d.id = f.deck_id
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN jsonb_typeof(f.tags) = 'array' AND jsonb_array_length(f.tags) > 0
        THEN (
          SELECT COALESCE(array_agg(btrim(t)) FILTER (WHERE btrim(t) <> ''), ARRAY['General'])
          FROM jsonb_array_elements_text(f.tags) AS x(t)
        )
        ELSE ARRAY['General']
      END AS tags
    ) tg
    CROSS JOIN LATERAL unnest(tg.tags) AS u(tag)
    WHERE d.user_id = p_user_id
  ),
  c_side AS (
    SELECT
      topic,
      course_id,
      COUNT(*)::int AS cards_total,
      COUNT(*) FILTER (WHERE COALESCE((srs_data->>'interval')::numeric, 0) >= 21)::int AS mature,
      COUNT(*) FILTER (
        WHERE srs_data->>'nextReviewDate' IS NOT NULL
          AND (srs_data->>'nextReviewDate') ~ '^\d{4}-\d{2}-\d{2}'
          AND (srs_data->>'nextReviewDate')::date <= CURRENT_DATE
      )::int AS due,
      AVG((srs_data->>'stability')::numeric) FILTER (WHERE (srs_data->>'stability') ~ '^[0-9.]+$') AS stab,
      AVG((srs_data->>'difficulty')::numeric) FILTER (WHERE (srs_data->>'difficulty') ~ '^[0-9.]+$') AS diff,
      COUNT(*) FILTER (WHERE (srs_data->>'stability') ~ '^[0-9.]+$')::int AS stab_n,
      COUNT(*) FILTER (WHERE (srs_data->>'difficulty') ~ '^[0-9.]+$')::int AS diff_n,
      COUNT(*) FILTER (WHERE (srs_data->>'isLeech')::boolean IS TRUE)::int AS leeches
    FROM cards
    GROUP BY topic, course_id
  ),
  merged AS (
    -- A topic can appear on one side only.
    SELECT
      COALESCE(q.topic, c.topic) AS topic,
      COALESCE(q.course_id, c.course_id) AS course_id,
      q.attempts, q.correct, q.total_ms, q.timed, q.last_at,
      c.cards_total, c.mature, c.due, c.stab, c.diff, c.stab_n, c.diff_n, c.leeches
    FROM q_side q
    FULL OUTER JOIN c_side c
      ON c.topic = q.topic AND c.course_id = q.course_id
  ),
  upserted AS (
    INSERT INTO public.user_topic_mastery AS m (
      user_id, topic, course_id,
      attempts, correct, accuracy, avg_response_s, last_attempt_at,
      cards_total, cards_mature, cards_due, avg_stability, avg_difficulty, leech_count,
      mastery_score, refreshed_at
    )
    SELECT
      p_user_id,
      topic,
      -- The CTEs collapse "no course" onto the zero uuid so the FULL JOIN key
      -- matches; the stored column must go back to NULL or the FK to courses
      -- rejects the row.
      NULLIF(course_id, v_zero),
      COALESCE(attempts, 0),
      COALESCE(correct, 0),
      CASE WHEN COALESCE(attempts, 0) > 0
        THEN ROUND(correct::numeric / attempts, 4) ELSE 0 END,
      CASE WHEN COALESCE(timed, 0) > 0
        THEN ROUND((total_ms::numeric / timed) / 1000, 2) ELSE NULL END,
      last_at,
      COALESCE(cards_total, 0),
      COALESCE(mature, 0),
      COALESCE(due, 0),
      CASE WHEN COALESCE(stab_n, 0) > 0 THEN ROUND(stab, 3) ELSE NULL END,
      CASE WHEN COALESCE(diff_n, 0) > 0 THEN ROUND(diff, 3) ELSE NULL END,
      COALESCE(leeches, 0),
      -- Blend: question accuracy where there is enough evidence, card maturity
      -- where there is not, weighted 70/30 when both exist. NULL means "we
      -- genuinely don't know" — callers must not render that as 0 % mastery.
      CASE
        WHEN COALESCE(attempts, 0) >= 3 AND COALESCE(cards_total, 0) > 0 THEN
          ROUND(
            (0.7 * (correct::numeric / attempts)
             + 0.3 * (mature::numeric / GREATEST(cards_total, 1))) * 100
          )::int
        WHEN COALESCE(attempts, 0) >= 3 THEN
          ROUND((correct::numeric / attempts) * 100)::int
        WHEN COALESCE(cards_total, 0) >= 5 THEN
          ROUND((mature::numeric / GREATEST(cards_total, 1)) * 100)::int
        ELSE NULL
      END,
      now()
    FROM merged
    ON CONFLICT (user_id, topic, COALESCE(course_id, '00000000-0000-0000-0000-000000000000'::uuid))
    DO UPDATE SET
      attempts = EXCLUDED.attempts,
      correct = EXCLUDED.correct,
      accuracy = EXCLUDED.accuracy,
      avg_response_s = EXCLUDED.avg_response_s,
      last_attempt_at = EXCLUDED.last_attempt_at,
      cards_total = EXCLUDED.cards_total,
      cards_mature = EXCLUDED.cards_mature,
      cards_due = EXCLUDED.cards_due,
      avg_stability = EXCLUDED.avg_stability,
      avg_difficulty = EXCLUDED.avg_difficulty,
      leech_count = EXCLUDED.leech_count,
      mastery_score = EXCLUDED.mastery_score,
      refreshed_at = now()
    RETURNING 1
  )
  SELECT COUNT(*)::int INTO v_rows FROM upserted;

  -- Retire rows whose topic no longer appears on either side (deleted decks,
  -- retagged questions) so the graph does not accumulate ghosts. Every row
  -- touched above was stamped with now(), which is the TRANSACTION timestamp
  -- and therefore identical for all of them — so "older than now()" is exactly
  -- "not touched by this run". Do NOT use clock_timestamp() here: it runs ahead
  -- of now() and would delete the rows this very call just wrote.
  DELETE FROM public.user_topic_mastery m
  WHERE m.user_id = p_user_id AND m.refreshed_at < now();

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_user_topic_mastery(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_user_topic_mastery(uuid, integer) TO service_role;

-- ============ 3. Population aggregates (min cohort n >= 20) ============
-- Modelled on marketplace_zone_analytics: service-role only, and it refuses to
-- answer for a cohort small enough to identify individuals.

CREATE OR REPLACE FUNCTION public.course_topic_mastery(
  p_course_id uuid,
  p_min_cohort integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_min integer := GREATEST(20, COALESCE(p_min_cohort, 20));
  v_cohort integer := 0;
  v_topics jsonb;
BEGIN
  IF p_course_id IS NULL THEN
    RETURN jsonb_build_object('available', false, 'reason', 'no_course');
  END IF;

  SELECT COUNT(DISTINCT user_id)::int INTO v_cohort
  FROM public.user_topic_mastery
  WHERE course_id = p_course_id;

  IF v_cohort < v_min THEN
    RETURN jsonb_build_object(
      'available', false, 'reason', 'cohort_too_small',
      'cohortSize', v_cohort, 'minCohort', v_min
    );
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.avg_accuracy), '[]'::jsonb)
  INTO v_topics
  FROM (
    SELECT
      topic,
      COUNT(DISTINCT user_id)::int AS learners,
      ROUND(AVG(accuracy), 4) AS avg_accuracy,
      ROUND(AVG(mastery_score) FILTER (WHERE mastery_score IS NOT NULL), 1) AS avg_mastery
    FROM public.user_topic_mastery
    WHERE course_id = p_course_id AND attempts > 0
    GROUP BY topic
    HAVING COUNT(DISTINCT user_id) >= v_min
  ) t;

  RETURN jsonb_build_object(
    'available', true, 'cohortSize', v_cohort, 'minCohort', v_min, 'topics', v_topics
  );
END;
$$;

REVOKE ALL ON FUNCTION public.course_topic_mastery(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.course_topic_mastery(uuid, integer) TO service_role;
