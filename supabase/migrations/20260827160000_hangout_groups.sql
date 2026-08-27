-- Hangout: one persistent lounge group per community, one private group per
-- study room. Chat stays on the existing groups / group_members / messages
-- stack — no second messages table, no websocket.
--
-- Writes to these link columns are service-role only (same as study_rooms:
-- authenticated already has INSERT/UPDATE revoked on both parent tables).
-- Paste this whole file in the Supabase SQL editor if migrations are not
-- auto-applied.

ALTER TABLE public.communities
  ADD COLUMN IF NOT EXISTS lounge_group_id UUID REFERENCES public.groups(id) ON DELETE SET NULL;

ALTER TABLE public.study_sessions
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES public.groups(id) ON DELETE SET NULL;

-- One lounge group is owned by at most one community.
CREATE UNIQUE INDEX IF NOT EXISTS communities_lounge_group_id_uidx
  ON public.communities (lounge_group_id)
  WHERE lounge_group_id IS NOT NULL;

-- One hangout group is owned by at most one study room.
CREATE UNIQUE INDEX IF NOT EXISTS study_sessions_group_id_uidx
  ON public.study_sessions (group_id)
  WHERE group_id IS NOT NULL;

COMMENT ON COLUMN public.communities.lounge_group_id IS
  'Persistent community lounge (groups.visibility = community). Service-role writes only.';
COMMENT ON COLUMN public.study_sessions.group_id IS
  'Private hangout thread for this study room. Service-role writes only.';
