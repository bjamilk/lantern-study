-- Jobs board (sibling domain to marketplace goods).
-- Phase 1: peer/campus-org postings + applications → DM
-- Phase 2: companies, verification, Easy Apply, external clicks, kanban statuses
-- Phase 3: sponsored slots, ATS hooks, school-admin approval

-- ─── Companies ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.job_companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  website TEXT,
  logo_url TEXT,
  industry TEXT,
  country_code TEXT NOT NULL DEFAULT 'NG',
  verification_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'pending', 'verified', 'rejected')),
  verification_domain TEXT,
  verification_note TEXT,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.job_company_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.job_companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'recruiter' CHECK (role IN ('owner', 'recruiter')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_job_company_members_user ON public.job_company_members(user_id);

-- ─── Postings ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.job_postings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  employment_type TEXT NOT NULL
    CHECK (employment_type IN (
      'gig', 'tutoring', 'part_time', 'campus_org', 'research',
      'internship', 'full_time', 'contract'
    )),
  campus_id UUID REFERENCES public.marketplace_campuses(id) ON DELETE SET NULL,
  campus_ids UUID[] NOT NULL DEFAULT '{}',
  location_text TEXT,
  is_remote BOOLEAN NOT NULL DEFAULT FALSE,
  compensation JSONB NOT NULL DEFAULT '{"kind":"discuss"}'::jsonb,
  deadline TIMESTAMPTZ,
  apply_mode TEXT NOT NULL DEFAULT 'in_app'
    CHECK (apply_mode IN ('in_app', 'external', 'both')),
  external_url TEXT,
  poster_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  company_id UUID REFERENCES public.job_companies(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN (
      'draft', 'active', 'paused', 'closed',
      'pending_school_approval', 'suspended_by_admin', 'removed_by_admin'
    )),
  views_count INTEGER NOT NULL DEFAULT 0,
  is_sponsored BOOLEAN NOT NULL DEFAULT FALSE,
  sponsored_until TIMESTAMPTZ,
  ats_provider TEXT,
  ats_external_id TEXT,
  ats_webhook_url TEXT,
  requires_school_approval BOOLEAN NOT NULL DEFAULT FALSE,
  country_code TEXT NOT NULL DEFAULT 'NG',
  search_vector tsvector,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_postings_status_created
  ON public.job_postings(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_postings_poster
  ON public.job_postings(poster_user_id);
CREATE INDEX IF NOT EXISTS idx_job_postings_company
  ON public.job_postings(company_id);
CREATE INDEX IF NOT EXISTS idx_job_postings_campus
  ON public.job_postings(campus_id);
CREATE INDEX IF NOT EXISTS idx_job_postings_employment_type
  ON public.job_postings(employment_type);
CREATE INDEX IF NOT EXISTS idx_job_postings_sponsored
  ON public.job_postings(is_sponsored, sponsored_until)
  WHERE is_sponsored = TRUE;
CREATE INDEX IF NOT EXISTS idx_job_postings_search
  ON public.job_postings USING GIN (search_vector);

CREATE OR REPLACE FUNCTION public.job_postings_search_vector_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.employment_type, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.location_text, '')), 'C');
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_job_postings_search_vector ON public.job_postings;
CREATE TRIGGER trg_job_postings_search_vector
  BEFORE INSERT OR UPDATE OF title, description, employment_type, location_text
  ON public.job_postings
  FOR EACH ROW
  EXECUTE FUNCTION public.job_postings_search_vector_update();

