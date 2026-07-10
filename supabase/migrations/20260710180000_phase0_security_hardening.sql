-- Phase 0: atomic wallet RPCs, idempotency keys, gamification INSERT lockdown

-- Force zero gamification on profile INSERT for non-service_role callers
CREATE OR REPLACE FUNCTION public.preserve_gamification_profile_fields()
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
    NEW.points := OLD.points;
    NEW.badges := OLD.badges;
    NEW.stats := OLD.stats;
  ELSE
    NEW.points := 0;
    NEW.badges := '[]'::jsonb;
    NEW.stats := '{}'::jsonb;
  END IF;

  RETURN NEW;
END;
$$;

-- Idempotency store for sensitive API mutations (service role only)
CREATE TABLE IF NOT EXISTS public.api_idempotency_keys (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operation text NOT NULL,
  idempotency_key text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, operation, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_api_idempotency_keys_created
  ON public.api_idempotency_keys (created_at);

ALTER TABLE public.api_idempotency_keys ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.api_idempotency_keys IS
  'Server-side idempotency cache for wallet purchases and marketplace buy-now.';

-- Atomic wallet debit/credit with row lock
CREATE OR REPLACE FUNCTION public.wallet_adjust_balance(
  p_user_id uuid,
  p_delta numeric,
  p_reason text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_theme text;
  v_prefs jsonb;
  v_extras jsonb;
  v_balance numeric;
  v_new_balance numeric;
BEGIN
  SELECT theme, COALESCE(preferences, '{}'::jsonb)
  INTO v_theme, v_prefs
  FROM public.user_preferences
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    v_theme := 'light';
    v_prefs := '{}'::jsonb;
    INSERT INTO public.user_preferences (user_id, theme, preferences)
    VALUES (p_user_id, v_theme, v_prefs);
  END IF;

  v_extras := COALESCE(v_prefs->'budgetExtras', '{}'::jsonb);
  IF jsonb_typeof(v_extras) <> 'object' THEN
    v_extras := '{}'::jsonb;
  END IF;

  v_balance := COALESCE((v_extras->>'walletBalance')::numeric, 0);
  v_new_balance := v_balance + p_delta;

  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'insufficient_wallet_balance'
      USING DETAIL = jsonb_build_object(
        'balance', v_balance,
        'required', abs(p_delta),
        'reason', p_reason
      )::text;
  END IF;

  v_extras := v_extras || jsonb_build_object('walletBalance', v_new_balance);

  UPDATE public.user_preferences
  SET
    preferences = jsonb_set(COALESCE(preferences, '{}'::jsonb), '{budgetExtras}', v_extras, true),
    updated_at = now()
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'walletBalance', v_new_balance,
    'awarded', CASE WHEN p_delta > 0 THEN p_delta ELSE 0 END
  );
END;
$$;

-- Atomic one-time wallet award
CREATE OR REPLACE FUNCTION public.wallet_award_once(
  p_user_id uuid,
  p_award_key text,
  p_amount numeric,
  p_reason text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_theme text;
  v_prefs jsonb;
  v_extras jsonb;
  v_awards jsonb;
  v_balance numeric;
  v_new_balance numeric;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    SELECT COALESCE((preferences->'budgetExtras'->>'walletBalance')::numeric, 0)
    INTO v_balance
    FROM public.user_preferences
    WHERE user_id = p_user_id;

    RETURN jsonb_build_object(
      'walletBalance', COALESCE(v_balance, 0),
      'awarded', 0
    );
  END IF;

  SELECT theme, COALESCE(preferences, '{}'::jsonb)
  INTO v_theme, v_prefs
  FROM public.user_preferences
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    v_theme := 'light';
    v_prefs := '{}'::jsonb;
    INSERT INTO public.user_preferences (user_id, theme, preferences)
    VALUES (p_user_id, v_theme, v_prefs);
  END IF;

  v_extras := COALESCE(v_prefs->'budgetExtras', '{}'::jsonb);
  IF jsonb_typeof(v_extras) <> 'object' THEN
    v_extras := '{}'::jsonb;
  END IF;

  v_awards := COALESCE(v_extras->'walletAwards', '{}'::jsonb);
  IF jsonb_typeof(v_awards) <> 'object' THEN
    v_awards := '{}'::jsonb;
  END IF;

  v_balance := COALESCE((v_extras->>'walletBalance')::numeric, 0);

  IF v_awards ? p_award_key THEN
    RETURN jsonb_build_object(
      'walletBalance', v_balance,
      'awarded', 0,
      'alreadyAwarded', true
    );
  END IF;

  v_new_balance := v_balance + p_amount;
  v_awards := v_awards || jsonb_build_object(p_award_key, p_amount);
  v_extras := v_extras || jsonb_build_object(
    'walletBalance', v_new_balance,
    'walletAwards', v_awards
  );

  UPDATE public.user_preferences
  SET
    preferences = jsonb_set(COALESCE(preferences, '{}'::jsonb), '{budgetExtras}', v_extras, true),
    updated_at = now()
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'walletBalance', v_new_balance,
    'awarded', p_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_adjust_balance(uuid, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wallet_award_once(uuid, text, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wallet_adjust_balance(uuid, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.wallet_award_once(uuid, text, numeric, text) TO service_role;
