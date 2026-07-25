-- Saved job searches and their alerts.
--
-- Candidates had to re-enter the same filters on every visit and had no way to
-- learn about a matching role except by checking back. A saved search stores a
-- filter set the board can reapply, and opts the owner into notifications when
-- a new posting matches it.

CREATE TABLE IF NOT EXISTS public.job_saved_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}'::JSONB,
  notify BOOLEAN NOT NULL DEFAULT TRUE,
  -- Alert watermark: postings created after this are candidates for the next run.
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_saved_searches_user
  ON public.job_saved_searches(user_id, created_at DESC);

-- The alert job only ever scans opted-in rows.
CREATE INDEX IF NOT EXISTS idx_job_saved_searches_notify
  ON public.job_saved_searches(last_checked_at)
  WHERE notify;

ALTER TABLE public.job_saved_searches ENABLE ROW LEVEL SECURITY;

CREATE POLICY job_saved_searches_owner_read ON public.job_saved_searches
  FOR SELECT USING (user_id = auth.uid());

-- Client writes are locked; the API service role performs mutations so the
-- per-user limit and filter normalization cannot be bypassed.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.job_saved_searches FROM authenticated, anon;
GRANT SELECT ON TABLE public.job_saved_searches TO authenticated;
