-- Offers and hire close-out for job applications.
--
-- The pipeline ended at the interview: an employer could flip an application to
-- "hired" but nothing recorded what was actually offered, and the candidate had
-- no way to accept or decline on the record. An offer row holds the terms, the
-- candidate's answer, and whether accepting should close the posting.
--
-- Like interviews, an offer is visible to BOTH sides: the candidate has to read
-- the terms in order to answer them.

CREATE TABLE IF NOT EXISTS public.job_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.job_applications(id) ON DELETE CASCADE,
  posting_id UUID NOT NULL REFERENCES public.job_postings(id) ON DELETE CASCADE,
  applicant_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent', 'accepted', 'declined', 'withdrawn', 'expired')),
  -- Same shape as job_postings.compensation so the terms read identically.
  compensation JSONB NOT NULL DEFAULT '{"kind":"discuss"}'::JSONB,
  -- Date-only: a start date has no meaningful time of day.
  start_date DATE,
  engagement_duration JSONB,
  location_text TEXT,
  details TEXT,
  -- Respond-by deadline. A 'sent' offer past this reads as expired.
  expires_at TIMESTAMPTZ,
  -- Whether the candidate accepting should also take the posting out of search.
  close_posting_on_accept BOOLEAN NOT NULL DEFAULT TRUE,
  responded_at TIMESTAMPTZ,
  decline_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_offers_application
  ON public.job_offers(application_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_offers_applicant
  ON public.job_offers(applicant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_offers_posting
  ON public.job_offers(posting_id, created_at DESC);

-- Only one offer per application may be outstanding: two live offers would let
-- a candidate accept terms the employer had already replaced. Enforced here as
-- well as in the API so a retry or race cannot slip a second one through.
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_offers_one_open_per_application
  ON public.job_offers(application_id)
  WHERE status = 'sent';

ALTER TABLE public.job_offers ENABLE ROW LEVEL SECURITY;

-- Readable by the candidate and by the hiring side of the posting.
CREATE POLICY job_offers_participants_read ON public.job_offers
  FOR SELECT USING (
    applicant_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.job_postings p
      WHERE p.id = job_offers.posting_id
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
-- status transition rules and the hire close-out cannot be bypassed.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.job_offers FROM authenticated, anon;
GRANT SELECT ON TABLE public.job_offers TO authenticated;
