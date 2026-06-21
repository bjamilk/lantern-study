-- Marketplace indexed search migration
-- Adds maintained full-text search vector + ranking RPC to replace in-memory relevance scoring

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE marketplace_listings
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE OR REPLACE FUNCTION marketplace_listings_search_vector_trigger()
RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.category, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.location, '')), 'C') ||
    setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_marketplace_listings_search_vector ON marketplace_listings;
CREATE TRIGGER trg_marketplace_listings_search_vector
BEFORE INSERT OR UPDATE OF title, category, location, description
ON marketplace_listings
FOR EACH ROW
EXECUTE FUNCTION marketplace_listings_search_vector_trigger();

UPDATE marketplace_listings
SET search_vector =
  setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
  setweight(to_tsvector('english', COALESCE(category, '')), 'B') ||
  setweight(to_tsvector('english', COALESCE(location, '')), 'C') ||
  setweight(to_tsvector('english', COALESCE(description, '')), 'D')
WHERE search_vector IS NULL;

CREATE INDEX IF NOT EXISTS idx_marketplace_listings_search_vector
  ON marketplace_listings USING GIN(search_vector);

CREATE INDEX IF NOT EXISTS idx_marketplace_listings_title_trgm
  ON marketplace_listings USING GIN(title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_marketplace_listings_description_trgm
  ON marketplace_listings USING GIN(description gin_trgm_ops);

CREATE OR REPLACE FUNCTION marketplace_search_listings(
  p_search TEXT,
  p_page INTEGER DEFAULT 1,
  p_limit INTEGER DEFAULT 20,
  p_category TEXT DEFAULT NULL,
  p_min_price NUMERIC DEFAULT NULL,
  p_max_price NUMERIC DEFAULT NULL,
  p_location TEXT DEFAULT NULL,
  p_sort_by TEXT DEFAULT 'created_at',
  p_sort_order TEXT DEFAULT 'desc'
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  category TEXT,
  title TEXT,
  description TEXT,
  price NUMERIC,
  location TEXT,
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
  v_tsquery TSQUERY;
  v_offset INTEGER;
  v_sort_by TEXT;
  v_sort_order TEXT;
BEGIN
  v_query_text := trim(COALESCE(p_search, ''));
  IF v_query_text = '' THEN
    RETURN;
  END IF;

  v_tsquery := websearch_to_tsquery('english', v_query_text);
  v_offset := GREATEST((COALESCE(p_page, 1) - 1) * COALESCE(p_limit, 20), 0);
  v_sort_by := CASE
    WHEN lower(COALESCE(p_sort_by, '')) IN ('price', 'created_at', 'updated_at') THEN lower(p_sort_by)
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
      ml.location,
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
        (ts_rank_cd(ml.search_vector, v_tsquery, 32) * 2.0) +
        (GREATEST(similarity(COALESCE(ml.title, ''), v_query_text), 0) * 0.80) +
        (GREATEST(similarity(COALESCE(ml.description, ''), v_query_text), 0) * 0.40) +
        (CASE
          WHEN lower(COALESCE(ml.title, '')) = lower(v_query_text) THEN 1.5
          WHEN lower(COALESCE(ml.title, '')) LIKE lower(v_query_text) || '%' THEN 0.8
          WHEN lower(COALESCE(ml.title, '')) LIKE '%' || lower(v_query_text) || '%' THEN 0.3
          ELSE 0
        END)
      )::REAL AS search_score
    FROM marketplace_listings ml
    LEFT JOIN profiles pr ON pr.id = ml.user_id
    WHERE ml.status = 'active'
      AND (p_category IS NULL OR ml.category = p_category)
      AND (p_min_price IS NULL OR ml.price >= p_min_price)
      AND (p_max_price IS NULL OR ml.price <= p_max_price)
      AND (p_location IS NULL OR ml.location ILIKE '%' || p_location || '%')
      AND (
        ml.search_vector @@ v_tsquery
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
    f.location,
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
    f.is_boosted DESC,
    f.search_score DESC,
    CASE WHEN v_sort_by = 'price' AND v_sort_order = 'asc' THEN f.price END ASC NULLS LAST,
    CASE WHEN v_sort_by = 'price' AND v_sort_order = 'desc' THEN f.price END DESC NULLS LAST,
    CASE WHEN v_sort_by = 'created_at' AND v_sort_order = 'asc' THEN f.created_at END ASC NULLS LAST,
    CASE WHEN v_sort_by = 'created_at' AND v_sort_order = 'desc' THEN f.created_at END DESC NULLS LAST,
    CASE WHEN v_sort_by = 'updated_at' AND v_sort_order = 'asc' THEN f.updated_at END ASC NULLS LAST,
    CASE WHEN v_sort_by = 'updated_at' AND v_sort_order = 'desc' THEN f.updated_at END DESC NULLS LAST,
    f.created_at DESC
  OFFSET v_offset
  LIMIT COALESCE(p_limit, 20);
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION marketplace_search_listings(TEXT, INTEGER, INTEGER, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION marketplace_search_listings(TEXT, INTEGER, INTEGER, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT) TO anon;
