-- Phase 2 REL-04: atomic offer counter (mark parent + insert child in one transaction)

CREATE OR REPLACE FUNCTION public.marketplace_counter_offer(
  p_offer_id uuid,
  p_seller_id uuid,
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
BEGIN
  IF p_offer_id IS NULL OR p_seller_id IS NULL THEN
    RAISE EXCEPTION 'Offer and seller are required';
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

  IF v_offer.seller_id IS DISTINCT FROM p_seller_id THEN
    RAISE EXCEPTION 'Only the seller can counter this offer';
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

  INSERT INTO public.marketplace_offers (
    listing_id,
    buyer_id,
    seller_id,
    amount,
    status,
    parent_offer_id,
    expires_at,
    message
  )
  VALUES (
    v_offer.listing_id,
    v_offer.buyer_id,
    v_offer.seller_id,
    p_counter_amount,
    'pending',
    p_offer_id,
    v_expires_at,
    'Counter offer from seller'
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
  'REL-04: Atomically mark parent offer countered and insert pending counter-offer.';
