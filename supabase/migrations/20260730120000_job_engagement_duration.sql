-- Engagement duration for non–full-time job postings (ongoing or fixed length).
ALTER TABLE public.job_postings
  ADD COLUMN IF NOT EXISTS engagement_duration JSONB NULL;

COMMENT ON COLUMN public.job_postings.engagement_duration IS
  'Optional role length: {"kind":"ongoing"} or {"kind":"fixed","value":n,"unit":"day|week|month"}';
