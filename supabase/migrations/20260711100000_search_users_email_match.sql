-- Extend search_users with email matching (auth.users) for invite discovery.

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
    AND COALESCE(p.settings->'privacy'->>'profileVisibility', 'groups') != 'private'
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
