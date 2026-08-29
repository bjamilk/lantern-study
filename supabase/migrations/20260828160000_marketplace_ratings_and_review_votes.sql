-- Marketplace ratings & review reactions.
--
-- 1. Per-listing rating aggregate (rating_avg / rating_count) maintained by a
--    trigger on marketplace_reviews and backfilled here. Browse cards, the
--    "Top rated" sort and the min-rating filter all read these columns; until
--    this migration runs the API degrades gracefully (no stars, rating sort
--    falls back to newest).
--    Note marketplace_listings is NOT in the supabase_realtime publication
--    (checked 2026-08-28), so trigger updates cannot amplify into client
--    re-fetch storms the way the notes view_count counter did.
-- 2. marketplace_review_votes: "helpful" reactions on reviews. Service-role
--    access only (RLS enabled, no policies) — all reads/writes go through the
--    API, mirroring marketplace_question_bank_entitlements.
-- 3. marketplace_search_listings is re-created with rating_avg/rating_count in
--    its output (same 13-parameter signature, so the deployed API keeps
--    working) and learns an optional 'rating' sort.

-- ---------------------------------------------------------------------------
-- 1. Aggregate columns + trigger + backfill
-- ---------------------------------------------------------------------------
ALTER TABLE public.marketplace_listings
  ADD COLUMN IF NOT EXISTS rating_avg NUMERIC(3,2),
  ADD COLUMN IF NOT EXISTS rating_count INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.marketplace_refresh_listing_rating()
RETURNS TRIGGER AS $$
DECLARE
  v_listing UUID;
BEGIN
  v_listing := COALESCE(NEW.listing_id, OLD.listing_id);

  UPDATE public.marketplace_listings ml
  SET rating_avg = sub.avg_rating,
      rating_count = sub.review_count
  FROM (
    SELECT ROUND(AVG(r.rating)::numeric, 2) AS avg_rating,
           COUNT(*)::int AS review_count
    FROM public.marketplace_reviews r
    WHERE r.listing_id = v_listing
  ) sub
  WHERE ml.id = v_listing;

  -- A review moved between listings (not a path the app takes, but keep the
  -- old listing's aggregate honest if it ever happens).
  IF TG_OP = 'UPDATE' AND NEW.listing_id IS DISTINCT FROM OLD.listing_id THEN
    UPDATE public.marketplace_listings ml
    SET rating_avg = sub.avg_rating,
        rating_count = sub.review_count
    FROM (
      SELECT ROUND(AVG(r.rating)::numeric, 2) AS avg_rating,
             COUNT(*)::int AS review_count
      FROM public.marketplace_reviews r
      WHERE r.listing_id = OLD.listing_id
    ) sub
    WHERE ml.id = OLD.listing_id;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_marketplace_reviews_refresh_rating ON public.marketplace_reviews;
CREATE TRIGGER trg_marketplace_reviews_refresh_rating
  AFTER INSERT OR UPDATE OR DELETE ON public.marketplace_reviews
  FOR EACH ROW EXECUTE FUNCTION public.marketplace_refresh_listing_rating();

-- Backfill existing listings in one pass.
UPDATE public.marketplace_listings ml
SET rating_avg = sub.avg_rating,
    rating_count = sub.review_count
FROM (
  SELECT listing_id,
         ROUND(AVG(rating)::numeric, 2) AS avg_rating,
         COUNT(*)::int AS review_count
  FROM public.marketplace_reviews
  GROUP BY listing_id
) sub
WHERE ml.id = sub.listing_id;

-- "Top rated" browse sort touches only live listings.
CREATE INDEX IF NOT EXISTS idx_marketplace_listings_rating
  ON public.marketplace_listings (rating_avg DESC NULLS LAST, rating_count DESC)
  WHERE status IN ('active', 'reserved');

-- ---------------------------------------------------------------------------
-- 2. Review "helpful" votes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketplace_review_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL REFERENCES public.marketplace_reviews(id) ON DELETE CASCADE,
  voter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (review_id, voter_id)
);

CREATE INDEX IF NOT EXISTS idx_marketplace_review_votes_review
  ON public.marketplace_review_votes (review_id);

-- Service-role only: RLS on with no policies. PostgREST callers get nothing;
-- the API (service role) bypasses RLS by design.
ALTER TABLE public.marketplace_review_votes ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3. marketplace_search_listings: expose rating fields (+ optional 'rating'
--    sort). Same parameter signature; return type changes, so drop first.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.marketplace_search_listings(
  TEXT, INTEGER, INTEGER, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, UUID, TEXT, TEXT[], BOOLEAN
);

