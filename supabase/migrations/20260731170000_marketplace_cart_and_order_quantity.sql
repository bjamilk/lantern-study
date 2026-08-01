-- Order line quantity + buyer cart; hold N units on buy-now.

ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 1;

ALTER TABLE public.marketplace_orders
  DROP CONSTRAINT IF EXISTS marketplace_orders_quantity_check;

ALTER TABLE public.marketplace_orders
  ADD CONSTRAINT marketplace_orders_quantity_check CHECK (quantity > 0);

CREATE TABLE IF NOT EXISTS public.marketplace_cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES public.marketplace_listings(id) ON DELETE CASCADE,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (buyer_id, listing_id)
);

CREATE INDEX IF NOT EXISTS idx_marketplace_cart_items_buyer
  ON public.marketplace_cart_items (buyer_id);

CREATE OR REPLACE FUNCTION public.update_marketplace_cart_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_marketplace_cart_items_updated_at ON public.marketplace_cart_items;
CREATE TRIGGER trigger_marketplace_cart_items_updated_at
  BEFORE UPDATE ON public.marketplace_cart_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_marketplace_cart_items_updated_at();

ALTER TABLE public.marketplace_cart_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Buyers can view own cart" ON public.marketplace_cart_items;
CREATE POLICY "Buyers can view own cart"
  ON public.marketplace_cart_items FOR SELECT
  TO authenticated
  USING (buyer_id = auth.uid());

DROP POLICY IF EXISTS "Buyers can insert own cart" ON public.marketplace_cart_items;
CREATE POLICY "Buyers can insert own cart"
  ON public.marketplace_cart_items FOR INSERT
  TO authenticated
  WITH CHECK (buyer_id = auth.uid());

DROP POLICY IF EXISTS "Buyers can update own cart" ON public.marketplace_cart_items;
CREATE POLICY "Buyers can update own cart"
  ON public.marketplace_cart_items FOR UPDATE
  TO authenticated
  USING (buyer_id = auth.uid())
  WITH CHECK (buyer_id = auth.uid());

DROP POLICY IF EXISTS "Buyers can delete own cart" ON public.marketplace_cart_items;
CREATE POLICY "Buyers can delete own cart"
  ON public.marketplace_cart_items FOR DELETE
  TO authenticated
  USING (buyer_id = auth.uid());

-- Offer accept: still 1 unit; persist quantity column.
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
    listing_id, buyer_id, seller_id, amount, quantity, offer_id, inquiry_id, transaction_id,
    source, status, fulfillment_mode
  ) VALUES (
    v_offer.listing_id, v_offer.buyer_id, v_offer.seller_id, v_amount, 1, p_offer_id, p_inquiry_id, v_txn_id,
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

DROP FUNCTION IF EXISTS public.marketplace_create_buy_now_order(uuid, uuid, numeric, uuid, text, uuid, numeric);

CREATE OR REPLACE FUNCTION public.marketplace_create_buy_now_order(
  p_listing_id uuid,
  p_buyer_id uuid,
  p_amount numeric,
  p_inquiry_id uuid DEFAULT NULL,
  p_initial_status text DEFAULT 'paid',
  p_coupon_id uuid DEFAULT NULL,
  p_discount_amount numeric DEFAULT 0,
  p_quantity integer DEFAULT 1
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
  v_qty integer;
BEGIN
  v_qty := COALESCE(p_quantity, 1);
  IF v_qty < 1 THEN
    RAISE EXCEPTION 'Invalid quantity';
  END IF;

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

  IF v_listing.quantity IS NULL THEN
    IF v_qty <> 1 THEN
      RAISE EXCEPTION 'This listing can only be purchased as a single item';
    END IF;
    SELECT o.id INTO v_existing_order_id
    FROM public.marketplace_orders o
    WHERE o.listing_id = p_listing_id
      AND o.status IN ('pending_payment', 'paid', 'ready_for_pickup', 'buyer_confirmed', 'disputed')
    LIMIT 1;
    IF v_existing_order_id IS NOT NULL THEN
      RAISE EXCEPTION 'This listing already has an open order';
    END IF;
  ELSE
    IF v_listing.quantity < v_qty THEN
      RAISE EXCEPTION 'Not enough stock for the requested quantity';
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
    listing_id, buyer_id, seller_id, amount, quantity, coupon_id, discount_amount, inquiry_id,
    transaction_id, source, status, fulfillment_mode
  ) VALUES (
    p_listing_id, p_buyer_id, v_listing.user_id, p_amount, v_qty, p_coupon_id, COALESCE(p_discount_amount, 0),
    p_inquiry_id, v_txn_id, 'buy_now', p_initial_status, 'campus_meetup'
  ) RETURNING id INTO v_order_id;

  IF v_listing.quantity IS NULL THEN
    UPDATE public.marketplace_listings
    SET status = 'reserved', updated_at = NOW()
    WHERE id = p_listing_id AND status = 'active';
  ELSE
    v_next_qty := GREATEST(0, v_listing.quantity - v_qty);
    UPDATE public.marketplace_listings
    SET quantity = v_next_qty,
        status = CASE WHEN v_next_qty <= 0 THEN 'reserved' ELSE 'active' END,
        updated_at = NOW()
    WHERE id = p_listing_id;
  END IF;

  RETURN QUERY SELECT v_order_id, v_txn_id;
END;
$$;

REVOKE ALL ON FUNCTION public.marketplace_create_buy_now_order(uuid, uuid, numeric, uuid, text, uuid, numeric, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marketplace_create_buy_now_order(uuid, uuid, numeric, uuid, text, uuid, numeric, integer) TO service_role;
