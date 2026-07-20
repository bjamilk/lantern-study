-- Enable Supabase Realtime for group chat messages (text + questions).
-- Client subscriptions already exist on web and mobile; without this
-- publication, members must refresh to see new messages.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
END $$;

ALTER TABLE IF EXISTS public.messages REPLICA IDENTITY FULL;
