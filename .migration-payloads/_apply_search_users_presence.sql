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

INSERT INTO supabase_migrations.schema_migrations(version)
VALUES ('20260614150000')
ON CONFLICT DO NOTHING;
