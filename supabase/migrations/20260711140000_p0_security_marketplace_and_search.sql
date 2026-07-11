-- P0: Lock down marketplace order/transaction client writes; harden search_users privacy.

-- ---------------------------------------------------------------------------
-- 1. Marketplace orders/transactions: server-only mutations
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Buyers can create orders" ON public.marketplace_orders;
DROP POLICY IF EXISTS "Participants can update own orders" ON public.marketplace_orders;
DROP POLICY IF EXISTS "Authenticated users can create transactions" ON public.marketplace_transactions;
DROP POLICY IF EXISTS "Participants can update own transactions" ON public.marketplace_transactions;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.marketplace_orders FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.marketplace_transactions FROM authenticated, anon;

GRANT SELECT ON TABLE public.marketplace_orders TO authenticated;
GRANT SELECT ON TABLE public.marketplace_transactions TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. search_users: remove settings leak and email enumeration
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
  last_seen_at TIMESTAMPTZ,
  show_online_status BOOLEAN
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
    COALESCE((p.settings->'privacy'->>'showOnlineStatus')::boolean, true) AS show_online_status
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
    )
  ORDER BY
    CASE WHEN p.username = LOWER(search_query) THEN 0 ELSE 1 END,
    CASE WHEN p.username ILIKE search_query || '%' THEN 0 ELSE 1 END,
    p.username
  LIMIT result_limit;
END;
$$;

COMMENT ON FUNCTION public.search_users(text, uuid, uuid, integer) IS
  'Search users by username or name for invites. Does not expose settings or email.';

REVOKE ALL ON FUNCTION public.search_users(text, uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_users(text, uuid, uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.search_users(text, uuid, uuid, integer) TO service_role;
