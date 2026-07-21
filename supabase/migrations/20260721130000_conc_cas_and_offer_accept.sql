-- CONC-04: version columns for CAS on flashcards / notes / profile settings
-- CONC-05: atomic offer-accept order creation (parity with buy-now)

-- ---------------------------------------------------------------------------
-- CONC-04: flashcards.version
-- ---------------------------------------------------------------------------
ALTER TABLE public.flashcards
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.bump_flashcard_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  NEW.version := COALESCE(OLD.version, 0) + 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS flashcards_bump_version ON public.flashcards;
CREATE TRIGGER flashcards_bump_version
  BEFORE UPDATE ON public.flashcards
  FOR EACH ROW
  EXECUTE FUNCTION public.bump_flashcard_version();

-- ---------------------------------------------------------------------------
-- CONC-04: notes.version (updated_at already exists)
-- ---------------------------------------------------------------------------
ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.bump_note_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  NEW.version := COALESCE(OLD.version, 0) + 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notes_bump_version ON public.notes;
CREATE TRIGGER notes_bump_version
  BEFORE UPDATE ON public.notes
  FOR EACH ROW
  EXECUTE FUNCTION public.bump_note_version();

-- ---------------------------------------------------------------------------
-- CONC-04: profiles.settings_version
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS settings_version INTEGER NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.bump_profile_settings_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  IF NEW.settings IS DISTINCT FROM OLD.settings THEN
    NEW.settings_version := COALESCE(OLD.settings_version, 0) + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_bump_settings_version ON public.profiles;
CREATE TRIGGER profiles_bump_settings_version
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.bump_profile_settings_version();

-- ---------------------------------------------------------------------------
-- CONC-05: atomic offer-accept order
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

  IF v_offer.seller_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'Only the seller can accept this offer';
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
  'Atomically accepts a pending offer and creates marketplace transaction + order (CONC-05).';
