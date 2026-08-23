-- Phase 3 N — Disputes and trust hardening.
--
-- Phase 2 J already shipped: profiles.email_confirmed_at / verification_level,
-- the 1h-cached /users/me sync, creator_stats.trust_score / trust_level, and
-- the Verified badge on creator profiles. This migration adds what N was still
-- missing on the DB side:
--   1. dispute reason / opener / timestamps + a resolution outcome, so
--      `open_dispute` (which marketplaceOrders.ts has supported since Phase 1
--      with no client able to send it) can carry an actual reason;
--   2. a trust score that counts disputes LOST BY THE SELLER rather than
--      disputes merely open, and hard-zeroes banned or deactivated accounts.
--
-- Hand-apply AFTER 20260824121000_activity_feed_presence.sql.

-- ============ 1. Dispute columns ============

ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS dispute_reason text
    CHECK (dispute_reason IS NULL OR char_length(dispute_reason) <= 1000),
  ADD COLUMN IF NOT EXISTS dispute_category text
    CHECK (dispute_category IS NULL OR dispute_category IN (
      'not_received', 'not_as_described', 'damaged', 'wrong_item',
      'seller_unresponsive', 'unauthorised', 'other'
    )),
  ADD COLUMN IF NOT EXISTS dispute_opened_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS disputed_at timestamptz,
  -- Outcome, written by an admin when the dispute closes. 'seller' means the
  -- seller was found at fault — that is the only case that costs trust.
  ADD COLUMN IF NOT EXISTS dispute_outcome text
    CHECK (dispute_outcome IS NULL OR dispute_outcome IN ('buyer', 'seller', 'withdrawn')),
  ADD COLUMN IF NOT EXISTS dispute_resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispute_resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dispute_resolution_note text
    CHECK (dispute_resolution_note IS NULL OR char_length(dispute_resolution_note) <= 2000);

CREATE INDEX IF NOT EXISTS marketplace_orders_disputed_idx
  ON public.marketplace_orders (disputed_at DESC)
  WHERE disputed_at IS NOT NULL;
-- Feeds the trust score: disputes the seller lost.
CREATE INDEX IF NOT EXISTS marketplace_orders_dispute_outcome_idx
  ON public.marketplace_orders (seller_id, dispute_outcome)
  WHERE dispute_outcome IS NOT NULL;

COMMENT ON COLUMN public.marketplace_orders.dispute_outcome IS
  'Phase 3 N — who the dispute was decided for. Only ''seller'' reduces creator trust.';

-- ============ 2. Trust score v2 ============
-- Changes from the Phase 2 J version:
--   * −10 per dispute the seller LOST (was: per dispute currently open, which
--     punished a seller for a buyer merely opening one and never un-punished
--     them when it was withdrawn);
--   * open disputes still count for the `disputed_orders` display column;
--   * hard 0 + level 'new' for banned or deactivated accounts (plan §4 N).

