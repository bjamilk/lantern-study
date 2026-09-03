-- Community boards: a community's channels stop being study chats.
--
-- Founder decision 2026-09-02 (§0a.1): the lounge STAYS a live chat. It is not
-- a board and it gets no enum value and no backfill — it is already
-- identifiable as `communities.lounge_group_id`, so the surface is derived:
--   id = communities.lounge_group_id            -> chat ("General")
--   community_id IS NOT NULL AND surface <> 'study_group' -> board
-- `community_surface` therefore only has to distinguish 'study_group' from
-- everything else.

-- Which surface a community group renders as. NULL = legacy = 'board', so the
-- backfill is a no-op: every group that has a community_id today IS a channel.
-- Irrelevant (and left NULL) on groups with no community_id.
ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS community_surface TEXT
  CHECK (community_surface IS NULL OR community_surface IN ('board', 'study_group'));

-- A post's optional title, and the server-side pin that replaces the
-- device-local AsyncStorage pin (single, mobile-only, visible to one person).
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS subject TEXT,
  ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pinned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- The board's own query is roots-only. The existing thread index
-- (20260728140000) is WHERE thread_root_id IS NOT NULL — the opposite polarity.
CREATE INDEX IF NOT EXISTS idx_messages_group_roots
  ON public.messages (group_id, timestamp DESC)
  WHERE thread_root_id IS NULL;

-- One pin per board, enforced by the database, not by the client.
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_one_pin_per_group
  ON public.messages (group_id)
  WHERE pinned_at IS NOT NULL;

COMMENT ON COLUMN public.groups.community_surface IS
  'board = a community board (default for any group with community_id); study_group = a study group listed in a community but living in Chat. The community lounge (communities.lounge_group_id) stays a live chat and is NOT marked here.';

NOTIFY pgrst, 'reload schema';
