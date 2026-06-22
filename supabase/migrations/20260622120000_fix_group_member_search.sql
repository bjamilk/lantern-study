-- Allow username/name search for group invites without requiring a shared group.
-- profile_visible_to_viewer still applies to profile detail views; search excludes only private profiles.

DROP FUNCTION IF EXISTS search_users(text, uuid, uuid, integer);
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
    avatar_url TEXT,
    last_seen_at TIMESTAMPTZ,
    settings JSONB
) AS $$
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
        p.settings
    FROM profiles p
    WHERE
        (exclude_user_id IS NULL OR p.id != exclude_user_id)
        AND p.username IS NOT NULL
        AND COALESCE(p.settings->'privacy'->>'profileVisibility', 'groups') != 'private'
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

COMMENT ON FUNCTION search_users(text, uuid, uuid, integer) IS
  'Search users by username or name for group invites. Excludes private profiles and users without usernames.';

GRANT EXECUTE ON FUNCTION search_users(text, uuid, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION search_users(text, uuid, uuid, integer) TO service_role;
