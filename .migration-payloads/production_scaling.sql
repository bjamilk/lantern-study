-- Production scaling: indexes, realtime publication, storage path helper

-- Missing indexes for hot paths
CREATE INDEX IF NOT EXISTS idx_deck_collaborators_user_id
  ON public.deck_collaborators(user_id);

CREATE INDEX IF NOT EXISTS idx_groups_admin_ids_gin
  ON public.groups USING GIN (admin_ids);

CREATE INDEX IF NOT EXISTS idx_flashcards_srs_next_review
  ON public.flashcards (((srs_data->>'nextReviewDate')::date))
  WHERE srs_data IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_flashcard_comments_flashcard_id
  ON public.flashcard_comments(flashcard_id);

CREATE INDEX IF NOT EXISTS idx_study_session_participants_session_id
  ON public.study_session_participants(session_id);

-- Realtime: version-controlled publication for notifications only (chat via API polling fallback)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;

-- Ensure REPLICA IDENTITY for realtime tables
ALTER TABLE IF EXISTS public.notifications REPLICA IDENTITY FULL;