CREATE FUNCTION public.marketplace_search_listings(
  p_search TEXT,
  p_page INTEGER DEFAULT 1,
  p_limit INTEGER DEFAULT 20,
  p_category TEXT DEFAULT NULL,
  p_min_price NUMERIC DEFAULT NULL,
  p_max_price NUMERIC DEFAULT NULL,
  p_location TEXT DEFAULT NULL,
  p_sort_by TEXT DEFAULT 'trending',
  p_sort_order TEXT DEFAULT 'desc',
  p_campus_id UUID DEFAULT NULL,
  p_country_code TEXT DEFAULT NULL,
  p_categories TEXT[] DEFAULT NULL,
  p_include_custom BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  category TEXT,
  title TEXT,
  description TEXT,
  price NUMERIC,
  sale_price NUMERIC,
  sale_ends_at TIMESTAMPTZ,
  promo_label TEXT,
  effective_price NUMERIC,
  is_on_sale BOOLEAN,
  location TEXT,
  campus_id UUID,
  country_code TEXT,
  images JSONB,
  category_specific_fields JSONB,
  status TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  views_count BIGINT,
  rating_avg NUMERIC,
  rating_count INTEGER,
  profiles JSONB,
  is_boosted BOOLEAN,
  search_score REAL,
  total_count BIGINT
) AS $$
DECLARE
  v_query_text TEXT;
  v_has_search BOOLEAN;
  v_tsquery TSQUERY;
  v_offset INTEGER;
  v_sort_by TEXT;
  v_sort_order TEXT;
  v_window_start TIMESTAMPTZ := NOW() - INTERVAL '7 days';
