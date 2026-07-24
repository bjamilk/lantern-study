-- DM message requests: cold outreach can open a pending thread until the
-- recipient accepts (or replies), which opens two-way messaging.

ALTER TABLE public.dm_threads
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open';

ALTER TABLE public.dm_threads
  ADD COLUMN IF NOT EXISTS requested_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.dm_threads
  DROP CONSTRAINT IF EXISTS dm_threads_status_check;

ALTER TABLE public.dm_threads
  ADD CONSTRAINT dm_threads_status_check
  CHECK (status IN ('open', 'pending', 'declined'));

COMMENT ON COLUMN public.dm_threads.status IS
  'open = two-way; pending = message request awaiting recipient; declined = request rejected';

COMMENT ON COLUMN public.dm_threads.requested_by IS
  'User who initiated a pending message request (null when status is open)';

-- Existing threads are established conversations.
UPDATE public.dm_threads SET status = 'open' WHERE status IS NULL OR status = '';

CREATE INDEX IF NOT EXISTS idx_dm_threads_status ON public.dm_threads (status);
