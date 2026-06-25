-- RLS privilege hardening: platform admin (JWT app_metadata only), group admin scope,
-- block profiles.settings escalation, fix service-role-only tables.

-- ---------------------------------------------------------------------------
-- 1. Shared authorization helpers (SECURITY INVOKER)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean,
    false
  );
$$;

COMMENT ON FUNCTION public.is_platform_admin() IS
  'True when JWT app_metadata.is_platform_admin is set. Never reads profiles.settings.';

CREATE OR REPLACE FUNCTION public.is_group_admin(p_group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.groups g
    WHERE g.id = p_group_id
      AND g.admin_ids @> jsonb_build_array(auth.uid()::text)
  );
$$;

COMMENT ON FUNCTION public.is_group_admin(uuid) IS
  'True when auth.uid() is in groups.admin_ids for the given group. Group admin does not grant platform powers.';

GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_group_admin(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Block privileged settings escalation on profiles (direct PostgREST bypass)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.strip_privileged_profile_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  privileged_keys text[] := ARRAY[
    'is_platform_admin',
    'is_banned',
    'account_status',
    'ban_reason',
    'banned_at',
    'banned_by',
    'suspended_until',
    'moderation_flags'
  ];
  k text;
BEGIN
  IF NEW.settings IS NULL THEN
    NEW.settings := '{}'::jsonb;
  END IF;

  -- Strip privileged keys from incoming settings; preserve existing values on UPDATE.
  FOREACH k IN ARRAY privileged_keys LOOP
    IF TG_OP = 'UPDATE' AND OLD.settings ? k THEN
      NEW.settings := jsonb_set(NEW.settings, ARRAY[k], OLD.settings -> k, true);
    ELSE
      NEW.settings := NEW.settings - k;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_strip_privileged_settings ON public.profiles;
CREATE TRIGGER profiles_strip_privileged_settings
  BEFORE INSERT OR UPDATE OF settings ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.strip_privileged_profile_settings();

-- ---------------------------------------------------------------------------
-- 3. Tighten group admin boundaries (admin before and after update)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS groups_update ON public.groups;
CREATE POLICY groups_update ON public.groups
  FOR UPDATE TO authenticated
  USING (admin_ids @> jsonb_build_array(auth.uid()::text))
  WITH CHECK (admin_ids @> jsonb_build_array(auth.uid()::text));

-- ---------------------------------------------------------------------------
-- 4. Service-role-only tables: explicit policies + revoke authenticated writes
-- ---------------------------------------------------------------------------

-- admin_audit_log (policy already service_role; revoke table grants from authenticated)
DROP POLICY IF EXISTS "admin_audit_log_service_role_only" ON public.admin_audit_log;
CREATE POLICY "admin_audit_log_service_role_only"
  ON public.admin_audit_log
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.admin_audit_log FROM authenticated, anon;
GRANT SELECT, INSERT ON TABLE public.admin_audit_log TO service_role;

-- platform_admins
DROP POLICY IF EXISTS "platform_admins_service_role_only" ON public.platform_admins;
CREATE POLICY "platform_admins_service_role_only"
  ON public.platform_admins
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.platform_admins FROM authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.platform_admins TO service_role;

-- marketplace_favorite_milestones (internal job table; was FOR ALL USING (true) with no role)
DROP POLICY IF EXISTS "Service role manages favorite milestones" ON public.marketplace_favorite_milestones;
CREATE POLICY "marketplace_favorite_milestones_service_role"
  ON public.marketplace_favorite_milestones
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.marketplace_favorite_milestones FROM authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.marketplace_favorite_milestones TO service_role;

-- user_api_keys: authenticated may SELECT own metadata only; writes via service_role
REVOKE INSERT, UPDATE, DELETE ON TABLE public.user_api_keys FROM authenticated, anon;

-- ---------------------------------------------------------------------------
-- 5. SECURITY DEFINER functions: enforce caller identity where applicable
-- ---------------------------------------------------------------------------

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
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
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
