-- CONC-02: one result row per test session
-- CONC-03: atomic coupon redemption (standalone + inside buy-now)

-- ---------------------------------------------------------------------------
-- CONC-02: UNIQUE(session_id) on test_results
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.test_results
    GROUP BY session_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot add UNIQUE(session_id): duplicate test_results rows exist';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS test_results_session_id_unique
  ON public.test_results (session_id);

-- ---------------------------------------------------------------------------
-- CONC-03: atomic coupon redeem
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.marketplace_redeem_coupon(p_coupon_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF p_coupon_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.marketplace_coupons
  SET
    uses_count = uses_count + 1,
    updated_at = now()
  WHERE id = p_coupon_id
    AND active = true
    AND (max_uses IS NULL OR uses_count < max_uses);

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.marketplace_redeem_coupon(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.marketplace_redeem_coupon(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.marketplace_redeem_coupon(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.marketplace_redeem_coupon(uuid) TO service_role;

COMMENT ON FUNCTION public.marketplace_redeem_coupon(uuid) IS
  'Atomically increments coupon uses_count when under max_uses; returns true if redeemed.';

-- Redeem coupon inside buy-now so order creation and usage share one transaction.
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
  v_redeemed boolean;
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

  IF p_coupon_id IS NOT NULL THEN
    v_redeemed := public.marketplace_redeem_coupon(p_coupon_id);
    IF NOT v_redeemed THEN
      RAISE EXCEPTION 'Coupon is not available for redemption';
    END IF;
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
  'Creates pending marketplace transaction and buy-now order in one DB transaction; atomically redeems coupon when provided.';
