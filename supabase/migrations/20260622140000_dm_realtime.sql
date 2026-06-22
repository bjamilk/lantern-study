-- Enable Supabase Realtime for direct message tables

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'dm_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.dm_messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'dm_threads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.dm_threads;
  END IF;
END $$;

ALTER TABLE IF EXISTS public.dm_messages REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.dm_threads REPLICA IDENTITY FULL;
