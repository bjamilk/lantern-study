-- Account pause / scheduled deletion support

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deletion_scheduled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_profiles_deletion_scheduled
  ON public.profiles (deletion_scheduled_at)
  WHERE deletion_scheduled_at IS NOT NULL;

COMMENT ON COLUMN public.profiles.deactivated_at IS
  'When the user paused their account (self-service deactivation).';
COMMENT ON COLUMN public.profiles.deletion_scheduled_at IS
  'When the account will be permanently deleted if not reactivated.';
