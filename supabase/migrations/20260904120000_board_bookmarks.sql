-- Account-level bookmarks for board posts ("Saved posts").
--
-- Replaces the two divergent device-local implementations — mobile
-- AsyncStorage `lantern_starred_msgs:{userId}:{groupId}` (one set per board),
-- web localStorage `lantern:board:saved:{userId}` (one flat set for every
-- board). The two cannot read each other even in principle, both die on
-- reinstall, and neither platform has a screen that lists what was saved.
--
-- This is the ONE migration in this phase.

CREATE TABLE IF NOT EXISTS public.message_bookmarks (
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, message_id)
);

-- "Saved posts" is newest-saved-first, keyset on created_at, for ONE viewer.
CREATE INDEX IF NOT EXISTS idx_message_bookmarks_user
  ON public.message_bookmarks (user_id, created_at DESC);

-- The primary key leads on user_id, so a message_id lookup has no usable
-- index. Both cascade paths need one: deleting a post (account deletion
-- CASCADEs through messages.sender_id) and the per-board bookmark lookup the
-- board mount issues.
CREATE INDEX IF NOT EXISTS idx_message_bookmarks_message
  ON public.message_bookmarks (message_id);

-- RLS on with NO policies and no grants to anon/authenticated, exactly like
-- public.message_reactions (20260830120000). This is forced, not stylistic:
-- 20260723210655 dropped the UPDATE/DELETE policies on public.messages so all
-- mutation goes through the API under the service role and lands in
-- chat_message_audit. A table clients can write directly routes around that,
-- and a table clients can READ directly would let a student who has left a
-- board keep reading its members-only posts through their own bookmark list.
ALTER TABLE public.message_bookmarks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.message_bookmarks FROM anon, authenticated;
GRANT ALL ON public.message_bookmarks TO service_role;

COMMENT ON TABLE public.message_bookmarks IS
  'Private, account-level bookmarks on board posts. Service-role only. Deliberately has NO denormalised count: on a board where everyone can see the roster, a visible save count turns a private "read this later" into a social signal.';

-- Deliberate omissions, so a later reader does not "fix" them:
--   * no count column and no trigger. A bookmark is private; denormalising a
--     count onto messages (the pattern message_reactions established) would
--     publish who saved what inside a members-only board.
--   * both FKs ON DELETE CASCADE. messages.sender_id is already
--     ON DELETE CASCADE, so account deletion hard-deletes posts; a bookmark
--     must vanish with its post rather than become a dangling id rendering a
--     blank row.
--   * messages.type is NOT widened. No new row kind.

NOTIFY pgrst, 'reload schema';
