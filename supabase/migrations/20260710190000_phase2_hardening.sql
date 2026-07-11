-- Phase 2: profile PII scoping, atomic marketplace RPCs

-- ---------------------------------------------------------------------------
-- SEC-07: Co-members see only public profile columns (not phone/settings/token)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.member_profiles
WITH (security_barrier = true) AS
SELECT
  id,
  name,
  first_name,
  last_name,
  username,
  avatar_url,
  points,
  stats,
  badges,
  created_at,
  last_seen_at
FROM public.profiles
WHERE public.profile_visible_to(id);

COMMENT ON VIEW public.member_profiles IS
  'Privacy-safe profile fields for viewers other than self. Phone, settings, and push tokens stay on profiles (owner-only SELECT).';

DROP POLICY IF EXISTS profiles_select ON public.profiles;
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());

GRANT SELECT ON public.member_profiles TO authenticated;

-- ---------------------------------------------------------------------------
-- RC-02: Atomic buy-now transaction + order insert
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.marketplace_create_buy_now_order(
  p_listing_id uuid,
  p_buyer_id uuid,
  p_amount numeric,
  p_inquiry_id uuid DEFAULT NULL,
  p_initial_status text DEFAULT 'paid',
  p_coupon_id uuid DEFAULT NULL,
  p_discount_amount numeric DEFAULT 0
)
RETURNS TABLE (order_id uuid, transaction_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_listing marketplace_listings%ROWTYPE;
  v_txn_id uuid;
  v_order_id uuid;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid order amount';
  END IF;

  IF p_initial_status NOT IN ('pending_payment', 'paid') THEN
    RAISE EXCEPTION 'Invalid initial order status';
  END IF;

  SELECT *
  INTO v_listing
  FROM public.marketplace_listings
  WHERE id = p_listing_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Listing not found';
  END IF;

  IF v_listing.user_id = p_buyer_id THEN
    RAISE EXCEPTION 'Cannot buy your own listing';
  END IF;

  IF v_listing.status <> 'active' THEN
    RAISE EXCEPTION 'Listing is not available for purchase';
  END IF;

  IF v_listing.quantity IS NOT NULL AND v_listing.quantity <= 0 THEN
    RAISE EXCEPTION 'This listing is out of stock';
  END IF;

  INSERT INTO public.marketplace_transactions (
    buyer_id,
    seller_id,
    listing_id,
    amount,
    status
  )
  VALUES (
    p_buyer_id,
    v_listing.user_id,
    p_listing_id,
    p_amount,
    'pending'
  )
  RETURNING id INTO v_txn_id;

  INSERT INTO public.marketplace_orders (
    listing_id,
    buyer_id,
    seller_id,
    amount,
    coupon_id,
    discount_amount,
    inquiry_id,
    transaction_id,
    source,
    status,
    fulfillment_mode
  )
  VALUES (
    p_listing_id,
    p_buyer_id,
    v_listing.user_id,
    p_amount,
    p_coupon_id,
    COALESCE(p_discount_amount, 0),
    p_inquiry_id,
    v_txn_id,
    'buy_now',
    p_initial_status,
    'campus_meetup'
  )
  RETURNING id INTO v_order_id;

  RETURN QUERY SELECT v_order_id, v_txn_id;
END;
$$;

REVOKE ALL ON FUNCTION public.marketplace_create_buy_now_order(uuid, uuid, numeric, uuid, text, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marketplace_create_buy_now_order(uuid, uuid, numeric, uuid, text, uuid, numeric) TO service_role;

COMMENT ON FUNCTION public.marketplace_create_buy_now_order IS
  'Creates pending marketplace transaction and buy-now order in one DB transaction (race-safe).';

-- ---------------------------------------------------------------------------
-- RC-03: Atomic boost credit debit
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.marketplace_consume_boost_credit(p_seller_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining integer;
  v_now timestamptz := now();
BEGIN
  INSERT INTO public.marketplace_seller_preferences (
    seller_id,
    hall_dropoff_enabled,
    boost_credits,
    require_payment_confirmation,
    favorite_alert_threshold,
    updated_at
  )
  VALUES (p_seller_id, false, 1, false, 3, v_now)
  ON CONFLICT (seller_id) DO NOTHING;

  UPDATE public.marketplace_seller_preferences
  SET boost_credits = boost_credits - 1,
      updated_at = v_now
  WHERE seller_id = p_seller_id
    AND boost_credits > 0
  RETURNING boost_credits INTO v_remaining;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No boost credits remaining. Complete more sales to earn boosts.';
  END IF;

  RETURN v_remaining;
END;
$$;

REVOKE ALL ON FUNCTION public.marketplace_consume_boost_credit(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marketplace_consume_boost_credit(uuid) TO service_role;

COMMENT ON FUNCTION public.marketplace_consume_boost_credit IS
  'Atomically decrements seller boost credits with row-level locking.';
