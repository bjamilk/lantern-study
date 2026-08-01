-- Turn-based marketplace offers: proposed_by + buyer/seller can respond when it is their turn

-- ---------------------------------------------------------------------------
-- proposed_by column
-- ---------------------------------------------------------------------------
ALTER TABLE public.marketplace_offers
  ADD COLUMN IF NOT EXISTS proposed_by text;

UPDATE public.marketplace_offers
SET proposed_by = CASE
  WHEN parent_offer_id IS NULL THEN 'buyer'
  ELSE 'seller'
END
WHERE proposed_by IS NULL;

ALTER TABLE public.marketplace_offers
  ALTER COLUMN proposed_by SET DEFAULT 'buyer';

ALTER TABLE public.marketplace_offers
  ALTER COLUMN proposed_by SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'marketplace_offers_proposed_by_check'
      AND conrelid = 'public.marketplace_offers'::regclass
  ) THEN
    ALTER TABLE public.marketplace_offers
      ADD CONSTRAINT marketplace_offers_proposed_by_check
      CHECK (proposed_by IN ('buyer', 'seller'));
  END IF;
END $$;

COMMENT ON COLUMN public.marketplace_offers.proposed_by IS
  'Whose proposal this pending row is. The other party may accept/decline/counter.';

-- ---------------------------------------------------------------------------
-- Atomic counter: either party may counter when they are the responder
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.marketplace_counter_offer(uuid, uuid, numeric);

