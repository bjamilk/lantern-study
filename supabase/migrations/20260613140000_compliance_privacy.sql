-- Enforce profile visibility settings (privacy.profileVisibility in settings JSONB)

CREATE OR REPLACE FUNCTION public.profile_visible_to(target_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  visibility TEXT;
BEGIN
  IF target_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF target_id = auth.uid() THEN
    RETURN TRUE;
  END IF;

  SELECT COALESCE(settings->'privacy'->>'profileVisibility', 'groups')
  INTO visibility
  FROM public.profiles
  WHERE id = target_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF visibility = 'public' THEN
    RETURN TRUE;
  END IF;

  IF visibility = 'private' THEN
    RETURN FALSE;
  END IF;

  -- Default 'groups': visible to confirmed group co-members
  RETURN EXISTS (
    SELECT 1
    FROM public.group_members gm_self
    JOIN public.group_members gm_other ON gm_self.group_id = gm_other.group_id
    WHERE gm_self.user_id = auth.uid()
      AND gm_other.user_id = target_id
      AND gm_self.pending = false
      AND gm_other.pending = false
  );
END;
$$;

DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (public.profile_visible_to(id));

COMMENT ON FUNCTION public.profile_visible_to IS 'RLS helper: respects settings.privacy.profileVisibility';
