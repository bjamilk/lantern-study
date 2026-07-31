-- Named companion chat threads so users can keep multiple general chats
-- (and multiple note-linked chats) without clearing prior history.

CREATE TABLE IF NOT EXISTS public.ai_companion_conversations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note_context_id UUID NULL REFERENCES public.notes(id) ON DELETE SET NULL,
  title TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_companion_conversations_user_updated
  ON public.ai_companion_conversations(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_companion_conversations_user_note_updated
  ON public.ai_companion_conversations(user_id, note_context_id, updated_at DESC);

ALTER TABLE public.ai_companion_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS companion_conversations_select_own ON public.ai_companion_conversations;
DROP POLICY IF EXISTS companion_conversations_insert_own ON public.ai_companion_conversations;
DROP POLICY IF EXISTS companion_conversations_update_own ON public.ai_companion_conversations;
DROP POLICY IF EXISTS companion_conversations_delete_own ON public.ai_companion_conversations;

CREATE POLICY companion_conversations_select_own ON public.ai_companion_conversations
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY companion_conversations_insert_own ON public.ai_companion_conversations
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY companion_conversations_update_own ON public.ai_companion_conversations
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY companion_conversations_delete_own ON public.ai_companion_conversations
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

ALTER TABLE public.ai_companion_messages
  ADD COLUMN IF NOT EXISTS conversation_id UUID NULL
    REFERENCES public.ai_companion_conversations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_companion_messages_user_conversation_created
  ON public.ai_companion_messages(user_id, conversation_id, created_at DESC);

-- Backfill: one conversation per existing (user_id, note_context_id) partition.
DO $$
DECLARE
  grp RECORD;
  new_id UUID;
  first_user_msg TEXT;
BEGIN
  FOR grp IN
    SELECT
      user_id,
      note_context_id,
      MIN(created_at) AS first_at,
      MAX(created_at) AS last_at
    FROM public.ai_companion_messages
    WHERE conversation_id IS NULL
    GROUP BY user_id, note_context_id
  LOOP
    SELECT LEFT(TRIM(m.content), 80)
      INTO first_user_msg
    FROM public.ai_companion_messages m
    WHERE m.user_id = grp.user_id
      AND m.role = 'user'
      AND (
        (grp.note_context_id IS NULL AND m.note_context_id IS NULL)
        OR m.note_context_id = grp.note_context_id
      )
      AND m.conversation_id IS NULL
    ORDER BY m.created_at ASC
    LIMIT 1;

    INSERT INTO public.ai_companion_conversations (
      user_id, note_context_id, title, created_at, updated_at
    )
    VALUES (
      grp.user_id,
      grp.note_context_id,
      NULLIF(TRIM(COALESCE(first_user_msg, '')), ''),
      grp.first_at,
      grp.last_at
    )
    RETURNING id INTO new_id;

    UPDATE public.ai_companion_messages m
    SET conversation_id = new_id
    WHERE m.user_id = grp.user_id
      AND m.conversation_id IS NULL
      AND (
        (grp.note_context_id IS NULL AND m.note_context_id IS NULL)
        OR m.note_context_id = grp.note_context_id
      );
  END LOOP;
END $$;
