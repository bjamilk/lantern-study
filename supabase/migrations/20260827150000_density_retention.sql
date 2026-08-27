-- Phase 4 F + U — activation timestamp and idempotent retention reminder claims.
--
-- activated_at is written ONLY by the API after referral_activation_check
-- returns true. Clients must not stamp it (that would self-activate and, for
-- referred users, self-pay). Frozen here the same way as referral_code.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS profiles_activated_at_idx
  ON public.profiles (activated_at)
  WHERE activated_at IS NOT NULL;

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
  NEW.activated_at := OLD.activated_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_protect_referral_fields ON public.profiles;
CREATE TRIGGER profiles_protect_referral_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_referral_fields();

-- Dedupe ledger for study reminders and weekly summaries. Same shape as
-- job_reminders_sent: unique (user_id, reminder_key) so a 4-hour sweep cannot
-- double-send, and two workers racing is decided by the constraint.
CREATE TABLE IF NOT EXISTS public.retention_reminders_sent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reminder_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT retention_reminders_sent_unique UNIQUE (user_id, reminder_key)
);

CREATE INDEX IF NOT EXISTS idx_retention_reminders_sent_created
  ON public.retention_reminders_sent(created_at);

ALTER TABLE public.retention_reminders_sent ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.retention_reminders_sent FROM authenticated, anon;

COMMENT ON COLUMN public.profiles.activated_at IS
  'Set once referral_activation_check is true. Never client-writable.';
