-- marketplace_release_escrow must not undo a moderation takedown (hand-apply;
-- sequence after 20260822120000_marketplace_listings_moderation_lock.sql).
--
-- The 20260818120000 version of this RPC completed an order by writing the
-- listing's status unconditionally: 'sold' for a unique item, and for multi-qty
-- stock `CASE WHEN quantity <= 0 THEN 'sold' ELSE 'active' END`. If an admin had
-- taken the listing down (removed_by_admin / suspended_by_admin) while an order
-- was still open (admin takedowns do not cancel orders), the buyer's
-- confirm-received — or the Paystack payout path — would flip the listing back
-- to 'active' (or to 'sold', which a seller may then relist). The RPC runs as
-- the service role, so the moderation trigger does not fence it.
--
-- Fix: the two listing UPDATEs only apply while the listing is in an
-- order-held state (status IN ('active','reserved')); the order still
-- completes, escrow/inquiry bookkeeping is unchanged, and a moderated or
-- archived listing simply keeps its status. Body otherwise identical to
-- 20260818120000_marketplace_question_banks.sql.

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

  IF v_listing.listing_kind = 'question_bank' THEN
    NULL; -- Digital: the listing stays active for the next buyer.
  ELSIF v_listing.quantity IS NULL THEN
    -- Unique item: mark sold once completed — unless moderation/archival has
    -- already taken the listing out of the order-held states.
    UPDATE public.marketplace_listings
    SET status = 'sold', updated_at = v_now
    WHERE id = v_listing.id
      AND status IN ('active', 'reserved');
  ELSE
    -- Stock already reduced when the order opened; only flip sold when none
    -- left. Same moderation/archival guard.
    UPDATE public.marketplace_listings
    SET status = CASE
          WHEN COALESCE(quantity, 0) <= 0 THEN 'sold'
          ELSE 'active'
        END,
        updated_at = v_now
    WHERE id = v_listing.id
      AND status IN ('active', 'reserved');
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

REVOKE ALL ON FUNCTION public.marketplace_release_escrow(uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marketplace_release_escrow(uuid, uuid, boolean) TO service_role;
