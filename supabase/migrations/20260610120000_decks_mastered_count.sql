-- Optional denormalized deck stat (computed from flashcard SRS in app; not required for core flows)
ALTER TABLE public.decks
  ADD COLUMN IF NOT EXISTS mastered_count INTEGER NOT NULL DEFAULT 0;
