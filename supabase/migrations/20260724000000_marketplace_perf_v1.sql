-- Marketplace performance pass v1:
-- 1) Composite indexes matching the hot browse query shape (status + filter + created_at sort).
-- 2) marketplace_category_analytics(): SQL GROUP BY replacing a full-table fetch in Node.
-- 3) marketplace_search_listings v3: supports filter-only queries (blank search no longer
--    returns an empty set), campus/country filters, and tab category lists.

-- 1) Composite indexes ------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_marketplace_listings_status_created
  ON marketplace_listings (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketplace_listings_status_campus_created
  ON marketplace_listings (status, campus_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketplace_listings_status_category_created
  ON marketplace_listings (status, category, created_at DESC);

-- 2) Category analytics in SQL ----------------------------------------------

CREATE OR REPLACE FUNCTION marketplace_category_analytics()
RETURNS TABLE (
  category TEXT,
  total BIGINT,
  active BIGINT,
  sold BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COALESCE(ml.category, 'unknown') AS category,
    COUNT(*)::BIGINT AS total,
    COUNT(*) FILTER (WHERE ml.status = 'active')::BIGINT AS active,
    COUNT(*) FILTER (WHERE ml.status = 'sold')::BIGINT AS sold
  FROM marketplace_listings ml
  GROUP BY 1
  ORDER BY 2 DESC;
$$;

REVOKE ALL ON FUNCTION marketplace_category_analytics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION marketplace_category_analytics() TO service_role;

-- 3) marketplace_search_listings v3 -----------------------------------------

DROP FUNCTION IF EXISTS marketplace_search_listings(text, integer, integer, text, numeric, numeric, text, text, text);

CREATE OR REPLACE FUNCTION marketplace_search_listings(
  p_search TEXT,
  p_page INTEGER DEFAULT 1,
  p_limit INTEGER DEFAULT 20,
  p_category TEXT DEFAULT NULL,
  p_min_price NUMERIC DEFAULT NULL,
  p_max_price NUMERIC DEFAULT NULL,
  p_location TEXT DEFAULT NULL,
  p_sort_by TEXT DEFAULT 'created_at',
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
BEGIN
  v_query_text := trim(COALESCE(p_search, ''));
  v_has_search := v_query_text <> '';
  IF v_has_search THEN
    v_tsquery := websearch_to_tsquery('english', v_query_text);
  END IF;

  v_offset := GREATEST((COALESCE(p_page, 1) - 1) * COALESCE(p_limit, 20), 0);
  v_sort_by := CASE
    WHEN lower(COALESCE(p_sort_by, '')) IN ('price', 'created_at', 'updated_at', 'sale_first') THEN lower(p_sort_by)
    ELSE 'created_at'
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
  ORDER BY
    CASE WHEN v_sort_by = 'sale_first' THEN f.is_on_sale END DESC NULLS LAST,
    f.is_boosted DESC,
    f.search_score DESC,
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

GRANT EXECUTE ON FUNCTION marketplace_search_listings(TEXT, INTEGER, INTEGER, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, UUID, TEXT, TEXT[], BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION marketplace_search_listings(TEXT, INTEGER, INTEGER, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, UUID, TEXT, TEXT[], BOOLEAN) TO anon;
GRANT EXECUTE ON FUNCTION marketplace_search_listings(TEXT, INTEGER, INTEGER, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, UUID, TEXT, TEXT[], BOOLEAN) TO service_role;
