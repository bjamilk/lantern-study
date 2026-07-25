-- Per-conversation notification mutes for group chats and DMs.
-- muted_until in the past (or row deleted) means not muted.

CREATE TABLE IF NOT EXISTS public.chat_mutes (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  scope_type text NOT NULL CHECK (scope_type IN ('group', 'dm')),
  scope_id uuid NOT NULL,
  muted_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scope_type, scope_id)
);

-- Note: avoid WHERE muted_until > now() — now() is not IMMUTABLE for index predicates.
CREATE INDEX IF NOT EXISTS idx_chat_mutes_scope_until
  ON public.chat_mutes (scope_type, scope_id, muted_until);

CREATE INDEX IF NOT EXISTS idx_chat_mutes_user_until
  ON public.chat_mutes (user_id, muted_until);

COMMENT ON TABLE public.chat_mutes IS
  'Per-user mute windows for group or DM notification delivery. Checked before creating chat notifications.';

ALTER TABLE public.chat_mutes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_mutes_select ON public.chat_mutes;
DROP POLICY IF EXISTS chat_mutes_insert ON public.chat_mutes;
DROP POLICY IF EXISTS chat_mutes_update ON public.chat_mutes;
DROP POLICY IF EXISTS chat_mutes_delete ON public.chat_mutes;

CREATE POLICY chat_mutes_select ON public.chat_mutes
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY chat_mutes_insert ON public.chat_mutes
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY chat_mutes_update ON public.chat_mutes
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY chat_mutes_delete ON public.chat_mutes
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_mutes TO authenticated;
GRANT ALL ON public.chat_mutes TO service_role;
