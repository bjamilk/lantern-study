-- Presence + new-card activity tracking for cross-device settings

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_profiles_last_seen_at
  ON public.profiles(last_seen_at DESC);

ALTER TABLE public.study_activity
  ADD COLUMN IF NOT EXISTS new_flashcard_count INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.record_study_activity(
  p_user_id UUID,
  p_type TEXT,
  p_amount INTEGER DEFAULT 1
)
RETURNS study_activity
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount INTEGER := GREATEST(COALESCE(p_amount, 1), 0);
  v_row study_activity;
BEGIN
  IF v_amount = 0 THEN
    SELECT * INTO v_row FROM study_activity
    WHERE user_id = p_user_id AND activity_date = CURRENT_DATE;
    RETURN v_row;
  END IF;

  INSERT INTO study_activity (
    user_id,
    activity_date,
    count,
    test_count,
    flashcard_count,
    new_flashcard_count,
    question_count,
    game_count,
    daily_quiz_count,
    updated_at
  )
  VALUES (
    p_user_id,
    CURRENT_DATE,
    v_amount,
    CASE WHEN p_type = 'test' THEN v_amount ELSE 0 END,
    CASE WHEN p_type IN ('flashcard', 'flashcard_new') THEN v_amount ELSE 0 END,
    CASE WHEN p_type = 'flashcard_new' THEN v_amount ELSE 0 END,
    CASE WHEN p_type = 'study_question' THEN v_amount ELSE 0 END,
    CASE WHEN p_type = 'game' THEN v_amount ELSE 0 END,
    CASE WHEN p_type = 'daily_quiz' THEN v_amount ELSE 0 END,
    NOW()
  )
  ON CONFLICT (user_id, activity_date) DO UPDATE SET
    count = study_activity.count + v_amount,
    test_count = study_activity.test_count + CASE WHEN p_type = 'test' THEN v_amount ELSE 0 END,
    flashcard_count = study_activity.flashcard_count + CASE WHEN p_type IN ('flashcard', 'flashcard_new') THEN v_amount ELSE 0 END,
    new_flashcard_count = study_activity.new_flashcard_count + CASE WHEN p_type = 'flashcard_new' THEN v_amount ELSE 0 END,
    question_count = study_activity.question_count + CASE WHEN p_type = 'study_question' THEN v_amount ELSE 0 END,
    game_count = study_activity.game_count + CASE WHEN p_type = 'game' THEN v_amount ELSE 0 END,
    daily_quiz_count = study_activity.daily_quiz_count + CASE WHEN p_type = 'daily_quiz' THEN v_amount ELSE 0 END,
    updated_at = NOW()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_study_activity(UUID, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_study_activity(UUID, TEXT, INTEGER) TO service_role;

-- Extend search_users with last_seen_at for online status (filtered in API)
DROP FUNCTION IF EXISTS search_users(text, uuid, uuid, integer);
CREATE OR REPLACE FUNCTION search_users(
    search_query TEXT,
    exclude_user_id UUID DEFAULT NULL,
    viewer_id UUID DEFAULT NULL,
    result_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
    id UUID,
    username VARCHAR(20),
    first_name TEXT,
    last_name TEXT,
    name TEXT,
    avatar_url TEXT,
    last_seen_at TIMESTAMPTZ,
    settings JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.id,
        p.username,
        p.first_name,
        p.last_name,
        p.name,
        p.avatar_url,
        p.last_seen_at,
        p.settings
    FROM profiles p
    WHERE
        (exclude_user_id IS NULL OR p.id != exclude_user_id)
        AND p.username IS NOT NULL
        AND (
            viewer_id IS NULL
            OR public.profile_visible_to_viewer(viewer_id, p.id)
        )
        AND (
            p.username ILIKE '%' || search_query || '%'
            OR p.first_name ILIKE '%' || search_query || '%'
            OR p.last_name ILIKE '%' || search_query || '%'
            OR p.name ILIKE '%' || search_query || '%'
        )
    ORDER BY
        CASE WHEN p.username = LOWER(search_query) THEN 0 ELSE 1 END,
        CASE WHEN p.username ILIKE search_query || '%' THEN 0 ELSE 1 END,
        p.username
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON COLUMN public.profiles.last_seen_at IS 'Updated by client heartbeat; used with privacy.showOnlineStatus';
COMMENT ON COLUMN public.study_activity.new_flashcard_count IS 'New SRS cards introduced today (cross-device srsNewCardsPerDay cap)';
