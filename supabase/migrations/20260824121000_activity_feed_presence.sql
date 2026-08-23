-- Phase 3 M — Academic feed, engagement counters, presence-as-intent.
--
-- The feed is PULL-BASED by design. Web already holds ~8 realtime channels per
-- user; a ninth fan-out channel is the wrong trade. activity_events is written
-- once per action (not once per recipient) and GET /feed reads it by audience.
-- Direct-to-me events stay in notifications, which is the expensive per-recipient
-- path and should not grow.
--
-- Hand-apply AFTER 20260824120000_communities.sql (audience_id references
-- communities for audience_type='community').

-- ============ 1. activity_events ============

CREATE TABLE IF NOT EXISTS public.activity_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  verb text NOT NULL CHECK (verb IN (
    'published_pack', 'published_bank', 'shared_note', 'joined_group',
    'joined_community', 'completed_challenge', 'unlocked_badge',
    'followed_creator', 'added_deck_collaborator', 'answered_question'
  )),
  object_type text CHECK (object_type IN (
    'listing', 'note', 'deck', 'group', 'community', 'challenge', 'badge', 'profile', 'question'
  )),
  object_id text,
  -- Who may see it. One row per action; the reader resolves audience.
  audience_type text NOT NULL CHECK (audience_type IN ('community', 'group', 'followers', 'public')),
  audience_id uuid,                       -- community/group id; NULL for followers/public
  course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}',    -- denormalised title/price/etc for rendering
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The three read paths of GET /feed.
CREATE INDEX IF NOT EXISTS activity_events_audience_idx
  ON public.activity_events (audience_type, audience_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_events_actor_idx
  ON public.activity_events (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_events_public_idx
  ON public.activity_events (created_at DESC) WHERE audience_type = 'public';

ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.activity_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.activity_events TO service_role;

COMMENT ON TABLE public.activity_events IS
  'Phase 3 M — one row per social action, read by audience. Pull-based feed; NOT a realtime channel.';

-- ============ 2. Engagement counters ============
-- "Studied by 41 people" — maintained by the same writers that already touch
-- these rows, incremented through the RPCs below so a client cannot inflate them.

ALTER TABLE public.decks
  ADD COLUMN IF NOT EXISTS study_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS view_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS question_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS decks_study_count_idx
  ON public.decks (study_count DESC) WHERE study_count > 0;

-- Distinct-studier tracking, so study_count is people and not sessions.
CREATE TABLE IF NOT EXISTS public.deck_studiers (
  deck_id uuid NOT NULL REFERENCES public.decks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  first_studied_at timestamptz NOT NULL DEFAULT now(),
  last_studied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (deck_id, user_id)
);

ALTER TABLE public.deck_studiers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.deck_studiers FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.deck_studiers TO service_role;

CREATE OR REPLACE FUNCTION public.record_deck_study(p_deck_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new boolean := false;
BEGIN
  INSERT INTO public.deck_studiers (deck_id, user_id)
  VALUES (p_deck_id, p_user_id)
  ON CONFLICT (deck_id, user_id)
    DO UPDATE SET last_studied_at = now()
  RETURNING (xmax = 0) INTO v_new;

  IF v_new THEN
    UPDATE public.decks SET study_count = study_count + 1 WHERE id = p_deck_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.record_deck_study(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_deck_study(uuid, uuid) TO service_role;

-- Group question counter: messages of type QUESTION.
CREATE OR REPLACE FUNCTION public.group_question_count_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.type = 'QUESTION' AND NEW.group_id IS NOT NULL THEN
    UPDATE public.groups SET question_count = question_count + 1 WHERE id = NEW.group_id;
  ELSIF TG_OP = 'DELETE' AND OLD.type = 'QUESTION' AND OLD.group_id IS NOT NULL THEN
    UPDATE public.groups SET question_count = GREATEST(question_count - 1, 0) WHERE id = OLD.group_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS messages_group_question_count ON public.messages;
CREATE TRIGGER messages_group_question_count
  AFTER INSERT OR DELETE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.group_question_count_sync();

UPDATE public.groups g
SET question_count = sub.c
FROM (
  SELECT group_id, COUNT(*)::int AS c
  FROM public.messages
  WHERE type = 'QUESTION' AND group_id IS NOT NULL
  GROUP BY group_id
) sub
WHERE sub.group_id = g.id AND g.question_count IS DISTINCT FROM sub.c;

-- ============ 3. study_presence — presence as INTENT ============
-- "23 people studying cardiology tonight". Rows expire; the reader filters on
-- expires_at rather than relying on a sweeper. Honours showStudyActivity /
-- showOnlineStatus at the API layer, not here.

CREATE TABLE IF NOT EXISTS public.study_presence (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  context text NOT NULL DEFAULT 'studying'
    CHECK (context IN ('studying', 'reviewing', 'testing', 'reading', 'writing')),
  course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL,
  topic text CHECK (topic IS NULL OR char_length(topic) <= 80),
  -- Denormalised so /presence/now can aggregate without joining profiles.
  institution_id uuid REFERENCES public.marketplace_campuses(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes'
);

CREATE INDEX IF NOT EXISTS study_presence_course_idx
  ON public.study_presence (course_id, expires_at DESC) WHERE course_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS study_presence_institution_idx
  ON public.study_presence (institution_id, expires_at DESC) WHERE institution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS study_presence_expiry_idx
  ON public.study_presence (expires_at DESC);

ALTER TABLE public.study_presence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.study_presence FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.study_presence TO service_role;

COMMENT ON TABLE public.study_presence IS
  'Phase 3 M — what a user is studying right now (expires); aggregated by GET /presence/now.';