CREATE OR REPLACE FUNCTION public.marketplace_counter_offer(
  p_offer_id uuid,
  p_actor_id uuid,
  p_counter_amount numeric
)
RETURNS TABLE (counter_offer_id uuid, parent_offer_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offer marketplace_offers%ROWTYPE;
  v_counter_id uuid;
  v_updated integer;
  v_expires_at timestamptz := NOW() + INTERVAL '48 hours';
  v_proposed_by text;
  v_actor_role text;
  v_message text;
BEGIN
  IF p_offer_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'Offer and actor are required';
  END IF;

  IF p_counter_amount IS NULL OR p_counter_amount <= 0 THEN
    RAISE EXCEPTION 'counterAmount must be positive';
  END IF;

  SELECT *
  INTO v_offer
  FROM public.marketplace_offers
  WHERE id = p_offer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Offer not found';
  END IF;

  IF p_actor_id IS NOT DISTINCT FROM v_offer.buyer_id THEN
    v_actor_role := 'buyer';
  ELSIF p_actor_id IS NOT DISTINCT FROM v_offer.seller_id THEN
    v_actor_role := 'seller';
  ELSE
    RAISE EXCEPTION 'Only the buyer or seller can counter this offer';
  END IF;

  -- Responder is the party who did NOT propose the current pending offer
  IF v_offer.proposed_by IS NOT DISTINCT FROM v_actor_role THEN
    RAISE EXCEPTION 'Only the other party can counter this offer';
  END IF;

  IF v_offer.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'Offer is no longer pending';
  END IF;

  UPDATE public.marketplace_offers
  SET status = 'countered',
      counter_amount = p_counter_amount
  WHERE id = p_offer_id
    AND status = 'pending';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'Offer is no longer pending';
  END IF;

  v_proposed_by := v_actor_role;
  v_message := CASE
    WHEN v_actor_role = 'buyer' THEN 'Counter offer from buyer'
    ELSE 'Counter offer from seller'
  END;

  INSERT INTO public.marketplace_offers (
    listing_id,
    buyer_id,
    seller_id,
    amount,
    status,
    parent_offer_id,
    expires_at,
    message,
    proposed_by
  )
  VALUES (
    v_offer.listing_id,
    v_offer.buyer_id,
    v_offer.seller_id,
    p_counter_amount,
    'pending',
    p_offer_id,
    v_expires_at,
    v_message,
    v_proposed_by
  )
  RETURNING id INTO v_counter_id;

  RETURN QUERY SELECT v_counter_id, p_offer_id;
END;
$$;

REVOKE ALL ON FUNCTION public.marketplace_counter_offer(uuid, uuid, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.marketplace_counter_offer(uuid, uuid, numeric) FROM anon;
REVOKE ALL ON FUNCTION public.marketplace_counter_offer(uuid, uuid, numeric) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.marketplace_counter_offer(uuid, uuid, numeric) TO service_role;

COMMENT ON FUNCTION public.marketplace_counter_offer(uuid, uuid, numeric) IS
  'Atomically mark parent offer countered and insert pending counter from the responding party.';

-- ---------------------------------------------------------------------------
-- Accept: responder (buyer or seller) may accept and create order
-- ---------------------------------------------------------------------------
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
BEGIN
  IF p_initial_status NOT IN ('pending_payment', 'paid') THEN
    RAISE EXCEPTION 'Invalid initial order status';
  END IF;

  SELECT *
  INTO v_offer
  FROM public.marketplace_offers
  WHERE id = p_offer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Offer not found';
  END IF;

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

  -- Idempotent: offer already accepted with an order
  IF v_offer.status = 'accepted' THEN
    SELECT o.id, o.transaction_id
    INTO v_order_id, v_txn_id
    FROM public.marketplace_orders o
    WHERE o.offer_id = p_offer_id
    LIMIT 1;
    IF v_order_id IS NOT NULL THEN
      RETURN QUERY SELECT v_order_id, v_txn_id;
      RETURN;
    END IF;
  END IF;

  IF v_offer.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'Offer is not pending';
  END IF;

  SELECT *
  INTO v_listing
  FROM public.marketplace_listings
  WHERE id = v_offer.listing_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Listing not found for offer';
  END IF;

  IF v_listing.status NOT IN ('active', 'sold') THEN
    RAISE EXCEPTION 'Listing is not available';
  END IF;

  IF v_listing.quantity IS NOT NULL AND v_listing.quantity <= 0 THEN
    RAISE EXCEPTION 'This listing is out of stock';
  END IF;

  SELECT o.id
  INTO v_existing_order_id
  FROM public.marketplace_orders o
  WHERE o.listing_id = v_offer.listing_id
    AND o.status IN ('pending_payment', 'paid', 'ready_for_pickup', 'buyer_confirmed', 'disputed')
  LIMIT 1;

  IF v_existing_order_id IS NOT NULL THEN
    RAISE EXCEPTION 'This listing already has an open order';
  END IF;

  v_amount := COALESCE(v_offer.counter_amount, v_offer.amount);
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid offer amount';
  END IF;

  INSERT INTO public.marketplace_transactions (
    buyer_id,
    seller_id,
    listing_id,
    amount,
    status
  )
  VALUES (
    v_offer.buyer_id,
    v_offer.seller_id,
    v_offer.listing_id,
    v_amount,
    'pending'
  )
  RETURNING id INTO v_txn_id;

  INSERT INTO public.marketplace_orders (
    listing_id,
    buyer_id,
    seller_id,
    amount,
    offer_id,
    inquiry_id,
    transaction_id,
    source,
    status,
    fulfillment_mode
  )
  VALUES (
    v_offer.listing_id,
    v_offer.buyer_id,
    v_offer.seller_id,
    v_amount,
    p_offer_id,
    p_inquiry_id,
    v_txn_id,
    'offer_accept',
    p_initial_status,
    'campus_meetup'
  )
  RETURNING id INTO v_order_id;

  UPDATE public.marketplace_offers
  SET status = 'accepted'
  WHERE id = p_offer_id
    AND status = 'pending';

  RETURN QUERY SELECT v_order_id, v_txn_id;
END;
$$;

REVOKE ALL ON FUNCTION public.marketplace_create_offer_accept_order(uuid, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marketplace_create_offer_accept_order(uuid, uuid, uuid, text) TO service_role;

COMMENT ON FUNCTION public.marketplace_create_offer_accept_order IS
  'Atomically accepts a pending offer (by the non-proposing party) and creates marketplace transaction + order.';
