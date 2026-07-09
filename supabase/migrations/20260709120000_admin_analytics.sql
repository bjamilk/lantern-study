-- Platform admin analytics: aggregate existing tables into a single JSON payload.
-- Callable only via service_role (API server); not exposed to authenticated clients.

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
BEGIN
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
            'orders', COALESCE(orders.cnt, 0)
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
  'Platform admin dashboard aggregates (service_role only).';