BEGIN
  v_query_text := trim(COALESCE(p_search, ''));
  v_has_search := v_query_text <> '';
  IF v_has_search THEN
    v_tsquery := websearch_to_tsquery('english', v_query_text);
  END IF;

  v_offset := GREATEST((COALESCE(p_page, 1) - 1) * COALESCE(p_limit, 20), 0);
  v_sort_by := CASE
    WHEN lower(COALESCE(p_sort_by, '')) IN ('price', 'created_at', 'updated_at', 'sale_first', 'trending', 'rating')
      THEN lower(p_sort_by)
    ELSE 'trending'
  END;
  v_sort_order := CASE
    WHEN lower(COALESCE(p_sort_order, '')) = 'asc' THEN 'asc'
    ELSE 'desc'
  END;

  RETURN QUERY
  WITH filtered AS (
    SELECT
      ml.id,
      ml.user_id,
      ml.category,
      ml.title,
      ml.description,
      ml.price,
      ml.sale_price,
      ml.sale_ends_at,
      ml.promo_label,
      CASE
        WHEN ml.sale_price IS NOT NULL AND ml.sale_ends_at IS NOT NULL AND ml.sale_ends_at > NOW()
          THEN ml.sale_price
        ELSE ml.price
      END AS effective_price,
      (
        ml.sale_price IS NOT NULL
        AND ml.sale_ends_at IS NOT NULL
        AND ml.sale_ends_at > NOW()
      ) AS is_on_sale,
      ml.location,
      ml.campus_id,
      ml.country_code,
      ml.images,
      ml.category_specific_fields,
      ml.status,
      ml.created_at,
      ml.updated_at,
      COALESCE(ml.views_count, 0)::BIGINT AS views_count,
      ml.rating_avg,
      COALESCE(ml.rating_count, 0) AS rating_count,
      jsonb_build_object(
        'id', pr.id,
        'name', pr.name,
        'avatar_url', pr.avatar_url
      ) AS profiles,
      (COALESCE((ml.category_specific_fields->>'boosted_until')::timestamptz, 'epoch'::timestamptz) > NOW()) AS is_boosted,
      (
        CASE WHEN v_has_search THEN
          (ts_rank_cd(ml.search_vector, v_tsquery, 32) * 2.0) +
          (GREATEST(similarity(COALESCE(ml.title, ''), v_query_text), 0) * 0.80) +
          (GREATEST(similarity(COALESCE(ml.description, ''), v_query_text), 0) * 0.40) +
          (CASE
            WHEN lower(COALESCE(ml.title, '')) = lower(v_query_text) THEN 1.5
            WHEN lower(COALESCE(ml.title, '')) LIKE lower(v_query_text) || '%' THEN 0.8
            WHEN lower(COALESCE(ml.title, '')) LIKE '%' || lower(v_query_text) || '%' THEN 0.3
            ELSE 0
          END)
        ELSE 0
        END
      )::REAL AS search_score
    FROM marketplace_listings ml
    LEFT JOIN profiles pr ON pr.id = ml.user_id
    WHERE ml.status = 'active'
      AND (p_category IS NULL OR ml.category = p_category)
      AND (
        p_categories IS NULL
        OR ml.category = ANY(p_categories)
        OR (p_include_custom AND ml.category LIKE 'custom:%')
      )
      AND (p_campus_id IS NULL OR ml.campus_id = p_campus_id)
      AND (p_country_code IS NULL OR ml.country_code = p_country_code)
      AND (
        p_min_price IS NULL OR
        CASE
          WHEN ml.sale_price IS NOT NULL AND ml.sale_ends_at IS NOT NULL AND ml.sale_ends_at > NOW()
            THEN ml.sale_price
          ELSE ml.price
        END >= p_min_price
      )
      AND (
        p_max_price IS NULL OR
        CASE
          WHEN ml.sale_price IS NOT NULL AND ml.sale_ends_at IS NOT NULL AND ml.sale_ends_at > NOW()
            THEN ml.sale_price
          ELSE ml.price
        END <= p_max_price
      )
      AND (p_location IS NULL OR ml.location ILIKE '%' || p_location || '%')
      AND (
        NOT v_has_search
        OR ml.search_vector @@ v_tsquery
        OR similarity(COALESCE(ml.title, ''), v_query_text) > 0.25
        OR similarity(COALESCE(ml.description, ''), v_query_text) > 0.12
      )
  ),
  engagement AS (
    SELECT
      f.id AS listing_id,
      (
        COALESCE(ev.views_7d, 0)
        + CASE
            WHEN COALESCE(ev.views_7d, 0) = 0 AND f.created_at >= v_window_start
              THEN COALESCE(f.views_count, 0)
            ELSE 0
          END
      )::BIGINT AS views_7d,
      COALESCE(ord.orders_7d, 0)::BIGINT AS orders_7d
    FROM filtered f
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::BIGINT AS views_7d
      FROM public.product_events pe
      WHERE pe.created_at >= v_window_start
        AND pe.event IN ('listing_view', 'listing_impression')
        AND pe.props->>'listingId' = f.id::text
    ) ev ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::BIGINT AS orders_7d
      FROM public.marketplace_orders mo
      WHERE mo.listing_id = f.id
        AND mo.status IN ('completed', 'paid')
        AND COALESCE(mo.completed_at, mo.updated_at, mo.created_at) >= v_window_start
    ) ord ON TRUE
  )
  SELECT
    f.id,
    f.user_id,
    f.category,
    f.title,
    f.description,
    f.price,
    f.sale_price,
    f.sale_ends_at,
    f.promo_label,
    f.effective_price,
    f.is_on_sale,
    f.location,
    f.campus_id,
    f.country_code,
    f.images,
    f.category_specific_fields,
    f.status,
    f.created_at,
    f.updated_at,
    f.views_count,
    f.rating_avg,
    f.rating_count,
    f.profiles,
    f.is_boosted,
    f.search_score,
    COUNT(*) OVER()::BIGINT AS total_count
  FROM filtered f
  LEFT JOIN engagement e ON e.listing_id = f.id
  ORDER BY
    CASE WHEN v_sort_by = 'sale_first' THEN f.is_on_sale END DESC NULLS LAST,
    f.is_boosted DESC,
    f.search_score DESC,
    CASE WHEN v_sort_by = 'trending' THEN
      (COALESCE(e.views_7d, 0) + (25 * COALESCE(e.orders_7d, 0)))
    END DESC NULLS LAST,
    CASE WHEN v_sort_by = 'rating' THEN f.rating_avg END DESC NULLS LAST,
    CASE WHEN v_sort_by = 'rating' THEN f.rating_count END DESC NULLS LAST,
    CASE WHEN v_sort_by = 'price' AND v_sort_order = 'asc' THEN f.effective_price END ASC NULLS LAST,
    CASE WHEN v_sort_by = 'price' AND v_sort_order = 'desc' THEN f.effective_price END DESC NULLS LAST,
    CASE WHEN v_sort_by = 'created_at' AND v_sort_order = 'asc' THEN f.created_at END ASC NULLS LAST,
    CASE WHEN v_sort_by = 'created_at' AND v_sort_order = 'desc' THEN f.created_at END DESC NULLS LAST,
    CASE WHEN v_sort_by = 'updated_at' AND v_sort_order = 'asc' THEN f.updated_at END ASC NULLS LAST,
    CASE WHEN v_sort_by = 'updated_at' AND v_sort_order = 'desc' THEN f.updated_at END DESC NULLS LAST,
    f.created_at DESC
  OFFSET v_offset
  LIMIT COALESCE(p_limit, 20);
END;
$$ LANGUAGE plpgsql STABLE;

REVOKE ALL ON FUNCTION public.marketplace_search_listings(
  TEXT, INTEGER, INTEGER, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, UUID, TEXT, TEXT[], BOOLEAN
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.marketplace_search_listings(
  TEXT, INTEGER, INTEGER, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, UUID, TEXT, TEXT[], BOOLEAN
) FROM anon;
REVOKE ALL ON FUNCTION public.marketplace_search_listings(
  TEXT, INTEGER, INTEGER, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, UUID, TEXT, TEXT[], BOOLEAN
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.marketplace_search_listings(
  TEXT, INTEGER, INTEGER, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, UUID, TEXT, TEXT[], BOOLEAN
) TO service_role;

-- PostgREST caches function signatures; make the new return shape visible.
NOTIFY pgrst, 'reload schema';
