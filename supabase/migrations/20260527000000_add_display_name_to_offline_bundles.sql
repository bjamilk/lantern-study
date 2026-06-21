-- Add display_name column to offline_bundles for user-assigned bundle names
ALTER TABLE offline_bundles
  ADD COLUMN IF NOT EXISTS display_name TEXT;
