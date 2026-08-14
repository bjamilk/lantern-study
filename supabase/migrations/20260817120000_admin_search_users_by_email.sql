-- Admin console: search users by email without paging auth.admin.listUsers.
--
-- The /admin/users email search scanned at most 5 pages x 200 auth users and
-- silently fell back to name-only matching past user #1000 — a real email
-- could return "no results" with no hint the filter didn't apply. This
-- function matches directly against auth.users, follows the SECURITY DEFINER
-- pattern of search_users (20260711100000), and is executable by service_role
-- only: it exposes email addresses, which is admin-only data.
--
-- The API route falls back to the old page scan when this function is absent,
-- so deploy order does not matter.

CREATE OR REPLACE FUNCTION public.admin_search_users_by_email(
  search_query TEXT,
  result_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  email TEXT,
  is_platform_admin BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.id,
    u.email::text,
    COALESCE((u.raw_app_meta_data->>'is_platform_admin')::boolean, false)
  FROM auth.users u
  WHERE u.email ILIKE '%' || search_query || '%'
  ORDER BY u.email
  LIMIT LEAST(GREATEST(result_limit, 1), 100);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_search_users_by_email(TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_search_users_by_email(TEXT, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.admin_search_users_by_email(TEXT, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_search_users_by_email(TEXT, INTEGER) TO service_role;
