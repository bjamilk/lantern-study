-- Scope AI companion messages by optional note context so note-attached
-- conversations do not mix with each other or with the general thread.

ALTER TABLE public.ai_companion_messages
  ADD COLUMN IF NOT EXISTS note_context_id UUID NULL REFERENCES public.notes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_companion_messages_user_note_created
  ON public.ai_companion_messages(user_id, note_context_id, created_at DESC);
