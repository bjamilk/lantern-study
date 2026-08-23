-- Phase 3 O — Weekly Active Learning Connections (the north-star metric).
--
-- A "learning connection" is one student measurably helping another learn.
-- It is deliberately NOT a page view or a session: actor must differ from
-- beneficiary, and a pair only counts once per kind per week — so the metric
-- cannot be inflated by one enthusiastic pair, and a week of growth means new
-- pairs, not more clicks.
--
-- Every source event already fires somewhere in the product; this migration is
-- the sink, and the API writes to it from those existing hooks.
--
-- Hand-apply AFTER 20260824122000_trust_disputes.sql.

-- ============ 1. learning_connections ============

CREATE TABLE IF NOT EXISTS public.learning_connections (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  beneficiary_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN (
    'challenge_completed',      -- played a challenge someone sent
    'group_question_answered',  -- answered a group-mate's question
    'question_voted',           -- upvoted someone's question
    'question_verified',        -- marked someone's answer correct
    'deck_collaborated',        -- studied a deck someone shares with them
    'note_redeemed',            -- opened / copied a shared note
    'pack_entitled',            -- received a creator's study pack or bank
    'pack_scored',              -- recorded a score on someone's pack
    'order_completed',          -- completed a marketplace order
    'review_left',              -- reviewed someone's listing
    'dm_accepted',              -- accepted a DM request
    'followed'                  -- followed a creator
  )),
  object_type text CHECK (object_type IN (
    'challenge', 'question', 'deck', 'note', 'listing', 'order', 'review', 'profile'
  )),
  object_id text,
  course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- ISO week start (Monday) in UTC. NOT a GENERATED column: `AT TIME ZONE` and
  -- date_trunc(text, timestamptz) are STABLE, and generation expressions must be
  -- IMMUTABLE — Postgres rejects the table outright. The trigger below forces the
  -- value from created_at on every write so no writer can disagree about which
  -- week a row belongs to, which is what the dedupe index depends on.
  week_start date NOT NULL DEFAULT (date_trunc('week', now() AT TIME ZONE 'UTC'))::date,
  CONSTRAINT learning_connections_distinct_parties CHECK (actor_id <> beneficiary_id)
);

CREATE OR REPLACE FUNCTION public.learning_connections_set_week()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.week_start := (date_trunc('week', COALESCE(NEW.created_at, now()) AT TIME ZONE 'UTC'))::date;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS learning_connections_week_start ON public.learning_connections;
CREATE TRIGGER learning_connections_week_start
  BEFORE INSERT OR UPDATE ON public.learning_connections
  FOR EACH ROW EXECUTE FUNCTION public.learning_connections_set_week();

-- The dedupe rule, enforced in the schema rather than in the writer: one row
-- per (actor, beneficiary, kind) per week. Writers use ON CONFLICT DO NOTHING.
CREATE UNIQUE INDEX IF NOT EXISTS learning_connections_weekly_uidx
  ON public.learning_connections (actor_id, beneficiary_id, kind, week_start);

CREATE INDEX IF NOT EXISTS learning_connections_week_idx
  ON public.learning_connections (week_start DESC);
CREATE INDEX IF NOT EXISTS learning_connections_beneficiary_idx
  ON public.learning_connections (beneficiary_id, week_start DESC);
CREATE INDEX IF NOT EXISTS learning_connections_course_idx
  ON public.learning_connections (course_id, week_start DESC) WHERE course_id IS NOT NULL;

ALTER TABLE public.learning_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.learning_connections FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.learning_connections TO service_role;

COMMENT ON TABLE public.learning_connections IS
  'Phase 3 O — north-star metric. One row per (actor, beneficiary, kind) per ISO week; actor <> beneficiary.';

-- ============ 2. Weekly rollup ============
-- Modelled on admin_analytics: a single service-role RPC returning the shape
-- the admin dashboard renders, so the client never queries the raw table.

CREATE OR REPLACE FUNCTION public.learning_connections_weekly(p_weeks integer DEFAULT 12)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_weeks integer := GREATEST(1, LEAST(52, COALESCE(p_weeks, 12)));
  v_from date := (date_trunc('week', now() AT TIME ZONE 'UTC') - (make_interval(weeks => v_weeks - 1)))::date;
  v_series jsonb;
  v_by_kind jsonb;
  v_current integer := 0;
  v_previous integer := 0;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.week_start), '[]'::jsonb)
  INTO v_series
  FROM (
    SELECT
      week_start,
      COUNT(*)::int AS connections,
      COUNT(DISTINCT actor_id)::int AS active_actors,
      COUNT(DISTINCT beneficiary_id)::int AS beneficiaries
    FROM public.learning_connections
    WHERE week_start >= v_from
    GROUP BY week_start
  ) t;

  SELECT COALESCE(jsonb_object_agg(kind, c), '{}'::jsonb)
  INTO v_by_kind
  FROM (
    SELECT kind, COUNT(*)::int AS c
    FROM public.learning_connections
    WHERE week_start >= v_from
    GROUP BY kind
  ) k;

  SELECT COUNT(*)::int INTO v_current
  FROM public.learning_connections
  WHERE week_start = (date_trunc('week', now() AT TIME ZONE 'UTC'))::date;

  SELECT COUNT(*)::int INTO v_previous
  FROM public.learning_connections
  WHERE week_start = (date_trunc('week', now() AT TIME ZONE 'UTC') - interval '1 week')::date;

  RETURN jsonb_build_object(
    'weeks', v_weeks,
    'series', v_series,
    'byKind', v_by_kind,
    'currentWeek', v_current,
    'previousWeek', v_previous,
    'weekOverWeekPct', CASE
      WHEN v_previous > 0 THEN ROUND(((v_current - v_previous)::numeric / v_previous) * 100, 1)
      ELSE NULL
    END,
    'generatedAt', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.learning_connections_weekly(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.learning_connections_weekly(integer) TO service_role;
