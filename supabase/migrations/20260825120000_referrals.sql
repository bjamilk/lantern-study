-- Phase 4 Q — Referrals, referral codes and ambassadors.
--
-- ATTRIBUTION POINT — the decision that makes or breaks this.
--
-- The plan said to consume the referral code in the WEB CLIENT's
-- `finishAuthSession`. That is wrong for the dominant signup flow, and would
-- have silently lost most referrals:
--
--   * `handle_new_user()` (an AFTER INSERT trigger on auth.users) already
--     creates the profiles row AT SIGNUP TIME, before email confirmation. So
--     finishAuthSession's "profile missing → create it from metadata" branch is
--     already dead code on the real path.
--   * Clicking the emailed confirmation link lands on /login#access_token=…,
--     which `detectSessionInUrl` consumes and `onAuthStateChange` handles —
--     AuthScreen unmounts and finishAuthSession NEVER RUNS. Only the 6-digit
--     OTP paste path reaches it.
--
-- So attribution is consumed HERE, in the trigger: it is server-side, sees
-- `raw_user_meta_data` (which GoTrue never clears), fires exactly once per user,
-- and is identical for web, mobile, OTP and email-link flows.
--
-- REWARD is NOT granted here. The trigger only records the claim; the API grants
-- coins on ACTIVATION via wallet_award_once, so a signup alone is worth nothing.
--
-- Hand-apply order: FIRST Phase 4 migration.

-- ============ 1. referral_code on profiles ============

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referral_code text,
  -- Ambassadors are campus reps: a flag the admin console sets, not self-serve.
  ADD COLUMN IF NOT EXISTS is_ambassador boolean NOT NULL DEFAULT false;

-- Case-insensitive uniqueness: codes are shared verbally and typed by hand.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_referral_code_uidx
  ON public.profiles (upper(referral_code))
  WHERE referral_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS profiles_ambassador_idx
  ON public.profiles (institution_id) WHERE is_ambassador = true;

-- `referral_code` and `is_ambassador` must not be client-writable: the first is
-- an identity someone could squat, the second grants standing. The Phase 2 J
-- review found exactly this hole on verification_level. Reuse that pattern.
CREATE OR REPLACE FUNCTION public.protect_referral_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;
  NEW.referral_code := OLD.referral_code;
  NEW.is_ambassador := OLD.is_ambassador;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_protect_referral_fields ON public.profiles;
CREATE TRIGGER profiles_protect_referral_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_referral_fields();

-- ============ 2. Code generation ============
-- Short, unambiguous, shouted-across-a-lecture-hall friendly: no O/0, I/1/L.

CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  candidate text;
  i integer;
  attempt integer := 0;
BEGIN
  LOOP
    candidate := '';
    FOR i IN 1..7 LOOP
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    END LOOP;
    -- 31^7 ≈ 2.7e10, so a collision is vanishingly unlikely; still, verify.
    PERFORM 1 FROM public.profiles WHERE upper(referral_code) = candidate;
    IF NOT FOUND THEN
      RETURN candidate;
    END IF;
    attempt := attempt + 1;
    IF attempt > 12 THEN
      -- Give up on prettiness rather than loop forever.
      RETURN candidate || floor(random() * 1000)::text;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_referral_code() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_referral_code() TO service_role;

-- ============ 3. referrals ============

CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- UNIQUE: a person can be referred exactly once, ever. This is the primary
  -- anti-abuse constraint and it lives in the schema, not in a caller.
  referee_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  code text NOT NULL,
  source text CHECK (source IS NULL OR source IN ('link', 'campus', 'ambassador', 'invite')),
  -- Set when the referee genuinely engaged (see referral_activation_check).
  qualified_at timestamptz,
  -- Set when coins were actually granted; wallet_award_once is the real guard.
  rewarded_at timestamptz,
  reward_amount integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referrals_no_self CHECK (referrer_id <> referee_id)
);

