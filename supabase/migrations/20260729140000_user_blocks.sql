-- User-level DM blocks: either direction prevents messaging both ways.

CREATE TABLE IF NOT EXISTS public.user_blocks (
  blocker_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT user_blocks_no_self CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked_id ON public.user_blocks (blocked_id);

COMMENT ON TABLE public.user_blocks IS
  'DM blocks. If A blocks B (or B blocks A), neither may send DMs to the other.';

ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_blocks_select ON public.user_blocks;
DROP POLICY IF EXISTS user_blocks_insert ON public.user_blocks;
DROP POLICY IF EXISTS user_blocks_delete ON public.user_blocks;

-- Blocker can see their own block list; blocked user can see that they were blocked by someone
-- only as needed for mutual enforcement via the API (service role). Keep client reads to blocker.
CREATE POLICY user_blocks_select ON public.user_blocks
  FOR SELECT TO authenticated
  USING (blocker_id = auth.uid());

CREATE POLICY user_blocks_insert ON public.user_blocks
  FOR INSERT TO authenticated
  WITH CHECK (blocker_id = auth.uid());

CREATE POLICY user_blocks_delete ON public.user_blocks
  FOR DELETE TO authenticated
  USING (blocker_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.user_blocks TO authenticated;
GRANT ALL ON public.user_blocks TO service_role;
