-- Company profile polish: about/tagline/location plus a public logo bucket.

ALTER TABLE public.job_companies
  ADD COLUMN IF NOT EXISTS tagline TEXT,
  ADD COLUMN IF NOT EXISTS about TEXT,
  ADD COLUMN IF NOT EXISTS hq_location TEXT;

COMMENT ON COLUMN public.job_companies.tagline IS 'Short public pitch under the company name.';
COMMENT ON COLUMN public.job_companies.about IS 'Longer public about copy for the company page.';
COMMENT ON COLUMN public.job_companies.hq_location IS 'City / HQ line shown on the public company page.';

-- Public logo storage. Writes go through the API service role; anyone may read.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'job-company-logos',
  'job-company-logos',
  true,
  2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS job_company_logos_public_read ON storage.objects;
CREATE POLICY job_company_logos_public_read
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'job-company-logos');
