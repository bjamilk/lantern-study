-- P2 hardening: tighten anon grants, search_users, marketplace UPDATE WITH CHECK.

-- ---------------------------------------------------------------------------
-- 1. Replace blanket anon grants with explicit function access only
-- ---------------------------------------------------------------------------

REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE EXECUTE ON ALL ROUTINES IN SCHEMA public FROM anon;

GRANT EXECUTE ON FUNCTION public.is_username_available(text) TO anon;
GRANT EXECUTE ON FUNCTION public.marketplace_search_listings(
  text, integer, integer, text, numeric, numeric, text, text, text
) TO anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON ROUTINES FROM anon;

-- ---------------------------------------------------------------------------
-- 2. search_users: drop settings from return, set search_path
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
$$;

COMMENT ON FUNCTION public.search_users(text, uuid, uuid, integer) IS
  'Search users by username or name for group invites. Excludes private profiles and settings.';

GRANT EXECUTE ON FUNCTION public.search_users(text, uuid, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_users(text, uuid, uuid, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Marketplace order/offer/transaction UPDATE WITH CHECK
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Participants can update own orders" ON public.marketplace_orders;
CREATE POLICY "Participants can update own orders"
  ON public.marketplace_orders FOR UPDATE
  TO authenticated
  USING (buyer_id = auth.uid() OR seller_id = auth.uid())
  WITH CHECK (buyer_id = auth.uid() OR seller_id = auth.uid());

DROP POLICY IF EXISTS "Participants can update own transactions" ON public.marketplace_transactions;
CREATE POLICY "Participants can update own transactions"
  ON public.marketplace_transactions FOR UPDATE
  TO authenticated
  USING (buyer_id = auth.uid() OR seller_id = auth.uid())
  WITH CHECK (buyer_id = auth.uid() OR seller_id = auth.uid());

DROP POLICY IF EXISTS "Participants can update offers" ON public.marketplace_offers;
CREATE POLICY "Participants can update offers"
  ON public.marketplace_offers FOR UPDATE
  TO authenticated
  USING (auth.uid() = buyer_id OR auth.uid() = seller_id)
  WITH CHECK (auth.uid() = buyer_id OR auth.uid() = seller_id);
