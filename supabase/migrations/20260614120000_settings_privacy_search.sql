-- Viewer-aware profile visibility for user search (service role / RPC context)

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
  'Visibility check for a specific viewer (API/service role). Mirrors profile_visible_to.';

-- Filter search results by recipient privacy settings
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
    avatar_url TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.id,
        p.username,
        p.first_name,
        p.last_name,
        p.name,
        p.avatar_url
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

GRANT EXECUTE ON FUNCTION public.profile_visible_to_viewer TO authenticated;
GRANT EXECUTE ON FUNCTION public.profile_visible_to_viewer TO service_role;
