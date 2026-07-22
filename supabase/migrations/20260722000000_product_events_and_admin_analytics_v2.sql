-- First-party product analytics events + extended admin_analytics marketplace KPIs.
-- Client access denied; API inserts/selects via service_role only.

CREATE TABLE IF NOT EXISTS public.product_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  anon_id TEXT,
  session_id TEXT,
  event TEXT NOT NULL,
  surface TEXT NOT NULL CHECK (surface IN ('web', 'mobile')),
  props JSONB NOT NULL DEFAULT '{}'::jsonb,
  campus TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_events_event_created
  ON public.product_events (event, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_events_user_created
  ON public.product_events (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_product_events_anon_created
  ON public.product_events (anon_id, created_at DESC)
  WHERE anon_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_product_events_listing
  ON public.product_events ((props->>'listingId'), created_at DESC)
  WHERE props ? 'listingId';

ALTER TABLE public.product_events ENABLE ROW LEVEL SECURITY;

-- Deny all client roles; service_role bypasses RLS.
REVOKE ALL ON public.product_events FROM PUBLIC;
REVOKE ALL ON public.product_events FROM anon;
REVOKE ALL ON public.product_events FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.product_events TO service_role;

COMMENT ON TABLE public.product_events IS
  'Consent-gated first-party product analytics. Insert/select via API service_role only. Retention ~90 days.';

-- Extended admin analytics: marketplace GMV + retention cohorts + event-based sections.
CREATE OR REPLACE FUNCTION public.admin_analytics(p_days INTEGER DEFAULT 30)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days INTEGER := LEAST(GREATEST(COALESCE(p_days, 30), 7), 90);
  v_start DATE := (CURRENT_DATE - (v_days - 1));
  v_today_start TIMESTAMPTZ := date_trunc('day', NOW());
  v_7d_start DATE := CURRENT_DATE - 6;
  v_30d_start DATE := CURRENT_DATE - 29;
  v_result JSONB;
  v_gmv NUMERIC := 0;
  v_orders INTEGER := 0;
  v_disputed INTEGER := 0;
  v_all_orders INTEGER := 0;
BEGIN
  SELECT
    COALESCE(SUM(amount) FILTER (WHERE status = 'completed'), 0),
    COUNT(*) FILTER (WHERE status = 'completed')::int,
    COUNT(*) FILTER (WHERE status = 'disputed')::int,
    COUNT(*)::int
  INTO v_gmv, v_orders, v_disputed, v_all_orders
  FROM marketplace_orders
  WHERE created_at >= v_start::timestamptz
     OR (status = 'completed' AND completed_at >= v_start::timestamptz);

  -- Prefer completed_at window for GMV when available
  SELECT
    COALESCE(SUM(amount), 0),
    COUNT(*)::int
  INTO v_gmv, v_orders
  FROM marketplace_orders
  WHERE status = 'completed'
    AND COALESCE(completed_at, created_at) >= v_start::timestamptz;

  SELECT COUNT(*)::int INTO v_disputed
  FROM marketplace_orders
  WHERE status = 'disputed'
    AND created_at >= v_start::timestamptz;

  SELECT COUNT(*)::int INTO v_all_orders
  FROM marketplace_orders
  WHERE created_at >= v_start::timestamptz;

  SELECT jsonb_build_object(
    'periodDays', v_days,
    'kpis', jsonb_build_object(
      'totalUsers', (SELECT COUNT(*)::int FROM profiles),
      'dau', (
        SELECT COUNT(DISTINCT id)::int
        FROM profiles p
        WHERE p.last_seen_at >= v_today_start
           OR EXISTS (
             SELECT 1 FROM study_activity sa
             WHERE sa.user_id = p.id AND sa.activity_date = CURRENT_DATE AND sa.count > 0
           )
      ),
      'wau', (
        SELECT COUNT(DISTINCT id)::int
        FROM profiles p
        WHERE p.last_seen_at >= (v_today_start - INTERVAL '6 days')
           OR EXISTS (
             SELECT 1 FROM study_activity sa
             WHERE sa.user_id = p.id AND sa.activity_date >= v_7d_start AND sa.count > 0
           )
      ),
      'mau', (
        SELECT COUNT(DISTINCT id)::int
        FROM profiles p
        WHERE p.last_seen_at >= (v_today_start - INTERVAL '29 days')
           OR EXISTS (
             SELECT 1 FROM study_activity sa
             WHERE sa.user_id = p.id AND sa.activity_date >= v_30d_start AND sa.count > 0
           )
      ),
      'mobileAppUsers', (
        SELECT COUNT(*)::int FROM profiles
        WHERE expo_push_token IS NOT NULL AND btrim(expo_push_token) <> ''
      ),
      'webOnlyUsers', (
        SELECT COUNT(*)::int FROM profiles
        WHERE expo_push_token IS NULL OR btrim(expo_push_token) = ''
      ),
      'activeGroups', (
        SELECT COUNT(*)::int FROM groups WHERE COALESCE(is_archived, false) = false
      )
    ),
    'marketplaceKpis', jsonb_build_object(
      'gmv', ROUND(v_gmv::numeric, 2),
      'ordersCount', v_orders,
      'aov', CASE WHEN v_orders > 0 THEN ROUND((v_gmv / v_orders)::numeric, 2) ELSE 0 END,
      'disputedRate', CASE WHEN v_all_orders > 0
        THEN ROUND((v_disputed::numeric / v_all_orders) * 100, 2)
        ELSE 0 END,
      'disputedCount', v_disputed,
      'gmvByCategory', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'category', category,
          'gmv', gmv,
          'orders', orders
        ) ORDER BY gmv DESC), '[]'::jsonb)
        FROM (
          SELECT
            COALESCE(l.category, 'unknown') AS category,
            ROUND(SUM(o.amount)::numeric, 2) AS gmv,
            COUNT(*)::int AS orders
          FROM marketplace_orders o
          LEFT JOIN marketplace_listings l ON l.id = o.listing_id
          WHERE o.status = 'completed'
            AND COALESCE(o.completed_at, o.created_at) >= v_start::timestamptz
          GROUP BY 1
          ORDER BY 2 DESC
          LIMIT 12
        ) c
      ),
      'gmvByCampus', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'campus', campus,
          'gmv', gmv,
          'orders', orders
        ) ORDER BY gmv DESC), '[]'::jsonb)
        FROM (
          SELECT
            COALESCE(mc.name, l.location, 'Unknown') AS campus,
            ROUND(SUM(o.amount)::numeric, 2) AS gmv,
            COUNT(*)::int AS orders
          FROM marketplace_orders o
          LEFT JOIN marketplace_listings l ON l.id = o.listing_id
          LEFT JOIN marketplace_campuses mc ON mc.id = l.campus_id
          WHERE o.status = 'completed'
            AND COALESCE(o.completed_at, o.created_at) >= v_start::timestamptz
          GROUP BY 1
          ORDER BY 2 DESC
          LIMIT 12
        ) c
      )
    ),
    'retentionCohorts', (
      SELECT jsonb_build_object(
        'signups', signup_count,
        'd1', CASE WHEN signup_count > 0 THEN ROUND((d1_count::numeric / signup_count) * 100, 1) ELSE 0 END,
        'd7', CASE WHEN signup_count > 0 THEN ROUND((d7_count::numeric / signup_count) * 100, 1) ELSE 0 END,
        'd30', CASE WHEN signup_count > 0 THEN ROUND((d30_count::numeric / signup_count) * 100, 1) ELSE 0 END,
        'd1Count', d1_count,
        'd7Count', d7_count,
        'd30Count', d30_count
      )
      FROM (
        SELECT
          COUNT(*)::int AS signup_count,
          COUNT(*) FILTER (
            WHERE EXISTS (
              SELECT 1 FROM study_activity sa
              WHERE sa.user_id = p.id
                AND sa.activity_date = (p.created_at AT TIME ZONE 'UTC')::date + 1
                AND sa.count > 0
            )
          )::int AS d1_count,
          COUNT(*) FILTER (
            WHERE EXISTS (
              SELECT 1 FROM study_activity sa
              WHERE sa.user_id = p.id
                AND sa.activity_date BETWEEN (p.created_at AT TIME ZONE 'UTC')::date + 1
                    AND (p.created_at AT TIME ZONE 'UTC')::date + 7
                AND sa.count > 0
            )
          )::int AS d7_count,
          COUNT(*) FILTER (
            WHERE EXISTS (
              SELECT 1 FROM study_activity sa
              WHERE sa.user_id = p.id
                AND sa.activity_date BETWEEN (p.created_at AT TIME ZONE 'UTC')::date + 1
                    AND (p.created_at AT TIME ZONE 'UTC')::date + 30
                AND sa.count > 0
            )
          )::int AS d30_count
        FROM profiles p
        WHERE p.created_at >= (CURRENT_DATE - 60)::timestamptz
          AND p.created_at < (CURRENT_DATE - 30)::timestamptz
      ) r
    ),
    'searchAnalytics', (
      SELECT jsonb_build_object(
        'topQueries', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('query', q, 'count', cnt) ORDER BY cnt DESC)
          FROM (
            SELECT LEFT(COALESCE(props->>'query', ''), 80) AS q, COUNT(*)::int AS cnt
            FROM product_events
            WHERE event = 'search_performed'
              AND created_at >= v_start::timestamptz
              AND COALESCE(props->>'query', '') <> ''
            GROUP BY 1
            ORDER BY 2 DESC
            LIMIT 15
          ) t
        ), '[]'::jsonb),
        'zeroResultQueries', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('query', q, 'count', cnt) ORDER BY cnt DESC)
          FROM (
            SELECT LEFT(COALESCE(props->>'query', ''), 80) AS q, COUNT(*)::int AS cnt
            FROM product_events
            WHERE event = 'search_zero_results'
              AND created_at >= v_start::timestamptz
              AND COALESCE(props->>'query', '') <> ''
            GROUP BY 1
            ORDER BY 2 DESC
            LIMIT 15
          ) t
        ), '[]'::jsonb),
        'searchesByCampus', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('campus', campus, 'count', cnt) ORDER BY cnt DESC)
          FROM (
            SELECT COALESCE(campus, 'Unknown') AS campus, COUNT(*)::int AS cnt
            FROM product_events
            WHERE event IN ('search_performed', 'search_zero_results')
              AND created_at >= v_start::timestamptz
            GROUP BY 1
            ORDER BY 2 DESC
            LIMIT 12
          ) t
        ), '[]'::jsonb),
        'totalSearches', (
          SELECT COUNT(*)::int FROM product_events
          WHERE event = 'search_performed' AND created_at >= v_start::timestamptz
        )
      )
    ),
    'acquisitionFunnel', (
      SELECT jsonb_build_object(
        'guestListingViews', (
          SELECT COUNT(*)::int FROM product_events
          WHERE event = 'listing_view'
            AND user_id IS NULL
            AND created_at >= v_start::timestamptz
        ),
        'signupStarted', (
          SELECT COUNT(*)::int FROM product_events
          WHERE event = 'signup_started' AND created_at >= v_start::timestamptz
        ),
        'signupsCompleted', (
          SELECT COUNT(*)::int FROM profiles
          WHERE created_at >= v_start::timestamptz
        ),
        'onboardingCompleted', (
          SELECT COUNT(*)::int FROM product_events
          WHERE event = 'onboarding_completed' AND created_at >= v_start::timestamptz
        )
      )
    ),
    'platformFromEvents', (
      SELECT jsonb_build_object(
        'webDau', (
          SELECT COUNT(DISTINCT COALESCE(user_id::text, anon_id))::int
          FROM product_events
          WHERE surface = 'web'
            AND created_at >= v_today_start
            AND (user_id IS NOT NULL OR anon_id IS NOT NULL)
        ),
        'mobileDau', (
          SELECT COUNT(DISTINCT COALESCE(user_id::text, anon_id))::int
          FROM product_events
          WHERE surface = 'mobile'
            AND created_at >= v_today_start
            AND (user_id IS NOT NULL OR anon_id IS NOT NULL)
        ),
        'webActivePeriod', (
          SELECT COUNT(DISTINCT COALESCE(user_id::text, anon_id))::int
          FROM product_events
          WHERE surface = 'web'
            AND created_at >= v_start::timestamptz
            AND (user_id IS NOT NULL OR anon_id IS NOT NULL)
        ),
        'mobileActivePeriod', (
          SELECT COUNT(DISTINCT COALESCE(user_id::text, anon_id))::int
          FROM product_events
          WHERE surface = 'mobile'
            AND created_at >= v_start::timestamptz
            AND (user_id IS NOT NULL OR anon_id IS NOT NULL)
        )
      )
    ),
    'streakDistribution', (
      SELECT COALESCE(jsonb_object_agg(bucket, cnt), '{}'::jsonb)
      FROM (
        SELECT
          CASE
            WHEN COALESCE(current_streak, 0) = 0 THEN '0'
            WHEN current_streak BETWEEN 1 AND 3 THEN '1-3'
            WHEN current_streak BETWEEN 4 AND 7 THEN '4-7'
            WHEN current_streak BETWEEN 8 AND 14 THEN '8-14'
            ELSE '15+'
          END AS bucket,
          COUNT(*)::int AS cnt
        FROM user_streaks
        GROUP BY 1
      ) s
    ),
    'featureTotals', (
      SELECT jsonb_build_object(
        'tests', COALESCE(SUM(test_count), 0)::int,
        'flashcards', COALESCE(SUM(flashcard_count), 0)::int,
        'newFlashcards', COALESCE(SUM(new_flashcard_count), 0)::int,
        'questions', COALESCE(SUM(question_count), 0)::int,
        'games', COALESCE(SUM(game_count), 0)::int,
        'dailyQuizzes', COALESCE(SUM(daily_quiz_count), 0)::int,
        'studyActions', COALESCE(SUM(count), 0)::int
      )
      FROM study_activity
      WHERE activity_date >= v_start
    ),
    'aiByFeature', (
      SELECT COALESCE(jsonb_object_agg(event, cnt), '{}'::jsonb)
      FROM (
        SELECT event, COUNT(*)::int AS cnt
        FROM ai_analytics
        WHERE created_at >= v_start::timestamptz
        GROUP BY event
      ) a
    ),
    'platformSplit', jsonb_build_object(
      'mobileAppUsers', (
        SELECT COUNT(*)::int FROM profiles
        WHERE expo_push_token IS NOT NULL AND btrim(expo_push_token) <> ''
      ),
      'webOnlyUsers', (
        SELECT COUNT(*)::int FROM profiles
        WHERE expo_push_token IS NULL OR btrim(expo_push_token) = ''
      )
    ),
    'series', (
      SELECT COALESCE(jsonb_agg(row_data ORDER BY day), '[]'::jsonb)
      FROM (
        SELECT
          ds.day,
          jsonb_build_object(
            'date', ds.day::text,
            'signups', COALESCE(signups.cnt, 0),
            'activeUsers', COALESCE(study.active_users, 0),
            'tests', COALESCE(study.tests, 0),
            'flashcards', COALESCE(study.flashcards, 0),
            'newFlashcards', COALESCE(study.new_flashcards, 0),
            'questions', COALESCE(study.questions, 0),
            'games', COALESCE(study.games, 0),
            'dailyQuizzes', COALESCE(study.daily_quizzes, 0),
            'groupMessages', COALESCE(grp_msgs.cnt, 0),
            'dmMessages', COALESCE(dm_msgs.cnt, 0),
            'aiEvents', COALESCE(ai_ev.cnt, 0),
            'newListings', COALESCE(listings.cnt, 0),
            'orders', COALESCE(orders.cnt, 0),
            'gmv', COALESCE(gmv_day.gmv, 0)
          ) AS row_data
        FROM (
          SELECT d::date AS day
          FROM generate_series(v_start::timestamp, CURRENT_DATE::timestamp, '1 day') AS d
        ) ds
        LEFT JOIN (
          SELECT (created_at AT TIME ZONE 'UTC')::date AS day, COUNT(*)::int AS cnt
          FROM profiles
          WHERE created_at >= v_start::timestamptz
          GROUP BY 1
        ) signups ON signups.day = ds.day
        LEFT JOIN (
          SELECT
            activity_date AS day,
            COUNT(DISTINCT user_id)::int AS active_users,
            SUM(test_count)::int AS tests,
            SUM(flashcard_count)::int AS flashcards,
            SUM(new_flashcard_count)::int AS new_flashcards,
            SUM(question_count)::int AS questions,
            SUM(game_count)::int AS games,
            SUM(daily_quiz_count)::int AS daily_quizzes
          FROM study_activity
          WHERE activity_date >= v_start
          GROUP BY activity_date
        ) study ON study.day = ds.day
        LEFT JOIN (
          SELECT (timestamp AT TIME ZONE 'UTC')::date AS day, COUNT(*)::int AS cnt
          FROM messages
          WHERE timestamp >= v_start::timestamptz
          GROUP BY 1
        ) grp_msgs ON grp_msgs.day = ds.day
        LEFT JOIN (
          SELECT (timestamp AT TIME ZONE 'UTC')::date AS day, COUNT(*)::int AS cnt
          FROM dm_messages
          WHERE timestamp >= v_start::timestamptz
          GROUP BY 1
        ) dm_msgs ON dm_msgs.day = ds.day
        LEFT JOIN (
          SELECT (created_at AT TIME ZONE 'UTC')::date AS day, COUNT(*)::int AS cnt
          FROM ai_analytics
          WHERE created_at >= v_start::timestamptz
          GROUP BY 1
        ) ai_ev ON ai_ev.day = ds.day
        LEFT JOIN (
          SELECT (created_at AT TIME ZONE 'UTC')::date AS day, COUNT(*)::int AS cnt
          FROM marketplace_listings
          WHERE created_at >= v_start::timestamptz
          GROUP BY 1
        ) listings ON listings.day = ds.day
        LEFT JOIN (
          SELECT (created_at AT TIME ZONE 'UTC')::date AS day, COUNT(*)::int AS cnt
          FROM marketplace_orders
          WHERE created_at >= v_start::timestamptz
          GROUP BY 1
        ) orders ON orders.day = ds.day
        LEFT JOIN (
          SELECT
            (COALESCE(completed_at, created_at) AT TIME ZONE 'UTC')::date AS day,
            ROUND(SUM(amount)::numeric, 2) AS gmv
          FROM marketplace_orders
          WHERE status = 'completed'
            AND COALESCE(completed_at, created_at) >= v_start::timestamptz
          GROUP BY 1
        ) gmv_day ON gmv_day.day = ds.day
        ORDER BY ds.day
      ) daily
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_analytics(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_analytics(INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_analytics(INTEGER) TO service_role;

COMMENT ON FUNCTION public.admin_analytics(INTEGER) IS
  'Platform admin dashboard aggregates including marketplace GMV, retention, and product_events (service_role only).';
