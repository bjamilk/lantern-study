-- Nested reply threads: thread_root_id on group + DM messages

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS thread_root_id UUID REFERENCES public.messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_messages_thread_root
  ON public.messages (group_id, thread_root_id, timestamp)
  WHERE thread_root_id IS NOT NULL;

ALTER TABLE public.dm_messages
  ADD COLUMN IF NOT EXISTS thread_root_id UUID REFERENCES public.dm_messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_dm_messages_thread_root
  ON public.dm_messages (thread_id, thread_root_id, timestamp)
  WHERE thread_root_id IS NOT NULL;

-- Backfill one level: reply → parent.root or parent.id
UPDATE public.messages m
SET thread_root_id = COALESCE(p.thread_root_id, p.id)
FROM public.messages p
WHERE m.reply_to_message_id = p.id
  AND m.thread_root_id IS NULL;

UPDATE public.dm_messages m
SET thread_root_id = COALESCE(p.thread_root_id, p.id)
FROM public.dm_messages p
WHERE m.reply_to_message_id = p.id
  AND m.thread_root_id IS NULL;

-- Second pass for short chains (reply → reply → root)
UPDATE public.messages m
SET thread_root_id = COALESCE(p.thread_root_id, p.id)
FROM public.messages p
WHERE m.reply_to_message_id = p.id
  AND m.thread_root_id IS DISTINCT FROM COALESCE(p.thread_root_id, p.id);

UPDATE public.dm_messages m
SET thread_root_id = COALESCE(p.thread_root_id, p.id)
FROM public.dm_messages p
WHERE m.reply_to_message_id = p.id
  AND m.thread_root_id IS DISTINCT FROM COALESCE(p.thread_root_id, p.id);
