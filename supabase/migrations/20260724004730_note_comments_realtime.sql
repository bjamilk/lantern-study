-- Publish note discussion changes so open shared notes can refresh comments
-- without requiring a full application reload. Existing note_comments RLS
-- policies continue to decide which authenticated recipients receive events.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'note_comments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.note_comments;
  END IF;
END $$;

ALTER TABLE IF EXISTS public.note_comments REPLICA IDENTITY FULL;
