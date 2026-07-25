-- Private recruiter notes on an application.
--
-- Employers had no place to record why a candidate was advanced or passed on,
-- so triage context lived in memory (or nowhere) and was invisible to the rest
-- of a hiring team. Notes are visible to the posting owner and to members of
-- the posting's company; the applicant must never see them.

CREATE TABLE IF NOT EXISTS public.job_application_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.job_applications(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_application_notes_application
  ON public.job_application_notes(application_id, created_at DESC);

ALTER TABLE public.job_application_notes ENABLE ROW LEVEL SECURITY;

-- Mirrors the API's authorization check so a direct client read cannot leak a
-- note to the candidate it is about.
CREATE POLICY job_application_notes_hiring_side ON public.job_application_notes
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.job_applications a
      JOIN public.job_postings p ON p.id = a.posting_id
      WHERE a.id = job_application_notes.application_id
        AND (
          p.poster_user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.job_company_members m
            WHERE m.company_id = p.company_id AND m.user_id = auth.uid()
          )
        )
    )
  );

-- Client writes are locked; the API service role performs mutations.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.job_application_notes FROM authenticated, anon;
GRANT SELECT ON TABLE public.job_application_notes TO authenticated;
