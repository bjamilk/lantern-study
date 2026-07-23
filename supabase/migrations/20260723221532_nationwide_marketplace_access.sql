-- Nationwide Nigerian marketplace access with campus/location metadata retained
-- for logistics and zonal economic analytics.

ALTER TABLE public.marketplace_campuses
  ADD COLUMN IF NOT EXISTS geopolitical_zone TEXT;

UPDATE public.marketplace_campuses
SET geopolitical_zone = CASE lower(btrim(state))
  WHEN 'benue' THEN 'North Central'
  WHEN 'fct' THEN 'North Central'
  WHEN 'federal capital territory' THEN 'North Central'
  WHEN 'kogi' THEN 'North Central'
  WHEN 'kwara' THEN 'North Central'
  WHEN 'nasarawa' THEN 'North Central'
  WHEN 'niger' THEN 'North Central'
  WHEN 'plateau' THEN 'North Central'
  WHEN 'adamawa' THEN 'North East'
  WHEN 'bauchi' THEN 'North East'
  WHEN 'borno' THEN 'North East'
  WHEN 'gombe' THEN 'North East'
  WHEN 'taraba' THEN 'North East'
  WHEN 'yobe' THEN 'North East'
  WHEN 'jigawa' THEN 'North West'
  WHEN 'kaduna' THEN 'North West'
  WHEN 'kano' THEN 'North West'
  WHEN 'katsina' THEN 'North West'
  WHEN 'kebbi' THEN 'North West'
  WHEN 'sokoto' THEN 'North West'
  WHEN 'zamfara' THEN 'North West'
  WHEN 'abia' THEN 'South East'
  WHEN 'anambra' THEN 'South East'
  WHEN 'ebonyi' THEN 'South East'
  WHEN 'enugu' THEN 'South East'
  WHEN 'imo' THEN 'South East'
  WHEN 'akwa ibom' THEN 'South South'
  WHEN 'bayelsa' THEN 'South South'
  WHEN 'cross river' THEN 'South South'
  WHEN 'delta' THEN 'South South'
  WHEN 'edo' THEN 'South South'
  WHEN 'rivers' THEN 'South South'
  WHEN 'ekiti' THEN 'South West'
  WHEN 'lagos' THEN 'South West'
  WHEN 'ogun' THEN 'South West'
  WHEN 'ondo' THEN 'South West'
  WHEN 'osun' THEN 'South West'
  WHEN 'oyo' THEN 'South West'
  ELSE NULL
END
WHERE country_code = 'NG';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'marketplace_campuses_geopolitical_zone_check'
      AND conrelid = 'public.marketplace_campuses'::regclass
  ) THEN
    ALTER TABLE public.marketplace_campuses
      ADD CONSTRAINT marketplace_campuses_geopolitical_zone_check
      CHECK (
        geopolitical_zone IS NULL
        OR geopolitical_zone IN (
          'North Central',
          'North East',
          'North West',
          'South East',
          'South South',
          'South West'
        )
      );
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_marketplace_campuses_geopolitical_zone
  ON public.marketplace_campuses (geopolitical_zone)
  WHERE active = TRUE AND geopolitical_zone IS NOT NULL;

-- Older rows and legacy bundle creation could omit campus_id. Attribute these
-- to the explicit free-text Nigerian city option before enforcing metadata.
UPDATE public.marketplace_listings
SET campus_id = (
  SELECT id
  FROM public.marketplace_campuses
  WHERE slug = 'other-city-nigeria'
    AND active = TRUE
  LIMIT 1
)
WHERE campus_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.marketplace_listings WHERE campus_id IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot require listing campus metadata: active other-city-nigeria campus is missing';
  END IF;
END;
$$;

ALTER TABLE public.marketplace_listings
  ALTER COLUMN campus_id SET NOT NULL;

COMMENT ON COLUMN public.marketplace_campuses.geopolitical_zone IS
  'Nigeria geopolitical zone derived from campus/state metadata; NULL only when the generic Other-city option cannot be zonally attributed.';

COMMENT ON COLUMN public.marketplace_listings.campus_id IS
  'Required logistics and economic-analysis metadata. It is not an access-control or visibility boundary.';

CREATE OR REPLACE FUNCTION public.marketplace_zone_analytics(
  p_days INTEGER DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days INTEGER := LEAST(GREATEST(COALESCE(p_days, 30), 7), 90);
  v_start TIMESTAMPTZ := (CURRENT_DATE - (v_days - 1))::timestamptz;
BEGIN
  RETURN jsonb_build_object(
    'periodDays', v_days,
    'gmvByZone', (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'zone', zone,
            'gmv', gmv,
            'orders', orders
          )
          ORDER BY gmv DESC
        ),
        '[]'::jsonb
      )
      FROM (
        SELECT
          COALESCE(mc.geopolitical_zone, 'Unattributed') AS zone,
          ROUND(SUM(o.amount)::numeric, 2) AS gmv,
          COUNT(*)::int AS orders
        FROM public.marketplace_orders o
        LEFT JOIN public.marketplace_listings l ON l.id = o.listing_id
        LEFT JOIN public.marketplace_campuses mc ON mc.id = l.campus_id
        WHERE o.status = 'completed'
          AND COALESCE(o.completed_at, o.created_at) >= v_start
        GROUP BY 1
      ) zone_gmv
    ),
    'listingsByZone', (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'zone', zone,
            'total', total,
            'active', active,
            'sold', sold
          )
          ORDER BY total DESC
        ),
        '[]'::jsonb
      )
      FROM (
        SELECT
          COALESCE(mc.geopolitical_zone, 'Unattributed') AS zone,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE l.status = 'active')::int AS active,
          COUNT(*) FILTER (WHERE l.status = 'sold')::int AS sold
        FROM public.marketplace_listings l
        LEFT JOIN public.marketplace_campuses mc ON mc.id = l.campus_id
        WHERE l.created_at >= v_start
        GROUP BY 1
      ) zone_listings
    ),
    'searchesByZone', (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object('zone', zone, 'count', search_count)
          ORDER BY search_count DESC
        ),
        '[]'::jsonb
      )
      FROM (
        SELECT
          COALESCE(mc.geopolitical_zone, 'Unattributed') AS zone,
          COUNT(*)::int AS search_count
        FROM public.product_events pe
        LEFT JOIN public.marketplace_campuses mc ON mc.id::text = pe.campus
        WHERE pe.event IN ('search_performed', 'search_zero_results')
          AND pe.created_at >= v_start
        GROUP BY 1
      ) zone_searches
    ),
    'searchesByCampus', (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object('campus', campus, 'count', search_count)
          ORDER BY search_count DESC
        ),
        '[]'::jsonb
      )
      FROM (
        SELECT
          COALESCE(mc.name, NULLIF(pe.campus, ''), 'Unattributed') AS campus,
          COUNT(*)::int AS search_count
        FROM public.product_events pe
        LEFT JOIN public.marketplace_campuses mc ON mc.id::text = pe.campus
        WHERE pe.event IN ('search_performed', 'search_zero_results')
          AND pe.created_at >= v_start
        GROUP BY 1
        ORDER BY COUNT(*) DESC
        LIMIT 20
      ) campus_searches
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.marketplace_zone_analytics(INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketplace_zone_analytics(INTEGER)
  TO service_role;

COMMENT ON FUNCTION public.marketplace_zone_analytics(INTEGER) IS
  'Service-only nationwide marketplace economics grouped by Nigerian geopolitical zone and campus context.';
