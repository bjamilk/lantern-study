-- Neutral signup-name fallback — forward-looking only.
--
-- WHAT THIS CHANGES: exactly one line of public.handle_new_user(). When a signup
-- supplies no name (no metadata `name`, no first/last), the name used to fall
-- back to the email's local part —
--     v_name := split_part(COALESCE(NEW.email, ''), '@', 1)
-- so an account signed up as nimaj22@gmail.com was literally stored as 'nimaj22'.
-- That value is not email-shaped, so the client identity resolver keeps it and an
-- avatar draws invented initials ('NI') from it. A new account must never be
-- named after its address, so the fallback now yields a neutral placeholder
-- ('User', matching utils/displayIdentity NEUTRAL_DISPLAY_NAME). Every other
-- branch — metadata `name`, first+last, and the final 'User' guard — is unchanged.
--
-- FORWARD-LOOKING ONLY. This does NOT rewrite any existing profiles.name row;
-- renaming real people is the founder's call. See the handover notes for the
-- read-only count and the single UPDATE that would backfill, if ever wanted.
--
-- BASED ON: the current handle_new_user() body from
-- 20260825120000_referrals.sql (the last CREATE OR REPLACE, i.e. what production
-- runs, which added the Phase 4 Q referral-capture block). That whole body is
-- restated verbatim below because CREATE OR REPLACE needs it; the ONLY difference
-- from 20260825120000 is the fallback assignment on the marked line. The referral
-- capture, settings default, and ON CONFLICT upsert are carried forward unchanged
-- so this migration does not silently revert them.
--
-- Idempotent and safe to re-run: it is a single CREATE OR REPLACE FUNCTION.

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

  -- CHANGED (was: v_name := split_part(COALESCE(NEW.email,''),'@','1')).
  -- A nameless account gets a neutral placeholder, never its email local part.
  IF v_name IS NULL OR v_name = '' THEN
    v_name := 'User';
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
