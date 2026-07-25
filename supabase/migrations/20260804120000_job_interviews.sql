-- Interview scheduling for job applications.
--
-- Moving a candidate to the "interview" status said nothing about when, where,
-- or how the interview happens, so the actual arrangement fell back to free-text
-- chat and was easy to lose. An interview row records the times the employer
-- offered and the one the candidate accepted, so both sides see the same plan.
--
-- Unlike notes, an interview is visible to BOTH sides: the candidate has to be
-- able to read the times in order to pick one.

CREATE TABLE IF NOT EXISTS public.job_interviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.job_applications(id) ON DELETE CASCADE,
  posting_id UUID NOT NULL REFERENCES public.job_postings(id) ON DELETE CASCADE,
  applicant_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'video'
    CHECK (mode IN ('video', 'phone', 'onsite')),
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'confirmed', 'declined', 'cancelled', 'completed')),
  duration_minutes INTEGER NOT NULL DEFAULT 30
    CHECK (duration_minutes BETWEEN 15 AND 480),
  -- Meeting link, phone number, or address depending on `mode`.
  location_text TEXT,
  details TEXT,
  -- Times offered by the employer, ISO 8601 strings, ascending.
  proposed_slots JSONB NOT NULL DEFAULT '[]'::JSONB,
  -- The slot the candidate accepted; NULL until they do.
  scheduled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_interviews_application
  ON public.job_interviews(application_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_interviews_applicant
  ON public.job_interviews(applicant_id, created_at DESC);

-- Supports "what is coming up" lookups without scanning finished interviews.
CREATE INDEX IF NOT EXISTS idx_job_interviews_upcoming
  ON public.job_interviews(scheduled_at)
  WHERE status IN ('proposed', 'confirmed');

ALTER TABLE public.job_interviews ENABLE ROW LEVEL SECURITY;

-- Readable by the candidate and by the hiring side of the posting.
CREATE POLICY job_interviews_participants_read ON public.job_interviews
  FOR SELECT USING (
    applicant_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.job_postings p
      WHERE p.id = job_interviews.posting_id
        AND (
          p.poster_user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.job_company_members m
            WHERE m.company_id = p.company_id AND m.user_id = auth.uid()
          )
        )
    )
  );

-- Client writes are locked; the API service role performs mutations so the
-- status transition rules cannot be bypassed.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.job_interviews FROM authenticated, anon;
GRANT SELECT ON TABLE public.job_interviews TO authenticated;