CREATE INDEX IF NOT EXISTS referrals_referrer_idx
  ON public.referrals (referrer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS referrals_pending_idx
  ON public.referrals (created_at) WHERE qualified_at IS NULL;
CREATE INDEX IF NOT EXISTS referrals_unrewarded_idx
  ON public.referrals (qualified_at) WHERE qualified_at IS NOT NULL AND rewarded_at IS NULL;

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.referrals FROM PUBLIC, anon, authenticated;
-- Referrers read their own via GET /referrals (service role); nothing is
-- client-writable, or the reward could be self-granted.
GRANT SELECT ON public.referrals TO authenticated;
GRANT ALL ON public.referrals TO service_role;

DROP POLICY IF EXISTS referrals_select_own ON public.referrals;
CREATE POLICY referrals_select_own ON public.referrals
  FOR SELECT TO authenticated
  USING (referrer_id = auth.uid() OR referee_id = auth.uid());

COMMENT ON TABLE public.referrals IS
  'Phase 4 Q — one row per referred user (referee_id UNIQUE). Recorded by handle_new_user at signup; rewarded by the API on activation.';

-- ============ 4. handle_new_user consumes the referral code ============
-- Extends the existing trigger. Everything above the referral block is
-- unchanged from 20260711120000 — re-stated because CREATE OR REPLACE needs the
-- whole body.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meta jsonb;
  v_name text;
  v_first text;
  v_last text;
  v_username text;
  v_phone text;
  v_default_settings jsonb;
  v_ref_code text;
  v_referrer uuid;
BEGIN
  meta := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  v_first := NULLIF(TRIM(meta->>'first_name'), '');
  v_last := NULLIF(TRIM(meta->>'last_name'), '');
  v_username := NULLIF(LOWER(TRIM(meta->>'username')), '');
  v_phone := NULLIF(TRIM(meta->>'phone'), '');
  v_name := NULLIF(TRIM(meta->>'name'), '');

  IF v_name IS NULL AND (v_first IS NOT NULL OR v_last IS NOT NULL) THEN
    v_name := TRIM(CONCAT(v_first, ' ', v_last));
  END IF;

  IF v_name IS NULL OR v_name = '' THEN
    v_name := split_part(COALESCE(NEW.email, ''), '@', 1);
  END IF;

  IF v_name IS NULL OR v_name = '' THEN
    v_name := 'User';
  END IF;

  v_default_settings := jsonb_build_object(
    'privacy', jsonb_build_object(
      'profileVisibility', 'public',
      'discoverableForInvites', true
    )
  );

  INSERT INTO public.profiles (id, name, first_name, last_name, username, phone, settings, referral_code)
  VALUES (
    NEW.id, v_name, v_first, v_last, v_username, v_phone, v_default_settings,
    public.generate_referral_code()
  )
  ON CONFLICT (id) DO UPDATE SET
    name = COALESCE(EXCLUDED.name, profiles.name),
    first_name = COALESCE(EXCLUDED.first_name, profiles.first_name),
    last_name = COALESCE(EXCLUDED.last_name, profiles.last_name),
    username = COALESCE(EXCLUDED.username, profiles.username),
    phone = COALESCE(EXCLUDED.phone, profiles.phone),
    settings = COALESCE(profiles.settings, EXCLUDED.settings),
    -- Never regenerate an existing code: it may already be printed on a poster.
    referral_code = COALESCE(profiles.referral_code, EXCLUDED.referral_code);

  -- ---- Phase 4 Q: record the referral claim (NOT the reward) ----
  -- Wrapped so a bad code can never block a signup. A person failing to create
  -- an account because someone mistyped a referral code would be a far worse
  -- bug than a lost attribution.
  BEGIN
    v_ref_code := NULLIF(UPPER(TRIM(meta->>'referral_code')), '');
    IF v_ref_code IS NOT NULL THEN
      SELECT id INTO v_referrer
      FROM public.profiles
      WHERE upper(referral_code) = v_ref_code
      LIMIT 1;

      IF v_referrer IS NOT NULL AND v_referrer <> NEW.id THEN
        INSERT INTO public.referrals (referrer_id, referee_id, code, source)
        VALUES (
          v_referrer,
          NEW.id,
          v_ref_code,
          COALESCE(NULLIF(TRIM(meta->>'referral_source'), ''), 'link')
        )
        ON CONFLICT (referee_id) DO NOTHING;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NEW;
END;
$$;

-- ============ 5. Backfill codes for existing users ============

UPDATE public.profiles
SET referral_code = public.generate_referral_code()
WHERE referral_code IS NULL;

-- ============ 6. Activation check ============
-- The reward fires on ACTIVATION, not signup, and activation must be something
-- a referrer cannot manufacture cheaply.
--
-- It is computed from `learning_events`, which is the ONLY engagement signal in
-- this codebase that is safe to hang money on: the table is written solely by
-- the API's service-role client, with RLS and grants revoked from anon and
-- authenticated, so no client can insert a row directly. By contrast
-- POST /gamification/activity/record takes {type, amount} as a pure client
-- assertion and mints XP and coins from it — unusable as proof of anything.
--
-- CRITICAL: this counts DISTINCT DAYS of `created_at`, never `occurred_at`.
-- `occurred_at` is client-supplied (validateFlashcardReview accepts any ISO
-- string with no window check), so a "distinct days" test on it is forgeable in
-- a single HTTP burst. `created_at` is a server now() default and is not a field
-- any emitter can set.

CREATE OR REPLACE FUNCTION public.referral_activation_check(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_events integer := 0;
  v_days integer := 0;
BEGIN
  IF p_user_id IS NULL THEN RETURN false; END IF;

  SELECT COUNT(*), COUNT(DISTINCT (created_at AT TIME ZONE 'UTC')::date)
  INTO v_events, v_days
  FROM public.learning_events
  WHERE user_id = p_user_id;

  -- Real study on two separate days. One enthusiastic session is not activation,
  -- and two days cannot be faked without waiting out a real calendar boundary.
  RETURN v_events >= 10 AND v_days >= 2;
END;
$$;

REVOKE ALL ON FUNCTION public.referral_activation_check(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referral_activation_check(uuid) TO service_role;

COMMENT ON FUNCTION public.referral_activation_check(uuid) IS
  'Phase 4 Q — referee activation: >=10 learning_events across >=2 distinct UTC days by created_at (never occurred_at, which clients control).';