-- ─── Screening questions ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.job_screening_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  posting_id UUID NOT NULL REFERENCES public.job_postings(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  prompt TEXT NOT NULL,
  question_type TEXT NOT NULL DEFAULT 'text' CHECK (question_type IN ('text', 'single_choice')),
  options JSONB,
  required BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_screening_questions_posting
  ON public.job_screening_questions(posting_id, sort_order);

-- ─── Applications ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.job_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  posting_id UUID NOT NULL REFERENCES public.job_postings(id) ON DELETE CASCADE,
  applicant_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  resume_url TEXT,
  status TEXT NOT NULL DEFAULT 'interested'
    CHECK (status IN (
      'interested', 'chatting', 'new', 'reviewing', 'interview',
      'offer', 'hired', 'rejected', 'withdrawn'
    )),
  dm_thread_id TEXT REFERENCES public.dm_threads(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'in_app' CHECK (source IN ('in_app', 'external_click')),
  profile_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (posting_id, applicant_id)
);

CREATE INDEX IF NOT EXISTS idx_job_applications_posting
  ON public.job_applications(posting_id, status);
CREATE INDEX IF NOT EXISTS idx_job_applications_applicant
  ON public.job_applications(applicant_id, created_at DESC);

-- ─── Reports / favorites / external clicks ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.job_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  posting_id UUID NOT NULL REFERENCES public.job_postings(id) ON DELETE CASCADE,
  reporter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('scam', 'spam', 'inappropriate', 'discriminatory', 'other')),
  details TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (posting_id, reporter_id)
);

CREATE TABLE IF NOT EXISTS public.job_favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  posting_id UUID NOT NULL REFERENCES public.job_postings(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, posting_id)
);

CREATE TABLE IF NOT EXISTS public.job_external_apply_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  posting_id UUID NOT NULL REFERENCES public.job_postings(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_external_apply_clicks_posting
  ON public.job_external_apply_clicks(posting_id, created_at DESC);

-- ─── Resume storage bucket (private) ─────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'job-resumes',
  'job-resumes',
  false,
  5242880,
  ARRAY['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
ON CONFLICT (id) DO NOTHING;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.job_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_company_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_screening_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_external_apply_clicks ENABLE ROW LEVEL SECURITY;

-- Public can browse active (non-removed) postings; mutations are service-role only.
CREATE POLICY job_postings_select_public ON public.job_postings
  FOR SELECT USING (
    status IN ('active', 'paused', 'closed')
    OR poster_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.job_company_members m
      WHERE m.company_id = job_postings.company_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY job_screening_select ON public.job_screening_questions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.job_postings p
      WHERE p.id = posting_id
        AND (
          p.status IN ('active', 'paused', 'closed')
          OR p.poster_user_id = auth.uid()
        )
    )
  );

CREATE POLICY job_applications_select_participants ON public.job_applications
  FOR SELECT USING (
    applicant_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.job_postings p
      WHERE p.id = posting_id
        AND (
          p.poster_user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.job_company_members m
            WHERE m.company_id = p.company_id AND m.user_id = auth.uid()
          )
        )
    )
  );

CREATE POLICY job_companies_select ON public.job_companies
  FOR SELECT USING (
    verification_status = 'verified'
    OR created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.job_company_members m
      WHERE m.company_id = id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY job_company_members_select ON public.job_company_members
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.job_company_members m2
      WHERE m2.company_id = job_company_members.company_id AND m2.user_id = auth.uid()
    )
  );

CREATE POLICY job_favorites_own ON public.job_favorites
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY job_reports_own ON public.job_reports
  FOR SELECT USING (reporter_id = auth.uid());

CREATE POLICY job_external_clicks_own ON public.job_external_apply_clicks
  FOR SELECT USING (user_id = auth.uid());

-- Lock client writes — API service role performs mutations.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.job_companies FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.job_company_members FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.job_postings FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.job_screening_questions FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.job_applications FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.job_reports FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.job_favorites FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.job_external_apply_clicks FROM authenticated, anon;

GRANT SELECT ON TABLE public.job_companies TO authenticated, anon;
GRANT SELECT ON TABLE public.job_company_members TO authenticated;
GRANT SELECT ON TABLE public.job_postings TO authenticated, anon;
GRANT SELECT ON TABLE public.job_screening_questions TO authenticated, anon;
GRANT SELECT ON TABLE public.job_applications TO authenticated;
GRANT SELECT ON TABLE public.job_reports TO authenticated;
GRANT SELECT ON TABLE public.job_favorites TO authenticated;
GRANT SELECT ON TABLE public.job_external_apply_clicks TO authenticated;
