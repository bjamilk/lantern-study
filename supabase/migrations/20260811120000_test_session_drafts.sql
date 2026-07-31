-- Durable paused / in-progress test and study sessions on test_sessions.

ALTER TABLE public.test_sessions
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS session_kind TEXT,
  ADD COLUMN IF NOT EXISTS current_question_index INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remaining_time_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS title TEXT;

-- Backfill status from existing end_time semantics.
UPDATE public.test_sessions
SET status = CASE
  WHEN end_time IS NOT NULL THEN 'completed'
  WHEN questions IS NOT NULL
    AND jsonb_typeof(questions) = 'array'
    AND jsonb_array_length(questions) > 0 THEN 'paused'
  ELSE 'abandoned'
END
WHERE status IS NULL;

UPDATE public.test_sessions
SET session_kind = COALESCE(session_kind, 'test')
WHERE session_kind IS NULL;

UPDATE public.test_sessions
SET updated_at = COALESCE(end_time, start_time, NOW())
WHERE updated_at IS NULL;

ALTER TABLE public.test_sessions
  ALTER COLUMN status SET DEFAULT 'in_progress',
  ALTER COLUMN session_kind SET DEFAULT 'test';

ALTER TABLE public.test_sessions
  DROP CONSTRAINT IF EXISTS test_sessions_status_check;

ALTER TABLE public.test_sessions
  ADD CONSTRAINT test_sessions_status_check
  CHECK (status IN ('in_progress', 'paused', 'completed', 'abandoned'));

ALTER TABLE public.test_sessions
  DROP CONSTRAINT IF EXISTS test_sessions_session_kind_check;

ALTER TABLE public.test_sessions
  ADD CONSTRAINT test_sessions_session_kind_check
  CHECK (session_kind IN ('test', 'study'));

ALTER TABLE public.test_sessions
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN session_kind SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_test_sessions_user_status_updated
  ON public.test_sessions (user_id, status, updated_at DESC);
