-- Add archived_by to DM threads to support per-user archiving

ALTER TABLE dm_threads
  ADD COLUMN IF NOT EXISTS archived_by JSONB DEFAULT '[]';

-- Ensure the column is indexed for quicker lookups
CREATE INDEX IF NOT EXISTS idx_dm_threads_archived_by ON dm_threads USING GIN (archived_by);
