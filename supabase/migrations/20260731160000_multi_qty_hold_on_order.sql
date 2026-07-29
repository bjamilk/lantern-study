-- Multi-quantity listings: hold one unit per open order; keep remaining stock for sale.
-- Unique listings (quantity IS NULL) still reserve the whole listing.

DROP INDEX IF EXISTS public.idx_marketplace_orders_one_open_per_listing;

CREATE OR REPLACE FUNCTION public.marketplace_create_offer_accept_order(
  p_offer_id uuid,
  p_actor_id uuid,
  p_inquiry_id uuid DEFAULT NULL,
  p_initial_status text DEFAULT 'paid'
)
RETURNS TABLE (order_id uuid, transaction_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offer marketplace_offers%ROWTYPE;
  v_listing marketplace_listings%ROWTYPE;
  v_amount numeric;
  v_txn_id uuid;
  v_order_id uuid;
  v_existing_order_id uuid;
  v_actor_role text;
  v_open_count integer;
  v_next_qty integer;
BEGIN
  IF p_initial_status NOT IN ('pending_payment', 'paid') THEN
    RAISE EXCEPTION 'Invalid initial order status';
  END IF;

  SELECT * INTO v_offer FROM public.marketplace_offers WHERE id = p_offer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Offer not found'; END IF;

  IF p_actor_id IS NOT DISTINCT FROM v_offer.buyer_id THEN
    v_actor_role := 'buyer';
  ELSIF p_actor_id IS NOT DISTINCT FROM v_offer.seller_id THEN
    v_actor_role := 'seller';
  ELSE
    RAISE EXCEPTION 'Only the buyer or seller can accept this offer';
  END IF;

  IF v_offer.proposed_by IS NOT DISTINCT FROM v_actor_role THEN
    RAISE EXCEPTION 'Only the other party can accept this offer';
  END IF;

  IF v_offer.status = 'accepted' THEN
    SELECT o.id, o.transaction_id INTO v_order_id, v_txn_id
    FROM public.marketplace_orders o WHERE o.offer_id = p_offer_id LIMIT 1;
    IF v_order_id IS NOT NULL THEN
      RETURN QUERY SELECT v_order_id, v_txn_id;
      RETURN;
    END IF;
  END IF;

  IF v_offer.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'Offer is not pending';
  END IF;

  SELECT * INTO v_listing FROM public.marketplace_listings WHERE id = v_offer.listing_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Listing not found for offer'; END IF;

  IF v_listing.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Listing is not available';
  END IF;

  IF v_listing.quantity IS NOT NULL AND v_listing.quantity <= 0 THEN
    RAISE EXCEPTION 'This listing is out of stock';
  END IF;

  -- Unique (no quantity): still only one open order at a time.
  IF v_listing.quantity IS NULL THEN
    SELECT o.id INTO v_existing_order_id
    FROM public.marketplace_orders o
    WHERE o.listing_id = v_offer.listing_id
      AND o.status IN ('pending_payment', 'paid', 'ready_for_pickup', 'buyer_confirmed', 'disputed')
    LIMIT 1;
    IF v_existing_order_id IS NOT NULL THEN
      RAISE EXCEPTION 'This listing already has an open order';
    END IF;
  END IF;

  v_amount := COALESCE(v_offer.counter_amount, v_offer.amount);
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid offer amount';
  END IF;

  INSERT INTO public.marketplace_transactions (buyer_id, seller_id, listing_id, amount, status)
  VALUES (v_offer.buyer_id, v_offer.seller_id, v_offer.listing_id, v_amount, 'pending')
  RETURNING id INTO v_txn_id;

  INSERT INTO public.marketplace_orders (
    listing_id, buyer_id, seller_id, amount, offer_id, inquiry_id, transaction_id,
    source, status, fulfillment_mode
  ) VALUES (
    v_offer.listing_id, v_offer.buyer_id, v_offer.seller_id, v_amount, p_offer_id, p_inquiry_id, v_txn_id,
    'offer_accept', p_initial_status, 'campus_meetup'
  ) RETURNING id INTO v_order_id;

  UPDATE public.marketplace_offers
  SET status = 'accepted'
  WHERE id = p_offer_id AND status = 'pending';

  IF v_listing.quantity IS NULL THEN
    UPDATE public.marketplace_listings
    SET status = 'reserved', updated_at = NOW()
    WHERE id = v_offer.listing_id AND status = 'active';
  ELSE
    v_next_qty := GREATEST(0, v_listing.quantity - 1);
    UPDATE public.marketplace_listings
    SET quantity = v_next_qty,
        status = CASE WHEN v_next_qty <= 0 THEN 'reserved' ELSE 'active' END,
        updated_at = NOW()
    WHERE id = v_offer.listing_id;
  END IF;

  RETURN QUERY SELECT v_order_id, v_txn_id;
END;
$$;

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
  v_existing_order_id uuid;
  v_next_qty integer;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid order amount';
  END IF;

  IF p_initial_status NOT IN ('pending_payment', 'paid') THEN
    RAISE EXCEPTION 'Invalid initial order status';
  END IF;

  SELECT * INTO v_listing FROM public.marketplace_listings WHERE id = p_listing_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Listing not found'; END IF;

  IF v_listing.user_id = p_buyer_id THEN
    RAISE EXCEPTION 'Cannot buy your own listing';
  END IF;

  IF v_listing.status <> 'active' THEN
    RAISE EXCEPTION 'Listing is not available for purchase';
  END IF;

  IF v_listing.quantity IS NOT NULL AND v_listing.quantity <= 0 THEN
    RAISE EXCEPTION 'This listing is out of stock';
  END IF;

  IF v_listing.quantity IS NULL THEN
    SELECT o.id INTO v_existing_order_id
    FROM public.marketplace_orders o
    WHERE o.listing_id = p_listing_id
      AND o.status IN ('pending_payment', 'paid', 'ready_for_pickup', 'buyer_confirmed', 'disputed')
    LIMIT 1;
    IF v_existing_order_id IS NOT NULL THEN
      RAISE EXCEPTION 'This listing already has an open order';
    END IF;
  END IF;

  IF p_coupon_id IS NOT NULL THEN
    v_redeemed := public.marketplace_redeem_coupon(p_coupon_id);
    IF NOT v_redeemed THEN
      RAISE EXCEPTION 'Coupon is not available for redemption';
    END IF;
  END IF;

  INSERT INTO public.marketplace_transactions (buyer_id, seller_id, listing_id, amount, status)
  VALUES (p_buyer_id, v_listing.user_id, p_listing_id, p_amount, 'pending')
  RETURNING id INTO v_txn_id;

  INSERT INTO public.marketplace_orders (
    listing_id, buyer_id, seller_id, amount, coupon_id, discount_amount, inquiry_id,
    transaction_id, source, status, fulfillment_mode
  ) VALUES (
    p_listing_id, p_buyer_id, v_listing.user_id, p_amount, p_coupon_id, COALESCE(p_discount_amount, 0),
    p_inquiry_id, v_txn_id, 'buy_now', p_initial_status, 'campus_meetup'
  ) RETURNING id INTO v_order_id;

  IF v_listing.quantity IS NULL THEN
    UPDATE public.marketplace_listings
    SET status = 'reserved', updated_at = NOW()
    WHERE id = p_listing_id AND status = 'active';
  ELSE
    v_next_qty := GREATEST(0, v_listing.quantity - 1);
    UPDATE public.marketplace_listings
    SET quantity = v_next_qty,
        status = CASE WHEN v_next_qty <= 0 THEN 'reserved' ELSE 'active' END,
        updated_at = NOW()
    WHERE id = p_listing_id;
  END IF;

  RETURN QUERY SELECT v_order_id, v_txn_id;
END;
$$;

-- Escrow release: unit already held at order create for quantity listings — do not decrement again.
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
  v_now timestamptz := NOW();
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'Order id required';
  END IF;

  SELECT * INTO v_order FROM public.marketplace_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;

  IF p_actor_id IS NOT NULL
     AND v_order.buyer_id IS DISTINCT FROM p_actor_id
     AND v_order.seller_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF v_order.status = 'completed' THEN
    RETURN QUERY SELECT
      v_order.id, true, v_order.listing_id, v_order.buyer_id, v_order.seller_id,
      v_order.amount, v_order.transaction_id, v_order.source;
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

  SELECT * INTO v_listing FROM public.marketplace_listings WHERE id = v_order.listing_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Listing not found for order'; END IF;

  IF v_order.transaction_id IS NOT NULL THEN
    UPDATE public.marketplace_transactions
    SET status = 'released'
    WHERE id = v_order.transaction_id AND status IS DISTINCT FROM 'released';
  END IF;

  IF v_listing.quantity IS NULL THEN
    -- Unique item: mark sold once completed.
    UPDATE public.marketplace_listings
    SET status = 'sold', updated_at = v_now
    WHERE id = v_listing.id;
  ELSE
    -- Stock already reduced when the order opened; only flip sold when none left.
    UPDATE public.marketplace_listings
    SET status = CASE
          WHEN COALESCE(quantity, 0) <= 0 THEN 'sold'
          ELSE 'active'
        END,
        updated_at = v_now
    WHERE id = v_listing.id;
  END IF;

  IF v_order.inquiry_id IS NOT NULL THEN
    UPDATE public.marketplace_inquiries
    SET status = 'purchased', updated_at = v_now
    WHERE id = v_order.inquiry_id;
  END IF;

  UPDATE public.marketplace_orders
  SET status = 'completed',
      buyer_confirmed_at = COALESCE(v_order.buyer_confirmed_at, v_now),
      completed_at = v_now,
      updated_at = v_now
  WHERE id = v_order.id;

  RETURN QUERY SELECT
    v_order.id, false, v_order.listing_id, v_order.buyer_id, v_order.seller_id,
    v_order.amount, v_order.transaction_id, v_order.source;
END;
$$;

-- Repair current multi-qty listings stuck as fully reserved while stock remains.
UPDATE public.marketplace_listings l
SET quantity = GREATEST(
      0,
      COALESCE(l.quantity, 0) - (
        SELECT COUNT(*)::int
        FROM public.marketplace_orders o
        WHERE o.listing_id = l.id
          AND o.status IN ('pending_payment', 'paid', 'ready_for_pickup', 'buyer_confirmed', 'disputed')
      )
    ),
    status = CASE
      WHEN GREATEST(
        0,
        COALESCE(l.quantity, 0) - (
          SELECT COUNT(*)::int
          FROM public.marketplace_orders o
          WHERE o.listing_id = l.id
            AND o.status IN ('pending_payment', 'paid', 'ready_for_pickup', 'buyer_confirmed', 'disputed')
        )
      ) <= 0 THEN 'reserved'
      ELSE 'active'
    END,
    updated_at = NOW()
WHERE l.status = 'reserved'
  AND l.quantity IS NOT NULL
  AND l.quantity > 0;
