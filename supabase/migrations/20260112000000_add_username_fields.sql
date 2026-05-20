-- Migration: Add username, first_name, last_name to profiles table
-- Date: 2026-01-12
-- Purpose: Enable username-based member search and improve user identity

-- Enable the pg_trgm extension first (required for gin_trgm_ops)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Add new columns to profiles table
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS username VARCHAR(20) UNIQUE,
ADD COLUMN IF NOT EXISTS first_name TEXT,
ADD COLUMN IF NOT EXISTS last_name TEXT;

-- Add CHECK constraint for username validation
-- Rules: lowercase alphanumeric + underscore, 3-20 characters
ALTER TABLE profiles
ADD CONSTRAINT username_format_check 
CHECK (username IS NULL OR username ~ '^[a-z0-9_]{3,20}$');

-- Create index on username for fast lookups
CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username);

-- Create index on first_name and last_name for name search
CREATE INDEX IF NOT EXISTS idx_profiles_name_search ON profiles(first_name, last_name);

-- Create a GIN index for text search on names (faster ILIKE queries)
CREATE INDEX IF NOT EXISTS idx_profiles_first_name_gin ON profiles USING gin(first_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_profiles_last_name_gin ON profiles USING gin(last_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_profiles_username_gin ON profiles USING gin(username gin_trgm_ops);

-- Add comment for documentation
COMMENT ON COLUMN profiles.username IS 'Unique username for the user. Lowercase alphanumeric and underscores only, 3-20 characters. Used for @mentions and member search.';
COMMENT ON COLUMN profiles.first_name IS 'User first name for display and search';
COMMENT ON COLUMN profiles.last_name IS 'User last name for display and search';

-- Function to search users by username or name
CREATE OR REPLACE FUNCTION search_users(
    search_query TEXT,
    exclude_user_id UUID DEFAULT NULL,
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
        AND p.username IS NOT NULL  -- Only return users with usernames set
        AND (
            p.username ILIKE '%' || search_query || '%'
            OR p.first_name ILIKE '%' || search_query || '%'
            OR p.last_name ILIKE '%' || search_query || '%'
            OR p.name ILIKE '%' || search_query || '%'
        )
    ORDER BY 
        -- Prioritize exact username matches
        CASE WHEN p.username = LOWER(search_query) THEN 0 ELSE 1 END,
        -- Then prefix matches
        CASE WHEN p.username ILIKE search_query || '%' THEN 0 ELSE 1 END,
        p.username
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if username is available
CREATE OR REPLACE FUNCTION is_username_available(check_username TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    -- Validate format first
    IF check_username !~ '^[a-z0-9_]{3,20}$' THEN
        RETURN FALSE;
    END IF;
    
    -- Check if username exists
    RETURN NOT EXISTS (
        SELECT 1 FROM profiles WHERE username = LOWER(check_username)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION search_users TO authenticated;
GRANT EXECUTE ON FUNCTION is_username_available TO authenticated;
GRANT EXECUTE ON FUNCTION is_username_available TO anon;
