-- Unique registered-user views for marketplace listings and job postings.
-- Anonymous / owner / repeat opens no longer inflate views_count.

CREATE TABLE IF NOT EXISTS public.marketplace_listing_unique_views (
  listing_id UUID NOT NULL REFERENCES public.marketplace_listings(id) ON DELETE CASCADE,
  viewer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (listing_id, viewer_id)
);

CREATE INDEX IF NOT EXISTS idx_marketplace_listing_unique_views_viewer
  ON public.marketplace_listing_unique_views (viewer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.job_posting_unique_views (
  posting_id UUID NOT NULL REFERENCES public.job_postings(id) ON DELETE CASCADE,
  viewer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (posting_id, viewer_id)
);

CREATE INDEX IF NOT EXISTS idx_job_posting_unique_views_viewer
  ON public.job_posting_unique_views (viewer_id, created_at DESC);

ALTER TABLE public.marketplace_listing_unique_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_posting_unique_views ENABLE ROW LEVEL SECURITY;

-- Drop legacy single-arg counter (always +1).
DROP FUNCTION IF EXISTS public.increment_listing_views(UUID);

CREATE OR REPLACE FUNCTION public.increment_listing_views(
  listing_id UUID,
  viewer_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_id UUID;
  did_insert BOOLEAN := FALSE;
BEGIN
  IF listing_id IS NULL OR viewer_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT ml.user_id INTO owner_id
  FROM public.marketplace_listings ml
  WHERE ml.id = listing_id;

  IF owner_id IS NULL OR owner_id = viewer_id THEN
    RETURN FALSE;
  END IF;

  WITH inserted AS (
    INSERT INTO public.marketplace_listing_unique_views (listing_id, viewer_id)
    VALUES (listing_id, viewer_id)
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM inserted) INTO did_insert;

  IF did_insert THEN
    UPDATE public.marketplace_listings
    SET views_count = COALESCE(views_count, 0) + 1
    WHERE id = listing_id;
  END IF;

  RETURN did_insert;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_job_posting_views(
  posting_id UUID,
  viewer_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_id UUID;
  did_insert BOOLEAN := FALSE;
BEGIN
  IF posting_id IS NULL OR viewer_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT jp.poster_user_id INTO owner_id
  FROM public.job_postings jp
  WHERE jp.id = posting_id
    AND jp.status = 'active';

  IF owner_id IS NULL OR owner_id = viewer_id THEN
    RETURN FALSE;
  END IF;

  WITH inserted AS (
    INSERT INTO public.job_posting_unique_views (posting_id, viewer_id)
    VALUES (posting_id, viewer_id)
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM inserted) INTO did_insert;

  IF did_insert THEN
    UPDATE public.job_postings
    SET views_count = COALESCE(views_count, 0) + 1
    WHERE id = posting_id;
  END IF;

  RETURN did_insert;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_listing_views(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_listing_views(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.increment_listing_views(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.increment_listing_views(UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.increment_job_posting_views(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_job_posting_views(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.increment_job_posting_views(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.increment_job_posting_views(UUID, UUID) TO service_role;
