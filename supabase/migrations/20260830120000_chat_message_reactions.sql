-- Emoji reactions on chat messages (group messages AND direct messages).
--
-- Shape follows chat_message_audit (20260723210655): ONE table with two
-- nullable parent ids and a num_nonnulls CHECK, rather than two near-identical
-- tables. Uniqueness is per (message, user, emoji) so a user may add several
-- different emoji to one message but cannot double-count one.
--
-- RLS: enabled with NO policies and no grants to authenticated/anon. This is
-- forced, not stylistic — 20260723210655 deliberately dropped the UPDATE and
-- DELETE policies on messages/dm_messages so that every chat mutation goes
-- through the API under the service role. Reactions follow that rule.
--
-- The denormalised `reactions` JSONB on each message table is what makes
-- realtime free: both tables are already in supabase_realtime with REPLICA
-- IDENTITY FULL, so the trigger's parent UPDATE reaches every subscribed
-- client over channels that already exist. No new subscription anywhere.

CREATE TABLE IF NOT EXISTS public.message_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_message_id UUID REFERENCES public.messages(id) ON DELETE CASCADE,
  dm_message_id UUID REFERENCES public.dm_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL CHECK (char_length(emoji) BETWEEN 1 AND 16),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT message_reactions_exactly_one_parent
    CHECK (num_nonnulls(group_message_id, dm_message_id) = 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_message_reactions_group
  ON public.message_reactions (group_message_id, user_id, emoji)
  WHERE group_message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_message_reactions_dm
  ON public.message_reactions (dm_message_id, user_id, emoji)
  WHERE dm_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_message_reactions_group_message
  ON public.message_reactions (group_message_id)
  WHERE group_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_message_reactions_dm_message
  ON public.message_reactions (dm_message_id)
  WHERE dm_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_message_reactions_user
  ON public.message_reactions (user_id);

ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.message_reactions FROM anon, authenticated;
GRANT ALL ON public.message_reactions TO service_role;

-- Denormalised counts: {"👍": 3, "🔥": 1}
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS reactions JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.dm_messages
  ADD COLUMN IF NOT EXISTS reactions JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Recount into whichever parent the row belongs to. SECURITY DEFINER so the
-- trigger can write the parent regardless of the caller's policies, mirroring
-- sync_message_vote_counts_from_vote.
CREATE OR REPLACE FUNCTION public.sync_message_reaction_counts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_group_message UUID := COALESCE(NEW.group_message_id, OLD.group_message_id);
  target_dm_message UUID := COALESCE(NEW.dm_message_id, OLD.dm_message_id);
BEGIN
  IF target_group_message IS NOT NULL THEN
    UPDATE public.messages m
      SET reactions = COALESCE((
        SELECT jsonb_object_agg(r.emoji, r.tally)
        FROM (
          SELECT emoji, COUNT(*) AS tally
          FROM public.message_reactions
          WHERE group_message_id = target_group_message
          GROUP BY emoji
        ) r
      ), '{}'::jsonb)
      WHERE m.id = target_group_message;
  END IF;

  IF target_dm_message IS NOT NULL THEN
    UPDATE public.dm_messages d
      SET reactions = COALESCE((
        SELECT jsonb_object_agg(r.emoji, r.tally)
        FROM (
          SELECT emoji, COUNT(*) AS tally
          FROM public.message_reactions
          WHERE dm_message_id = target_dm_message
          GROUP BY emoji
        ) r
      ), '{}'::jsonb)
      WHERE d.id = target_dm_message;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_message_reaction_counts ON public.message_reactions;
CREATE TRIGGER trg_sync_message_reaction_counts
  AFTER INSERT OR DELETE ON public.message_reactions
  FOR EACH ROW EXECUTE FUNCTION public.sync_message_reaction_counts();

COMMENT ON TABLE public.message_reactions IS
  'Emoji reactions on group messages and DMs. Service-role only; counts are denormalised onto messages.reactions / dm_messages.reactions by trigger.';

NOTIFY pgrst, 'reload schema';
