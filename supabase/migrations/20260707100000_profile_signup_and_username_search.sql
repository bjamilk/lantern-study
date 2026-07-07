-- Profile signup trigger + username-only member search

-- ---------------------------------------------------------------------------
-- 1. Auto-create profiles from auth signup metadata
-- ---------------------------------------------------------------------------

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

  INSERT INTO public.profiles (id, name, first_name, last_name, username, phone)
  VALUES (NEW.id, v_name, v_first, v_last, v_username, v_phone)
  ON CONFLICT (id) DO UPDATE SET
    name = COALESCE(EXCLUDED.name, profiles.name),
    first_name = COALESCE(EXCLUDED.first_name, profiles.first_name),
    last_name = COALESCE(EXCLUDED.last_name, profiles.last_name),
    username = COALESCE(EXCLUDED.username, profiles.username),
    phone = COALESCE(EXCLUDED.phone, profiles.phone);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 2. search_users: username only
-- ---------------------------------------------------------------------------

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
  last_seen_at TIMESTAMPTZ
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
    p.last_seen_at
  FROM profiles p
  WHERE
    (exclude_user_id IS NULL OR p.id != exclude_user_id)
    AND p.username IS NOT NULL
    AND COALESCE(p.settings->'privacy'->>'profileVisibility', 'groups') != 'private'
    AND p.username ILIKE '%' || search_query || '%'
  ORDER BY
    CASE WHEN p.username = LOWER(search_query) THEN 0 ELSE 1 END,
    CASE WHEN p.username ILIKE search_query || '%' THEN 0 ELSE 1 END,
    p.username
  LIMIT result_limit;
END;
$$;

COMMENT ON FUNCTION public.search_users(text, uuid, uuid, integer) IS
  'Search users by username for group invites. Excludes private profiles.';

GRANT EXECUTE ON FUNCTION public.search_users(text, uuid, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_users(text, uuid, uuid, integer) TO service_role;
