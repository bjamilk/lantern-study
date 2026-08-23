-- Phase 2 G — Study Packs: a second digital marketplace product, alongside
-- question banks. A study pack bundles a guide, summaries, flashcards and
-- questions authored from a student's notes/course. Ownership is an entitlement
-- row (the same table question banks use); the product is delivered by copying
-- its parts into the buyer's own data — questions -> offline_bundles,
-- flashcards -> a deck (once), guide/summaries -> a note (once) — so no new
-- client runtime is needed.
--
-- Hand-apply AFTER 20260822170000_phase1_hardening.sql (and thus after
-- 20260818120000 / 20260822121000, whose money RPCs this file re-creates).
--
-- Adds:
--   1. listing_kind 'study_pack'
--   2. marketplace_study_packs        — the frozen content snapshot per listing
--   3. marketplace_question_bank_entitlements.delivered_refs — where each part
--      was materialised on the buyer's device (bundle/deck/note ids + version)
--   4. Digital-aware re-creation of marketplace_create_buy_now_order and
--      marketplace_release_escrow: every `listing_kind = 'question_bank'` test
--      becomes `listing_kind IN ('question_bank','study_pack')`, so study packs
--      get the same unlimited-concurrent-buyers, one-purchase-per-buyer,
--      never-reserve, never-sold digital behaviour.

-- ============ 1. listing_kind ============

ALTER TABLE public.marketplace_listings
  DROP CONSTRAINT IF EXISTS marketplace_listings_listing_kind_check;
ALTER TABLE public.marketplace_listings
  ADD CONSTRAINT marketplace_listings_listing_kind_check
  CHECK (listing_kind IN ('single', 'bundle', 'question_bank', 'study_pack'));

-- ============ 2. Study pack content snapshots ============

CREATE TABLE IF NOT EXISTS public.marketplace_study_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL UNIQUE REFERENCES public.marketplace_listings(id) ON DELETE CASCADE,
  published_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL,
  -- The notes this pack was built from (provenance; not delivered to buyers).
  source_note_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  -- { guide: { markdown, toc: [{title, anchor}] },
  --   summaries: [{title, markdown}],
  --   flashcards: [{front, back, type?, tags?}],
  --   questions: [ ...question_data shape... ],
  --   weakSections: [{title, reason}] }
  content jsonb NOT NULL,
  -- { guideWords, summaries, flashcards, questions }
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  cover_url text,
  rights_attested_at timestamptz,
  rights_attestation_version text,
  ai_assisted boolean NOT NULL DEFAULT false,
  sources_cited jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_study_packs_published_by
  ON public.marketplace_study_packs(published_by);
CREATE INDEX IF NOT EXISTS idx_marketplace_study_packs_course
  ON public.marketplace_study_packs(course_id);

-- Content is the paid product: service-role only. Buyers receive their copy
-- through offline_bundles / a deck / a note, never by reading this table.
ALTER TABLE public.marketplace_study_packs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketplace_study_packs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.marketplace_study_packs TO service_role;

-- ============ 3. Entitlement delivery bookkeeping ============
-- Study packs reuse marketplace_question_bank_entitlements verbatim (keys
-- listing_id,user_id). Unlike a question bank, a pack materialises into more
-- than one place, so we record where each part landed to make re-delivery
-- (update-pull, restore) idempotent instead of duplicating decks/notes.
--   { bundleId, deckId, noteId, version }
ALTER TABLE public.marketplace_question_bank_entitlements
  ADD COLUMN IF NOT EXISTS delivered_refs jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ============ 4a. Buy-now order creation, digital-aware ============
-- Re-created from 20260818120000_marketplace_question_banks.sql, generalising
-- every question_bank test to the digital-kind set. Digital listings: any
-- number of buyers, one purchase per buyer, no reserve/stock hold.

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
  v_is_digital boolean;
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

  v_is_digital := v_listing.listing_kind IN ('question_bank', 'study_pack');

  IF v_listing.user_id = p_buyer_id THEN
    RAISE EXCEPTION 'Cannot buy your own listing';
  END IF;

  IF v_listing.status <> 'active' THEN
    RAISE EXCEPTION 'Listing is not available for purchase';
  END IF;

  IF v_is_digital THEN
    -- Digital: any number of buyers, but each buyer buys once.
    IF v_qty <> 1 THEN
      RAISE EXCEPTION 'This digital item is a single purchase';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.marketplace_question_bank_entitlements e
      WHERE e.listing_id = p_listing_id AND e.user_id = p_buyer_id
    ) THEN
      RAISE EXCEPTION 'You already own this item';
    END IF;
    SELECT o.id INTO v_existing_order_id
    FROM public.marketplace_orders o
    WHERE o.listing_id = p_listing_id
      AND o.buyer_id = p_buyer_id
      AND o.status IN ('pending_payment', 'awaiting_payment', 'paid', 'ready_for_pickup', 'buyer_confirmed', 'disputed')
    LIMIT 1;
    IF v_existing_order_id IS NOT NULL THEN
      RAISE EXCEPTION 'You already have an open order for this item';
    END IF;
  ELSIF v_listing.quantity IS NULL THEN
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
    p_inquiry_id, v_txn_id, 'buy_now', p_initial_status,
    CASE WHEN v_is_digital THEN 'digital' ELSE 'campus_meetup' END
  ) RETURNING id INTO v_order_id;

  IF v_is_digital THEN
    NULL; -- Digital inventory is unlimited: the listing stays active.
  ELSIF v_listing.quantity IS NULL THEN
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

-- ============ 4b. Escrow release, digital-aware ============
-- Re-created from 20260822121000_marketplace_release_escrow_moderation_safe.sql,
-- keeping its moderation-safe status predicates and generalising the digital
-- branch to the digital-kind set. Study packs never flip to sold and never
-- touch stock on completion.

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

  IF v_listing.listing_kind IN ('question_bank', 'study_pack') THEN
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

-- ============ 5. learning_events: 'pack_downloaded' ============
-- Widen the event_type CHECK to record study-pack downloads, mirroring
-- 'bank_downloaded'. The inline column CHECK from 20260822150000 is auto-named
-- learning_events_event_type_check; drop and re-add it with the extra value.

ALTER TABLE public.learning_events
  DROP CONSTRAINT IF EXISTS learning_events_event_type_check;
ALTER TABLE public.learning_events
  ADD CONSTRAINT learning_events_event_type_check CHECK (event_type IN (
    'card_reviewed','question_shown','question_answered','resource_opened','note_created',
    'card_generated','question_generated','bank_downloaded','bank_score_recorded',
    'pack_downloaded','group_question_posted'));

COMMENT ON TABLE public.marketplace_study_packs IS
  'Frozen study-pack snapshots sold as digital marketplace listings; delivered via offline_bundles + a deck + a note.';
