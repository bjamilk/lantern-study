-- Reusable applicant details + real resume files.
--
-- Applications previously stored only a pasted `resume_url`, which most
-- candidates cannot produce. Resumes now live in the existing private
-- `job-resumes` bucket and are referenced by storage path; the API mints
-- short-lived signed URLs for the applicant and for authorized employers.

CREATE TABLE IF NOT EXISTS public.job_applicant_profiles (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  headline TEXT,
  phone TEXT,
  location_text TEXT,
  resume_path TEXT,
  resume_filename TEXT,
  resume_size_bytes INTEGER,
  resume_uploaded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN public.job_applicant_profiles.resume_path IS
  'Object path within the private job-resumes bucket, always prefixed with the owning user id.';

-- Each application keeps the resume it was submitted with, so replacing the
-- profile resume later does not rewrite history for employers.
ALTER TABLE public.job_applications
  ADD COLUMN IF NOT EXISTS resume_path TEXT,
  ADD COLUMN IF NOT EXISTS resume_filename TEXT;

ALTER TABLE public.job_applicant_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY job_applicant_profiles_own ON public.job_applicant_profiles
  FOR SELECT USING (user_id = auth.uid());

-- Client writes are locked; the API service role performs mutations.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.job_applicant_profiles FROM authenticated, anon;
GRANT SELECT ON TABLE public.job_applicant_profiles TO authenticated;
