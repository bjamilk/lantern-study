-- Bonus AI uses: a banked pool that survives midnight, earned by referral.
--
-- Why: the daily AI allowance resets at 00:00 UTC and cannot be topped up. The
-- founder's decision is that a student at zero is offered a REFERRAL REWARD
-- paid in AI uses — never a purchase. That needs a second pool with different
-- physics from the daily counter: banked (no reset), granted exactly once per
-- referral, and spent only after the daily allowance is gone.
--
-- The daily counter stays where it is (Redis / in-memory, keyed by UTC date).
-- Only the banked pool is durable, because only the banked pool is owed.
--
-- The API feature-detects every object below. Until this migration is applied
-- the bonus balance reads 0, no grant is recorded, and the app charges the
-- daily allowance exactly as it does today — it degrades to the current
-- behaviour rather than to a lie about a balance nobody has.
--
-- Everything is idempotent so a partial run can be re-run.

-- ============ 1. the banked balance ============

CREATE TABLE IF NOT EXISTS public.ai_bonus_uses (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  balance integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ai_bonus_uses IS
  'Banked AI uses per account. Spent only after the daily allowance is exhausted; never reset by the daily window.';

-- ============ 2. the grant ledger ============
--
-- `source_id` is UNIQUE across the whole table, and the referral path derives
-- it from the referral row id. That is what makes a grant idempotent: a
-- concurrent double-activation inserts once and the second insert conflicts.
-- A capped grant is still recorded (amount 0 + reason) so the ledger shows a
-- referral qualified even when it paid nothing.

CREATE TABLE IF NOT EXISTS public.ai_bonus_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('referral', 'admin', 'promo')),
  source_id text NOT NULL,
  amount integer NOT NULL DEFAULT 0 CHECK (amount >= 0),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_bonus_grants_source_id_uidx
  ON public.ai_bonus_grants (source_id);
CREATE INDEX IF NOT EXISTS ai_bonus_grants_user_idx
  ON public.ai_bonus_grants (user_id, created_at DESC);

-- ============ 3. RLS ============
--
-- Writes are service-role only (the API grants and spends). A user may read
-- their own balance and their own grant history, because the Usage & limits
-- screen shows both and there is nothing private about your own reward.

ALTER TABLE public.ai_bonus_uses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_bonus_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_bonus_uses_select_own ON public.ai_bonus_uses;
CREATE POLICY ai_bonus_uses_select_own ON public.ai_bonus_uses
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS ai_bonus_grants_select_own ON public.ai_bonus_grants;
CREATE POLICY ai_bonus_grants_select_own ON public.ai_bonus_grants
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ============ 4. grant, exactly once, under a banked cap ============
--
-- Returns jsonb: { granted, amount, balance, capped, reason }.
--   granted=false, capped=false  → this source_id was already granted
--   granted=false, capped=true   → qualified, but the banked cap is full
--   granted=true                 → `amount` was added to `balance`
--
-- A partially-capped grant pays what fits rather than nothing: refusing 5 uses
-- because only 3 fit under the cap would be the app quietly keeping the rest.

