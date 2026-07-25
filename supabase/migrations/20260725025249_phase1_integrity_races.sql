-- Phase 1 integrity: RC-01 atomic marketplace escrow release (stock + status once)

CREATE OR REPLACE FUNCTION public.marketplace_release_escrow(
  p_order_id uuid,
  p_actor_id uuid DEFAULT NULL,
  p_allow_disputed boolean DEFAULT false
)
RETURNS TABLE (
  order_id uuid,
  already_completed boolean,
  listing_id uuid,
  buyer_id uuid,
  seller_id uuid,
  amount numeric,
  transaction_id uuid,
  source text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order marketplace_orders%ROWTYPE;
  v_listing marketplace_listings%ROWTYPE;
  v_next_qty integer;
  v_now timestamptz := NOW();
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'Order id required';
  END IF;

  SELECT *
  INTO v_order
  FROM public.marketplace_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF p_actor_id IS NOT NULL
     AND v_order.buyer_id IS DISTINCT FROM p_actor_id
     AND v_order.seller_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Idempotent: concurrent confirms return the completed order without re-stocking.
  IF v_order.status = 'completed' THEN
    RETURN QUERY SELECT
      v_order.id,
      true,
      v_order.listing_id,
      v_order.buyer_id,
      v_order.seller_id,
      v_order.amount,
      v_order.transaction_id,
      v_order.source;
    RETURN;
  END IF;

  IF p_allow_disputed THEN
    IF v_order.status IS DISTINCT FROM 'disputed' THEN
      RAISE EXCEPTION 'Only disputed orders can be released by admin';
    END IF;
  ELSE
    IF v_order.status NOT IN ('ready_for_pickup', 'paid', 'buyer_confirmed') THEN
      RAISE EXCEPTION 'Order is not ready for escrow release';
    END IF;
  END IF;

  SELECT *
  INTO v_listing
  FROM public.marketplace_listings
  WHERE id = v_order.listing_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Listing not found for order';
  END IF;

  IF v_order.transaction_id IS NOT NULL THEN
    UPDATE public.marketplace_transactions
    SET status = 'released'
    WHERE id = v_order.transaction_id
      AND status IS DISTINCT FROM 'released';
  END IF;

  IF v_listing.quantity IS NULL THEN
    UPDATE public.marketplace_listings
    SET status = 'sold',
        updated_at = v_now
    WHERE id = v_listing.id;
  ELSE
    v_next_qty := GREATEST(0, COALESCE(v_listing.quantity, 0) - 1);
    UPDATE public.marketplace_listings
    SET quantity = v_next_qty,
        status = CASE WHEN v_next_qty <= 0 THEN 'sold' ELSE 'active' END,
        updated_at = v_now
    WHERE id = v_listing.id;
  END IF;

  IF v_order.inquiry_id IS NOT NULL THEN
    UPDATE public.marketplace_inquiries
    SET status = 'purchased',
        updated_at = v_now
    WHERE id = v_order.inquiry_id;
  END IF;

  UPDATE public.marketplace_orders
  SET status = 'completed',
      buyer_confirmed_at = COALESCE(v_order.buyer_confirmed_at, v_now),
      completed_at = v_now,
      updated_at = v_now
  WHERE id = v_order.id;

  RETURN QUERY SELECT
    v_order.id,
    false,
    v_order.listing_id,
    v_order.buyer_id,
    v_order.seller_id,
    v_order.amount,
    v_order.transaction_id,
    v_order.source;
END;
$$;

REVOKE ALL ON FUNCTION public.marketplace_release_escrow(uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.marketplace_release_escrow(uuid, uuid, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.marketplace_release_escrow(uuid, uuid, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.marketplace_release_escrow(uuid, uuid, boolean) TO service_role;

COMMENT ON FUNCTION public.marketplace_release_escrow(uuid, uuid, boolean) IS
  'RC-01: Atomically complete an order once — lock order/listing, release txn, decrement stock, mark purchased.';
