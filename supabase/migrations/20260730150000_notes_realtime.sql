-- Enable Realtime for notes collaboration (list + open note content) and
-- collaborator membership changes. RLS still scopes which rows each user sees.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notes;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'note_collaborators'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.note_collaborators;
  END IF;
END $$;

ALTER TABLE IF EXISTS public.notes REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.note_collaborators REPLICA IDENTITY FULL;
