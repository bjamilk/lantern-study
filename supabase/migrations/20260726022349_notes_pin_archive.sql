-- Soft-archive and pin for personal notes lists.

ALTER TABLE notes
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_notes_user_archived_updated
  ON notes (user_id, is_archived, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_notes_user_pinned
  ON notes (user_id, is_pinned DESC, pinned_at DESC NULLS LAST)
  WHERE is_archived = false;
