-- Daily study activity log (shared across web + mobile heatmaps)

CREATE TABLE IF NOT EXISTS study_activity (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  activity_date DATE NOT NULL DEFAULT CURRENT_DATE,
  count INTEGER NOT NULL DEFAULT 0,
  test_count INTEGER NOT NULL DEFAULT 0,
  flashcard_count INTEGER NOT NULL DEFAULT 0,
  question_count INTEGER NOT NULL DEFAULT 0,
  game_count INTEGER NOT NULL DEFAULT 0,
  daily_quiz_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, activity_date)
);

CREATE INDEX IF NOT EXISTS idx_study_activity_user_date
  ON study_activity(user_id, activity_date DESC);

ALTER TABLE study_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY study_activity_own ON study_activity FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Atomic increment for concurrent writes from multiple devices
CREATE OR REPLACE FUNCTION record_study_activity(
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
    CASE WHEN p_type = 'flashcard' THEN v_amount ELSE 0 END,
    CASE WHEN p_type = 'study_question' THEN v_amount ELSE 0 END,
    CASE WHEN p_type = 'game' THEN v_amount ELSE 0 END,
    CASE WHEN p_type = 'daily_quiz' THEN v_amount ELSE 0 END,
    NOW()
  )
  ON CONFLICT (user_id, activity_date) DO UPDATE SET
    count = study_activity.count + v_amount,
    test_count = study_activity.test_count + CASE WHEN p_type = 'test' THEN v_amount ELSE 0 END,
    flashcard_count = study_activity.flashcard_count + CASE WHEN p_type = 'flashcard' THEN v_amount ELSE 0 END,
    question_count = study_activity.question_count + CASE WHEN p_type = 'study_question' THEN v_amount ELSE 0 END,
    game_count = study_activity.game_count + CASE WHEN p_type = 'game' THEN v_amount ELSE 0 END,
    daily_quiz_count = study_activity.daily_quiz_count + CASE WHEN p_type = 'daily_quiz' THEN v_amount ELSE 0 END,
    updated_at = NOW()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION record_study_activity(UUID, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION record_study_activity(UUID, TEXT, INTEGER) TO service_role;

-- Backfill completed test sessions into activity history
INSERT INTO study_activity (
  user_id,
  activity_date,
  count,
  test_count,
  updated_at
)
SELECT
  user_id,
  (start_time AT TIME ZONE 'UTC')::date AS activity_date,
  COUNT(*)::integer,
  COUNT(*)::integer,
  NOW()
FROM test_sessions
WHERE end_time IS NOT NULL
GROUP BY user_id, (start_time AT TIME ZONE 'UTC')::date
ON CONFLICT (user_id, activity_date) DO UPDATE SET
  count = GREATEST(study_activity.count, EXCLUDED.count),
  test_count = GREATEST(study_activity.test_count, EXCLUDED.test_count),
  updated_at = NOW();
