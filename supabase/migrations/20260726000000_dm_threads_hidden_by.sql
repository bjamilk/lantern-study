-- Soft-delete for DM threads: "Delete chat" hides the thread for that user only
-- instead of hard-deleting it for both participants (which also cascaded
-- marketplace_inquiries). A new message in the thread un-hides it for everyone.

ALTER TABLE public.dm_threads
  ADD COLUMN IF NOT EXISTS hidden_by jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.dm_threads.hidden_by IS
  'User ids who deleted (hid) this thread from their inbox. Cleared when a new message arrives.';
