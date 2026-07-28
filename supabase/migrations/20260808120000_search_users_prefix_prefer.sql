-- Prefer prefix ILIKE for name search so short DM/user lookups can use indexes.
-- Keep contains matches as a fallback for longer queries.
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
  show_online_status BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_raw TEXT := trim(both from coalesce(search_query, ''));
  v_username_intent BOOLEAN := v_raw ~ '^@+';
  v_q TEXT := lower(regexp_replace(v_raw, '^@+', ''));
  v_allow_contains BOOLEAN := length(v_q) >= 3;
BEGIN
  IF length(v_q) < 2 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.username,
    p.first_name,
    p.last_name,
    p.name,
    p.avatar_url,
    p.last_seen_at,
    COALESCE((p.settings->'privacy'->>'showOnlineStatus')::boolean, true) AS show_online_status
  FROM profiles p
  WHERE
    (exclude_user_id IS NULL OR p.id != exclude_user_id)
    AND p.username IS NOT NULL
    AND COALESCE(p.settings->'privacy'->>'profileVisibility', 'public') != 'private'
    AND COALESCE((p.settings->'privacy'->>'discoverableForInvites')::boolean, true) = true
    AND (
      CASE
        WHEN v_username_intent THEN
          p.username ILIKE v_q || '%'
          OR (v_allow_contains AND p.username ILIKE '%' || v_q || '%')
        ELSE
          p.username ILIKE v_q || '%'
          OR p.first_name ILIKE v_q || '%'
          OR p.last_name ILIKE v_q || '%'
          OR p.name ILIKE v_q || '%'
          OR TRIM(CONCAT(COALESCE(p.first_name, ''), ' ', COALESCE(p.last_name, '')))
               ILIKE v_q || '%'
          OR (
            v_allow_contains AND (
              p.username ILIKE '%' || v_q || '%'
              OR p.first_name ILIKE '%' || v_q || '%'
              OR p.last_name ILIKE '%' || v_q || '%'
              OR p.name ILIKE '%' || v_q || '%'
              OR TRIM(CONCAT(COALESCE(p.first_name, ''), ' ', COALESCE(p.last_name, '')))
                   ILIKE '%' || v_q || '%'
            )
          )
      END
    )
  ORDER BY
    CASE WHEN p.username = v_q THEN 0 ELSE 1 END,
    CASE WHEN p.username ILIKE v_q || '%' THEN 0 ELSE 1 END,
    CASE WHEN p.first_name ILIKE v_q || '%' OR p.last_name ILIKE v_q || '%' OR p.name ILIKE v_q || '%' THEN 0 ELSE 1 END,
    CASE WHEN v_username_intent THEN 0 ELSE 1 END,
    p.username
  LIMIT result_limit;
END;
$$;

COMMENT ON FUNCTION public.search_users(text, uuid, uuid, integer) IS
  'Search users by name or @username. Prefers prefix matches; contains fallback for queries >= 3 chars.';

REVOKE ALL ON FUNCTION public.search_users(text, uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_users(text, uuid, uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.search_users(text, uuid, uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.search_users(text, uuid, uuid, integer) TO service_role;
