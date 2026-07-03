-- Allow record_study_activity via service_role (API server uses service role; auth.uid() is NULL).
-- Direct authenticated calls still require p_user_id = auth.uid().

CREATE OR REPLACE FUNCTION public.record_study_activity(
  p_user_id UUID,
  p_type TEXT,
  p_amount INTEGER DEFAULT 1,
  p_activity_date DATE DEFAULT CURRENT_DATE
)
RETURNS study_activity
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount INTEGER := GREATEST(COALESCE(p_amount, 1), 0);
  v_date DATE := COALESCE(p_activity_date, CURRENT_DATE);
  v_row study_activity;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'record_study_activity: caller must match p_user_id'
      USING ERRCODE = '42501';
  END IF;

  IF v_amount = 0 THEN
    SELECT * INTO v_row FROM study_activity
    WHERE user_id = p_user_id AND activity_date = v_date;
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
    v_date,
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

GRANT EXECUTE ON FUNCTION public.record_study_activity(UUID, TEXT, INTEGER, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_study_activity(UUID, TEXT, INTEGER, DATE) TO service_role;
