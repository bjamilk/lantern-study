-- Community lounges: one persistent, open chat per community.
--
-- The founder's read of Discover was right: a community that is only a member
-- directory is not a community. The fix rides the EXISTING chat stack — a
-- lounge is a plain `groups` row with visibility='community' (which
-- joinDiscoverableGroup already gates on community membership), so messages,
-- realtime, previews, mute/archive all work with zero new chat code. This
-- migration only adds the pointer from the community to its lounge group.
--
-- The lounge group is created lazily by the API on first open (service role),
-- with admin_ids = '{}' — an official scope community's lounge has no owner
-- to delete or hijack it. ON DELETE SET NULL: if the group is ever removed,
-- the next open mints a fresh lounge instead of 500ing.

ALTER TABLE public.communities
  ADD COLUMN IF NOT EXISTS lounge_group_id UUID REFERENCES public.groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_communities_lounge_group
  ON public.communities (lounge_group_id)
  WHERE lounge_group_id IS NOT NULL;

COMMENT ON COLUMN public.communities.lounge_group_id IS
  'The community''s open chat: a groups row with visibility=community, minted lazily by the API. No admins by design.';

NOTIFY pgrst, 'reload schema';
