-- Phase 2 J — Creator profiles, follows, creator_stats and Verified v1.
--
-- Turns a seller into a creator: students can follow them, a public creator
-- profile shows what they've made and how much they've helped, and a
-- materialised creator_stats row carries the counts + a trust score so the
-- profile and discovery never run aggregate queries per request.
--
-- Hand-apply AFTER 20260823120000_study_packs.sql (creator_stats counts study
-- packs) — order among the other 20260823* files is not constrained.

-- ============ 1. Follows ============

CREATE TABLE IF NOT EXISTS public.profile_follows (
  follower_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  followee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CONSTRAINT profile_follows_no_self CHECK (follower_id <> followee_id)
);

CREATE INDEX IF NOT EXISTS idx_profile_follows_followee
  ON public.profile_follows (followee_id);

ALTER TABLE public.profile_follows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profile_follows_select ON public.profile_follows;
DROP POLICY IF EXISTS profile_follows_insert ON public.profile_follows;
DROP POLICY IF EXISTS profile_follows_delete ON public.profile_follows;

-- Reads: a user may see their own edges. WRITES ARE SERVICE-ROLE ONLY — the API
-- enforces the block check in both directions before creating a follow, and a
-- direct client INSERT would bypass that (and inflate follower_count).
REVOKE INSERT, UPDATE, DELETE ON public.profile_follows FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.profile_follows TO authenticated;
GRANT ALL ON public.profile_follows TO service_role;

CREATE POLICY profile_follows_select ON public.profile_follows
  FOR SELECT TO authenticated
  USING (follower_id = auth.uid() OR followee_id = auth.uid());

COMMENT ON TABLE public.profile_follows IS
  'Student follows a creator. Enforced against user_blocks in both directions by the API.';

-- ============ 2. Profile columns ============

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz,
  -- Verified v1 (decision D8): 0 = none, 1 = confirmed email, 2 = + active payout profile.
  ADD COLUMN IF NOT EXISTS verification_level smallint NOT NULL DEFAULT 0;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_bio_length;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_bio_length CHECK (bio IS NULL OR char_length(bio) <= 280);

-- verification_level / email_confirmed_at are SERVER-owned: they drive the
-- Verified badge, so a client writing them directly through PostgREST would
-- self-verify. Mirror strip_privileged_profile_settings: revert any non
-- service-role write to the previous value (0 / NULL on insert).
CREATE OR REPLACE FUNCTION public.protect_profile_verification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF public.is_service_role_caller() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.verification_level := OLD.verification_level;
    NEW.email_confirmed_at := OLD.email_confirmed_at;
  ELSE
    NEW.verification_level := 0;
    NEW.email_confirmed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_protect_verification ON public.profiles;
CREATE TRIGGER profiles_protect_verification
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_verification();

-- ============ 3. creator_stats ============

CREATE TABLE IF NOT EXISTS public.creator_stats (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  active_packs integer NOT NULL DEFAULT 0,
  packs_total integer NOT NULL DEFAULT 0,
  learners_helped integer NOT NULL DEFAULT 0,
  completed_orders integer NOT NULL DEFAULT 0,
  disputed_orders integer NOT NULL DEFAULT 0,
  review_count integer NOT NULL DEFAULT 0,
  avg_rating numeric(3,2) NOT NULL DEFAULT 0,
  five_star_count integer NOT NULL DEFAULT 0,
  follower_count integer NOT NULL DEFAULT 0,
  following_count integer NOT NULL DEFAULT 0,
  account_age_days integer NOT NULL DEFAULT 0,
  trust_score integer NOT NULL DEFAULT 0,
  trust_level text NOT NULL DEFAULT 'new'
    CHECK (trust_level IN ('new', 'rising', 'trusted', 'verified')),
  refreshed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_creator_stats_learners
  ON public.creator_stats (learners_helped DESC);

-- Stats are derived and public-ish, but writes are service-role only; reads go
-- through the API (which decides what a viewer may see — never earnings).
ALTER TABLE public.creator_stats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.creator_stats FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.creator_stats TO service_role;

-- ============ 4. refresh_creator_stats ============
-- Recomputes one creator's row from the source tables. Called by the API after
-- pack publish, entitlement grant, order completion, review insert, follow.

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
  v_reviews integer := 0;
  v_avg numeric(3,2) := 0;
  v_five integer := 0;
  v_followers integer := 0;
  v_following integer := 0;
  v_age_days integer := 0;
  v_verification smallint := 0;
  v_score integer := 0;
  v_level text := 'new';
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;

  -- Digital products this creator has published.
  SELECT
    COUNT(*) FILTER (WHERE status = 'active'),
    COUNT(*)
  INTO v_active_packs, v_packs_total
  FROM public.marketplace_listings
  WHERE user_id = p_user_id
    AND listing_kind IN ('question_bank', 'study_pack');

  -- Distinct students who received one of this creator's digital products.
  SELECT COUNT(DISTINCT e.user_id) INTO v_learners
  FROM public.marketplace_question_bank_entitlements e
  JOIN public.marketplace_listings l ON l.id = e.listing_id
  WHERE l.user_id = p_user_id
    AND e.user_id <> p_user_id;

  SELECT
    COUNT(*) FILTER (WHERE status = 'completed'),
    COUNT(*) FILTER (WHERE status = 'disputed')
  INTO v_completed, v_disputed
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
    COALESCE(verification_level, 0)
  INTO v_age_days, v_verification
  FROM public.profiles WHERE id = p_user_id;

  -- Trust score 0-100 (plan §4 N weights): verification, longevity, completed
  -- sales (log-scaled), reviews, minus lost disputes.
  v_score :=
      CASE WHEN v_verification >= 2 THEN 20 WHEN v_verification = 1 THEN 15 ELSE 0 END
    + LEAST(20, (v_age_days / 30))
    + LEAST(30, (CASE WHEN v_completed > 0 THEN (ln(v_completed + 1) * 10)::integer ELSE 0 END))
    + LEAST(20, (CASE WHEN v_reviews > 0 THEN ((v_avg / 5) * 20)::integer ELSE 0 END))
    + LEAST(10, v_learners / 10)
    - (v_disputed * 10);
  v_score := GREATEST(0, LEAST(100, v_score));

  v_level := CASE
    WHEN v_verification >= 2 AND v_score >= 75 THEN 'verified'
    WHEN v_score >= 50 THEN 'trusted'
    WHEN v_score >= 25 THEN 'rising'
    ELSE 'new'
  END;

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

COMMENT ON TABLE public.creator_stats IS
  'Materialised creator counters + trust score (Phase 2 J); refreshed via refresh_creator_stats().';
