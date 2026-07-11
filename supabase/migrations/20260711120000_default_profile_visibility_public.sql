-- Default profile visibility to public (user can switch to groups or private in Settings).

-- Backfill profiles missing an explicit profileVisibility value.
-- jsonb_set on a nested path does not create missing parent keys; set privacy object instead.
UPDATE public.profiles
SET settings = jsonb_set(
  COALESCE(settings, '{}'::jsonb),
  '{privacy}',
  COALESCE(settings->'privacy', '{}'::jsonb)
    || jsonb_build_object('profileVisibility', 'public'),
  true
)
WHERE settings IS NULL
   OR settings->'privacy' IS NULL
   OR settings->'privacy'->>'profileVisibility' IS NULL;

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

  SELECT COALESCE(settings->'privacy'->>'profileVisibility', 'public')
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

COMMENT ON FUNCTION public.profile_visible_to IS
  'RLS helper: respects settings.privacy.profileVisibility (default public).';

CREATE OR REPLACE FUNCTION public.profile_visible_to_viewer(viewer_id UUID, target_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  visibility TEXT;
BEGIN
  IF viewer_id IS NULL OR target_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF viewer_id = target_id THEN
    RETURN TRUE;
  END IF;

  SELECT COALESCE(settings->'privacy'->>'profileVisibility', 'public')
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

  RETURN EXISTS (
    SELECT 1
    FROM public.group_members gm_self
    JOIN public.group_members gm_other ON gm_self.group_id = gm_other.group_id
    WHERE gm_self.user_id = viewer_id
      AND gm_other.user_id = target_id
      AND gm_self.pending = false
      AND gm_other.pending = false
  );
END;
$$;

COMMENT ON FUNCTION public.profile_visible_to_viewer IS
  'Visibility check for a specific viewer (default profile visibility: public).';

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meta jsonb;
  v_name text;
  v_first text;
  v_last text;
  v_username text;
  v_phone text;
  v_default_settings jsonb;
BEGIN
  meta := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  v_first := NULLIF(TRIM(meta->>'first_name'), '');
  v_last := NULLIF(TRIM(meta->>'last_name'), '');
  v_username := NULLIF(LOWER(TRIM(meta->>'username')), '');
  v_phone := NULLIF(TRIM(meta->>'phone'), '');
  v_name := NULLIF(TRIM(meta->>'name'), '');

  IF v_name IS NULL AND (v_first IS NOT NULL OR v_last IS NOT NULL) THEN
    v_name := TRIM(CONCAT(v_first, ' ', v_last));
  END IF;

  IF v_name IS NULL OR v_name = '' THEN
    v_name := split_part(COALESCE(NEW.email, ''), '@', 1);
  END IF;

  IF v_name IS NULL OR v_name = '' THEN
    v_name := 'User';
  END IF;

  v_default_settings := jsonb_build_object(
    'privacy', jsonb_build_object(
      'profileVisibility', 'public',
      'discoverableForInvites', true
    )
  );

  INSERT INTO public.profiles (id, name, first_name, last_name, username, phone, settings)
  VALUES (NEW.id, v_name, v_first, v_last, v_username, v_phone, v_default_settings)
  ON CONFLICT (id) DO UPDATE SET
    name = COALESCE(EXCLUDED.name, profiles.name),
    first_name = COALESCE(EXCLUDED.first_name, profiles.first_name),
    last_name = COALESCE(EXCLUDED.last_name, profiles.last_name),
    username = COALESCE(EXCLUDED.username, profiles.username),
    phone = COALESCE(EXCLUDED.phone, profiles.phone),
    settings = COALESCE(profiles.settings, EXCLUDED.settings);

  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS public.search_users(text, uuid, uuid, integer);

CREATE OR REPLACE FUNCTION public.search_users(
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
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    COALESCE(p.settings, '{}'::jsonb) AS settings
  FROM profiles p
  WHERE
    (exclude_user_id IS NULL OR p.id != exclude_user_id)
    AND p.username IS NOT NULL
    AND COALESCE(p.settings->'privacy'->>'profileVisibility', 'public') != 'private'
    AND COALESCE((p.settings->'privacy'->>'discoverableForInvites')::boolean, true) = true
    AND (
      p.username ILIKE '%' || search_query || '%'
      OR p.first_name ILIKE '%' || search_query || '%'
      OR p.last_name ILIKE '%' || search_query || '%'
      OR p.name ILIKE '%' || search_query || '%'
      OR TRIM(CONCAT(COALESCE(p.first_name, ''), ' ', COALESCE(p.last_name, '')))
           ILIKE '%' || search_query || '%'
      OR EXISTS (
        SELECT 1
        FROM auth.users u
        WHERE u.id = p.id
          AND u.email ILIKE '%' || search_query || '%'
      )
    )
  ORDER BY
    CASE WHEN p.username = LOWER(search_query) THEN 0 ELSE 1 END,
    CASE WHEN p.username ILIKE search_query || '%' THEN 0 ELSE 1 END,
    p.username
  LIMIT result_limit;
END;
$$;

COMMENT ON FUNCTION public.search_users(text, uuid, uuid, integer) IS
  'Search users by username, name, or email for invites. Excludes private profiles and users who opted out of invite discovery.';

REVOKE ALL ON FUNCTION public.search_users(text, uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_users(text, uuid, uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.search_users(text, uuid, uuid, integer) TO service_role;
