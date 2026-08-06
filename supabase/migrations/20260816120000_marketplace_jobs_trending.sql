-- Trending sort for marketplace Explore + jobs board (7-day engagement).
-- Marketplace: views/impressions + completed/paid orders.
-- Jobs: decayed views_count + applications / external clicks / favorites.

-- Helpful indexes for 7d rollups (partial where possible).
CREATE INDEX IF NOT EXISTS idx_product_events_listing_engagement_7d
  ON public.product_events (created_at DESC)
  WHERE event IN ('listing_view', 'listing_impression');

CREATE INDEX IF NOT EXISTS idx_marketplace_orders_listing_paid_completed
  ON public.marketplace_orders (listing_id, completed_at DESC, updated_at DESC)
  WHERE status IN ('completed', 'paid');

CREATE INDEX IF NOT EXISTS idx_job_applications_posting_created
  ON public.job_applications (posting_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_favorites_posting_created
  ON public.job_favorites (posting_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- marketplace_search_listings: add trending sort
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION marketplace_search_listings(
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
    WHEN lower(COALESCE(p_sort_by, '')) IN ('price', 'created_at', 'updated_at', 'sale_first', 'trending')
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

-- ---------------------------------------------------------------------------
-- Jobs board: ranked id page for trending sort
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION jobs_board_trending_ids(
  p_page INTEGER DEFAULT 1,
  p_limit INTEGER DEFAULT 20,
  p_search TEXT DEFAULT NULL,
  p_employment_type TEXT DEFAULT NULL,
  p_campus_id UUID DEFAULT NULL,
  p_company_only BOOLEAN DEFAULT FALSE,
  p_remote BOOLEAN DEFAULT NULL,
  p_compensation_kind TEXT DEFAULT NULL,
  p_country_code TEXT DEFAULT 'NG',
  p_sponsored_first BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
  id UUID,
  trending_score BIGINT,
  total_count BIGINT
) AS $$
DECLARE
  v_offset INTEGER;
  v_window_start TIMESTAMPTZ := NOW() - INTERVAL '7 days';
  v_query_text TEXT := trim(COALESCE(p_search, ''));
BEGIN
  v_offset := GREATEST((COALESCE(p_page, 1) - 1) * COALESCE(p_limit, 20), 0);

  RETURN QUERY
  WITH filtered AS (
    SELECT
      jp.id,
      jp.is_sponsored,
      jp.created_at,
      jp.views_count,
      (
        (COALESCE(jp.views_count, 0)
          / GREATEST(1, (EXTRACT(EPOCH FROM (NOW() - jp.created_at)) / 86400)::INTEGER)
        )
        + (10 * COALESCE(apps.cnt, 0))
        + (5 * COALESCE(clicks.cnt, 0))
        + (2 * COALESCE(favs.cnt, 0))
      )::BIGINT AS score
    FROM public.job_postings jp
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::BIGINT AS cnt
      FROM public.job_applications ja
      WHERE ja.posting_id = jp.id
        AND ja.created_at >= v_window_start
    ) apps ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::BIGINT AS cnt
      FROM public.job_external_apply_clicks jc
      WHERE jc.posting_id = jp.id
        AND jc.created_at >= v_window_start
    ) clicks ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::BIGINT AS cnt
      FROM public.job_favorites jf
      WHERE jf.posting_id = jp.id
        AND jf.created_at >= v_window_start
    ) favs ON TRUE
    WHERE jp.status = 'active'
      AND jp.country_code = COALESCE(NULLIF(trim(p_country_code), ''), 'NG')
      AND (p_employment_type IS NULL OR jp.employment_type = p_employment_type)
      AND (p_campus_id IS NULL OR jp.campus_id = p_campus_id)
      AND (NOT COALESCE(p_company_only, FALSE) OR jp.company_id IS NOT NULL)
      AND (p_remote IS NULL OR jp.is_remote = p_remote)
      AND (
        p_compensation_kind IS NULL
        OR jp.compensation->>'kind' = p_compensation_kind
      )
      AND (
        v_query_text = ''
        OR jp.search_vector @@ websearch_to_tsquery('english', v_query_text)
      )
  )
  SELECT
    f.id,
    f.score AS trending_score,
    COUNT(*) OVER()::BIGINT AS total_count
  FROM filtered f
  ORDER BY
    CASE WHEN COALESCE(p_sponsored_first, TRUE) THEN f.is_sponsored END DESC NULLS LAST,
    f.score DESC,
    f.created_at DESC
  OFFSET v_offset
  LIMIT COALESCE(p_limit, 20);
END;
$$ LANGUAGE plpgsql STABLE;

REVOKE ALL ON FUNCTION public.jobs_board_trending_ids(
  INTEGER, INTEGER, TEXT, TEXT, UUID, BOOLEAN, BOOLEAN, TEXT, TEXT, BOOLEAN
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.jobs_board_trending_ids(
  INTEGER, INTEGER, TEXT, TEXT, UUID, BOOLEAN, BOOLEAN, TEXT, TEXT, BOOLEAN
) TO service_role;
