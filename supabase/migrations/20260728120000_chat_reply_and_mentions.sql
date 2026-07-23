-- Reply-to and @mentions for group messages; reply-to for DMs.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS reply_to_message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mentioned_user_ids UUID[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_messages_reply_to_message_id
  ON public.messages (reply_to_message_id)
  WHERE reply_to_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_mentioned_user_ids
  ON public.messages USING GIN (mentioned_user_ids);

ALTER TABLE public.dm_messages
  ADD COLUMN IF NOT EXISTS reply_to_message_id UUID REFERENCES public.dm_messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_dm_messages_reply_to_message_id
  ON public.dm_messages (reply_to_message_id)
  WHERE reply_to_message_id IS NOT NULL;

-- Allow DM participants to read chat media under {ownerId}/chat/dm/{threadId}/...
DROP POLICY IF EXISTS note_files_chat_dm_select ON storage.objects;
CREATE POLICY note_files_chat_dm_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'note-files'
    AND (storage.foldername(name))[2] = 'chat'
    AND (storage.foldername(name))[3] = 'dm'
    AND (storage.foldername(name))[4] IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.dm_threads t
      WHERE t.id = (storage.foldername(name))[4]
        AND t.participant_ids @> to_jsonb(ARRAY[auth.uid()::text])
    )
  );
