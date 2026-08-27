-- Phase 4 V — Cross-university study rooms.
--
-- Repurposes the dormant study_sessions / study_session_participants tables
-- (originally deck-scoped labs that no code ever wrote). Rooms attach to a
-- course and optional community/topic, not only a deck.
--
-- Writes are service-role only. Direct client INSERT would skip join-or-create
-- matching and inflate rosters. SELECT is granted so a presence channel on the
-- room id is not blocked by 42501 — policies never subquery their own table
-- (42P17 at runtime, not CREATE POLICY time).

-- topic_id is added without a FK first: a single ALTER that referenced
-- course_topics aborted the whole add on databases that have not applied
-- 20260826120000 yet (kind/title never landed). Attach the FK only when
-- that table exists — production already has it.
ALTER TABLE public.study_sessions
  ADD COLUMN IF NOT EXISTS course_id UUID REFERENCES public.courses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS community_id UUID REFERENCES public.communities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS topic_id UUID,
  ADD COLUMN IF NOT EXISTS topic TEXT,
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'room';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'course_topics'
  ) THEN
    ALTER TABLE public.study_sessions
      DROP CONSTRAINT IF EXISTS study_sessions_topic_id_fkey;
    ALTER TABLE public.study_sessions
      ADD CONSTRAINT study_sessions_topic_id_fkey
      FOREIGN KEY (topic_id) REFERENCES public.course_topics(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE public.study_sessions
  DROP CONSTRAINT IF EXISTS study_sessions_kind_check;
ALTER TABLE public.study_sessions
  ADD CONSTRAINT study_sessions_kind_check
  CHECK (kind IN ('room', 'lab'));

ALTER TABLE public.study_session_participants
  ADD COLUMN IF NOT EXISTS left_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS study_sessions_active_course_idx
  ON public.study_sessions (course_id, started_at DESC)
  WHERE is_active = true AND kind = 'room';

CREATE INDEX IF NOT EXISTS study_sessions_active_community_idx
  ON public.study_sessions (community_id, started_at DESC)
  WHERE is_active = true AND community_id IS NOT NULL;

-- Drop deck-scoped policies from 20260520 / 20260607. Those required a deck
-- the room no longer has, so every SELECT would have been empty even after
-- the GRANT below.
DROP POLICY IF EXISTS study_sessions_select ON public.study_sessions;
DROP POLICY IF EXISTS study_sessions_insert ON public.study_sessions;
DROP POLICY IF EXISTS study_sessions_update ON public.study_sessions;
DROP POLICY IF EXISTS study_sessions_delete ON public.study_sessions;
DROP POLICY IF EXISTS study_session_participants_select ON public.study_session_participants;
DROP POLICY IF EXISTS study_session_participants_insert ON public.study_session_participants;
DROP POLICY IF EXISTS study_session_participants_update ON public.study_session_participants;
DROP POLICY IF EXISTS study_session_participants_delete ON public.study_session_participants;

-- Joinable rooms are visible to any signed-in student (cross-university).
-- Own created rooms remain readable after they close. Do NOT subquery
-- study_sessions from inside a policy ON study_sessions.
CREATE POLICY study_sessions_select ON public.study_sessions
  FOR SELECT TO authenticated
  USING (is_active = true OR created_by = auth.uid());

-- Own participation rows only. Co-member rosters come from GET /study-rooms/:id,
-- which runs as the service role. Subquerying this table from its own policy
-- is the 42P17 trap.
CREATE POLICY study_session_participants_select ON public.study_session_participants
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT ON public.study_sessions TO authenticated;
GRANT SELECT ON public.study_session_participants TO authenticated;

REVOKE INSERT, UPDATE, DELETE ON public.study_sessions FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.study_session_participants FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.study_sessions.kind IS
  'room = Phase 4 V study room; lab kept for any leftover deck-scoped rows.';
COMMENT ON COLUMN public.study_sessions.topic IS
  'Free-text study topic (e.g. cardiology) used to match join-or-create.';