CREATE OR REPLACE FUNCTION public.ai_bonus_grant(
  p_user_id uuid,
  p_source text,
  p_source_id text,
  p_amount integer,
  p_cap integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current integer;
  v_room integer;
  v_grant integer;
  v_inserted uuid;
  v_reason text;
BEGIN
  IF p_user_id IS NULL OR p_source_id IS NULL OR btrim(p_source_id) = '' THEN
    RAISE EXCEPTION 'user id and source id are required' USING ERRCODE = '22023';
  END IF;

  -- Materialise the row first so the cap check below reads a locked balance.
  INSERT INTO public.ai_bonus_uses (user_id, balance)
  VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT balance INTO v_current
  FROM public.ai_bonus_uses
  WHERE user_id = p_user_id
  FOR UPDATE;

  v_room := GREATEST(0, COALESCE(p_cap, 0) - COALESCE(v_current, 0));
  v_grant := LEAST(GREATEST(0, COALESCE(p_amount, 0)), v_room);
  v_reason := CASE
    WHEN v_grant = 0 THEN 'capped: banked balance at or above cap'
    WHEN v_grant < GREATEST(0, COALESCE(p_amount, 0)) THEN 'partially capped: banked cap reached'
    ELSE NULL
  END;

  -- The unique index on source_id is the real idempotency guard. If this
  -- conflicts, another call already paid this referral and we add nothing.
  INSERT INTO public.ai_bonus_grants (user_id, source, source_id, amount, reason)
  VALUES (p_user_id, p_source, p_source_id, v_grant, v_reason)
  ON CONFLICT (source_id) DO NOTHING
  RETURNING id INTO v_inserted;

  IF v_inserted IS NULL THEN
    RETURN jsonb_build_object(
      'granted', false,
      'amount', 0,
      'balance', COALESCE(v_current, 0),
      'capped', false,
      'reason', 'already granted'
    );
  END IF;

  IF v_grant > 0 THEN
    UPDATE public.ai_bonus_uses
    SET balance = balance + v_grant, updated_at = now()
    WHERE user_id = p_user_id
    RETURNING balance INTO v_current;
  END IF;

  RETURN jsonb_build_object(
    'granted', v_grant > 0,
    'amount', v_grant,
    'balance', COALESCE(v_current, 0),
    'capped', v_grant < GREATEST(0, COALESCE(p_amount, 0)),
    'reason', v_reason
  );
END;
$$;

-- ============ 5. spend, all-or-nothing ============
--
-- The guarded UPDATE is the atomicity: `WHERE balance >= n` means two
-- concurrent requests can never both take the last use.

CREATE OR REPLACE FUNCTION public.ai_bonus_spend(
  p_user_id uuid,
  p_amount integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount integer := GREATEST(0, COALESCE(p_amount, 0));
  v_balance integer;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user id is required' USING ERRCODE = '22023';
  END IF;

  IF v_amount = 0 THEN
    SELECT COALESCE(balance, 0) INTO v_balance
    FROM public.ai_bonus_uses WHERE user_id = p_user_id;
    RETURN jsonb_build_object('spent', true, 'amount', 0, 'balance', COALESCE(v_balance, 0));
  END IF;

  UPDATE public.ai_bonus_uses
  SET balance = balance - v_amount, updated_at = now()
  WHERE user_id = p_user_id AND balance >= v_amount
  RETURNING balance INTO v_balance;

  IF v_balance IS NULL THEN
    SELECT COALESCE(balance, 0) INTO v_balance
    FROM public.ai_bonus_uses WHERE user_id = p_user_id;
    RETURN jsonb_build_object('spent', false, 'amount', 0, 'balance', COALESCE(v_balance, 0));
  END IF;

  RETURN jsonb_build_object('spent', true, 'amount', v_amount, 'balance', v_balance);
END;
$$;

-- ============ 6. refund back to the pool it came from ============
--
-- A failed job must return bonus uses to the BONUS balance, not to the daily
-- counter — crediting the daily counter would silently convert a banked,
-- durable use into one that expires at midnight.

CREATE OR REPLACE FUNCTION public.ai_bonus_refund(
  p_user_id uuid,
  p_amount integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount integer := GREATEST(0, COALESCE(p_amount, 0));
  v_balance integer;
BEGIN
  IF p_user_id IS NULL OR v_amount = 0 THEN
    SELECT COALESCE(balance, 0) INTO v_balance
    FROM public.ai_bonus_uses WHERE user_id = p_user_id;
    RETURN COALESCE(v_balance, 0);
  END IF;

  INSERT INTO public.ai_bonus_uses (user_id, balance)
  VALUES (p_user_id, v_amount)
  ON CONFLICT (user_id) DO UPDATE
    SET balance = public.ai_bonus_uses.balance + EXCLUDED.balance,
        updated_at = now()
  RETURNING balance INTO v_balance;

  RETURN COALESCE(v_balance, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.ai_bonus_grant(uuid, text, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_bonus_spend(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_bonus_refund(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_bonus_grant(uuid, text, text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_bonus_spend(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_bonus_refund(uuid, integer) TO service_role;