CREATE OR REPLACE FUNCTION public.refresh_creator_stats(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active_packs integer := 0;
  v_packs_total integer := 0;
  v_learners integer := 0;
  v_completed integer := 0;
  v_disputed integer := 0;
  v_lost integer := 0;
  v_reviews integer := 0;
  v_avg numeric(3,2) := 0;
  v_five integer := 0;
  v_followers integer := 0;
  v_following integer := 0;
  v_age_days integer := 0;
  v_verification smallint := 0;
  v_blocked boolean := false;
  v_score integer := 0;
  v_level text := 'new';
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;

  SELECT
    COUNT(*) FILTER (WHERE status = 'active'),
    COUNT(*)
  INTO v_active_packs, v_packs_total
  FROM public.marketplace_listings
  WHERE user_id = p_user_id
    AND listing_kind IN ('question_bank', 'study_pack');

  SELECT COUNT(DISTINCT e.user_id) INTO v_learners
  FROM public.marketplace_question_bank_entitlements e
  JOIN public.marketplace_listings l ON l.id = e.listing_id
  WHERE l.user_id = p_user_id
    AND e.user_id <> p_user_id;

  SELECT
    COUNT(*) FILTER (WHERE status = 'completed'),
    COUNT(*) FILTER (WHERE status = 'disputed'),
    COUNT(*) FILTER (WHERE dispute_outcome = 'seller')
  INTO v_completed, v_disputed, v_lost
  FROM public.marketplace_orders
  WHERE seller_id = p_user_id;

  SELECT
    COUNT(*),
    COALESCE(ROUND(AVG(r.rating)::numeric, 2), 0),
    COUNT(*) FILTER (WHERE r.rating >= 5)
  INTO v_reviews, v_avg, v_five
  FROM public.marketplace_reviews r
  JOIN public.marketplace_listings l ON l.id = r.listing_id
  WHERE l.user_id = p_user_id;

  SELECT COUNT(*) INTO v_followers FROM public.profile_follows WHERE followee_id = p_user_id;
  SELECT COUNT(*) INTO v_following FROM public.profile_follows WHERE follower_id = p_user_id;

  SELECT
    GREATEST(0, EXTRACT(DAY FROM (now() - COALESCE(created_at, now())))::integer),
    COALESCE(verification_level, 0),
    (
      COALESCE((settings->>'is_banned')::boolean, false)
      OR deactivated_at IS NOT NULL
      -- suspended_until is a client-shaped ISO string; only cast it when it
      -- actually looks like a timestamp, or a malformed value raises 22007 and
      -- takes the whole refresh down.
      OR (
        settings->>'suspended_until' ~ '^\d{4}-\d{2}-\d{2}'
        AND (settings->>'suspended_until')::timestamptz > now()
      )
    )
  INTO v_age_days, v_verification, v_blocked
  FROM public.profiles WHERE id = p_user_id;

  IF v_blocked THEN
    v_score := 0;
    v_level := 'new';
  ELSE
    v_score :=
        CASE WHEN v_verification >= 2 THEN 20 WHEN v_verification = 1 THEN 15 ELSE 0 END
      + LEAST(20, (v_age_days / 30))
      + LEAST(30, (CASE WHEN v_completed > 0 THEN (ln(v_completed + 1) * 10)::integer ELSE 0 END))
      + LEAST(20, (CASE WHEN v_reviews > 0 THEN ((v_avg / 5) * 20)::integer ELSE 0 END))
      + LEAST(10, v_learners / 10)
      - (v_lost * 10);
    v_score := GREATEST(0, LEAST(100, v_score));

    v_level := CASE
      WHEN v_verification >= 2 AND v_score >= 75 THEN 'verified'
      WHEN v_score >= 50 THEN 'trusted'
      WHEN v_score >= 25 THEN 'rising'
      ELSE 'new'
    END;
  END IF;

  INSERT INTO public.creator_stats AS cs (
    user_id, active_packs, packs_total, learners_helped, completed_orders, disputed_orders,
    review_count, avg_rating, five_star_count, follower_count, following_count,
    account_age_days, trust_score, trust_level, refreshed_at
  ) VALUES (
    p_user_id, v_active_packs, v_packs_total, v_learners, v_completed, v_disputed,
    v_reviews, v_avg, v_five, v_followers, v_following,
    v_age_days, v_score, v_level, now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    active_packs = EXCLUDED.active_packs,
    packs_total = EXCLUDED.packs_total,
    learners_helped = EXCLUDED.learners_helped,
    completed_orders = EXCLUDED.completed_orders,
    disputed_orders = EXCLUDED.disputed_orders,
    review_count = EXCLUDED.review_count,
    avg_rating = EXCLUDED.avg_rating,
    five_star_count = EXCLUDED.five_star_count,
    follower_count = EXCLUDED.follower_count,
    following_count = EXCLUDED.following_count,
    account_age_days = EXCLUDED.account_age_days,
    trust_score = EXCLUDED.trust_score,
    trust_level = EXCLUDED.trust_level,
    refreshed_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_creator_stats(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_creator_stats(uuid) TO service_role;
