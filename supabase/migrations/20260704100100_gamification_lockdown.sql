-- Lock down gamification fields: clients may read but not self-award points/streaks/quests/scores.

CREATE OR REPLACE FUNCTION public.preserve_gamification_profile_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  role_name text := COALESCE(auth.role(), current_setting('role', true));
BEGIN
  IF role_name = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.points := OLD.points;
    NEW.badges := OLD.badges;
    NEW.stats := OLD.stats;
  ELSE
    NEW.points := COALESCE(NEW.points, 0);
    NEW.badges := COALESCE(NEW.badges, '[]'::jsonb);
    NEW.stats := COALESCE(NEW.stats, '{}'::jsonb);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_preserve_gamification ON public.profiles;
CREATE TRIGGER profiles_preserve_gamification
  BEFORE INSERT OR UPDATE OF points, badges, stats ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.preserve_gamification_profile_fields();

-- user_streaks: SELECT only for authenticated
DROP POLICY IF EXISTS user_streaks_own ON public.user_streaks;
CREATE POLICY user_streaks_select ON public.user_streaks
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- daily_quests: SELECT only for authenticated
DROP POLICY IF EXISTS daily_quests_own ON public.daily_quests;
CREATE POLICY daily_quests_select ON public.daily_quests
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- study_activity: SELECT only for authenticated (writes via record_study_activity RPC / service role)
DROP POLICY IF EXISTS study_activity_own ON public.study_activity;
CREATE POLICY study_activity_select ON public.study_activity
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- challenge_participants: SELECT only for authenticated (writes via API service role)
DROP POLICY IF EXISTS challenge_participants_own_write ON public.challenge_participants;
-- challenge_participants_select policy already exists from 20260612120000
